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

const sections = ['meta', 'layout', 'match', 'economy', 'upgrade', 'combat', 'ai', 'units', 'animation', 'presentation'];
for (const key of sections) {
  if (!cfg[key]) throw new Error(`config/game.json 缺少段: ${key}`);
}
for (const [key, u] of Object.entries(cfg.units)) {
  for (const field of ['name', 'cost', 'hp', 'speedPxPerSec', 'dmg', 'range', 'radius', 'kind', 'trainSec']) {
    if (u[field] === undefined) throw new Error(`units.${key} 缺少字段: ${field}`);
  }
  if (!(u.trainSec > 0)) throw new Error(`units.${key}.trainSec 必须为正`);
  if (u.projectile && !['arrow', 'rock', 'magic'].includes(u.projectile)) {
    throw new Error(`units.${key}.projectile 取值非法: ${u.projectile}`);
  }
}
if (cfg.match.fixedStep <= 0 || cfg.match.maxFrameDelta < cfg.match.fixedStep) {
  throw new Error('match.fixedStep / maxFrameDelta 配置不合理');
}
const mines = cfg.layout.goldMines;
if (!Array.isArray(mines) || mines.length === 0) throw new Error('layout.goldMines 必须是非空数组');
for (const [i, m] of mines.entries()) {
  if (!(m.xRatio > 0 && m.xRatio < 1)) throw new Error(`goldMines[${i}].xRatio 必须落在 (0,1)`);
  if (m.side !== 0 && m.side !== 1) throw new Error(`goldMines[${i}].side 必须为 0 或 1`);
}
for (const side of [0, 1]) {
  if (!mines.some((m) => m.side === side)) throw new Error(`goldMines 缺少 side=${side} 的矿点`);
}
if (!(cfg.layout.goldMineHeightRatio > 0 && cfg.layout.goldMineWidthRatio > 0)) {
  throw new Error('金矿形象尺寸比例必须为正');
}
// v2.3：位图素材链退役，全部动画参数必须集中在 animation 段且为正。
// 相位只允许取 state.elapsed / unit.walkPhase / projectile.age，禁止 performance.now()。
const animRequired = [
  'walkHz', 'walkLegSwing', 'walkArmSwing', 'breathHz', 'breathRatio', 'bobRatio',
  'attackSwingRad', 'mineSwingHz', 'carryBobHz', 'carryBobRatio',
  'cloudSpeedPxPerSec', 'cloudCount', 'grassSwayHz', 'grassCount',
  'mineGlowHz', 'crystalTwinkleHz', 'statuePulseHz', 'statueShakePx',
  'statueShakeSec', 'goldBurstSec', 'projectileSpinHz', 'fortPulseHz', 'trailDots',
];
for (const key of animRequired) {
  if (!(cfg.animation?.[key] > 0)) throw new Error(`animation.${key} 必须为正数`);
}
const paletteRequired = [
  'outline', 'skyTop', 'skyBottom', 'hillFar', 'hillNear', 'groundTop',
  'groundBottom', 'grassBlade', 'stoneLight', 'stoneMid', 'stoneDark',
  'weapon', 'weaponEdge', 'goldDark', 'goldLight', 'rockDark', 'rockLight',
];
for (const key of paletteRequired) {
  if (!cfg.presentation?.[key]) throw new Error(`presentation.${key} 缺失（矢量调色板）`);
}
for (const key of ['normal', 'hard', 'insane']) {
  const d = cfg.match.difficulties?.[key];
  if (!d?.label || !(d.aiIncomeMul > 0) || !(d.aiSpawnMul > 0) || !(d.enemyStatueMul > 0)) {
    throw new Error(`match.difficulties.${key} 配置不完整`);
  }
}
for (const key of ['rangedVsGiant', 'rangedVsSpearton', 'rangedVsStatue', 'archerVsSwordwrath']) {
  if (!(cfg.combat.damageMatrix?.[key] > 0)) throw new Error(`combat.damageMatrix.${key} 必须为正`);
}
if (!(cfg.economy.castleGoldPerSec > 0 && cfg.match.fortArcherPerUnits > 0)) {
  throw new Error('城堡收入/射手配置不合理');
}

const header = [
  '// 本文件由 scripts/build-config.mjs 自动生成，请勿手改。',
  '// 修改 config/game.json 后执行 npm run build。',
  '',
].join('\n');

const body = `export default Object.freeze(${JSON.stringify(cfg, null, 2)});\n`;
await writeFile(target, header + body, 'utf8');
console.log(`generated ${path.relative(root, target)} (${Object.keys(cfg.units).length} units)`);
