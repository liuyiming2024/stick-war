import { CONFIG, UNIT_ORDER, bonusFor, freshUpgrades } from './config.js';

// 纯状态：不引用 DOM / canvas，可在 Node 下直接构造与推演。
export function createState(w = 0, h = 0) {
  return {
    w, h,
    phase: 'menu',              // menu | playing | paused | won | lost
    gold: CONFIG.match.startingGold,
    aiGold: CONFIG.economy.aiStartGold,
    homeHp: CONFIG.match.statueHp,
    enemyHp: CONFIG.match.statueHp,
    units: [],
    projectiles: [],
    upgrades: freshUpgrades(),
    gameMode: 'defend',         // attack | defend
    elapsed: 0,
    aiTimer: CONFIG.ai.spawnIntervalSec,
    nextProjectileId: 1,
    nextId: 1,
    limits: { popMax: CONFIG.match.popMax, aiPopMax: CONFIG.match.aiPopMax },
    stats: { trips: 0, aiSpawned: 0, playerSpawned: 0 },
  };
}

export function resetMatch(state) {
  const { w, h } = state;
  Object.assign(state, createState(w, h));
  return state;
}

export function countTeam(state, team) {
  let n = 0;
  for (const u of state.units) if (u.team === team && u.hp > 0) n++;
  return n;
}

export function spawnUnit(state, type, team, upgrades = null) {
  const cfg = CONFIG.units[type];
  const b = bonusFor(upgrades, type);
  const x = team === 0 ? CONFIG.layout.spawnInset : state.w - CONFIG.layout.spawnInset;
  const unit = {
    id: state.nextId++,
    type, team,
    x, y: state.h * CONFIG.layout.groundRatio,
    hp: cfg.hp, maxHp: cfg.hp,
    speed: cfg.speedPxPerSec,
    dmg: cfg.dmg * b.dmgMul,
    range: cfg.range,
    radius: cfg.radius,
    defMul: b.defMul,
    baseAttackIntervalSec: cfg.attackIntervalSec * b.cdMul,
    projectile: cfg.projectile,
    kind: cfg.kind,
    attackCd: 0,
    statueCd: 0,
    hitFlash: 0,
    atkAnim: 0,
    anim: 0,
    // 矿工状态机
    job: 'toMine',
    carry: 0,
    mineTimer: 0,
    mineIndex: -1,
  };
  state.units.push(unit);
  if (team === 0) state.stats.playerSpawned++;
  else state.stats.aiSpawned++;
  return unit;
}

export function isTerminal(state) {
  return state.phase === 'won' || state.phase === 'lost';
}

export function upgradeLevels(state, type) {
  return state.upgrades[type] ?? { atk: 0, def: 0, spd: 0 };
}

export function availableUnitTypes() {
  return UNIT_ORDER;
}
