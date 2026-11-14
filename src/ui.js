import { CONFIG, UNIT_ORDER, assetPath } from './config.js';
import { upgradeLevels, countTeam, isTerminal } from './state.js';
import { spawnPlayer, doUpgrade, setMode } from './simulation.js';

const C = CONFIG;
const $ = (id) => document.getElementById(id);

export function createUI(state, actions) {
  const el = {
    mainMenu: $('mainMenu'), gameUI: $('gameUI'), loadTip: $('loadTip'),
    startBtn: $('startBtn'), helpBtn: $('helpBtn'), menuSub: $('menuSub'),
    gold: $('gold'), pop: $('pop'), popMax: $('popMax'),
    homeHp: $('homeHp'), enemyHp: $('enemyHp'), clock: $('clock'),
    unitBar: $('unitBar'), shopGrid: $('shopGrid'), upgradeGrid: $('upgradeGrid'),
    shopPanel: $('shopPanel'), upgradePanel: $('upgradePanel'),
    backdrop: $('panelBackdrop'),
    closeShopX: $('closeShopX'), closeUpgradeX: $('closeUpgradeX'),
    attackBtn: $('attackBtn'), defendBtn: $('defendBtn'), pauseBtn: $('pauseBtn'),
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
    sync();
  }

  function upgrade(type, stat) {
    const r = doUpgrade(state, type, stat);
    if (!r.ok) { toast(r.reason); return; }
    refreshUpgrade();
    sync();
    toast(`${C.units[type].name} ${statName(stat)} → ${upgradeLevels(state, type)[stat]} 级`);
  }

  function statName(s) { return { atk: '攻击', def: '防御', spd: '攻速' }[s]; }

  function mode(m) {
    if (setMode(state, m)) sync();
  }

  function closePanels() {
    el.shopPanel.hidden = true;
    el.upgradePanel.hidden = true;
    el.backdrop.hidden = true;
  }

  // 所有面板共用的唯一入口：顺手收掉另一个，避免两层叠在一起出不来。
  function openPanel(which) {
    if (state.phase !== 'playing') { toast('先回到对局再打开面板'); return; }
    el.shopPanel.hidden = which !== 'shop';
    el.upgradePanel.hidden = which !== 'upgrade';
    el.backdrop.hidden = false;
    if (which === 'upgrade') refreshUpgrade();
  }

  function buildUnitBar() {
    el.unitBar.innerHTML = '';
    UNIT_ORDER.forEach((key, i) => {
      const cfg = C.units[key];
      const btn = document.createElement('button');
      btn.className = 'unitIcon';
      btn.type = 'button';
      btn.title = `${cfg.name} · ${cfg.cost} 金币 · 快捷键 ${i + 1}`;
      btn.innerHTML = `<img src="${assetPath(key)}" alt=""><span>${cfg.name}</span><span class="cost">${cfg.cost}</span>`;
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
      card.innerHTML = `<img src="${assetPath(key)}" alt=""><div class="name">${cfg.name}</div>` +
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
      card.innerHTML = `<img src="${assetPath(key)}" alt=""><div class="name">${cfg.name}</div>` +
        `<div class="desc">攻 ${lv.atk} · 防 ${lv.def} · 速 ${lv.spd}</div>`;
      const row = document.createElement('div');
      row.className = 'upgradeRow';
      for (const stat of ['atk', 'def', 'spd']) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = { atk: 'btnAtk', def: 'btnDef', spd: 'btnSpd' }[stat];
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
    const pop = countTeam(state, 0);
    setText(el.gold, 'gold', String(Math.round(state.gold)));
    setText(el.pop, 'pop', String(pop));
    setText(el.homeHp, 'homeHp', String(Math.max(0, Math.round(state.homeHp))));
    setText(el.enemyHp, 'enemyHp', String(Math.max(0, Math.round(state.enemyHp))));
    const total = Math.floor(state.elapsed);
    setText(el.clock, 'clock', `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`);

    const playable = state.phase === 'playing';
    const full = pop >= state.limits.popMax;
    for (const [key, btn] of unitButtons) {
      const disabled = !playable || full || state.gold < C.units[key].cost;
      if (btn.disabled !== disabled) btn.disabled = disabled;  // 真禁用，不只是置灰
    }
    if (el.attackBtn.getAttribute('aria-pressed') !== String(state.gameMode === 'attack')) {
      el.attackBtn.setAttribute('aria-pressed', String(state.gameMode === 'attack'));
      el.defendBtn.setAttribute('aria-pressed', String(state.gameMode === 'defend'));
    }
    el.pauseBtn.setAttribute('aria-pressed', String(state.phase === 'paused'));
    el.pauseBtn.textContent = state.phase === 'paused' ? '继续' : '暂停';
    for (const { key, stat, node } of upgradeButtons) {
      const disabled = !playable || state.gold < C.upgrade.cost ||
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
    const total = Math.floor(state.elapsed);
    const clock = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    showOverlay(
      won ? '胜利' : '失败',
      '点 × 或按 Esc 返回主菜单，再来一局',
      () => actions.goMenu(),
      [
        `用时 ${clock}`,
        `我方出兵 ${state.stats.playerSpawned} · 运矿 ${state.stats.trips} 趟`,
        `敌方出兵 ${state.stats.aiSpawned}`,
      ],
    );
  }

  function handleKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (state.phase === 'menu') {
      if (k === 'Enter') { actions.start(); e.preventDefault(); }
      return;
    }
    if (k === 'Escape') {
      e.preventDefault();
      if (!el.shopPanel.hidden || !el.upgradePanel.hidden) { closePanels(); return; }
      if (state.phase === 'paused') { actions.togglePause(); return; }
      if (isTerminal(state)) { actions.goMenu(); return; }
      closePanels();
      return;
    }
    if (k === 'p' || k === 'P') { actions.togglePause(); e.preventDefault(); return; }
    if (state.phase !== 'playing') return;
    if (/^[1-9]$/.test(k)) {
      const type = UNIT_ORDER[Number(k) - 1];
      if (type) { spawn(type); e.preventDefault(); }
      return;
    }
    if (k === 'a' || k === 'A') { mode('attack'); e.preventDefault(); }
    else if (k === 'd' || k === 'D') { mode('defend'); e.preventDefault(); }
  }

  function bind() {
    el.startBtn.addEventListener('click', () => actions.start());
    el.helpBtn.addEventListener('click', () => toast('矿工往返金矿运钱；1–7 出兵；A/D 切换攻守；摧毁敌方雕像获胜'));
    $('menuBtn').addEventListener('click', () => actions.goMenu());
    el.pauseBtn.addEventListener('click', () => actions.togglePause());
    el.attackBtn.addEventListener('click', () => mode('attack'));
    el.defendBtn.addEventListener('click', () => mode('defend'));
    $('shopBtn').addEventListener('click', () => openPanel('shop'));
    $('upgradeBtn').addEventListener('click', () => openPanel('upgrade'));
    // 每个面板都有两条退路：底部文字按钮 + 右上角 ×
    for (const id of ['closeShop', 'closeShopX', 'closeUpgrade', 'closeUpgradeX']) {
      $(id).addEventListener('click', closePanels);
    }
    el.backdrop.addEventListener('click', closePanels);
    el.overlay.addEventListener('click', () => overlayHandler?.());
    document.addEventListener('keydown', handleKey);
    el.popMax.textContent = String(state.limits.popMax);
    el.menuSub.textContent = `${C.meta.subtitle} · v${C.meta.version}`;
    document.title = C.meta.title;
  }

  buildUnitBar();
  buildShop();
  refreshUpgrade();
  bind();

  return {
    sync, toast, showMenu, showGame, showPause, showEnd, refreshUpgrade,
    setLoadTip: (text) => { el.loadTip.textContent = text; },
    enableStart: () => { el.startBtn.disabled = false; },
  };
}
