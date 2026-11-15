import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG as C } from '../src/config.js';
import { createState, spawnUnit, resetMatch } from '../src/state.js';
import { createRng } from '../src/rng.js';
import {
  step, selectChampion, releaseChampion, setControlAxis,
  championInfo, setMode,
} from '../src/simulation.js';

const playing = () => {
  const s = createState();
  s.phase = 'playing';
  s.limits.aiPopMax = 0;   // 隔离 AI，避免敌方单位干扰位移断言
  return s;
};
const run = (s, seconds, dt = 1 / 60, seed = 7) => {
  const rng = createRng(seed);
  for (let i = 0; i < Math.round(seconds / dt); i++) step(s, dt, rng);
};

// ── 选中 / 退出 ─────────────────────────────────────────────────────────

test('点战场选中最靠近的我方单位，信息口径一致', () => {
  const s = playing();
  const a = spawnUnit(s, 'sword', 0, null);
  const b = spawnUnit(s, 'archer', 0, null);
  a.x = 300;
  b.x = 900;
  assert.equal(championInfo(s).active, false);
  const r = selectChampion(s, 320);
  assert.equal(r.ok, true);
  assert.equal(r.id, a.id);
  const info = championInfo(s);
  assert.equal(info.active, true);
  assert.equal(info.type, 'sword');
  assert.equal(info.name, C.units.sword.name);
  assert.equal(info.axis, 0);
  assert.equal(s.stats.championSwitches, 1);
});

test('点空处等价于退出指挥，重复选中不重复计切换', () => {
  const s = playing();
  const a = spawnUnit(s, 'sword', 0, null);
  a.x = 300;
  assert.equal(selectChampion(s, 300).ok, true);
  assert.equal(selectChampion(s, 300).ok, true);
  assert.equal(s.stats.championSwitches, 1, '选中同一个单位不算切换');
  const far = selectChampion(s, 300 + C.control.selectRadiusPx + 1);
  assert.equal(far.ok, false);
  assert.equal(championInfo(s).active, false);
  assert.equal(s.control.axis, 0);
});

test('显式释放清空 id 与 axis', () => {
  const s = playing();
  const a = spawnUnit(s, 'sword', 0, null);
  a.x = 300;
  selectChampion(s, 300);
  setControlAxis(s, 1);
  assert.equal(s.control.axis, 1);
  const r = releaseChampion(s);
  assert.equal(r.wasActive, true);
  assert.equal(s.control.championId, null);
  assert.equal(s.control.axis, 0);
  assert.equal(championInfo(s).active, false);
});

// ── 手动移动覆盖自动行为 ────────────────────────────────────────────────

test('接管后不再自动追击/推进，axis=0 时原地不动', () => {
  const s = playing();
  const a = spawnUnit(s, 'sword', 0, null);
  a.x = 200;
  selectChampion(s, 200);
  const x0 = a.x;
  run(s, 2);
  assert.ok(Math.abs(a.x - x0) < 1e-9,
    `未接管时会自己走向 defendLine=${s.w * C.layout.defendLineRatio}，接管后不应移动：${a.x}`);
  assert.equal(championInfo(s).axis, 0);
  assert.ok(Math.abs(championInfo(s).seconds - 2) < 1e-9, '指挥时长按秒累加');
});

test('axis=±1 按 moveSpeedMul 移动，且位移与 dt 成正比', () => {
  const s = playing();
  const a = spawnUnit(s, 'sword', 0, null);
  a.x = 600;
  selectChampion(s, 600);
  const expected = a.speed * C.control.moveSpeedMul;
  setControlAxis(s, 1);
  run(s, 1);
  assert.ok(Math.abs(a.x - 600 - expected) < 1e-6, `右移 ${a.x - 600}，期望 ${expected}`);
  assert.ok(Math.abs(championInfo(s).distance - expected) < 1e-6, '累计手动距离');
  setControlAxis(s, -1);
  run(s, 1);
  assert.ok(Math.abs(a.x - 600) < 1e-6, '反向移动应回到原位');
  assert.ok(Math.abs(championInfo(s).distance - 2 * expected) < 1e-6);
});

test('60Hz 与 120Hz 手动移动结果一致', () => {
  const a = playing(), b = playing();
  for (const s of [a, b]) {
    const u = spawnUnit(s, 'giant', 0, null);
    u.x = 600;
    selectChampion(s, 600);
    setControlAxis(s, 1);
  }
  run(a, 3, 1 / 60, 11);
  run(b, 3, 1 / 120, 11);
  assert.ok(Math.abs(a.units[0].x - b.units[0].x) < 1e-9);
  assert.ok(Math.abs(a.control.distance - b.control.distance) < 1e-9);
  assert.ok(Math.abs(a.control.seconds - b.control.seconds) < 1e-9);
});

test('手动控制优先于驻堡指令', () => {
  const s = playing();
  assert.equal(setMode(s, 'garrison'), true);
  const a = spawnUnit(s, 'sword', 0, null);
  a.x = 300;
  selectChampion(s, 300);
  setControlAxis(s, 1);
  run(s, 1);
  assert.ok(a.x > 300 + 1, `驻堡本应把单位拉回 fortX，接管后应向右：x=${a.x}`);
});

test('矿工被接管时不挖矿、不交付', () => {
  const s = playing();
  const m = spawnUnit(s, 'miner', 0, null);
  selectChampion(s, m.x);
  run(s, 20);
  assert.equal(s.stats.trips, 0, '接管中的矿工不该自动跑完一趟');
  assert.equal(m.job, 'toMine', '阶段机也不该推进');
  releaseChampion(s);
  run(s, 40);
  assert.ok(s.stats.trips >= 2, '释放后恢复自动运矿');
});

// ── 攻击 / 雕像仍自动 ───────────────────────────────────────────────────

test('接管后范围内攻击仍自动，伤害口径与自动单位一致', () => {
  const s = playing();
  const a = spawnUnit(s, 'sword', 0, null);
  const e = spawnUnit(s, 'sword', 1, null);
  a.x = 600;
  e.x = 600 + a.range * 0.5;
  selectChampion(s, 600);
  assert.equal(s.control.axis, 0);
  const hp0 = e.hp;
  run(s, 2);
  assert.ok(e.hp < hp0, '接管单位仍应自动攻击');
  assert.ok(Math.abs(a.x - 600) < 1e-9, '有目标在范围内时不自动追击、也不手动移动');
});

test('接管单位越过雕像线仍按自动口径拆雕像', () => {
  const s = playing();
  const a = spawnUnit(s, 'sword', 0, null);
  const line = s.w - C.layout.statueInset - C.layout.statueHitRadius;
  a.x = line + 1;
  selectChampion(s, a.x);
  const hp0 = s.enemyHp;
  step(s, 1 / 60, createRng(1));
  assert.ok(s.enemyHp < hp0);
  assert.ok(s.fx.enemyShake > 0);
});

// ── 生命周期 ────────────────────────────────────────────────────────────

test('指挥单位阵亡后自动释放并清零输入', () => {
  const s = playing();
  const a = spawnUnit(s, 'sword', 0, null);
  a.x = 300;
  selectChampion(s, 300);
  setControlAxis(s, 1);
  a.hp = 0;
  const events = step(s, 1 / 60, createRng(1));
  assert.ok(events.some((e) => e.type === 'championLost'));
  assert.equal(s.control.championId, null);
  assert.equal(s.control.axis, 0);
  assert.equal(championInfo(s).active, false);
});

test('暂停/菜单状态下 setControlAxis 不留残留输入', () => {
  const s = playing();
  const a = spawnUnit(s, 'sword', 0, null);
  a.x = 300;
  selectChampion(s, 300);
  s.phase = 'paused';
  assert.equal(setControlAxis(s, 1), 0);
  const x0 = a.x;
  step(s, 1 / 60, createRng(1));   // step 在非 playing 直接返回
  assert.equal(a.x, x0);
  s.phase = 'menu';
  assert.equal(setControlAxis(s, -1), 0);
});

test('重开清空指挥状态与统计', () => {
  const s = playing();
  const a = spawnUnit(s, 'sword', 0, null);
  a.x = 300;
  selectChampion(s, 300);
  setControlAxis(s, 1);
  run(s, 3);
  assert.ok(s.control.seconds > 0 && s.control.distance > 0 && s.stats.championSwitches > 0);
  resetMatch(s);
  assert.equal(s.control.championId, null);
  assert.equal(s.control.axis, 0);
  assert.equal(s.control.seconds, 0);
  assert.equal(s.control.distance, 0);
  assert.equal(s.stats.championSwitches, 0);
  assert.equal(s.gems, C.gems.starting);
});

test('配置合法：点击阈值不会把拖动误判成选中', () => {
  assert.equal(C.control.enabled, true);
  assert.ok(C.control.selectRadiusPx > 0);
  assert.ok(C.control.clickMaxSlopPx <= 24);
  assert.ok(C.control.clickMaxMs > 0 && C.control.clickMaxMs < 1000);
  assert.ok(C.control.moveSpeedMul > 0 && C.control.moveSpeedMul <= 3);
  assert.ok(C.presentation.champion && C.presentation.championGlow);
});
