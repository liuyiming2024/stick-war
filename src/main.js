import { CONFIG } from './config.js?v=2.7.1';
import { createState, resetMatch } from './state.js?v=2.7.1';
import { createRng } from './rng.js?v=2.7.1';
import { step, minePositions, setDifficulty, aiGrowthInfo } from './simulation.js?v=2.7.1';
import { createAssets } from './assets.js?v=2.7.1';
import { createRenderer } from './render.js?v=2.7.1';
import { createUI } from './ui.js?v=2.7.1';
import { createFixedStepDriver } from './timing.js?v=2.7.1';

const canvas = document.getElementById('canvas');
const state = createState();
const rng = createRng(Date.now() >>> 0);
const renderer = createRenderer(canvas);

let last = performance.now();
let started = false;

function refreshLoadTip() {
  const n = assets.missingCount();
  ui.setLoadTip(n ? `${n} 张素材缺失，已启用线稿替身` : '位图素材就绪，可以开战');
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
