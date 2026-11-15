import { CONFIG, UNIT_ORDER, bonusFor, freshUpgrades } from './config.js?v=2.8.0';

// 纯状态：不引用 DOM / canvas，可在 Node 下直接构造与推演。
export function createState(w = CONFIG.world.width, h = CONFIG.world.height, difficulty = 'normal') {
  const diff = CONFIG.match.difficulties[difficulty] ?? CONFIG.match.difficulties.normal;
  return {
    w, h,
    // v2.8：逻辑坐标固定为 world.width×world.height；窄屏只显示其中一段。
    // x 是视口左边缘在世界坐标里的位置，scale 是「世界像素 → CSS 像素」比例。
    view: {
      x: 0, scale: 1, viewW: w, viewH: h,
      cssW: 0, cssH: 0, dpr: 1,
      follow: true, followAnchor: CONFIG.world.followAnchorRatio,
    },
    phase: 'menu',              // menu | playing | paused | won | lost
    difficulty: CONFIG.match.difficulties[difficulty] ? difficulty : 'normal',
    gold: CONFIG.match.startingGold,
    aiGold: CONFIG.economy.aiStartGold,
    homeHp: CONFIG.match.statueHp,
    enemyHp: CONFIG.match.statueHp * diff.enemyStatueMul,
    units: [],
    projectiles: [],
    training: [],               // 原版：单位需要训练时间，不是点下就出场
    upgrades: freshUpgrades(),   // 玩家 Armory
    aiUpgrades: freshUpgrades(), // v2.7：敌方独立 Armory，AI 自己花钱升
    gameMode: 'defend',         // attack | defend | garrison
    elapsed: 0,
    // v2.7：AI 不再按出兵周期哐哐刷兵，而是按决策 tick 依次补矿工 → 升科技 → 出兵。
    aiDecisionTimer: CONFIG.ai.decisionIntervalSec,
    aiUpgradeTimer: CONFIG.ai.upgradeIntervalSec,
    aiPlanIndex: 0,
    // v2.8：AI 战术阶段。build 发育 → muster 集结 → assault 进攻 → regroup 重整。
    // 非 assault 阶段战斗兵守在自家半场，攒够一波才一起压过去，不再零敲碎打。
    aiPhase: 'build',
    aiPhaseSince: 0,
    aiWaveIndex: 0,
    aiWaveSize: CONFIG.ai.wave.firstWaveSize,
    fortArrowCd: 0,
    // 视觉反馈由逻辑层按秒驱动（渲染层只读），保证暂停时画面完全静止。
    fx: { homeShake: 0, enemyShake: 0, goldBurst: 0 },
    nextProjectileId: 1,
    nextId: 1,
    nextTrainingId: 1,
    limits: { popMax: CONFIG.match.popMax, aiPopMax: CONFIG.match.aiPopMax },
    stats: {
      trips: 0, aiTrips: 0, aiSpawned: 0, playerSpawned: 0,
      trained: 0, cancelled: 0, fortArrows: 0,
      aiMinersTrained: 0, aiUpgrades: 0, aiGoldEarned: 0,
      aiWaves: 0, aiMaxWaveSize: 0, aiPhaseChanges: 0,
    },
  };
}

export function resetMatch(state) {
  const { w, h, difficulty } = state;
  Object.assign(state, createState(w, h, difficulty));
  return state;
}

export function countTeam(state, team) {
  let n = 0;
  for (const u of state.units) if (u.team === team && u.hp > 0) n++;
  return n;
}

/** 人口上限把「正在训练」也算进去，否则可以靠队列绕过 20 上限。 */
export function pendingTeam(state, team) {
  let n = 0;
  for (const t of state.training) if (t.team === team) n++;
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
    hp: cfg.hp,  // 防御走受击倍率，不重复叠到血量上
    maxHp: cfg.hp,
    speed: cfg.speedPxPerSec * b.speedMul,
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
    walkPhase: 0,
    moving: false,
    inFort: false,
    // 矿工状态机
    job: 'toMine',
    carry: 0,
    mineTimer: 0,
    mineIndex: -1,
    goldPerTrip: CONFIG.economy.goldPerTrip * b.goldMul,
    mineDuration: CONFIG.economy.mineDurationSec / b.mineSpeedMul,
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
  return state.upgrades[type] ?? {};
}

export function availableUnitTypes() {
  return UNIT_ORDER;
}
