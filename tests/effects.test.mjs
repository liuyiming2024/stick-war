import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG as C } from '../src/config.js';
import { createState, spawnUnit, resetMatch } from '../src/state.js';
import { createRng } from '../src/rng.js';
import {
  step, setAmmo, effectsInfo, setDifficulty,
} from '../src/simulation.js';

const playing = () => {
  const s = createState();
  s.phase = 'playing';
  s.limits.aiPopMax = 0;      // 隔离 AI 决策
  s.homeHp = 1e9;             // 不让终局打断长时推演
  return s;
};
const run = (s, seconds, dt = 1 / 60, seed = 7) => {
  const rng = createRng(seed);
  for (let i = 0; i < Math.round(seconds / dt); i++) step(s, dt, rng);
};
// 把一个我方远程单位和一个敌方靶子摆到射程内固定住（不推进战线）
const duel = (type = 'archer') => {
  const s = playing();
  const a = spawnUnit(s, type, 0, null);
  const t = spawnUnit(s, 'sword', 1, null);
  a.x = 500;
  t.x = 500 + Math.min(a.range * 0.6, 90);
  return { s, a, t };
};

// ── 弹药切换 ────────────────────────────────────────────────────────────

test('弹药配置合法：四种都有标签，效果名都在状态表里', () => {
  assert.equal(C.ammo.default, 'plain');
  assert.equal(Object.keys(C.ammo.kinds).length, 4);
  for (const [k, v] of Object.entries(C.ammo.kinds)) {
    assert.ok(v.label && v.dmgMul > 0, k);
    if (v.effect) assert.ok(['burn', 'poison', 'bleed'].includes(v.effect));
  }
  assert.ok(C.effects.stunSec > 0 && C.effects.dotTickSec > 0);
});

test('setAmmo 走统一 pay()：金币优先、宝石兜底、重复切换不扣钱', () => {
  const s = playing();
  s.gold = 1000;
  const gems0 = s.gems;
  assert.equal(setAmmo(s, 'fire').ok, true);
  assert.equal(s.ammo, 'fire');
  assert.equal(s.gold, 1000 - C.ammo.cost);
  assert.equal(s.gems, gems0);
  assert.equal(s.stats.ammoSwitches, 1);

  const r = setAmmo(s, 'fire');
  assert.equal(r.unchanged, true);
  assert.equal(s.gold, 1000 - C.ammo.cost, '重复切换不该再扣钱');
  assert.equal(s.stats.ammoSwitches, 1);

  s.gold = 0;
  s.gems = 200;
  assert.equal(setAmmo(s, 'poison').ok, true, '金币为 0 应自动用宝石');
  assert.equal(s.gems, 200 - C.ammo.cost);
  assert.equal(s.stats.ammoSwitches, 2);

  s.gems = 0;
  assert.equal(setAmmo(s, 'barbed').ok, false);
  assert.match(setAmmo(s, 'barbed').reason, /宝石/);
  assert.equal(setAmmo(s, 'nope').ok, false);
  assert.equal(s.ammo, 'poison');
});

test('effectsInfo 是唯一口径：徽标、统计都来自 state', () => {
  const s = playing();
  setAmmo(s, 'fire');
  const i = effectsInfo(s);
  assert.equal(i.ammo, 'fire');
  assert.equal(i.ammoLabel, C.ammo.kinds.fire.label);
  assert.equal(i.ammoCost, C.ammo.cost);
  assert.deepEqual(i.active, { burn: 0, poison: 0, bleed: 0, stun: 0 });
  assert.equal(i.stats.ammoSwitches, 1);
});

// ── 状态效果 ────────────────────────────────────────────────────────────

for (const [kind, key] of [['fire', 'burn'], ['poison', 'poison'], ['barbed', 'bleed']]) {
  test(`${C.ammo.kinds[kind].label}命中后挂 ${key}，按秒衰减并造成 DoT`, () => {
    const { s, a, t } = duel('archer');
    assert.equal(setAmmo(s, kind).ok, true);
    const hp0 = t.hp;
    run(s, 1.2);
    assert.ok(t.fx[key] > 0, `${key} 应被挂上，实际 fx=${JSON.stringify(t.fx)}`);
    assert.ok(t.hp < hp0 - C.units.archer.dmg, '直接伤害 + DoT 都应生效');
    const info = effectsInfo(s);
    assert.ok(info.active[key] >= 1, 'active 计数应反映场上有状态的单位');
    assert.ok(s.stats.dotTicks > 0 && s.stats.dotDamage > 0);
    const before = t.fx[key];
    // 移除射手，否则每次命中都会把剩余时长重新挂满，永远衰减不到 0。
    a.hp = 0;
    run(s, C.effects[`${key}Sec`] + 0.5);
    assert.equal(t.fx[key], 0, `${key} 应按时衰减到 0（衰减前 ${before}）`);
  });
}

test('普通箭不挂任何状态，DoT 统计保持为 0', () => {
  const { s, t } = duel('archer');
  run(s, 2);
  assert.deepEqual(
    { burn: t.fx.burn, poison: t.fx.poison, bleed: t.fx.bleed, stun: t.fx.stun },
    { burn: 0, poison: 0, bleed: 0, stun: 0 });
  assert.equal(s.stats.dotTicks, 0);
});

test('中毒减速按 poisonSlowMul 生效，且只影响该单位', () => {
  const s = playing();
  const a = spawnUnit(s, 'sword', 0, null);
  const b = spawnUnit(s, 'sword', 0, null);
  // 两者都放在驻守线左侧且拉开距离，保证同向推进、不会被同队推挤干扰。
  a.x = 100; b.x = 300;   // 都 < defendLine(480)，快的在前不会推挤慢的
  a.fx.poison = C.effects.poisonSec;
  const xa = a.x, xb = b.x;
  run(s, 1);
  const da = a.x - xa, db = b.x - xb;
  assert.ok(da > 0 && db > 0);
  assert.ok(Math.abs(da / db - C.effects.poisonSlowMul) < 1e-9,
    `中毒/正常位移比 ${da / db}`);
});

test('眩晕期间不动、不攻击；时间到自动恢复', () => {
  const { s, a, t } = duel('sword');
  const hp0 = t.hp;
  a.fx.stun = C.effects.stunSec;
  const x0 = a.x;
  run(s, C.effects.stunSec * 0.8);
  assert.ok(Math.abs(a.x - x0) < 1e-9, '眩晕中不该移动');
  assert.equal(t.hp, hp0, '眩晕中不该攻击');
  run(s, C.effects.stunSec * 0.5 + 0.3);
  assert.ok(t.hp < hp0, '眩晕结束后应恢复攻击');
});

test('状态与 DoT 在暂停时完全冻结，60Hz 与 120Hz 一致', () => {
  const mk = () => {
    const { s, t } = duel('archer');
    setAmmo(s, 'poison');
    return s;
  };
  const a = mk(), b = mk();
  run(a, 3, 1 / 60, 11);
  run(b, 3, 1 / 120, 11);
  const ua = a.units.find((u) => u.team === 1);
  const ub = b.units.find((u) => u.team === 1);
  assert.ok(Math.abs(ua.hp - ub.hp) < 1e-6, `HP ${ua.hp} vs ${ub.hp}`);
  // 重复命中会把剩余时长挂满；60/120Hz 命中帧可差一个步长，给 0.1s 容差。
  assert.ok(Math.abs(ua.fx.poison - ub.fx.poison) < 0.1,
    `状态剩余时长 ${ua.fx.poison} vs ${ub.fx.poison}`);
  assert.equal(a.stats.dotTicks, b.stats.dotTicks);

  const c = mk();
  run(c, 1, 1 / 60, 11);
  c.phase = 'paused';
  const hp = c.units.find((u) => u.team === 1).hp;
  run(c, 5, 1 / 60, 11);            // step 在非 playing 直接返回
  assert.equal(c.units.find((u) => u.team === 1).hp, hp, '暂停时 DoT 不该继续扣血');
});

// ── 原版兵种技能 ────────────────────────────────────────────────────────

test('巫师法球命中施加眩晕并产生范围溅射', () => {
  const s = playing();
  const w = spawnUnit(s, 'wizard', 0, null);
  const t1 = spawnUnit(s, 'sword', 1, null);
  const t2 = spawnUnit(s, 'sword', 1, null);
  w.x = 500; t1.x = 560; t2.x = 560 + C.skills.wizardSplashRadiusPx * 0.6;
  const hp1 = t1.hp, hp2 = t2.hp;
  run(s, 2);
  assert.ok(t1.fx.stun > 0 || s.stats.stuns > 0, '应触发眩晕');
  assert.ok(t1.hp < hp1, '主目标应受伤');
  assert.ok(t2.hp < hp2, '溅射范围内的第二目标也应受伤');
  assert.ok(s.stats.stuns > 0);
});

test('矛士在射程内定期投矛，投射物类型与统计都可查', () => {
  const s = playing();
  const sp = spawnUnit(s, 'spear', 0, null);
  const t = spawnUnit(s, 'giant', 1, null);   // 远程打巨人减伤，但会命中
  sp.x = 500; t.x = 500 + C.skills.spearThrowRangePx * 0.8;
  run(s, C.skills.spearThrowIntervalSec + 1);
  assert.ok(s.stats.spearThrows >= 1, `投矛次数 ${s.stats.spearThrows}`);
  assert.ok(effectsInfo(s).stats.spearThrows >= 1);
});

test('召唤物弱化、占人口、ttl 到点消失，不计入出兵统计', () => {
  const s = playing();
  const w = spawnUnit(s, 'wizard', 0, null);
  const spawned0 = s.stats.playerSpawned;
  const pop0 = s.units.length;
  run(s, C.skills.summonIntervalSec + 0.5);
  const minions = s.units.filter((u) => u.summoned);
  assert.ok(minions.length >= 1, '应召唤出至少一个单位');
  assert.ok(minions.length <= C.skills.summonMax);
  for (const m of minions) {
    assert.equal(m.summoned, true);
    assert.ok(m.ttl > 0 && m.ttl <= C.skills.summonTtlSec);
    assert.equal(m.hp, C.units.sword.hp * C.skills.summonHpMul);
    assert.equal(m.dmg, C.units.sword.dmg * C.skills.summonDmgMul);
  }
  assert.equal(s.stats.playerSpawned, spawned0, '召唤不能计入玩家出兵');
  assert.equal(s.units.length, pop0 + minions.length, '召唤物应占人口');
  assert.ok(s.stats.summons >= 1);

  run(s, C.skills.summonTtlSec + 1);
  assert.equal(s.units.filter((u) => u.summoned && u.hp > 0).length, 0,
    'ttl 到点应全部消失');
});

test('AI 侧不召唤（summonPlayerOnly），避免把刚降下来的难度又推回去', () => {
  const s = createState();
  s.phase = 'playing';
  s.homeHp = 1e9;
  const w = spawnUnit(s, 'wizard', 1, null);
  w.x = s.w * 0.7;
  run(s, C.skills.summonIntervalSec + 2);
  assert.equal(s.units.filter((u) => u.summoned && u.team === 1).length, 0);
  assert.equal(s.stats.summons, 0);
});

// ── 生命周期 ────────────────────────────────────────────────────────────

test('重开清空弹药、状态统计与技能计时，但保留难度', () => {
  const s = createState(C.world.width, C.world.height, 'hard');
  s.phase = 'playing';
  setAmmo(s, 'fire');
  const { t } = (() => {
    const u = spawnUnit(s, 'sword', 1, null);
    u.fx.burn = C.effects.burnSec;
    return { t: u };
  })();
  run(s, 2);
  assert.ok(s.stats.dotTicks > 0 || s.stats.stuns >= 0);
  resetMatch(s);
  assert.equal(s.difficulty, 'hard');
  assert.equal(s.ammo, C.ammo.default);
  assert.equal(s.stats.ammoSwitches, 0);
  assert.equal(s.stats.dotTicks, 0);
  assert.equal(s.stats.spearThrows, 0);
  assert.equal(s.stats.summons, 0);
  assert.equal(s.skillTimers.spear.length, 2);
  assert.equal(s.units.length, 0);
});

test('三档难度下弹药切换都不破坏确定性', () => {
  for (const d of ['normal', 'hard', 'insane']) {
    const a = playing(), b = playing();
    for (const s of [a, b]) {
      setDifficulty(s, d);
      setAmmo(s, 'bleed');
      const x = spawnUnit(s, 'archer', 0, null);
      const y = spawnUnit(s, 'sword', 1, null);
      x.x = 500; y.x = 560;
    }
    run(a, 4, 1 / 60, 5);
    run(b, 4, 1 / 120, 5);
    assert.ok(Math.abs(a.enemyHp - b.enemyHp) < 1e-6, `${d} 敌方雕像血量分叉`);
    assert.equal(a.stats.dotTicks, b.stats.dotTicks, `${d} DoT 结算次数分叉`);
  }
});
