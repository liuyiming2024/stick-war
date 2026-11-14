import { CONFIG } from './config.js';

const C = CONFIG;
const P = C.presentation;

function unitHeight(state, u) {
  const base = state.h * C.layout.unitHeightRatio;
  if (u.type === 'giant') return base * C.layout.giantHeightMul;
  if (u.type === 'miner') return base * C.layout.minerHeightMul;
  return base;
}

function bgRectFor(img, w, h) {
  if (!img?.naturalWidth) return null;
  const ir = img.naturalWidth / img.naturalHeight;
  const cr = w / h;
  let dw, dh;
  if (cr > ir) { dw = w; dh = w / ir; } else { dh = h; dw = h * ir; }
  return { x: (w - dw) / 2, y: (h - dh) / 2, dw, dh };
}

// 素材缺失时的真实降级绘制：火柴人线稿 + 兵种区分，而不是直接隐形。
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
  ctx.arc(cx, headY, headR, 0, Math.PI * 2);
  ctx.moveTo(cx, headY + headR); ctx.lineTo(cx, hipY);
  ctx.moveTo(cx, shoulderY); ctx.lineTo(cx - hgt * 0.14, hipY + hgt * 0.06);
  ctx.moveTo(cx, shoulderY); ctx.lineTo(cx + hgt * 0.14, hipY + hgt * 0.06);
  ctx.moveTo(cx, hipY); ctx.lineTo(cx - hgt * 0.13, groundY);
  ctx.moveTo(cx, hipY); ctx.lineTo(cx + hgt * 0.13, groundY);
  ctx.stroke();
  // 武器 / 工种标识
  ctx.lineWidth = Math.max(2, hgt * 0.035);
  ctx.beginPath();
  if (key === 'sword' || key === 'spear') {
    const len = key === 'spear' ? hgt * 0.55 : hgt * 0.38;
    ctx.moveTo(cx + hgt * 0.12, shoulderY);
    ctx.lineTo(cx + hgt * 0.12 + Math.cos(swing) * len, shoulderY - Math.sin(swing) * len);
  } else if (key === 'archer') {
    ctx.arc(cx + hgt * 0.18, shoulderY + hgt * 0.06, hgt * 0.18, -Math.PI / 2, Math.PI / 2);
  } else if (key === 'wizard') {
    ctx.arc(cx + hgt * 0.17, shoulderY - hgt * 0.12, hgt * 0.09, 0, Math.PI * 2);
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
  let bgRect = null;

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
    bgRect = null;
  }

  function drawBackground(state, assets) {
    const bg = assets.get('battlefield');
    if (!bgRect && bg) bgRect = bgRectFor(bg, state.w, state.h);
    if (bgRect) {
      ctx.drawImage(bg, bgRect.x, bgRect.y, bgRect.dw, bgRect.dh);
      ctx.fillStyle = P.backgroundTint;
      ctx.fillRect(0, state.h * 0.72, state.w, state.h * 0.28);
    } else {
      ctx.fillStyle = '#8fc76a';
      ctx.fillRect(0, 0, state.w, state.h);
      ctx.fillStyle = 'rgba(90,140,60,.25)';
      ctx.fillRect(0, state.h * 0.76, state.w, state.h * 0.24);
    }
  }

  function drawStatues(state, assets) {
    const sh = state.h * C.layout.statueHeightRatio;
    const gy = state.h * C.layout.groundRatio + state.h * 0.04;
    const left = C.layout.statueInset;
    const right = state.w - C.layout.statueInset;
    for (const [x, team] of [[left, 0], [right, 1]]) {
      const color = team === 0 ? P.playerColor : P.enemyColor;
      ctx.save();
      ctx.fillStyle = team === 0 ? 'rgba(63,174,75,.30)' : 'rgba(212,58,58,.28)';
      ctx.beginPath(); ctx.ellipse(x, gy, sh * 0.17, sh * 0.03, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      if (assets.get('statue')) {
        const img = assets.get('statue');
        const dw = sh * (img.naturalWidth / img.naturalHeight);
        ctx.save();
        ctx.translate(x, gy);
        if (team === 1) ctx.scale(-1, 1);
        ctx.drawImage(img, -dw / 2, -sh, dw, sh);
        ctx.restore();
      } else {
        ctx.save();
        ctx.fillStyle = team === 0 ? '#4a7d4a' : '#8d4a4a';
        ctx.fillRect(x - sh * 0.16, gy - sh, sh * 0.32, sh);
        ctx.restore();
      }
      // 血条贴在雕像头顶
      const hp = team === 0 ? state.homeHp : state.enemyHp;
      const bw = sh * 0.42;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(x - bw / 2, gy - sh - 14, bw, 5);
      ctx.fillStyle = color;
      ctx.fillRect(x - bw / 2, gy - sh - 14, bw * Math.max(0, hp / C.match.statueHp), 5);
    }
  }

  function drawMine(state) {
    const x = state.w * C.layout.goldMineXRatio;
    const y = state.h * C.layout.goldMineYRatio;
    ctx.save();
    ctx.fillStyle = 'rgba(255,210,77,.92)';
    ctx.beginPath(); ctx.arc(x, y, 17, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#a8790f'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#6b4c07'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center';
    ctx.fillText('金矿', x, y + 4);
    ctx.restore();
  }

  function drawSprite(state, assets, key, cx, groundY, hgt, faceLeft, swing) {
    const img = assets.get(key);
    if (!img) {
      drawStickFigure(ctx, key, cx, groundY, hgt,
        faceLeft ? P.enemyColor : P.playerColor, swing);
      return null;
    }
    const dw = hgt * (img.naturalWidth / img.naturalHeight);
    ctx.save();
    ctx.translate(cx, groundY);
    if (faceLeft) ctx.scale(-1, 1);
    ctx.drawImage(img, -dw / 2, -hgt, dw, hgt);
    ctx.restore();
    return { img, dw, x: cx - dw / 2, y: groundY - hgt };
  }

  function drawUnit(state, assets, u) {
    const hgt = unitHeight(state, u);
    const gy = u.y;
    const faceLeft = u.team === 1;
    const lunge = u.atkAnim > 0 ? (u.team === 0 ? 7 : -7) : 0;
    const bob = Math.sin(u.anim * 9) * hgt * 0.012;
    const color = u.team === 0 ? P.playerColor : P.enemyColor;

    ctx.save();
    ctx.fillStyle = u.team === 0 ? 'rgba(63,174,75,.30)' : 'rgba(212,58,58,.28)';
    ctx.beginPath(); ctx.ellipse(u.x, gy - 2, hgt * 0.2, hgt * 0.05, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    const placed = drawSprite(state, assets, u.type, u.x + lunge, gy + 1 - bob, hgt, faceLeft,
      u.atkAnim > 0 ? 0.9 : 0.25);

    // 受击闪白：用预生成的白色剪影叠加，避免每帧 ctx.filter。
    if (u.hitFlash > 0) {
      const alpha = (u.hitFlash / C.combat.hitFlashSec) * P.flashAlpha;
      const flash = assets.flash(u.type);
      ctx.save();
      ctx.globalAlpha = alpha;
      if (flash && placed) {
        ctx.drawImage(flash, placed.x, placed.y, placed.dw, hgt);
      } else {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(u.x, gy - hgt * 0.55, hgt * 0.16, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    const bw = Math.max(26, hgt * 0.55);
    const by = gy - hgt - 11;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(u.x - bw / 2, by, bw, 4);
    ctx.fillStyle = color;
    ctx.fillRect(u.x - bw / 2, by, bw * Math.max(0, u.hp / u.maxHp), 4);

    if (u.kind === 'miner') {
      if (u.carry > 0) {
        ctx.fillStyle = P.goldColor;
        ctx.fillRect(u.x - 4, gy - hgt * 0.45, 8, 8);
      }
      if (u.job === 'mining') {
        const p = 1 - Math.max(0, u.mineTimer) / C.economy.mineDurationSec;
        ctx.save();
        ctx.strokeStyle = P.goldColor; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(u.x, gy - hgt - 20, 7, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
        ctx.stroke(); ctx.restore();
      }
    } else if (u.atkAnim > 0 && !u.projectile) {
      ctx.save();
      ctx.strokeStyle = u.team === 0 ? 'rgba(255,255,255,.75)' : 'rgba(255,200,200,.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(u.x + (faceLeft ? -8 : 8), gy - hgt * 0.62, hgt * 0.34,
        -Math.PI / 3, Math.PI / 3);
      ctx.stroke(); ctx.restore();
    }
  }

  function drawProjectile(state, p) {
    ctx.save();
    const arc = p.kind === 'rock' ? -Math.sin(Math.min(1, p.age / 0.6) * Math.PI) * 26 : 0;
    const x = p.x, y = p.y + arc;
    if (p.kind === 'arrow') {
      const ang = Math.atan2(p.ty - p.y, p.tx - p.x);
      ctx.strokeStyle = p.team === 0 ? '#eaffea' : '#ffe0e0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(ang) * 10, y - Math.sin(ang) * 10);
      ctx.lineTo(x + Math.cos(ang) * 6, y + Math.sin(ang) * 6);
      ctx.stroke();
    } else if (p.kind === 'rock') {
      ctx.fillStyle = '#8a7660';
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = p.team === 0 ? '#9dffb0' : '#ff9d9d';
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function draw(state, assets) {
    ctx.clearRect(0, 0, state.w, state.h);
    drawBackground(state, assets);
    drawStatues(state, assets);
    drawMine(state);
    // 复制后再排序：渲染顺序不再改写物理数组。
    const sorted = [...state.units].sort((a, b) => a.x - b.x);
    for (const u of sorted) drawUnit(state, assets, u);
    for (const p of state.projectiles) drawProjectile(state, p);
  }

  return { resize, draw, invalidateBackground: () => { bgRect = null; } };
}
