// 纯逻辑层：完全不碰 DOM / canvas / window。
// 所有时间量单位为秒，所有速度单位为 px/s；由 main.js 的固定步长驱动。
import { CONFIG, UNIT_ORDER } from './config.js?v=2.11.0';
import { countTeam, pendingTeam, spawnUnit } from './state.js?v=2.11.0';

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
  u.x += Math.sign(d) * Math.min(Math.abs(d), effSpeed(u) * dt);
  if (Math.abs(tx - u.x) <= eps) { if (snap) u.x = tx; return true; }
  return false;
}

// ── v2.11：状态效果 ─────────────────────────────────────────────────────
/** 中毒减速是唯一影响移速的状态；所有移动都走这一个口径。 */
function effSpeed(u) {
  return u.speed * (u.fx?.poison > 0 ? C.effects.poisonSlowMul : 1);
}

/** 给目标挂一个状态；重复命中取「剩余时长最大值」，不无限叠加。 */
function applyStatus(state, target, kind, seconds, events) {
  if (!target?.fx || !(kind in target.fx)) return;
  if (target.fx[kind] < seconds) target.fx[kind] = seconds;
  if (kind === 'stun') state.stats.stuns++;
  events.push({ type: 'status', kind, team: target.team });
}

/** DoT 不走 applyDamage：避免克制矩阵/防御倍率重复计算，也避免倒刺无限反弹。 */
function applyDot(target, dmg, events) {
  if (!target || target.hp <= 0 || target.inFort) return;
  target.hp -= dmg;
  events.push({ type: 'dot', team: target.team, dmg });
}

/**
 * 每 dotTickSec 结算一次 DoT（而不是每帧），保证 60/120Hz 结果一致。
 * fx 各状态按秒递减；暂停时 step 不跑，画面与状态一起冻结。
 */
function tickEffects(state, dt, events) {
  const E = C.effects;
  for (const u of state.units) {
    if (u.hp <= 0) continue;
    u.dotAcc += dt;
    const tick = u.dotAcc >= E.dotTickSec;
    if (tick) u.dotAcc -= E.dotTickSec;
    let dmg = 0;
    if (u.fx.burn > 0) { u.fx.burn = Math.max(0, u.fx.burn - dt); if (tick) dmg += E.burnDps * E.dotTickSec; }
    if (u.fx.poison > 0) { u.fx.poison = Math.max(0, u.fx.poison - dt); if (tick) dmg += E.poisonDps * E.dotTickSec; }
    if (u.fx.bleed > 0) { u.fx.bleed = Math.max(0, u.fx.bleed - dt); if (tick) dmg += E.bleedDps * E.dotTickSec; }
    if (u.fx.stun > 0) u.fx.stun = Math.max(0, u.fx.stun - dt);
    if (dmg > 0) {
      applyDot(u, dmg, events);
      state.stats.dotTicks++;
      state.stats.dotDamage += dmg;
    }
  }
}

/** 召唤物 ttl 递减，到点直接移除（不计入阵亡统计之外的任何口径）。 */
function tickSummons(state, dt, events) {
  for (const u of state.units) {
    if (!u.summoned || u.hp <= 0) continue;
    u.ttl -= dt;
    if (u.ttl <= 0) {
      u.hp = 0;
      events.push({ type: 'summonExpire', team: u.team });
    }
  }
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
    // v2.11：命中后要施加的状态 / 溅射 / 眩晕，全部由发射方决定。
    ammoEffect: null,
    ammoDmgMul: 1,
    splash: false,
    stun: false,
    ...overrides,
  };
}

/** 只有我方弓箭手与城堡射手吃全局弹药；AI 永远普通箭，避免难度被玩家配置带偏。 */
function ammoFor(state, u, kind) {
  if (u.team !== 0 || kind !== 'arrow' || state.ammo === 'plain') return null;
  return C.ammo.kinds[state.ammo] ?? null;
}

function fire(state, u, target, events) {
  if (u.projectile) {
    const am = ammoFor(state, u, u.projectile);
    const isMagic = u.type === 'wizard';
    const p = makeProjectile(state, u, target, {
      ammoEffect: am?.effect ?? null,
      ammoDmgMul: am?.dmgMul ?? 1,
      splash: isMagic && C.skills.wizardStun,
      stun: isMagic && C.skills.wizardStun,
    });
    state.projectiles.push(p);
    events.push({ type: 'shoot', kind: u.projectile, ammo: state.ammo });
  } else {
    applyDamage(target, u.dmg, events, u.type, null);
  }
}

/** 原版 Spearton 投矛：独立于近战冷却的一次远程重击。 */
function trySpearThrow(state, u, dt, events) {
  if (u.type !== 'spear') return;
  u.throwCd -= dt;
  if (u.throwCd > 0) return;
  const dir = u.team === 0 ? 1 : -1;
  const target = state.units.find((o) =>
    o.team !== u.team && o.hp > 0 && !o.inFort &&
    (o.x - u.x) * dir > 0 && Math.abs(o.x - u.x) <= C.skills.spearThrowRangePx);
  if (!target) return;                       // 没目标就不重置，等敌人进入射程
  u.throwCd = C.skills.spearThrowIntervalSec;
  state.projectiles.push(makeProjectile(state, u, target, {
    kind: 'javelin',
    dmg: u.dmg * C.skills.spearThrowDmgMul,
    projectileKind: 'javelin',
  }));
  state.stats.spearThrows++;
  u.atkAnim = C.combat.attackAnimSec;
  events.push({ type: 'spearThrow', team: u.team });
}

/** 原版 Magikill 召唤：弱化剑士，占人口但不计入出兵统计，ttl 到点消失。 */
function trySummon(state, u, dt, events) {
  if (u.type !== 'wizard' || u.summoned) return;
  if (C.skills.summonPlayerOnly && u.team !== 0) return;
  u.summonCd -= dt;
  if (u.summonCd > 0) return;
  const alive = state.units.filter((o) => o.summoned && o.team === u.team && o.hp > 0).length;
  if (alive >= C.skills.summonMax) return;
  u.summonCd = C.skills.summonIntervalSec;
  const minion = spawnUnit(state, 'sword', u.team, null);
  if (u.team === 0) state.stats.playerSpawned--;
  else state.stats.aiSpawned--;
  const base = C.units.sword;
  minion.summoned = true;
  minion.ttl = C.skills.summonTtlSec;
  minion.hp = base.hp * C.skills.summonHpMul;
  minion.maxHp = minion.hp;
  minion.dmg = base.dmg * C.skills.summonDmgMul;
  minion.x = Math.min(state.w, Math.max(0, u.x + (u.team === 0 ? 42 : -42)));
  minion.y = u.y;
  state.stats.summons++;
  events.push({ type: 'summon', team: u.team });
}

/**
 * v2.10：被玩家接管的单位只把「往哪走」交给 axis，攻击判定与拆雕像仍与
 * 自动单位完全同源（同一套 fire / statueHit），避免出现两套伤害口径。
 */
function moveChampion(state, u, dt) {
  const axis = state.control.axis;
  if (!axis) return;
  const speed = effSpeed(u) * C.control.moveSpeedMul;
  const nx = Math.min(state.w, Math.max(0, u.x + axis * speed * dt));
  state.control.distance += Math.abs(nx - u.x);
  u.x = nx;
}

function tickFighter(state, u, dt, events, manual = false) {
  // v2.11：原版兵种技能独立于普通攻击冷却，且接管单位同样保留。
  trySpearThrow(state, u, dt, events);
  trySummon(state, u, dt, events);
  const line = u.team === 0 ? statueRightLine(state) : statueLeftLine(state);
  const found = nearestEnemy(state, u);
  const target = found?.unit ?? null;

  if (target && found.dist <= u.range + u.radius + target.radius) {
    if (u.attackCd <= 0) {
      fire(state, u, target, events);
      u.attackCd = u.baseAttackIntervalSec;
      u.atkAnim = C.combat.attackAnimSec;
    }
  } else if (manual) {
    moveChampion(state, u, dt);   // 有敌人但够不着时也不自动追击
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
  const speed = effSpeed(u) * (u.carry > 0 ? C.economy.carrySpeedMul : 1);
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
      if (target) {
        applyDamage(target, p.dmg * p.ammoDmgMul, events, p.attackerType, p.projectileKind);
        const secs = { burn: C.effects.burnSec, poison: C.effects.poisonSec, bleed: C.effects.bleedSec };
        if (p.ammoEffect && secs[p.ammoEffect]) {
          applyStatus(state, target, p.ammoEffect, secs[p.ammoEffect], events);
        }
        if (p.stun) applyStatus(state, target, 'stun', C.effects.stunSec, events);
        if (p.splash) {
          // 原版 Magikill 法球：命中点附近一片敌人吃溅射，不再二次挂眩晕。
          for (const o of state.units) {
            if (o.team !== target.team || o.hp <= 0 || o.id === target.id || o.inFort) continue;
            if (Math.abs(o.x - target.x) <= C.skills.wizardSplashRadiusPx) {
              applyDamage(o, p.dmg * C.skills.wizardSplashMul, events, p.attackerType, null);
            }
          }
          events.push({ type: 'splash', team: p.team });
        }
      }
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
  const am = C.ammo.kinds[state.ammo];
  state.projectiles.push(makeProjectile(state, shooter, target, {
    x: originX, y: state.h * C.layout.groundRatio - state.h * C.layout.unitHeightRatio,
    ammoEffect: am?.effect ?? null,
    ammoDmgMul: am?.dmgMul ?? 1,
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

// ── 宝石：每局免费领 grantLimit 次、可当金币花 ─────────────────────────
/** 可购买力：金币 + 宝石按 goldPerGem 折算。UI 按钮禁用与下单共用这一个口径。 */
export function canAfford(state, amount) {
  const rest = Math.max(0, amount - Math.min(state.gold, amount));
  const gemsNeeded = rest <= 1e-9 ? 0 : Math.ceil((rest - 1e-9) / C.gems.goldPerGem);
  return state.gems + 1e-9 >= gemsNeeded;
}

/** 领取宝石：免费、无冷却，但每局最多 grantLimit 次；重开由 resetMatch 恢复。 */
export function grantGems(state) {
  const used = state.stats.gemsGranted;
  const limit = C.gems.grantLimit;
  if (used >= limit) {
    return { ok: false, reason: `本局宝石已领完（${limit}/${limit}）`, used, limit, remaining: 0 };
  }
  const amount = C.gems.grantAmount;
  state.gems += amount;
  state.stats.gemsGranted++;
  return {
    ok: true, amount, total: state.gems,
    used: state.stats.gemsGranted, limit,
    remaining: limit - state.stats.gemsGranted,
  };
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
  if (state.control.championId !== null) state.control.seconds += dt;
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
    // v2.11：眩晕期间不动、不攻击、不挖矿、不召唤；冷却已在上面统一递减。
    if (u.fx?.stun > 0) { u.moving = false; continue; }
    // v2.10：玩家接管优先于攻/守/驻三条指令——手动控制就该说了算。
    const isChamp = C.control.enabled && state.control.championId === u.id && u.team === 0;
    if (isChamp) {
      // 矿工被接管时不挖矿、不交付，只跟着 axis 走；战斗兵保留自动攻击/拆雕像。
      if (u.kind === 'miner') moveChampion(state, u, udt);
      else tickFighter(state, u, udt, events, true);
    // 原版 Garrison：全军撤回堡内，不追击、不挖矿，输出交给城堡射手。
    // 否则单位会因为 nearestEnemy 自己走出安全区，驻堡就失去意义。
    } else if (state.gameMode === 'garrison' && u.team === 0) {
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
  tickEffects(state, dt, events);
  tickSummons(state, dt, events);
  separate(state.units, dt);

  // filter 而非遍历中 splice：渲染排序不再能改变物理遍历顺序。
  const before = state.units.length;
  state.units = state.units.filter((u) => u.hp > 0 && u.x > -60 && u.x < state.w + 60);
  if (state.units.length < before) events.push({ type: 'death' });

  // 指挥单位阵亡/出界：自动释放并清零输入，避免 UI 停在「指挥中」而 axis 还留着。
  if (state.control.championId !== null &&
      !state.units.some((u) => u.id === state.control.championId)) {
    releaseChampion(state);
    events.push({ type: 'championLost' });
  }

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
// ── v2.11：弹药切换与状态汇总 ───────────────────────────────────────────
/** 全局切换我方箭矢；走与出兵/升级同一个 pay()，因此可用无限宝石兜底。 */
export function setAmmo(state, kind) {
  if (state.phase !== 'playing') return { ok: false, reason: '当前不能切换弹药' };
  const cfg = C.ammo.kinds[kind];
  if (!cfg) return { ok: false, reason: '未知弹药' };
  if (state.ammo === kind) return { ok: true, unchanged: true, label: cfg.label };
  const paid = pay(state, C.ammo.cost);
  if (!paid) return { ok: false, reason: '金币/宝石不足，点底栏宝石可免费领' };
  state.ammo = kind;
  state.stats.ammoSwitches++;
  return { ok: true, label: cfg.label, effect: cfg.effect, paid };
}

/** 顶栏、弹药面板、结算与烟测共用；统计数字全部来自 state，不另起炉灶。 */
export function effectsInfo(state) {
  const active = { burn: 0, poison: 0, bleed: 0, stun: 0 };
  for (const u of state.units) {
    if (u.hp <= 0 || !u.fx) continue;
    for (const k of Object.keys(active)) if (u.fx[k] > 0) active[k]++;
  }
  return {
    ammo: state.ammo,
    ammoLabel: C.ammo.kinds[state.ammo].label,
    ammoCost: C.ammo.cost,
    active,
    stats: {
      ammoSwitches: state.stats.ammoSwitches,
      spearThrows: state.stats.spearThrows,
      summons: state.stats.summons,
      stuns: state.stats.stuns,
      dotTicks: state.stats.dotTicks,
      dotDamage: state.stats.dotDamage,
    },
  };
}

// ── v2.10：单兵指挥 ─────────────────────────────────────────────────────
/** 顶栏/指挥条/结算/烟测共用的唯一口径。 */
export function championInfo(state) {
  const c = state.control;
  const u = c.championId === null ? null
    : state.units.find((v) => v.id === c.championId && v.hp > 0) ?? null;
  return {
    active: !!u,
    id: u?.id ?? null,
    type: u?.type ?? null,
    name: u ? C.units[u.type].name : null,
    x: u?.x ?? null,
    axis: c.axis,
    seconds: c.seconds,
    distance: c.distance,
    selectedAt: c.selectedAt,
    switches: state.stats.championSwitches,
  };
}

/** 点战场：选中最靠近 worldX 的我方单位；点空处等价于退出指挥。 */
export function selectChampion(state, worldX) {
  if (state.phase !== 'playing' || !C.control.enabled) {
    return { ok: false, reason: '当前不能指挥' };
  }
  let best = null;
  let bd = Infinity;
  for (const u of state.units) {
    if (u.team !== 0 || u.hp <= 0) continue;
    const d = Math.abs(u.x - worldX);
    if (d < bd) { bd = d; best = u; }
  }
  if (!best || bd > C.control.selectRadiusPx) {
    releaseChampion(state);
    return { ok: false, reason: '附近没有我方单位' };
  }
  if (state.control.championId !== best.id) state.stats.championSwitches++;
  state.control.championId = best.id;
  state.control.axis = 0;
  state.control.selectedAt = state.elapsed;
  return { ok: true, id: best.id, unit: best.type, distance: bd };
}

export function releaseChampion(state) {
  const wasActive = state.control.championId !== null;
  state.control.championId = null;
  state.control.axis = 0;
  return { ok: true, wasActive };
}

/** 键盘 / 按住按钮写入 -1 / 0 / 1；暂停或未选中时不留残留输入。 */
export function setControlAxis(state, axis) {
  state.control.axis = state.phase === 'playing' && state.control.championId !== null
    ? (axis > 0 ? 1 : axis < 0 ? -1 : 0)
    : 0;
  return state.control.axis;
}

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
