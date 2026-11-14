#!/usr/bin/env node
// config/game.json -> src/config.generated.js
// 生成物要提交到仓库：Pages 直接从 main 分支提供静态文件，运行时不做构建。
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'config', 'game.json');
const target = path.join(root, 'src', 'config.generated.js');

const cfg = JSON.parse(await readFile(source, 'utf8'));

const sections = ['meta', 'layout', 'match', 'economy', 'upgrade', 'combat', 'ai', 'units', 'presentation'];
for (const key of sections) {
  if (!cfg[key]) throw new Error(`config/game.json 缺少段: ${key}`);
}
for (const [key, u] of Object.entries(cfg.units)) {
  for (const field of ['name', 'cost', 'hp', 'speedPxPerSec', 'dmg', 'range', 'radius', 'kind']) {
    if (u[field] === undefined) throw new Error(`units.${key} 缺少字段: ${field}`);
  }
  if (u.projectile && !['arrow', 'rock', 'magic'].includes(u.projectile)) {
    throw new Error(`units.${key}.projectile 取值非法: ${u.projectile}`);
  }
}
if (cfg.match.fixedStep <= 0 || cfg.match.maxFrameDelta < cfg.match.fixedStep) {
  throw new Error('match.fixedStep / maxFrameDelta 配置不合理');
}

const header = [
  '// 本文件由 scripts/build-config.mjs 自动生成，请勿手改。',
  '// 修改 config/game.json 后执行 npm run build。',
  '',
].join('\n');

const body = `export default Object.freeze(${JSON.stringify(cfg, null, 2)});\n`;
await writeFile(target, header + body, 'utf8');
console.log(`generated ${path.relative(root, target)} (${Object.keys(cfg.units).length} units)`);
