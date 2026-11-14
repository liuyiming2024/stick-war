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
