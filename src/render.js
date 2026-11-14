// 全矢量渲染：不加载、不绘制任何外部位图，所有形状都由 Canvas 路径生成。
// 统一视觉语言：P.outline 粗描边 + 阵营色细芯 + 圆头线帽 + P.shadow 地面投影。
// 所有相位只来自 state.elapsed / unit.walkPhase / unit.anim / projectile.age / state.fx，
// 不允许墙钟时间与随机源，因此暂停时画面完全静止、整局可复现。
import { CONFIG } from './config.js';

const C = CONFIG;
const P = C.presentation;
const A = C.animation;
const TAU = Math.PI * 2;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const hash = (n) => {
  const s = Math.sin(n * 127.1 + 3.7) * 43758.5453;
  return s - Math.floor(s);
};

function poly(ctx, pts, fill, stroke = P.outline, lw = 1.5) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

function roundRect(ctx, x, y, w, h, r, fill, stroke = null, lw = 1) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

function unitHeight(state, u) {
  const base = state.h * C.layout.unitHeightRatio;
  if (u.type === 'giant') return base * C.layout.giantHeightMul;
  if (u.type === 'miner') return base * C.layout.minerHeightMul;
  return base;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');

  function resize(state) {
    const cw = canvas.clientWidth || window.innerWidth;
    const ch = canvas.clientHeight || Math.max(300, window.innerHeight - C.layout.canvasBottomReserve);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.w = cw;
    state.h = ch;
    for (const u of state.units) u.y = ch * C.layout.groundRatio;
  }

  // ── 背景：渐变天空 + 脉动太阳 + 双层远山 + 视差云 + 摇摆草 ────────────
  function drawSky(state) {
    const w = state.w, h = state.h, t = state.elapsed;
    const g = ctx.createLinearGradient(0, 0, 0, h * C.layout.groundRatio);
    g.addColorStop(0, P.skyTop);
    g.addColorStop(1, P.skyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const pulse = 0.5 + 0.5 * Math.sin(t * A.statuePulseHz * TAU);
    const sx = w * 0.82, sy = h * 0.13, sr = h * 0.055;
    const halo = ctx.createRadialGradient(sx, sy, sr * 0.4, sx, sy, sr * 3.2);
    halo.addColorStop(0, `rgba(255,233,168,${0.34 + 0.16 * pulse})`);
    halo.addColorStop(1, 'rgba(255,233,168,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(sx, sy, sr * 3.2, 0, TAU); ctx.fill();
    ctx.fillStyle = P.sun;
    ctx.strokeStyle = P.outline;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, TAU); ctx.fill(); ctx.stroke();
  }

  function drawHills(state) {
    const w = state.w, h = state.h, gy = h * C.layout.groundRatio;
    for (const [color, base, amp, seed] of [
      [P.hillFar, 0.60, 0.10, 1.7],
      [P.hillNear, 0.70, 0.07, 4.3],
    ]) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      for (let i = 0; i <= 12; i++) {
        const x = (i / 12) * w;
        const y = gy - h * (base * 0.30 + Math.sin(i * 0.9 + seed) * amp * 0.30 + hash(i + seed) * amp * 0.22);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, gy);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = P.outline;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  function drawClouds(state) {
    const w = state.w, h = state.h, t = state.elapsed;
    const span = w + 180;
    for (let i = 0; i < A.cloudCount; i++) {
      const speed = A.cloudSpeedPxPerSec * (0.7 + hash(i) * 0.7);
      const raw = (i * (span / A.cloudCount) - t * speed) % span;
      const x = ((raw % span) + span) % span - 90;
      const y = h * (0.10 + hash(i + 30) * 0.24);
      const s = h * (0.022 + hash(i + 60) * 0.014);
      ctx.fillStyle = P.cloud;
      ctx.strokeStyle = P.outline;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, y, s, 0, TAU);
      ctx.arc(x + s * 1.1, y - s * 0.45, s * 0.85, 0, TAU);
      ctx.arc(x + s * 2.1, y, s * 0.9, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
  }

  function drawGround(state) {
    const w = state.w, h = state.h, gy = h * C.layout.groundRatio;
    const g = ctx.createLinearGradient(0, gy - h * 0.02, 0, h);
    g.addColorStop(0, P.groundTop);
    g.addColorStop(1, P.groundBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, gy - h * 0.02, w, h - gy + h * 0.02);
    ctx.strokeStyle = P.outline;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, gy - h * 0.02); ctx.lineTo(w, gy - h * 0.02); ctx.stroke();
    // 确定性小石子
    for (let i = 0; i < 26; i++) {
      const x = hash(i + 91) * w;
      const y = gy + h * (0.03 + hash(i + 130) * 0.18);
      ctx.fillStyle = P.stoneMid;
      ctx.beginPath(); ctx.ellipse(x, y, 2 + hash(i + 7) * 3, 1.5, 0, 0, TAU); ctx.fill();
    }
  }

  function drawGrass(state) {
    const w = state.w, h = state.h, t = state.elapsed, gy = h * C.layout.groundRatio;
    ctx.strokeStyle = P.grassBlade;
    ctx.lineWidth = Math.max(1.4, h * 0.0035);
    ctx.lineCap = 'round';
    for (let i = 0; i < A.grassCount; i++) {
      const x = (i + 0.5) * (w / A.grassCount) + (hash(i + 200) - 0.5) * 12;
      const len = h * (0.012 + hash(i + 240) * 0.022);
      const sway = Math.sin(t * A.grassSwayHz * TAU + i * 0.8) * len * 0.5;
      const y = gy + h * (0.012 + hash(i + 280) * 0.18);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + sway * 0.5, y - len * 0.6, x + sway, y - len);
      ctx.stroke();
    }
  }

  function drawBackground(state) {
    drawSky(state);
    drawHills(state);
    drawClouds(state);
    drawGround(state);
    drawGrass(state);
    ctx.fillStyle = P.backgroundTint;
    ctx.fillRect(0, state.h * 0.72, state.w, state.h * 0.28);
  }

  // ── 雕像：矢量石像 + 脉动光晕 + 受击抖动 + 血条 ──────────────────────
  function drawStatue(state, x, team) {
    const h = state.h, t = state.elapsed;
    const sh = h * C.layout.statueHeightRatio;
    const gy = h * C.layout.groundRatio + h * 0.04;
    const color = team === 0 ? P.playerColor : P.enemyColor;
    const shakeKey = team === 0 ? 'homeShake' : 'enemyShake';
    const shakeAmt = state.fx[shakeKey] / A.statueShakeSec;
    const shake = Math.sin(t * 62) * A.statueShakePx * shakeAmt;
    const pulse = 0.5 + 0.5 * Math.sin(t * A.statuePulseHz * TAU + team);

    ctx.save();
    ctx.translate(x + shake, gy);

    ctx.fillStyle = P.shadow;
    ctx.beginPath(); ctx.ellipse(0, 2, sh * 0.20, sh * 0.035, 0, 0, TAU); ctx.fill();

    // 光晕
    const glow = ctx.createRadialGradient(0, -sh * 0.55, sh * 0.05, 0, -sh * 0.55, sh * 0.55);
    glow.addColorStop(0, team === 0 ? `rgba(77,211,92,${0.16 + pulse * 0.13})` : `rgba(255,77,77,${0.16 + pulse * 0.13})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, -sh * 0.55, sh * 0.55, 0, TAU); ctx.fill();

    const lw = Math.max(2, sh * 0.012);
    // 基座
    poly(ctx, [[-sh * 0.21, 0], [-sh * 0.19, -sh * 0.12], [sh * 0.19, -sh * 0.12], [sh * 0.21, 0]],
      P.stoneMid, P.outline, lw);
    poly(ctx, [[-sh * 0.16, -sh * 0.12], [sh * 0.16, -sh * 0.12], [sh * 0.14, -sh * 0.19], [-sh * 0.14, -sh * 0.19]],
      P.stoneLight, P.outline, lw);
    // 躯干（梯形）+ 阵营色披风
    poly(ctx, [[-sh * 0.13, -sh * 0.19], [sh * 0.13, -sh * 0.19], [sh * 0.10, -sh * 0.68], [-sh * 0.10, -sh * 0.68]],
      P.stoneLight, P.outline, lw);
    poly(ctx, [[-sh * 0.10, -sh * 0.30], [sh * 0.10, -sh * 0.30], [sh * 0.07, -sh * 0.66], [-sh * 0.07, -sh * 0.66]],
      color, P.outline, lw * 0.8);
    // 头
    ctx.beginPath(); ctx.arc(0, -sh * 0.78, sh * 0.105, 0, TAU);
    ctx.fillStyle = P.stoneLight; ctx.fill(); ctx.strokeStyle = P.outline; ctx.lineWidth = lw; ctx.stroke();
    // 冠
    poly(ctx, [[-sh * 0.11, -sh * 0.86], [-sh * 0.07, -sh * 0.97], [0, -sh * 0.89],
      [sh * 0.07, -sh * 0.97], [sh * 0.11, -sh * 0.86]], P.goldColor, P.outline, lw);
    // 手臂持剑
    ctx.strokeStyle = P.outline; ctx.lineWidth = sh * 0.05; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sh * 0.11, -sh * 0.60); ctx.lineTo(sh * 0.20, -sh * 0.44); ctx.stroke();
    ctx.strokeStyle = P.stoneLight; ctx.lineWidth = sh * 0.028;
    ctx.beginPath(); ctx.moveTo(sh * 0.11, -sh * 0.60); ctx.lineTo(sh * 0.20, -sh * 0.44); ctx.stroke();
    ctx.strokeStyle = P.weapon; ctx.lineWidth = sh * 0.018;
    ctx.beginPath(); ctx.moveTo(sh * 0.20, -sh * 0.44); ctx.lineTo(sh * 0.23, -sh * 1.02); ctx.stroke();
    // 受击闪白
    if (shakeAmt > 0) {
      ctx.save();
      ctx.globalAlpha = shakeAmt * 0.5;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, -sh * 0.78, sh * 0.105, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    // 血条
    const maxHp = C.match.statueHp * (team === 1 ? C.match.difficulties[state.difficulty].enemyStatueMul : 1);
    const hp = team === 0 ? state.homeHp : state.enemyHp;
    const bw = sh * 0.46, by = gy - sh - 15;
    roundRect(ctx, x - bw / 2, by, bw, 6, 3, 'rgba(0,0,0,.62)', P.outline, 1);
    roundRect(ctx, x - bw / 2 + 1, by + 1, (bw - 2) * clamp01(hp / maxHp), 4, 2, color);
  }

  function drawStatues(state) {
    drawStatue(state, C.layout.statueInset, 0);
    drawStatue(state, state.w - C.layout.statueInset, 1);
  }

  // ── 矿堆：矢量矿石 + 晶簇闪烁 + 挖掘飞溅 ─────────────────────────────
  function drawOrePile(state, x, y, hgt, index) {
    const t = state.elapsed;
    const w = hgt * C.layout.goldMineWidthRatio;
    const glowPulse = 0.5 + 0.5 * Math.sin(t * A.mineGlowHz * TAU + index * 1.3);
    const twinkle = 0.5 + 0.5 * Math.sin(t * A.crystalTwinkleHz * TAU + index * 2.1);
    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = P.mineShadow;
    ctx.beginPath(); ctx.ellipse(0, 2, w * 0.46, hgt * 0.12, 0, 0, TAU); ctx.fill();

    ctx.save();
    ctx.globalAlpha = 0.16 + 0.18 * glowPulse;
    const glow = ctx.createRadialGradient(0, -hgt * 0.42, hgt * 0.05, 0, -hgt * 0.42, w * 0.6);
    glow.addColorStop(0, P.mineGlow);
    glow.addColorStop(1, 'rgba(255,214,110,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.ellipse(0, -hgt * 0.42, w * 0.6, hgt * 0.55, 0, 0, TAU); ctx.fill();
    ctx.restore();

    const lw = Math.max(1, hgt * 0.018);
    const P2 = (pts, fill) => poly(ctx, pts.map(([px, py]) => [px * w, py * hgt]), fill, P.outline, lw);
    P2([[-0.42, 0], [-0.37, -0.32], [-0.19, -0.52], [0.01, -0.44],
      [0.15, -0.55], [0.36, -0.30], [0.42, 0]], P.rockDark);
    P2([[-0.27, -0.20], [-0.11, -0.64], [0.07, -0.70], [0.23, -0.38], [0.15, -0.16]], P.rockLight);
    P2([[-0.40, -0.02], [-0.30, -0.22], [-0.14, -0.12], [-0.17, 0]], P.stoneDark);

    const gold = (cx, cy, r, rot) => {
      ctx.save();
      ctx.translate(cx * w, cy * hgt);
      ctx.rotate(rot);
      poly(ctx, [[-r, -r * 0.55], [-r * 0.28, -r], [r, -r * 0.45],
        [r * 0.78, r * 0.7], [-r * 0.48, r]], P.goldDark, P.outline, Math.max(1, hgt * 0.014));
      poly(ctx, [[-r * 0.28, -r], [r, -r * 0.45], [r * 0.25, -r * 0.08], [-r * 0.78, -r * 0.18]],
        P.goldLight, null);
      ctx.restore();
    };
    gold(-0.26, -0.30, hgt * 0.095, -0.22);
    gold(0.19, -0.44, hgt * 0.105, 0.28);
    gold(0.01, -0.15, hgt * 0.075, 0.08);
    gold(0.30, -0.11, hgt * 0.065, -0.34);

    // 晶簇：闪烁 + 轻微呼吸缩放
    ctx.save();
    ctx.translate(0.02 * w, -0.63 * hgt);
    ctx.rotate(index % 2 === 0 ? -0.12 : 0.12);
    ctx.scale(1 + twinkle * 0.09, 1 + twinkle * 0.14);
    poly(ctx, [[-hgt * 0.07, 0], [0, -hgt * 0.30], [hgt * 0.07, 0], [0, hgt * 0.05]],
      P.goldColor, P.outline, Math.max(1, hgt * 0.012));
    poly(ctx, [[0, -hgt * 0.30], [0, hgt * 0.05], [hgt * 0.07, 0]], P.goldLight, null);
    ctx.restore();

    ctx.fillStyle = P.goldColor;
    for (const [px, py, pr] of [[-0.34, -0.06, 0.018], [0.36, -0.04, 0.015], [0.12, -0.02, 0.012]]) {
      ctx.beginPath(); ctx.arc(px * w, py * hgt, Math.max(1, pr * hgt) * (0.7 + twinkle * 0.6), 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawMines(state) {
    const h = state.h, y = h * C.layout.goldMineYRatio;
    const hgt = h * C.layout.goldMineHeightRatio;
    const t = state.elapsed;
    for (let i = 0; i < C.layout.goldMines.length; i++) {
      const x = state.w * C.layout.goldMines[i].xRatio;
      drawOrePile(state, x, y, hgt, i);
      const workers = state.units.filter((u) =>
        u.kind === 'miner' && u.hp > 0 && u.mineIndex === i && u.job === 'mining').length;
      if (workers) {
        ctx.save();
        ctx.fillStyle = P.goldColor;
        const n = Math.min(workers, 4);
        for (let k = 0; k < n; k++) {
          const ph = t * A.crystalTwinkleHz * TAU + k * 1.7;
          ctx.globalAlpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(ph));
          ctx.beginPath();
          ctx.arc(x + (k - (n - 1) / 2) * 9 + Math.sin(ph) * 3,
            y - hgt * (1.0 + 0.22 * (0.5 + 0.5 * Math.cos(ph))), 2.6, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  // ── 驻堡区：脉动虚线 + 半透明护罩 ────────────────────────────────────
  function drawFort(state) {
    if (state.gameMode !== 'garrison') return;
    const t = state.elapsed;
    const right = C.layout.statueInset * C.layout.fortInsetRatio + C.economy.mineArriveEps;
    const pulse = 0.5 + 0.5 * Math.sin(t * A.fortPulseHz * TAU);
    ctx.save();
    ctx.fillStyle = P.fortTint;
    ctx.fillRect(0, 0, right, state.h);
    ctx.strokeStyle = `rgba(150,200,255,${0.35 + pulse * 0.45})`;
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -t * 16;
    ctx.lineWidth = 2 + pulse;
    ctx.beginPath(); ctx.moveTo(right, 0); ctx.lineTo(right, state.h); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(220,235,255,.85)';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('驻堡', right / 2, state.h * 0.16);
    ctx.restore();
  }

  // ── 单位：统一骨架 + 按兵种武器 + 全状态动画 ──────────────────────────
  function joints(h, walk, swing, mining) {
    const headR = h * 0.115;
    const headCy = -h + headR;
    const neckY = headCy + headR;
    const shoulderY = neckY + headR * 0.55;
    const hipY = -h * 0.42;
    const legS = walk * A.walkLegSwing * h * 0.30;
    const armS = -walk * A.walkArmSwing * h * 0.16;
    return {
      headR, headCy, neckY, shoulderY, hipY,
      legL: [[-h * 0.08 + legS * 0.55, hipY + (0 - hipY) * 0.55], [-h * 0.13 + legS, 0]],
      legR: [[h * 0.08 - legS * 0.55, hipY + (0 - hipY) * 0.55], [h * 0.13 - legS, 0]],
      armL: [[-h * 0.13 - armS * 0.4, shoulderY + h * 0.17], [-h * 0.20 - armS, shoulderY + h * 0.30]],
      armR: [
        [h * 0.13 + armS * 0.4, shoulderY + h * 0.17 - swing * h * 0.10],
        [h * 0.20 + armS + swing * h * 0.14 + mining * h * 0.06, shoulderY + h * 0.30 - swing * h * 0.26 - mining * h * 0.10],
      ],
    };
  }

  function strokeSkeleton(ctx, j, color, lw, headFill) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, j.neckY); ctx.lineTo(0, j.hipY);
    for (const limb of [j.armL, j.armR, j.legL, j.legR]) {
      ctx.moveTo(0, j.shoulderY);
      if (limb === j.legL || limb === j.legR) ctx.moveTo(0, j.hipY);
      ctx.lineTo(limb[0][0], limb[0][1]);
      ctx.lineTo(limb[1][0], limb[1][1]);
    }
    ctx.stroke();
    ctx.beginPath(); ctx.arc(0, j.headCy, j.headR, 0, TAU);
    ctx.fillStyle = headFill; ctx.fill();
    ctx.lineWidth = lw * 0.65; ctx.strokeStyle = P.outline; ctx.stroke();
  }

  function drawWeapon(ctx, key, h, j, swing, t, team) {
    const hand = j.armR[1];
    const color = team === 0 ? P.playerColor : P.enemyColor;
    ctx.save();
    ctx.translate(hand[0], hand[1]);
    ctx.rotate(-swing);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const lw = Math.max(1.5, h * 0.022);
    const edge = (path, fill) => poly(ctx, path, fill, P.outline, lw);
    switch (key) {
      case 'sword':
        ctx.strokeStyle = P.weapon; ctx.lineWidth = h * 0.032;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(h * 0.36, -h * 0.28); ctx.stroke();
        edge([[h * 0.30, -h * 0.24], [h * 0.42, -h * 0.36], [h * 0.46, -h * 0.30], [h * 0.34, -h * 0.18]], P.weaponEdge);
        ctx.strokeStyle = P.goldColor; ctx.lineWidth = h * 0.022;
        ctx.beginPath(); ctx.moveTo(-h * 0.06, h * 0.04); ctx.lineTo(h * 0.06, -h * 0.04); ctx.stroke();
        break;
      case 'spear':
        ctx.strokeStyle = P.weapon; ctx.lineWidth = h * 0.028;
        ctx.beginPath(); ctx.moveTo(-h * 0.14, h * 0.16); ctx.lineTo(h * 0.50, -h * 0.44); ctx.stroke();
        edge([[h * 0.44, -h * 0.40], [h * 0.56, -h * 0.52], [h * 0.48, -h * 0.32]], P.weaponEdge);
        break;
      case 'archer': {
        const pull = swing > 0 ? h * 0.07 : 0;
        ctx.strokeStyle = P.weapon; ctx.lineWidth = h * 0.026;
        ctx.beginPath(); ctx.arc(h * 0.14, 0, h * 0.27, -Math.PI / 2, Math.PI / 2); ctx.stroke();
        ctx.strokeStyle = P.weaponEdge; ctx.lineWidth = h * 0.012;
        ctx.beginPath(); ctx.moveTo(h * 0.14, -h * 0.27); ctx.lineTo(h * 0.14 - pull, 0);
        ctx.lineTo(h * 0.14, h * 0.27); ctx.stroke();
        break;
      }
      case 'stone':
        ctx.strokeStyle = P.weapon; ctx.lineWidth = h * 0.022;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(h * 0.20, -h * 0.30, h * 0.34, -h * 0.12); ctx.stroke();
        ctx.fillStyle = P.rockDark; ctx.strokeStyle = P.outline; ctx.lineWidth = lw;
        ctx.beginPath(); ctx.arc(h * 0.34, -h * 0.12, h * 0.07, 0, TAU); ctx.fill(); ctx.stroke();
        break;
      case 'giant':
        edge([[-h * 0.05, h * 0.04], [h * 0.44, -h * 0.32], [h * 0.52, -h * 0.24], [h * 0.03, h * 0.12]], P.rockDark);
        break;
      case 'wizard': {
        ctx.strokeStyle = P.weapon; ctx.lineWidth = h * 0.026;
        ctx.beginPath(); ctx.moveTo(0, h * 0.06); ctx.lineTo(h * 0.14, -h * 0.38); ctx.stroke();
        const pulse = 0.5 + 0.5 * Math.sin(t * A.crystalTwinkleHz * TAU);
        ctx.fillStyle = color; ctx.strokeStyle = P.outline; ctx.lineWidth = lw;
        ctx.beginPath(); ctx.arc(h * 0.14, -h * 0.42, h * (0.075 + pulse * 0.025), 0, TAU);
        ctx.fill(); ctx.stroke();
        break;
      }
      case 'miner':
        ctx.strokeStyle = P.weapon; ctx.lineWidth = h * 0.028;
        ctx.beginPath(); ctx.moveTo(-h * 0.04, h * 0.04); ctx.lineTo(h * 0.28, -h * 0.30); ctx.stroke();
        ctx.strokeStyle = P.weaponEdge; ctx.lineWidth = h * 0.034;
        ctx.beginPath(); ctx.moveTo(h * 0.18, -h * 0.32);
        ctx.quadraticCurveTo(h * 0.30, -h * 0.40, h * 0.40, -h * 0.28); ctx.stroke();
        break;
    }
    ctx.restore();
  }

  function drawUnit(state, u) {
    const h = unitHeight(state, u);
    const t = state.elapsed;
    const gy = u.y;
    const color = u.team === 0 ? P.playerColor : P.enemyColor;
    const walk = u.moving ? Math.sin(u.walkPhase) : 0;
    const attack = u.atkAnim > 0 ? clamp01(u.atkAnim / C.combat.attackAnimSec) : 0;
    const swing = attack * A.attackSwingRad;
    const mining = u.kind === 'miner' && u.job === 'mining'
      ? Math.sin(t * A.mineSwingHz * TAU) * 0.6 : 0;
    const carryBob = u.kind === 'miner' && u.carry > 0
      ? Math.sin(t * A.carryBobHz * TAU) * A.carryBobRatio * h : 0;
    const breath = Math.sin(u.anim * A.breathHz * TAU + u.id) * A.breathRatio * h;
    const bob = Math.abs(Math.sin(u.walkPhase)) * A.bobRatio * h * (u.moving ? 1 : 0) + carryBob + breath;
    const j = joints(h, walk, swing, mining);

    // 阴影
    ctx.save();
    ctx.fillStyle = P.shadow;
    ctx.beginPath(); ctx.ellipse(u.x, gy - 2, h * 0.21, h * 0.05, 0, 0, TAU); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(u.x, gy - bob);
    ctx.scale(u.team === 1 ? -1 : 1, 1);

    // 背矿袋（晃动）
    if (u.kind === 'miner' && u.carry > 0) {
      const bx = -h * 0.17, by = j.hipY - h * 0.06 + carryBob * 0.5;
      poly(ctx, [[bx - h * 0.09, by], [bx + h * 0.09, by], [bx + h * 0.07, by + h * 0.16],
        [bx - h * 0.07, by + h * 0.16]], P.goldDark, P.outline, Math.max(1, h * 0.02));
      ctx.fillStyle = P.goldColor;
      ctx.beginPath(); ctx.arc(bx, by + h * 0.05, h * 0.035, 0, TAU); ctx.fill();
    }

    // 三层骨架：粗描边 → 阵营色芯 →（受击时）纯白闪白，全部路径重绘，不用滤镜。
    strokeSkeleton(ctx, j, P.outline, h * 0.062, P.outline);
    strokeSkeleton(ctx, j, color, h * 0.034, color);
    if (u.hitFlash > 0) {
      ctx.save();
      ctx.globalAlpha = (u.hitFlash / C.combat.hitFlashSec) * P.flashAlpha;
      strokeSkeleton(ctx, j, '#fff', h * 0.05, '#fff');
      ctx.restore();
    }
    drawWeapon(ctx, u.type, h, j, swing + mining * 0.5, t, u.team);

    // 堡内护罩
    if (u.inFort) {
      ctx.strokeStyle = `rgba(150,200,255,${0.4 + 0.3 * Math.sin(t * A.fortPulseHz * TAU)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, -h * 0.5, h * 0.36, 0, TAU); ctx.stroke();
    }
    ctx.restore();

    // 血条
    const bw = Math.max(26, h * 0.55), by = gy - h - 12;
    roundRect(ctx, u.x - bw / 2, by, bw, 5, 2.5, 'rgba(0,0,0,.62)', P.outline, 1);
    roundRect(ctx, u.x - bw / 2 + 1, by + 1, (bw - 2) * clamp01(u.hp / u.maxHp), 3, 1.5, color);

    // 矿工挖掘进度环（用单位自己的 mineDuration，升级后仍然准确）
    if (u.kind === 'miner' && u.job === 'mining') {
      const p = 1 - clamp01(u.mineTimer / (u.mineDuration || C.economy.mineDurationSec));
      ctx.save();
      ctx.strokeStyle = P.goldColor; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(u.x, gy - h - 22, 8, -Math.PI / 2, -Math.PI / 2 + p * TAU);
      ctx.stroke();
      ctx.restore();
    }
    // 近战挥击弧
    if (u.kind !== 'miner' && attack > 0 && !u.projectile) {
      ctx.save();
      ctx.strokeStyle = u.team === 0 ? 'rgba(255,255,255,.8)' : 'rgba(255,200,200,.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(u.x + (u.team === 1 ? -8 : 8), gy - h * 0.62, h * 0.34 * attack,
        -Math.PI / 3, Math.PI / 3);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── 投射物：矢量箭头 / 旋转落石 / 脉动法球，带拖尾 ────────────────────
  function drawProjectile(state, p) {
    const t = p.age;
    const arc = p.kind === 'rock' ? -Math.sin(Math.min(1, t / 0.6) * Math.PI) * 26 : 0;
    const x = p.x, y = p.y + arc;
    const ang = Math.atan2(p.ty - p.y, p.tx - p.x);
    const color = p.team === 0 ? P.playerColor : P.enemyColor;
    ctx.save();
    // 拖尾
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = color;
    for (let k = 1; k <= A.trailDots; k++) {
      const d = k * 4;
      ctx.beginPath();
      ctx.arc(x - Math.cos(ang) * d, y - Math.sin(ang) * d + arc * 0.1,
        Math.max(1, 3 - k * 0.5), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (p.kind === 'arrow') {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang);
      ctx.strokeStyle = P.outline; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(7, 0); ctx.stroke();
      ctx.strokeStyle = P.weapon; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(7, 0); ctx.stroke();
      poly(ctx, [[7, 0], [1, -4], [1, 4]], P.weaponEdge, P.outline, 1.2);
      ctx.strokeStyle = color; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(-16, -4);
      ctx.moveTo(-12, 0); ctx.lineTo(-16, 4); ctx.stroke();
      ctx.restore();
    } else if (p.kind === 'rock') {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t * A.projectileSpinHz * TAU);
      poly(ctx, [[-6, -3], [-2, -7], [5, -5], [7, 2], [2, 7], [-5, 5]],
        P.rockDark, P.outline, 1.5);
      ctx.fillStyle = P.rockLight;
      ctx.beginPath(); ctx.arc(-1, -1, 2, 0, TAU); ctx.fill();
      ctx.restore();
    } else {
      const pulse = 0.5 + 0.5 * Math.sin(t * A.projectileSpinHz * TAU);
      const glow = ctx.createRadialGradient(x, y, 1, x, y, 14 + pulse * 5);
      glow.addColorStop(0, color);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(x, y, 14 + pulse * 5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.strokeStyle = P.outline; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 4 + pulse, 0, TAU); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  // ── 金币交付迸发（由 state.fx.goldBurst 驱动，确定性） ────────────────
  function drawGoldBurst(state) {
    const left = state.fx.goldBurst;
    if (left <= 0) return;
    const k = 1 - left / A.goldBurstSec;
    const x = C.layout.statueInset + C.layout.statueHitRadius;
    const y = state.h * C.layout.groundRatio - state.h * 0.22;
    ctx.save();
    for (let i = 0; i < 7; i++) {
      const a = hash(i + 400) * TAU;
      const r = k * (22 + hash(i + 420) * 34);
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.fillStyle = P.goldColor;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r, y - k * 30 + Math.sin(a) * r * 0.4, 2.6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function draw(state) {
    ctx.clearRect(0, 0, state.w, state.h);
    drawBackground(state);
    drawFort(state);
    drawStatues(state);
    drawMines(state);
    drawGoldBurst(state);
    // 复制后再排序：渲染顺序不再改写物理数组。
    const sorted = [...state.units].sort((a, b) => a.x - b.x);
    for (const u of sorted) drawUnit(state, u);
    for (const p of state.projectiles) drawProjectile(state, p);
  }

  return { resize, draw };
}
