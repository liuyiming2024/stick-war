// 纯逻辑层：完全不碰 DOM / canvas / window。
// 所有时间量单位为秒，所有速度单位为 px/s；由 main.js 的固定步长驱动。
import { CONFIG, UNIT_ORDER } from './config.js';
import { countTeam, pendingTeam, spawnUnit } from './state.js';

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
        : statueLeftLine(state);
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
function tickMiner(state, u, dt, events) {
  const home = minerHomeX(state, u.team);
  let remaining = dt;
  let guard = 0;
  while (remaining > 1e-9 && guard++ < 8) {
    if (u.job === 'toMine') {
      if (u.mineIndex < 0) u.mineIndex = chooseMineIndex(state, u.team, u.x);
      const target = mineXByIndex(state, u.mineIndex);
      const t = Math.abs(target - u.x) / u.speed;
      if (t <= remaining + 1e-9) {
        u.x = target;
        u.job = 'mining';
        u.mineTimer = u.mineDuration;
        remaining -= t;
      } else {
        u.x += Math.sign(target - u.x) * u.speed * remaining;
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
      const t = Math.abs(home - u.x) / u.speed;
      if (t <= remaining + 1e-9) {
        u.x = home;
        if (u.carry > 0) {
          if (u.team === 0) state.gold += u.carry;
          else state.aiGold += u.carry;
          state.stats.trips++;
          state.fx.goldBurst = C.animation.goldBurstSec;
          events.push({ type: 'gold', amount: u.carry, team: u.team });
        }
        u.carry = 0;
        u.job = 'toMine';
        u.mineIndex = -1;
        remaining -= t;
      } else {
        u.x += Math.sign(home - u.x) * u.speed * remaining;
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

function aiInterval(elapsed, diff) {
  const { spawnIntervalSec: start, spawnIntervalMinSec: min, rampSec } = C.ai;
  const t = Math.min(1, elapsed / rampSec);
  return (start + (min - start) * t) * diff.aiSpawnMul;
}

function enqueue(state, type, team, upgrades, events) {
  const t = {
    id: state.nextTrainingId++,
    type, team,
    due: state.elapsed + C.units[type].trainSec,
    upgrades,
  };
  state.training.push(t);
  events.push({ type: 'training', team, unit: type, id: t.id });
  return t;
}

function tryAiSpawn(state, rng, events, diff) {
  const pool = UNIT_ORDER.filter((key) => {
    const u = C.units[key];
    return u.kind !== 'miner' && u.aiWeight > 0 &&
      (u.aiUnlockSec === null || state.elapsed >= u.aiUnlockSec);
  });
  if (!pool.length) return;
  if (countTeam(state, 1) + pendingTeam(state, 1) >= state.limits.aiPopMax) return;
  const type = rng.pickWeighted(pool, (k) => C.units[k].aiWeight);
  if (state.aiGold < C.units[type].cost) return;
  state.aiGold -= C.units[type].cost;
  enqueue(state, type, 1, null, events);
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
  // 原版：城堡每秒 1 金，矿工补齐其余；AI 额外收入受难度放大。
  state.gold += C.economy.castleGoldPerSec * dt;
  state.aiGold += (C.economy.castleGoldPerSec + C.economy.aiGoldPerSec) * diff.aiIncomeMul * dt;

  state.aiTimer -= dt;
  if (state.aiTimer <= 0) {
    state.aiTimer += aiInterval(state.elapsed, diff);
    tryAiSpawn(state, rng, events, diff);
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
      tickMiner(state, u, udt, events);
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
  if (state.gold < cfg.cost) return { ok: false, reason: '金币不够' };
  if (countTeam(state, 0) + pendingTeam(state, 0) >= state.limits.popMax) {
    return { ok: false, reason: '人口已满' };
  }
  state.gold -= cfg.cost;
  const snapshot = { ...state.upgrades[type] };
  const t = enqueue(state, type, 0, snapshot, []);
  return { ok: true, trainingId: t.id, trainSec: cfg.trainSec };
}

/** 原版：再点一次图标可取消训练并退款。 */
export function cancelTraining(state, id) {
  const idx = state.training.findIndex((t) => t.id === id);
  if (idx < 0) return { ok: false, reason: '该训练已结束' };
  const t = state.training[idx];
  const refund = C.units[t.type].cost;
  if (t.team === 0) state.gold += refund;
  else state.aiGold += refund;
  state.training.splice(idx, 1);
  state.stats.cancelled++;
  return { ok: true, refund, type: t.type };
}

export function doUpgrade(state, type, stat) {
  if (state.phase !== 'playing') return { ok: false, reason: '未在对局中' };
  const lv = state.upgrades[type];
  if (!lv || !(stat in lv)) return { ok: false, reason: '未知升级项' };
  if (lv[stat] >= C.upgrade.maxLevel) return { ok: false, reason: '已满级' };
  if (state.gold < C.upgrade.cost) return { ok: false, reason: '金币不足' };
  state.gold -= C.upgrade.cost;
  lv[stat]++;
  return { ok: true };
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
