import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createState, resetMatch, spawnUnit, countTeam } from '../src/state.js';
import { createRng } from '../src/rng.js';
import { step, spawnPlayer, doUpgrade, setMode, minePositions, chooseMineIndex } from '../src/simulation.js';

const C = CONFIG;
const playing = (w = 800, h = 600) => {
  const s = createState(w, h);
  s.phase = 'playing';
  return s;
};
const run = (s, seconds, dt, seed = 7) => {
  const rng = createRng(seed);
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) step(s, dt, rng);
};
const quiet = (s) => { s.limits.aiPopMax = 0; return s; };

test('step 对 dt 线性一致：60 步/秒 与 120 步/秒 得到同一份矿工经济', () => {
  const mk = () => {
    const s = quiet(playing());
    assert.equal(spawnPlayer(s, 'miner').ok, true);
    return s;
  };
  const a = mk(), b = mk();
  run(a, 12, 1 / 60);
  run(b, 12, 1 / 120);
  assert.equal(a.stats.trips, b.stats.trips);
  assert.ok(a.stats.trips >= 1, '12 秒内至少完成一趟运矿');
  assert.ok(Math.abs(a.gold - b.gold) < 1e-6, `金币差 ${Math.abs(a.gold - b.gold)}`);
  assert.equal(a.units.length, b.units.length);
  assert.ok(Math.abs(a.elapsed - b.elapsed) < 1e-9);
  assert.ok(Math.abs(a.units[0].mineTimer - b.units[0].mineTimer) < 1e-9);
  // 离散事件（挖掘完成 / 交付）在不同 dt 下可能落在相邻的一步，
  // 因此行进位置允许差一个逻辑步的距离，经济结果必须完全一致。
  assert.ok(Math.abs(a.units[0].x - b.units[0].x) < 1.2,
    `位置差 ${Math.abs(a.units[0].x - b.units[0].x).toFixed(3)}px`);
});

test('时间量全部按秒缩放：位移、冷却、AI 出兵都不再按帧计', () => {
  const mk = () => quiet(playing());
  const a = mk(), b = mk();
  const ua = spawnUnit(a, 'sword', 0, null);
  const ub = spawnUnit(b, 'sword', 0, null);
  const x0 = ua.x;
  step(a, 0.5, createRng(3));
  step(b, 1.0, createRng(3));
  assert.ok(Math.abs((ub.x - x0) - 2 * (ua.x - x0)) < 1e-9, '位移应与 dt 成正比');

  const c = mk();
  const uc = spawnUnit(c, 'archer', 0, null);
  uc.attackCd = 1;
  step(c, 0.25, createRng(3));
  assert.ok(Math.abs(uc.attackCd - 0.75) < 1e-9);
  step(c, 0.25, createRng(3));
  assert.ok(Math.abs(uc.attackCd - 0.5) < 1e-9);

  const d = playing();
  d.aiGold = 100000;
  step(d, 1 / 60, createRng(3));
  assert.equal(d.training.length, 0, '单帧不应触发 AI 决策');
  run(d, C.ai.decisionIntervalSec - 0.05, 1 / 60);
  assert.equal(d.training.length, 0, '未到决策间隔不应下单');
  run(d, 0.1, 1 / 60);
  assert.ok(d.training.length >= 1, 'AI 下单由秒级决策计时器驱动，而非每帧随机');
  assert.equal(d.training[0].team, 1);
});

test('矿工真的往返运钱，而不是站着刷随机数', () => {
  const s = quiet(playing());
  s.gold = 1000;
  const miner = spawnUnit(s, 'miner', 0, null);
  const start = s.gold;
  run(s, 30, 1 / 60);
  assert.ok(s.stats.trips >= 2, `实际完成 ${s.stats.trips} 趟`);
  const expected = start + C.economy.castleGoldPerSec * s.elapsed +
    s.stats.trips * C.economy.goldPerTrip;
  assert.ok(Math.abs(s.gold - expected) < 1e-6, `金币 ${s.gold} 应等于 ${expected}`);
  assert.ok(['toMine', 'mining', 'toHome'].includes(miner.job));
});

test('矿工不参与攻击：不会把敌人的受击闪白每帧重置', () => {
  const s = quiet(playing());
  const miner = spawnUnit(s, 'miner', 0, null);
  const enemy = spawnUnit(s, 'sword', 1, null);
  enemy.x = miner.x + 5;
  enemy.hitFlash = 0;
  run(s, 0.5, 1 / 60);
  assert.equal(enemy.hitFlash, 0);
  assert.equal(miner.dmg, 0);
});

test('胜负状态机：终局只触发一次，之后不再推进模拟', () => {
  for (const [field, result] of [['homeHp', 'lost'], ['enemyHp', 'won']]) {
    const s = playing();
    s[field] = 0;
    const events = step(s, 1 / 60, createRng(1));
    assert.equal(s.phase, result);
    assert.ok(events.some((e) => e.type === 'end' && e.result === result));
    const snapshot = { gold: s.gold, elapsed: s.elapsed, units: s.units.length };
    assert.deepEqual(step(s, 1 / 60, createRng(1)), []);
    assert.equal(s.gold, snapshot.gold);
    assert.equal(s.elapsed, snapshot.elapsed);
    assert.equal(s.units.length, snapshot.units);
  }
});

test('AI 受人口上限约束，不会再无限堆兵', () => {
  const s = playing();
  s.limits.aiPopMax = 2;
  s.aiGold = 100000;
  run(s, 120, 1 / 60);
  assert.ok(s.stats.aiSpawned >= 1, 'AI 确实出过兵');
  assert.ok(countTeam(s, 1) <= 2, `敌方实际 ${countTeam(s, 1)} 个单位`);
});

test('重开一局会清空升级等级与金币', () => {
  const s = playing();
  s.gold = 1000;
  assert.equal(doUpgrade(s, 'sword', 'atk').ok, true);
  assert.equal(s.upgrades.sword.atk, 1);
  resetMatch(s);
  assert.equal(s.upgrades.sword.atk, 0);
  assert.equal(s.gold, C.match.startingGold);
  assert.equal(s.phase, 'menu');
  assert.equal(s.w, 800);
  assert.equal(s.h, 600);
});

test('雕像绘制与伤害共用同一条判定线', () => {
  const s = quiet(playing());
  const line = s.w - C.layout.statueInset - C.layout.statueHitRadius;
  const u = spawnUnit(s, 'sword', 0, null);
  u.x = line - 3;
  const before = s.enemyHp;
  step(s, 1 / 60, createRng(1));
  assert.equal(s.enemyHp, before, '线外不该隔空拆雕像');
  u.x = line + 1;
  u.statueCd = 0;
  step(s, 1 / 60, createRng(1));
  assert.ok(s.enemyHp < before, '越线后才扣血');
});

test('出兵校验：金币、人口、对局状态三重约束', () => {
  const s = playing();
  s.gold = 10;
  s.gems = 0;  // v2.9：关掉宝石抵扣，才能单独验证「纯金币不足」
  assert.equal(spawnPlayer(s, 'sword').ok, false);
  s.gold = 1000;
  s.limits.popMax = 1;
  assert.equal(spawnPlayer(s, 'sword').ok, true);
  assert.equal(spawnPlayer(s, 'miner').ok, false);
  s.phase = 'menu';
  s.limits.popMax = 20;
  assert.equal(spawnPlayer(s, 'miner').ok, false);
});

test('升级受单价与等级上限约束', () => {
  const s = playing();
  s.gold = C.upgrade.cost * (C.upgrade.maxLevel + 1);
  for (let i = 0; i < C.upgrade.maxLevel; i++) assert.equal(doUpgrade(s, 'giant', 'def').ok, true);
  assert.equal(s.upgrades.giant.def, C.upgrade.maxLevel);
  assert.equal(doUpgrade(s, 'giant', 'def').ok, false);
  assert.equal(setMode(s, 'attack'), true);
  assert.equal(s.gameMode, 'attack');
  assert.equal(setMode(s, 'nonsense'), false);
  assert.equal(s.gameMode, 'attack');
});

test('远程兵发射真实投射物：飞行途中不扣血，命中后才结算', () => {
  const s = quiet(playing());
  const a = spawnUnit(s, 'archer', 0, null);
  const e = spawnUnit(s, 'sword', 1, null);
  a.x = 300; e.x = 380;
  step(s, 1 / 60, createRng(11));
  assert.equal(s.projectiles.length, 1, '应生成一枚箭矢');
  assert.equal(e.hp, e.maxHp, '箭矢飞行途中不能提前扣血');
  run(s, 0.5, 1 / 60, 11);
  assert.ok(e.hp < e.maxHp, '命中后才扣血');
  assert.equal(s.projectiles.length, 0, '命中后投射物被清理');
});

test('目标在飞行中死亡时投射物落空，不误伤旁边单位', () => {
  const s = quiet(playing());
  const a = spawnUnit(s, 'archer', 0, null);
  const e1 = spawnUnit(s, 'sword', 1, null);
  const e2 = spawnUnit(s, 'spear', 1, null);
  a.x = 300; e1.x = 380; e2.x = 430;
  step(s, 1 / 60, createRng(5));
  assert.equal(s.projectiles.length, 1);
  e1.hp = 0;
  const hp2 = e2.hp;
  run(s, 1.0, 1 / 60, 5);
  assert.equal(s.projectiles.length, 0);
  assert.equal(e2.hp, hp2, '死目标的箭不应转移给旁边的单位');
});

test('AI 兵种按解锁时间开放，且发育期结束才按波次出兵', () => {
  const s = playing();
  s.aiGold = 1e6;
  s.homeHp = 1e9;
  s.limits.aiPopMax = 1000;
  run(s, 10, 1 / 60, 3);
  assert.equal(s.aiPhase, 'build', '10 秒应仍在发育期');
  assert.equal(s.units.filter((u) => u.team === 1 && u.kind !== 'miner').length, 0,
    'buildMinSec 之前不该出战斗兵');
  assert.ok(s.stats.aiMinersTrained >= C.ai.minerTargetStart,
    `开局应先补矿工，实际只训练了 ${s.stats.aiMinersTrained} 个`);
  run(s, 50, 1 / 60, 3);
  const fighters = s.units.filter((u) => u.team === 1 && u.kind !== 'miner').map((u) => u.type);
  assert.ok(fighters.every((t) => ['sword', 'spear', 'archer'].includes(t)),
    `不该出现未解锁兵种: ${fighters}`);
  assert.ok(s.stats.aiSpawned >= 4,
    `60 秒内应已集结出兵 ${s.stats.aiSpawned} 次`);
  assert.ok(s.stats.aiWaves >= 1, '应至少发起过一次进攻波次');
});

test('对局统计随模拟累加，重开后归零', () => {
  const s = quiet(playing());
  s.gold = 1000;
  spawnUnit(s, 'miner', 0, null);
  spawnUnit(s, 'sword', 0, null);
  assert.equal(s.stats.playerSpawned, 2);
  run(s, 30, 1 / 60);
  assert.ok(s.stats.trips >= 2, `实际运矿 ${s.stats.trips} 趟`);
  assert.equal(s.stats.aiSpawned, 0);
  assert.ok(s.gold > 1000, '城堡被动收入也应计入');
  resetMatch(s);
  assert.equal(s.stats.trips, 0);
  assert.equal(s.stats.playerSpawned, 0);
  assert.equal(s.stats.trained, 0);
  assert.equal(s.training.length, 0);
});

test('六个矿点坐标由配置生成，两侧各三且渲染/逻辑共用', () => {
  const s = playing(1000, 600);
  const mines = minePositions(s);
  assert.equal(mines.length, C.layout.goldMines.length);
  assert.equal(mines.filter((m) => m.side === 0).length, 3);
  assert.equal(mines.filter((m) => m.side === 1).length, 3);
  for (const [i, m] of mines.entries()) assert.equal(m.x, s.w * C.layout.goldMines[i].xRatio);
  assert.ok(mines.every((m) => m.x > 0 && m.x < s.w));
});

test('矿工只去自家半场的矿，多人会分散到不同矿点', () => {
  const s = quiet(playing(1000, 600));
  assert.ok(chooseMineIndex(s, 0, 120) >= 0);
  const left = minePositions(s).filter((m) => m.side === 0).map((m) => m.index);
  const right = minePositions(s).filter((m) => m.side === 1).map((m) => m.index);
  assert.ok(left.includes(chooseMineIndex(s, 0, 120)));
  assert.ok(right.includes(chooseMineIndex(s, 1, 880)));

  s.gold = 1000;
  for (let i = 0; i < 4; i++) spawnUnit(s, 'miner', 0, null);
  step(s, 1 / 60, createRng(9));
  const assigned = s.units.map((u) => u.mineIndex);
  assert.ok(assigned.every((i) => left.includes(i)), '我方矿工不得跨半场挖敌方矿');
  assert.ok(new Set(assigned).size >= 2, `4 个矿工分散到了 ${new Set(assigned).size} 个矿点`);
});

test('双侧矿工都能形成经济闭环，不依赖中央矿', () => {
  const s = quiet(playing(1000, 600));
  s.gold = 1000;
  const own = spawnUnit(s, 'miner', 0, null);
  const foe = spawnUnit(s, 'miner', 1, null);
  const rng = createRng(7);
  let playerGold = 0, aiMineGold = 0;
  for (let i = 0; i < 1200; i++) {
    for (const e of step(s, 1 / 60, rng)) {
      if (e.type === 'gold') (e.team === 0 ? (playerGold += e.amount) : (aiMineGold += e.amount));
    }
  }
  assert.ok(s.stats.trips >= 2, `实际交付 ${s.stats.trips} 趟`);
  assert.ok(playerGold > 0 && aiMineGold > 0,
    `双方矿工都应交付：我方 ${playerGold} / 敌方 ${aiMineGold}`);
  assert.ok(own.hp > 0 && foe.hp > 0);
});
