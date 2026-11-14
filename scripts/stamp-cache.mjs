#!/usr/bin/env node
// 版本化缓存指纹（v2.7.1 引入）。
//
// 问题：index.html 的 <script src="./src/main.js"> 与 src/*.js 内部所有相对 import
// 原本都是裸 URL。GitHub Pages / 浏览器会按 URL 强缓存这些模块，推了新版本后
// HTML 虽然更新，子模块仍从 disk cache 取旧文件 —— 现象就是「线上还停在 2.6」，
// 更糟时新 ui.js 会 import 到旧 simulation.js 里不存在的导出而直接白屏。
//
// 做法：把 config/game.json 的 version 作为唯一指纹，给
//   1) index.html 的 module script 与 stylesheet href
//   2) src/*.js 里每一条相对 .js import
// 统一追加 ?v=<version>。版本号一变，整条 ESM 依赖图的 URL 同时失效。
// 脚本幂等：先剥掉旧 ?v= 再追加，重复 build 不会叠加。
//
// Node 对 file: URL 的 search 参数用于模块缓存键、路径解析仍取 pathname，
// 因此 node --test 与浏览器都能加载；本地 serve.mjs 用 URL.pathname，天然忽略 query。
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(await readFile(path.join(root, 'config', 'game.json'), 'utf8'));
const version = cfg.meta?.version;
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  throw new Error(`config/game.json meta.version 不是合法语义版本: ${version}`);
}
const Q = `?v=${version}`;
const stripQuery = (u) => u.replace(/\?v=[^"'\s]*/g, '');

// ── index.html ──────────────────────────────────────────────────────────
const htmlPath = path.join(root, 'index.html');
let html = await readFile(htmlPath, 'utf8');
const htmlBefore = html;

html = html.replace(
  /(<script\b[^>]*\bsrc=")([^"]+\.js)(?:\?v=[^"]*)?(")/g,
  (_m, a, spec, c) => a + stripQuery(spec) + Q + c,
);
html = html.replace(
  /(<link\b[^>]*\bhref=")([^"]+\.css)(?:\?v=[^"]*)?(")/g,
  (_m, a, spec, c) => a + stripQuery(spec) + Q + c,
);

// HTML 本身也不该被强缓存：它是携带指纹的唯一入口。
const noCache = '<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">';
if (!html.includes('http-equiv="Cache-Control"')) {
  html = html.replace('<meta charset="UTF-8">', `<meta charset="UTF-8">\n${noCache}`);
}
if (html !== htmlBefore) await writeFile(htmlPath, html, 'utf8');

// ── src/*.js ────────────────────────────────────────────────────────────
// 匹配 `from './x.js'` / `import './x.js'`，兼容单双引号，剥掉旧 ?v= 后重加。
const importRe = /(\b(?:from|import)\s+)(['"])(\.{1,2}\/[^'"]+?\.js)(?:\?v=[^'"]*)?\2/g;
let touched = 0;
let imports = 0;
const srcDir = path.join(root, 'src');
for (const name of (await readdir(srcDir)).filter((f) => f.endsWith('.js')).sort()) {
  const file = path.join(srcDir, name);
  const before = await readFile(file, 'utf8');
  const after = before.replace(importRe, (_m, kw, quote, spec) => {
    imports++;
    return `${kw}${quote}${stripQuery(spec)}${Q}${quote}`;
  });
  if (after !== before) { await writeFile(file, after, 'utf8'); touched++; }
}

console.log(`cache stamp ${Q}: index.html ${html !== htmlBefore ? 'updated' : 'unchanged'}, ` +
  `${touched} 个 src 文件改动，${imports} 条相对 import 已加指纹`);
