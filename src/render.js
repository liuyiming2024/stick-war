// v2.5：位图立绘回归。9 张 WebP（7 兵种 + 雕像 + 战场背景）由 assets.js 加载，
// 渲染层只 drawImage；矿堆、投射物、血条、粒子、堡区等没有对应素材的部分继续用
// Canvas 路径绘制，作为叠加在立绘之上的特效层。
//
// 动画全部作用在位图的变换矩阵或矢量特效上，相位只来自
// state.elapsed / unit.walkPhase / unit.anim / projectile.age / state.fx，
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
const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
const srcDims = (src) => ({
  w: src.naturalWidth ?? src.width,
  h: src.naturalHeight ?? src.height,
});

function poly(ctx, pts, fill, stroke = null, lw = 1.2) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); }
}

function rounded(ctx, x, y, w, h, r, fill, stroke = null, lw = 1) {
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

function disc(ctx, x, y, r, fill, stroke = null, lw = 1) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

function unitHeight(state, u) {
  const base = state.h * C.layout.unitHeightRatio;
  if (u.type === 'giant') return base * C.layout.giantHeightMul;
  if (u.type === 'miner') return base * C.layout.minerHeightMul;
  return base;
}

// 素材缺失/尚未到达时的真实降级：线稿火柴人 + 兵种武器区分，绝不隐形。
function drawStickFigure(ctx, key, cx, groundY, hgt, color, swing) {
  const headR = hgt * 0.11;
  const headY = groundY - hgt + headR;
  const shoulderY = headY + headR * 1.7;
  const hipY = groundY - hgt * 0.42;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, hgt * 0.045);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, headY, headR, 0, TAU);
  ctx.moveTo(cx, headY + headR); ctx.lineTo(cx, hipY);
  ctx.moveTo(cx, shoulderY); ctx.lineTo(cx - hgt * 0.14, hipY + hgt * 0.06);
  ctx.moveTo(cx, shoulderY); ctx.lineTo(cx + hgt * 0.14, hipY + hgt * 0.06);
  ctx.moveTo(cx, hipY); ctx.lineTo(cx - hgt * 0.13, groundY);
  ctx.moveTo(cx, hipY); ctx.lineTo(cx + hgt * 0.13, groundY);
  ctx.stroke();
  ctx.lineWidth = Math.max(2, hgt * 0.035);
  ctx.beginPath();
  if (key === 'sword' || key === 'spear') {
    const len = key === 'spear' ? hgt * 0.55 : hgt * 0.38;
    ctx.moveTo(cx + hgt * 0.12, shoulderY);
    ctx.lineTo(cx + hgt * 0.12 + Math.cos(swing) * len, shoulderY - Math.sin(swing) * len);
  } else if (key === 'archer') {
    ctx.arc(cx + hgt * 0.18, shoulderY + hgt * 0.06, hgt * 0.18, -Math.PI / 2, Math.PI / 2);
  } else if (key === 'wizard') {
    ctx.arc(cx + hgt * 0.17, shoulderY - hgt * 0.12, hgt * 0.09, 0, TAU);
  } else if (key === 'miner') {
    ctx.moveTo(cx + hgt * 0.1, shoulderY); ctx.lineTo(cx + hgt * 0.26, shoulderY + hgt * 0.16);
  } else if (key === 'giant') {
    ctx.lineWidth = Math.max(3, hgt * 0.06);
    ctx.moveTo(cx - hgt * 0.2, shoulderY); ctx.lineTo(cx + hgt * 0.2, shoulderY);
  }
  ctx.stroke();
  ctx.restore();
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

  // ── 背景：位图战场等比铺满 + 底部渐暗 + 确定性飘尘 ─────────────────────
  function drawBackground(state, assets) {
    const w = state.w, h = state.h, t = state.elapsed;
    const bg = assets.get('battlefield');
    if (bg) {
      const d = srcDims(bg);
      const ir = d.w / d.h, cr = w / h;
      let dw, dh;
      if (cr > ir) { dw = w; dh = w / ir; } else { dh = h; dw = h * ir; }
      ctx.drawImage(bg, (w - dw) / 2, (h - dh) / 2, dw, dh);
      // 只压暗底部：保留插画本身的明度，同时让地面单位与 HUD 读得清
      const grade = ctx.createLinearGradient(0, h * 0.60, 0, h);
      grade.addColorStop(0, 'rgba(10,20,18,0)');
      grade.addColorStop(1, 'rgba(10,20,18,.34)');
      ctx.fillStyle = grade;
      ctx.fillRect(0, h * 0.60, w, h * 0.40);
    } else {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, P.skyTop);
      sky.addColorStop(1, P.skyBottom);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = P.groundTop;
      ctx.fillRect(0, h * C.layout.groundRatio, w, h * (1 - C.layout.groundRatio));
    }

    // 飘尘：位图背景上的一层矢量动效，位置由模拟时间确定，暂停即停
    ctx.save();
    ctx.fillStyle = P.goldLight;
    for (let i = 0; i < 16; i++) {
      const speed = A.cloudSpeedPxPerSec * (0.35 + hash(i + 700) * 0.7);
      const px = (hash(i + 710) * w + t * speed) % w;
      const py = h * (0.14 + hash(i + 730) * 0.58) +
        Math.sin(t * A.grassSwayHz * TAU + i) * h * 0.012;
      ctx.globalAlpha = 0.10 + 0.16 * (0.5 + 0.5 * Math.sin(t * A.crystalTwinkleHz * TAU + i * 1.7));
      disc(ctx, px, py, 1 + hash(i + 750) * 1.4, P.goldLight);
    }
    ctx.restore();
  }

  // ── 雕像：位图立绘 + 矢量光晕/裂纹/血条/受击抖动 ────────────────────────
  function drawStatue(state, assets, x, team) {
    const h = state.h, t = state.elapsed;
    const sh = h * C.layout.statueHeightRatio;
    const gy = h * C.layout.groundRatio + h * 0.04;
    const accent = team === 0 ? P.playerColor : P.enemyColor;
    const shakeKey = team === 0 ? 'homeShake' : 'enemyShake';
    const shakeAmt = clamp01(state.fx[shakeKey] / A.statueShakeSec);
    const shake = Math.sin(t * 62) * A.statueShakePx * shakeAmt;
    const pulse = 0.5 + 0.5 * Math.sin(t * A.statuePulseHz * TAU + team);
    const maxHp = C.match.statueHp *
      (team === 1 ? C.match.difficulties[state.difficulty].enemyStatueMul : 1);
    const ratio = clamp01((team === 0 ? state.homeHp : state.enemyHp) / maxHp);
    const damage = 1 - ratio;

    ctx.save();
    ctx.translate(x + shake, gy);

    ctx.fillStyle = P.shadow;
    ctx.beginPath(); ctx.ellipse(0, 2, sh * 0.24, sh * 0.04, 0, 0, TAU); ctx.fill();
    const glow = ctx.createRadialGradient(0, -sh * 0.55, sh * 0.04, 0, -sh * 0.55, sh * 0.6);
    glow.addColorStop(0, rgba(accent, 0.10 + pulse * 0.09));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, -sh * 0.55, sh * 0.6, 0, TAU); ctx.fill();

    const img = assets.team('statue', team) ?? assets.get('statue');
    if (img) {
      const d = srcDims(img);
      const dw = sh * (d.w / d.h);
      ctx.save();
      if (team === 1) ctx.scale(-1, 1);
      ctx.drawImage(img, -dw / 2, -sh, dw, sh);
      if (shakeAmt > 0 && assets.flash('statue')) {
        ctx.globalAlpha = shakeAmt * 0.42;
        ctx.drawImage(assets.flash('statue'), -dw / 2, -sh, dw, sh);
      }
      ctx.restore();
    } else {
      ctx.save();
      ctx.fillStyle = team === 0 ? P.stoneMid : P.stoneDark;
      ctx.fillRect(-sh * 0.16, -sh, sh * 0.32, sh);
      ctx.restore();
    }

    // 裂纹：随血量逐条出现，全部矢量
    const cracks = [
      [[-sh * 0.09, -sh * 0.52], [-sh * 0.035, -sh * 0.60], [-sh * 0.07, -sh * 0.69]],
      [[sh * 0.06, -sh * 0.66], [sh * 0.01, -sh * 0.72], [sh * 0.05, -sh * 0.78]],
      [[-sh * 0.03, -sh * 0.84], [sh * 0.03, -sh * 0.88], [-sh * 0.01, -sh * 0.93]],
    ];
    const visible = Math.floor(damage * cracks.length + 0.001);
    for (let i = 0; i < visible; i++) {
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.3 * Math.sin(t * 3 + i);
      ctx.strokeStyle = P.crack;
      ctx.lineWidth = Math.max(1.4, sh * 0.009);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cracks[i][0][0], cracks[i][0][1]);
      for (let k = 1; k < cracks[i].length; k++) ctx.lineTo(cracks[i][k][0], cracks[i][k][1]);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    const bw = sh * 0.48, barY = gy - sh - 16;
    rounded(ctx, x - bw / 2, barY, bw, 6, 3, 'rgba(8,12,14,.82)', rgba(P.weaponEdge, 0.28), 1);
    rounded(ctx, x - bw / 2 + 1, barY + 1, (bw - 2) * ratio, 4, 2, accent);
  }

  function drawStatues(state, assets) {
    drawStatue(state, assets, C.layout.statueInset, 0);
    drawStatue(state, assets, state.w - C.layout.statueInset, 1);
  }

  // ── 矿堆：没有位图素材，继续矢量（晶洞岩块 + 棱柱金晶簇） ─────────────
  function drawOrePile(state, x, y, hgt, index) {
    const t = state.elapsed;
    const w = hgt * C.layout.goldMineWidthRatio;
    const glowPulse = 0.5 + 0.5 * Math.sin(t * A.mineGlowHz * TAU + index * 1.3);
    const twinkle = 0.5 + 0.5 * Math.sin(t * A.crystalTwinkleHz * TAU + index * 2.1);
    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = P.mineShadow;
    ctx.beginPath(); ctx.ellipse(0, 1, w * 0.44, hgt * 0.10, 0, 0, TAU); ctx.fill();

    ctx.save();
    ctx.globalAlpha = 0.13 + 0.14 * glowPulse;
    const glow = ctx.createRadialGradient(0, -hgt * 0.40, hgt * 0.04, 0, -hgt * 0.40, w * 0.55);
    glow.addColorStop(0, P.mineGlow);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.ellipse(0, -hgt * 0.40, w * 0.55, hgt * 0.52, 0, 0, TAU); ctx.fill();
    ctx.restore();

    const lw = Math.max(1, hgt * 0.012);
    const P2 = (pts, fill) => poly(ctx, pts.map(([px, py]) => [px * w, py * hgt]), fill, P.outline, lw);
    P2([[-0.42, 0], [-0.38, -0.30], [-0.20, -0.48], [0.00, -0.42],
      [0.16, -0.52], [0.37, -0.28], [0.42, 0]], P.rockDark);
    P2([[-0.27, -0.18], [-0.12, -0.60], [0.06, -0.66], [0.23, -0.36], [0.15, -0.14]], P.rockLight);
    P2([[-0.40, -0.02], [-0.30, -0.20], [-0.14, -0.11], [-0.17, 0]], P.stoneDark);
    ctx.strokeStyle = rgba(P.weaponEdge, 0.12); ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-w * 0.30, -hgt * 0.22); ctx.lineTo(-w * 0.12, -hgt * 0.40);
    ctx.moveTo(w * 0.22, -hgt * 0.30); ctx.lineTo(w * 0.32, -hgt * 0.12);
    ctx.stroke();

    const facet = (cx, cy, r, rot) => {
      ctx.save();
      ctx.translate(cx * w, cy * hgt); ctx.rotate(rot);
      poly(ctx, [[-r, -r * 0.4], [-r * 0.25, -r], [r * 0.85, -r * 0.5],
        [r * 0.7, r * 0.7], [-r * 0.5, r]], P.goldDark, P.outline, lw);
      poly(ctx, [[-r * 0.25, -r], [r * 0.85, -r * 0.5], [r * 0.18, -r * 0.08], [-r * 0.7, -r * 0.2]],
        P.goldLight, null);
      ctx.restore();
    };
    facet(-0.26, -0.30, hgt * 0.088, -0.22);
    facet(0.20, -0.43, hgt * 0.098, 0.28);
    facet(0.01, -0.15, hgt * 0.070, 0.08);
    facet(0.30, -0.10, hgt * 0.060, -0.34);

    ctx.save();
    ctx.translate(0.01 * w, -0.60 * hgt);
    ctx.rotate(index % 2 === 0 ? -0.09 : 0.09);
    ctx.scale(1 + twinkle * 0.06, 1 + twinkle * 0.12);
    const spires = [[-0.080, 0.22, -0.16], [0.005, 0.34, 0], [0.090, 0.19, 0.15]];
    for (const [off, hh, tilt] of spires) {
      const bx = off * hgt, top = -hh * hgt, tip = bx + tilt * hgt * 0.10;
      poly(ctx, [[bx - hgt * 0.050, 0], [bx + hgt * 0.050, 0],
        [tip + hgt * 0.022, top + hgt * 0.055], [tip, top], [tip - hgt * 0.022, top + hgt * 0.055]],
        P.goldDark, P.outline, lw);
      poly(ctx, [[bx, 0], [bx + hgt * 0.050, 0],
        [tip + hgt * 0.022, top + hgt * 0.055], [tip, top]], P.goldColor, null);
      poly(ctx, [[tip, top], [tip - hgt * 0.022, top + hgt * 0.055], [bx, 0]], P.goldLight, null);
    }
    ctx.restore();

    for (let k = 0; k < A.trailDots; k++) {
      const ph = t * A.crystalTwinkleHz * TAU * 0.5 + k * 1.9 + index;
      ctx.save();
      ctx.globalAlpha = 0.20 + 0.55 * (0.5 + 0.5 * Math.sin(ph));
      const px = Math.cos(ph) * w * 0.36;
      const py = -hgt * (0.55 + 0.28 * (0.5 + 0.5 * Math.sin(ph + 1)));
      const r = Math.max(1, hgt * 0.016);
      poly(ctx, [[px, py - r], [px + r * 0.7, py], [px, py + r], [px - r * 0.7, py]], P.goldLight);
      ctx.restore();
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
        ctx.fillStyle = P.goldLight;
        const n = Math.min(workers, 4);
        for (let k = 0; k < n; k++) {
          const ph = t * A.mineSwingHz * TAU + k * 1.6;
          ctx.globalAlpha = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(ph));
          ctx.beginPath();
          ctx.arc(x + (k - (n - 1) / 2) * 8 + Math.sin(ph) * 2.5,
            y - hgt * (0.95 + 0.25 * (0.5 + 0.5 * Math.cos(ph))), 2.1, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  // ── 驻堡区：矢量护罩 ────────────────────────────────────────────────
  function drawFort(state) {
    if (state.gameMode !== 'garrison') return;
    const t = state.elapsed;
    const right = C.layout.statueInset * C.layout.fortInsetRatio + C.economy.mineArriveEps;
    const pulse = 0.5 + 0.5 * Math.sin(t * A.fortPulseHz * TAU);
    ctx.save();
    ctx.fillStyle = P.fortTint;
    ctx.fillRect(0, 0, right, state.h);
    ctx.strokeStyle = `rgba(140,200,215,${0.30 + pulse * 0.4})`;
    ctx.setLineDash([5, 7]);
    ctx.lineDashOffset = -t * 14;
    ctx.lineWidth = 1.6 + pulse;
    ctx.beginPath(); ctx.moveTo(right, 0); ctx.lineTo(right, state.h); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = rgba(P.weaponEdge, 0.7);
    ctx.font = '600 11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('驻 堡', right / 2, state.h * 0.16);
    ctx.restore();
  }

  // ── 单位：位图立绘 + 由模拟时间驱动的变换动画 + 矢量特效 ────────────────
  function drawUnit(state, assets, u, offsets) {
    const h = unitHeight(state, u);
    const t = state.elapsed;
    const gy = u.y;
    const cx = u.x + (offsets?.get(u.id) ?? 0);
    const color = u.team === 0 ? P.playerColor : P.enemyColor;
    const attack = u.atkAnim > 0 ? clamp01(u.atkAnim / C.combat.attackAnimSec) : 0;
    const flash = u.hitFlash > 0 ? clamp01(u.hitFlash / C.combat.hitFlashSec) : 0;
    const mining = u.kind === 'miner' && u.job === 'mining';
    const carryBob = u.kind === 'miner' && u.carry > 0
      ? Math.sin(t * A.carryBobHz * TAU) * A.carryBobRatio * h : 0;
    const breath = Math.sin(u.anim * A.breathHz * TAU + u.id) * A.breathRatio * h;
    const bob = Math.abs(Math.sin(u.walkPhase)) * A.bobRatio * h * (u.moving ? 1 : 0) +
      carryBob + breath;

    // 地面投影
    ctx.save();
    ctx.fillStyle = P.shadow;
    ctx.beginPath();
    ctx.ellipse(cx, gy - 1, h * (0.20 - bob / h * 0.4), h * 0.042, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    const src = assets.team(u.type, u.team) ?? assets.get(u.type);
    ctx.save();
    ctx.translate(cx, gy - bob);
    if (u.team === 1) ctx.scale(-1, 1);
    // 走路轻摆、攻击前倾、挖掘前俯、受击抖动；全部取自模拟时间/状态
    const tilt = (u.moving ? Math.sin(u.walkPhase) * 0.035 : 0)
      - attack * A.attackSwingRad * 0.09
      + (mining ? 0.06 + Math.sin(t * A.mineSwingHz * TAU) * 0.07 : 0)
      + (flash > 0 ? Math.sin(t * 60) * 0.02 * flash : 0);
    ctx.rotate(tilt);
    ctx.translate(attack * h * 0.06, 0);
    ctx.scale(1 + breath / h * 0.20, 1 - breath / h * 0.15);

    if (src) {
      const d = srcDims(src);
      const dw = h * (d.w / d.h);
      ctx.drawImage(src, -dw / 2, -h, dw, h);
      if (flash > 0 && assets.flash(u.type)) {
        ctx.globalAlpha = flash * P.flashAlpha;
        ctx.drawImage(assets.flash(u.type), -dw / 2, -h, dw, h);
      }
    } else {
      drawStickFigure(ctx, u.type, 0, 0, h, color, attack * 0.9);
    }
    ctx.restore();

    // 以下特效在世界坐标，不随立绘镜像/倾斜
    if (u.kind === 'miner' && u.carry > 0) {
      const bx = cx - h * 0.16, by = gy - h * 0.48 + carryBob * 0.4;
      poly(ctx, [[bx - h * 0.085, by], [bx + h * 0.085, by],
        [bx + h * 0.075, by + h * 0.15], [bx - h * 0.075, by + h * 0.15]],
        P.wood, P.outline, h * 0.010);
      poly(ctx, [[bx - h * 0.045, by + h * 0.02], [bx + h * 0.045, by + h * 0.02],
        [bx + h * 0.030, by + h * 0.085], [bx - h * 0.030, by + h * 0.085]],
        P.goldColor, null);
    }

    const bw = Math.max(28, h * 0.58), by = gy - h - 13;
    rounded(ctx, cx - bw / 2, by, bw, 5, 2.5, 'rgba(8,12,14,.85)', rgba(P.weaponEdge, 0.25), 1);
    rounded(ctx, cx - bw / 2 + 1, by + 1, (bw - 2) * clamp01(u.hp / u.maxHp), 3, 1.5, color);

    if (mining) {
      const p = 1 - clamp01(u.mineTimer / (u.mineDuration || C.economy.mineDurationSec));
      ctx.save();
      ctx.strokeStyle = P.goldColor; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, gy - h - 23, 8, -Math.PI / 2, -Math.PI / 2 + p * TAU);
      ctx.stroke();
      ctx.restore();
    }
    if (u.kind !== 'miner' && attack > 0 && !u.projectile) {
      ctx.save();
      ctx.strokeStyle = rgba(P.weaponEdge, 0.65 * attack);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx + (u.team === 1 ? -8 : 8), gy - h * 0.62, h * 0.34 * attack,
        -Math.PI / 3, Math.PI / 3);
      ctx.stroke();
      ctx.restore();
    }
    if (u.inFort) {
      ctx.strokeStyle = rgba(P.trailPlayer, 0.35 + 0.3 * Math.sin(t * A.fortPulseHz * TAU));
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(cx, gy - h * 0.5, h * 0.38, 0, TAU); ctx.stroke();
    }
  }

  // ── 投射物 / 金币迸发：保留矢量 ───────────────────────────────────────
  function drawProjectile(state, p) {
    const t = p.age;
    const arc = p.kind === 'rock' ? -Math.sin(Math.min(1, t / 0.6) * Math.PI) * 26 : 0;
    const x = p.x, y = p.y + arc;
    const ang = Math.atan2(p.ty - p.y, p.tx - p.x);
    const trail = p.team === 0 ? P.trailPlayer : P.trailEnemy;
    ctx.save();
    for (let k = 1; k <= A.trailDots; k++) {
      const d = k * 4.5;
      ctx.save();
      ctx.globalAlpha = 0.30 * (1 - k / (A.trailDots + 1));
      disc(ctx, x - Math.cos(ang) * d, y - Math.sin(ang) * d, Math.max(1, 3.2 - k * 0.5), trail);
      ctx.restore();
    }
    if (p.kind === 'arrow') {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang);
      ctx.strokeStyle = P.outline; ctx.lineWidth = 4.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-13, 0); ctx.lineTo(8, 0); ctx.stroke();
      ctx.strokeStyle = P.wood; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(-13, 0); ctx.lineTo(8, 0); ctx.stroke();
      poly(ctx, [[8, 0], [1, -3.6], [1, 3.6]], P.weaponEdge, P.outline, 1);
      for (const s of [-1, 1]) poly(ctx, [[-13, 0], [-17, s * 4], [-9, s * 2]], trail, null);
      ctx.restore();
    } else if (p.kind === 'rock') {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t * A.projectileSpinHz * TAU);
      poly(ctx, [[-6, -3], [-1, -7], [6, -4], [7, 2], [2, 7], [-5, 5]],
        P.rockDark, P.outline, 1.2);
      poly(ctx, [[-6, -3], [-1, -7], [1, -2], [-4, 0]], P.rockLight, null);
      ctx.restore();
    } else {
      const pulse = 0.5 + 0.5 * Math.sin(t * A.projectileSpinHz * TAU);
      const g = ctx.createRadialGradient(x, y, 1, x, y, 15 + pulse * 6);
      g.addColorStop(0, trail);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, 15 + pulse * 6, 0, TAU); ctx.fill();
      disc(ctx, x, y, 4.2 + pulse, '#fff', P.outline, 1.2);
      ctx.strokeStyle = trail; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(x, y, 8 + pulse * 2, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

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
      const px = x + Math.cos(a) * r, py = y - k * 30 + Math.sin(a) * r * 0.4;
      const s = 2.8 * (1 - k * 0.5);
      ctx.globalAlpha = (1 - k) * 0.95;
      poly(ctx, [[px, py - s], [px + s * 0.7, py], [px, py + s], [px - s * 0.7, py]], P.goldLight);
    }
    ctx.restore();
  }

  // 同队同位置的单位在渲染层按 id 稳定错开，不改物理坐标。
  function visualOffsets(state, units) {
    const h = state.h * C.layout.unitHeightRatio;
    const near = h * 0.55;
    const out = new Map();
    for (const u of units) {
      const group = units.filter((v) => v.team === u.team && Math.abs(v.x - u.x) < near);
      const rank = group.filter((v) => v.id < u.id).length;
      out.set(u.id, group.length > 1 ? (rank - (group.length - 1) / 2) * h * 0.22 : 0);
    }
    return out;
  }

  function draw(state, assets) {
    ctx.clearRect(0, 0, state.w, state.h);
    drawBackground(state, assets);
    drawFort(state);
    drawStatues(state, assets);
    drawMines(state);
    drawGoldBurst(state);
    const sorted = [...state.units].sort((a, b) => a.x - b.x);
    const offsets = visualOffsets(state, sorted);
    for (const u of sorted) drawUnit(state, assets, u, offsets);
    for (const p of state.projectiles) drawProjectile(state, p);
  }

  return { resize, draw };
}
