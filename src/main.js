import { CONFIG } from './config.js';
import { createState, resetMatch } from './state.js';
import { createRng } from './rng.js';
import { step, minePositions, setDifficulty } from './simulation.js';
import { createRenderer } from './render.js';
import { createUI } from './ui.js';
import { createFixedStepDriver } from './timing.js';

const canvas = document.getElementById('canvas');
const state = createState();
const rng = createRng(Date.now() >>> 0);
const renderer = createRenderer(canvas);

let last = performance.now();
let started = false;

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
  renderer.draw(state);
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

// 全矢量：没有图片要等、没有超时、没有降级替身，同步即可开战。
ui.setLoadTip('全矢量渲染就绪，可以开战');
ui.enableStart();
started = true;

// 供调试与自动化烟测：控制台可直接查看状态、矿点坐标与配置
window.__stickWar = {
  state, ui, renderer,
  config: CONFIG,
  started: () => started,
  mines: () => minePositions(state),
};
