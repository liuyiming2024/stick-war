import raw from './config.generated.js';

export const CONFIG = raw;
export const UNIT_ORDER = Object.keys(raw.units);
export const DIFFICULTIES = Object.keys(raw.match.difficulties);
// v2.3 起没有任何外部位图：兵种/雕像/背景/图标全部由 Canvas 路径与内联 SVG 生成。

/** 矿工按原版 Armory 只有「背包 / 镐 / 移速」三个维度，其他兵种是攻/防/速。 */
export function upgradeStats(type) {
  return type === 'miner' ? ['bag', 'pick', 'spd'] : ['atk', 'def', 'spd'];
}

export function freshUpgradeFor(type) {
  const out = {};
  for (const s of upgradeStats(type)) out[s] = 0;
  return out;
}

export function freshUpgrades() {
  const out = {};
  for (const type of UNIT_ORDER) out[type] = freshUpgradeFor(type);
  return out;
}

export function bonusFor(upgrades, type) {
  const lv = upgrades?.[type] ?? freshUpgradeFor(type);
  const u = raw.upgrade;
  const spd = lv.spd ?? 0;
  const base = {
    dmgMul: 1 + (lv.atk ?? 0) * u.dmgPerLevel,
    defMul: Math.max(u.defFloor, 1 - (lv.def ?? 0) * u.defReductionPerLevel),
    cdMul: Math.max(u.cdFloor, 1 - spd * u.cdReductionPerLevel),
    speedMul: 1 + spd * u.speedPerLevel,
    goldMul: 1 + (lv.bag ?? 0) * raw.economy.bagPerLevel,
    mineSpeedMul: 1 + (lv.pick ?? 0) * raw.economy.pickaxePerLevel,
  };
  return base;
}
