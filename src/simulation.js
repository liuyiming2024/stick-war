// 纯逻辑层：完全不碰 DOM / canvas / window。
// 所有时间量单位为秒，所有速度单位为 px/s；由 main.js 的固定步长驱动。
import { CONFIG, UNIT_ORDER } from './config.js?v=2.9.0';
import { countTeam, pendingTeam, spawnUnit } from './state.js?v=2.9.0';

const C = CONFIG;

const statueLeftLine = (s) => C.layout.statueInset + C.layout.statueHitRadius;
const statueRightLine = (s) => s.w - C.layout.statueInset - C.layout.statueHitRadius;
const fortX = () => C.layout.statueInset * C.layout.fortInsetRatio;
const difficultyOf = (s) => C.match.difficulties[s.difficulty] ?? C.match.difficulties.normal;

/** 所有矿点的实际像素坐标，供渲染层与逻辑层共用（唯一口径）。 */
export function minePositions(state) {
  return C.layout.goldMines.map((m, index) => ({ ...m, index, x: state.w * m.xRatio }));
}

/** 矿工只认自家半场的矿：先挑占用最少的，再挑离得最近的。 */
export function chooseMineIndex(state, team, fromX) {
  const own = minePositions(state).filter((m) => m.side === team);
  if (!own.length) return -1;
  const load = new Array(C.layout.goldMines.length).fill(0);
  for (const u of state.units) {
    if (u.hp > 0 && u.kind === 'miner' && u.team === team &&
        u.job !== 'toHome' && u.mineIndex >= 0 && u.mineIndex < load.length) {
      load[u.mineIndex]++;
    }
  }
  let best = own[0];
  for (const m of own) {
    const closer = Math.abs(m.x - fromX) < Math.abs(best.x - fromX);
    if (load[m.index] < load[best.index] ||
        (load[m.index] === load[best.index] && closer)) best = m;
  }
  return best.index;
}

const mineXByIndex = (state, index) => {
  const m = C.layout.goldMines[index];
  return m ? state.w * m.xRatio : state.w * 0.5;
};

export function minerHomeX(state, team) {
  return team === 0 ? statueLeftLine(state) : statueRightLine(state);
}

function projectileY(state, u) {
  return state.h * C.layout.groundRatio - state.h * C.layout.unitHeightRatio * 0.62;
}

// snap=true 用于固定目标点：到达时吸附到精确坐标，避免不同 dt 留下残差。
function moveToward(u, tx, dt, eps = 2, snap = false) {
  const d = tx - u.x;
  if (Math.abs(d) <= eps) { if (snap) u.x = tx; return true; }
  u.x += Math.sign(d) * Math.min(Math.abs(d), u.speed * dt);
  if (Math.abs(tx - u.x) <= eps) { if (snap) u.x = tx; return true; }
  return false;
}

/** 原版的克制关系：远程打巨人和雕像减伤、矛士盾挡箭、弓箭手克剑士。 */
function damageMultiplier(attackerType, projectileKind, target) {
  const m = C.combat.damageMatrix;
  let mul = 1;
  if (projectileKind) {
    if (target.type === 'giant') mul *= m.rangedVsGiant;
    if (target.type === 'spear') mul *= m.rangedVsSpearton;
  }
  if (attackerType === 'archer' && target.type === 'sword') mul *= m.archerVsSwordwrath;
  return mul;
}

function applyDamage(target, dmg, events, attackerType = null, projectileKind = null) {
  if (target.inFort) return;  // Garrison：堡内单位安全
  const mul = damageMultiplier(attackerType, projectileKind, target);
  target.hp -= dmg * mul * target.defMul;
  target.hitFlash = C.combat.hitFlashSec;
  events.push({ type: 'hit', team: target.team, mul });
}

function nearestEnemy(state, u) {
  let best = null, minD = Infinity;
  for (const o of state.units) {
    if (o.team === u.team || o.hp <= 0) continue;
    const d = Math.abs(o.x - u.x);
    if (d < minD) { minD = d; best = o; }
  }
  return best ? { unit: best, dist: minD } : null;
}

function makeProjectile(state, u, target, overrides = {}) {
  return {
    id: state.nextProjectileId++,
    team: u.team,
    kind: u.projectile ?? 'arrow',
    x: u.x, y: projectileY(state, u),
    tx: target.x, ty: projectileY(state, target),
    targetId: target.id,
    dmg: u.dmg,
    speed: C.combat.projectileSpeedPxPerSec,
    ttl: C.combat.projectileTtlSec,
    age: 0,
    dead: false,
    attackerType: u.type,
    projectileKind: u.projectile,
    vsStatueMul: u.projectile ? C.combat.damageMatrix.rangedVsStatue : 1,
    ...overrides,
  };
}

function fire(state, u, target, events) {
  if (u.projectile) {
    state.projectiles.push(makeProjectile(state, u, target));
    events.push({ type: 'shoot', kind: u.projectile });
  } else {
    applyDamage(target, u.dmg, events, u.type, null);
  }
}

function tickFighter(state, u, dt, events) {
  const line = u.team === 0 ? statueRightLine(state) : statueLeftLine(state);
  const found = nearestEnemy(state, u);
  const target = found?.unit ?? null;

  if (target && found.dist <= u.range + u.radius + target.radius) {
    if (u.attackCd <= 0) {
      fire(state, u, target, events);
      u.attackCd = u.baseAttackIntervalSec;
      u.atkAnim = C.combat.attackAnimSec;
    }
  } else if (target) {
    moveToward(u, target.x, dt, Math.max(2, u.range * 0.5));
  } else {
    const alreadyCrossed = u.team === 0 ? u.x >= line : u.x <= line;
    if (!alreadyCrossed) {
      // 三条指令：Attack 推到敌方雕像 / Defend 守驻守线 / Garrison 撤回堡内
      const goal = u.team === 0
        ? (state.gameMode === 'attack' ? statueRightLine(state)
           : state.gameMode === 'garrison' ? fortX()
           : state.w * C.layout.defendLineRatio)
        : aiGoalLine(state);  // v2.8：只有 assault 才压到玩家雕像，其余阶段守自家半场
      moveToward(u, goal, dt, 3, true);
    }
  }

  const crossed = u.team === 0 ? u.x >= line : u.x <= line;
  if (crossed && !target && u.statueCd <= 0) {
    const dmg = u.dmg * C.match.statueDamageMul *
      (u.projectile ? C.combat.damageMatrix.rangedVsStatue : 1);
    if (u.team === 0) state.enemyHp -= dmg;
    else state.homeHp -= dmg;
    state.fx[u.team === 0 ? 'enemyShake' : 'homeShake'] = C.animation.statueShakeSec;
    u.statueCd = C.match.statueAttackIntervalSec;
    u.atkAnim = C.combat.attackAnimSec;
    events.push({ type: 'statueHit', team: u.team, dmg });
  }
}

// 阶段切换时结转剩余 dt：挖掘完成/交付落在步中间，剩下的时间继续用于行走。
function tickMiner(state, u, dt, events, diff) {
  const home = minerHomeX(state, u.team);
  // v2.8：背着矿走得慢，回营这一段才像「运」而不是瞬移。
  // 矿点也已从贴着雕像移到中场方向，最短单程 ≥ world.width*minMineHomeDistanceRatio。
  const speed = u.speed * (u.carry > 0 ? C.economy.carrySpeedMul : 1);
  let remaining = dt;
  let guard = 0;
  while (remaining > 1e-9 && guard++ < 8) {
    if (u.job === 'toMine') {
      if (u.mineIndex < 0) u.mineIndex = chooseMineIndex(state, u.team, u.x);
      const target = mineXByIndex(state, u.mineIndex);
      const t = Math.abs(target - u.x) / speed;
      if (t <= remaining + 1e-9) {
        u.x = target;
        u.job = 'mining';
        u.mineTimer = u.mineDuration;
        remaining -= t;
      } else {
        u.x += Math.sign(target - u.x) * speed * remaining;
        remaining = 0;
      }
    } else if (u.job === 'mining') {
      if (u.mineTimer <= remaining + 1e-9) {
        remaining -= u.mineTimer;
        u.mineTimer = 0;
        u.carry = u.goldPerTrip;
        u.job = 'toHome';
      } else {
        u.mineTimer -= remaining;
        remaining = 0;
      }
    } else {
      const t = Math.abs(home - u.x) / speed;
      if (t <= remaining + 1e-9) {
        u.x = home;
        if (u.carry > 0) {
          if (u.team === 0) {
            state.gold += u.carry;
            state.stats.trips++;
          } else {
            const earned = u.carry * diff.aiIncomeMul;
            state.aiGold += earned;
            state.stats.aiTrips++;
            state.stats.aiGoldEarned += earned;
          }
          state.fx.goldBurst = C.animation.goldBurstSec;
          events.push({ type: 'gold', amount: u.carry, team: u.team });
        }
        u.carry = 0;
        u.job = 'toMine';
        u.mineIndex = -1;
        remaining -= t;
      } else {
        u.x += Math.sign(home - u.x) * speed * remaining;
        remaining = 0;
      }
    }
  }
}

function tickProjectiles(state, dt, events) {
  for (const p of state.projectiles) {
    const target = state.units.find((u) => u.id === p.targetId && u.hp > 0 && !u.inFort);
    if (target) { p.tx = target.x; p.ty = projectileY(state, target); }
    const dx = p.tx - p.x, dy = p.ty - p.y;
    const dist = Math.hypot(dx, dy);
    const travel = p.speed * dt;
    p.age += dt;
    p.ttl -= dt;
    if (dist <= Math.max(travel, C.combat.projectileHitRadius)) {
      if (target) applyDamage(target, p.dmg, events, p.attackerType, p.projectileKind);
      p.dead = true;
    } else if (dist > 0) {
      p.x += (dx / dist) * travel;
      p.y += (dy / dist) * travel;
    }
    if (p.ttl <= 0) p.dead = true;
  }
  state.projectiles = state.projectiles.filter((p) => !p.dead);
}

// Garrison：每 3 个堡内单位折算 1 名城堡弓箭手，从雕像处放箭。
function tickFortArrows(state, dt, events) {
  if (state.gameMode !== 'garrison') return;
  const fortCount = countTeam(state, 0);
  if (fortCount <= 0) return;
  const shots = Math.max(1, Math.floor(fortCount / C.match.fortArcherPerUnits));
  state.fortArrowCd -= dt;
  if (state.fortArrowCd > 0) return;
  state.fortArrowCd += C.match.fortArcherIntervalSec / shots;

  const originX = C.layout.statueInset;
  const range = state.w * C.match.fortArcherRangeRatio;
  const candidates = state.units.filter((u) =>
    u.team === 1 && u.hp > 0 && Math.abs(u.x - originX) <= range);
  if (!candidates.length) return;
  const target = candidates.reduce((a, b) =>
    Math.abs(a.x - originX) <= Math.abs(b.x - originX) ? a : b);
  const shooter = {
    team: 0, type: 'fort', projectile: 'arrow', dmg: C.match.fortArcherDamage,
    x: originX, y: state.h * C.layout.groundRatio,
  };
  state.projectiles.push(makeProjectile(state, shooter, target, {
    x: originX, y: state.h * C.layout.groundRatio - state.h * C.layout.unitHeightRatio,
  }));
  state.stats.fortArrows++;
  events.push({ type: 'fortArrow', target: target.type });
}

// 同队轻推，避免 20 个单位叠在一个像素上。
function separate(units, dt) {
  const push = C.combat.separationPxPerSec * dt;
  for (let i = 0; i < units.length; i++) {
    const a = units[i];
    if (a.hp <= 0) continue;
    for (let j = i + 1; j < units.length; j++) {
      const b = units[j];
      if (b.hp <= 0 || b.team !== a.team) continue;
      const gap = a.radius + b.radius;
      const d = b.x - a.x;
      if (Math.abs(d) < gap) {
        const step = Math.min(push, (gap - Math.abs(d)) / 2);
        const dir = d >= 0 ? 1 : -1;
        a.x -= step * dir;
        b.x += step * dir;
      }
    }
  }
}

function enqueue(state, type, team, upgrades, events,
  trainSec = C.units[type].trainSec, paid = null) {
  const t = {
    id: state.nextTrainingId++,
    type, team,
    due: state.elapsed + trainSec,
    upgrades,
    // v2.9：玩家订单记录「金币 / 宝石」实扣构成，取消时按原路退回，
    // 避免「用宝石下单 → 取消退金币」把无限宝石洗成金币。
    paid,
  };
  state.training.push(t);
  events.push({ type: 'training', team, unit: type, id: t.id });
  return t;
}

// ── v2.9：宝石 = 免费、无限、可当金币花 ────────────────────────────────
/** 可购买力：金币 + 宝石按 goldPerGem 折算。UI 按钮禁用与下单共用这一个口径。 */
export function canAfford(state, amount) {
  const rest = Math.max(0, amount - Math.min(state.gold, amount));
  const gemsNeeded = rest <= 1e-9 ? 0 : Math.ceil((rest - 1e-9) / C.gems.goldPerGem);
  return state.gems + 1e-9 >= gemsNeeded;
}

/** 领取宝石：无冷却、无上限、不花任何东西，可无限次调用。 */
export function grantGems(state) {
  const amount = C.gems.grantAmount;
  state.gems += amount;
  state.stats.gemsGranted++;
  return { ok: true, amount, total: state.gems };
}

/**
 * 统一支付：优先扣金币，不足部分由宝石按 goldPerGem 向上取整抵扣。
 * 返回实扣构成（供退款）；买不起返回 null。
 * AI 侧不走这里——它仍只花 aiGold，不受玩家宝石影响。
 */
function pay(state, amount) {
  if (!canAfford(state, amount)) return null;
  const fromGold = Math.min(state.gold, amount);
  const rest = Math.max(0, amount - fromGold);
  const gems = rest <= 1e-9 ? 0 : Math.ceil((rest - 1e-9) / C.gems.goldPerGem);
  if (state.gems + 1e-9 < gems) return null;
  state.gold -= fromGold;
  state.gems -= gems;
  if (gems > 0) {
    state.stats.gemPayments++;
    state.stats.gemsSpent += gems;
  }
  return { fromGold, gems, amount };
}

// ── v2.7：敌方发育 ──────────────────────────────────────────────────────
// 旧实现是「每 aiInterval 秒凭空扣金币造一个兵」，收入几乎全来自 aiGoldPerSec
// 被动加成，AI 从不造矿工、从不升级——观感就是哐哐派兵。
// 现在 AI 与玩家共用同一套经济：真实矿工跑 minePositions→交付→aiGold，
// 独立 Armory 按 upgradePlan 花钱升级，出兵走训练队列且受人口/预算约束。
// 每个决策 tick 只执行一个动作，优先级 补矿工 → 升科技 → 出兵。
function aiMinerTarget(state) {
  const g = C.ai;
  const t = Math.min(1, state.elapsed / g.rampSec);
  return Math.round(g.minerTargetStart + (g.minerTargetEnd - g.minerTargetStart) * t);
}

function aiMinerCount(state) {
  let n = 0;
  for (const u of state.units) {
    if (u.team === 1 && u.kind === 'miner' && u.hp > 0) n++;
  }
  for (const t of state.training) {
    if (t.team === 1 && C.units[t.type].kind === 'miner') n++;
  }
  return n;
}

function aiPopulation(state) {
  return countTeam(state, 1) + pendingTeam(state, 1);
}

/** 已出场的 AI 战斗兵（不含矿工、不含训练队列）。 */
function aiFighterCount(state) {
  let n = 0;
  for (const u of state.units) {
    if (u.team === 1 && u.kind !== 'miner' && u.hp > 0) n++;
  }
  return n;
}

/** 训练队列里的 AI 战斗兵，用于判断「这波还要不要再下单」。 */
function aiPendingFighters(state) {
  let n = 0;
  for (const t of state.training) {
    if (t.team === 1 && C.units[t.type].kind !== 'miner') n++;
  }
  return n;
}

/** v2.8：按玩家兵种构成调整出兵权重，堆得越多克制倾向越强（有饱和上限）。 */
export function aiCounterWeight(state, aiType) {
  let w = C.units[aiType].aiWeight;
  const sat = C.ai.counterSaturation;
  const counts = new Map();
  for (const u of state.units) {
    if (u.team === 0 && u.hp > 0 && u.kind !== 'miner') {
      counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
    }
  }
  for (const [a, p, mul] of C.ai.counterMatrix) {
    if (a !== aiType) continue;
    const n = counts.get(p) ?? 0;
    if (n > 0) w *= 1 + (mul - 1) * Math.min(1, n / sat);
  }
  return w;
}

/** 非进攻阶段的 AI 守线：与玩家 defendLineRatio 对称，落在自家半场。 */
function aiGoalLine(state) {
  return state.aiPhase === 'assault'
    ? statueLeftLine(state)
    : state.w * (1 - C.layout.defendLineRatio);
}

function setAiPhase(state, phase, events) {
  if (state.aiPhase === phase) return;
  state.aiPhase = phase;
  state.aiPhaseSince = state.elapsed;
  state.stats.aiPhaseChanges++;
  if (phase === 'assault') {
    state.stats.aiWaves++;
    state.stats.aiMaxWaveSize = Math.max(state.stats.aiMaxWaveSize, state.aiWaveSize);
  }
  events.push({ type: 'aiPhase', phase, wave: state.aiWaveIndex });
}

/**
 * 波次状态机：每个决策 tick 先流转阶段，再决定这一个动作。
 * build    —— 先铺经济，达到最短时间且矿工达标才允许集结
 * muster   —— 逐个下单直到「已出场 + 排队」够一波，等实际出场到 launchRatio 才发起进攻
 * assault  —— 不再出兵，让这一波一起推；打残或超时即重整
 * regroup  —— 补矿工/买科技，冷却结束后开下一波（波容递增）
 */
function updateAiPhase(state, events) {
  const g = C.ai.wave;
  const fighters = aiFighterCount(state);
  const queued = aiPendingFighters(state);
  const dwell = state.elapsed - state.aiPhaseSince;

  switch (state.aiPhase) {
    case 'build':
      if (state.elapsed >= g.buildMinSec && aiMinerCount(state) >= aiMinerTarget(state)) {
        setAiPhase(state, 'muster', events);
      }
      break;
    case 'muster': {
      const launched = fighters >= Math.max(1, Math.floor(state.aiWaveSize * g.launchRatio));
      if (launched) setAiPhase(state, 'assault', events);
      else if (dwell >= g.musterTimeoutSec && fighters >= 1) {
        setAiPhase(state, 'assault', events);  // 钱不够时别把状态机卡死
      }
      break;
    }
    case 'assault': {
      const wiped = fighters <= Math.max(1, Math.floor(state.aiWaveSize * g.retreatRatio));
      if (wiped || dwell >= g.assaultTimeoutSec) setAiPhase(state, 'regroup', events);
      break;
    }
    case 'regroup':
      if (dwell >= g.regroupSec) {
        state.aiWaveIndex++;
        state.aiWaveSize = Math.min(g.maxWaveSize,
          g.firstWaveSize + state.aiWaveIndex * g.waveSizeGrowth);
        setAiPhase(state, 'muster', events);
      }
      break;
    default:
      setAiPhase(state, 'build', events);
  }
  // 供 aiDecide 判断 muster 是否还该继续下单
  return fighters + queued;
}

/** 下单统一入口：真扣钱、按难度缩放训练时长、快照 AI 自己的 Armory。 */
function aiEnqueue(state, type, diff, events) {
  const cfg = C.units[type];
  state.aiGold -= cfg.cost;
  // bonusFor 期望 { [type]: levels } 结构，不能只传单层 level 对象。
  const snapshot = { [type]: { ...state.aiUpgrades[type] } };
  const t = enqueue(state, type, 1, snapshot, events, cfg.trainSec * diff.aiSpawnMul);
  if (cfg.kind === 'miner') state.stats.aiMinersTrained++;
  return t;
}

function tryAiUpgrade(state, events) {
  const g = C.ai;
  if (state.aiUpgradeTimer > 0 || state.aiPlanIndex >= g.upgradePlan.length) return false;
  const [type, stat] = g.upgradePlan[state.aiPlanIndex];
  const lv = state.aiUpgrades[type];
  if (!lv || !(stat in lv) || lv[stat] >= C.upgrade.maxLevel) {
    state.aiPlanIndex++;  // 配置写错/满级时跳过，不卡死整条科技线
    return false;
  }
  if (state.aiGold < C.upgrade.cost + g.upgradeReserveGold) return false;
  state.aiGold -= C.upgrade.cost;
  lv[stat]++;
  state.aiPlanIndex++;
  state.aiUpgradeTimer = g.upgradeIntervalSec;
  state.stats.aiUpgrades++;
  events.push({ type: 'aiUpgrade', unit: type, stat, level: lv[stat] });
  return true;
}

/** 敌方发育快照：UI 顶栏、结算统计与自动化断言共用这一个口径。 */
export function aiGrowthInfo(state) {
  return {
    miners: aiMinerCount(state),
    target: aiMinerTarget(state),
    upgrades: state.stats.aiUpgrades,
    gold: state.aiGold,
    trips: state.stats.aiTrips,
    earned: state.stats.aiGoldEarned,
    planIndex: state.aiPlanIndex,
    minersTrained: state.stats.aiMinersTrained,
    phase: state.aiPhase,
    phaseSince: state.aiPhaseSince,
    waveIndex: state.aiWaveIndex,
    waveSize: state.aiWaveSize,
    fighters: aiFighterCount(state),
    queued: aiPendingFighters(state),
    waves: state.stats.aiWaves,
    maxWaveSize: state.stats.aiMaxWaveSize,
    phaseChanges: state.stats.aiPhaseChanges,
  };
}

function aiDecide(state, rng, events, diff) {
  const g = C.ai;
  const musterTotal = updateAiPhase(state, events);
  if (aiPopulation(state) >= state.limits.aiPopMax) return;

  // 1) 补矿工：任何阶段都最高优先，留一笔恢复经济的钱，被打掉会自动补回来。
  if (aiMinerCount(state) < aiMinerTarget(state) &&
      state.aiGold >= C.units.miner.cost + g.minerReserveGold) {
    aiEnqueue(state, 'miner', diff, events);
    return;
  }
  // 2) 科技：进攻途中不买，其余阶段按 upgradePlan 顺序买（aiUpgradeTimer 节流）。
  if (state.aiPhase !== 'assault' && tryAiUpgrade(state, events)) return;

  // 3) 军事：只有集结阶段下单，攒够一波就停手；进攻/重整阶段不再零敲碎打。
  if (state.aiPhase !== 'muster') return;
  if (musterTotal >= state.aiWaveSize) return;
  const pool = UNIT_ORDER.filter((key) => {
    const u = C.units[key];
    return u.kind !== 'miner' && u.aiWeight > 0 &&
      (u.aiUnlockSec === null || state.elapsed >= u.aiUnlockSec);
  });
  if (!pool.length) return;
  // 针对性反制：玩家堆剑士 → 抬弓箭手；玩家堆远程 → 抬矛士/巨人/剑士。
  const type = rng.pickWeighted(pool, (k) => aiCounterWeight(state, k));
  if (state.aiGold < C.units[type].cost + g.militaryReserveGold) return;
  aiEnqueue(state, type, diff, events);
}

function tickTraining(state, dt, events) {
  if (!state.training.length) return [];
  const fresh = [];
  const done = [];
  for (const t of state.training) {
    // 容差 1e-6：elapsed 浮点累加误差约 1e-11，过窄会跨步漂移。
    if (t.due <= state.elapsed + 1e-6) {
      const u = spawnUnit(state, t.type, t.team, t.upgrades);
      // 单位从 due 时刻起才存在，本步只能消费 (elapsed - due)，
      // 否则 dt=1/60 会比 dt=1/120 多走一个步长，整局轨迹漂移。
      fresh.push({ unit: u, available: Math.min(dt, Math.max(0, state.elapsed - t.due)) });
      state.stats.trained++;
      events.push({ type: 'trained', team: t.team, unit: t.type });
      done.push(t.id);
    }
  }
  if (done.length) {
    const set = new Set(done);
    state.training = state.training.filter((t) => !set.has(t.id));
  }
  return fresh;
}

/** 推进一个固定步长。返回本步事件，供 UI 层做提示。 */
export function step(state, dt, rng) {
  const events = [];
  if (state.phase !== 'playing' || !(dt > 0)) return events;
  const diff = difficultyOf(state);

  state.elapsed += dt;
  // 视觉反馈计时器按秒递减：暂停时 step 不跑，所有相位冻结。
  for (const k of Object.keys(state.fx)) state.fx[k] = Math.max(0, state.fx[k] - dt);
  // 原版：城堡每秒 1 金，矿工补齐其余。v2.7 把 aiGoldPerSec 从 7 降到 1.5，
  // AI 的主要收入改成自己训练的矿工真实往返交付；难度只放大矿工收益。
  state.gold += C.economy.castleGoldPerSec * dt;
  state.aiGold += (C.economy.castleGoldPerSec + C.economy.aiGoldPerSec) * diff.aiIncomeMul * dt;

  // 决策 tick：一次只做一个动作（补矿工 / 升科技 / 出兵），不再按周期硬刷兵。
  state.aiUpgradeTimer = Math.max(0, state.aiUpgradeTimer - dt);
  state.aiDecisionTimer -= dt;
  if (state.aiDecisionTimer <= 0) {
    state.aiDecisionTimer += C.ai.decisionIntervalSec;
    aiDecide(state, rng, events, diff);
  }
  const fresh = tickTraining(state, dt, events);
  const freshTime = new Map(fresh.map((f) => [f.unit.id, f.available]));

  const inGarrison = state.gameMode === 'garrison';
  for (const u of state.units) {
    const udt = freshTime.get(u.id) ?? dt;
    u.attackCd = Math.max(0, u.attackCd - udt);
    u.statueCd = Math.max(0, u.statueCd - udt);
    u.hitFlash = Math.max(0, u.hitFlash - udt);
    u.atkAnim = Math.max(0, u.atkAnim - udt);
    u.anim += udt;
    u.inFort = inGarrison && u.team === 0 &&
      u.x <= fortX() + C.economy.mineArriveEps;
  }

  for (const u of state.units) {
    if (u.hp <= 0) continue;
    const udt = freshTime.get(u.id) ?? dt;
    const x0 = u.x;
    // 原版 Garrison：全军撤回堡内，不追击、不挖矿，输出交给城堡射手。
    // 否则单位会因为 nearestEnemy 自己走出安全区，驻堡就失去意义。
    if (state.gameMode === 'garrison' && u.team === 0) {
      moveToward(u, fortX(), udt, 3, true);
      u.inFort = u.x <= fortX() + C.economy.mineArriveEps;
    } else if (u.kind === 'miner') {
      tickMiner(state, u, udt, events, diff);
    } else {
      tickFighter(state, u, udt, events);
    }
    // 步态相位只在真正移动时累加；静止单位只保留呼吸，不摆腿。
    u.moving = Math.abs(u.x - x0) > 1e-9;
    if (u.moving) u.walkPhase += udt * C.animation.walkHz * Math.PI * 2;
  }

  tickFortArrows(state, dt, events);
  tickProjectiles(state, dt, events);
  separate(state.units, dt);

  // filter 而非遍历中 splice：渲染排序不再能改变物理遍历顺序。
  const before = state.units.length;
  state.units = state.units.filter((u) => u.hp > 0 && u.x > -60 && u.x < state.w + 60);
  if (state.units.length < before) events.push({ type: 'death' });

  if (state.homeHp <= 0) {
    state.homeHp = 0;
    state.phase = 'lost';
    events.push({ type: 'end', result: 'lost' });
  } else if (state.enemyHp <= 0) {
    state.enemyHp = 0;
    state.phase = 'won';
    events.push({ type: 'end', result: 'won' });
  }
  return events;
}

/** 下单即扣钱、进入训练队列；训练完成才出场。升级在下单时快照。 */
export function spawnPlayer(state, type) {
  if (state.phase !== 'playing') return { ok: false, reason: '未在对局中' };
  const cfg = C.units[type];
  if (!cfg) return { ok: false, reason: '未知兵种' };
  if (!canAfford(state, cfg.cost)) return { ok: false, reason: '金币/宝石不够，点底栏宝石可免费领' };
  if (countTeam(state, 0) + pendingTeam(state, 0) >= state.limits.popMax) {
    return { ok: false, reason: '人口已满' };
  }
  const paid = pay(state, cfg.cost);
  if (!paid) return { ok: false, reason: '金币/宝石不够，点底栏宝石可免费领' };
  // bonusFor 取 upgrades[type]，必须是 { [type]: levels }；只传单层 level 对象
  // 会让升级静默失效（旧实现的 bug），AI 侧 aiEnqueue 同样按这个结构快照。
  const snapshot = { [type]: { ...state.upgrades[type] } };
  const t = enqueue(state, type, 0, snapshot, [], cfg.trainSec, paid);
  return { ok: true, trainingId: t.id, trainSec: cfg.trainSec, paid };
}

/** 原版：再点一次图标可取消训练并退款。 */
export function cancelTraining(state, id) {
  const idx = state.training.findIndex((t) => t.id === id);
  if (idx < 0) return { ok: false, reason: '该训练已结束' };
  const t = state.training[idx];
  const refund = C.units[t.type].cost;
  if (t.team === 1) {
    state.aiGold += refund;                 // AI 订单仍只花 aiGold
  } else if (t.paid) {
    // 原路退回：金币部分回金币、宝石部分回宝石，不能把无限宝石洗成金币。
    state.gold += t.paid.fromGold;
    state.gems += t.paid.gems;
  } else {
    state.gold += refund;                   // 兼容测试里手工构造的旧订单
  }
  state.training.splice(idx, 1);
  state.stats.cancelled++;
  return { ok: true, refund, type: t.type };
}

export function doUpgrade(state, type, stat) {
  if (state.phase !== 'playing') return { ok: false, reason: '未在对局中' };
  const lv = state.upgrades[type];
  if (!lv || !(stat in lv)) return { ok: false, reason: '未知升级项' };
  if (lv[stat] >= C.upgrade.maxLevel) return { ok: false, reason: '已满级' };
  if (!canAfford(state, C.upgrade.cost)) {
    return { ok: false, reason: '金币/宝石不足，点底栏宝石可免费领' };
  }
  const paid = pay(state, C.upgrade.cost);
  if (!paid) return { ok: false, reason: '金币/宝石不足，点底栏宝石可免费领' };
  lv[stat]++;
  return { ok: true, paid };
}

export function setMode(state, mode) {
  if (!['attack', 'defend', 'garrison'].includes(mode)) return false;
  state.gameMode = mode;
  if (mode !== 'garrison') state.fortArrowCd = 0;
  return true;
}

export function setDifficulty(state, difficulty) {
  if (!C.match.difficulties[difficulty]) return false;
  state.difficulty = difficulty;
  return true;
}
