#!/usr/bin/env node
// v2.5：位图立绘回归后的统一静态自检。
//   1) assets/manifest.json 与实际 WebP 一致：存在、字节数、RIFF/WebP 头解析出的画布尺寸
//   2) 素材键与 units 配置一一对应
//   3) 渲染层仍然不允许墙钟时间 / 随机源 / ctx.filter，动画相位只来自模拟状态
//   4) animation 段必须真的被渲染层消费
//   5) Pages 静态入口完整
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CONFIG, UNIT_ORDER, ASSET_KEYS } from '../src/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'assets');
const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
const actual = await readdir(dir);
const problems = [];
const ok = [];

// 解析 RIFF/WebP 头，支持 VP8X（扩展）、VP8（有损）、VP8L（无损）。
function webpSize(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const cc = buf.toString('ascii', 12, 16);
  if (cc === 'VP8X' && buf.length >= 30) {
    return {
      w: (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1,
      h: (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1,
    };
  }
  if (cc === 'VP8 ') {
    for (let i = 20; i < Math.min(buf.length - 7, 48); i++) {
      if (buf[i] === 0x9d && buf[i + 1] === 0x01 && buf[i + 2] === 0x2a) {
        return { w: buf.readUInt16LE(i + 3) & 0x3fff, h: buf.readUInt16LE(i + 5) & 0x3fff };
      }
    }
  }
  if (cc === 'VP8L' && buf.length >= 25 && buf[20] === 0x2f) {
    const b1 = buf[21], b2 = buf[22], b3 = buf[23], b4 = buf[24];
    return {
      w: 1 + (b1 | ((b2 & 0x3f) << 8)),
      h: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)),
    };
  }
  return null;
}

const keys = Object.keys(manifest).filter((k) => !k.startsWith('_'));
let webpBytes = 0;
let sizeChecked = 0;
for (const key of keys) {
  const entry = manifest[key];
  const name = `${key}.webp`;
  if (!actual.includes(name)) { problems.push(`缺少 ${name}`); continue; }
  const buf = await readFile(path.join(dir, name));
  webpBytes += buf.length;
  if (entry.webp !== buf.length) problems.push(`${name} 字节数不符: manifest=${entry.webp} 实际=${buf.length}`);
  const parsed = webpSize(buf);
  if (!parsed) problems.push(`${name} 无法解析 WebP 尺寸`);
  else {
    sizeChecked++;
    if (parsed.w !== entry.w || parsed.h !== entry.h) {
      problems.push(`${name} 尺寸不符: manifest=${entry.w}x${entry.h} 实际=${parsed.w}x${parsed.h}`);
    }
  }
}
const extras = actual.filter((f) => f.endsWith('.webp') && !keys.includes(f.replace('.webp', '')));
if (extras.length) problems.push(`manifest 未登记: ${extras.join(', ')}`);
const expected = [...UNIT_ORDER, 'statue', 'battlefield'].sort();
if (JSON.stringify([...keys].sort()) !== JSON.stringify(expected)) {
  problems.push(`素材键与配置不一致: ${keys.join(',')}`);
}
if (ASSET_KEYS.length !== 9) problems.push(`ASSET_KEYS 应为 9，实际 ${ASSET_KEYS.length}`);
ok.push(`WebP ${webpBytes} 字节 / ${(webpBytes / 1024).toFixed(1)} KiB，${keys.length} 文件，尺寸校验 ${sizeChecked}/${keys.length}`);

// 渲染确定性：位图回归后这条约束仍然成立，暂停时画面必须逐帧一致。
const render = await readFile(path.join(root, 'src', 'render.js'), 'utf8');
for (const [re, label] of [
  [/performance\s*\.\s*now\s*\(/, 'performance.now()'],
  [/\bDate\s*\.\s*now\s*\(/, 'Date.now()'],
  [/\bMath\s*\.\s*random\s*\(/, 'Math.random()'],
  [/ctx\s*\.\s*filter\b/, 'ctx.filter'],
]) {
  if (re.test(render)) problems.push(`render.js 含 ${label}（破坏暂停静止/确定性）`);
}
for (const src of ['state.elapsed', 'u.walkPhase', 'u.anim', 'p.age', 'state.fx']) {
  if (!render.includes(src)) problems.push(`render.js 未使用相位源 ${src}`);
}
// v2.6：矢量只承担几何标记与 HUD，不许再往渲染层堆实体多边形画插画。
// 当前只有金币迸发粒子用到 poly()，调用点上限留 3 给必要的小标记。
const polyCalls = (render.match(/^\s*poly\(ctx,/gm) ?? []).length;
if (polyCalls > 3) problems.push(`render.js 有 ${polyCalls} 处 poly() 调用：矢量只应做 HUD 标记，不要重新画实体`);
else ok.push(`矢量收口：render.js 仅 ${polyCalls} 处多边形调用（实体观感由位图承担）`);
const used = Object.keys(CONFIG.animation).filter((k) => render.includes(`A.${k}`));
if (used.length < 12) problems.push(`animation 段仅 ${used.length} 个键被渲染层消费`);
else ok.push(`渲染相位无墙钟/随机/filter，animation 消费 ${used.length}/${Object.keys(CONFIG.animation).length} 键`);

// Pages 入口
const html = await readFile(path.join(root, 'index.html'), 'utf8');
if (!html.includes('type="module"')) problems.push('index.html 缺少 ESM 入口');
try { await stat(path.join(root, '.nojekyll')); ok.push('Pages 入口完整'); }
catch { problems.push('缺少 .nojekyll'); }

for (const line of ok) console.log('✓', line);
if (problems.length) {
  for (const p of problems) console.error('✗', p);
  console.error(`\n素材自检失败：${problems.length} 项`);
  process.exit(1);
}
console.log('\n✓ 位图素材 + 渲染确定性自检通过');
