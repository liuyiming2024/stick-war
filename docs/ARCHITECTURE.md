# 架构说明

> 面向「要接着改这份代码的人」。读完这一页就能知道该动哪个文件。

## 分层

```
输入（点击 / 键盘 / 难度下拉）
   │
   ▼
src/ui.js ────── 只写状态：下单训练 / 取消 / 升级 / 三指令 / 暂停
   │
   ├──▶ src/icons.js      内联 SVG 兵种 / 工具图标（无外部资源）
   ▼
src/state.js            纯数据：state / 单位工厂 / 训练队列 / fx / 重置
   │
   ▼
src/simulation.js       纯逻辑：step(state, dt, rng) → events
   │                     ↑ 不引用 DOM、canvas、window，可在 Node 里整局推演
   ├──────────────┐
   ▼              ▼
src/render.js    src/ui.js
 全矢量 Canvas     数值 / 按钮 / 面板 / 队列条 / toast 同步
 绘制与全部动画
```

`src/main.js` 只做装配：创建 state / rng / renderer / ui，用 `src/timing.js` 的固定步长累加器驱动 `step`，每帧调一次 `renderer.draw(state)` 和 `ui.sync()`。**没有任何素材加载阶段**，同步即可开战。

**硬性边界**：`state.js` 与 `simulation.js` 不得 import 任何浏览器全局。这是 46 个单元测试能在 `node --test` 里跑起来的前提，也是后续换渲染层时逻辑不用重写的前提。

## 全矢量渲染（v2.3 引入，v2.4 美术重制）

v2.4 把 v2.3 的高饱和平涂改为暗色剪影风格：`presentation` 调色板整体换掉，阵营色只作点缀；单位从细线改为收腰梯形躯干 + 带关节弯折的粗四肢 + 石盔/披风/护腕；云修掉「多个 arc 共用一次 stroke」的 Venn 图 bug（每圆单独 fill、不描边）；雕像加石甲/肩甲/裙甲/裂纹；矿堆晶簇改为带晶面的棱柱。`visualOffsets()` 在渲染层按 id 错开同位置的单位，专门解决多个矿工叠在一个矿点的问题，**不写回 `state.units[].x`**。

这些改动的相位来源与下面列出的约束完全一致，没有引入墙钟时间或随机源。

外部位图归零：`assets/`（9 张 webp）、`manifest.json`、`src/assets.js`、`scripts/check-assets.mjs` 全部退役。仓库不含任何图片文件，页面无 `<img>`，无位图请求。

**统一视觉语言**由两处同源实现：

| 文件 | 职责 |
| --- | --- |
| `src/render.js` | Canvas 路径绘制：背景、雕像、矿堆、单位、投射物、堡区、金币迸发 |
| `src/icons.js` | 内联 SVG：兵种栏 / 商店 / 升级 / 工具按钮图标 |

两者共用 `presentation.outline` 描边色、圆头线帽、「粗描边 → 阵营色细芯」两层画法、`presentation.shadow` 投影，以及同一副火柴人骨架（只靠 `drawWeapon()` / `weaponSVG()` 分支区分兵种）。改风格只需动 `presentation` 调色板与这两处，不需要替换图片。

**动画相位约束**（`scripts/check-vector.mjs` 静态守着）：

- 只允许 `state.elapsed`、`unit.walkPhase`、`unit.anim`、`projectile.age`、`state.fx`
- 禁止 `performance.now()`、`Date.now()`、`Math.random()`、`ctx.filter`、`drawImage()`
- `state.fx`（`homeShake` / `enemyShake` / `goldBurst`）由 `simulation.step()` 按秒递减，渲染层只读
- `unit.walkPhase` 只在单位真正移动时按 `animation.walkHz` 累加；静止单位只保留呼吸
- `ui.sync()` 把 `state.phase` 写入 `body[data-phase]`，CSS 动画在非 `playing` 时统一 `animation-play-state: paused`

因此**暂停时 Canvas 逐帧完全一致**。烟测直接比对暂停前后两次 `canvas.toDataURL()`，并断言恢复后画面继续变化。所有动画参数集中在 `config/game.json` 的 `animation` 段，改节奏不碰绘制代码；自检要求至少 12 个键被渲染层实际消费。

## 时间与确定性

| 概念 | 约定 |
| --- | --- |
| 逻辑步长 | `match.fixedStep = 1/60` 秒，由 `createFixedStepDriver` 产出 |
| 渲染帧率 | 任意；一帧跑 0~N 个逻辑步，刷新率不改变游戏速度 |
| 掉帧上限 | `match.maxFrameDelta = 0.1` 秒，单次最多补 6 步 |
| 速度 / 冷却 / 计时器 | 一律 `px/s` / 秒；没有「每帧减 1」 |
| 随机数 | `rng.js` 的 mulberry32，可注入 seed；逻辑与渲染均不调 `Math.random` |
| 装饰性伪随机 | `render.js` 的 `hash(n)` 用确定性 `sin` 散列，云/山/草/石子位置可复现 |

三处离散事件都做 **dt 结转**，这是 60/120Hz 严格一致的前提：

1. `moveToward(..., snap=true)` 到达固定目标点时吸附到精确坐标
2. `tickMiner()` 阶段切换把剩余 `dt` 交给下一阶段
3. `tickTraining()` 返回 `{ unit, available }`，`available = min(dt, elapsed - due)`，新单位不白拿一个完整 `dt`

`step()` 用 `freshTime: Map<unitId, dt>` 把结转时间同时作用于计时器递减与行为 tick。训练完成判定容差 `1e-6`（`elapsed` 浮点累加误差约 `1e-11`）。

## 状态机

**对局**：`menu → playing ⇄ paused → won | lost`。`step()` 在 `phase !== 'playing'` 时直接返回空事件，终局只触发一次 `end`；`resetMatch()` 重建整份状态（含升级、训练队列、统计、fx），但**保留 `w/h/difficulty`**。

**矿工**：`toMine → mining → toHome → 交付 → toMine`。`mineIndex` 由 `chooseMineIndex()` 按「同阵营 + 负载最少 + 距离最近」分配，交付后清空。`goldPerTrip` / `mineDuration` / `speed` 在 `spawnUnit()` 时由 Armory 等级派生固化。

**训练队列**：`spawnPlayer()` 立即扣钱 → `enqueue({ due: elapsed + trainSec, upgrades: 快照 })` → `tickTraining()` 到点 `spawnUnit()` → `cancelTraining()` 全额退款。人口上限 = `countTeam + pendingTeam`。升级快照是浅拷贝。

**指令**：`attack` 推到敌方判定线 / `defend` 守 `w*defendLineRatio` / `garrison` 全军回 `fortX()`。驻堡是 `step()` 里的短路分支：跳过 `tickFighter`/`tickMiner`，只 `moveToward(fortX())` 并置 `inFort`；`applyDamage()` 对 `inFort` 目标直接返回，输出交给 `tickFortArrows()`。不做短路的话 `nearestEnemy` 会把单位自己带出安全区。

**视觉反馈**：`state.fx` 三个计时器在 `step()` 开头按秒递减，雕像受击 / 金币交付时置位；渲染层据此画抖动、闪白光晕与金币迸发。放在逻辑层是为了让暂停与固定步长一起冻结它。

## 伤害与坐标

`applyDamage()` 是唯一的单位伤害入口，`damageMultiplier()` 从 `combat.damageMatrix` 取四个倍率。拆雕像走 `tickFighter()` 的独立分支，额外乘 `rangedVsStatue`。加克制关系只改这两个函数。

`layout.statueInset + statueHitRadius` 是**唯一**的雕像判定线。矿点由 `layout.goldMines[].xRatio * w` 生成（`minePositions()` 是唯一口径）。`fortX() = statueInset * fortInsetRatio` 只在 `simulation.js` 定义一次，渲染层用同一表达式算堡区边界。资源全部相对路径，适配 `/stick-war/` 前缀。

## 导航与退出通道

`ui.js` 里只有两个面板状态入口：`openPanel(which)`（互斥打开）和 `closePanels()`（同时收起遮罩）。**不要在别处直接改 `panel.hidden`**。

层级（低 → 高）：`canvas/背景 0` → `panelBackdrop 140` → `面板 150` → `controlBtns 160` → `queueStrip 165` → `topBar / bottomBar 170` → `pauseOverlay 180` → `mainMenu 200` → `toast 300`。控制条放在战场右上角（`top:52px`），避免与面板底部关闭按钮抢点击区域。

每个能打开的层都有 `×`；`Esc` 分级后退 `面板 → 暂停 → 结算 → 主菜单`；点遮罩、底部关闭按钮、浮层空白处同样能退。`check-navigation.mjs` 静态守结构，`smoke-pages.mjs` 跑 48 项交互断言。

## 配置怎么做到的

```
config/game.json  ──scripts/build-config.mjs──▶  src/config.generated.js  ──▶ src/config.js
   （人改）         （生成 + 结构校验）             （提交，勿手改）            （派生与校验）
```

运行时不 `fetch` JSON、不跑构建。`src/config.js` 导出 `CONFIG`、`UNIT_ORDER`、`DIFFICULTIES`、`upgradeStats()`（矿工 Armory 维度不同）、`bonusFor()`、`freshUpgrades()`。**没有 `ASSET_KEYS` / `assetPath`**。

## 扩展点

- **加兵种**：`config/game.json` 加一项（必填 `trainSec`）+ `icons.js` 的 `weaponSVG()` + `render.js` 的 `drawWeapon()` → `npm run check`。兵种栏/商店/升级/训练队列/AI 抽取池自动生成。
- **加动画**：`animation` 段加参数，在 `render.js` 用 `A.<key>` 消费；自检会要求参数为正且被使用。不要引入墙钟时间。
- **换配色**：只改 `presentation`，Canvas 与 SVG 同时生效。
- **加投射物类型**：`makeProjectile()` / `drawProjectile()`；build 校验 `projectile` 取值。
- **换 AI 策略**：只改 `tryAiSpawn()` / `aiInterval()`。当前 AI 不做针对性反制。
- **加音效 / 存档**：消费 `step()` 的 `events`，不要在渲染层偷偷改状态。
- **换渲染层**：`renderer` 只依赖 `state` 一个只读对象。

## 测试策略

| 文件 | 覆盖 |
| --- | --- |
| `tests/timing.test.mjs` | 30/60/144Hz 步数一致、掉帧 clamp、reset |
| `tests/simulation.test.mjs` | dt 线性一致、矿工经济与 dt 结转、双侧矿点、胜负状态机、AI 约束、雕像判定线、投射物、统计、升级与重开 |
| `tests/config.test.mjs` | 生成物无漂移、字段合法、双侧矿点、**无 assets 段 / animation 段 / 矢量调色板** |
| `tests/mechanics.test.mjs` | 训练队列/退款/升级快照/人口、三指令与驻堡、城堡射手、克制倍率、被动收入、矿工 Armory、难度 |
| `tests/vector.test.mjs` | SVG 自包含、无墙钟相位、步态只在移动时累加、fx 递减与暂停冻结、驻堡免疫 |
| `scripts/check-vector.mjs` | 零外部图片文件、零位图引用、零墙钟/随机/filter、animation 被真实消费、Pages 入口 |
| `scripts/smoke-pages.mjs` | 48 项可达性（含零位图请求、零 `<img>`、内联 SVG 数量、Canvas 非空、**暂停画面静止 / 恢复后继续动画**） |

CI 另做全模块语法检查、配置漂移、导航静态自检、Pages 入口（含 `test ! -d assets`）。Playwright 烟测需要本机 Chrome，CI 不跑（用静态自检兜底）。

## 为什么不引入打包器

仓库只有原生 ESM + 静态资源，Pages 从 `main` 分支根目录直出（`build_type: legacy`）。加 Vite / npm 依赖会让「推 main 即上线」变成「先构建再传 artifact」。代价是：**不能 `file://` 双击打开**，本地必须起静态服务器（`npm run serve`）。
