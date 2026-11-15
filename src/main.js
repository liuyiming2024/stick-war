import { CONFIG, ASSET_KEYS } from './config.js?v=2.11.0';
import { createState, resetMatch } from './state.js?v=2.11.0';
import { createRng } from './rng.js?v=2.11.0';
import { step, minePositions, setDifficulty, aiGrowthInfo, grantGems,
  selectChampion, releaseChampion, setControlAxis, championInfo,
  setAmmo, effectsInfo } from './simulation.js?v=2.11.0';
import { createAssets } from './assets.js?v=2.11.0';
import { createRenderer } from './render.js?v=2.11.0';
import { createUI } from './ui.js?v=2.11.0';
import { createFixedStepDriver } from './timing.js?v=2.11.0';
import { createAudio } from './audio.js?v=2.11.0';
import { createProgress } from './progress.js?v=2.11.0';

const canvas = document.getElementById('canvas');
const state = createState();
const rng = createRng(Date.now() >>> 0);
const renderer = createRenderer(canvas);
const progress = createProgress(CONFIG.progress.storageKey);
let muted = progress.load().muted;
const audio = createAudio(CONFIG.audio, { isMuted: () => muted });

let last = performance.now();
let started = false;

function refreshLoadTip() {
  const n = assets.missingCount();
  ui.setLoadTip(n ? `${n} 张素材缺失，已启用线稿替身` : '位图素材就绪，可以开战');
  ui.setAssetBadge(assets.count(), ASSET_KEYS.length, n);
}

// 弱网下软超时先放行开战，图片晚到再补登记，不误判成「素材缺失」。
const assets = createAssets({
  softTimeoutMs: CONFIG.assets.softTimeoutSec * 1000,
  hardTimeoutMs: CONFIG.assets.hardTimeoutSec * 1000,
  onChange: () => { if (started) refreshLoadTip(); },
});

const driver = createFixedStepDriver(CONFIG.match.fixedStep, CONFIG.match.maxFrameDelta, (dt) => {
  if (state.phase !== 'playing') return;
  const events = step(state, dt, rng);
  audio.consume(events);
  for (const e of events) {
    if (e.type === 'end') {
      progress.record(state, e.result);   // 先写，showEnd 才能读到刷新后的最佳
      ui.showEnd(e.result);
    }
  }
});

const ui = createUI(state, {
  start(difficulty) {
    audio.resume();                       // 必须在用户手势里，浏览器才允许出声
    setDifficulty(state, difficulty);
    resetMatch(state);
    state.phase = 'playing';
    ui.showGame();
    renderer.resize(state);
    state.view.follow = state.view.cssW < CONFIG.world.mobileFollowWidth;
    driver.reset();
    last = performance.now();
  },
  pan(dir) { renderer.panStep(state, dir); },
  toggleFollow() { renderer.setFollow(state, !state.view.follow); },
  grantGems() {
    const r = grantGems(state);
    if (!r.ok) { ui.toast(r.reason); ui.sync(); return; }
    audio.gem();
    ui.toast(`+${r.amount} 宝石（当前 ${Math.round(r.total)}）· 本局剩余 ${r.remaining} 次`);
    ui.sync();
  },
  getProgress: () => progress.load(),
  clearProgress() { progress.reset(); ui.sync(); },
  isMuted: () => muted,
  toggleAudio() {
    audio.resume();
    muted = !muted;
    progress.setMuted(muted);
    ui.toast(muted ? '音效已关闭' : '程序合成音效已开启');
    ui.sync();
  },
  setAmmo(kind) {
    const r = setAmmo(state, kind);
    if (!r.ok) { ui.toast(r.reason); return; }
    audio.play('click');
    ui.refreshAmmo();
    ui.sync();
    ui.toast(r.unchanged ? `当前已是${r.label}` : `已切换为${r.label}（全局生效）`);
  },
  goMenu() {
    setControlAxis(state, 0);
    releaseChampion(state);
    state.phase = 'menu';
    ui.showMenu();
    driver.reset();
  },
  togglePause() {
    if (state.phase === 'playing') {
      setControlAxis(state, 0);
      state.phase = 'paused';
      ui.showPause(true);
    } else if (state.phase === 'paused') {
      setControlAxis(state, 0);
      state.phase = 'playing';
      ui.showPause(false);
      driver.reset();
      last = performance.now();
    }
  },
  selectChampion(worldX) { return selectChampion(state, worldX); },
  releaseChampion() { releaseChampion(state); ui.sync(); },
  setControlAxis(axis) { setControlAxis(state, axis); },
});

// 固定步长：60Hz / 144Hz / 掉帧都得到同一份模拟结果，刷新率不再决定难度。
// 渲染相位全部来自 state.elapsed / unit.walkPhase / state.fx，暂停时画面完全静止。
function frame(now) {
  const real = Math.max(0, (now - last) / 1000);
  last = now;
  driver.advance(real);
  renderer.draw(state, assets);
  ui.sync();
  requestAnimationFrame(frame);
}

function onResize() {
  renderer.resize(state);
}

// 窄屏横向拖动战场；位移超过阈值才算拖动并关掉跟随，轻点则选中我方单位。
// v2.10 用「位移 + 时长」双阈值区分点击与拖动，避免点选把镜头带跑。
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (state.phase !== 'playing') return;
  drag = { x: e.clientX, startX: e.clientX, startY: e.clientY, startT: e.timeStamp, moved: 0 };
  try { canvas.setPointerCapture(e.pointerId); } catch { /* 非指针设备忽略 */ }
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  drag.x = e.clientX;
  drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY));
  if (dx && drag.moved >= CONFIG.control.clickMaxSlopPx) renderer.panBy(state, dx);
});
canvas.addEventListener('pointerup', (e) => {
  const d = drag;
  drag = null;
  if (!d || state.phase !== 'playing') return;
  const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
  const dur = (e.timeStamp ?? d.startT) - d.startT;
  if (dist > CONFIG.control.clickMaxSlopPx || dur > CONFIG.control.clickMaxMs) return;
  const rect = canvas.getBoundingClientRect();
  const worldX = state.view.x + (e.clientX - rect.left) / state.view.scale;
  const wasActive = championInfo(state).active;
  const r = selectChampion(state, worldX);
  if (r.ok) {
    audio.play('select');
    ui.toast(`已接管 ${CONFIG.units[r.unit].name} · ←/→ 或按住 ◀▶ 移动 · Esc / × 退出`);
  } else if (wasActive) {
    ui.toast('已退出指挥');
  }
  ui.sync();
});
for (const ev of ['pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(ev, () => { drag = null; });
}

window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
renderer.resize(state);
requestAnimationFrame(frame);

assets.load((done, total) => {
  ui.setLoadTip(`位图加载 ${done}/${total}`);
}).then(() => {
  refreshLoadTip();
  ui.enableStart();
  started = true;
});

// 供调试与自动化烟测：控制台可直接查看状态、素材、矿点坐标与配置
window.__stickWar = {
  state, assets, ui, renderer,
  config: CONFIG,
  started: () => started,
  mines: () => minePositions(state),
  growth: () => aiGrowthInfo(state),
  control: {
    select: (worldX) => selectChampion(state, worldX),
    release: () => releaseChampion(state),
    axis: (a) => setControlAxis(state, a),
    info: () => championInfo(state),
  },
  effects: () => effectsInfo(state),
  setAmmo: (kind) => setAmmo(state, kind),
  grantGems: () => grantGems(state),
  audio, progress,
};
