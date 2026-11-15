# 架构说明

> 面向「要接着改这份代码的人」。读完这一页就能知道该动哪个文件。

## 分层

```
输入（点击 / 键盘 / 难度下拉）
   │
   ▼
src/ui.js ────── 只写状态：下单训练 / 取消 / 升级 / 三指令 / 暂停
   │
   ├──▶ src/icons.js      兵种 <img> 位图 / 工具按钮内联 SVG
   ▼
src/state.js            纯数据：state / 单位工厂 / 训练队列 / fx / 重置
   │
   ▼
src/simulation.js       纯逻辑：step(state, dt, rng) → events
   │                     ↑ 不引用 DOM、canvas、window，可在 Node 里整局推演
   ├──────────────┐
   ▼              ▼
src/render.js    src/ui.js
 位图立绘 + 矢量   数值 / 按钮 / 面板 / 队列条 / toast 同步
 特效与全部动画
   ▲
   │
src/assets.js    10 张 WebP 加载 / 两段式超时 / 染色与闪白预生成
```

`src/main.js` 只做装配：创建 state / rng / assets / renderer / ui，用 `src/timing.js` 的固定步长累加器驱动 `step`，每帧调一次 `renderer.draw(state, assets)` 和 `ui.sync()`。素材加载完成后才 `enableStart()`；软超时（6s）先放行开战，硬超时（20s）才把没到的图记入缺失。

**硬性边界**：`state.js` 与 `simulation.js` 不得 import 任何浏览器全局。这是 68 个单元测试能在 `node --test` 里跑起来的前提，也是后续换渲染层时逻辑不用重写的前提。

## 渲染：位图立绘 + 矢量特效（v2.5）

v2.3/v2.4 两次自绘矢量观感不达标，v2.5 从仓库历史恢复原始 9 张 WebP 并回退美术方案（v2.8 再补第 10 张 `goldmine.webp` 并增强全部立绘）。现在：

| 文件 | 职责 |
| --- | --- |
| `src/assets.js` | 加载 10 张 WebP；两段式超时 + `onerror` 单次重试（换 URL 绕开被缓存的失败响应）；加载时一次性生成 `team:0` / `team:1` 染色版与纯白 `flash` 剪影 |
| `src/render.js` | `drawImage` 画单位/雕像/背景/**金矿插画**；Canvas 只画**功能性 HUD 与粒子**：细线拖尾、血条、进度环、攻击弧、堡区护罩、金尘、金币迸发。另负责固定世界 → 屏幕的镜头变换（`resize` / `panBy` / `panStep` / `setFollow`） |
| `src/icons.js` | 兵种栏/商店/升级用 `<img class="unitBmp">`；工具按钮仍是内联 SVG |

v2.6 把矢量从「美术」降级为「信息」：删掉岩块晶簇矿堆、箭杆/箭头/石块/法球造型、皮革背矿袋，只留单个金色菱形矿标、分段细线拖尾、同源菱形背矿浮标，以及血条/进度环/攻击弧/护罩虚线/粒子等 HUD。理由是 v2.3、v2.4 两次手写路径都没达到「够精美」；不要在 `render.js` 里重新堆多边形假装插画，需要精美矿点形象应补一张同风格 WebP。

位图是静态单帧，**动画作用在变换矩阵与矢量特效上**：走路起伏与轻摆、呼吸缩放、攻击前倾与前冲、挖掘前俯、背矿晃动、受击抖动，叠加挥击弧 / 进度环 / 拖尾 / 脉冲光晕 / 确定性飘尘。素材缺失或尚未到达时 `drawStickFigure()` 画线稿替身，不会隐形（降级路径，不是常态美术）。

`visualOffsets()` 在渲染层按 id 错开同队同位置的单位（典型：一个矿点上的多个矿工），**不写回 `state.units[].x`**，判定与 dt 一致性完全不受影响。

**动画相位约束**（`scripts/check-assets.mjs` 静态守着）：

- 只允许 `state.elapsed`、`unit.walkPhase`、`unit.anim`、`projectile.age`、`state.fx`
- 禁止 `performance.now()`、`Date.now()`、`Math.random()`、`ctx.filter`
- `state.fx`（`homeShake` / `enemyShake` / `goldBurst`）由 `simulation.step()` 按秒递减，渲染层只读
- `unit.walkPhase` 只在单位真正移动时按 `animation.walkHz` 累加；静止单位只保留呼吸
- `ui.sync()` 把 `state.phase` 写入 `body[data-phase]`，CSS 动画（含 `.unitBmp` 浮动）在非 `playing` 时统一 `animation-play-state: paused`

因此**暂停时 Canvas 逐帧完全一致**。烟测直接比对暂停前后两次 `canvas.toDataURL()`，并断言恢复后画面继续变化。所有动画参数集中在 `config/game.json` 的 `animation` 段，改节奏不碰绘制代码；自检要求至少 12 个键被渲染层实际消费（当前 18/23）。

## 时间与确定性

| 概念 | 约定 |
| --- | --- |
| 逻辑步长 | `match.fixedStep = 1/60` 秒，由 `createFixedStepDriver` 产出 |
| 渲染帧率 | 任意；一帧跑 0~N 个逻辑步，刷新率不改变游戏速度 |
| 掉帧上限 | `match.maxFrameDelta = 0.1` 秒，单次最多补 6 步 |
| 速度 / 冷却 / 计时器 | 一律 `px/s` / 秒；没有「每帧减 1」 |
| 随机数 | `rng.js` 的 mulberry32，可注入 seed；逻辑与渲染均不调 `Math.random` |
| 装饰性伪随机 | `render.js` 的 `hash(n)` 用确定性 `sin` 散列，飘尘/矿石/金币粒子位置可复现 |

三处离散事件都做 **dt 结转**，这是 60/120Hz 严格一致的前提：

1. `moveToward(..., snap=true)` 到达固定目标点时吸附到精确坐标
2. `tickMiner()` 阶段切换把剩余 `dt` 交给下一阶段
3. `tickTraining()` 返回 `{ unit, available }`，`available = min(dt, elapsed - due)`，新单位不白拿一个完整 `dt`

`step()` 用 `freshTime: Map<unitId, dt>` 把结转时间同时作用于计时器递减与行为 tick。训练完成判定容差 `1e-6`（`elapsed` 浮点累加误差约 `1e-11`）。

## 状态机

**对局**：`menu → playing ⇄ paused → won | lost`。`step()` 在 `phase !== 'playing'` 时直接返回空事件，终局只触发一次 `end`；`resetMatch()` 重建整份状态（含升级、训练队列、统计、fx），但**保留 `w/h/difficulty`**。

**矿工**：`toMine → mining → toHome → 交付 → toMine`。`mineIndex` 由 `chooseMineIndex()` 按「同阵营 + 负载最少 + 距离最近」分配，交付后清空。`goldPerTrip` / `mineDuration` / `speed` 在 `spawnUnit()` 时由 Armory 等级派生固化。

**训练队列**：`spawnPlayer()` 立即扣钱 → `enqueue({ due: elapsed + trainSec, upgrades: 快照 })` → `tickTraining()` 到点 `spawnUnit()` → `cancelTraining()` 全额退款。人口上限 = `countTeam + pendingTeam`。升级快照必须是 `{ [type]: levels }`（`bonusFor()` 取 `upgrades?.[type]`），只传单层 level 对象会让升级静默失效——v2.7 修掉了这个老 bug，玩家与 AI 两侧统一用 `aiEnqueue()` / `spawnPlayer()` 的同一结构。

**AI 发育决策（v2.7）**：`step()` 里 `aiDecisionTimer` 每 `decisionIntervalSec` 触发一次 `aiDecide()`，一个 tick 只做一个动作，优先级 `补矿工 → 升科技 → 出兵`。`aiMinerCount()` 把训练队列里的矿工也算进去；`aiMinerTarget()` 按 `elapsed / rampSec` 从 3 涨到 6；`tryAiUpgrade()` 按 `ai.upgradePlan` 顺序扣 `upgrade.cost` 并写 `state.aiUpgrades`（与玩家 `state.upgrades` 完全隔离）；`aiEnqueue()` 真扣 `aiGold`、按 `diff.aiSpawnMul` 缩放训练时长、快照 AI 自己的 Armory。敌方矿工走与玩家相同的 `chooseMineIndex(state, 1, ...)` → `tickMiner()` → 交付写 `aiGold`（按 `diff.aiIncomeMul` 放大）。旧的 `tryAiSpawn()` 定时器刷兵已整体删除；`economy.aiGoldPerSec` 从 7 降到 1.5，钱不再是凭空来的。`aiGrowthInfo(state)` 是 UI / 结算 / 烟测的唯一口径。

**指令**：`attack` 推到敌方判定线 / `defend` 守 `w*defendLineRatio` / `garrison` 全军回 `fortX()`。驻堡是 `step()` 里的短路分支：跳过 `tickFighter`/`tickMiner`，只 `moveToward(fortX())` 并置 `inFort`；`applyDamage()` 对 `inFort` 目标直接返回，输出交给 `tickFortArrows()`。不做短路的话 `nearestEnemy` 会把单位自己带出安全区。

**视觉反馈**：`state.fx` 三个计时器在 `step()` 开头按秒递减，雕像受击 / 金币交付时置位；渲染层据此画抖动、闪白与金币迸发。放在逻辑层是为了让暂停与固定步长一起冻结它。

## 伤害与坐标

`applyDamage()` 是唯一的单位伤害入口，`damageMultiplier()` 从 `combat.damageMatrix` 取四个倍率。拆雕像走 `tickFighter()` 的独立分支，额外乘 `rangedVsStatue`。加克制关系只改这两个函数。

`layout.statueInset + statueHitRadius` 是**唯一**的雕像判定线。矿点由 `layout.goldMines[].xRatio * w` 生成（`minePositions()` 是唯一口径）。`fortX() = statueInset * fortInsetRatio` 只在 `simulation.js` 定义一次，渲染层用同一表达式算堡区边界。资源全部相对路径，适配 `/stick-war/` 前缀。

## 导航与退出通道

`ui.js` 里只有两个面板状态入口：`openPanel(which)`（互斥打开）和 `closePanels()`（同时收起遮罩）。**不要在别处直接改 `panel.hidden`**。

层级（低 → 高）：`canvas/背景 0` → `panelBackdrop 140` → `面板 150` → `controlBtns 160` → `queueStrip 165` → `topBar / bottomBar 170` → `pauseOverlay 180` → `mainMenu 200` → `toast 300`。控制条放在战场右上角（`top:52px`），避免与面板底部关闭按钮抢点击区域。

每个能打开的层都有 `×`；`Esc` 分级后退 `面板 → 暂停 → 结算 → 主菜单`；点遮罩、底部关闭按钮、浮层空白处同样能退。`check-navigation.mjs` 静态守结构，`smoke-pages.mjs` 跑 69 项交互断言。

## 配置怎么做到的

```
config/game.json  ──scripts/build-config.mjs──▶  src/config.generated.js  ──▶ src/config.js
   （人改）         （生成 + 结构校验）             （提交，勿手改）            （派生与校验）
```

运行时不 `fetch` JSON、不跑构建。`src/config.js` 导出 `CONFIG`、`UNIT_ORDER`、`DIFFICULTIES`、`ASSET_KEYS`、`assetPath()`、`upgradeStats()`（矿工 Armory 维度不同）、`bonusFor()`、`freshUpgrades()`。

## 扩展点

- **加兵种**：`config/game.json` 加一项（必填 `trainSec`）+ `assets/<key>.webp` + `manifest.json` 登记 → `npm run check`。兵种栏/商店/升级/训练队列/AI 抽取池自动生成。
- **加动画**：`animation` 段加参数，在 `render.js` 用 `A.<key>` 消费；自检会要求参数为正且被使用。不要引入墙钟时间。
- **换配色**：只改 `presentation`，矢量特效、血条、UI 与位图阵营染色同时生效。
- **换立绘**：替换 WebP 后同步更新 `manifest.json` 的 `w/h/webp`，`check-assets.mjs` 会校验字节数与 WebP 头。
- **加投射物类型**：`makeProjectile()` / `drawProjectile()`；build 校验 `projectile` 取值。
- **换 AI 策略**：只改 `aiDecide()` 的优先级与 `ai.upgradePlan`；难度倍率在 `match.difficulties`。当前 AI 不做针对性反制。
- **加音效 / 存档**：消费 `step()` 的 `events`，不要在渲染层偷偷改状态。
- **换渲染层**：`renderer` 只依赖 `state` 与 `assets` 两个只读对象。

## 测试策略

| 文件 | 覆盖 |
| --- | --- |
| `tests/timing.test.mjs` | 30/60/144Hz 步数一致、掉帧 clamp、reset |
| `tests/simulation.test.mjs` | dt 线性一致、矿工经济与 dt 结转、双侧矿点、胜负状态机、AI 约束、雕像判定线、投射物、统计、升级与重开 |
| `tests/config.test.mjs` | 生成物无漂移、字段合法、双侧矿点、**assets 两段式超时 / animation 段 / 调色板** |
| `tests/mechanics.test.mjs` | 训练队列/退款/升级快照/人口、三指令与驻堡、城堡射手、克制倍率、被动收入、矿工 Armory、难度 |
| `tests/vector.test.mjs` | 位图图标引用、工具 SVG 自包含、无墙钟相位、步态只在移动时累加、fx 递减与暂停冻结、驻堡免疫 |
| `tests/ai-growth.test.mjs` | 开局先补矿工、矿工目标与人口上限、真实运矿交付与自家半场、难度收益倍率、独立 Armory 与升级快照生效、60/120Hz 一致、重开清空 |
| `scripts/check-assets.mjs` | 10 张 WebP 存在 / 字节数 / WebP 头尺寸、素材键与配置一致、零墙钟/随机/filter、animation 被真实消费、Pages 入口 |
| `tests/world-waves.test.mjs` | 固定世界与窄屏视口、矿距/中线、负重减速、克制权重与饱和、波次阶段流转/波容/帧率一致/重开 |
| `scripts/smoke-pages.mjs` | 69 项可达性（含 10 张 WebP 全 200、素材缺失数 0、7+7+7 位图解码、Canvas 非空、**窄屏视口/DPR/矿距/金矿位图/`位图 10/10`/镜头按钮/宽屏 resize**、暂停画面静止 / 恢复后继续动画） |

CI 另做全模块语法检查、配置漂移、导航静态自检、Pages 入口（含 `test -f assets/manifest.json` 与 `assets/*.webp` 数量 = 10）。Playwright 烟测需要本机 Chrome，CI 不跑（用静态自检兜底）。

## 固定世界与镜头（v2.8）

**逻辑世界恒为 `world.width × world.height` = 1600×800**，与 `battlefield.webp` 1:1。`createState()` 默认就是这个尺寸；`renderer.resize()` 绝不改写 `state.w/h`，只重算 `state.view`：

```
scale = clamp(cssH / 800, minScale, maxScale)
viewW = cssW / scale
maxX  = max(0, 1600 - viewW)
setTransform(scale*dpr, 0, 0, scale*dpr, -view.x*scale*dpr, offsetY*dpr)
```

所有 `drawXxx()` 继续用世界坐标，镜头只是变换矩阵，物理与判定完全不变。`view.x` 由三种方式驱动：canvas 上 pointer 拖动（`panBy` 把 CSS 像素换算回世界像素）、`◀/▶` 按钮（`panStep` 步进 0.35 个视口宽）、跟随开关（默认取我方最前锋 `front - viewW*followAnchor`，按 `state.elapsed` 差值做 `1-exp(-k*dt)` 指数插值）。拖动与步进都会关掉跟随；`setFollow(true)` 会把 `lastElapsed` 置空，避免把「关闭期间」的位移一次性补回来。暂停时 `elapsed` 不推进，镜头与所有动画一起冻结。

`dpr` 上限 3，`imageSmoothingQuality='high'`；`offsetY` 处理超宽屏时世界高度小于视口高度的垂直居中。单位地面投影半径钳制在 `[0.09h, 0.26h]` 并画两层，避免 bob 为负时算出反向椭圆。

**运矿距离**：`goldMines` 的 `xRatio` 外移到 `0.26…0.42` / `0.58…0.74`，`build-config.mjs` 静态拒绝「距回营点 < `world.width * economy.minMineHomeDistanceRatio`」或越过中线的配置。`tickMiner()` 把 `u.speed` 换成局部 `speed = u.speed * (carry>0 ? carrySpeedMul : 1)`，背矿这一段真的会慢下来。

**素材可靠性**：`assetPath()` 产出 `./assets/<key>.webp?v=<meta.version>`，素材 URL 与 ESM 依赖图共用同一个版本指纹；`assets.js` 的 `onerror` 会换 `&retry=N` 重试一次，软/硬超时在整次 `loadOne` 生命周期里只挂一次（重试不重置），硬超时后才到达的图片仍会补登记。顶栏 `位图 N/10` 徽标由 `refreshLoadTip()` 同步。

**AI 波次**：`state.aiPhase` 走 `build → muster → assault → regroup`，`updateAiPhase()` 在每个决策 tick 开头流转，`aiDecide()` 据此决定这一个动作（补矿工 / 升科技 / 出兵）。只有 `muster` 会出兵，攒到 `waveSize`（4 起，每波 +1，上限 9）就停手；`assault` 阶段 `aiGoalLine()` 才把目标设成玩家雕像，其余阶段守 `1 - defendLineRatio`。`aiCounterWeight()` 按玩家兵种构成抬权重，`counterSaturation` 做饱和。全部状态在 `resetMatch()` 里清空。

## 版本化缓存（v2.7.1）

`index.html` 是唯一携带指纹的入口：`npm run build` 里的 `scripts/stamp-cache.mjs` 把 `meta.version` 写成 `?v=<version>`，追加到 module script、stylesheet href 以及 `src/*.js` 的**每一条**相对 `.js` import。裸 URL 的 ESM 子模块会被浏览器按 URL 强缓存，只改文件内容不改 URL 会导致「HTML 是新的、模块是旧的」——版本号恰好来自 `config.generated.js`，所以最容易观察成「线上还停在旧版本」；新模块 import 到旧模块缺失的导出时则直接白屏。

约束：

- 指纹脚本**幂等**，先剥旧 `?v=` 再追加；生成物（`index.html`、`src/*.js`、`src/config.generated.js`）全部提交。
- `check-assets.mjs` 断言 HTML 入口/CSS 与 19 条 src import 的指纹都等于 `CONFIG.meta.version`；CI 用 `git diff --exit-code` 保证提交的是 stamp 后的文件。
- Node 对 `file:` URL 的 search 参数只用于模块缓存键、路径解析取 pathname，所以 `node --test` 与浏览器都能加载；`serve.mjs` 用 `URL.pathname` 忽略 query。
- **不要手改带 `?v=` 的 import**，也不要给 `tests/` 或 `scripts/` 的 import 加指纹（它们只在 Node 里跑）。改版本号就跑 `npm run build`。
- 首次从旧版 HTML 升级的用户仍需硬刷新一次：缓存的旧 HTML 里没有指纹，普通刷新不会重新拉它。

## 为什么不引入打包器

仓库只有原生 ESM + 静态资源，Pages 从 `main` 分支根目录直出（`build_type: legacy`）。加 Vite / npm 依赖会让「推 main 即上线」变成「先构建再传 artifact」。代价是：**不能 `file://` 双击打开**，本地必须起静态服务器（`npm run serve`）。
