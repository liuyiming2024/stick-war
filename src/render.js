// 全矢量渲染：不加载、不绘制任何外部位图，所有形状都由 Canvas 路径生成。
// v2.4 美术重制：暗色低饱和战场、深炭剪影主体、阵营色只作点缀（头带/胸纹/披风/盾），
// 冷调金属武器与晶面金矿，去掉高饱和平涂与粗黑描边带来的廉价感。
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
const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

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

// 粗细两层画法：外层深色描边收形，内层亮一档的芯做体积，避免「一根黑线」。
function limb(ctx, pts, outerW, innerW, innerColor) {
  const trace = (color, width) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };
  trace(P.outline, outerW);
  if (innerW > 0) trace(innerColor, innerW);
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

  // ── 背景：暮色天空 + 星点 + 柔和日晕 + 低对比远山 + 分层地面 ──────────
  function drawSky(state) {
    const w = state.w, h = state.h, t = state.elapsed;
    const g = ctx.createLinearGradient(0, 0, 0, h * C.layout.groundRatio);
    g.addColorStop(0, P.skyTop);
    g.addColorStop(0.62, P.skyBottom);
    g.addColorStop(1, rgba(P.skyGlow, 0.30));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 确定性星点，极弱，只在上半部
    ctx.save();
    for (let i = 0; i < 34; i++) {
      const x = hash(i + 501) * w;
      const y = hash(i + 540) * h * 0.42;
      const tw = 0.5 + 0.5 * Math.sin(t * A.crystalTwinkleHz * TAU * 0.35 + i);
      ctx.globalAlpha = 0.10 + tw * 0.28;
      ctx.fillStyle = '#d8e6e8';
      ctx.beginPath(); ctx.arc(x, y, 0.7 + hash(i + 580) * 0.8, 0, TAU); ctx.fill();
    }
    ctx.restore();

    // 日晕：柔和径向光，不画黑色描边圆
    const pulse = 0.5 + 0.5 * Math.sin(t * A.statuePulseHz * TAU);
    const sx = w * 0.81, sy = h * 0.15, sr = h * 0.042;
    const halo = ctx.createRadialGradient(sx, sy, sr * 0.2, sx, sy, sr * 6.5);
    halo.addColorStop(0, rgba(P.sun, 0.30 + pulse * 0.10));
    halo.addColorStop(0.35, rgba(P.skyGlow, 0.10));
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(sx, sy, sr * 6.5, 0, TAU); ctx.fill();
    ctx.save();
    ctx.globalAlpha = 0.55 + pulse * 0.18;
    disc(ctx, sx, sy, sr, P.sun);
    ctx.restore();
  }

  function drawHills(state) {
    const w = state.w, h = state.h, gy = h * C.layout.groundRatio;
    const ridge = (baseY, amp, color, seed, speed) => {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      const shift = Math.sin(state.elapsed * speed) * 6;
      for (let i = 0; i <= 20; i++) {
        const x = (i / 20) * w;
        const n = Math.sin((x + shift) * 0.006 + seed) * amp +
          Math.sin((x + shift) * 0.015 + seed * 1.7) * amp * 0.32;
        ctx.lineTo(x, baseY - n);
      }
      ctx.lineTo(w, gy); ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
    };
    ridge(gy - h * 0.20, h * 0.055, P.hillFar, 1.7, 0.06);
    // 山间薄雾
    const mist = ctx.createLinearGradient(0, gy - h * 0.26, 0, gy - h * 0.10);
    mist.addColorStop(0, 'rgba(0,0,0,0)');
    mist.addColorStop(0.6, P.hillMist);
    mist.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = mist;
    ctx.fillRect(0, gy - h * 0.26, w, h * 0.16);
    ridge(gy - h * 0.11, h * 0.035, P.hillNear, 4.3, 0.04);
  }

  // 云：每个圆单独填充且**不描边**，v2.3 里三个 arc 共用一次 stroke 画出了 Venn 图交线。
  function drawClouds(state) {
    const w = state.w, h = state.h, t = state.elapsed;
    const span = w + 220;
    for (let i = 0; i < A.cloudCount; i++) {
      const speed = A.cloudSpeedPxPerSec * (0.55 + hash(i) * 0.65);
      const raw = (i * (span / A.cloudCount) - t * speed) % span;
      const x = ((raw % span) + span) % span - 110;
      const y = h * (0.09 + hash(i + 30) * 0.22);
      const s = h * (0.026 + hash(i + 60) * 0.016);
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.25 * Math.sin(t * A.mineGlowHz * TAU + i);
      ctx.fillStyle = P.cloud;
      for (const [dx, dy, k] of [[0, 0, 1], [-1.15, 0.20, 0.68], [1.2, 0.24, 0.74], [0.45, -0.30, 0.62]]) {
        ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, k * s, 0, TAU); ctx.fill();
      }
      // 底部薄雾代替轮廓线
      ctx.globalAlpha *= 0.6;
      ctx.beginPath(); ctx.ellipse(x, y + s * 0.42, s * 1.9, s * 0.24, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  function drawGround(state) {
    const w = state.w, h = state.h, gy = h * C.layout.groundRatio;
    const g = ctx.createLinearGradient(0, gy - h * 0.015, 0, h);
    g.addColorStop(0, P.groundTop);
    g.addColorStop(0.35, P.groundBottom);
    g.addColorStop(1, '#151c18');
    ctx.fillStyle = g;
    ctx.fillRect(0, gy - h * 0.015, w, h - gy + h * 0.015);

    // 地表亮边 + 下方暗土，做出厚度
    ctx.fillStyle = P.groundEdge;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, gy - h * 0.015, w, Math.max(1.5, h * 0.004));
    ctx.globalAlpha = 1;
    ctx.fillStyle = P.soil;
    ctx.fillRect(0, gy + h * 0.006, w, Math.max(2, h * 0.009));

    // 稀疏石层，避免「满地划痕」
    for (let i = 0; i < 18; i++) {
      const x = hash(i + 91) * w;
      const y = gy + h * (0.035 + hash(i + 130) * 0.17);
      const r = 1.5 + hash(i + 7) * 2.6;
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = P.stoneMid;
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r * 0.7, hash(i + 3) * 0.6, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  function drawGrass(state) {
    const w = state.w, h = state.h, t = state.elapsed, gy = h * C.layout.groundRatio;
    // 草只在地表边缘成簇生长，每簇三叶，不再铺满整个下半屏
    ctx.save();
    ctx.strokeStyle = P.grassBlade;
    ctx.lineWidth = Math.max(1.2, h * 0.0028);
    ctx.lineCap = 'round';
    const clusters = Math.max(6, Math.round(A.grassCount / 2));
    for (let i = 0; i < clusters; i++) {
      const cx = (i + 0.5) * (w / clusters) + (hash(i + 200) - 0.5) * 22;
      const len = h * (0.012 + hash(i + 240) * 0.014);
      const sway = Math.sin(t * A.grassSwayHz * TAU + i * 0.8) * len * 0.42;
      for (const off of [-0.32, 0, 0.32]) {
        ctx.beginPath();
        ctx.moveTo(cx + off * len, gy + h * 0.004);
        ctx.quadraticCurveTo(cx + off * len + sway * 0.45, gy - len * 0.62,
          cx + off * len + sway, gy - len);
        ctx.stroke();
      }
    }
    ctx.restore();
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

  // ── 雕像：石甲 + 盔 + 举剑 + 血量裂纹 + 克制光晕 ──────────────────────
  function drawStatue(state, x, team) {
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
    const lw = Math.max(1.2, sh * 0.009);

    ctx.save();
    ctx.translate(x + shake, gy);

    // 地面投影与低强度光晕
    ctx.fillStyle = P.shadow;
    ctx.beginPath(); ctx.ellipse(0, 2, sh * 0.24, sh * 0.04, 0, 0, TAU); ctx.fill();
    const glow = ctx.createRadialGradient(0, -sh * 0.55, sh * 0.04, 0, -sh * 0.55, sh * 0.6);
    glow.addColorStop(0, rgba(accent, 0.10 + pulse * 0.07));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, -sh * 0.55, sh * 0.6, 0, TAU); ctx.fill();

    // 基座三层，带刻线
    poly(ctx, [[-sh * 0.23, 0], [-sh * 0.20, -sh * 0.09], [sh * 0.20, -sh * 0.09], [sh * 0.23, 0]],
      P.stoneDark, P.outline, lw);
    poly(ctx, [[-sh * 0.19, -sh * 0.09], [-sh * 0.17, -sh * 0.16], [sh * 0.17, -sh * 0.16], [sh * 0.19, -sh * 0.09]],
      P.stoneMid, P.outline, lw);
    ctx.strokeStyle = rgba(P.weaponEdge, 0.22); ctx.lineWidth = 1;
    for (const yy of [-sh * 0.035, -sh * 0.125]) {
      ctx.beginPath(); ctx.moveTo(-sh * 0.18, yy); ctx.lineTo(sh * 0.18, yy); ctx.stroke();
    }

    // 腿与躯干（石甲）
    limb(ctx, [[-sh * 0.055, -sh * 0.16], [-sh * 0.075, -sh * 0.30], [-sh * 0.085, -sh * 0.45]],
      sh * 0.10, sh * 0.065, P.stoneMid);
    limb(ctx, [[sh * 0.055, -sh * 0.16], [sh * 0.075, -sh * 0.30], [sh * 0.085, -sh * 0.45]],
      sh * 0.10, sh * 0.065, P.stoneMid);
    poly(ctx, [[-sh * 0.13, -sh * 0.45], [sh * 0.13, -sh * 0.45],
      [sh * 0.115, -sh * 0.76], [-sh * 0.115, -sh * 0.76]], P.stoneLight, P.outline, lw);
    // 胸甲 V 纹与阵营色竖纹
    ctx.strokeStyle = P.outline; ctx.lineWidth = lw * 1.4;
    ctx.beginPath();
    ctx.moveTo(-sh * 0.10, -sh * 0.62); ctx.lineTo(0, -sh * 0.56); ctx.lineTo(sh * 0.10, -sh * 0.62);
    ctx.stroke();
    ctx.strokeStyle = rgba(accent, 0.75); ctx.lineWidth = Math.max(1.5, sh * 0.012);
    ctx.beginPath(); ctx.moveTo(0, -sh * 0.56); ctx.lineTo(0, -sh * 0.73); ctx.stroke();
    // 肩甲
    for (const s of [-1, 1]) {
      poly(ctx, [[s * sh * 0.10, -sh * 0.75], [s * sh * 0.21, -sh * 0.72],
        [s * sh * 0.19, -sh * 0.64], [s * sh * 0.10, -sh * 0.66]], P.stoneMid, P.outline, lw);
    }

    // 头：石盔 + 盔脊 + 面罩缝 + 阵营色眼缝
    disc(ctx, 0, -sh * 0.87, sh * 0.105, P.stoneLight, P.outline, lw);
    ctx.beginPath();
    ctx.arc(0, -sh * 0.87, sh * 0.108, Math.PI, TAU);
    ctx.lineTo(sh * 0.108, -sh * 0.855); ctx.lineTo(-sh * 0.108, -sh * 0.855);
    ctx.closePath();
    ctx.fillStyle = P.stoneMid; ctx.fill(); ctx.strokeStyle = P.outline; ctx.lineWidth = lw; ctx.stroke();
    ctx.strokeStyle = rgba(P.weaponEdge, 0.45); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, -sh * 0.975); ctx.lineTo(0, -sh * 0.855); ctx.stroke();
    ctx.strokeStyle = accent; ctx.lineWidth = Math.max(1.5, sh * 0.014);
    ctx.beginPath();
    ctx.moveTo(-sh * 0.055, -sh * 0.865); ctx.lineTo(-sh * 0.014, -sh * 0.865);
    ctx.moveTo(sh * 0.014, -sh * 0.865); ctx.lineTo(sh * 0.055, -sh * 0.865);
    ctx.stroke();

    // 举起的剑（多边形剑刃 + 高光面 + 护手）
    limb(ctx, [[sh * 0.14, -sh * 0.72], [sh * 0.20, -sh * 0.62]], sh * 0.055, sh * 0.032, P.stoneMid);
    const bx = sh * 0.205, by = -sh * 0.63;
    poly(ctx, [[bx - sh * 0.035, by], [bx + sh * 0.035, by],
      [bx + sh * 0.020, by - sh * 0.34], [bx, by - sh * 0.40], [bx - sh * 0.020, by - sh * 0.34]],
      P.weapon, P.outline, lw);
    poly(ctx, [[bx, by - sh * 0.40], [bx + sh * 0.020, by - sh * 0.34], [bx, by - sh * 0.02]],
      P.weaponEdge, null);
    ctx.strokeStyle = P.goldDark; ctx.lineWidth = Math.max(2, sh * 0.016);
    ctx.beginPath(); ctx.moveTo(bx - sh * 0.055, by); ctx.lineTo(bx + sh * 0.055, by); ctx.stroke();

    // 石裙甲 + 阵营色披风（随脉动微摆）
    poly(ctx, [[-sh * 0.115, -sh * 0.45], [sh * 0.115, -sh * 0.45],
      [sh * 0.145, -sh * 0.34], [-sh * 0.145, -sh * 0.34]], P.stoneMid, P.outline, lw);
    ctx.strokeStyle = rgba(P.weaponEdge, 0.22); ctx.lineWidth = 1;
    for (const xx of [-0.07, 0, 0.07]) {
      ctx.beginPath(); ctx.moveTo(sh * xx, -sh * 0.44); ctx.lineTo(sh * xx, -sh * 0.35); ctx.stroke();
    }
    const capeSway = Math.sin(t * A.statuePulseHz * TAU + team) * sh * 0.012;
    poly(ctx, [[-sh * 0.11, -sh * 0.74], [sh * 0.11, -sh * 0.74],
      [sh * 0.175 + capeSway, -sh * 0.30], [-sh * 0.175 + capeSway, -sh * 0.30]],
      rgba(accent, 0.38), rgba(accent, 0.75), lw);
    poly(ctx, [[-sh * 0.11, -sh * 0.74], [0, -sh * 0.71],
      [0, -sh * 0.30], [-sh * 0.175 + capeSway, -sh * 0.30]], P.cape, null);

    // 裂纹：随血量逐条出现
    const cracks = [
      [[-sh * 0.09, -sh * 0.52], [-sh * 0.035, -sh * 0.60], [-sh * 0.07, -sh * 0.69]],
      [[sh * 0.06, -sh * 0.66], [sh * 0.01, -sh * 0.72], [sh * 0.05, -sh * 0.78]],
      [[-sh * 0.03, -sh * 0.84], [sh * 0.03, -sh * 0.88], [-sh * 0.01, -sh * 0.93]],
    ];
    const visible = Math.floor(damage * cracks.length + 0.001);
    for (let i = 0; i < visible; i++) {
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.3 * Math.sin(t * 3 + i);
      limb(ctx, cracks[i], Math.max(1.4, sh * 0.009), 0, P.crack);
      ctx.restore();
    }
    // 受击白闪
    if (shakeAmt > 0) {
      ctx.save(); ctx.globalAlpha = shakeAmt * 0.35;
      disc(ctx, 0, -sh * 0.87, sh * 0.105, '#fff');
      ctx.restore();
    }
    ctx.restore();

    // 血条
    const bw = sh * 0.48, barY = gy - sh - 16;
    rounded(ctx, x - bw / 2, barY, bw, 6, 3, 'rgba(8,12,14,.82)', rgba(P.weaponEdge, 0.28), 1);
    rounded(ctx, x - bw / 2 + 1, barY + 1, (bw - 2) * ratio, 4, 2, accent);
  }

  function drawStatues(state) {
    drawStatue(state, C.layout.statueInset, 0);
    drawStatue(state, state.w - C.layout.statueInset, 1);
  }

  // ── 矿堆：晶洞式岩块 + 棱柱金晶簇 + 晶面嵌金 ─────────────────────────
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
    // 岩面刻线
    ctx.strokeStyle = rgba(P.weaponEdge, 0.12); ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-w * 0.30, -hgt * 0.22); ctx.lineTo(-w * 0.12, -hgt * 0.40);
    ctx.moveTo(w * 0.22, -hgt * 0.30); ctx.lineTo(w * 0.32, -hgt * 0.12);
    ctx.stroke();

    // 嵌金：多边形晶面而不是圆点
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

    // 顶部三根棱柱晶簇，随闪烁轻微呼吸
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

    // 环绕金尘
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

  // ── 驻堡区：冷色护罩 + 流动虚线 + 拱门轮廓 ────────────────────────────
  function drawFort(state) {
    if (state.gameMode !== 'garrison') return;
    const t = state.elapsed;
    const right = C.layout.statueInset * C.layout.fortInsetRatio + C.economy.mineArriveEps;
    const pulse = 0.5 + 0.5 * Math.sin(t * A.fortPulseHz * TAU);
    ctx.save();
    ctx.fillStyle = P.fortTint;
    ctx.fillRect(0, 0, right, state.h);
    // 拱门剪影，让「堡」不只是个矩形色块
    ctx.strokeStyle = rgba(P.weaponEdge, 0.10 + pulse * 0.06);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(right - 26, state.h * C.layout.groundRatio);
    ctx.lineTo(right - 26, state.h * 0.42);
    ctx.arc(right - 26, state.h * 0.42, 22, 0, Math.PI, true);
    ctx.stroke();
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

  // ── 单位：有体积的剪影骨架，阵营色只作点缀 ────────────────────────────
  function joints(h, walk, swing, mining, idleLean) {
    const headR = h * 0.118;
    const headCy = -h + headR;
    const neckY = headCy + headR;
    const shoulderY = neckY + headR * 0.42;
    const hipY = -h * 0.43;
    const legS = walk * A.walkLegSwing * h * 0.19;
    const armS = -walk * A.walkArmSwing * h * 0.11;
    // 备战姿态：身体前倾、重心压低、握武器的手上抬；静止时也有姿态而非立正。
    const lean = h * (0.035 + idleLean * 0.02);
    return {
      headR, headCy, neckY, shoulderY, hipY, lean,
      legL: [[-h * 0.060 + legS * 0.5 + lean * 0.25, hipY + (0 - hipY) * 0.52 + h * 0.02],
        [-h * 0.085 + legS, -h * 0.015]],
      legR: [[h * 0.060 - legS * 0.5 + lean * 0.25, hipY + (0 - hipY) * 0.52 - h * 0.01],
        [h * 0.085 - legS + lean * 0.5, -h * 0.015]],
      armL: [[-h * 0.110 - armS * 0.35 - lean * 0.2, shoulderY + h * 0.13],
        [-h * 0.165 - armS - lean * 0.3, shoulderY + h * 0.24]],
      armR: [
        [h * 0.110 + armS * 0.35 + lean * 0.3, shoulderY + h * 0.10 - swing * h * 0.07],
        [h * 0.175 + armS + swing * h * 0.13 + mining * h * 0.05 + lean * 0.4,
          shoulderY + h * 0.19 - swing * h * 0.20 - mining * h * 0.09],
      ],
    };
  }

  function drawBody(ctx, j, h, color, flash, capeSway) {
    const outer = h * 0.072, inner = h * 0.046;
    // 披风：阵营色实色 + 暗部折叠，压在身体后面，走动时明显飘
    poly(ctx, [[-h * 0.100 - j.lean * 0.3, j.shoulderY], [h * 0.100 - j.lean * 0.3, j.shoulderY],
      [h * 0.165 + capeSway, j.hipY + h * 0.26], [-h * 0.165 + capeSway, j.hipY + h * 0.26]],
      rgba(color, 0.42), rgba(color, 0.85), h * 0.010);
    poly(ctx, [[-h * 0.100 - j.lean * 0.3, j.shoulderY], [0, j.shoulderY + h * 0.03],
      [0, j.hipY + h * 0.26], [-h * 0.165 + capeSway, j.hipY + h * 0.26]],
      P.cape, null);
    // 腿
    limb(ctx, [[0, j.hipY], j.legL[0], j.legL[1]], outer, inner, P.boneLight);
    limb(ctx, [[0, j.hipY], j.legR[0], j.legR[1]], outer, inner, P.boneLight);
    // 靴
    for (const foot of [j.legL[1], j.legR[1]]) {
      limb(ctx, [[foot[0], foot[1]], [foot[0] + h * 0.050, foot[1] + h * 0.012]],
        h * 0.055, h * 0.028, color);
    }
    // 躯干：收腰梯形，前倾
    const sx = j.lean * 0.5;
    poly(ctx, [[-h * 0.088 + sx, j.shoulderY], [h * 0.088 + sx, j.shoulderY],
      [h * 0.070, j.hipY + h * 0.02], [-h * 0.070, j.hipY + h * 0.02]],
      P.bone, P.outline, h * 0.012);
    poly(ctx, [[-h * 0.060 + sx * 0.7, j.shoulderY + h * 0.025],
      [h * 0.060 + sx * 0.7, j.shoulderY + h * 0.025],
      [h * 0.046, j.hipY - h * 0.005], [-h * 0.046, j.hipY - h * 0.005]], P.boneLight, null);
    ctx.strokeStyle = rgba(color, 0.9);
    ctx.lineWidth = Math.max(1.4, h * 0.014);
    ctx.beginPath();
    ctx.moveTo(-h * 0.050 + sx * 0.7, j.shoulderY + h * 0.075);
    ctx.lineTo(sx * 0.7, j.shoulderY + h * 0.125);
    ctx.lineTo(h * 0.050 + sx * 0.7, j.shoulderY + h * 0.075);
    ctx.stroke();
    // 腰带
    ctx.fillStyle = color;
    ctx.fillRect(-h * 0.072, j.hipY - h * 0.012, h * 0.144, Math.max(1.6, h * 0.018));
    // 手臂（后臂先，前臂后）
    limb(ctx, [[0, j.shoulderY], j.armL[0], j.armL[1]], outer, inner, P.boneLight);
    limb(ctx, [[0, j.shoulderY], j.armR[0], j.armR[1]], outer, inner, P.boneLight);
    for (const hand of [j.armL[1], j.armR[1]]) {
      disc(ctx, hand[0], hand[1], h * 0.028, P.boneLight, P.outline, h * 0.008);
    }
    // 护腕
    for (const a of [j.armL, j.armR]) {
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.2, h * 0.012);
      ctx.beginPath(); ctx.moveTo(a[0][0] * 0.7, a[0][1] + h * 0.03);
      ctx.lineTo(a[1][0], a[1][1] - h * 0.015); ctx.stroke();
    }
    // 头：前倾 + 深炭 + 石盔 + 护鼻 + 阵营色眼缝与盔缨
    const hx = j.lean * 0.75;
    disc(ctx, hx, j.headCy, j.headR, P.bone, P.outline, h * 0.012);
    ctx.beginPath();
    ctx.arc(hx, j.headCy, j.headR * 1.03, Math.PI * 1.04, Math.PI * 1.96);
    ctx.lineTo(hx + j.headR * 0.99, j.headCy - j.headR * 0.16);
    ctx.lineTo(hx - j.headR * 0.99, j.headCy - j.headR * 0.16);
    ctx.closePath();
    ctx.fillStyle = P.metalDark; ctx.fill();
    ctx.strokeStyle = P.outline; ctx.lineWidth = h * 0.010; ctx.stroke();
    ctx.strokeStyle = rgba(P.weaponEdge, 0.55); ctx.lineWidth = Math.max(1, h * 0.008);
    ctx.beginPath(); ctx.moveTo(hx, j.headCy - j.headR * 1.06);
    ctx.lineTo(hx, j.headCy - j.headR * 0.20); ctx.stroke();
    // 盔缨：阵营色小旗，随披风同向摆动
    poly(ctx, [[hx, j.headCy - j.headR * 1.02],
      [hx - h * 0.010 + capeSway * 0.35, j.headCy - j.headR * 1.62],
      [hx + h * 0.055 + capeSway * 0.6, j.headCy - j.headR * 1.40],
      [hx + h * 0.020, j.headCy - j.headR * 1.00]], color, P.outline, h * 0.008);
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5, h * 0.018);
    ctx.beginPath();
    ctx.moveTo(hx - j.headR * 0.60, j.headCy + j.headR * 0.10);
    ctx.lineTo(hx - j.headR * 0.10, j.headCy + j.headR * 0.10);
    ctx.moveTo(hx + j.headR * 0.10, j.headCy + j.headR * 0.10);
    ctx.lineTo(hx + j.headR * 0.60, j.headCy + j.headR * 0.10);
    ctx.stroke();
    // 受击：同一骨架白色重描，不用滤镜
    if (flash > 0) {
      ctx.save();
      ctx.globalAlpha = flash * P.flashAlpha;
      limb(ctx, [[0, j.hipY], j.legL[0], j.legL[1]], h * 0.070, 0, '#fff');
      limb(ctx, [[0, j.hipY], j.legR[0], j.legR[1]], h * 0.070, 0, '#fff');
      limb(ctx, [[0, j.shoulderY], j.armL[0], j.armL[1]], h * 0.070, 0, '#fff');
      limb(ctx, [[0, j.shoulderY], j.armR[0], j.armR[1]], h * 0.070, 0, '#fff');
      poly(ctx, [[-h * 0.088 + j.lean * 0.5, j.shoulderY], [h * 0.088 + j.lean * 0.5, j.shoulderY],
        [h * 0.070, j.hipY + h * 0.02], [-h * 0.070, j.hipY + h * 0.02]], '#fff');
      disc(ctx, j.lean * 0.75, j.headCy, j.headR, '#fff');
      ctx.restore();
    }
  }

  function drawWeapon(ctx, key, h, j, swing, t, team) {
    const hand = j.armR[1];
    const accent = team === 0 ? P.playerColor : P.enemyColor;
    const lw = Math.max(1, h * 0.012);
    // 各兵种有各自的握持倾角：剑/矛/镐斜举，弓与法杖近乎竖直。
    const grip = { sword: -0.30, spear: -0.26, archer: -0.08, stone: -0.24,
      giant: -0.30, wizard: -0.05, miner: -0.34 }[key] ?? 0;
    ctx.save();
    ctx.translate(hand[0], hand[1]);
    ctx.rotate(grip - swing);
    switch (key) {
      case 'sword': {
        const L = h * 0.42;
        poly(ctx, [[0, -h * 0.038], [L * 0.80, -h * 0.042], [L, 0],
          [L * 0.80, h * 0.042], [0, h * 0.038]], P.weapon, P.outline, lw);
        poly(ctx, [[0, -h * 0.038], [L * 0.80, -h * 0.042], [L, 0], [0, 0]], P.weaponEdge, null);
        ctx.strokeStyle = P.metalDark; ctx.lineWidth = Math.max(1, h * 0.008);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L * 0.86, 0); ctx.stroke();
        ctx.strokeStyle = P.goldDark; ctx.lineWidth = h * 0.030;
        ctx.beginPath(); ctx.moveTo(0, -h * 0.062); ctx.lineTo(0, h * 0.062); ctx.stroke();
        limb(ctx, [[-h * 0.055, 0], [-h * 0.015, 0]], h * 0.055, h * 0.03, P.wood);
        break;
      }
      case 'spear': {
        const L = h * 0.60;
        limb(ctx, [[-L * 0.22, h * 0.10], [L * 0.74, -h * 0.34]], h * 0.032, h * 0.018, P.wood);
        poly(ctx, [[L * 0.74, -h * 0.34], [L * 0.60, -h * 0.30],
          [L * 0.66, -h * 0.20], [L * 0.86, -h * 0.26]], P.weapon, P.outline, lw);
        poly(ctx, [[L * 0.74, -h * 0.34], [L * 0.86, -h * 0.26], [L * 0.66, -h * 0.20]],
          P.weaponEdge, null);
        break;
      }
      case 'archer': {
        const r = h * 0.26;
        ctx.strokeStyle = P.wood; ctx.lineWidth = h * 0.032; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(h * 0.10, 0, r, -Math.PI * 0.55, Math.PI * 0.55); ctx.stroke();
        const pull = swing > 0 ? h * 0.075 : 0;
        ctx.strokeStyle = rgba(P.weaponEdge, 0.8); ctx.lineWidth = Math.max(1, h * 0.010);
        ctx.beginPath();
        ctx.moveTo(h * 0.10 + r * Math.cos(-Math.PI * 0.55), r * Math.sin(-Math.PI * 0.55));
        ctx.lineTo(h * 0.10 - pull, 0);
        ctx.lineTo(h * 0.10 + r * Math.cos(Math.PI * 0.55), r * Math.sin(Math.PI * 0.55));
        ctx.stroke();
        limb(ctx, [[h * 0.10 - pull, 0], [h * 0.38 - pull, 0]], h * 0.016, 0, P.weapon);
        break;
      }
      case 'stone': {
        // 投石索：弧线 + 待投的石弹
        ctx.strokeStyle = P.wood; ctx.lineWidth = h * 0.022;
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.quadraticCurveTo(h * 0.20, -h * 0.30, h * 0.36, -h * 0.13);
        ctx.stroke();
        poly(ctx, [[h * 0.36, -h * 0.20], [h * 0.43, -h * 0.15], [h * 0.40, -h * 0.06],
          [h * 0.31, -h * 0.08]], P.rockLight, P.outline, lw);
        break;
      }
      case 'giant': {
        // 重锤：粗柄 + 方锤头，尺寸与体型匹配
        limb(ctx, [[-h * 0.06, h * 0.06], [h * 0.30, -h * 0.22]], h * 0.062, h * 0.036, P.wood);
        poly(ctx, [[h * 0.24, -h * 0.34], [h * 0.48, -h * 0.30],
          [h * 0.50, -h * 0.10], [h * 0.26, -h * 0.14]], P.metalDark, P.outline, lw);
        poly(ctx, [[h * 0.24, -h * 0.34], [h * 0.48, -h * 0.30], [h * 0.38, -h * 0.22],
          [h * 0.26, -h * 0.24]], P.weapon, null);
        break;
      }
      case 'wizard': {
        const L = h * 0.50;
        limb(ctx, [[0, h * 0.08], [h * 0.06, -L]], h * 0.030, h * 0.018, P.wood);
        const pulse = 0.5 + 0.5 * Math.sin(t * A.crystalTwinkleHz * TAU);
        const r = h * (0.070 + pulse * 0.022);
        const orbX = h * 0.06, orbY = -L - h * 0.02;
        const g = ctx.createRadialGradient(orbX, orbY, r * 0.2, orbX, orbY, r * 2.6);
        g.addColorStop(0, rgba(accent, 0.55));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(orbX, orbY, r * 2.6, 0, TAU); ctx.fill();
        disc(ctx, orbX, orbY, r, accent, P.outline, lw);
        disc(ctx, orbX - r * 0.28, orbY - r * 0.3, r * 0.26, '#fff');
        break;
      }
      case 'miner': {
        // 镐：木柄 + 双尖镐头
        limb(ctx, [[-h * 0.04, h * 0.05], [h * 0.24, -h * 0.30]], h * 0.032, h * 0.020, P.wood);
        poly(ctx, [[h * 0.10, -h * 0.34], [h * 0.34, -h * 0.40],
          [h * 0.42, -h * 0.28], [h * 0.24, -h * 0.22]], P.weapon, P.outline, lw);
        poly(ctx, [[h * 0.10, -h * 0.34], [h * 0.34, -h * 0.40], [h * 0.26, -h * 0.30]],
          P.weaponEdge, null);
        break;
      }
    }
    ctx.restore();
  }

  function drawUnit(state, u, offsets) {
    const h = unitHeight(state, u);
    const t = state.elapsed;
    const gy = u.y;
    // 同队同位置（尤其多个矿工聚在一个矿点）在渲染层横向错开，不改物理坐标。
    const cx = u.x + (offsets?.get(u.id) ?? 0);
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
    const idleLean = Math.sin(u.anim * A.breathHz * TAU + u.id);
    const j = joints(h, walk, swing, mining, idleLean);
    const capeSway = Math.sin(u.walkPhase + 1.2) * h * 0.028 * (u.moving ? 1 : 0) +
      Math.sin(t * A.breathHz * TAU + u.id) * h * 0.012;

    // 投影（随起伏轻微缩放）
    ctx.save();
    ctx.fillStyle = P.shadow;
    ctx.beginPath();
    ctx.ellipse(cx, gy - 1, h * (0.20 - bob / h * 0.4), h * 0.042, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(cx, gy - bob);
    ctx.scale(u.team === 1 ? -1 : 1, 1);

    // 背矿袋：深皮革 + 金块，随晃动
    if (u.kind === 'miner' && u.carry > 0) {
      const bx = -h * 0.16, by = j.hipY - h * 0.05 + carryBob * 0.4;
      poly(ctx, [[bx - h * 0.085, by], [bx + h * 0.085, by],
        [bx + h * 0.075, by + h * 0.15], [bx - h * 0.075, by + h * 0.15]],
        P.wood, P.outline, h * 0.010);
      poly(ctx, [[bx - h * 0.045, by + h * 0.02], [bx + h * 0.045, by + h * 0.02],
        [bx + h * 0.030, by + h * 0.085], [bx - h * 0.030, by + h * 0.085]],
        P.goldColor, null);
    }

    drawBody(ctx, j, h, color, u.hitFlash > 0 ? clamp01(u.hitFlash / C.combat.hitFlashSec) : 0, capeSway);
    drawWeapon(ctx, u.type, h, j, swing + mining * 0.5, t, u.team);

    if (u.inFort) {
      ctx.strokeStyle = rgba(P.trailPlayer, 0.35 + 0.3 * Math.sin(t * A.fortPulseHz * TAU));
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(0, -h * 0.5, h * 0.38, 0, TAU); ctx.stroke();
    }
    ctx.restore();

    // 血条：细、圆角、带高光
    const bw = Math.max(28, h * 0.58), by = gy - h - 13;
    rounded(ctx, cx - bw / 2, by, bw, 5, 2.5, 'rgba(8,12,14,.85)', rgba(P.weaponEdge, 0.25), 1);
    rounded(ctx, cx - bw / 2 + 1, by + 1, (bw - 2) * clamp01(u.hp / u.maxHp), 3, 1.5, color);

    if (u.kind === 'miner' && u.job === 'mining') {
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
  }

  // ── 投射物：带羽箭 / 自旋石 / 脉动法球 + 拖尾 ─────────────────────────
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
      limb(ctx, [[-13, 0], [8, 0]], 4.2, 2.2, P.wood);
      poly(ctx, [[8, 0], [1, -3.6], [1, 3.6]], P.weaponEdge, P.outline, 1);
      for (const s of [-1, 1]) {
        poly(ctx, [[-13, 0], [-17, s * 4], [-9, s * 2]], trail, null);
      }
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

  // ── 金币交付迸发 ─────────────────────────────────────────────────────
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
      const cx = x + Math.cos(a) * r, cy = y - k * 30 + Math.sin(a) * r * 0.4;
      const s = 2.8 * (1 - k * 0.5);
      ctx.globalAlpha = (1 - k) * 0.95;
      poly(ctx, [[cx, cy - s], [cx + s * 0.7, cy], [cx, cy + s], [cx - s * 0.7, cy]], P.goldLight);
    }
    ctx.restore();
  }

  // 同队且逻辑坐标几乎重合的单位（典型：一个矿点上的多个矿工）按 id 稳定排开，
  // 只影响绘制位置，不动 state.units[].x，因此物理、判定、dt 一致性完全不受影响。
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

  function draw(state) {
    ctx.clearRect(0, 0, state.w, state.h);
    drawBackground(state);
    drawFort(state);
    drawStatues(state);
    drawMines(state);
    drawGoldBurst(state);
    const sorted = [...state.units].sort((a, b) => a.x - b.x);
    const offsets = visualOffsets(state, sorted);
    for (const u of sorted) drawUnit(state, u, offsets);
    for (const p of state.projectiles) drawProjectile(state, p);
  }

  return { resize, draw };
}
