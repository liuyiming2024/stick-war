# 架构说明

> 面向「要接着改这份代码的人」。读完这一页就能知道该动哪个文件。

## 分层

```
输入（点击 / 键盘 / 难度下拉）
   │
   ▼
src/ui.js ────── 只写状态：下单训练 / 取消 / 升级 / 三指令 / 暂停
   │
   ▼
src/state.js            纯数据：state / 单位工厂 / 训练队列 / 重置
   │
   ▼
src/simulation.js       纯逻辑：step(state, dt, rng) → events
   │                     ↑ 不引用 DOM、canvas、window，可在 Node 里整局推演
   ├──────────────┐
   ▼              ▼
src/render.js    src/ui.js
 Canvas 绘制      数值 / 按钮 / 面板 / 队列条 / toast 同步
   ▲
   │
src/figure.js    矢量骨骼角色（只吃数字、不读状态）
src/assets.js    场地素材、超时降级
```

`src/main.js` 只做装配：创建 state / rng / assets / renderer / ui，用 `src/timing.js` 的固定步长累加器驱动 `step`，每帧调一次 `renderer.draw` 和 `ui.sync`。

**硬性边界**：`state.js` 与 `simulation.js` 不得 import 任何浏览器全局。这是 43 个单元测试能在 `node --test` 里跑起来的前提，也是后续换渲染层（比如换 WebGL）时逻辑不用重写的前提。

## 时间与确定性

| 概念 | 约定 |
| --- | --- |
| 逻辑步长 | `match.fixedStep = 1/60` 秒，由 `createFixedStepDriver` 产出 |
| 渲染帧率 | 任意；一帧里跑 0~N 个逻辑步，刷新率不改变游戏速度 |
| 掉帧上限 | `match.maxFrameDelta = 0.1` 秒，单次最多补 6 步，避免死亡螺旋 |
| 速度 / 冷却 / 计时器 | 一律 `px/s` / 秒；没有「每帧减 1」 |
| 随机数 | `rng.js` 的 mulberry32，可注入 seed；逻辑层不直接调 `Math.random` |

三处离散事件都做了 **dt 结转**，这是 60/120Hz 严格一致的前提：

1. `moveToward(..., snap=true)` 到达固定目标点时吸附到精确坐标，不留 0.x 像素残差
2. `tickMiner()` 阶段切换时把剩余 `dt` 交给下一阶段（挖掘完成/交付落在步中间，剩下的时间继续行走）
3. `tickTraining()` 返回 `{ unit, available }`，`available = min(dt, elapsed - due)`；新单位只消费从 `due` 到本步结束的时间，不白拿一个完整 `dt`

`step()` 用 `freshTime: Map<unitId, dt>` 把结转时间同时作用于计时器递减与行为 tick。训练完成判定容差取 `1e-6`（`elapsed` 浮点累加误差约 `1e-11`，过窄会跨步漂移）。

## 状态机

**对局**：`menu → playing ⇄ paused → won | lost`。`step()` 在 `phase !== 'playing'` 时直接返回空事件，终局只触发一次 `end` 事件；`resetMatch()` 重建整份状态（含升级、训练队列、统计），但**保留 `w/h/difficulty`**。

**矿工**：`toMine → mining → toHome → 交付金币 → toMine`。矿工 `kind='miner'`，不进战斗分支。`mineIndex` 由 `chooseMineIndex()` 按「同阵营 + 负载最少 + 距离最近」分配，交付后清空。`goldPerTrip` / `mineDuration` / `speed` 在 `spawnUnit()` 时由 Armory 等级派生并固化为单位字段。

**训练队列**：`spawnPlayer()` 立即扣钱 → `enqueue({ due: elapsed + trainSec, upgrades: 快照 })` → `tickTraining()` 到点 `spawnUnit()` → `cancelTraining()` 全额退款。人口上限 = `countTeam + pendingTeam`。升级快照是浅拷贝，`bonusFor()` 在生成单位时读它，排队期间再升级不影响该单位。

**指令**：`attack` 推到敌方判定线 / `defend` 守 `w*defendLineRatio` / `garrison` 全军回 `fortX()`。驻堡是 `step()` 里的短路分支：跳过 `tickFighter`/`tickMiner`，只 `moveToward(fortX())` 并置 `inFort`；否则单位会因 `nearestEnemy` 自己走出安全区，驻堡就失去意义。`applyDamage()` 对 `inFort` 目标直接返回，输出交给 `tickFortArrows()`。

## 伤害与坐标

`applyDamage()` 是唯一的单位伤害入口，`damageMultiplier()` 从 `combat.damageMatrix` 取四个倍率（弓克剑、投射物打矛士/巨人减半）。拆雕像走 `tickFighter()` 的独立分支，额外乘 `rangedVsStatue`。加新的克制关系只改这两个函数，不要在渲染层补刀。

`layout.statueInset + statueHitRadius` 是**唯一**的雕像判定线，绘制血条、脚下椭圆、拆雕像、矿工交付点全部读它。矿点由 `layout.goldMines[].xRatio * w` 生成（`minePositions()` 是唯一口径）。`fortX() = statueInset * fortInsetRatio` 只在 `simulation.js` 定义一次，渲染层用同一表达式算堡区边界。所有资源用相对路径，适配 `/stick-war/` 前缀与本地根路径。

## 导航与退出通道

`ui.js` 里只有两个面板状态入口：`openPanel(which)`（互斥打开，顺手关掉另一个）和 `closePanels()`（同时收起遮罩）。**不要在别处直接改 `panel.hidden`**，否则遮罩与面板状态会脱节。

层级（低 → 高）：`canvas/背景 0` → `panelBackdrop 140` → `面板 150` → `controlBtns 160` → `queueStrip 165` → `topBar / bottomBar 170` → `pauseOverlay 180` → `mainMenu 200` → `toast 300`。控制条放在战场右上角（`top:52px`），避免与面板底部的关闭按钮抢点击区域。

每个能打开的层都有 `×`；`Esc` 分级后退 `面板 → 暂停 → 结算 → 主菜单`；点遮罩、点底部关闭按钮、点浮层空白处同样能退。`scripts/check-navigation.mjs` 静态守结构，`scripts/smoke-pages.mjs` 用 Playwright 跑 41 项交互断言。

## 配置怎么做到的

```
config/game.json  ──scripts/build-config.mjs──▶  src/config.generated.js  ──▶ src/config.js
   （人改）         （生成 + 结构校验）             （提交，勿手改）            （派生与校验）
```

运行时不 `fetch` JSON、不跑构建，Pages 直接服务静态文件。生成物必须提交，CI 用 `git diff --exit-code` 守住一致性。`src/config.js` 导出 `CONFIG`、`UNIT_ORDER`、`ASSET_KEYS`、`DIFFICULTIES`、`upgradeStats()`（矿工 Armory 维度与其他兵种不同）、`bonusFor()`、`freshUpgrades()`。

## 扩展点

- **加兵种**：`config/game.json` 加一项（必填 `trainSec`）→ `npm run check`，再在 `src/figure.js` 的 `BULK` 表、头饰分支、武器分支各补一条。兵种栏、商店、升级面板、训练队列、AI 抽取池由配置自动生成，角色也不需要额外贴图。
- **加投射物类型**：`simulation.js` 的 `fire()` / `makeProjectile()` 决定生成，`render.js` 的 `drawProjectile()` 决定外观；`build-config` 校验 `projectile` 取值。
- **加克制关系**：`damageMultiplier()` + `config/game.json` 的 `damageMatrix`，拆雕像分支另行读取。
- **换 AI 策略**：只改 `tryAiSpawn()` / `aiInterval()`，它们是纯逻辑，可直接写单测。当前 AI 不做针对性反制。
- **加难度项**：`match.difficulties` 加字段后在 `difficultyOf()` 消费。
- **加音效 / 存档**：消费 `step()` 的 `events`（`hit` / `gold` / `training` / `trained` / `fortArrow` / `spawn` / `statueHit` / `end`），不要在渲染层偷偷改状态。
- **换渲染层**：`renderer` 只依赖 `state` 与 `assets` 两个只读对象；角色本身由 `figure.js` 的 `drawUnitFigure(ctx, { type, team, x, groundY, height, ... })` 单独绘制，换 WebGL 时只需重写这一层。
- **调角色**：`src/figure.js` 里所有长度都以「身高 = 1」为单位，改完全身等比缩放；动作参数（步幅、攻击相位、受击后仰）也在同一处。

## 测试策略

| 文件 | 覆盖 |
| --- | --- |
| `tests/timing.test.mjs` | 30/60/144Hz 步数一致、掉帧 clamp、reset |
| `tests/simulation.test.mjs` | dt 线性一致、矿工经济与 dt 结转、双侧矿点分配、胜负状态机、AI 约束与解锁、雕像判定线、投射物命中/落空、统计、升级与重开 |
| `tests/config.test.mjs` | 生成物无漂移、字段合法、双侧矿点结构、素材超时、单位约定 |
| `tests/mechanics.test.mjs` | 训练队列/退款/升级快照/人口、三指令与驻堡、城堡射手、克制倍率、被动收入、矿工 Armory、难度 |
| `tests/figure.test.mjs` | 7 兵种 × 7 种动作的几何回归：stub ctx 记账，出现 NaN 坐标直接失败 |
| `scripts/smoke-pages.mjs` | 41 项页面可达性（进入/退出/×/Esc/遮罩/训练队列/难度/资源 200/无运行时异常） |

CI 另外做全模块语法检查、素材字节数与 WebP 尺寸校验、导航退出通道静态自检、Pages 入口自检。Playwright 烟测需要本机 Chrome，CI 不跑（用静态自检兜底）。

## 为什么不引入打包器

仓库只有原生 ESM + 静态资源，Pages 从 `main` 分支根目录直出（`build_type: legacy`）。加 Vite / npm 依赖会让「推 main 即上线」变成「先构建再传 artifact」，对一个 9 张图、10 个模块的项目不划算。代价是：**不能再用 `file://` 双击打开**，本地必须起静态服务器（`npm run serve`）。
