// 角色形象层：一套统一骨架 + 逐兵种装备 + 程序化动作。
// 只依赖 CONFIG.presentation 里的两方颜色，不读 state，也不改任何玩法逻辑。
//
// 坐标约定：人物本地单位（身高 ≈ 1.0，脚底 y=0，y 轴向上），
// 由 drawUnitFigure 统一 scale(±height, -height)，线宽也用单位表示，换屏幕尺寸不糊。
// 肢体角度：0 = 竖直向下，正 = 朝前；武器角度：0 = 水平朝前，正 = 朝上。
import { CONFIG } from './config.js';

const P = CONFIG.presentation;

// 墨线 + 暖白身体：7 个兵种共用同一套颜色，只靠装备与剪影区分，阵营色出现在头巾/腰带/缨穗上。
const INK = '#191b1f';
const BODY = '#f8f4ea';
const BODY_BACK = '#e4dbc8';
const STEEL = '#d5dce4';
const STEEL_DARK = '#93a0ad';
const WOOD = '#a9713f';
const WOOD_DARK = '#7b4e2a';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const seg = (p, a, b) => clamp((p - a) / (b - a || 1e-6), 0, 1);

const dirA = (a) => ({ x: Math.sin(a), y: -Math.cos(a) });   // 肢体：0 = 向下
const dirW = (a) => ({ x: Math.cos(a), y: Math.sin(a) });    // 武器：0 = 向前
const add = (p, d, len) => ({ x: p.x + d.x * len, y: p.y + d.y * len });

function bone(ctx, a, b, w, fill, ink, inkW) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  if (inkW > 0) { ctx.strokeStyle = ink; ctx.lineWidth = w + inkW * 2; ctx.stroke(); }
  ctx.strokeStyle = fill; ctx.lineWidth = w; ctx.stroke();
}

function dot(ctx, p, r, fill, ink, inkW) {
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU);
  ctx.fillStyle = fill; ctx.fill();
  if (inkW > 0) { ctx.strokeStyle = ink; ctx.lineWidth = inkW; ctx.stroke(); }
}

function shape(ctx, pts, fill, ink, inkW) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (inkW > 0) { ctx.strokeStyle = ink; ctx.lineWidth = inkW; ctx.lineJoin = 'round'; ctx.stroke(); }
}

// 两段 IK：已知肩点与手要抓的位置，反解肘。
function solveArm(shoulder, target, l1, l2, bend = 1) {
  let d = Math.hypot(target.x - shoulder.x, target.y - shoulder.y) || 1e-6;
  const reach = (l1 + l2) * 0.985;
  const tgt = d > reach
    ? { x: shoulder.x + (target.x - shoulder.x) / d * reach, y: shoulder.y + (target.y - shoulder.y) / d * reach }
    : target;
  d = Math.min(d, reach);
  const base = Math.atan2(tgt.y - shoulder.y, tgt.x - shoulder.x);
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const ang = base + bend * Math.acos(cosA);
  return {
    elbow: { x: shoulder.x + Math.cos(ang) * l1, y: shoulder.y + Math.sin(ang) * l1 },
    hand: tgt,
  };
}

function armIK(ctx, shoulder, target, l1, l2, w, fill, ink, inkW, bend = 1) {
  const r = solveArm(shoulder, target, l1, l2, bend);
  bone(ctx, shoulder, r.elbow, w, fill, ink, inkW);
  bone(ctx, r.elbow, r.hand, w * 0.9, fill, ink, inkW);
  return r;
}


// 圆角多边形：躯干这种「有厚度」的形体用它收肩，避免方肩
function roundPoly(ctx, pts, r) {
  const n = pts.length;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    const v1 = { x: p.x - prev.x, y: p.y - prev.y };
    const v2 = { x: next.x - p.x, y: next.y - p.y };
    const l1 = Math.hypot(v1.x, v1.y) || 1;
    const l2 = Math.hypot(v2.x, v2.y) || 1;
    const r1 = Math.min(r, l1 * 0.5);
    const r2 = Math.min(r, l2 * 0.5);
    const a = { x: p.x - v1.x / l1 * r1, y: p.y - v1.y / l1 * r1 };
    const b = { x: p.x + v2.x / l2 * r2, y: p.y + v2.y / l2 * r2 };
    if (i === 0) ctx.moveTo(a.x, a.y); else ctx.lineTo(a.x, a.y);
    ctx.quadraticCurveTo(p.x, p.y, b.x, b.y);
  }
  ctx.closePath();
}

// 布片飘带（头巾尾巴）
function ribbon(ctx, from, len, angle, wave, w0, fill, ink, inkW) {
  const mid = add(from, dirW(angle + wave * 0.35), len * 0.55);
  const end = add(mid, dirW(angle + wave), len * 0.55);
  const n = { x: -Math.sin(angle), y: Math.cos(angle) };
  shape(ctx, [
    { x: from.x + n.x * w0 * 0.5, y: from.y + n.y * w0 * 0.5 },
    { x: mid.x + n.x * w0 * 0.36, y: mid.y + n.y * w0 * 0.36 },
    { x: end.x + n.x * w0 * 0.14, y: end.y + n.y * w0 * 0.14 },
    { x: end.x - n.x * w0 * 0.14, y: end.y - n.y * w0 * 0.14 },
    { x: mid.x - n.x * w0 * 0.36, y: mid.y - n.y * w0 * 0.36 },
    { x: from.x - n.x * w0 * 0.5, y: from.y - n.y * w0 * 0.5 },
  ], fill, ink, inkW);
}

/* ------------------------------------------------------------------ *
 * 武器：都在「握把为原点、刃口朝 +x」的局部坐标里画，再由调用方旋转。
 * ------------------------------------------------------------------ */

function drawSword(ctx, pal, inkW) {
  shape(ctx, [{ x: -0.085, y: -0.012 }, { x: 0.014, y: -0.012 }, { x: 0.014, y: 0.012 }, { x: -0.085, y: 0.012 }], WOOD, pal.ink, inkW);
  dot(ctx, { x: -0.094, y: 0 }, 0.016, pal.team, pal.ink, inkW);
  shape(ctx, [{ x: -0.008, y: -0.046 }, { x: 0.030, y: -0.046 }, { x: 0.030, y: 0.046 }, { x: -0.008, y: 0.046 }], STEEL_DARK, pal.ink, inkW);
  shape(ctx, [
    { x: 0.028, y: -0.033 }, { x: 0.27, y: -0.028 }, { x: 0.325, y: 0 }, { x: 0.27, y: 0.028 }, { x: 0.028, y: 0.033 },
  ], STEEL, pal.ink, inkW);
  ctx.beginPath(); ctx.moveTo(0.05, 0.011); ctx.lineTo(0.285, 0.007);
  ctx.strokeStyle = '#fff'; ctx.globalAlpha = 0.85; ctx.lineWidth = 0.007; ctx.stroke(); ctx.globalAlpha = 1;
}

function drawSpear(ctx, pal, inkW, t) {
  shape(ctx, [{ x: -0.30, y: -0.012 }, { x: 0.34, y: -0.010 }, { x: 0.34, y: 0.010 }, { x: -0.30, y: 0.012 }], WOOD, pal.ink, inkW);
  shape(ctx, [
    { x: 0.33, y: -0.034 }, { x: 0.385, y: -0.026 }, { x: 0.45, y: 0 }, { x: 0.385, y: 0.026 }, { x: 0.33, y: 0.034 },
  ], STEEL, pal.ink, inkW);
  ctx.beginPath(); ctx.moveTo(0.34, 0); ctx.lineTo(0.435, 0);
  ctx.strokeStyle = '#fff'; ctx.globalAlpha = 0.7; ctx.lineWidth = 0.008; ctx.stroke(); ctx.globalAlpha = 1;
  ribbon(ctx, { x: 0.315, y: 0.012 }, 0.095, 0.9 + Math.sin(t * 7) * 0.12, 0.22, 0.03, pal.team, pal.ink, inkW);
}

function drawBow(ctx, pal, inkW, draw) {
  // 在「握把为原点」的局部坐标里画，弦扣 = 后手位置
  const top = { x: 0.00, y: 0.225 };
  const bot = { x: 0.00, y: -0.225 };
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.quadraticCurveTo(0.185, 0.10, 0.185, 0);
  ctx.quadraticCurveTo(0.185, -0.10, bot.x, bot.y);
  ctx.strokeStyle = pal.ink; ctx.lineJoin = 'round'; ctx.lineWidth = 0.020 + inkW * 2; ctx.stroke();
  ctx.strokeStyle = WOOD; ctx.lineWidth = 0.020; ctx.stroke();
  ctx.strokeStyle = WOOD_DARK; ctx.lineWidth = 0.007;
  ctx.beginPath(); ctx.moveTo(top.x, top.y - 0.02); ctx.quadraticCurveTo(0.16, 0, bot.x, bot.y + 0.02); ctx.stroke();

  const nock = { x: -0.01 - draw * 0.13, y: 0 };
  ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(nock.x, nock.y); ctx.lineTo(bot.x, bot.y);
  ctx.strokeStyle = pal.ink; ctx.lineWidth = 0.008; ctx.stroke();

  if (draw > 0.12) {
    shape(ctx, [{ x: nock.x, y: -0.006 }, { x: 0.30, y: -0.006 }, { x: 0.30, y: 0.006 }, { x: nock.x, y: 0.006 }],
      '#eae4d6', pal.ink, inkW * 0.8);
    shape(ctx, [{ x: 0.30, y: -0.022 }, { x: 0.35, y: 0 }, { x: 0.30, y: 0.022 }], STEEL, pal.ink, inkW * 0.8);
    shape(ctx, [{ x: nock.x + 0.045, y: -0.006 }, { x: nock.x + 0.005, y: -0.034 }, { x: nock.x + 0.07, y: -0.012 }],
      pal.team, pal.ink, inkW * 0.7);
  }
}

function drawRock(ctx, pal, inkW, scale = 1) {
  const s = scale;
  shape(ctx, [
    { x: -0.10 * s, y: -0.02 * s }, { x: -0.058 * s, y: 0.084 * s }, { x: 0.046 * s, y: 0.096 * s },
    { x: 0.102 * s, y: 0.026 * s }, { x: 0.082 * s, y: -0.06 * s }, { x: -0.02 * s, y: -0.088 * s },
  ], '#9b9184', pal.ink, inkW);
  shape(ctx, [{ x: -0.05 * s, y: 0.058 * s }, { x: 0.028 * s, y: 0.072 * s }, { x: 0.06 * s, y: 0.004 * s }, { x: -0.02 * s, y: 0.0 }],
    '#bdb3a4', pal.ink, 0);
}

function drawStaff(ctx, pal, inkW, charge) {
  shape(ctx, [{ x: -0.26, y: -0.012 }, { x: 0.24, y: -0.010 }, { x: 0.24, y: 0.010 }, { x: -0.26, y: 0.012 }], WOOD_DARK, pal.ink, inkW);
  const orb = { x: 0.225, y: 0.012 };
  const r = 0.036 + charge * 0.026;
  if (charge > 0.02) {
    const g = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, r * 3.4);
    g.addColorStop(0, `rgba(190,245,255,${0.45 + charge * 0.4})`);
    g.addColorStop(1, 'rgba(120,200,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(orb.x, orb.y, r * 3.4, 0, TAU); ctx.fill();
  }
  dot(ctx, orb, r, '#eafcff', pal.ink, inkW);
  dot(ctx, { x: orb.x - r * 0.26, y: orb.y + r * 0.28 }, r * 0.34, '#ffffff', pal.ink, 0);
}

function drawPickaxe(ctx, pal, inkW) {
  shape(ctx, [{ x: -0.22, y: -0.011 }, { x: 0.19, y: -0.010 }, { x: 0.19, y: 0.010 }, { x: -0.22, y: 0.011 }], WOOD, pal.ink, inkW);
  ctx.beginPath();
  ctx.moveTo(0.11, 0.035);
  ctx.quadraticCurveTo(0.19, 0.11, 0.285, 0.026);
  ctx.quadraticCurveTo(0.19, 0.068, 0.11, -0.012);
  ctx.closePath();
  ctx.fillStyle = STEEL; ctx.fill();
  ctx.strokeStyle = pal.ink; ctx.lineWidth = inkW; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-0.21, 0); ctx.lineTo(-0.165, 0);
  ctx.strokeStyle = pal.team; ctx.lineWidth = 0.018; ctx.stroke();
}

function drawClub(ctx, pal, inkW) {
  shape(ctx, [{ x: -0.28, y: -0.018 }, { x: 0.14, y: -0.016 }, { x: 0.14, y: 0.016 }, { x: -0.28, y: 0.018 }], WOOD, pal.ink, inkW);
  shape(ctx, [
    { x: 0.08, y: -0.09 }, { x: 0.23, y: -0.11 }, { x: 0.32, y: -0.03 },
    { x: 0.31, y: 0.08 }, { x: 0.17, y: 0.10 }, { x: 0.08, y: 0.065 },
  ], '#9b9184', pal.ink, inkW);
  shape(ctx, [{ x: 0.13, y: 0.055 }, { x: 0.23, y: 0.065 }, { x: 0.27, y: 0.0 }, { x: 0.16, y: -0.045 }], '#b8ae9f', pal.ink, 0);
}

/* ------------------------------------------------------------------ *
 * 头饰
 * ------------------------------------------------------------------ */

function capOfHead(ctx, head, r, from, fill, ink, inkW) {
  ctx.beginPath();
  ctx.arc(head.x, head.y, r * 1.015, 0, Math.PI);
  ctx.lineTo(head.x - r * 1.015, head.y + from);
  ctx.lineTo(head.x + r * 1.015, head.y + from);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  if (inkW > 0) { ctx.strokeStyle = ink; ctx.lineWidth = inkW; ctx.stroke(); }
}

function bandana(ctx, head, r, pal, inkW, t, sway, from = 0.46) {
  capOfHead(ctx, head, r, r * from, pal.team, pal.ink, inkW);
  dot(ctx, { x: head.x - r * 0.94, y: head.y + r * (from + 0.03) }, r * 0.115, pal.team, pal.ink, inkW);
  ribbon(ctx, { x: head.x - r * 0.98, y: head.y + r * (from + 0.03) }, r * 0.78, Math.PI - 0.24 + sway * 0.3, sway, r * 0.20,
    pal.team, pal.ink, inkW);
}

function helmet(ctx, head, r, pal, inkW) {
  capOfHead(ctx, head, r, r * 0.16, STEEL, pal.ink, inkW);
  ctx.beginPath(); ctx.moveTo(head.x - r * 0.99, head.y + r * 0.17); ctx.lineTo(head.x + r * 0.99, head.y + r * 0.17);
  ctx.strokeStyle = STEEL_DARK; ctx.lineWidth = inkW * 1.5; ctx.stroke();
  // 盔缨
  shape(ctx, [{ x: head.x - r * 0.18, y: head.y + r * 0.98 }, { x: head.x + r * 0.03, y: head.y + r * 1.55 },
    { x: head.x + r * 0.21, y: head.y + r * 0.95 }], pal.team, pal.ink, inkW);
}

function hood(ctx, head, r, pal, inkW, t, sway) {
  // 兜帽：包住后脑，留出正面的脸
  ctx.beginPath();
  ctx.moveTo(head.x + r * 0.72, head.y + r * 0.52);
  ctx.quadraticCurveTo(head.x + r * 0.55, head.y + r * 1.32, head.x - r * 0.18, head.y + r * 1.30);
  ctx.quadraticCurveTo(head.x - r * 1.22, head.y + r * 0.35, head.x - r * 0.7, head.y - r * 0.62);
  ctx.quadraticCurveTo(head.x - r * 0.2, head.y - r * 0.2, head.x + r * 0.28, head.y + r * 0.16);
  ctx.closePath();
  ctx.fillStyle = pal.team; ctx.fill();
  ctx.strokeStyle = pal.ink; ctx.lineWidth = inkW; ctx.stroke();
  // 帽尖垂在脑后
  shape(ctx, [{ x: head.x - r * 0.95, y: head.y + r * 0.5 }, { x: head.x - r * 1.72, y: head.y + r * 0.02 + sway * r * 0.25 },
    { x: head.x - r * 0.9, y: head.y - r * 0.25 }], pal.team, pal.ink, inkW);
}

function wizardHat(ctx, head, r, pal, inkW, t, sway) {
  ctx.beginPath();
  ctx.ellipse(head.x, head.y + r * 0.62, r * 1.42, r * 0.30, 0, 0, TAU);
  ctx.fillStyle = pal.team; ctx.fill();
  ctx.strokeStyle = pal.ink; ctx.lineWidth = inkW; ctx.stroke();
  const tipX = head.x - r * 0.5 + sway * r * 0.6;
  shape(ctx, [
    { x: head.x + r * 0.8, y: head.y + r * 0.72 }, { x: head.x + r * 0.18, y: head.y + r * 1.5 },
    { x: tipX, y: head.y + r * 2.7 }, { x: head.x - r * 0.58, y: head.y + r * 1.46 }, { x: head.x - r * 0.9, y: head.y + r * 0.7 },
  ], pal.team, pal.ink, inkW);
  ctx.beginPath(); ctx.moveTo(head.x - r * 0.8, head.y + r * 0.9); ctx.lineTo(head.x + r * 0.78, head.y + r * 0.9);
  ctx.strokeStyle = '#ffd24d'; ctx.lineWidth = inkW * 1.8; ctx.stroke();
  const st = { x: head.x - r * 0.02 + sway * r * 0.4, y: head.y + r * 1.78 };
  ctx.fillStyle = '#ffe98a';
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a1 = -Math.PI / 2 + i * TAU / 5;
    const a2 = a1 + TAU / 10;
    ctx.lineTo(st.x + Math.cos(a1) * r * 0.23, st.y + Math.sin(a1) * r * 0.23);
    ctx.lineTo(st.x + Math.cos(a2) * r * 0.09, st.y + Math.sin(a2) * r * 0.09);
  }
  ctx.closePath(); ctx.fill();
}

function beard(ctx, head, r, pal, inkW) {
  ctx.beginPath();
  ctx.moveTo(head.x + r * 0.50, head.y - r * 0.16);
  ctx.quadraticCurveTo(head.x + r * 0.34, head.y - r * 0.95, head.x + r * 0.02, head.y - r * 1.10);
  ctx.quadraticCurveTo(head.x - r * 0.36, head.y - r * 0.90, head.x - r * 0.50, head.y - r * 0.10);
  ctx.quadraticCurveTo(head.x, head.y - r * 0.35, head.x + r * 0.55, head.y - r * 0.10);
  ctx.closePath();
  ctx.fillStyle = '#eeebe0'; ctx.fill();
  ctx.strokeStyle = pal.ink; ctx.lineWidth = inkW; ctx.stroke();
}

function robe(ctx, hip, pal, inkW, t, sway) {
  const hem = -0.01;
  const w = 0.20;
  const sw = Math.sin(t * 3.6) * 0.012 + sway * 0.008;
  shape(ctx, [
    { x: hip.x - 0.082, y: hip.y + 0.035 },
    { x: hip.x + 0.082, y: hip.y + 0.035 },
    { x: hip.x + w + sw, y: hem },
    { x: hip.x + w * 0.5, y: hem - 0.012 },
    { x: hip.x, y: hem + 0.008 },
    { x: hip.x - w * 0.5, y: hem - 0.018 },
    { x: hip.x - w - sw, y: hem },
  ], '#4a6b57', pal.ink, inkW);
  ctx.beginPath(); ctx.moveTo(hip.x + 0.02, hip.y + 0.01); ctx.lineTo(hip.x + 0.05, hem + 0.035);
  ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 0.012; ctx.stroke();
}

function quiver(ctx, from, pal, inkW) {
  const a = { x: from.x - 0.045, y: from.y - 0.06 };
  const b = { x: from.x + 0.012, y: from.y + 0.055 };
  bone(ctx, a, b, 0.038, WOOD_DARK, pal.ink, inkW);
  for (let i = -1; i <= 1; i++) {
    const s = { x: a.x + 0.012 + i * 0.018, y: a.y + 0.075 };
    shape(ctx, [{ x: s.x - 0.012, y: s.y - 0.026 }, { x: s.x, y: s.y + 0.014 }, { x: s.x + 0.012, y: s.y - 0.026 }],
      pal.team, pal.ink, inkW * 0.7);
  }
}

/* ------------------------------------------------------------------ *
 * 主绘制
 * ------------------------------------------------------------------ */

const BULK = { miner: 0.96, sword: 1.0, spear: 1.08, archer: 0.96, stone: 1.16, wizard: 0.95, giant: 1.4 };
const HEADSCALE = { giant: 0.9, wizard: 0.98 };

export function drawUnitFigure(ctx, o) {
  const teamColor = o.team === 0 ? P.playerColor : P.enemyColor;
  const pal = o.white ? { ink: '#ffffff', team: '#ffffff' } : { ink: INK, team: teamColor };
  const type = o.type;
  const bulk = BULK[type] ?? 1;
  const inkW = o.white ? 0 : 0.010;
  const H = o.height;
  const t = o.t ?? 0;
  const atk = clamp(o.atk ?? 0, 0, 1);
  const flash = clamp(o.flash ?? 0, 0, 1);
  const walkAmt = clamp(o.walkAmt ?? 0, 0, 1);
  const phase = o.walkPhase ?? 0;
  const sway = Math.sin(t * 3.2) * 0.05;
  const body = o.white ? '#ffffff' : BODY;
  const bodyBack = o.white ? '#ffffff' : BODY_BACK;

  ctx.save();
  ctx.translate(o.x, o.groundY);
  ctx.scale(o.faceLeft ? -H : H, -H);

  /* —— 骨架 —— */
  const HIP_Y = 0.44;
  const THIGH = 0.22, SHIN = 0.22;
  const TORSO = 0.33;
  const UPPER = 0.19, FORE = 0.17;
  const headR = 0.104 * (HEADSCALE[type] ?? 1);

  const walkBob = Math.sin(phase * 2) * 0.013 * walkAmt;
  const breathe = Math.sin(t * 2.0) * 0.004;
  const crouch = type === 'giant' ? 0.01 : 0.004;
  let hipY = HIP_Y - walkBob - crouch + breathe * 0.25;

  let lean = 0;
  if (walkAmt > 0.05) lean = 0.05 * walkAmt;
  if (flash > 0) lean -= 0.12 * flash;
  if (atk > 0) lean += (type === 'spear' ? 0.22 : 0.16) * Math.sin(atk * Math.PI);
  if (type === 'giant') lean += 0.05;

  /* —— 腿：先算角度，再把「较低的那只脚」贴回地面，走路的落脚才不会飘 —— */
  function legAngles(sign) {
    let thighA, shinA;
    if (walkAmt > 0.02) {
      const s2 = Math.sin(phase + (sign > 0 ? 0 : Math.PI));
      thighA = 0.46 * s2 * walkAmt;
      shinA = thighA - 0.58 * Math.max(0, -s2) * walkAmt;
    } else {
      thighA = 0.07 * sign;
      shinA = 0.17 * sign;
    }
    if (atk > 0) {
      const k = Math.sin(atk * Math.PI);
      thighA += (sign > 0 ? 0.24 : -0.16) * k;
      shinA += (sign > 0 ? 0.10 : -0.04) * k;
    }
    return { thighA, shinA };
  }

  const legs = [legAngles(-1), legAngles(1)];
  const ankleOf = (a, h) => add(add(h, dirA(a.thighA), THIGH), dirA(a.shinA), SHIN);
  const drop = Math.min(ankleOf(legs[0], { x: 0, y: hipY }).y, ankleOf(legs[1], { x: 0, y: hipY }).y) - 0.012;
  hipY -= drop; // 比较低的那只脚正好踩到地面，身体重心随之起伏

  const hip = { x: 0, y: hipY };
  const neck = { x: hip.x + Math.sin(lean) * TORSO, y: hip.y + Math.cos(lean) * TORSO };
  const headLean = lean + (flash > 0 ? -0.2 * flash : 0) + Math.sin(t * 2.0) * 0.018;
  const head = { x: neck.x + Math.sin(headLean) * headR * 0.95, y: neck.y + Math.cos(headLean) * headR * 0.95 };

  const limbW = 0.040 * bulk;
  function drawLeg(a, isFront) {
    const knee = add(hip, dirA(a.thighA), THIGH);
    const ankle = add(knee, dirA(a.shinA), SHIN);
    const fill = isFront ? body : bodyBack;
    bone(ctx, hip, knee, limbW * 1.05, fill, pal.ink, inkW);
    bone(ctx, knee, ankle, limbW * 0.9, fill, pal.ink, inkW);
    // 脚掌
    ctx.save();
    ctx.translate(ankle.x + 0.030, ankle.y + 0.014);
    ctx.rotate(-a.shinA * 0.30);
    ctx.beginPath(); ctx.ellipse(0, 0, 0.050, 0.021, 0, 0, TAU);
    ctx.fillStyle = fill; ctx.fill();
    if (inkW > 0) { ctx.strokeStyle = pal.ink; ctx.lineWidth = inkW; ctx.stroke(); }
    ctx.restore();
  }
  drawLeg(legs[0], false);
  drawLeg(legs[1], true);

  /* —— 躯干 —— */
  const torsoW = 0.138 * bulk;
  const waistW = 0.090 * bulk;
  const sh = { x: hip.x + Math.sin(lean) * (TORSO - 0.03), y: hip.y + Math.cos(lean) * (TORSO - 0.03) };
  const nrm = { x: Math.cos(lean), y: -Math.sin(lean) };
  const torsoPts = [
    { x: hip.x + nrm.x * waistW * 0.5, y: hip.y + nrm.y * waistW * 0.5 },
    { x: sh.x + nrm.x * torsoW * 0.5, y: sh.y + nrm.y * torsoW * 0.5 },
    { x: neck.x + nrm.x * torsoW * 0.34, y: neck.y + nrm.y * torsoW * 0.34 },
    { x: neck.x - nrm.x * torsoW * 0.34, y: neck.y - nrm.y * torsoW * 0.34 },
    { x: sh.x - nrm.x * torsoW * 0.5, y: sh.y - nrm.y * torsoW * 0.5 },
    { x: hip.x - nrm.x * waistW * 0.5, y: hip.y - nrm.y * waistW * 0.5 },
  ];
  roundPoly(ctx, torsoPts, torsoW * 0.18);
  ctx.fillStyle = body; ctx.fill();
  // 背侧一点暗部，给平涂的身体一点体积
  if (!o.white) {
    ctx.save();
    roundPoly(ctx, torsoPts, torsoW * 0.18);
    ctx.clip();
    const g = ctx.createLinearGradient(-torsoW * 0.55, 0, torsoW * 0.35, 0);
    g.addColorStop(0, 'rgba(90,70,40,.13)');
    g.addColorStop(1, 'rgba(90,70,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-torsoW, sh.y - 0.03, torsoW * 2, TORSO + 0.1);
    ctx.restore();
  }
  if (inkW > 0) { ctx.strokeStyle = pal.ink; ctx.lineWidth = inkW; ctx.stroke(); }

  // 阵营色无袖战衣：让两方在混战里一眼分得清，也比纯白身体更像「兵」
  if (!o.white && type !== 'wizard') {
    const ins = 0.014;
    const tunic = [
      { x: hip.x + nrm.x * (waistW * 0.5 - ins * 0.4), y: hip.y + nrm.y * (waistW * 0.5 - ins * 0.4) + 0.012 },
      { x: sh.x + nrm.x * (torsoW * 0.5 - ins), y: sh.y + nrm.y * (torsoW * 0.5 - ins) },
      { x: neck.x + nrm.x * (torsoW * 0.34 - ins), y: neck.y + nrm.y * (torsoW * 0.34 - ins) + 0.014 },
      { x: neck.x - nrm.x * (torsoW * 0.34 - ins), y: neck.y - nrm.y * (torsoW * 0.34 - ins) + 0.014 },
      { x: sh.x - nrm.x * (torsoW * 0.5 - ins), y: sh.y - nrm.y * (torsoW * 0.5 - ins) },
      { x: hip.x - nrm.x * (waistW * 0.5 - ins * 0.4), y: hip.y - nrm.y * (waistW * 0.5 - ins * 0.4) + 0.012 },
    ];
    roundPoly(ctx, tunic, torsoW * 0.14);
    ctx.fillStyle = o.tunic ?? pal.team;
    ctx.fill();
    if (inkW > 0) { ctx.strokeStyle = pal.ink; ctx.lineWidth = inkW; ctx.stroke(); }
    // V 领：露出一点身体，避免整块色块
    shape(ctx, [
      { x: neck.x + nrm.x * torsoW * 0.16, y: neck.y + nrm.y * torsoW * 0.16 + 0.01 },
      { x: neck.x, y: neck.y - 0.055 },
      { x: neck.x - nrm.x * torsoW * 0.16, y: neck.y - nrm.y * torsoW * 0.16 + 0.01 },
    ], body, 0, 0);
  }

  // 腰带（阵营色，全兵种统一）
  const beltY = hip.y + 0.018;
  shape(ctx, [
    { x: hip.x + nrm.x * waistW * 0.54, y: beltY + nrm.y * waistW * 0.54 + 0.032 },
    { x: hip.x + nrm.x * waistW * 0.54, y: beltY + nrm.y * waistW * 0.54 - 0.004 },
    { x: hip.x - nrm.x * waistW * 0.54, y: beltY + nrm.y * waistW * 0.54 - 0.004 },
    { x: hip.x - nrm.x * waistW * 0.54, y: beltY + nrm.y * waistW * 0.54 + 0.032 },
  ], pal.team, pal.ink, inkW * 0.8);

  /* —— 头 —— */
  ctx.beginPath(); ctx.arc(head.x, head.y, headR, 0, TAU);
  ctx.fillStyle = body; ctx.fill();
  if (inkW > 0) { ctx.strokeStyle = pal.ink; ctx.lineWidth = inkW; ctx.stroke(); }

  if (type === 'spear') helmet(ctx, head, headR, pal, inkW);
  else if (type === 'archer') hood(ctx, head, headR, pal, inkW, t, sway);
  else if (type === 'wizard') wizardHat(ctx, head, headR, pal, inkW, t, sway);
  else if (type === 'giant') bandana(ctx, head, headR, pal, inkW, t, sway, 0.55);
  else if (type === 'miner') bandana(ctx, head, headR, pal, inkW, t, sway, 0.52);
  else bandana(ctx, head, headR, pal, inkW, t, sway, 0.48);

  // 五官（最后画，永远可见）
  if (!o.white) {
    const ex = head.x + Math.cos(headLean) * headR * 0.28;
    const ey = head.y + 0.002;
    dot(ctx, { x: ex, y: ey }, headR * 0.13, INK, INK, 0);
    dot(ctx, { x: ex + headR * 0.38, y: ey }, headR * 0.13, INK, INK, 0);
    if (atk > 0.08 || type === 'giant') {
      ctx.beginPath();
      ctx.moveTo(ex - headR * 0.06, ey + headR * 0.28); ctx.lineTo(ex + headR * 0.13, ey + headR * 0.18);
      ctx.moveTo(ex + headR * 0.35, ey + headR * 0.18); ctx.lineTo(ex + headR * 0.54, ey + headR * 0.28);
      ctx.strokeStyle = INK; ctx.lineWidth = 0.009; ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(ex + headR * 0.2, ey - headR * 0.3, headR * 0.18, Math.PI * 1.12, Math.PI * 1.88);
      ctx.strokeStyle = 'rgba(25,27,31,.45)'; ctx.lineWidth = 0.006; ctx.stroke();
    }
  }
  if (type === 'wizard') beard(ctx, head, headR, pal, inkW);
  if (type === 'wizard') robe(ctx, hip, pal, inkW, t, sway);
  if (type === 'archer') quiver(ctx, { x: hip.x - 0.085, y: hip.y + 0.24 }, pal, inkW);

  /* —— 手臂与武器 —— */
  const armW = 0.034 * bulk;
  const shF = { x: sh.x + Math.cos(lean) * torsoW * 0.46, y: sh.y + 0.006 };
  const shB = { x: sh.x - Math.cos(lean) * torsoW * 0.46, y: sh.y - 0.006 };

  const windup = atk > 0 ? smooth(seg(atk, 0, 0.34)) : 0;
  const release = atk > 0 ? smooth(seg(atk, 0.30, 0.62)) : 0;
  const recover = atk > 0 ? smooth(seg(atk, 0.62, 1)) : 0;

  // 每个兵种一套「握持点 + 武器角度」：默认在身侧，攻击时抬到身前。
  let weaponAngle = 0;
  let frontHand = { x: 0.135, y: 0.40 };
  let backHand = { x: -0.12 + Math.sin(phase) * 0.06 * walkAmt, y: 0.37 };
  let twoHanded = false;
  let bowDraw = o.bowDraw ?? 0;
  let orbCharge = o.orbCharge ?? 0;
  let rockVisible = o.rockVisible ?? false;

  const bobHand = Math.sin(phase) * 0.04 * walkAmt;

  if (type === 'sword') {
    weaponAngle = lerp(1.12, 1.98, windup) - 3.05 * release + 0.55 * recover;
    frontHand = {
      x: 0.14 + 0.015 * windup + 0.13 * release,
      y: 0.40 + 0.15 * windup - 0.04 * release,
    };
  } else if (type === 'spear') {
    twoHanded = true;
    weaponAngle = lerp(1.26, 1.52, windup) - 1.42 * release;
    frontHand = { x: 0.205 - 0.05 * windup + 0.14 * release, y: 0.44 + 0.04 * windup };
  } else if (type === 'archer') {
    twoHanded = true;
    weaponAngle = 0.03 + 0.04 * windup;
    frontHand = { x: 0.245 + 0.02 * release, y: 0.47 };
    backHand = { x: frontHand.x - 0.012 - 0.13 * (o.bowDraw ?? (windup * 0.95)), y: 0.485 };
    bowDraw = o.bowDraw ?? (windup * 0.95);
  } else if (type === 'stone') {
    twoHanded = true;
    frontHand = { x: 0.16 + 0.10 * release, y: 0.40 + 0.30 * windup - 0.05 * release };
    backHand = { x: 0.05 + 0.11 * release, y: 0.40 + 0.30 * windup - 0.05 * release };
    rockVisible = o.rockVisible ?? (atk < 0.28);
  } else if (type === 'wizard') {
    weaponAngle = 1.42 + 0.25 * windup + 0.3 * release;
    frontHand = { x: 0.16 + 0.05 * release, y: 0.43 + 0.10 * windup + 0.03 * release };
    backHand = { x: -0.10, y: 0.40 };
    orbCharge = o.orbCharge ?? (windup * 0.9);
  } else if (type === 'giant') {
    twoHanded = true;
    weaponAngle = 2.72 + 0.30 * windup - 3.05 * release + 0.40 * recover;
    frontHand = { x: 0.01 + 0.10 * release, y: 0.44 + 0.26 * windup - 0.10 * release };
    backHand = { x: -0.04 + 0.10 * release, y: 0.44 + 0.26 * windup - 0.10 * release };
  } else if (type === 'miner') {
    twoHanded = true;
    if (o.job === 'mining') {
      const s = Math.sin(t * 6.0);
      weaponAngle = 1.95 + 1.15 * s;
      frontHand = { x: 0.10 + 0.03 * s, y: 0.47 + 0.02 * s };
      backHand = { x: -0.04, y: 0.45 + 0.02 * s };
    } else {
      weaponAngle = 2.35 + 0.08 * Math.sin(phase * 2) * walkAmt;
      frontHand = { x: 0.09, y: 0.52 };
      backHand = { x: -0.03, y: 0.46 };
    }
  }

  if (twoHanded && (type === 'spear' || type === 'miner' || type === 'giant')) {
    const grip = type === 'spear' ? 0.15 : (type === 'miner' ? 0.13 : 0.17);
    const d = dirW(weaponAngle);
    backHand = { x: frontHand.x - d.x * grip, y: frontHand.y - d.y * grip };
  }

  const freeHand = {
    x: -0.135 + Math.sin(phase) * 0.09 * walkAmt,
    y: 0.37 + Math.max(0, Math.sin(phase)) * 0.05 * walkAmt,
  };

  // 后手（在身体后面）
  if (twoHanded) armIK(ctx, shB, backHand, UPPER, FORE, armW, bodyBack, pal.ink, inkW, -1);
  else armIK(ctx, shB, freeHand, UPPER, FORE, armW, bodyBack, pal.ink, inkW, -1);

  // 前臂（先画，武器压在上面，最后补手，形成「握住」的层次）
  const frontArm = armIK(ctx, shF, frontHand, UPPER, FORE, armW, body, pal.ink, inkW, 1);

  // 武器：挥砍类先补两帧「残影」，再画本体，等于自带运动模糊
  const swings = type === 'sword' || type === 'giant' || type === 'spear' || type === 'miner';
  const swingLive = swings && atk > 0.18 && atk < 0.86;
  const drawWeaponNow = () => {
    if (type === 'sword') drawSword(ctx, pal, inkW);
    else if (type === 'spear') drawSpear(ctx, pal, inkW, t);
    else if (type === 'archer') drawBow(ctx, pal, inkW, bowDraw);
    else if (type === 'wizard') drawStaff(ctx, pal, inkW, orbCharge);
    else if (type === 'miner') drawPickaxe(ctx, pal, inkW);
    else if (type === 'giant') drawClub(ctx, pal, inkW);
  };
  if (!o.white && swingLive) {
    const fade = Math.sin(seg(atk, 0.18, 0.86) * Math.PI);
    for (const [off, a] of [[0.16, 0.34], [0.31, 0.16]]) {
      ctx.save();
      ctx.translate(frontHand.x, frontHand.y);
      ctx.rotate(weaponAngle + off);
      ctx.globalAlpha = a * fade;
      drawWeaponNow();
      ctx.restore();
    }
  }
  ctx.save();
  ctx.translate(frontHand.x, frontHand.y);
  ctx.rotate(weaponAngle);
  drawWeaponNow();
  ctx.restore();

  if (type === 'stone' && rockVisible) {
    ctx.save();
    ctx.translate((frontHand.x + backHand.x) / 2 + 0.02, (frontHand.y + backHand.y) / 2 + 0.055);
    ctx.rotate(-0.15 + atk * 0.7);
    drawRock(ctx, pal, inkW, 1.0);
    ctx.restore();
  }

  // 手
  dot(ctx, frontHand, 0.027 * bulk, body, pal.ink, inkW);
  if (twoHanded) dot(ctx, backHand, 0.026 * bulk, bodyBack, pal.ink, inkW);
  else dot(ctx, freeHand, 0.026 * bulk, bodyBack, pal.ink, inkW);

  // 腕带：沿前臂的一小段布带，而不是套在手上的圈
  if (!o.white && type !== 'giant') {
    const dx = frontHand.x - frontArm.elbow.x;
    const dy = frontHand.y - frontArm.elbow.y;
    const dl = Math.hypot(dx, dy) || 1;
    const ux = dx / dl, uy = dy / dl;
    const c = { x: frontHand.x - ux * 0.05, y: frontHand.y - uy * 0.05 };
    const n = { x: -uy, y: ux };
    shape(ctx, [
      { x: c.x + n.x * armW * 0.62 + ux * 0.014, y: c.y + n.y * armW * 0.62 + uy * 0.014 },
      { x: c.x + n.x * armW * 0.62 - ux * 0.014, y: c.y + n.y * armW * 0.62 - uy * 0.014 },
      { x: c.x - n.x * armW * 0.62 - ux * 0.014, y: c.y - n.y * armW * 0.62 - uy * 0.014 },
      { x: c.x - n.x * armW * 0.62 + ux * 0.014, y: c.y - n.y * armW * 0.62 + uy * 0.014 },
    ], pal.team, pal.ink, 0);
  }

  // 矿工扛的金块
  if (o.carry > 0 && !o.white) {
    ctx.save();
    ctx.translate(-0.06, hip.y + 0.34);
    ctx.rotate(-0.25);
    ctx.beginPath(); ctx.ellipse(0, 0, 0.075, 0.09, 0, 0, TAU);
    ctx.fillStyle = '#b8895a'; ctx.fill();
    ctx.strokeStyle = pal.ink; ctx.lineWidth = inkW; ctx.stroke();
    ctx.fillStyle = '#ffd24d';
    ctx.beginPath(); ctx.arc(0.045, 0.03, 0.02, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(-0.02, 0.055, 0.014, 0, TAU); ctx.fill();
    ctx.restore();
  }

  if (o.debug) {
    for (const p of [hip, neck, head]) dot(ctx, p, 0.008, '#ff0', '#f0f', 0.004);
  }

  ctx.restore();
}
