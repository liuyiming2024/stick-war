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
const consoleErrors = [];
page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });
page.on('requestfailed', (r) => failedRequests.push(`FAILED ${r.url()}`));
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

try {
  const resp = await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 });
  check('首页可达', resp?.status() === 200, `HTTP ${resp?.status()}`);

  // 等素材加载流程放行开始按钮
  await page.waitForFunction(() => !document.getElementById('startBtn').disabled, null, { timeout: 25000 });
  check('素材加载完成后开始按钮可用', true);

  const staticOk = failedRequests.length === 0;
  check('所有静态资源（JS/CSS/WebP）无 4xx/5xx', staticOk, failedRequests.join(' | ') || '全部 200');
  check('无运行时异常', consoleErrors.length === 0, consoleErrors.join(' | ') || '无');

  const mod = await page.evaluate(() => !!window.__stickWar);
  check('ESM 主模块装配成功', mod);

  const mineCount = await page.evaluate(() => window.__stickWar.mines().length);
  check('双侧矿脉已装配', mineCount === 6, `${mineCount} 个矿点`);

  await page.click('#startBtn');
  check('主菜单 → 对局', await page.isVisible('#gameUI') && !(await page.isVisible('#mainMenu')));

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
  await page.click('.overlayClose');
  check('暂停 × 可恢复', !(await page.isVisible('#pauseOverlay')));

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
