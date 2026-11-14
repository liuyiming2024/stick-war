// 纯逻辑层：完全不碰 DOM / canvas / window。
// 所有时间量单位为秒，所有速度单位为 px/s；由 main.js 的固定步长驱动。
import { CONFIG, UNIT_ORDER } from './config.js';
import { countTeam, spawnUnit } from './state.js';

const C = CONFIG;

const statueLeftLine = (s) => C.layout.statueInset + C.layout.statueHitRadius;
const statueRightLine = (s) => s.w - C.layout.statueInset - C.layout.statueHitRadius;
const mineX = (s) => s.w * C.layout.goldMineXRatio;

export function minerHomeX(state, team) {
  return team === 0 ? statueLeftLine(state) : statueRightLine(state);
}

function projectileY(state, u) {
  return state.h * C.layout.groundRatio - state.h * C.layout.unitHeightRatio * 0.62;
}

// snap=true 用于固定目标点（金矿 / 雕像 / 驻守线）：到达时吸附到精确坐标，
// 避免不同 dt 下残留 0.x 像素的偏差在状态机里累积。
function moveToward(u, tx, dt, eps = 2, snap = false) {
  const d = tx - u.x;
  if (Math.abs(d) <= eps) { if (snap) u.x = tx; return true; }
  u.x += Math.sign(d) * Math.min(Math.abs(d), u.speed * dt);
  if (Math.abs(tx - u.x) <= eps) { if (snap) u.x = tx; return true; }
  return false;
}

function applyDamage(target, dmg, events) {
  target.hp -= dmg * target.defMul;
  target.hitFlash = C.combat.hitFlashSec;
  events.push({ type: 'hit', team: target.team });
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

function fire(state, u, target, events) {
  if (u.projectile) {
    state.projectiles.push({
      id: state.nextProjectileId++,
      team: u.team,
      kind: u.projectile,
      x: u.x, y: projectileY(state, u),
      tx: target.x, ty: projectileY(state, target),
      targetId: target.id,
      dmg: u.dmg,
      speed: C.combat.projectileSpeedPxPerSec,
      ttl: C.combat.projectileTtlSec,
      age: 0,
      dead: false,
    });
    events.push({ type: 'shoot', kind: u.projectile });
  } else {
    applyDamage(target, u.dmg, events);
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
      // 无目标：进攻推进到敌方雕像判定线，固守回到驻守线；敌方永远左推。
      const goal = u.team === 0
        ? (state.gameMode === 'attack' ? statueRightLine(state) : state.w * C.layout.defendLineRatio)
        : statueLeftLine(state);
      moveToward(u, goal, dt, 3, true);
    }
  }

  const crossed = u.team === 0 ? u.x >= line : u.x <= line;
  if (crossed && !target && u.statueCd <= 0) {
    const dmg = u.dmg * C.match.statueDamageMul;
    if (u.team === 0) state.enemyHp -= dmg;
    else state.homeHp -= dmg;
    u.statueCd = C.match.statueAttackIntervalSec;
    u.atkAnim = C.combat.attackAnimSec;
    events.push({ type: 'statueHit', team: u.team, dmg });
  }
}

function tickMiner(state, u, dt, events) {
  const home = minerHomeX(state, u.team);
  if (u.job === 'toMine') {
    if (moveToward(u, mineX(state), dt, C.economy.mineArriveEps, true)) {
      u.job = 'mining';
      u.mineTimer = C.economy.mineDurationSec;
    }
  } else if (u.job === 'mining') {
    u.mineTimer -= dt;
    if (u.mineTimer <= 0) {
      u.mineTimer = 0;
      u.carry = C.economy.goldPerTrip;
      u.job = 'toHome';
    }
  } else {
    if (moveToward(u, home, dt, C.economy.mineArriveEps, true)) {
      if (u.carry > 0) {
        if (u.team === 0) state.gold += u.carry;
        else state.aiGold += u.carry;
        state.stats.trips++;
        events.push({ type: 'gold', amount: u.carry, team: u.team });
      }
      u.carry = 0;
      u.job = 'toMine';
    }
  }
}

function tickProjectiles(state, dt, events) {
  for (const p of state.projectiles) {
    const target = state.units.find((u) => u.id === p.targetId && u.hp > 0);
    if (target) { p.tx = target.x; p.ty = projectileY(state, target); }
    const dx = p.tx - p.x, dy = p.ty - p.y;
    const dist = Math.hypot(dx, dy);
    const travel = p.speed * dt;
    p.age += dt;
    p.ttl -= dt;
    if (dist <= Math.max(travel, C.combat.projectileHitRadius)) {
      if (target) applyDamage(target, p.dmg, events);
      p.dead = true;
    } else if (dist > 0) {
      p.x += (dx / dist) * travel;
      p.y += (dy / dist) * travel;
    }
    if (p.ttl <= 0) p.dead = true;
  }
  state.projectiles = state.projectiles.filter((p) => !p.dead);
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

function aiInterval(elapsed) {
  const { spawnIntervalSec: start, spawnIntervalMinSec: min, rampSec } = C.ai;
  const t = Math.min(1, elapsed / rampSec);
  return start + (min - start) * t;
}

function tryAiSpawn(state, rng, events) {
  const pool = UNIT_ORDER.filter((key) => {
    const u = C.units[key];
    return u.kind !== 'miner' && u.aiWeight > 0 &&
      (u.aiUnlockSec === null || state.elapsed >= u.aiUnlockSec);
  });
  if (!pool.length || countTeam(state, 1) >= state.limits.aiPopMax) return;
  const type = rng.pickWeighted(pool, (k) => C.units[k].aiWeight);
  if (state.aiGold < C.units[type].cost) return;
  state.aiGold -= C.units[type].cost;
  spawnUnit(state, type, 1, null);
  events.push({ type: 'spawn', team: 1, unit: type });
}

/** 推进一个固定步长。返回本步事件，供 UI 层做提示。 */
export function step(state, dt, rng) {
  const events = [];
  if (state.phase !== 'playing' || !(dt > 0)) return events;

  state.elapsed += dt;
  state.aiGold += C.economy.aiGoldPerSec * dt;
  state.aiTimer -= dt;
  if (state.aiTimer <= 0) {
    state.aiTimer += aiInterval(state.elapsed);
    tryAiSpawn(state, rng, events);
  }

  for (const u of state.units) {
    u.attackCd = Math.max(0, u.attackCd - dt);
    u.statueCd = Math.max(0, u.statueCd - dt);
    u.hitFlash = Math.max(0, u.hitFlash - dt);
    u.atkAnim = Math.max(0, u.atkAnim - dt);
    u.anim += dt;
  }

  for (const u of state.units) {
    if (u.hp <= 0) continue;
    if (u.kind === 'miner') tickMiner(state, u, dt, events);
    else tickFighter(state, u, dt, events);
  }

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

export function spawnPlayer(state, type) {
  if (state.phase !== 'playing') return { ok: false, reason: '未在对局中' };
  const cfg = C.units[type];
  if (!cfg) return { ok: false, reason: '未知兵种' };
  if (state.gold < cfg.cost) return { ok: false, reason: '金币不够' };
  if (countTeam(state, 0) >= state.limits.popMax) return { ok: false, reason: '人口已满' };
  state.gold -= cfg.cost;
  spawnUnit(state, type, 0, state.upgrades);
  return { ok: true };
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
  if (mode !== 'attack' && mode !== 'defend') return false;
  state.gameMode = mode;
  return true;
}
