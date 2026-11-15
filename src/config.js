import raw from './config.generated.js?v=2.9.0';

export const CONFIG = raw;
export const UNIT_ORDER = Object.keys(raw.units);
export const DIFFICULTIES = Object.keys(raw.match.difficulties);
export const ASSET_KEYS = [...UNIT_ORDER, 'statue', 'battlefield', 'goldmine'];

// v2.8：素材 URL 也带版本指纹。否则浏览器可能长时间缓存一次失败的响应，
// 表现为「位图一直没放上去、只有线稿替身」。
export const assetPath = (key) => `./assets/${key}.webp?v=${raw.meta.version}`;

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
