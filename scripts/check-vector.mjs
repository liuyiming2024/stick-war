#!/usr/bin/env node
// v2.3 静态自检：仓库里不存在任何外部位图，全部视觉元素由 Canvas 路径 / 内联 SVG 生成；
// 且动画相位只允许来自模拟时间，禁止墙钟时间与随机源，保证暂停静止、整局可复现。
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CONFIG, UNIT_ORDER } from '../src/config.js';
import { unitSVG, toolSVG, hasExternalResource } from '../src/icons.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const ok = [];

async function walk(dir, out = []) {
  for (const name of await readdir(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const p = path.join(dir, name);
    const s = await stat(p);
    if (s.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

// 1. 任何外部位图/图标文件都不允许存在
const files = await walk(root);
const bitmap = files.filter((f) => /\.(?:webp|png|jpe?g|gif|bmp|tiff?|avif|svg)$/i.test(f));
if (bitmap.length) {
  problems.push(`仍存在外部图片文件: ${bitmap.map((f) => path.relative(root, f)).join(', ')}`);
} else ok.push('0 个外部图片文件');

const assetsDir = path.join(root, 'assets');
try {
  const rest = await readdir(assetsDir);
  if (rest.length) problems.push(`assets/ 目录仍有残留: ${rest.join(', ')}`);
  else ok.push('assets/ 已清空');
} catch {
  ok.push('assets/ 目录已退役');
}

// 2. 源码里不得出现任何位图引用
const sourceFiles = [
  'index.html', 'styles/main.css',
  ...(await readdir(path.join(root, 'src'))).map((f) => path.join('src', f)),
];
const forbidden = [
  [/\.(?:webp|png|jpe?g|gif|bmp|avif)/i, '外部位图路径'],
  [/<img\b/i, '<img> 标签'],
  [/\bnew\s+Image\s*\(/, 'new Image()'],
  [/\bdrawImage\s*\(/, '位图绘制调用'],
  [/\bASSET_KEYS\b|\bassetPath\b|\bcreateAssets\b/, '旧素材链符号'],
  [/url\(\s*['"]?(?!data:)/i, 'CSS 外链资源'],
];
for (const rel of sourceFiles) {
  if (!rel.endsWith('.js') && !rel.endsWith('.html') && !rel.endsWith('.css')) continue;
  const text = await readFile(path.join(root, rel), 'utf8');
  for (const [re, label] of forbidden) {
    if (re.test(text)) problems.push(`${rel} 含${label}`);
  }
}
if (!problems.some((p) => p.includes('外部位图') || p.includes('<img') || p.includes('位图绘制') || p.includes('旧素材链'))) {
  ok.push('HTML / CSS / src 全无位图引用');
}

// 3. 渲染相位：禁用墙钟时间、随机源与昂贵的 filter
const render = await readFile(path.join(root, 'src', 'render.js'), 'utf8');
for (const [re, label] of [
  [/performance\s*\.\s*now\s*\(/, 'performance.now()'],
  [/\bDate\s*\.\s*now\s*\(/, 'Date.now()'],
  [/\bMath\s*\.\s*random\s*\(/, 'Math.random()'],
  [/ctx\s*\.\s*filter\b/, 'ctx.filter'],
]) {
  if (re.test(render)) problems.push(`render.js 含${label}（会破坏暂停静止/确定性）`);
}
const phaseSources = ['state.elapsed', 'u.walkPhase', 'u.anim', 'p.age', 'state.fx'];
for (const src of phaseSources) {
  if (!render.includes(src)) problems.push(`render.js 未使用相位源 ${src}`);
}
ok.push('相位只来自模拟时间，无墙钟/随机/filter');

// 4. animation 段必须真的被渲染层消费（不能配了不用）
const used = Object.keys(CONFIG.animation).filter((k) => render.includes(`A.${k}`));
if (used.length < 12) problems.push(`animation 段仅 ${used.length} 个键被 render.js 使用，疑似配了不用`);
else ok.push(`animation 段 ${used.length}/${Object.keys(CONFIG.animation).length} 个键被渲染层消费`);

// 5. 每个兵种与工具按钮都有内联 SVG，且 SVG 不引用外部资源
for (const key of UNIT_ORDER) {
  const svg = unitSVG(key);
  if (!svg.startsWith('<svg')) problems.push(`${key} 未生成内联 SVG`);
  if (hasExternalResource(svg)) problems.push(`${key} 的 SVG 引用了外部资源`);
}
for (const kind of ['shop', 'upgrade']) {
  const svg = toolSVG(kind);
  if (!svg.startsWith('<svg')) problems.push(`工具 ${kind} 未生成内联 SVG`);
  if (hasExternalResource(svg)) problems.push(`工具 ${kind} 的 SVG 引用了外部资源`);
}
ok.push(`${UNIT_ORDER.length} 个兵种 + 2 个工具图标均为自包含内联 SVG`);

// 6. Pages 静态入口
const html = await readFile(path.join(root, 'index.html'), 'utf8');
if (!html.includes('type="module"')) problems.push('index.html 缺少 ESM 入口');
try { await stat(path.join(root, '.nojekyll')); ok.push('Pages 入口完整'); }
catch { problems.push('缺少 .nojekyll'); }

for (const line of ok) console.log('✓', line);
if (problems.length) {
  for (const p of problems) console.error('✗', p);
  console.error(`\n矢量渲染自检失败：${problems.length} 项`);
  process.exit(1);
}
console.log(`\n✓ 全矢量渲染自检通过：${ok.length} 项，外部位图 0，墙钟相位 0`);
