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

  // 位图回归：两段式超时放行后即可开战，9 张 WebP 必须全部取到
  await page.waitForFunction(() => !document.getElementById('startBtn').disabled, null, { timeout: 25000 });
  check('位图加载完成后开始按钮可用', true);

  const staticOk = failedRequests.length === 0;
  check('所有静态资源（HTML/CSS/JS/WebP）无 4xx/5xx', staticOk, failedRequests.join(' | ') || '全部 200');
  const webpUrls = new Set(allRequests.filter((u) => /\.webp(?:\?|$)/i.test(u)));
  check('9 张 WebP 立绘/背景均已请求', webpUrls.size === 9, `${webpUrls.size} 个不同 URL`);
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
  await page.click('#startBtn');
  check('主菜单 → 对局', await page.isVisible('#gameUI') && !(await page.isVisible('#mainMenu')));
  check('难度选择已生效', (await page.evaluate(() => window.__stickWar.state.difficulty)) === 'hard');

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
