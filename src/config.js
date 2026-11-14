import raw from './config.generated.js';

export const CONFIG = raw;
export const UNIT_ORDER = Object.keys(raw.units);
export const ASSET_KEYS = [...UNIT_ORDER, 'statue', 'battlefield'];

export const assetPath = (key) => `./assets/${key}.webp`;

export function bonusFor(upgrades, type) {
  const lv = upgrades?.[type] ?? { atk: 0, def: 0, spd: 0 };
  const u = raw.upgrade;
  return {
    dmgMul: 1 + lv.atk * u.dmgPerLevel,
    defMul: Math.max(u.defFloor, 1 - lv.def * u.defReductionPerLevel),
    cdMul: Math.max(u.cdFloor, 1 - lv.spd * u.cdReductionPerLevel),
  };
}

export function freshUpgrades() {
  const out = {};
  for (const type of UNIT_ORDER) out[type] = { atk: 0, def: 0, spd: 0 };
  return out;
}
