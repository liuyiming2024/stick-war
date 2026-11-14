import { CONFIG } from './config.js';
import { drawUnitFigure } from './figure.js';

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

  // 矿石堆形象：岩石基座 + 嵌金块 + 金晶簇 + 地面阴影 + 呼吸光晕。
  // 纯矢量，所以能按屏幕高度缩放、能画任意多个矿点，不依赖额外图片。
  function drawOrePile(x, y, hgt, pulse, index) {
    const w = hgt * C.layout.goldMineWidthRatio;
    ctx.save();
    ctx.translate(x, y);

    // 地面阴影与暖金光晕
    ctx.fillStyle = P.mineShadow;
    ctx.beginPath(); ctx.ellipse(0, 2, w * 0.46, hgt * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.globalAlpha = 0.18 + 0.16 * pulse;
    const glow = ctx.createRadialGradient(0, -hgt * 0.42, hgt * 0.05, 0, -hgt * 0.42, w * 0.6);
    glow.addColorStop(0, P.mineGlow);
    glow.addColorStop(1, 'rgba(255,214,110,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.ellipse(0, -hgt * 0.42, w * 0.6, hgt * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    const poly = (pts, fill) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0] * w, pts[0][1] * hgt);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * w, pts[i][1] * hgt);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = '#3b2f18';
      ctx.lineWidth = Math.max(1, hgt * 0.018);
      ctx.stroke();
    };

    // 深灰褐岩石，两层叠出体积
    poly([[-0.42, 0], [-0.37, -0.32], [-0.19, -0.52], [0.01, -0.44],
          [0.15, -0.55], [0.36, -0.30], [0.42, 0]], '#675d4b');
    poly([[-0.27, -0.20], [-0.11, -0.64], [0.07, -0.70], [0.23, -0.38], [0.15, -0.16]], '#7b6f59');
    poly([[-0.40, -0.02], [-0.30, -0.22], [-0.14, -0.12], [-0.17, 0]], '#544b3d');

    // 嵌在岩石里的金块：暗金切面 + 亮面高光
    const gold = (cx, cy, r, rot) => {
      ctx.save();
      ctx.translate(cx * w, cy * hgt);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.moveTo(-r, -r * 0.55); ctx.lineTo(-r * 0.28, -r); ctx.lineTo(r, -r * 0.45);
      ctx.lineTo(r * 0.78, r * 0.7); ctx.lineTo(-r * 0.48, r); ctx.closePath();
      ctx.fillStyle = '#d99a08'; ctx.fill();
      ctx.strokeStyle = '#6b4c07'; ctx.lineWidth = Math.max(1, hgt * 0.014); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.28, -r); ctx.lineTo(r, -r * 0.45);
      ctx.lineTo(r * 0.25, -r * 0.08); ctx.lineTo(-r * 0.78, -r * 0.18); ctx.closePath();
      ctx.fillStyle = '#ffe07a'; ctx.fill();
      ctx.restore();
    };
    gold(-0.26, -0.30, hgt * 0.095, -0.22);
    gold(0.19, -0.44, hgt * 0.105, 0.28);
    gold(0.01, -0.15, hgt * 0.075, 0.08);
    gold(0.30, -0.11, hgt * 0.065, -0.34);

    // 顶部金晶簇，左右矿点用不同倾角避免六堆完全复制粘贴
    const tilt = index % 2 === 0 ? -0.12 : 0.12;
    ctx.save();
    ctx.translate(0.02 * w, -0.63 * hgt);
    ctx.rotate(tilt);
    ctx.beginPath();
    ctx.moveTo(-hgt * 0.07, 0); ctx.lineTo(0, -hgt * 0.30);
    ctx.lineTo(hgt * 0.07, 0); ctx.lineTo(0, hgt * 0.05); ctx.closePath();
    ctx.fillStyle = '#ffcf3f'; ctx.fill();
    ctx.strokeStyle = '#8a5f06'; ctx.lineWidth = Math.max(1, hgt * 0.012); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -hgt * 0.30); ctx.lineTo(0, hgt * 0.05);
    ctx.lineTo(hgt * 0.07, 0); ctx.closePath();
    ctx.fillStyle = '#fff0a8'; ctx.fill();
    ctx.restore();

    // 散落金粒
    ctx.fillStyle = '#ffd24d';
    for (const [px, py, pr] of [[-0.34, -0.06, 0.018], [0.36, -0.04, 0.015], [0.12, -0.02, 0.012]]) {
      ctx.beginPath(); ctx.arc(px * w, py * hgt, Math.max(1, pr * hgt), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawFort(state) {
    if (state.gameMode !== 'garrison') return;
    const right = C.layout.statueInset * C.layout.fortInsetRatio + C.economy.mineArriveEps;
    ctx.save();
    ctx.fillStyle = P.fortTint;
    ctx.fillRect(0, 0, right, state.h);
    ctx.strokeStyle = 'rgba(150,200,255,.55)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(right, 0); ctx.lineTo(right, state.h); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(220,235,255,.85)';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('驻堡', right / 2, state.h * 0.16);
    ctx.restore();
  }

  function drawMines(state) {
    const hgt = state.h * C.layout.goldMineHeightRatio;
    const y = state.h * C.layout.goldMineYRatio;
    const mines = C.layout.goldMines;
    for (let i = 0; i < mines.length; i++) {
      const x = state.w * mines[i].xRatio;
      const pulse = 0.5 + 0.5 * Math.sin(state.elapsed * 2.2 + i * 1.3);
      drawOrePile(x, y, hgt, pulse, i);
      // 有人正在挖：矿堆上方亮一串小点，让"这个矿在被用"看得见
      const workers = state.units.filter((u) =>
        u.kind === 'miner' && u.hp > 0 && u.mineIndex === i && u.job === 'mining').length;
      if (workers) {
        ctx.save();
        ctx.fillStyle = P.goldColor;
        const n = Math.min(workers, 4);
        for (let k = 0; k < n; k++) {
          ctx.beginPath();
          ctx.arc(x + (k - (n - 1) / 2) * 9, y - hgt * 1.12, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  // 逐单位的动作记忆：走路相位、步频、上一次攻击计时。
  // 全部是渲染侧状态，物理层完全不知道它的存在。
  const motion = new Map();
  const fx = [];
  let lastClock = 0;

  function spawnFx(x, y, n, opt) {
    for (let i = 0; i < n; i++) {
      const a = opt.dir !== undefined ? opt.dir + (Math.random() - 0.5) * opt.spread : Math.random() * Math.PI * 2;
      const sp = opt.speed * (0.6 + Math.random() * 0.7);
      fx.push({
        x: x + (Math.random() - 0.5) * opt.jitter,
        y: y + (Math.random() - 0.5) * opt.jitter,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - (opt.lift ?? 0),
        g: opt.gravity ?? 0,
        life: 0,
        max: opt.life * (0.75 + Math.random() * 0.5),
        r: opt.size * (0.7 + Math.random() * 0.6),
        color: opt.color,
        glow: !!opt.glow,
      });
    }
    if (fx.length > 160) fx.splice(0, fx.length - 160);
  }

  function updateFx(dt) {
    for (const p of fx) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.g ?? 0) * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
    }
    for (let i = fx.length - 1; i >= 0; i--) if (fx[i].life >= fx[i].max) fx.splice(i, 1);
  }

  function drawFx() {
    for (const p of fx) {
      const k = 1 - p.life / p.max;
      ctx.save();
      ctx.globalAlpha = (p.glow ? 0.7 : 0.5) * k;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1.25 - k * 0.25), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function tick(state) {
    let dt = state.elapsed - lastClock;
    if (dt < 0) {
      // 重开对局：对局时钟归零，渲染侧的动作记忆也跟着清空，别让上一局的相位残留
      motion.clear();
      fx.length = 0;
      dt = 0;
    }
    dt = Math.min(C.match.maxFrameDelta, dt);
    lastClock = state.elapsed;
    updateMotion(state, dt);
    updateFx(dt);
  }

  function updateMotion(state, dt) {
    for (const u of state.units) {
      const hgt = unitHeight(state, u);
      let rec = motion.get(u.id);
      if (!rec) {
        rec = { x: u.x, walk: 0, phase: 0, stepAt: 0, atkPrev: 0, hitPrev: 0 };
        motion.set(u.id, rec);
      }
      const dx = u.x - rec.x;
      rec.x = u.x;
      const moved = Math.abs(dx) > Math.max(0.5, hgt * 0.006);
      rec.walk += ((moved ? 1 : 0) - rec.walk) * Math.min(1, dt * 9);

      if (moved && dt > 0) {
        rec.phase += Math.abs(dx) / (hgt * 0.36) * Math.PI;
        const step = Math.floor(rec.phase / Math.PI);
        if (step !== rec.stepAt) {
          rec.stepAt = step;
          spawnFx(u.x - Math.sign(dx) * hgt * 0.03, u.y - 1, 2, {
            dir: Math.PI + Math.sign(dx) * 0.4, spread: 0.7, speed: hgt * 0.05,
            life: 0.42, size: hgt * 0.022, jitter: hgt * 0.02, lift: hgt * 0.04,
            color: 'rgba(223,214,188,.5)',
          });
        }
      }

      // 新的一次攻击：脚下起一圈土，武器挥动交给 figure 层
      const atkFresh = u.atkAnim > rec.atkPrev + 1e-4;
      if (atkFresh) {
        spawnFx(u.x, u.y - 1, 3, {
          dir: Math.PI / 2, spread: 2.4, speed: hgt * 0.10, life: 0.4,
          size: hgt * 0.018, jitter: hgt * 0.05, lift: hgt * 0.02,
          color: u.team === 0 ? 'rgba(120,205,120,.45)' : 'rgba(225,120,120,.45)',
        });
      }
      if (u.hitFlash > rec.hitPrev + 1e-4) {
        const cy = u.y - hgt * 0.62;
        spawnFx(u.x, cy, 3, {
          dir: Math.PI / 2, spread: 1.6, speed: hgt * 0.14, life: 0.26,
          size: hgt * 0.014, jitter: hgt * 0.06, lift: 0,
          color: 'rgba(255,255,255,.85)', glow: true,
        });
      }
      rec.atkPrev = u.atkAnim;
      rec.hitPrev = u.hitFlash;
    }
    if (motion.size > state.units.length + 30) {
      const alive = new Set(state.units.map((u) => u.id));
      for (const id of motion.keys()) if (!alive.has(id)) motion.delete(id);
    }
  }

  function drawUnit(state, u) {
    const hgt = unitHeight(state, u);
    const gy = u.y;
    const rec = motion.get(u.id) ?? { walk: 0, phase: 0 };
    const atk = u.atkAnim > 0 ? 1 - u.atkAnim / C.combat.attackAnimSec : 0;
    const flash = u.hitFlash > 0 ? u.hitFlash / C.combat.hitFlashSec : 0;
    const carry = u.carry ?? 0;

    // 脚下投影
    ctx.save();
    ctx.fillStyle = u.team === 0 ? 'rgba(63,174,75,.28)' : 'rgba(212,58,58,.26)';
    ctx.beginPath(); ctx.ellipse(u.x, gy - 1, hgt * 0.16, hgt * 0.04, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    const opts = {
      type: u.type, team: u.team, x: u.x, groundY: gy + 1, height: hgt,
      faceLeft: u.team === 1, t: u.anim,
      atk, walkAmt: rec.walk, walkPhase: rec.phase,
      job: u.kind === 'miner' ? u.job : '', carry,
      rockVisible: u.type === 'stone' && atk < 0.18,
      flash,
    };
    drawUnitFigure(ctx, opts);

    // 受击闪白：同一副骨架画成纯白剪影，不再依赖预生成贴图
    if (flash > 0) {
      ctx.save();
      ctx.globalAlpha = flash * P.flashAlpha;
      drawUnitFigure(ctx, { ...opts, white: true, t: u.anim + 0.01 });
      ctx.restore();
    }

    const bw = Math.max(26, hgt * 0.55);
    const by = gy - hgt - 8;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(u.x - bw / 2, by, bw, 4);
    ctx.fillStyle = u.team === 0 ? P.playerColor : P.enemyColor;
    ctx.fillRect(u.x - bw / 2, by, bw * Math.max(0, u.hp / u.maxHp), 4);

    if (u.kind === 'miner' && u.job === 'mining') {
      const p = 1 - Math.max(0, u.mineTimer) / C.economy.mineDurationSec;
      ctx.save();
      ctx.strokeStyle = P.goldColor; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(u.x, gy - hgt - 17, 7, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
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
    drawFort(state);
    drawStatues(state, assets);
    drawMines(state);
    tick(state);
    // 复制后再排序：渲染顺序不再改写物理数组。
    const sorted = [...state.units].sort((a, b) => a.x - b.x);
    for (const u of sorted) drawUnit(state, u);
    for (const p of state.projectiles) drawProjectile(state, p);
    drawFx();
  }

  return { resize, draw, invalidateBackground: () => { bgRect = null; } };
}
