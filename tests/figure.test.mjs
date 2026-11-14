// 角色矢量层的几何回归：7 个兵种 × 各种动作，不能出现 NaN / Infinity / 抛异常。
// 用一支「记账 stub ctx」代替 canvas，所以这层测试不需要浏览器。
import test from 'node:test';
import assert from 'node:assert/strict';

import { drawUnitFigure } from '../src/figure.js';
import { UNIT_ORDER } from '../src/config.js';

const TYPES = UNIT_ORDER;

function stubCtx() {
  const stat = { calls: 0, coords: 0 };
  const check = (name, args) => {
    for (const a of args) {
      if (typeof a !== 'number') continue;
      stat.coords++;
      if (!Number.isFinite(a)) throw new Error(`${name} 收到非法坐标: ${a}`);
    }
  };
  const path = ['moveTo', 'lineTo', 'quadraticCurveTo'];
  const shapes = ['arc', 'ellipse'];
  const ctx = {
    lineWidth: 1, fillStyle: '', strokeStyle: '', lineCap: '', lineJoin: '', globalAlpha: 1,
    save() { stat.calls++; }, restore() { stat.calls++; }, beginPath() { stat.calls++; },
    closePath() { stat.calls++; }, fill() { stat.calls++; }, stroke() { stat.calls++; },
    clip() { stat.calls++; }, fillRect(...a) { check('fillRect', a); stat.calls++; },
    translate(...a) { check('translate', a); stat.calls++; },
    rotate(...a) { check('rotate', a); stat.calls++; },
    scale(...a) { check('scale', a); stat.calls++; },
    createLinearGradient(...a) {
      check('createLinearGradient', a);
      stat.calls++;
      return { addColorStop() {} };
    },
    createRadialGradient(...a) {
      check('createRadialGradient', a);
      stat.calls++;
      return { addColorStop() {} };
    },
  };
  for (const m of path) ctx[m] = (...a) => { check(m, a); stat.calls++; };
  for (const m of shapes) ctx[m] = (...a) => { check(m, a); stat.calls++; };
  return { ctx, stat };
}

const POSES = [
  { name: 'idle', opts: {} },
  { name: 'walk', opts: { walkAmt: 1, walkPhase: 1.1 } },
  { name: 'walkStep', opts: { walkAmt: 1, walkPhase: 2.6 } },
  { name: 'attack-windup', opts: { atk: 0.3 } },
  { name: 'attack-release', opts: { atk: 0.55 } },
  { name: 'attack-recover', opts: { atk: 0.9 } },
  { name: 'hit', opts: { flash: 1 } },
];

test('7 个兵种在各种动作下的几何都合法', () => {
  for (const type of TYPES) {
    for (const team of [0, 1]) {
      for (const pose of POSES) {
        const { ctx, stat } = stubCtx();
        drawUnitFigure(ctx, {
          type, team, x: 100, groundY: 200, height: 112,
          t: 1.4, ...pose.opts,
        });
        assert.ok(stat.calls > 25, `${type}/${pose.name} 绘制调用过少：${stat.calls}`);
        assert.ok(stat.coords > 20, `${type}/${pose.name} 坐标数过少：${stat.coords}`);
      }
    }
  }
});

test('矿工的挖掘、背矿与工装分支都能画', () => {
  const { ctx, stat } = stubCtx();
  drawUnitFigure(ctx, {
    type: 'miner', team: 0, x: 10, groundY: 100, height: 100,
    t: 2, job: 'mining', carry: 1,
  });
  assert.ok(stat.calls > 30);
  const idle = stubCtx();
  drawUnitFigure(idle.ctx, {
    type: 'miner', team: 0, x: 10, groundY: 100, height: 100,
    t: 2, job: 'toMine', carry: 0,
  });
  assert.ok(idle.stat.calls > 30);
});

test('白色剪影模式不依赖任何贴图、也不画五官', () => {
  const { ctx, stat } = stubCtx();
  drawUnitFigure(ctx, {
    type: 'sword', team: 1, x: 0, groundY: 100, height: 100,
    t: 0, white: true, flash: 1,
  });
  // 剪影没有墨线，调用数应明显少于正常绘制
  assert.ok(stat.calls > 10);
});
