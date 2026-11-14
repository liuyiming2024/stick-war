import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONFIG, UNIT_ORDER } from '../src/config.js';
import { unitSVG, toolSVG, hasExternalResource } from '../src/icons.js';
import { createState, spawnUnit } from '../src/state.js';
import { createRng } from '../src/rng.js';
import { step, setMode } from '../src/simulation.js';

const C = CONFIG;
const playing = (w = 800, h = 600) => {
  const s = createState(w, h);
  s.phase = 'playing';
  return s;
};
const quiet = (s) => { s.limits.aiPopMax = 0; return s; };
const run = (s, seconds, seed = 7) => {
  const rng = createRng(seed);
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) step(s, dt, rng);
};

test('每个兵种与工具按钮都生成自包含内联 SVG', () => {
  for (const key of UNIT_ORDER) {
    const svg = unitSVG(key);
    assert.ok(svg.startsWith('<svg'), `${key} 应为内联 SVG`);
    assert.ok(svg.includes('class="vIcon"'), `${key} 缺少统一图标类`);
    assert.ok(svg.includes('vArmR') && svg.includes('vLegL'), `${key} 缺少可动画骨架`);
    assert.equal(hasExternalResource(svg), false, `${key} 的 SVG 不得引用外部资源`);
  }
  for (const kind of ['shop', 'upgrade']) {
    const svg = toolSVG(kind);
    assert.ok(svg.startsWith('<svg'));
    assert.equal(hasExternalResource(svg), false);
  }
});

test('渲染层不使用墙钟时间、随机源或位图，相位只来自模拟状态', async () => {
  const src = await readFile(new URL('../src/render.js', import.meta.url), 'utf8');
  for (const forbidden of [
    /performance\s*\.\s*now\s*\(/, /Date\s*\.\s*now\s*\(/,
    /Math\s*\.\s*random\s*\(/, /ctx\s*\.\s*filter\b/, /drawImage\s*\(/,
  ]) {
    assert.equal(forbidden.test(src), false, `render.js 不应含 ${forbidden}`);
  }
  for (const required of ['state.elapsed', 'u.walkPhase', 'u.anim', 'p.age', 'state.fx']) {
    assert.ok(src.includes(required), `render.js 应使用相位源 ${required}`);
  }
  const used = Object.keys(C.animation).filter((k) => src.includes(`A.${k}`));
  assert.ok(used.length >= 12, `animation 段只有 ${used.length} 个键被渲染层消费`);
});

test('步态相位只在真正移动时累加，静止时冻结', () => {
  const s = quiet(playing());
  const u = spawnUnit(s, 'sword', 0, null);
  assert.equal(u.x, C.layout.spawnInset);
  run(s, 0.5);
  assert.ok(u.walkPhase > 0, '移动时应累加步态相位');
  assert.equal(u.moving, true);
  run(s, 3);  // 120 → 240 的驻守线，1.2s 左右到达
  const frozen = u.walkPhase;
  assert.equal(u.moving, false, '到达驻守线后应停止');
  run(s, 1);
  assert.equal(u.walkPhase, frozen, '静止单位步态相位不应继续变化');

  const m = quiet(playing());
  const miner = spawnUnit(m, 'miner', 0, null);
  miner.job = 'mining';
  miner.mineTimer = 5;
  const before = miner.walkPhase;
  run(m, 1);
  assert.equal(miner.walkPhase, before, '挖掘时不应摆腿');
});

test('视觉反馈计时器由 step 按秒递减，暂停时完全冻结', () => {
  const s = quiet(playing());
  s.fx.goldBurst = C.animation.goldBurstSec;
  s.fx.homeShake = C.animation.statueShakeSec;
  run(s, 0.2);
  assert.ok(Math.abs(s.fx.goldBurst - (C.animation.goldBurstSec - 0.2)) < 1e-6);
  assert.ok(Math.abs(s.fx.homeShake - (C.animation.statueShakeSec - 0.2)) < 1e-6);

  s.phase = 'paused';
  const frozen = { ...s.fx };
  const elapsed = s.elapsed;
  run(s, 2);
  assert.deepEqual(s.fx, frozen, '暂停时视觉反馈不得推进');
  assert.equal(s.elapsed, elapsed, '暂停时模拟时间不得推进');
});

test('雕像受击与金币交付触发矢量动画反馈', () => {
  const s = quiet(playing());
  const line = s.w - C.layout.statueInset - C.layout.statueHitRadius;
  const u = spawnUnit(s, 'sword', 0, null);
  u.x = line + 1;
  step(s, 1 / 60, createRng(1));
  assert.ok(s.fx.enemyShake > 0, '敌方雕像应抖动');

  const m = quiet(playing());
  const miner = spawnUnit(m, 'miner', 0, null);
  miner.job = 'toHome';
  miner.carry = C.economy.goldPerTrip;
  miner.x = C.layout.statueInset + C.layout.statueHitRadius + 1;
  step(m, 1 / 60, createRng(2));
  assert.ok(m.fx.goldBurst > 0, '交付金币应有迸发动画');
});

test('驻堡时全军回堡且不追击，驻堡状态由逻辑层标记', () => {
  const s = quiet(playing());
  assert.equal(setMode(s, 'garrison'), true);
  const u = spawnUnit(s, 'sword', 0, null);
  u.x = 300;
  run(s, 4);  // 300 → 44.4 需要约 2.5s，留足余量
  assert.ok(u.x <= C.layout.statueInset * C.layout.fortInsetRatio + C.economy.mineArriveEps + 1);
  assert.equal(u.inFort, true);

  // 回堡后再放入敌人：此时起才应完全免疫（路上挨打是合理的）
  const hpInFort = u.hp;
  const foe = spawnUnit(s, 'sword', 1, null);
  foe.x = 320;
  run(s, 2);
  assert.equal(u.hp, hpInFort, '堡内单位应免疫伤害');
});
