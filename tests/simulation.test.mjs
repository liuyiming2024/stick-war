import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createState, resetMatch, spawnUnit, countTeam } from '../src/state.js';
import { createRng } from '../src/rng.js';
import { step, spawnPlayer, doUpgrade, setMode } from '../src/simulation.js';

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
  assert.equal(a.gold, b.gold);
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
  run(d, 3.0, 1 / 60);
  assert.equal(d.stats.aiSpawned, 0, '3 秒短于首个出兵间隔');
  run(d, 0.5, 1 / 60);
  assert.ok(d.stats.aiSpawned >= 1, '出兵由秒级计时器驱动，而非每帧随机');
});

test('矿工真的往返运钱，而不是站着刷随机数', () => {
  const s = quiet(playing());
  s.gold = 1000;
  spawnPlayer(s, 'miner');
  const start = s.gold;
  run(s, 30, 1 / 60);
  assert.ok(s.stats.trips >= 2, `实际完成 ${s.stats.trips} 趟`);
  assert.equal(s.gold, start + s.stats.trips * C.economy.goldPerTrip);
  assert.ok(['toMine', 'mining', 'toHome'].includes(s.units[0].job));
});

test('矿工不参与攻击：不会把敌人的受击闪白每帧重置', () => {
  const s = quiet(playing());
  spawnPlayer(s, 'miner');
  const enemy = spawnUnit(s, 'sword', 1, null);
  enemy.x = s.units[0].x + 5;
  enemy.hitFlash = 0;
  run(s, 0.5, 1 / 60);
  assert.equal(enemy.hitFlash, 0);
  assert.equal(s.units.find((u) => u.kind === 'miner').dmg, 0);
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
