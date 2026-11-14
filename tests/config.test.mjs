import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONFIG, UNIT_ORDER } from '../src/config.js';

const raw = JSON.parse(await readFile(new URL('../config/game.json', import.meta.url), 'utf8'));

test('生成文件与配置源完全一致（npm run build 无漂移）', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(CONFIG)), raw);
});

test('每个兵种的数值字段齐备且时间单位合法', () => {
  assert.equal(UNIT_ORDER.length, 7);
  for (const key of UNIT_ORDER) {
    const u = raw.units[key];
    assert.ok(u.speedPxPerSec > 0, `${key} 速度必须 > 0`);
    assert.ok(u.hp > 0 && u.cost > 0, `${key} 血量/造价必须 > 0`);
    if (u.kind === 'miner') {
      assert.equal(u.attackIntervalSec, 0);
    } else {
      assert.ok(u.attackIntervalSec > 0, `${key} 攻击间隔必须 > 0 且单位为秒`);
      assert.ok(u.dmg > 0, `${key} 伤害必须 > 0`);
    }
    assert.ok(u.desc && u.name, `${key} 缺少展示文案`);
  }
});

test('固定步长与掉帧上限配置合理', () => {
  assert.ok(raw.match.fixedStep > 0 && raw.match.fixedStep <= 1 / 30);
  assert.ok(raw.match.maxFrameDelta >= raw.match.fixedStep * 3);
  assert.ok(raw.ai.spawnIntervalMinSec > 0);
  assert.ok(raw.ai.spawnIntervalSec >= raw.ai.spawnIntervalMinSec);
});

test('雕像判定半径是绘制与伤害共用的同一个值', () => {
  assert.ok(raw.layout.statueHitRadius > 0);
  assert.ok(raw.layout.statueInset > 0);
  assert.ok(raw.economy.mineDurationSec > 0);
});

test('双侧各有多个矿点，且都靠近自家阵地', () => {
  const mines = raw.layout.goldMines;
  assert.ok(mines.length >= 4, '不能退化成中央单矿');
  for (const side of [0, 1]) {
    const own = mines.filter((m) => m.side === side);
    assert.ok(own.length >= 2, `side=${side} 至少两个矿点`);
    for (const m of own) {
      const nearOwn = side === 0 ? m.xRatio < 0.5 : m.xRatio > 0.5;
      assert.ok(nearOwn, `side=${side} 的矿点 ${m.xRatio} 不在自家半场`);
    }
  }
  const xs = mines.map((m) => m.xRatio);
  assert.deepEqual(xs, [...xs].sort((a, b) => a - b), '矿点应按 x 递增排列');
});

test('素材两段式超时与金矿形象比例可配置', () => {
  assert.ok(raw.assets.hardTimeoutSec > raw.assets.softTimeoutSec);
  assert.ok(raw.layout.goldMineHeightRatio > 0);
  assert.ok(raw.layout.goldMineWidthRatio > 0);
  assert.ok(raw.presentation.mineGlow && raw.presentation.mineShadow);
  assert.match(raw.meta.version, /^\d+\.\d+\.\d+$/);
});
