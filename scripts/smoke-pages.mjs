#!/usr/bin/env node
// 页面可达性烟测：不只是「页面能打开」，而是每个能进的层都能出、每份资源都能取到。
// 用法：node scripts/smoke-pages.mjs            （自动起本地静态服务）
//       BASE_URL=http://host/path node scripts/smoke-pages.mjs  （测已部署的站点）
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';

const require = createRequire(import.meta.url);
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4399;
const external = process.env.BASE_URL;
const base = external || `http://127.0.0.1:${PORT}/`;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function waitPort(port, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((res) => {
      const s = net.connect(port, '127.0.0.1');
      s.on('connect', () => { s.destroy(); res(true); });
      s.on('error', () => res(false));
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

let server = null;
if (!external) {
  server = spawn(process.execPath, [path.join(root, 'scripts', 'serve.mjs')], {
    cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
  });
  if (!(await waitPort(PORT))) { console.error('静态服务未启动'); server.kill(); process.exit(1); }
}

const browser = await chromium.launch({
  headless: true,
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const failedRequests = [];
const allRequests = [];
const consoleErrors = [];
page.on('request', (r) => allRequests.push(r.url()));
page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });
page.on('requestfailed', (r) => failedRequests.push(`FAILED ${r.url()}`));
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

try {
  const resp = await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 });
  check('首页可达', resp?.status() === 200, `HTTP ${resp?.status()}`);

  // 位图回归：两段式超时放行后即可开战，10 张 WebP（含金矿插画）必须全部取到
  await page.waitForFunction(() => !document.getElementById('startBtn').disabled, null, { timeout: 25000 });
  check('位图加载完成后开始按钮可用', true);

  const staticOk = failedRequests.length === 0;
  check('所有静态资源（HTML/CSS/JS/WebP）无 4xx/5xx', staticOk, failedRequests.join(' | ') || '全部 200');
  const webpUrls = new Set(allRequests.filter((u) => /\.webp(?:\?|$)/i.test(u)));
  check('10 张 WebP 立绘/背景/金矿均已请求', webpUrls.size === 10, `${webpUrls.size} 个不同 URL`);
  const missingAssets = await page.evaluate(() => window.__stickWar.assets.missingCount());
  check('素材缺失数为 0（无隐形单位）', missingAssets === 0, `${missingAssets} 张缺失`);
  check('无运行时异常', consoleErrors.length === 0, consoleErrors.join(' | ') || '无');

  const mod = await page.evaluate(() => !!window.__stickWar);
  check('ESM 主模块装配成功', mod);

  const iconCounts = await page.evaluate(() => ({
    unit: document.querySelectorAll('#unitBar .unitBmp').length,
    shop: document.querySelectorAll('#shopGrid .unitBmp').length,
    upgrade: document.querySelectorAll('#upgradeGrid .unitBmp').length,
    tools: document.querySelectorAll('.toolBtn .vIcon').length,
    loaded: [...document.querySelectorAll('.unitBmp')].filter((i) => i.complete && i.naturalWidth > 0).length,
  }));
  check('兵种栏/商店/升级用位图立绘，工具按钮保留内联 SVG',
    iconCounts.unit === 7 && iconCounts.shop === 7 && iconCounts.upgrade === 7 && iconCounts.tools === 2,
    JSON.stringify(iconCounts));
  check('所有位图图标已解码', iconCounts.loaded >= 21, `${iconCounts.loaded} 张`);

  const painted = await page.evaluate(() => {
    const c = document.getElementById('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) { if (d[i] > 0) { n++; if (n > 30) break; } }
    return n > 30;
  });
  check('Canvas 位图+矢量绘制非空', painted);

  const mineCount = await page.evaluate(() => window.__stickWar.mines().length);
  check('双侧矿脉已装配', mineCount === 6, `${mineCount} 个矿点`);

  const diffCount = await page.locator('#difficulty option').count();
  check('难度下拉含三档', diffCount === 3, `${diffCount} 项`);
  await page.selectOption('#difficulty', 'hard');

  // v2.11 战绩存档：主菜单也能进，且 × / Esc 都能退回主菜单
  check('主菜单有战绩入口', await page.isVisible('#statsBtn'));
  await page.click('#statsBtn');
  check('战绩面板可达', await page.isVisible('#statsPanel'));
  check('战绩面板有可见的 ×', await page.isVisible('#closeStatsX'));
  const statCells = await page.locator('#statsBody .statCell').count();
  check('战绩面板渲染 6 项统计', statCells === 6, `${statCells} 项`);
  check('打开战绩时主菜单收起（面板不被盖住）', !(await page.isVisible('#mainMenu')));
  await page.click('#closeStatsX');
  check('战绩 × 可退回主菜单',
    !(await page.isVisible('#statsPanel')) && await page.isVisible('#mainMenu'));
  await page.click('#statsBtn');
  await page.keyboard.press('Escape');
  check('主菜单下 Esc 也能退出战绩',
    !(await page.isVisible('#statsPanel')) && await page.isVisible('#mainMenu'));

  await page.click('#startBtn');
  check('主菜单 → 对局', await page.isVisible('#gameUI') && !(await page.isVisible('#mainMenu')));
  check('难度选择已生效', (await page.evaluate(() => window.__stickWar.state.difficulty)) === 'hard');

  // v2.8 移动端视口：逻辑世界固定 1600×800，390px 窄屏只显示其中一段，不压缩整场
  const viewport = await page.evaluate(() => {
    const w = window.__stickWar;
    const s = w.state, v = s.view, c = document.getElementById('canvas');
    const homeL = w.config.layout.statueInset + w.config.layout.statueHitRadius;
    const homeR = s.w - homeL;
    const dists = w.config.layout.goldMines.map((m) =>
      Math.abs(s.w * m.xRatio - (m.side === 0 ? homeL : homeR)));
    return {
      worldW: s.w, worldH: s.h, viewW: v.viewW, scale: v.scale, maxX: v.maxX,
      dpr: v.dpr, canvasW: c.width, cssW: v.cssW,
      follow: v.follow,
      minDist: Math.min(...dists),
      required: s.w * w.config.economy.minMineHomeDistanceRatio,
      goldmine: !!w.assets.get('goldmine'),
      assets: w.assets.count(),
      badge: document.getElementById('assetBadge').textContent,
      badgeOk: document.getElementById('assetBadge').classList.contains('ok'),
    };
  });
  check('逻辑世界固定为 1600×800', viewport.worldW === 1600 && viewport.worldH === 800,
    `${viewport.worldW}×${viewport.worldH}`);
  check('窄屏只显示一段战场而非压扁整场', viewport.viewW < viewport.worldW * 0.6,
    `视口 ${viewport.viewW.toFixed(0)} / 世界 ${viewport.worldW}`);
  check('镜头可横向平移', viewport.maxX > 0, `maxX=${viewport.maxX.toFixed(0)}`);
  check('Canvas 按 DPR 分配设备像素', viewport.canvasW === Math.round(viewport.cssW * viewport.dpr),
    `${viewport.canvasW} vs ${viewport.cssW}×${viewport.dpr}`);
  check('矿点不再贴着回营点', viewport.minDist >= viewport.required,
    `最近 ${viewport.minDist.toFixed(0)}px ≥ ${viewport.required.toFixed(0)}px`);
  check('金矿使用真正的位图插画', viewport.goldmine);
  check('10 张位图全部登记且徽标可见', viewport.assets === 10 &&
    viewport.badge === '位图 10/10' && viewport.badgeOk, `${viewport.badge} / ${viewport.assets}`);
  check('窄屏默认开启镜头跟随', viewport.follow === true);

  await page.click('#camRight');
  const panned = await page.evaluate(() => ({
    x: window.__stickWar.state.view.x,
    follow: window.__stickWar.state.view.follow,
  }));
  check('视角右移按钮生效且关闭跟随', panned.x > 0 && panned.follow === false,
    `x=${panned.x.toFixed(0)}`);
  await page.click('#camFollow');
  check('跟随按钮可重新开启', (await page.evaluate(() =>
    window.__stickWar.state.view.follow)) === true);

  // 桌面宽屏：视口应能看到接近完整战场，且 resize 不改写逻辑世界尺寸
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(120);
  const wide = await page.evaluate(() => {
    const s = window.__stickWar.state, c = document.getElementById('canvas');
    return { w: s.w, viewW: s.view.viewW, canvasW: c.width, cssW: s.view.cssW };
  });
  check('宽屏 resize 后逻辑世界尺寸不变', wide.w === 1600, `w=${wide.w}`);
  check('宽屏视野接近完整战场', wide.viewW > 1600 * 0.85,
    `视口 ${wide.viewW.toFixed(0)}px`);
  check('宽屏 Canvas 同步重算 DPR', wide.canvasW === Math.round(wide.cssW * viewport.dpr));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(120);

  // 训练队列：下单扣钱入队、点条目取消退款、不生成幽灵单位
  const goldBefore = await page.evaluate(() => window.__stickWar.state.gold);
  await page.locator('#unitBar .unitIcon').nth(3).click();  // 弓箭手，训练 8s
  check('下单后训练队列可见', (await page.locator('#queueStrip .queueItem').count()) === 1);
  const goldAfterOrder = await page.evaluate(() => window.__stickWar.state.gold);
  check('下单即扣除金币', Math.abs(goldAfterOrder - (goldBefore - 100)) < 2,
    `${goldBefore} → ${goldAfterOrder}`);
  check('训练中我方单位未出场', (await page.evaluate(() =>
    window.__stickWar.state.units.filter((u) => u.team === 0).length)) === 0);
  await page.click('#queueStrip .queueItem');
  check('取消训练后队列清空', (await page.locator('#queueStrip .queueItem').count()) === 0);
  const goldAfterCancel = await page.evaluate(() => window.__stickWar.state.gold);
  check('取消训练全额退款', Math.abs(goldAfterCancel - goldBefore) < 2,
    `${goldAfterOrder} → ${goldAfterCancel}`);

  // 三指令：驻堡按钮可切换且状态机同步
  await page.click('#garrisonBtn');
  check('驻堡指令可切换', (await page.evaluate(() => window.__stickWar.state.gameMode)) === 'garrison');
  check('驻堡按钮有选中态', (await page.getAttribute('#garrisonBtn', 'aria-pressed')) === 'true');
  await page.click('#defendBtn');
  check('可切回固守', (await page.evaluate(() => window.__stickWar.state.gameMode)) === 'defend');

  // v2.9 宝石：免费无限领、可当金币花、取消训练原路退回
  const gemNumber = await page.locator('#gems').innerText();
  check('顶栏展示宝石资源（窄屏保留数值）', Number(gemNumber) > 0, `宝石=${gemNumber}`);
  check('底栏有领宝石入口', await page.isVisible('#gemBtn'));
  const gem0 = await page.evaluate(() => window.__stickWar.state.gems);
  for (let i = 0; i < 2; i++) await page.click('#gemBtn');
  const gemAfterGrants = await page.evaluate(() => ({
    gems: window.__stickWar.state.gems,
    grants: window.__stickWar.state.stats.gemsGranted,
    gold: window.__stickWar.state.gold,
  }));
  check('宝石免费领 2 次全部生效',
    gemAfterGrants.grants === 2 &&
    Math.abs(gemAfterGrants.gems - (gem0 + 2 * 500)) < 1e-6,
    `${gem0} → ${gemAfterGrants.gems}，领取 ${gemAfterGrants.grants} 次`);
  check('领满 2 次后按钮真禁用（不是只置灰）',
    await page.locator('#gemBtn').isDisabled());
  check('按钮显示 2/2 已领完',
    (await page.locator('#gemBtnLabel').innerText()).includes('2/2'),
    await page.locator('#gemBtnLabel').innerText());
  // 绕过 UI 直接调逻辑层也必须被拦住，避免只是前端禁用。
  const third = await page.evaluate(() => window.__stickWar.grantGems());
  check('绕过 UI 直接调逻辑层，第 3 次仍被拒绝', third.ok === false &&
    third.remaining === 0, JSON.stringify(third));
  check('被拒后宝石余额不变',
    (await page.evaluate(() => window.__stickWar.state.gems)) === gemAfterGrants.gems);

  // 把金币清零，验证出兵自动走宝石抵扣
  await page.evaluate(() => { window.__stickWar.state.gold = 0; });
  const gemsBeforeBuy = await page.evaluate(() => window.__stickWar.state.gems);
  await page.locator('#unitBar .unitIcon').nth(0).click();  // 矿工 25 金
  const afterBuy = await page.evaluate(() => {
    const w = window.__stickWar;
    return {
      gems: w.state.gems, gold: w.state.gold,
      queue: document.querySelectorAll('#queueStrip .queueItem').length,
      paid: w.state.training.find((t) => t.team === 0)?.paid ?? null,
      gemPayments: w.state.stats.gemPayments,
    };
  });
  check('金币为 0 时仍可出兵（按钮未被禁用）', afterBuy.queue === 1,
    `队列 ${afterBuy.queue}`);
  check('下单自动扣宝石且不动金币',
    afterBuy.paid && afterBuy.paid.gems >= 25 && afterBuy.gold < 1,
    `paid=${JSON.stringify(afterBuy.paid)} gold=${afterBuy.gold}`);
  check('宝石余额按实扣减少', afterBuy.gems < gemsBeforeBuy,
    `${gemsBeforeBuy} → ${afterBuy.gems}`);

  await page.click('#queueStrip .queueItem');
  const afterCancelGem = await page.evaluate(() => ({
    gems: window.__stickWar.state.gems,
    gold: window.__stickWar.state.gold,
    queue: document.querySelectorAll('#queueStrip .queueItem').length,
  }));
  check('取消训练把宝石原路退回（不洗成金币）',
    afterCancelGem.queue === 0 &&
    Math.abs(afterCancelGem.gems - gemsBeforeBuy) < 1e-6 &&
    afterCancelGem.gold < 2,
    `gems=${afterCancelGem.gems} gold=${afterCancelGem.gold}`);

  // 把金币恢复，避免影响后续「敌方发育」段的时长
  await page.evaluate(() => { window.__stickWar.state.gold = 500; });

  // v2.10 单兵指挥：点战场选中 → 指挥条出现 → × / Esc / 点空处都能退
  await page.locator('#unitBar .unitIcon').nth(0).click();  // 矿工，训练 4s
  await page.waitForFunction(() =>
    window.__stickWar.state.units.some((u) => u.team === 0 && u.hp > 0),
    null, { timeout: 15000 });
  const picked = await page.evaluate(() => {
    const w = window.__stickWar;
    const u = w.state.units.find((v) => v.team === 0 && v.hp > 0);
    return { x: u.x, res: w.control.select(u.x) };
  });
  check('点战场可选中我方单位进入指挥', picked.res.ok === true, JSON.stringify(picked.res));
  await page.waitForTimeout(60);
  check('指挥条出现且显示兵种名', await page.isVisible('#championBar') &&
    (await page.locator('#championName').innerText()).length > 0,
    await page.locator('#championName').innerText());
  check('指挥条有可见的 × 退出', await page.isVisible('#champExit') &&
    (await page.locator('#champExit').innerText()).includes('×'));
  check('指挥条有左右按住按钮',
    await page.isVisible('#champHoldLeft') && await page.isVisible('#champHoldRight'));

  const xBeforeHold = await page.evaluate(() =>
    window.__stickWar.state.units.find((u) => u.team === 0 && u.hp > 0).x);
  await page.locator('#champHoldRight').hover();
  await page.mouse.down();
  await page.waitForTimeout(320);
  await page.mouse.up();
  const xAfterHold = await page.evaluate(() =>
    window.__stickWar.state.units.find((u) => u.team === 0 && u.hp > 0).x);
  check('按住 ▶ 让指挥单位向右移动', xAfterHold > xBeforeHold + 1,
    `${xBeforeHold.toFixed(1)} → ${xAfterHold.toFixed(1)}`);

  const xBeforeKey = xAfterHold;
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(320);
  await page.keyboard.up('ArrowLeft');
  const xAfterKey = await page.evaluate(() => ({
    x: window.__stickWar.state.units.find((u) => u.team === 0 && u.hp > 0).x,
    axis: window.__stickWar.control.info().axis,
  }));
  check('方向键 ← 手动左移且松开后归零',
    xAfterKey.x < xBeforeKey - 1 && xAfterKey.axis === 0,
    `${xBeforeKey.toFixed(1)} → ${xAfterKey.x.toFixed(1)} axis=${xAfterKey.axis}`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
  check('Esc 可退出指挥', !(await page.isVisible('#championBar')) &&
    (await page.evaluate(() => window.__stickWar.control.info().active)) === false);

  await page.evaluate(() => {
    const w = window.__stickWar;
    const u = w.state.units.find((v) => v.team === 0 && v.hp > 0);
    w.control.select(u.x);
  });
  await page.waitForTimeout(60);
  await page.click('#champExit');
  await page.waitForTimeout(60);
  check('指挥条 × 可退出', !(await page.isVisible('#championBar')) &&
    (await page.evaluate(() => window.__stickWar.control.info().active)) === false);

  await page.evaluate(() => {
    const w = window.__stickWar;
    const u = w.state.units.find((v) => v.team === 0 && v.hp > 0);
    w.control.select(u.x);
  });
  await page.mouse.click(360, 190);   // 点战场空白处
  await page.waitForTimeout(60);
  check('点战场空白处也能退出指挥',
    (await page.evaluate(() => window.__stickWar.control.info().active)) === false);

  // v2.7 敌方发育：开局先造矿工 → 真实往返运矿 → 自己花钱升科技，不是按周期刷兵
  // 等待期间 AI 会持续推线，先把雕像血量顶住，避免对局自动结束打断后续可达性断言。
  await page.evaluate(() => { window.__stickWar.state.homeHp = 1e9; });
  await page.waitForFunction(() => window.__stickWar.growth().trips > 0, null, { timeout: 30000 });
  const dev = await page.evaluate(() => {
    const w = window.__stickWar;
    return {
      ...w.growth(),
      enemyMiners: w.state.units.filter((u) => u.team === 1 && u.kind === 'miner' && u.hp > 0).length,
      onOwnHalf: w.state.units.filter((u) => u.team === 1 && u.kind === 'miner' && u.hp > 0)
        .every((u) => u.x > w.state.w * 0.5),
      playerUpgradesClean: Object.values(w.state.upgrades)
        .every((lv) => Object.values(lv).every((v) => v === 0)),
      aiDevText: document.getElementById('aiDev').textContent,
    };
  });
  check('敌方矿工补到目标数（含训练中）', dev.miners >= dev.target,
    `${dev.miners}/${dev.target}，其中已出场 ${dev.enemyMiners} 名`);
  check('敌方矿工确实已出场', dev.enemyMiners >= 2, `${dev.enemyMiners} 名`);
  check('敌方矿工只在自家半场挖矿', dev.onOwnHalf);
  check('敌方矿工真实交付产生收入', dev.trips > 0 && dev.earned > 0,
    `${dev.trips} 趟 / ${Math.round(dev.earned)} 金`);
  check('顶栏展示敌方发育指标', dev.aiDevText.includes('矿工') && dev.aiDevText.includes('科技'),
    dev.aiDevText);
  check('敌方发育不污染玩家 Armory', dev.playerUpgradesClean);
  await page.evaluate(() => { window.__stickWar.state.aiGold = 100000; });
  await page.waitForFunction(() => window.__stickWar.growth().upgrades > 0, null, { timeout: 30000 });
  const tech = await page.evaluate(() => window.__stickWar.growth());
  check('敌方自己花钱买科技', tech.upgrades > 0 && tech.planIndex > 0,
    `${tech.upgrades} 级 / planIndex=${tech.planIndex}`);

  // 商店：打开、有 ×、× 能退、Esc 能退、点遮罩能退
  await page.click('#shopBtn');
  check('商店可达', await page.isVisible('#shopPanel'));
  check('商店有可见的 ×', await page.isVisible('#closeShopX'));
  await page.click('#closeShopX');
  check('商店 × 可退出', !(await page.isVisible('#shopPanel')));

  await page.click('#shopBtn');
  await page.keyboard.press('Escape');
  check('商店 Esc 可退出', !(await page.isVisible('#shopPanel')));

  await page.click('#shopBtn');
  await page.mouse.click(24, 110);  // 战场左上角，落在遮罩上而非面板/底栏
  check('商店点击外部可退出', !(await page.isVisible('#shopPanel')));

  // 升级：打开、×、文字按钮、切换到商店不会叠层
  await page.click('#upgradeBtn');
  check('升级面板可达', await page.isVisible('#upgradePanel'));
  check('升级面板有可见的 ×', await page.isVisible('#closeUpgradeX'));
  const cards = await page.locator('#upgradeGrid .upgradeItem').count();
  check('升级面板渲染全部兵种卡片', cards === 7, `${cards} 张`);
  const minerCard = (await page.locator('#upgradeGrid .upgradeItem').first().innerText());
  check('矿工升级为背包/镐/移速而非攻防', minerCard.includes('背包') &&
    minerCard.includes('镐') && !minerCard.includes('攻击'));
  await page.click('#closeUpgradeX');
  check('升级面板 × 可退出', !(await page.isVisible('#upgradePanel')));

  await page.click('#upgradeBtn');
  await page.click('#closeUpgrade');
  check('升级面板文字按钮可退出', !(await page.isVisible('#upgradePanel')));

  await page.click('#upgradeBtn');
  await page.click('#shopBtn');
  const stacked = (await page.isVisible('#upgradePanel')) && (await page.isVisible('#shopPanel'));
  check('切换面板不会双层叠加', !stacked);
  await page.keyboard.press('Escape');
  check('切换后仍能一次退出', !(await page.isVisible('#shopPanel')) && !(await page.isVisible('#upgradePanel')));

  // v2.11 箭矢面板：可达、能切换、四条退出通道、顶栏同步
  await page.evaluate(() => { window.__stickWar.state.gold = 1000; });
  await page.click('#ammoBtn');
  check('箭矢面板可达', await page.isVisible('#ammoPanel'));
  check('箭矢面板有可见的 ×', await page.isVisible('#closeAmmoX'));
  const ammoCards = await page.locator('#ammoGrid .ammoItem').count();
  check('箭矢面板渲染 4 种弹药', ammoCards === 4, `${ammoCards} 种`);
  await page.locator('#ammoGrid .ammoItem').nth(1).click();   // 火箭
  const ammoAfter = await page.evaluate(() => ({
    ammo: window.__stickWar.state.ammo,
    badge: document.getElementById('ammoBadge').textContent,
    gold: window.__stickWar.state.gold,
    fx: window.__stickWar.effects(),
  }));
  check('切换箭矢生效且顶栏徽标同步',
    ammoAfter.ammo === 'fire' && ammoAfter.badge.includes('火箭'),
    `${ammoAfter.ammo} / ${ammoAfter.badge}`);
  check('切换箭矢真扣了金币', ammoAfter.gold < 1000, `剩余 ${ammoAfter.gold.toFixed(1)}`);
  check('状态效果口径可读', ammoAfter.fx.ammo === 'fire' &&
    'active' in ammoAfter.fx && 'stats' in ammoAfter.fx);
  await page.click('#closeAmmoX');
  check('箭矢 × 可退出', !(await page.isVisible('#ammoPanel')));
  await page.click('#ammoBtn');
  await page.keyboard.press('Escape');
  check('箭矢 Esc 可退出', !(await page.isVisible('#ammoPanel')));
  await page.click('#ammoBtn');
  await page.mouse.click(24, 110);
  check('箭矢点外部可退出', !(await page.isVisible('#ammoPanel')));

  // v2.11 音效与存档模块：开关可切、模块已装配
  check('音效与战绩模块已装配', await page.evaluate(() =>
    !!window.__stickWar.audio && !!window.__stickWar.progress));
  const audioBefore = await page.locator('#audioBtn').getAttribute('aria-pressed');
  await page.click('#audioBtn');
  const audioAfter = await page.locator('#audioBtn').getAttribute('aria-pressed');
  check('音效开关可切换', audioBefore !== audioAfter, `${audioBefore} → ${audioAfter}`);
  await page.click('#audioBtn');   // 恢复

  // 暂停浮层：有 ×、× 恢复、Esc 恢复；暂停时面板必须被收起
  await page.click('#shopBtn');
  await page.click('#pauseBtn');
  check('暂停时收起商店面板', !(await page.isVisible('#shopPanel')));
  check('暂停浮层可达', await page.isVisible('#pauseOverlay'));
  check('暂停浮层有 ×', await page.isVisible('.overlayClose'));

  // 相位全部来自模拟时间：暂停时 Canvas 必须逐帧完全一致
  const snap = () => page.evaluate(() => document.getElementById('canvas').toDataURL());
  const p1 = await snap();
  await page.waitForTimeout(220);
  const p2 = await snap();
  check('暂停时 Canvas 画面完全静止', p1 === p2);
  const cssPaused = await page.evaluate(() =>
    getComputedStyle(document.querySelector('#unitBar .unitBmp')).animationPlayState);
  check('暂停时 CSS 动画同步冻结', cssPaused === 'paused', cssPaused);

  await page.click('.overlayClose');
  check('暂停 × 可恢复', !(await page.isVisible('#pauseOverlay')));
  const r1 = await snap();
  await page.waitForTimeout(240);
  const r2 = await snap();
  check('恢复后画面继续动画', r1 !== r2);

  await page.keyboard.press('p');
  await page.keyboard.press('Escape');
  check('暂停 Esc 可恢复', !(await page.isVisible('#pauseOverlay')));

  // 结算浮层：强制进入终局，验证 × 与 Esc 都能回主菜单
  await page.evaluate(() => {
    const w = window.__stickWar;
    w.state.enemyHp = 0;
    w.state.phase = 'won';
    w.ui.showEnd('won');
  });
  check('结算浮层可达', await page.isVisible('#pauseOverlay'));
  check('结算浮层有 ×', await page.isVisible('.overlayClose'));
  check('结算展示统计', (await page.locator('.resultStats div').count()) >= 3);
  await page.click('.overlayClose');
  check('结算 × 可回主菜单', await page.isVisible('#mainMenu'));

  await page.click('#startBtn');
  await page.evaluate(() => {
    const w = window.__stickWar;
    w.state.homeHp = 0;
    w.state.phase = 'lost';
    w.ui.showEnd('lost');
  });
  await page.keyboard.press('Escape');
  check('结算 Esc 可回主菜单', await page.isVisible('#mainMenu'));

  // 主菜单的「菜单」按钮也是一条退路
  await page.click('#startBtn');
  await page.click('#menuBtn');
  check('对局中「菜单」按钮可回主菜单', await page.isVisible('#mainMenu'));
} catch (e) {
  check('烟测流程未中断', false, String(e));
} finally {
  await browser.close();
  if (server) server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) process.exit(1);
