import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG as C, UNIT_ORDER } from '../src/config.js';
import { createState, spawnUnit, resetMatch } from '../src/state.js';
import { createRng } from '../src/rng.js';
import { step, aiGrowthInfo, aiCounterWeight, minePositions, minerHomeX } from '../src/simulation.js';

const playing = (w = C.world.width, h = C.world.height, difficulty = 'normal') => {
  const s = createState(w, h, difficulty);
  s.phase = 'playing';
  return s;
};
const quiet = (s) => { s.limits.aiPopMax = 0; return s; };
const run = (s, seconds, dt = 1 / 60, seed = 7) => {
  const rng = createRng(seed);
  for (let i = 0; i < Math.round(seconds / dt); i++) step(s, dt, rng);
};

// ── 固定逻辑世界与窄屏视口 ──────────────────────────────────────────────

test('默认状态使用固定世界尺寸，测试仍可显式传入旧尺寸', () => {
  const s = createState();
  assert.equal(s.w, C.world.width);
  assert.equal(s.h, C.world.height);
  assert.equal(s.view.x, 0);
  assert.equal(s.view.follow, true);
  assert.equal(s.view.followAnchor, C.world.followAnchorRatio);
  const legacy = createState(800, 600);
  assert.equal(legacy.w, 800);
  assert.equal(legacy.h, 600);
  assert.equal(legacy.view.viewW, 800);
});

test('窄屏视口只显示世界的一段，且世界尺寸不随屏幕改写', () => {
  const s = playing();
  const cssW = 390, cssH = 620, dpr = 3;
  const scale = Math.min(C.world.maxScale, Math.max(C.world.minScale, cssH / C.world.height));
  const viewW = cssW / scale;
  const maxX = Math.max(0, C.world.width - viewW);
  Object.assign(s.view, { scale, viewW, viewH: cssH / scale, cssW, cssH, dpr, maxX,
    offsetY: Math.max(0, (cssH - C.world.height * scale) / 2) });
  assert.equal(s.w, C.world.width, 'resize 不能改逻辑世界宽度');
  assert.ok(viewW < C.world.width * 0.6, `窄屏视口 ${viewW} 应远小于世界宽度`);
  assert.ok(maxX > 0, '必须有可平移的空间');
  assert.ok(scale >= C.world.minScale && scale <= C.world.maxScale);
  // 单位高度在 CSS 像素里要保持可读，不能因为压缩整场而变成几像素
  const unitCss = s.h * C.layout.unitHeightRatio * scale;
  assert.ok(unitCss >= 55, `单位屏幕高度 ${unitCss.toFixed(1)}px 太小`);
});

// ── 矿点与回营点拉开距离 ────────────────────────────────────────────────

test('矿点不再贴着雕像：双侧都满足最短运矿距离且不过中线', () => {
  // 生产环境只用 world.width；statueInset / statueHitRadius 是绝对像素，
  // 旧单测里的 800×600 是遗留尺寸，不参与「最短运矿距离」这个口径。
  const s = createState(C.world.width, C.world.height);
  const mines = minePositions(s);
  for (const m of mines) {
    const dist = Math.abs(m.x - minerHomeX(s, m.side));
    assert.ok(dist >= s.w * C.economy.minMineHomeDistanceRatio,
      `side=${m.side} 距回营 ${dist.toFixed(0)}px 太近`);
    if (m.side === 0) assert.ok(m.x < s.w * 0.5, '我方矿点越过中线');
    else assert.ok(m.x > s.w * 0.5, '敌方矿点越过中线');
  }
  assert.equal(mines.filter((m) => m.side === 0).length, 3);
  assert.equal(mines.filter((m) => m.side === 1).length, 3);
});

test('矿工一趟往返真的要走一段路，不是挖到就回营', () => {
  const s = quiet(playing());
  const u = spawnUnit(s, 'miner', 0, null);
  const home = minerHomeX(s, 0);
  const mineX = minePositions(s).find((m) => m.side === 0).x;
  assert.ok(Math.abs(mineX - home) > s.w * C.economy.minMineHomeDistanceRatio);
  run(s, 1.0);
  assert.equal(u.job, 'toMine', '1 秒内不可能已经挖完并交付');
  assert.equal(s.stats.trips, 0);
  // 生产世界单程 ≈ (0.26-0.0836)*1600 ≈ 282px，去 66px/s、回 47.5px/s、
  // 加挖掘 1.6s，一趟约 11.8s；40 秒足够跑完至少两趟。
  run(s, 40);
  assert.ok(s.stats.trips >= 2, `40 秒应完成至少两趟，实际 ${s.stats.trips}`);
  assert.ok(u.x >= home - 1, '矿工不能越过自家雕像');
});

test('负重时移速按 carrySpeedMul 下降，卸载后恢复', () => {
  assert.ok(C.economy.carrySpeedMul > 0 && C.economy.carrySpeedMul < 1);
  const s = quiet(playing());
  const a = spawnUnit(s, 'miner', 0, null);
  const b = spawnUnit(s, 'miner', 0, null);
  // 站远一点，避免 separate() 的推挤污染位移测量
  a.job = 'toHome'; a.carry = C.economy.goldPerTrip; a.x = 600;
  b.job = 'toHome'; b.carry = 0; b.x = 900;
  const xa = a.x, xb = b.x;
  step(s, 1 / 60, createRng(1));
  const da = xa - a.x, db = xb - b.x;
  assert.ok(Math.abs(db - b.speed / 60) < 1e-9, '空载单位应走满一个步长');
  assert.ok(da > 0 && db > 0);
  assert.ok(Math.abs(da / db - C.economy.carrySpeedMul) < 1e-9,
    `负重/空载位移比 ${da / db}`);
});

// ── 针对性反制 ──────────────────────────────────────────────────────────

test('玩家堆剑士时 AI 抬弓箭手权重，堆远程时抬矛士/巨人', () => {
  const s = quiet(playing());
  const base = C.units.archer.aiWeight;
  assert.equal(aiCounterWeight(s, 'archer'), base, '没有玩家单位时不该改权重');
  for (let i = 0; i < C.ai.counterSaturation; i++) {
    const u = spawnUnit(s, 'sword', 0, null);
    u.x = 300 + i * 4;
  }
  const boosted = aiCounterWeight(s, 'archer');
  assert.ok(boosted > base * 1.5, `应明显抬权：${base} → ${boosted}`);
  // 饱和：再堆一倍的剑士，权重不再线性上涨
  for (let i = 0; i < C.ai.counterSaturation * 2; i++) {
    const u = spawnUnit(s, 'sword', 0, null);
    u.x = 300 + i * 4;
  }
  assert.ok(Math.abs(aiCounterWeight(s, 'archer') - boosted) < 1e-9, '克制权重应有饱和上限');

  const s2 = quiet(playing());
  const baseSpear = C.units.spear.aiWeight;
  for (let i = 0; i < 3; i++) spawnUnit(s2, 'archer', 0, null);
  assert.ok(aiCounterWeight(s2, 'spear') > baseSpear, '玩家堆弓箭手应抬矛士');
  assert.ok(aiCounterWeight(s2, 'giant') > C.units.giant.aiWeight, '玩家堆弓箭手应抬巨人');
});

test('counterMatrix 三元组全部合法，不出现自我克制', () => {
  for (const [a, p, mul] of C.ai.counterMatrix) {
    assert.ok(C.units[a] && C.units[p], `未知兵种 ${a}/${p}`);
    assert.ok(mul > 0 && a !== p);
    assert.ok(C.units[a].kind !== 'miner', '克制矩阵不该含矿工');
  }
  assert.ok(UNIT_ORDER.length === 7);
});

// ── 波次指挥 ────────────────────────────────────────────────────────────

test('AI 阶段按 build → muster → assault → regroup 流转并发起进攻', () => {
  const s = playing();
  s.homeHp = 1e9;
  s.aiGold = 1e6;
  s.limits.aiPopMax = 1000;
  assert.equal(s.aiPhase, 'build');
  run(s, 10);
  assert.equal(s.aiPhase, 'build', '发育期结束前不集结');
  assert.equal(s.units.filter((u) => u.team === 1 && u.kind !== 'miner').length, 0,
    'build 阶段不该有战斗兵');
  run(s, 110);
  const g = aiGrowthInfo(s);
  assert.ok(g.phaseChanges >= 4, `阶段切换 ${g.phaseChanges} 次`);
  assert.ok(g.waves >= 1, `进攻波次 ${g.waves}`);
  assert.ok(g.maxWaveSize >= C.ai.wave.firstWaveSize);
  assert.ok(s.stats.aiSpawned >= C.ai.wave.firstWaveSize,
    `出兵 ${s.stats.aiSpawned} 应至少凑满第一波`);
  assert.ok(['assault', 'regroup', 'muster'].includes(s.aiPhase));
});

test('波容随波次递增且有上限，不无限膨胀', () => {
  const s = playing();
  s.homeHp = 1e9; s.aiGold = 1e6; s.limits.aiPopMax = 1000;
  run(s, 240);
  assert.ok(s.aiWaveIndex >= 2, `波次序号 ${s.aiWaveIndex}`);
  assert.equal(s.aiWaveSize,
    Math.min(C.ai.wave.maxWaveSize,
      C.ai.wave.firstWaveSize + s.aiWaveIndex * C.ai.wave.waveSizeGrowth));
  assert.ok(s.stats.aiMaxWaveSize <= C.ai.wave.maxWaveSize);
});

test('波次状态按秒推进，60Hz 与 120Hz 完全一致', () => {
  const a = playing(), b = playing();
  for (const s of [a, b]) { s.homeHp = 1e9; s.aiGold = 1e6; s.limits.aiPopMax = 1000; }
  run(a, 100, 1 / 60, 11);
  run(b, 100, 1 / 120, 11);
  assert.equal(a.aiPhase, b.aiPhase);
  assert.equal(a.aiWaveIndex, b.aiWaveIndex);
  assert.equal(a.aiWaveSize, b.aiWaveSize);
  assert.equal(a.stats.aiWaves, b.stats.aiWaves);
  assert.equal(a.stats.aiPhaseChanges, b.stats.aiPhaseChanges);
  // 不同 dt 下 elapsed 浮点累加会在某个决策 tick 的边界上差一步，
  // 科技购买数允许差 1（生产环境固定 1/60，不存在这个边界）。
  assert.ok(Math.abs(a.stats.aiUpgrades - b.stats.aiUpgrades) <= 1,
    `科技数 ${a.stats.aiUpgrades} vs ${b.stats.aiUpgrades}`);
});

test('重开清空波次状态但保留难度', () => {
  const s = playing(C.world.width, C.world.height, 'hard');
  s.homeHp = 1e9; s.aiGold = 1e6;
  run(s, 120);
  assert.ok(s.aiWaveIndex > 0 || s.stats.aiWaves > 0);
  resetMatch(s);
  assert.equal(s.difficulty, 'hard');
  assert.equal(s.aiPhase, 'build');
  assert.equal(s.aiWaveIndex, 0);
  assert.equal(s.aiWaveSize, C.ai.wave.firstWaveSize);
  assert.equal(s.aiPhaseSince, 0);
  assert.equal(s.stats.aiWaves, 0);
  assert.equal(s.stats.aiPhaseChanges, 0);
  assert.equal(s.view.x, 0);
});
