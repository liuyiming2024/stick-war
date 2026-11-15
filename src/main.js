import { CONFIG, ASSET_KEYS } from './config.js?v=2.8.0';
import { createState, resetMatch } from './state.js?v=2.8.0';
import { createRng } from './rng.js?v=2.8.0';
import { step, minePositions, setDifficulty, aiGrowthInfo } from './simulation.js?v=2.8.0';
import { createAssets } from './assets.js?v=2.8.0';
import { createRenderer } from './render.js?v=2.8.0';
import { createUI } from './ui.js?v=2.8.0';
import { createFixedStepDriver } from './timing.js?v=2.8.0';

const canvas = document.getElementById('canvas');
const state = createState();
const rng = createRng(Date.now() >>> 0);
const renderer = createRenderer(canvas);

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
  for (const e of events) if (e.type === 'end') ui.showEnd(e.result);
});

const ui = createUI(state, {
  start(difficulty) {
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
  goMenu() {
    state.phase = 'menu';
    ui.showMenu();
    driver.reset();
  },
  togglePause() {
    if (state.phase === 'playing') {
      state.phase = 'paused';
      ui.showPause(true);
    } else if (state.phase === 'paused') {
      state.phase = 'playing';
      ui.showPause(false);
      driver.reset();
      last = performance.now();
    }
  },
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

// 窄屏横向拖动战场；拖动会暂时关掉自动跟随，点「跟随」可再打开。
let dragX = null;
canvas.addEventListener('pointerdown', (e) => {
  if (state.phase !== 'playing') return;
  dragX = e.clientX;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* 非指针设备忽略 */ }
});
canvas.addEventListener('pointermove', (e) => {
  if (dragX === null) return;
  const dx = e.clientX - dragX;
  dragX = e.clientX;
  if (dx) renderer.panBy(state, dx);
});
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(ev, () => { dragX = null; });
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
};
