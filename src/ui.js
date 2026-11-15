import { CONFIG, UNIT_ORDER, upgradeStats } from './config.js?v=2.11.0';
import { unitIconHTML, toolSVG, gemSVG } from './icons.js?v=2.11.0';
import { upgradeLevels, countTeam, pendingTeam, isTerminal } from './state.js?v=2.11.0';
import { spawnPlayer, doUpgrade, setMode, cancelTraining, aiGrowthInfo, canAfford, championInfo, effectsInfo } from './simulation.js?v=2.11.0';
import { formatClock } from './progress.js?v=2.11.0';

const C = CONFIG;
const $ = (id) => document.getElementById(id);

export function createUI(state, actions) {
  const el = {
    mainMenu: $('mainMenu'), gameUI: $('gameUI'), loadTip: $('loadTip'),
    startBtn: $('startBtn'), helpBtn: $('helpBtn'), menuSub: $('menuSub'),
    gold: $('gold'), gems: $('gems'), gemBadge: $('gemBadge'),
    gemBtn: $('gemBtn'), gemBtnLabel: $('gemBtnLabel'),
    pop: $('pop'), popMax: $('popMax'),
    homeHp: $('homeHp'), enemyHp: $('enemyHp'), clock: $('clock'), aiDev: $('aiDev'),
    unitBar: $('unitBar'), shopGrid: $('shopGrid'), upgradeGrid: $('upgradeGrid'),
    shopPanel: $('shopPanel'), upgradePanel: $('upgradePanel'),
    backdrop: $('panelBackdrop'),
    closeShopX: $('closeShopX'), closeUpgradeX: $('closeUpgradeX'),
    attackBtn: $('attackBtn'), defendBtn: $('defendBtn'), garrisonBtn: $('garrisonBtn'),
    pauseBtn: $('pauseBtn'), difficulty: $('difficulty'), queueStrip: $('queueStrip'),
    camLeft: $('camLeft'), camRight: $('camRight'), camFollow: $('camFollow'),
    assetBadge: $('assetBadge'), ammoBadge: $('ammoBadge'), audioBtn: $('audioBtn'),
    ammoBtn: $('ammoBtn'), statsBtn: $('statsBtn'),
    ammoPanel: $('ammoPanel'), ammoGrid: $('ammoGrid'),
    statsPanel: $('statsPanel'), statsBody: $('statsBody'),
    closeAmmoX: $('closeAmmoX'), closeStatsX: $('closeStatsX'),
    championBar: $('championBar'), championName: $('championName'),
    champExit: $('champExit'), champHoldLeft: $('champHoldLeft'), champHoldRight: $('champHoldRight'),
    overlay: $('pauseOverlay'), toastEl: $('toast'),
  };
  const unitButtons = new Map();
  const upgradeButtons = [];
  const cache = {};
  let toastTimer = null;
  let overlayHandler = null;

  function setText(node, key, value) {
    if (cache[key] === value) return;
    cache[key] = value;
    node.textContent = value;
  }

  function toast(msg) {
    el.toastEl.textContent = msg;
    el.toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toastEl.classList.remove('show'), 1500);
  }

  function spawn(type) {
    const r = spawnPlayer(state, type);
    if (!r.ok) toast(r.reason);
    else {
      const viaGem = r.paid?.gems > 0 ? `（宝石抵 ${r.paid.gems}）` : '';
      toast(`${C.units[type].name} 训练中 ${r.trainSec}s${viaGem}（点队列可取消退款）`);
    }
    sync();
  }

  function upgrade(type, stat) {
    const r = doUpgrade(state, type, stat);
    if (!r.ok) { toast(r.reason); return; }
    refreshUpgrade();
    sync();
    toast(`${C.units[type].name} ${statName(stat)} → ${upgradeLevels(state, type)[stat]} 级`);
  }

  function statName(s) {
    return { atk: '攻击', def: '防御', spd: '攻速', bag: '背包', pick: '镐' }[s] ?? s;
  }

  function mode(m) {
    if (setMode(state, m)) sync();
  }

  // v2.11：四个面板共用同一个互斥入口，Esc / 遮罩 / × 都收到这里。
  const panelNodes = {
    shop: () => el.shopPanel,
    upgrade: () => el.upgradePanel,
    ammo: () => el.ammoPanel,
    stats: () => el.statsPanel,
  };
  const anyPanelOpen = () => Object.values(panelNodes).some((get) => !get().hidden);

  function closePanels() {
    for (const get of Object.values(panelNodes)) get().hidden = true;
    el.backdrop.hidden = true;
    // 战绩面板打开时暂时收起主菜单（它 z-index 更高）、恢复 gameUI，关闭后还回去。
    if (state.phase === 'menu') {
      document.body.classList.remove('menu-stats');
      el.gameUI.hidden = true;
      el.mainMenu.hidden = false;
    }
  }

  // 战绩面板在主菜单也要能看；其余三个只对局中打开。
  function openPanel(which) {
    if (which !== 'stats' && state.phase !== 'playing') {
      toast('先回到对局再打开面板');
      return;
    }
    for (const [key, get] of Object.entries(panelNodes)) get().hidden = key !== which;
    el.backdrop.hidden = false;
    if (which === 'stats' && state.phase === 'menu') {
      // 面板挂在 gameUI 内，主菜单阶段 gameUI 是 hidden 的；临时放行，
      // 并用 menu-stats class 把顶栏/底栏/画布藏掉，只留面板与遮罩。
      el.gameUI.hidden = false;
      document.body.classList.add('menu-stats');
      el.mainMenu.hidden = true;
    }
    if (which === 'upgrade') refreshUpgrade();
    if (which === 'ammo') refreshAmmo();
    if (which === 'stats') refreshStats();
  }

  function refreshAmmo() {
    const info = effectsInfo(state);
    el.ammoGrid.innerHTML = '';
    for (const [key, cfg] of Object.entries(C.ammo.kinds)) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'shopItem ammoItem';
      card.setAttribute('aria-pressed', String(info.ammo === key));
      const eff = cfg.effect
        ? { burn: '灼烧持续伤害', poison: '持续伤害 + 减速', bleed: '持续流血' }[cfg.effect]
        : '无附加效果';
      card.innerHTML = `<div class="name">${cfg.label}</div>` +
        `<div class="price">${C.ammo.cost} 金币 / 宝石</div>` +
        `<span class="effect">${eff} · 伤害 ×${cfg.dmgMul}</span>`;
      card.addEventListener('click', () => actions.setAmmo(key));
      el.ammoGrid.appendChild(card);
    }
  }

  function refreshStats() {
    const p = actions.getProgress();
    const cells = [
      ['对局数', p.matches],
      ['胜 / 负', `${p.wins} / ${p.losses}`],
      ['最快胜利', formatClock(p.bestWinSec)],
      ['累计消耗宝石', p.totalGems],
      ['上次难度', C.match.difficulties[p.lastDifficulty]?.label ?? p.lastDifficulty],
      ['音效', p.muted ? '关' : '开'],
    ];
    el.statsBody.innerHTML = cells.map(([k, v]) =>
      `<div class="statCell">${k}<b>${v}</b></div>`).join('');
  }

  let queueSignature = '';
  function syncQueue() {
    const items = state.training.filter((t) => t.team === 0);
    const signature = items.map((t) =>
      `${t.id}:${t.type}:${Math.ceil(Math.max(0, t.due - state.elapsed) * 10)}`).join('|');
    if (signature === queueSignature) return;
    queueSignature = signature;
    el.queueStrip.innerHTML = '';
    for (const t of items) {
      const cfg = C.units[t.type];
      const remaining = Math.max(0, t.due - state.elapsed);
      const pct = Math.max(0, Math.min(100, (1 - remaining / cfg.trainSec) * 100));
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'queueItem';
      btn.title = `取消训练并退还 ${cfg.cost} 金币`;
      btn.innerHTML = `<span>${cfg.name}</span><span class="queueBar"><i style="width:${pct}%"></i></span>` +
        `<span>${remaining.toFixed(1)}s</span><span class="cancel">×</span>`;
      btn.addEventListener('click', () => {
        const r = cancelTraining(state, t.id);
        if (r.ok) toast(`已取消 ${C.units[r.type].name} 训练，退还 ${r.refund} 金币`);
        sync();
      });
      el.queueStrip.appendChild(btn);
    }
  }

  function buildUnitBar() {
    el.unitBar.innerHTML = '';
    UNIT_ORDER.forEach((key, i) => {
      const cfg = C.units[key];
      const btn = document.createElement('button');
      btn.className = 'unitIcon';
      btn.type = 'button';
      btn.title = `${cfg.name} · ${cfg.cost} 金币 · 快捷键 ${i + 1}`;
      btn.innerHTML = `${unitIconHTML(key)}<span>${cfg.name}</span><span class="cost">${cfg.cost}</span>`;
      btn.addEventListener('click', () => spawn(key));
      el.unitBar.appendChild(btn);
      unitButtons.set(key, btn);
    });
  }

  function buildShop() {
    el.shopGrid.innerHTML = '';
    UNIT_ORDER.forEach((key) => {
      const cfg = C.units[key];
      const card = document.createElement('div');
      card.className = 'shopItem';
      card.innerHTML = `${unitIconHTML(key)}<div class="name">${cfg.name}</div>` +
        `<div class="price">${cfg.cost} 金币</div><div class="desc">${cfg.desc}</div>`;
      card.addEventListener('click', () => spawn(key));
      el.shopGrid.appendChild(card);
    });
  }

  function refreshUpgrade() {
    el.upgradeGrid.innerHTML = '';
    upgradeButtons.length = 0;
    UNIT_ORDER.forEach((key) => {
      const cfg = C.units[key];
      const lv = upgradeLevels(state, key);
      const card = document.createElement('div');
      card.className = 'upgradeItem';
      const levels = upgradeStats(key).map((s) => `${statName(s)} ${lv[s] ?? 0}`).join(' · ');
      card.innerHTML = `${unitIconHTML(key)}<div class="name">${cfg.name}</div>` +
        `<div class="desc">${levels}</div>`;
      const row = document.createElement('div');
      row.className = 'upgradeRow';
      for (const stat of upgradeStats(key)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = { atk: 'btnAtk', def: 'btnDef', spd: 'btnSpd', bag: 'btnAtk', pick: 'btnDef' }[stat];
        b.textContent = `${statName(stat)}+${C.upgrade.cost}`;
        b.addEventListener('click', () => upgrade(key, stat));
        row.appendChild(b);
        upgradeButtons.push({ key, stat, node: b });
      }
      card.appendChild(row);
      el.upgradeGrid.appendChild(card);
    });
  }

  function sync() {
    // CSS 动画与 Canvas 相位同步：非 playing 时全部暂停，画面完全静止。
    document.body.dataset.phase = state.phase;
    const pop = countTeam(state, 0);
    setText(el.gold, 'gold', String(Math.round(state.gold)));
    setText(el.gems, 'gems', String(Math.round(state.gems)));
    setText(el.pop, 'pop', String(pop + pendingTeam(state, 0)));
    setText(el.homeHp, 'homeHp', String(Math.max(0, Math.round(state.homeHp))));
    setText(el.enemyHp, 'enemyHp', String(Math.max(0, Math.round(state.enemyHp))));
    const dev = aiGrowthInfo(state);
    setText(el.aiDev, 'aiDev',
      `敌方发育 矿工 ${dev.miners}/${dev.target} · 科技 ${dev.upgrades} · 金 ${Math.round(dev.gold)}`);
    const total = Math.floor(state.elapsed);
    setText(el.clock, 'clock', `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`);

    const playable = state.phase === 'playing';
    const full = pop + pendingTeam(state, 0) >= state.limits.popMax;
    for (const [key, btn] of unitButtons) {
      const disabled = !playable || full || !canAfford(state, C.units[key].cost);
      if (btn.disabled !== disabled) btn.disabled = disabled;  // 真禁用，不只是置灰
    }
    for (const [btn, mode] of [[el.attackBtn, 'attack'], [el.defendBtn, 'defend'], [el.garrisonBtn, 'garrison']]) {
      btn.setAttribute('aria-pressed', String(state.gameMode === mode));
    }
    syncQueue();
    el.pauseBtn.setAttribute('aria-pressed', String(state.phase === 'paused'));
    el.pauseBtn.textContent = state.phase === 'paused' ? '继续' : '暂停';
    el.camFollow.setAttribute('aria-pressed', String(!!state.view.follow));
    const fx = effectsInfo(state);
    setText(el.ammoBadge, 'ammoBadge', fx.ammoLabel);
    // v2.11：每局领取上限。真 .disabled（不只是置灰），并显式显示剩余次数。
    const used = state.stats.gemsGranted;
    const limit = C.gems.grantLimit;
    const exhausted = used >= limit;
    const gemBtnDisabled = !playable || exhausted;
    if (el.gemBtn.disabled !== gemBtnDisabled) el.gemBtn.disabled = gemBtnDisabled;
    setText(el.gemBtnLabel, 'gemBtnLabel',
      exhausted ? '已领完 2/2' : `领宝石 ${used}/${limit}`);
    const muted = actions.isMuted();
    el.audioBtn.setAttribute('aria-pressed', String(!muted));
    setText(el.audioBtn, 'audioBtn', muted ? '音效 关' : '音效 开');
    const champ = championInfo(state);
    const showChamp = champ.active && state.phase === 'playing';
    if (el.championBar.hidden === showChamp) el.championBar.hidden = !showChamp;
    if (showChamp) setText(el.championName, 'championName', champ.name);
    for (const { key, stat, node } of upgradeButtons) {
      const disabled = !playable || !canAfford(state, C.upgrade.cost) ||
        upgradeLevels(state, key)[stat] >= C.upgrade.maxLevel;
      if (node.disabled !== disabled) node.disabled = disabled;
    }
  }

  function showMenu() {
    el.mainMenu.hidden = false;
    el.gameUI.hidden = true;
    el.overlay.hidden = true;
    closePanels();
    sync();
  }

  function showGame() {
    el.mainMenu.hidden = true;
    el.gameUI.hidden = false;
    el.overlay.hidden = true;
    closePanels();
    queueSignature = '__reset__';
    el.queueStrip.innerHTML = '';
    refreshUpgrade();
    sync();
  }

  function showOverlay(title, sub, handler, details = []) {
    el.overlay.hidden = false;
    el.overlay.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'pauseCard';
    const close = document.createElement('button');
    close.className = 'overlayClose';
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', `关闭${title}浮层`);
    close.title = '关闭（Esc）';
    close.addEventListener('click', (e) => { e.stopPropagation(); handler?.(); });
    card.appendChild(close);
    const t = document.createElement('span');
    t.textContent = title;
    card.appendChild(t);
    if (details.length) {
      const box = document.createElement('div');
      box.className = 'resultStats';
      for (const line of details) {
        const row = document.createElement('div');
        row.textContent = line;
        box.appendChild(row);
      }
      card.appendChild(box);
    }
    const s = document.createElement('small');
    s.textContent = sub;
    card.appendChild(s);
    el.overlay.appendChild(card);
    overlayHandler = handler;
  }

  function showPause(on) {
    if (on) {
      closePanels();  // 暂停浮层盖住面板时，不能把玩家留在关不掉的面板里
      showOverlay('已暂停', '按 P、点 × 或点击空白处继续', () => actions.togglePause());
    } else { el.overlay.hidden = true; overlayHandler = null; }
    sync();
  }

  function showEnd(result) {
    const won = result === 'won';
    toast(won ? '敌方雕像被摧毁，胜利！' : '我方雕像被摧毁，失败');
    const dev = aiGrowthInfo(state);
    const fx = effectsInfo(state);
    const p = actions.getProgress();
    const total = Math.floor(state.elapsed);
    const clock = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    showOverlay(
      won ? '胜利' : '失败',
      '点 × 或按 Esc 返回主菜单，再来一局',
      () => actions.goMenu(),
      [
        `用时 ${clock} · 难度 ${C.match.difficulties[state.difficulty].label}`,
        `我方出兵 ${state.stats.playerSpawned} · 运矿 ${state.stats.trips} 趟`,
        `敌方出兵 ${state.stats.aiSpawned} · 矿工 ${dev.minersTrained} 名 / ${dev.trips} 趟 · 科技 ${dev.upgrades} 级`,
        `敌方累计采矿 ${Math.round(dev.earned)} 金 · 取消训练 ${state.stats.cancelled}`,
        `城堡弓箭 ${state.stats.fortArrows} 发`,
        `领取宝石 ${state.stats.gemsGranted}/${C.gems.grantLimit} 次 · 抵扣 ${state.stats.gemsSpent} 颗`,
        `单兵指挥 ${Math.floor(state.control.seconds)} 秒 · 手动移动 ${Math.round(state.control.distance)} px`,
        `箭矢 ${fx.ammoLabel} · 投矛 ${fx.stats.spearThrows} 次 · 召唤 ${fx.stats.summons} 个`,
        `状态效果 眩晕 ${fx.stats.stuns} 次 · 持续伤害 ${Math.round(fx.stats.dotDamage)}`,
        `历史最佳 ${formatClock(p.bestWinSec)} · 总战绩 ${p.wins} 胜 ${p.losses} 负`,
      ],
    );
  }

  // v2.10：用集合记录按住的方向键，避免左右同时按住时松开一个就误归零。
  const axisKeys = new Set();
  function applyAxis() {
    const left = axisKeys.has('ArrowLeft');
    const right = axisKeys.has('ArrowRight');
    actions.setControlAxis(left === right ? 0 : (left ? -1 : 1));
  }
  function handleKeyUp(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (!axisKeys.delete(e.key)) return;
    applyAxis();
    e.preventDefault();
  }

  function handleKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (state.phase === 'menu') {
      // 主菜单里也能用 Esc 关掉战绩面板，否则「进得去出不来」。
      if (k === 'Escape' && anyPanelOpen()) {
        e.preventDefault(); closePanels(); return;
      }
      if (k === 'Enter') { actions.start(el.difficulty.value); e.preventDefault(); }
      return;
    }
    if (k === 'Escape') {
      e.preventDefault();
      if (anyPanelOpen()) { closePanels(); return; }
      if (championInfo(state).active) {
        axisKeys.clear();
        actions.releaseChampion();
        return;
      }
      if (state.phase === 'paused') { actions.togglePause(); return; }
      if (isTerminal(state)) { actions.goMenu(); return; }
      closePanels();
      return;
    }
    if (k === 'p' || k === 'P') { actions.togglePause(); e.preventDefault(); return; }
    if (state.phase !== 'playing') return;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      if (championInfo(state).active) {
        axisKeys.add(k);
        applyAxis();
        e.preventDefault();
      }
      return;
    }
    if (/^[1-9]$/.test(k)) {
      const type = UNIT_ORDER[Number(k) - 1];
      if (type) { spawn(type); e.preventDefault(); }
      return;
    }
    if (k === 'a' || k === 'A') { mode('attack'); e.preventDefault(); }
    else if (k === 'd' || k === 'D') { mode('defend'); e.preventDefault(); }
    else if (k === 'g' || k === 'G') { mode('garrison'); e.preventDefault(); }
  }

  function bind() {
    $('shopBtn').innerHTML = `${toolSVG('shop')}<span>商店</span>`;
    $('upgradeBtn').innerHTML = `${toolSVG('upgrade')}<span>升级</span>`;
    // 只前插 SVG，不重建 span：否则 el.gemBtnLabel 会指向被替换掉的旧节点。
    el.gemBtn.insertAdjacentHTML('afterbegin', gemSVG());
    el.gemBtn.addEventListener('click', () => actions.grantGems());
    for (const [key, d] of Object.entries(C.match.difficulties)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = d.label;
      el.difficulty.appendChild(opt);
    }
    el.difficulty.value = state.difficulty;
    el.startBtn.addEventListener('click', () => actions.start(el.difficulty.value));
    el.helpBtn.addEventListener('click', () => toast('底栏「领宝石」每局 2 次，金币不足自动 1:1 抵扣；矿工就近挖自家矿；A/D/G 攻守驻；点队列可取消退款'));
    $('menuBtn').addEventListener('click', () => actions.goMenu());
    el.pauseBtn.addEventListener('click', () => actions.togglePause());
    el.attackBtn.addEventListener('click', () => mode('attack'));
    el.defendBtn.addEventListener('click', () => mode('defend'));
    el.garrisonBtn.addEventListener('click', () => mode('garrison'));
    el.camLeft.addEventListener('click', () => actions.pan(-1));
    el.camRight.addEventListener('click', () => actions.pan(1));
    el.camFollow.addEventListener('click', () => actions.toggleFollow());
    // 每个能进的层都要有明确退路：指挥条自带 ×，Esc 也能退。
    el.champExit.addEventListener('click', () => {
      axisKeys.clear();
      actions.releaseChampion();
    });
    const hold = (node, dir) => {
      node.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { node.setPointerCapture(e.pointerId); } catch { /* 非指针设备忽略 */ }
        actions.setControlAxis(dir);
      });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        node.addEventListener(ev, () => applyAxis());
      }
    };
    hold(el.champHoldLeft, -1);
    hold(el.champHoldRight, 1);
    $('shopBtn').addEventListener('click', () => openPanel('shop'));
    $('upgradeBtn').addEventListener('click', () => openPanel('upgrade'));
    el.ammoBtn.addEventListener('click', () => openPanel('ammo'));
    el.statsBtn.addEventListener('click', () => openPanel('stats'));
    el.audioBtn.addEventListener('click', () => actions.toggleAudio());
    $('clearStats').addEventListener('click', () => {
      actions.clearProgress();
      refreshStats();
      toast('本机战绩已清空');
    });
    // 每个面板都有两条退路：底部文字按钮 + 右上角 ×
    for (const id of ['closeShop', 'closeShopX', 'closeUpgrade', 'closeUpgradeX',
      'closeAmmo', 'closeAmmoX', 'closeStats', 'closeStatsX']) {
      $(id).addEventListener('click', closePanels);
    }
    el.backdrop.addEventListener('click', closePanels);
    el.overlay.addEventListener('click', () => overlayHandler?.());
    document.addEventListener('keydown', handleKey);
    document.addEventListener('keyup', handleKeyUp);
    el.popMax.textContent = String(state.limits.popMax);
    el.menuSub.textContent = `${C.meta.subtitle} · v${C.meta.version}`;
    document.title = C.meta.title;
  }

  buildUnitBar();
  buildShop();
  refreshUpgrade();
  bind();

  return {
    sync, toast, showMenu, showGame, showPause, showEnd, refreshUpgrade, refreshAmmo, refreshStats,
    setLoadTip: (text) => { el.loadTip.textContent = text; },
    setAssetBadge: (loaded, total, missing) => {
      const node = el.assetBadge;
      const text = `位图 ${loaded}/${total}`;
      if (node.textContent !== text) node.textContent = text;
      node.classList.toggle('ok', missing === 0);
      node.classList.toggle('bad', missing > 0);
    },
    enableStart: () => { el.startBtn.disabled = false; },
  };
}
