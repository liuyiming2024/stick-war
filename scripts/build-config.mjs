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

const sections = ['meta', 'layout', 'match', 'economy', 'upgrade', 'combat', 'ai', 'units', 'assets', 'animation', 'presentation'];
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
// v2.5：位图立绘回归，两段式加载超时必须合理，弱网下先放行开战再补登记。
if (!(cfg.assets?.softTimeoutSec > 0 && cfg.assets?.hardTimeoutSec > cfg.assets.softTimeoutSec)) {
  throw new Error('assets 软/硬超时配置不合理');
}
if (!(cfg.assets.retryCount >= 0 && cfg.assets.retryDelayMs > 0)) {
  throw new Error('assets 重试配置不合理');
}
// v2.8：逻辑世界固定宽高，窄屏靠视口/镜头，而不是把战场压缩进一个屏幕。
const world = cfg.world;
for (const k of ['width', 'height', 'minScale', 'maxScale', 'followAnchorRatio',
  'followLerpPerSec', 'panStepRatio', 'mobileFollowWidth']) {
  if (!(world?.[k] > 0)) throw new Error(`world.${k} 必须为正数`);
}
if (!(world.minScale <= world.maxScale)) throw new Error('world.minScale 不能大于 maxScale');
if (!(world.followAnchorRatio > 0 && world.followAnchorRatio < 1)) {
  throw new Error('world.followAnchorRatio 必须在 (0,1)');
}
// 矿点不能贴着回营点：否则矿工「挖到就回营」，运矿过程消失。
const minDist = cfg.economy.minMineHomeDistanceRatio;
if (!(minDist > 0)) throw new Error('economy.minMineHomeDistanceRatio 必须为正数');
if (!(cfg.economy.carrySpeedMul > 0 && cfg.economy.carrySpeedMul <= 1)) {
  throw new Error('economy.carrySpeedMul 必须落在 (0,1]');
}
const homeL = cfg.layout.statueInset + cfg.layout.statueHitRadius;
const homeR = world.width - homeL;
for (const [i, m] of cfg.layout.goldMines.entries()) {
  const x = world.width * m.xRatio;
  const home = m.side === 0 ? homeL : homeR;
  const dist = Math.abs(x - home);
  if (dist < world.width * minDist) {
    throw new Error(
      `goldMines[${i}] 距回营点仅 ${dist.toFixed(0)}px，低于 ${(world.width * minDist).toFixed(0)}px：挖到就回营，运矿过程会消失`);
  }
  if ((m.side === 0 && x >= world.width * 0.5) || (m.side === 1 && x <= world.width * 0.5)) {
    throw new Error(`goldMines[${i}] 越过中线，会挖到对方半场`);
  }
}
// v2.7：AI 必须真的发育——按顺序买矿工/科技，而不是按定时器凭空刷兵。
const growth = cfg.ai;
for (const key of ['decisionIntervalSec', 'rampSec', 'minerTargetStart', 'minerTargetEnd',
  'minerReserveGold', 'militaryReserveGold', 'upgradeIntervalSec', 'upgradeReserveGold']) {
  if (!(growth?.[key] > 0)) throw new Error(`ai.${key} 必须为正数`);
}
if (!(growth.minerTargetEnd >= growth.minerTargetStart)) {
  throw new Error('ai.minerTargetEnd 不能小于 minerTargetStart');
}
if (!Array.isArray(growth.upgradePlan) || growth.upgradePlan.length === 0) {
  throw new Error('ai.upgradePlan 必须是非空的升级序列');
}
for (const [i, entry] of growth.upgradePlan.entries()) {
  if (!Array.isArray(entry) || entry.length !== 2) {
    throw new Error(`ai.upgradePlan[${i}] 必须是 [type, stat]`);
  }
  const [type, stat] = entry;
  if (!cfg.units[type]) throw new Error(`ai.upgradePlan[${i}] 未知兵种: ${type}`);
  const stats = type === 'miner' ? ['bag', 'pick', 'spd'] : ['atk', 'def', 'spd'];
  if (!stats.includes(stat)) {
    throw new Error(`ai.upgradePlan[${i}] ${type} 不支持 ${stat}（可用 ${stats.join('/')}）`);
  }
}
if (!(cfg.economy.aiStartGold > 0 && cfg.economy.aiGoldPerSec >= 0)) {
  throw new Error('economy.aiStartGold / aiGoldPerSec 配置不合理');
}
// v2.9：宝石免费、无限领取、可当金币花。禁止给领取加冷却或总量上限。
const gems = cfg.gems;
for (const k of ['starting', 'grantAmount', 'goldPerGem']) {
  if (!(gems?.[k] > 0)) throw new Error(`gems.${k} 必须为正数`);
}
if (!gems.label || !gems.autoSpend) throw new Error('gems.label / autoSpend 缺失');
if ('cooldownSec' in gems || 'maxTotal' in gems || 'cost' in gems) {
  throw new Error('宝石必须免费且无限领取，不允许 cooldownSec/maxTotal/cost');
}
if (!(cfg.match.startingGold >= 0)) throw new Error('match.startingGold 配置不合理');
// 难度整体下调：普通档必须比疯狂档更宽松（收入更低、训练更慢、雕像更薄）。
const dn = cfg.match.difficulties.normal, di = cfg.match.difficulties.insane;
if (!(dn.aiIncomeMul < di.aiIncomeMul && dn.aiSpawnMul > di.aiSpawnMul &&
      dn.enemyStatueMul < di.enemyStatueMul)) {
  throw new Error('普通难度必须比疯狂难度更宽松');
}
if (!(cfg.ai.wave.firstWaveSize <= cfg.ai.wave.maxWaveSize)) {
  throw new Error('ai.wave.firstWaveSize 不能超过 maxWaveSize');
}
// v2.8：波次指挥与针对性反制。反制矩阵必须是 [aiType, playerType, mul>0] 三元组。
if (!(growth.counterSaturation > 0)) throw new Error('ai.counterSaturation 必须为正');
if (!Array.isArray(growth.counterMatrix) || growth.counterMatrix.length === 0) {
  throw new Error('ai.counterMatrix 必须是非空数组');
}
for (const [i, row] of growth.counterMatrix.entries()) {
  if (!Array.isArray(row) || row.length !== 3) throw new Error(`ai.counterMatrix[${i}] 必须是三元组`);
  const [a, p, mul] = row;
  if (!cfg.units[a] || !cfg.units[p]) throw new Error(`ai.counterMatrix[${i}] 含未知兵种: ${a}/${p}`);
  if (!(mul > 0)) throw new Error(`ai.counterMatrix[${i}] 倍率必须为正`);
  if (a === p) throw new Error(`ai.counterMatrix[${i}] 不能自我克制`);
}
const wave = growth.wave;
for (const key of ['firstWaveSize', 'waveSizeGrowth', 'maxWaveSize', 'buildMinSec',
  'launchRatio', 'musterTimeoutSec', 'assaultTimeoutSec', 'retreatRatio', 'regroupSec']) {
  if (!(wave?.[key] > 0)) throw new Error(`ai.wave.${key} 必须为正数`);
}
if (!(wave.firstWaveSize <= wave.maxWaveSize)) throw new Error('ai.wave.firstWaveSize 不能超过 maxWaveSize');
if (!(wave.launchRatio <= 1 && wave.retreatRatio < wave.launchRatio)) {
  throw new Error('ai.wave.launchRatio / retreatRatio 关系不合理（必须 retreat < launch <= 1）');
}

const header = [
  '// 本文件由 scripts/build-config.mjs 自动生成，请勿手改。',
  '// 修改 config/game.json 后执行 npm run build。',
  '',
].join('\n');

const body = `export default Object.freeze(${JSON.stringify(cfg, null, 2)});\n`;
await writeFile(target, header + body, 'utf8');
console.log(`generated ${path.relative(root, target)} (${Object.keys(cfg.units).length} units)`);
