#!/usr/bin/env node
// CI 里没有浏览器，用静态检查守住「每个能进的层都有退出通道」。
// 交互层面的完整验证由 scripts/smoke-pages.mjs（Playwright）负责。
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const ui = await readFile(path.join(root, 'src', 'ui.js'), 'utf8');
const problems = [];

const panels = ['shopPanel', 'upgradePanel'];
for (const id of panels) {
  const start = html.indexOf(`id="${id}"`);
  const end = html.indexOf('</section>', start);
  if (start < 0 || end < 0) { problems.push(`缺少面板 ${id}`); continue; }
  const block = html.slice(start, end);
  if (!block.includes('class="panelClose"')) problems.push(`${id} 缺少右上角 ×`);
  if (!block.includes('class="closeBtn"')) problems.push(`${id} 缺少底部关闭按钮`);
  if (!block.includes('aria-label=')) problems.push(`${id} 缺少无障碍标签`);
}
if (!html.includes('id="panelBackdrop"')) problems.push('缺少点击外部关闭的遮罩');
if (!html.includes('id="pauseOverlay"')) problems.push('缺少暂停/结算浮层容器');
if (!html.includes('rel="icon"')) problems.push('缺少内联 favicon（会触发 404）');
for (const id of ['garrisonBtn', 'queueStrip', 'difficulty']) {
  if (!html.includes(`id="${id}"`)) problems.push(`缺少 v2.2 控件 ${id}`);
}
// v2.10：单兵指挥也是一个「能进的层」，必须有 × 与 Esc 两条退路。
for (const id of ['championBar', 'champExit', 'champHoldLeft', 'champHoldRight', 'championName']) {
  if (!html.includes(`id="${id}"`)) problems.push(`缺少 v2.10 指挥控件 ${id}`);
}
const champStart = html.indexOf('id="championBar"');
const champBlock = champStart < 0 ? '' : html.slice(champStart, html.indexOf('</div>', champStart));
if (!champBlock.includes('×')) problems.push('championBar 缺少可见的 × 退出');
if (!ui.includes('champExit') || !ui.includes('releaseChampion')) {
  problems.push('ui.js 未绑定指挥退出');
}
if (!ui.includes("k === 'ArrowLeft'") || !ui.includes("handleKeyUp")) {
  problems.push('ui.js 缺少方向键按下/松开处理');
}
const css = await readFile(path.join(root, 'styles', 'main.css'), 'utf8');
if (!css.includes('#queueStrip')) problems.push('样式缺少训练队列条');
if (!css.includes('#panelBackdrop')) problems.push('样式缺少遮罩');

// 浮层 × 是运行时生成的，检查生成代码与分级 Esc 逻辑
for (const needle of ['overlayClose', "k === 'Escape'", 'closePanels()', 'openPanel(', 'backdrop.addEventListener']) {
  if (!ui.includes(needle)) problems.push(`ui.js 缺少导航逻辑: ${needle}`);
}
for (const id of ['closeShopX', 'closeUpgradeX', 'closeShop', 'closeUpgrade']) {
  if (!html.includes(`id="${id}"`) || !ui.includes(id)) problems.push(`关闭控件 ${id} 未同时存在于 HTML 与事件绑定`);
}

if (problems.length) {
  for (const p of problems) console.error('✗', p);
  process.exit(1);
}
console.log(`✓ 导航静态自检：${panels.length} 个面板 + 浮层 × + 指挥条 × / 方向键 + Esc 分级后退 + 遮罩 + 训练队列/难度/驻堡控件`);
