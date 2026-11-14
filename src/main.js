import { CONFIG } from './config.js';
import { createState, resetMatch } from './state.js';
import { createRng } from './rng.js';
import { step, minePositions, setDifficulty } from './simulation.js';
import { createAssets } from './assets.js';
import { createRenderer } from './render.js';
import { createUI } from './ui.js';
import { createFixedStepDriver } from './timing.js';

const canvas = document.getElementById('canvas');
const state = createState();
const rng = createRng(Date.now() >>> 0);
const renderer = createRenderer(canvas);

let last = performance.now();
let started = false;

function refreshLoadTip() {
  const n = assets.missingCount();
  ui.setLoadTip(n ? `${n} 张素材缺失，已启用线稿替身` : '素材就绪，可以开战');
}

// 弱网下软超时先放行开战，图片晚到再补登记，不误判成「素材缺失」。
const assets = createAssets({
  softTimeoutMs: CONFIG.assets.softTimeoutSec * 1000,
  hardTimeoutMs: CONFIG.assets.hardTimeoutSec * 1000,
  onChange: () => {
    if (started) refreshLoadTip();
    renderer.invalidateBackground();
  },
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
    driver.reset();
    last = performance.now();
  },
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

window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
renderer.resize(state);
requestAnimationFrame(frame);

assets.load((done, total) => {
  ui.setLoadTip(`资源加载 ${done}/${total}`);
}).then(() => {
  refreshLoadTip();
  ui.enableStart();
  renderer.invalidateBackground();
  started = true;
});

// 供调试与自动化烟测：控制台可直接查看状态、矿点坐标与配置
window.__stickWar = {
  state, assets, ui, renderer,
  config: CONFIG,
  started: () => started,
  mines: () => minePositions(state),
};
