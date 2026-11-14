#!/usr/bin/env node
// 校验 assets/manifest.json 与实际素材一致，并输出真实体积（README 引用这个数字）。
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'assets');
const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
const actual = await readdir(dir);

const problems = [];
let webpBytes = 0;
const keys = Object.keys(manifest).filter((k) => k !== 'battlefield');
for (const key of [...keys, 'battlefield']) {
  const entry = manifest[key];
  const name = `${key}.webp`;
  if (!actual.includes(name)) {
    problems.push(`缺少 ${name}`);
    continue;
  }
  const buf = await readFile(path.join(dir, name));
  webpBytes += buf.length;
  if (entry.webp !== buf.length) {
    problems.push(`${name} 字节数不符: manifest=${entry.webp} 实际=${buf.length}`);
  }
}
const extras = actual.filter((f) => f.endsWith('.webp') && !manifest[f.replace('.webp', '')]);
if (extras.length) problems.push(`manifest 未登记: ${extras.join(', ')}`);

console.log(`webp 合计 ${webpBytes} 字节 (${(webpBytes / 1024).toFixed(1)} KiB)，${keys.length + 1} 个文件`);
if (problems.length) {
  for (const p of problems) console.error('✗', p);
  process.exit(1);
}
console.log('✓ 素材清单与文件一致');
