import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { bonusFor, upgradeStats, freshUpgrades } from '../src/config.js';
import { createState, resetMatch, spawnUnit, pendingTeam } from '../src/state.js';
import { createRng } from '../src/rng.js';
import {
  step, spawnPlayer, cancelTraining, doUpgrade, setMode, setDifficulty,
} from '../src/simulation.js';

const C = CONFIG;
const playing = (difficulty = 'normal') => {
  const s = createState(800, 600, difficulty);
  s.phase = 'playing';
  return s;
};
const quiet = (s) => { s.limits.aiPopMax = 0; return s; };
const run = (s, seconds, seed = 7) => {
  const rng = createRng(seed);
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) step(s, dt, rng);
};

// ── 训练队列（原版：单位要训练时间，可再点一次取消） ──────────────────

test('下单即扣钱但不立即出场，训练时长结束后才生成单位', () => {
  const s = quiet(playing());
  const gold0 = s.gold;
  const r = spawnPlayer(s, 'sword');
  assert.equal(r.ok, true);
  assert.equal(r.trainSec, C.units.sword.trainSec);
  assert.equal(s.gold, gold0 - C.units.sword.cost);
  assert.equal(s.units.length, 0, '训练中不该出场');
  assert.equal(s.training.length, 1);
  assert.equal(pendingTeam(s, 0), 1);

  run(s, C.units.sword.trainSec - 0.1);
  assert.equal(s.units.length, 0, '未到点不能出场');
  run(s, 0.2);
  assert.equal(s.units.length, 1);
  assert.equal(s.training.length, 0);
  assert.equal(s.stats.trained, 1);
  assert.equal(s.units[0].type, 'sword');
});

test('人口上限把训练队列计入，不能靠排队绕过 20 上限', () => {
  const s = quiet(playing());
  s.gold = 100000;
  s.limits.popMax = 2;
  assert.equal(spawnPlayer(s, 'sword').ok, true);
  assert.equal(spawnPlayer(s, 'sword').ok, true);
  assert.equal(spawnPlayer(s, 'sword').ok, false);
  assert.match(spawnPlayer(s, 'miner').reason, /人口/);
  run(s, C.units.sword.trainSec + 0.2);
  assert.equal(s.units.length, 2);
});

test('取消训练全额退款，且不会生成幽灵单位', () => {
  const s = quiet(playing());
  s.gold = 1000;
  const gold0 = s.gold;
  const r0 = spawnPlayer(s, 'giant');
  assert.equal(r0.ok, true);
  const { trainingId } = r0;
  assert.equal(s.gold, gold0 - C.units.giant.cost);
  const r = cancelTraining(s, trainingId);
  assert.equal(r.ok, true);
  assert.equal(r.refund, C.units.giant.cost);
  assert.equal(s.gold, gold0 + C.economy.castleGoldPerSec * s.elapsed);
  assert.equal(s.training.length, 0);
  run(s, C.units.giant.trainSec + 1);
  assert.equal(s.units.length, 0);
  assert.equal(s.stats.cancelled, 1);
  assert.equal(cancelTraining(s, trainingId).ok, false);
});

test('升级在下单时快照：排队后再升级不影响已下单单位', () => {
  const s = quiet(playing());
  s.gold = 1000;
  spawnPlayer(s, 'sword');
  assert.equal(doUpgrade(s, 'sword', 'atk').ok, true);
  run(s, C.units.sword.trainSec + 0.2);
  assert.equal(s.units[0].dmg, C.units.sword.dmg, '快照应为升级前的倍率');
  assert.equal(s.upgrades.sword.atk, 1);
});

// ── 三条指令 + 城堡射手（原版 Attack / Defend / Garrison） ────────────

test('三条指令合法，非法值不改写状态', () => {
  const s = playing();
  assert.equal(setMode(s, 'garrison'), true);
  assert.equal(s.gameMode, 'garrison');
  assert.equal(setMode(s, 'nonsense'), false);
  assert.equal(s.gameMode, 'garrison');
  assert.equal(setMode(s, 'attack'), true);
  assert.equal(s.fortArrowCd, 0);
});

test('驻堡：堡内单位免疫伤害，城堡按比例放箭', () => {
  const s = quiet(playing());
  assert.equal(setMode(s, 'garrison'), true);
  const guard = spawnUnit(s, 'sword', 0, null);
  guard.x = 30;  // 堡内
  const attacker = spawnUnit(s, 'sword', 1, null);
  attacker.x = 200;
  const hp0 = guard.hp;
  run(s, 4);
  assert.equal(guard.hp, hp0, '堡内单位不该掉血');
  assert.ok(s.stats.fortArrows >= 1, `实际放箭 ${s.stats.fortArrows} 发`);
  assert.ok(attacker.hp < attacker.maxHp, '城堡箭矢应命中来犯单位');
  assert.equal(guard.inFort, true);
});

test('驻堡箭矢数量随堡内人数折算', () => {
  const mk = (n) => {
    const s = quiet(playing());
    setMode(s, 'garrison');
    for (let i = 0; i < n; i++) {
      const u = spawnUnit(s, 'sword', 0, null);
      u.x = 20 + i * 4;
    }
    const e = spawnUnit(s, 'sword', 1, null);
    e.x = 200;
    e.hp = 1e9;
    return s;
  };
  const few = mk(1), many = mk(9);
  run(few, 6);
  run(many, 6);
  assert.ok(many.stats.fortArrows > few.stats.fortArrows,
    `${few.stats.fortArrows} → ${many.stats.fortArrows}`);
});

test('退出驻堡后单位重新可被命中', () => {
  const s = quiet(playing());
  setMode(s, 'garrison');
  const guard = spawnUnit(s, 'sword', 0, null);
  guard.x = 30;
  const attacker = spawnUnit(s, 'sword', 1, null);
  attacker.x = 200;
  run(s, 1);
  assert.equal(guard.inFort, true);
  setMode(s, 'attack');
  run(s, 2);
  assert.equal(guard.inFort, false);
  assert.ok(guard.hp < guard.maxHp);
});

// ── 克制关系（原版：弓克剑、远程打不动巨人与雕像） ────────────────────

function shootAndMeasure(targetType) {
  const s = quiet(playing());
  const archer = spawnUnit(s, 'archer', 0, null);
  const target = spawnUnit(s, targetType, 1, null);
  archer.x = 300;
  target.x = 340;
  const hp0 = target.hp;
  run(s, 0.6);
  return hp0 - target.hp;
}

test('弓箭手克剑士 1.5 倍，对巨人与矛士减半', () => {
  const m = C.combat.damageMatrix;
  const base = C.units.archer.dmg;
  const vsSword = shootAndMeasure('sword');
  const vsGiant = shootAndMeasure('giant');
  const vsSpear = shootAndMeasure('spear');
  assert.ok(Math.abs(vsSword - base * m.archerVsSwordwrath) < 1e-6, `实际 ${vsSword}`);
  assert.ok(Math.abs(vsGiant - base * m.rangedVsGiant) < 1e-6, `实际 ${vsGiant}`);
  assert.ok(Math.abs(vsSpear - base * m.rangedVsSpearton) < 1e-6, `实际 ${vsSpear}`);
  assert.ok(vsSword > vsGiant);
});

test('远程拆雕像减伤，近战不减', () => {
  const mk = (type) => {
    const s = quiet(playing());
    const line = s.w - C.layout.statueInset - C.layout.statueHitRadius;
    const u = spawnUnit(s, type, 0, null);
    u.x = line + 1;
    const hp0 = s.enemyHp;
    step(s, 1 / 60, createRng(1));
    return hp0 - s.enemyHp;
  };
  const swordDmg = C.units.sword.dmg * C.match.statueDamageMul;
  const archerDmg = C.units.archer.dmg * C.match.statueDamageMul * C.combat.damageMatrix.rangedVsStatue;
  assert.ok(Math.abs(mk('sword') - swordDmg) < 1e-6);
  assert.ok(Math.abs(mk('archer') - archerDmg) < 1e-6);
});

// ── 经济与难度 ────────────────────────────────────────────────────────

test('城堡按秒产生被动收入，与矿工收入叠加', () => {
  const s = quiet(playing());
  const g0 = s.gold;
  run(s, 10);
  assert.ok(Math.abs(s.gold - (g0 + C.economy.castleGoldPerSec * 10)) < 1e-6);
});

test('矿工 Armory 维度是背包/镐/移速，倍率按配置派生', () => {
  assert.deepEqual(upgradeStats('miner'), ['bag', 'pick', 'spd']);
  assert.deepEqual(upgradeStats('sword'), ['atk', 'def', 'spd']);
  const lv = { ...freshUpgrades().miner, bag: 1, pick: 1, spd: 1 };
  const b = bonusFor({ miner: lv }, 'miner');
  assert.ok(Math.abs(b.goldMul - (1 + C.economy.bagPerLevel)) < 1e-9);
  assert.ok(Math.abs(b.mineSpeedMul - (1 + C.economy.pickaxePerLevel)) < 1e-9);
  assert.ok(Math.abs(b.speedMul - (1 + C.upgrade.speedPerLevel)) < 1e-9);

  const s = quiet(playing());
  const u = spawnUnit(s, 'miner', 0, { miner: lv });
  assert.ok(Math.abs(u.goldPerTrip - C.economy.goldPerTrip * b.goldMul) < 1e-9);
  assert.ok(Math.abs(u.mineDuration - C.economy.mineDurationSec / b.mineSpeedMul) < 1e-9);
  assert.ok(Math.abs(u.speed - C.units.miner.speedPxPerSec * b.speedMul) < 1e-9);
});

test('难度放大敌方雕像血量与 AI 收入，重开后保留难度', () => {
  const normal = quiet(playing('normal'));
  const insane = quiet(playing('insane'));
  assert.equal(normal.enemyHp, C.match.statueHp);
  assert.equal(insane.enemyHp, C.match.statueHp * C.match.difficulties.insane.enemyStatueMul);
  run(normal, 10);
  run(insane, 10);
  const nInc = normal.aiGold - C.economy.aiStartGold;
  const iInc = insane.aiGold - C.economy.aiStartGold;
  assert.ok(Math.abs(iInc / nInc - C.match.difficulties.insane.aiIncomeMul) < 1e-6,
    `收入倍率 ${iInc / nInc}`);

  assert.equal(setDifficulty(insane, 'hard'), true);
  resetMatch(insane);
  assert.equal(insane.difficulty, 'hard');
  assert.equal(insane.enemyHp, C.match.statueHp * C.match.difficulties.hard.enemyStatueMul);
  assert.equal(setDifficulty(insane, 'nope'), false);
});
