# 火柴人战争（网页版 v2.9.0）

> 从「一个 18KB 的 `index.html` 包办一切」重构成模块化、可配置、可测试、可继续迭代的静态游戏。
> v2.8 移动端视口 / 位图金矿 / 波次指挥 → **v2.9：宝石无限 + 难度整体下调**。底栏「领宝石」免费、无冷却、无上限，金币不足自动 1:1 抵扣，出兵与升级都直接当金币花；三档难度倍率、首波规模、集结节奏全面放缓，起始金币提到 200。

[![CI](https://github.com/liuyiming2024/stick-war/actions/workflows/ci.yml/badge.svg)](https://github.com/liuyiming2024/stick-war/actions/workflows/ci.yml)

- 🎮 在线试玩：https://liuyiming2024.github.io/stick-war/
- 📦 仓库：https://github.com/liuyiming2024/stick-war
- 🧭 架构说明：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- ⚙️ 配置说明：[config/README.md](config/README.md)

## 本地运行

原生 ESM，**不能 `file://` 双击打开**（CORS）。零依赖静态服务：

```bash
npm run serve          # http://localhost:4173/
# 或
python3 -m http.server 4173
```

无运行时构建步骤，改完刷新即可；只有改 `config/game.json` 才需要 `npm run build` 重新生成 `src/config.generated.js` 与 ESM 版本指纹。10 张 WebP 合计 **289404 字节 / 282.6 KiB**，两段式超时（9s / 26s）+ 单次失败重试放行后即可开战，弱网下晚到的图片会补登记；顶栏 `位图 10/10` 徽标可随时核验。

## v2.9：宝石无限，难度降下来

反馈是两条：**难度太高**，以及要一种「叫宝石的免费金币」——免费送、无限领、能直接当金币花。

### 宝石 = 免费 / 无限 / 可当金币用

`config/game.json` 的 `gems` 段是唯一口径：

| 字段 | 值 | 含义 |
| --- | --- | --- |
| `starting` | 999 | 开局就送，不用做任何事 |
| `grantAmount` | 500 | 底栏「领宝石」每次 +500 |
| `goldPerGem` | 1 | 1 颗 = 1 金币 |
| `autoSpend` | true | 金币不足自动抵扣 |

`grantGems(state)` 无冷却、无总量上限、不花任何东西，可以无限次调用。`build-config.mjs` 会**静态拒绝** `cooldownSec` / `maxTotal` / `cost` 这类字段，防止后来人把「免费无限」改回付费或限次。

支付收敛到一个 `pay(state, amount)`：优先扣金币，差额按 `goldPerGem` **向上取整**成整颗宝石补足。`spawnPlayer()` 与 `doUpgrade()` 共用它，`canAfford()` 是 UI 按钮禁用与下单的同一个判定口径——所以金币为 0 时兵种栏不会灰掉，点一下照样下单。

**取消训练按原路退款**：`enqueue()` 记录 `paid = { fromGold, gems }`，`cancelTraining()` 把金币退回金币、宝石退回宝石。否则「用无限宝石下单 → 取消退金币」会把宝石洗成金币，破坏经济口径。AI 订单不走这套，仍只花 `aiGold`。

UI：顶栏 `宝石 999`（窄屏隐藏文字、保留数值），底栏新增 `领宝石` 按钮（内联 SVG 钻石图标，刻意不用 `.vIcon` 类以免干扰工具按钮计数），下单 toast 显示「宝石抵 N」，结算面板追加领取次数与抵扣颗数。

### 难度整体下调

| 项 | v2.8 | v2.9 | 效果 |
| --- | --- | --- | --- |
| `match.startingGold` | 120 | **200** | 开局能直接出兵 |
| `normal.aiIncomeMul` | 1 | **0.7** | 敌方矿工收益 −30% |
| `normal.aiSpawnMul` | 1 | **1.35** | 敌方训练慢 35% |
| `normal.enemyStatueMul` | 1 | **0.8** | 敌方雕像 1600 → 1280 |
| `economy.aiGoldPerSec` | 1.5 | **1** | 凭空收入再砍 1/3 |
| `wave.firstWaveSize` | 4 | **3** | 首波更小 |
| `wave.maxWaveSize` | 9 | **6** | 后期不再堆到 9 个 |
| `wave.buildMinSec` | 12 | **18** | 开局多 6 秒喘息 |
| `wave.regroupSec` | 7 | **10** | 波与波之间更松 |

困难/疯狂档同步下调（`insane`: 收入 1.7→1.35、训练 0.6→0.85、雕像 1.5→1.25），仍保持 `normal < hard < insane` 的单调关系，`build-config.mjs` 会校验这一点。

**纯逻辑推演**（seed=7，不领宝石）：

```
挂机不出兵      normal 183s 败 / hard 152s 败 / insane 138s 败
进攻·每4s剑士   normal 57s 胜，我方雕像满血
进攻·每4s混编   normal 61s 胜
进攻·每2s混编   normal 52s 胜（触发 2 次免费领取）
```

挂机仍会输，切「进攻」就能在一分钟左右赢——宝石不是把游戏改成无敌，而是让资源不再卡住操作。

**验证**：82 个单测（新增 `gems.test.mjs` 14 项）、76 项 Playwright 断言（含顶栏宝石 / 连点 6 次全额生效 / 金币清零后按钮仍可点 / `paid` 实扣构成 / 取消原路退回）、素材与确定性静态自检、导航自检，全绿。历史章节里 v2.8 的 68/69 是当时的计数，未回改。

## v2.8：手机能玩、矿要运、图要好看、对面会打波次

### 固定逻辑世界 + 镜头视口

旧实现把 `canvas.clientWidth` 直接写成 `state.w`，390px 手机上整个 1600px 战场被压进一屏，单位只剩几像素高、影子发虚、矿点和雕像挤在一起。

现在逻辑世界**恒为 `world.width × world.height` = 1600×800**（与背景位图 1:1），屏幕只决定「看哪一段」：

- `scale = clamp(ch / 800, minScale, maxScale)`，`viewW = cssW / scale`；390×844 下约看到 431 世界像素，单位屏幕高度约 112px。
- 所有绘制仍用世界坐标，镜头只是 `setTransform(scale*dpr, …, -view.x*scale*dpr, offsetY*dpr)`，不改任何物理量。
- `view.x` 支持**拖动战场**、`◀ / ▶` 按钮步进、以及「跟随」开关（默认跟随我方最前锋，按 `state.elapsed` 做指数插值，暂停时完全静止）。resize 只重算视口，绝不改写 `state.w/h`。
- Canvas 按 `devicePixelRatio`（上限 3）分配设备像素，`imageSmoothingQuality='high'`。
- 单位地面投影改成双层柔影，半径钳制在 `[0.09h, 0.26h]`——旧写法 `0.20 - bob/h*0.4` 在 bob 为负时会算出过大甚至反向椭圆，高 DPR 下发虚。

### 挖到矿要走一段路才回营

矿点从 `xRatio 0.14/0.22/0.30`（贴着雕像）外移到 `0.26/0.34/0.42` 与 `0.58/0.66/0.74`，最近单程 ≥ `world.width × minMineHomeDistanceRatio = 192px`（实际约 282px），且 `build-config.mjs` 静态拒绝任何贴脸或越过中线的配置。矿工背矿时移速 ×`carrySpeedMul=0.72`，一趟「去 → 挖 1.6s → 回」约 11.8 秒，运矿过程看得见。

### 位图：补金矿插画 + 全部立绘增强

v2.3/v2.4 手写路径、v2.6 菱形符号都没达到「够精美」。这轮不等第三版画风，直接给 `assets/goldmine.webp`（360×300，黑描边扁平插画：三层岩体 + 棱面金晶簇 + 星芒高光 + 柔和金光），渲染层只 `drawImage` + 呼吸缩放/环绕金尘，矢量降级路径仅作素材未到达时的替身。

7 张兵种 + 雕像统一 2× Lanczos 超采样、UnsharpMask 轻微锐化、alpha 外扩做暗色墨边，高 DPR 下不再糊。`assets/` 共 **10 张 WebP / 289404 字节**，`manifest.json` 与 `check-assets.mjs` 逐项校验（10/10）。

之前线上抓取器显示「9 张素材缺失、线稿替身」是环境误报；这次额外做了三件事：素材 URL 带 `?v=<version>` 指纹（避免缓存住一次失败响应）、`onerror` 单次重试（换 URL 绕开被缓存的失败）、顶栏 `位图 10/10` 实时徽标。烟测里 10 张全部 200、`missingCount=0`。

### 对面改成波次指挥 + 针对性反制

`aiPhase` 状态机 `build → muster → assault → regroup`：

| 阶段 | 行为 |
| --- | --- |
| `build` | 只补矿工/买科技，`buildMinSec=12` 内不出战斗兵 |
| `muster` | 逐个下单直到「已出场 + 排队」达到 `waveSize`，实际出场到 `launchRatio=0.75` 才发起进攻 |
| `assault` | 不再出兵，整波一起压到玩家雕像；打残到 `retreatRatio` 或超时即重整 |
| `regroup` | 补矿工/买科技，冷却后开下一波，波容从 4 递增到上限 9 |

非 `assault` 阶段 AI 战斗兵守在自家半场（`1 - defendLineRatio`），不再零敲碎打地往前送。`counterMatrix` 按玩家兵种构成抬权重（堆剑士 → 弓箭手 ×2.2；堆远程 → 矛士/巨人），用 `counterSaturation` 做饱和上限防止一边倒。120 秒推演：普通难度约 3 波、12 个战斗兵、3 级科技。

**验证（v2.8 当时）**：68 个单测（新增 `world-waves.test.mjs` 11 项）、69 项 Playwright 断言（含窄屏视口/DPR/矿距/金矿位图/`位图 10/10`/镜头平移与跟随/宽屏 resize）、素材与确定性静态自检、导航自检，全绿。

## v2.7.1：修掉「线上还停在旧版本」

**症状**：v2.7.0 的 Pages build 与 CI 都 `success`、仓库里 `config.generated.js` 确实是 2.7.0，但浏览器打开仍显示 `v2.6.0`，甚至可能白屏。

**根因不是部署失败，是裸 URL 的 ESM 缓存**：`index.html` 里是 `<script type="module" src="./src/main.js">`，`main.js` 内部又 `import './config.generated.js'`、`'./ui.js'`… 全是**不带任何版本号的相对 URL**。浏览器按 URL 缓存模块文件，推新版本只改了文件内容、没改 URL，于是 HTML 虽然更新，`main.js` / `config.generated.js` / `ui.js` 仍从 disk cache 取旧版。版本号恰好由 `config.generated.js` 提供，所以最直观的表现就是「版本号没变」；更坏的情况是新 `ui.js` 去 import 旧 `simulation.js` 里不存在的 `aiGrowthInfo`，模块图直接断掉。

> 上一轮我用页面抓取器读到 `v2.7.0` 就断言线上没问题，那个判断不严谨：抓取器有独立的缓存路径，且它的图片请求全被沙盒网关 403，只能说明「某个边缘节点拿到了新文件」，不能代表真实浏览器。以用户实际看到的为准。

**修法**：`scripts/stamp-cache.mjs` 把 `config/game.json` 的 `meta.version` 作为唯一指纹，给

1. `index.html` 的 module script 与 stylesheet href
2. `src/*.js` 里**每一条**相对 `.js` import

统一追加 `?v=<version>`。版本号一变，整条 ESM 依赖图的 URL 同时失效，CDN 与浏览器都必须回源。当前是 `?v=2.7.1`，19 条 import 全部一致。脚本**幂等**（先剥旧 `?v=` 再追加），`npm run build` 自动执行；`check-assets.mjs` 静态断言 HTML 入口/CSS 与所有 src import 的指纹都等于当前版本，CI 用 `git diff --exit-code` 守住生成物不漂移。

`index.html` 另加 `<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">`。Node 对 `file:` URL 的 search 参数只作模块缓存键、路径解析仍取 pathname，因此 `node --test` 与浏览器都能加载；本地 `serve.mjs` 用 `URL.pathname`，天然忽略 query。

**一个诚实的限制**：如果浏览器此前把**旧版 `index.html` 本身**也缓存了（那版 HTML 里没有指纹），普通刷新不会重新拉 HTML，仍会走旧的裸 URL。所以**首次请按一次 `Ctrl+Shift+R` / `Cmd+Shift+R`，或用无痕窗口打开**；拿到带 `?v=2.7.1` 的 HTML 之后，以后每次升版本都会自动失效，不再需要手动硬刷。

## v2.7：敌方发育（不再哐哐派兵）

**旧实现的问题**：`tryAiSpawn()` 每 `aiInterval` 秒扣一次金币造兵，`aiGold` 几乎全部来自 `aiGoldPerSec=7` 的凭空被动收入；`pool` 明确排除 miner，AI 从不造矿工、从不升级、也没有独立 Armory。观感就是对面无视经济规律一直派兵。

**现在的模型**——AI 与玩家共用同一套经济，只多一份独立的成长状态：

| 环节 | 实现 |
| --- | --- |
| 真实经济 | AI 训练矿工 → `chooseMineIndex(state, 1, ...)` 只挑自家半场 3 个矿点 → `tickMiner()` 往返 → 交付写 `state.aiGold`，按 `diff.aiIncomeMul` 放大 |
| 独立科技 | `state.aiUpgrades` 与玩家 `state.upgrades` 完全隔离；按 `ai.upgradePlan`（先 miner 背包/镐，再 sword/archer 攻防…）顺序购买，扣 `upgrade.cost`，`aiUpgradeTimer` 节流 |
| 决策状态机 | 每 `decisionIntervalSec=1.3` 一个 tick，**只做一个动作**，优先级 `补矿工 → 升科技 → 出兵`；矿工数按 `rampSec` 从 `minerTargetStart=3` 涨到 `minerTargetEnd=6` |
| 预算约束 | 补矿工留 `minerReserveGold`，升级留 `upgradeReserveGold`，出兵留 `militaryReserveGold`；人口上限含训练队列，矿工被打掉会自动补回来 |
| 训练队列 | AI 下单真扣钱、走同一个 `state.training`，训练时长 `trainSec * diff.aiSpawnMul`；难度越高训练越快，而不是出兵间隔越短 |
| 升级快照 | `aiEnqueue()` 传 `{ [type]: { ...state.aiUpgrades[type] } }`，`bonusFor()` 真的读到，后续单位属性随科技成长 |

`economy.aiGoldPerSec` 从 **7 降到 1.5**（低于一趟矿 `goldPerTrip=6`），`aiStartGold` 提到 120 与玩家对称。被动收入只剩零头，AI 的钱是矿工一趟趟跑出来的。

**120 秒推演**（`node` 纯逻辑，seed=7，我方雕像血量顶住）：

```
 t(s) | 矿工 | 战斗兵 | 敌方金币 | 运矿趟 | 科技 | 累计采矿       (normal)
   15 |    3 |      1 |       75 |      7 |    0 |    42
   45 |    4 |      5 |       67 |     39 |    0 |   234
   75 |    5 |      8 |       88 |     77 |    2 |   466
  105 |    6 |      9 |      127 |    120 |    3 |   734

insane 同期：战斗兵 13、科技 5 级、累计采矿 1316 金
```

前 15 秒对面在铺经济，战斗兵个位数；金币全程在 40–130 之间波动（钱都花掉了，不是凭空堆积）；难度差距来自 `aiIncomeMul`（矿工每趟收益 ×1.7）与 `aiSpawnMul`（训练 ×0.6），而不是刷兵频率。

**顺手修的真 bug**：`spawnPlayer()` 原来传的快照是 `{ ...state.upgrades[type] }` 单层对象，而 `bonusFor()` 取 `upgrades?.[type]` —— 玩家花 80 金买的攻防速**一直静默失效**。现在统一成 `{ [type]: levels }`，并加了回归测试断言训练出的剑士 `dmg === 14 × 1.15`。

**UI 可见**：顶栏新增 `敌方发育 矿工 3/3 · 科技 2 · 金 75`（窄屏隐藏），结算面板追加敌方矿工数/运矿趟数/科技级数/累计采矿。`aiGrowthInfo(state)` 是 UI、结算与烟测共用的唯一口径。

## v2.6：矢量收口（做减法，不是第三版画风）

结论很直接：**手写 Canvas 路径拼不过现成立绘，也不该去拼**。v2.3 的高饱和线稿、v2.4 的暗色剪影都翻车了，再画第三版只是换一种难看。所以这轮把矢量从「美术」降级为「信息」：

| 删除的手绘实体 | 换成 |
| --- | --- |
| 晶洞岩块 + 四块晶面 + 三根棱柱晶簇 + 岩面刻线的矿堆 | 单个金色菱形 + 单条高光面 + 一条地面基线 + 脉动光晕；仍是双侧各 3 个、仍会呼吸/闪烁/环绕金尘 |
| 箭杆/箭羽/三角形箭头、六边形自旋石块、多层径向法球 | 统一「分段渐隐细线拖尾 + 末端光点」；三种类型只在线宽/长度/光点半径与是否带细环上区分 |
| 皮革背矿袋 + 袋内金块 | 与矿点同源的小菱形状态浮标 |

保留的矢量全部是功能性 HUD，谈不上丑、且任意分辨率都锐利：血条、挖掘进度环、攻击弧、堡区护罩虚线、地面投影、金币迸发与飘尘粒子、雕像裂纹与光晕、工具按钮的 2 个内联 SVG。素材缺失时的线稿替身也保留（那是降级路径，不是常态美术）。

`animation` 段 18/23 键仍被渲染层消费，相位约束、暂停冻结、`visualOffsets()` 全部不变。

**这一步不是「精美矢量」**，只是把实体观感先交回位图。矿点真正变成插画是在 v2.8 补的 `assets/goldmine.webp`（见上文），并同步更新了 `manifest.json` 与 `check-assets.mjs` 断言。

## v2.5：位图立绘回归

**来源**：从仓库历史（`aae35d74` / `13dc5933`）恢复原始素材，没有重新生成图片。它们是透明底白色火柴人 + 黑描边，造型统一、兵种辨识度靠武器，原本就比自绘矢量耐看。

**分工**：

| 层 | 内容 | 实现 |
| --- | --- | --- |
| 位图（美术） | 7 兵种立绘、双方雕像、战场背景、兵种栏/商店/升级图标 | `src/assets.js` 加载 → `drawImage()` / `<img class="unitBmp">` |
| 几何标记 | 双侧 6 个金色菱形矿点、投射物细线拖尾、背矿状态浮标 | `src/render.js`，v2.6 起只表达信息，不画实体 |
| 功能性 HUD | 血条、挖掘进度环、攻击弧、堡区护罩虚线、地面投影、金币迸发/飘尘粒子、雕像裂纹与光晕、2 个工具按钮 SVG | `src/render.js` / `src/icons.js` / 内联 SVG |

金矿、投射物、堡区本来就没有对应素材，且矿点形象与双侧多矿点是明确要求过的，所以用几何符号表达；但不再试图把它们画成插画。

**动画没有丢**：位图是静态的，但变换矩阵由模拟时间驱动——走路起伏与轻摆、呼吸缩放、攻击前倾与前冲、挖掘前俯、背矿晃动、受击抖动，叠加矢量挥击弧/进度环/拖尾/粒子。加载时一次性预生成三份派生画布（阵营染色 ×2、纯白闪白剪影 ×1），运行时只 `drawImage`，不做每帧 `ctx.filter`。

**加载链恢复**：`config.assets.softTimeoutSec=6` / `hardTimeoutSec=20` 两段式超时；`assets.team(key, team)` 用 `source-atop` 保留立绘明暗关系做阵营区分；`assets.flash(key)` 用 `source-in` 生成白色剪影；素材缺失或尚未到达时用线稿火柴人替身，**绝不隐形**。

**保留的工程约束**（v2.3 引入，回退美术时没有丢）：`render.js` 禁止 `performance.now()`、`Date.now()`、`Math.random()`、`ctx.filter`；相位只取 `state.elapsed` / `unit.walkPhase` / `unit.anim` / `projectile.age` / `state.fx`；`ui.sync()` 写 `body[data-phase]` 冻结 CSS 动画；`visualOffsets()` 在渲染层错开同位置单位而不改物理坐标；`animation` / `presentation` 仍集中在配置里。`check-assets.mjs` 静态守着这些，烟测直接比对暂停前后两次 `canvas.toDataURL()`。

> v2.4 曾把调色板换成暗色剪影并重画云/雕像/骨架，实拍后仍不理想；那段探索已整体回退，暗色 HUD 外壳保留下来配明亮战场背景。

## 对齐原版的机制（v2.2 起）

参考 2009 Stickpage / Crazy Jay 的 Stick War v1.2 及其 Wiki、后续 Legacy 的 Armory 设计：

| 原版机制 | 本实现 | 配置项 |
| --- | --- | --- |
| 单位需要训练时间，可再点一次取消 | `state.training` 队列 + `trainSec`，下单扣钱并快照升级，点队列条目全额退款；人口上限含排队单位 | `units.*.trainSec` |
| 三指令 Attack / Defend / Garrison | `setMode('attack'/'defend'/'garrison')`；驻堡全军回 `fortX()` 不再追击，输出交给城堡射手 | `layout.fortInsetRatio`、`match.fortArcher*` |
| Garrison 时城堡按比例放箭 | 每 `fortArcherPerUnits` 个堡内单位折算 1 名射手，堡内单位免疫伤害 | `match.fortArcherPerUnits` |
| 城堡每秒被动产金 | `economy.castleGoldPerSec` 叠加矿工收入，AI 侧按难度放大 | `economy.castleGoldPerSec` |
| 弓克剑、远程打不动巨人与雕像、矛士盾挡箭 | `combat.damageMatrix` 四个倍率 | `combat.damageMatrix` |
| 矿工 Armory：背包 / 镐 / 移速 | 矿工升级维度 `bag/pick/spd`，派生 `goldPerTrip`、`mineDuration`、`speed` | `economy.bagPerLevel`、`pickaxePerLevel` |
| 三档难度 | 放大矿工收益（`aiIncomeMul`）、缩短训练时长（`aiSpawnMul`）、增加敌方雕像血量（`enemyStatueMul`）；**不再缩短出兵间隔** | `match.difficulties` |
| 敌方也要采矿发育 | AI 训练矿工往返交付、独立 Armory 按计划升级、攒预算才出兵 | `ai.*`、`economy.aiGoldPerSec`、`state.aiUpgrades` |
| 双侧矿脉、矿工就近挖自家矿 | `layout.goldMines` 双侧各 3 点，按负载/距离分配 | `layout.goldMines` |

**刻意未实现**：单兵手动操控、战役地图/简报、Magikill 眩晕与召唤、Spearton 投矛、火/毒箭、存档、音效、AI 针对性反制。见「已知限制」。

## v1 评审里的问题，逐条收掉

| v1 的问题 | 处理 |
| --- | --- |
| 冷却/移速/概率按帧递减，刷新率决定难度 | 全量秒制（`px/s`、`attackIntervalSec`），`src/timing.js` 固定 1/60 累加器，掉帧最多补 0.1s |
| 矿工是「带贴图的随机数发生器」，站着刷钱 | 真实状态机 `toMine → mining → toHome → 交付`，阶段切换结转剩余 `dt` |
| 矿工 `baseCd:0` 每帧攻击，把敌人闪白永久重置 | 矿工不进战斗分支；受击闪白按秒衰减，改为预生成的白色剪影叠加 |
| 雕像画在 x=74、伤害判定在 160 | 绘制与判定共用 `statueInset + statueHitRadius` |
| 提示文字被下一帧 `updateUI()` 覆盖 | 独立 `#toast` |
| 按钮只是置灰、仍能点 | 真 `btn.disabled` + `:disabled` 样式 |
| 重开不清升级等级 | `resetMatch()` 重建整份状态（保留 `w/h/difficulty`） |
| AI 无人口上限、只出 3 种兵 | 金币与人口双约束，6 兵种按权重抽取、随时间解锁 |
| 远程兵只有一道弧光 | 真实投射物，有飞行时间、追踪、目标死亡后落空，带自旋与拖尾 |
| 20 个单位叠在一个像素 | 同队轻推分离 + 渲染层 `visualOffsets()` 稳定错开 |
| `draw()` 排序改写物理数组 | 渲染用 `[...units].sort()` 副本 |
| 每帧 `ctx.filter` 闪白 | 加载时预生成白色剪影，运行时只 `drawImage` |
| 素材缺失文案说替代绘制、实际隐形 | 两段式超时 + `onerror` 真降级线稿替身，弱网晚到补登记 |
| 无超时、无脏检查 | 软/硬两段超时、UI 数值脏检查、支持 DPR |
| manifest 有 `png/jpg` 幽灵字段、体积口径不准 | `check-assets.mjs` 逐项校验字节数并解析 WebP 头校验画布尺寸：**289404 字节 / 282.6 KiB / 10 文件，10/10 通过** |
| 全内联 onclick、字符串拼 handler | 统一 `addEventListener`，兵种栏/商店/升级由 `icons.js` 生成 `<img>`，工具按钮用内联 SVG |
| 无配置、无测试、无 CI | 单一配置源 + **82 个单测** + GitHub Actions |
| 金币卡死、难度陡峭 | 宝石免费无限领 + `canAfford/pay` 统一抵扣 + 三档倍率与波次整体放缓、起始金币 200 |
| 全战场只有一个黄圈当金矿 | 双侧各 3 个位图金矿插画，只挖自家半场；矿点远离雕像、背矿减速，一趟往返约 12 秒 |
| 手机把整场压进一屏、影子发虚 | 固定 1600×800 逻辑世界 + 可拖动/跟随镜头 + DPR 画布 + 双层钳制柔影 |
| 面板/浮层没有关闭叉号 | 商店、升级、暂停、结算四层都有 `×`，外加 `Esc` 分级后退、点遮罩、底部关闭按钮 |

## 目录结构

```
index.html                    页面骨架
styles/main.css               暗色 HUD、面板层级 z-index 约定、位图/SVG 动画与暂停冻结
assets/                       10 张 WebP + manifest.json
config/game.json              ★ 唯一配置源（含 gems 宝石、world 视口、ai 波次/反制、assets 超时、animation、presentation）
config/README.md              字段含义
src/config.generated.js       生成物，必须提交
src/config.js                 配置访问、ASSET_KEYS / 带版本指纹的 assetPath、升级维度与倍率派生
src/assets.js                 位图加载、两段式超时 + 单次重试、阵营染色与闪白剪影预生成
src/icons.js                  兵种位图 <img> 与工具按钮内联 SVG
src/timing.js                 固定步长累加器
src/rng.js                    可注入的确定性随机源
src/state.js                  纯状态 / 单位工厂 / 训练队列 / 玩家+敌方双 Armory / AI 决策计时器 / fx
src/simulation.js             纯逻辑：step / 训练 / AI 发育决策 / 指令 / 城堡射手 / 克制 / 升级
src/render.js                 位图立绘 + 金矿插画 + HUD/粒子 + 镜头视口（resize/panBy/panStep/setFollow）
src/ui.js                     DOM 绑定、面板、队列条、快捷键、镜头按钮与位图徽标
src/main.js                   装配、主循环、拖动平移与镜头动作
scripts/build-config.mjs      配置生成 + 结构校验
scripts/stamp-cache.mjs       给 ESM 入口与所有相对 import 加 ?v=<version> 缓存指纹（幂等）
scripts/check-assets.mjs      素材清单 / WebP 头 / 渲染确定性 / 缓存指纹静态自检
scripts/check-navigation.mjs  退出通道静态自检
scripts/smoke-pages.mjs       Playwright 可达性烟测（76 项）
scripts/serve.mjs             零依赖静态服务
tests/                         node:test，82 个用例（8 个文件；含 world-waves.test.mjs / gems.test.mjs）
docs/ARCHITECTURE.md          分层、状态机、时间约定、扩展点
.github/workflows/ci.yml       CI
```

分层原则：`state.js` 与 `simulation.js` 不引用任何 DOM，可在 Node 里整局推演；渲染与 UI 只读状态。

## 改数值

```bash
vim config/game.json
npm run build              # 重新生成 src/config.generated.js
npm run smoke              # 可选：本机 Chrome 跑 76 项可达性断言
npm run check              # 生成 + 82 单测 + 素材/确定性静态自检
```

`src/config.generated.js` 与所有带 `?v=` 指纹的 `src/*.js` / `index.html` 必须一起提交（Pages 直出静态文件）。**改 `meta.version` 后不跑 `npm run build` 会让线上继续吃旧缓存**——CI 用 `git diff --exit-code -- src/config.generated.js index.html src/` 守住一致性。加新兵种要同时补 `assets/<key>.webp` 与 `assets/manifest.json`，UI 与渲染会自动长出；改动画节奏只动 `animation` 段，改配色只动 `presentation` 段。

## 操作

| 操作 | 键 |
| --- | --- |
| 出兵 7 兵种 | `1`–`7`，或点底部图标 / 商店卡片 |
| 进攻 / 固守 / 驻堡 | `A` / `D` / `G`（按钮有 `aria-pressed` 选中态） |
| 取消训练并退款 | 点顶部训练队列条目 |
| 暂停 / 继续 | `P` |
| 分级后退 | `Esc`：面板 → 暂停 → 结算 → 主菜单 |
| 开始对局 | `Enter` |

## 时间一致性

三处离散事件都做了 **dt 结转**，这是 60/120Hz 严格一致的前提：

1. `moveToward(..., snap=true)` 到达固定目标点时吸附到精确坐标
2. `tickMiner()` 阶段切换时把剩余 `dt` 交给下一阶段
3. `tickTraining()` 只把 `elapsed - due` 交给新单位，不白拿一个完整 `dt`

`step()` 用 `freshTime: Map<unitId, dt>` 把结转时间同时作用于计时器递减与行为 tick。视觉反馈 `state.fx` 同样按秒递减，暂停时随 `step` 一起冻结。

## 页面可达性

「可达」= **每个能进的层都能出、每份资源都能取到、暂停时画面真的静止**：

```bash
npm run smoke     # 需要本机 Chrome；自动起静态服务，76 项断言
```

覆盖：首页 200、10 张 WebP 全部 200、素材缺失数 0、兵种栏/商店/升级 7+7+7 张位图已解码、工具按钮 2 个内联 SVG、Canvas 非空绘制、6 个矿点、难度三档、**逻辑世界 1600×800 / 窄屏只显示一段 / 镜头可平移 / Canvas 按 DPR 分配 / 矿点不贴回营点 / 金矿用位图插画 / `位图 10/10` 徽标 / 跟随开关 / 宽屏 resize 不改世界尺寸**、训练队列下单/退款、**顶栏宝石 / 连点 6 次免费领取全生效 / 金币清零后按钮仍可点 / `paid` 实扣构成 / 取消原路退回**、驻堡切换、**敌方矿工补到目标数 / 只在自家半场 / 真实交付产生收入 / 顶栏发育指标 / 不污染玩家 Armory / 自己花钱买科技**、商店与升级的全部退出通道（`×`/`Esc`/遮罩/底部按钮）、面板不叠层、矿工升级维度、**暂停前后两次 `toDataURL()` 完全一致且 CSS 动画冻结**、恢复后画面继续动画、结算统计与返回、菜单按钮。

CI 里跑 `scripts/check-navigation.mjs` 与 `scripts/check-assets.mjs` 做静态兜底（不需要浏览器）。

## GitHub Pages

Pages 配置为 **legacy / `main` 分支 / 根目录**，push 到 `main` 自动发布，无需部署工作流。根目录 `.nojekyll` 避免 Jekyll 过滤，全部资源相对路径适配 `/stick-war/` 前缀。

## 已知限制

- 升级在**训练下单时快照**，已出场单位不回溯加成
- 没有单兵手动操控、战役地图/简报、存档、音效、多人
- Magikill 眩晕与召唤、Spearton 投矛、箭矢属性升级（火/毒/倒刺）尚未实现
- AI 会按玩家兵种调权重、按波次进攻，但**不做目标选择、集火与撤退路径规划**
- 仓库还没有 LICENSE
- 单位只有一维 x 轴，没有纵深、碰撞体积与寻路
- 位图立绘是静态单帧，动画靠变换矩阵与矢量特效叠加，没有逐帧序列帧
- 镜头在极窄屏（<360px）下左右可平移范围变小，但未做双指缩放
- 首次从「无指纹的旧 HTML」升级仍需硬刷新一次（见 v2.7.1）

以上留作后续迭代入口。
