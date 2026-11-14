import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixedStepDriver } from '../src/timing.js';

const FIXED = 1 / 60;

function drive(frames, frameDelta) {
  let steps = 0;
  const d = createFixedStepDriver(FIXED, 0.1, () => steps++);
  for (let i = 0; i < frames; i++) d.advance(frameDelta);
  return steps;
}

test('30/60/144Hz 驱动同样的 2 秒，逻辑步数一致', () => {
  assert.equal(drive(60, 1 / 30), 120);
  assert.equal(drive(120, 1 / 60), 120);
  const hi = drive(288, 1 / 144);
  assert.ok(Math.abs(hi - 120) <= 1, `144Hz 得到 ${hi} 步`);
});

test('刷新率不决定游戏速度：144Hz 不会比 30Hz 多跑逻辑', () => {
  assert.ok(Math.abs(drive(288, 1 / 144) - drive(60, 1 / 30)) <= 1);
});

test('单次掉帧被 clamp，不会补跑上百步造成死亡螺旋', () => {
  let steps = 0;
  const d = createFixedStepDriver(FIXED, 0.1, () => steps++);
  d.advance(5);
  assert.ok(steps >= 5 && steps <= 6, `实际 ${steps} 步`);
});

test('reset 丢弃未消费的余量', () => {
  let steps = 0;
  const d = createFixedStepDriver(FIXED, 0.1, () => steps++);
  d.advance(FIXED * 0.9);
  d.reset();
  d.advance(FIXED * 0.9);
  assert.equal(steps, 0);
});
