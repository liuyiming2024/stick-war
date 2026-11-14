#!/usr/bin/env node
// 校验 assets/manifest.json 与实际素材一致：文件存在、字节数、WebP 画布尺寸。
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'assets');
const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
const actual = await readdir(dir);

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
const problems = [];
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

console.log(`webp 合计 ${webpBytes} 字节 (${(webpBytes / 1024).toFixed(1)} KiB)，${keys.length} 个文件，尺寸校验 ${sizeChecked}/${keys.length}`);
if (problems.length) {
  for (const p of problems) console.error('✗', p);
  process.exit(1);
}
console.log('✓ 素材清单、字节数与画布尺寸全部一致');
