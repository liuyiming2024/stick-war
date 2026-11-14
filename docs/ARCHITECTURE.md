# 架构说明

> 面向「要接着改这份代码的人」。读完这一页就能知道该动哪个文件。

## 分层

```
输入（点击 / 键盘）
   │
   ▼
src/ui.js ────── 只写状态：出兵 / 升级 / 切模式 / 暂停
   │
   ▼
src/state.js            纯数据：state / 单位工厂 / 重置
   │
   ▼
src/simulation.js       纯逻辑：step(state, dt, rng) → events
   │                     ↑ 不引用 DOM、canvas、window，可在 Node 里整局推演
   ├──────────────┐
   ▼              ▼
src/render.js    src/ui.js
 Canvas 绘制      数值 / 按钮 / 面板 / toast 同步
   ▲
   │
src/assets.js    素材、白色剪影贴图、超时降级
```

`src/main.js` 只做装配：创建 state / rng / assets / renderer / ui，用 `src/timing.js` 的固定步长累加器驱动 `step`，每帧调一次 `renderer.draw` 和 `ui.sync`。

**硬性边界**：`state.js` 与 `simulation.js` 不得 import 任何浏览器全局。这是 22 个单元测试能在 `node --test` 里跑起来的前提，也是后续换渲染层（比如换 WebGL）时逻辑不用重写的前提。

## 时间与确定性

| 概念 | 约定 |
| --- | --- |
| 逻辑步长 | `match.fixedStep = 1/60` 秒，由 `createFixedStepDriver` 产出 |
| 渲染帧率 | 任意；一帧里跑 0~N 个逻辑步，刷新率不改变游戏速度 |
| 掉帧上限 | `match.maxFrameDelta = 0.1` 秒，单次最多补 6 步，避免死亡螺旋 |
| 速度 / 冷却 / 计时器 | 一律 `px/s` / 秒；没有「每帧减 1」 |
| 随机数 | `rng.js` 的 mulberry32，可注入 seed；逻辑层不直接调 `Math.random` |

`moveToward(..., snap=true)` 会在到达固定目标点时吸附到精确坐标，避免不同 dt 留下 0.x 像素残差在矿工状态机里累积。

## 两个状态机

**对局**：`menu → playing ⇄ paused → won | lost`。`step()` 在 `phase !== 'playing'` 时直接返回空事件，终局只触发一次 `end` 事件；`resetMatch()` 重建整份状态（含升级等级），不走「局部清零」那条容易漏字段的路。

**矿工**：`toMine → mining → toHome → 交付金币 → toMine`。矿工 `kind='miner'`，完全不进战斗分支，因此不会出现 v1 里 `dmg:0 / baseCd:0` 每帧把敌人闪白重置的问题。挖掘进度与背矿状态都由 state 字段表达，渲染层只读。

## 坐标

`layout.statueInset + statueHitRadius` 是**唯一**的雕像判定线，绘制血条、脚下椭圆、单位拆雕像、矿工交付点全部读它。金矿在 `w * goldMineXRatio`，驻守线在 `w * defendLineRatio`。所有资源用相对路径，所以项目站 `/stick-war/` 前缀和本地根路径都能跑。

## 配置怎么做到的

```
config/game.json  ──scripts/build-config.mjs──▶  src/config.generated.js  ──▶ src/config.js
   （人改）              （npm run build）            （提交，勿手改）           （派生与校验）
```

运行时不 `fetch` JSON、不跑构建，Pages 直接服务静态文件。生成物必须提交，CI 用 `git diff --exit-code` 守住一致性。`src/config.js` 还提供 `bonusFor()`（升级倍率）和 `freshUpgrades()`。

## 扩展点

- **加兵种**：`config/game.json` 加一项 + `assets/<key>.webp` + manifest → `npm run check`。兵种栏、商店、升级面板由 `UNIT_ORDER` 自动生成，不用改 UI。
- **加投射物类型**：`simulation.js` 的 `fire()` 决定生成，`render.js` 的 `drawProjectile()` 决定外观；build 脚本会校验 `projectile` 取值。
- **换 AI 策略**：只改 `tryAiSpawn()` / `aiInterval()`，它们是纯函数式逻辑，可以直接写单测。
- **加音效 / 存档**：消费 `step()` 返回的 `events`（`hit` / `gold` / `spawn` / `statueHit` / `end`），不要在渲染层偷偷改状态。
- **换渲染层**：`renderer` 只依赖 `state` 与 `assets` 两个只读对象。

## 测试策略

| 文件 | 覆盖 |
| --- | --- |
| `tests/timing.test.mjs` | 30/60/144Hz 步数一致、掉帧 clamp、reset |
| `tests/simulation.test.mjs` | dt 线性一致、矿工经济闭环、胜负状态机、AI 约束与解锁、雕像判定线、投射物命中/落空、统计累加、升级与重开 |
| `tests/config.test.mjs` | 生成物无漂移、字段合法、单位约定 |

CI 另外做全模块语法检查、素材字节数与 WebP 尺寸校验、Pages 入口自检。

## 为什么不引入打包器

仓库只有原生 ESM + 静态资源，Pages 从 `main` 分支根目录直出（`build_type: legacy`）。加 Vite / npm 依赖会让「推 main 即上线」变成「先构建再传 artifact」，对一个 9 张图、10 个模块的项目不划算。代价是：**不能再用 `file://` 双击打开**，本地必须起静态服务器（`npm run serve`）。
