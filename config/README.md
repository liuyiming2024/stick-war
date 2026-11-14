# 配置说明

`config/game.json` 是**唯一配置源**。改完执行：

```bash
npm run build     # 重新生成 src/config.generated.js + 结构校验
npm run check     # 生成 + 46 个单测 + 零位图/零墙钟相位静态自检
npm run smoke     # 可选：48 项页面可达性断言
```

`src/config.generated.js` 必须一起提交（Pages 从 `main` 直出，运行时不跑构建）。CI 用 `git diff --exit-code` 校验漂移。

`scripts/build-config.mjs` 同时承担结构校验：必填段、单位字段、`trainSec > 0`、难度三档、`damageMatrix` 四个倍率、矿点分布、`animation` 全部参数为正、`presentation` 矢量调色板齐全。

## 各段含义

| 段 | 作用 |
| --- | --- |
| `meta` | 标题与版本号（菜单展示，格式 `x.y.z`） |
| `layout` | 雕像位置与判定半径、地面线、驻守线、`fortInsetRatio`、`goldMines` 矿点数组、矿堆绘制比例、单位尺寸比例 |
| `match` | 初始金币、雕像血量、人口上限、固定步长、雕像伤害倍率、`fortArcher*` 城堡射手、`difficulties` 三档难度 |
| `economy` | 矿工每趟收益、挖掘耗时、AI 收入、`castleGoldPerSec` 被动收入、`bagPerLevel` / `pickaxePerLevel` |
| `upgrade` | 升级单价、等级上限、攻/防/速每级增益、`speedPerLevel` 移速增益与下限 |
| `combat` | 推挤、受击闪白、投射物参数、`damageMatrix` 克制倍率 |
| `ai` | 出兵间隔、随时间收紧的节奏 |
| `units` | 7 个兵种全部数值；`trainSec`、`aiUnlockSec`、`aiWeight`、`projectile`、`kind` |
| `animation` | **全部动画参数**：步态/呼吸/挥击/挖掘/背矿/云速/草摆/晶簇/雕像/拖尾等，见下 |
| `presentation` | **统一矢量调色板**：`outline` 描边、天空/山/地面/草、石材/金属/金矿色、阵营色、阴影 |

> v2.3 起**没有 `assets` 段**：不存在位图文件、加载超时或素材清单。

## animation：全部相位由模拟时间驱动

`render.js` 只读 `A.<key>`，改节奏不需要碰绘制代码。所有值必须为正（build 脚本强制）。

| 类别 | 键 | 作用 |
| --- | --- | --- |
| 步态 | `walkHz` / `walkLegSwing` / `walkArmSwing` | `u.walkPhase` 只在单位真正移动时按 `walkHz` 累加；静止只保留呼吸 |
| 身体 | `breathHz` / `breathRatio` / `bobRatio` / `attackSwingRad` | 呼吸用 `u.anim`；走路起伏用 `walkPhase`；攻击挥动用 `u.atkAnim` |
| 矿工 | `mineSwingHz` / `carryBobHz` / `carryBobRatio` | 挖掘挥镐、背矿袋晃动 |
| 背景 | `cloudSpeedPxPerSec` / `cloudCount` / `grassSwayHz` / `grassCount` | 云视差漂移、草叶摇摆（确定性 hash，不用随机数） |
| 矿堆 | `mineGlowHz` / `crystalTwinkleHz` | 光晕呼吸、晶簇闪烁与金粒明暗 |
| 雕像 | `statuePulseHz` / `statueShakePx` / `statueShakeSec` / `goldBurstSec` | 光晕脉动、受击抖动、金币交付迸发（`state.fx` 计时） |
| 投射物 | `projectileSpinHz` / `trailDots` | 落石自旋、法球脉动、拖尾点数 |
| 堡区 | `fortPulseHz` | 驻堡虚线流动与边框脉动 |

**约束**：`render.js` 禁止墙钟时间与随机源（`performance.now` / `Date.now` / `Math.random` / `ctx.filter` / `drawImage`）。相位只允许 `state.elapsed`、`u.walkPhase`、`u.anim`、`p.age`、`state.fx`。`state.fx` 由 `simulation.step()` 按秒递减，暂停时随 `step` 一起冻结；`ui.sync()` 把 `state.phase` 写到 `body[data-phase]`，CSS 动画在非 `playing` 时统一 `animation-play-state: paused`。

`scripts/check-vector.mjs` 会断言至少 12 个 `animation` 键真的被渲染层消费，避免「配了不用」。

## presentation：统一视觉语言

所有 Canvas 形状与内联 SVG 共用：

- `outline` — 统一描边色；`shadow` — 地面投影
- 单位采用「`outline` 粗描边 → 阵营色细芯」两层画法 + 圆头线帽，头/躯干/四肢共用一副骨架
- `weapon` / `weaponEdge` — 金属；`goldDark` / `goldLight` — 矿金；`rockDark` / `rockLight` — 岩石
- `stoneLight` / `stoneMid` / `stoneDark` — 雕像与基底；`skyTop` / `skyBottom` / `hillFar` / `hillNear` / `groundTop` / `groundBottom` / `grassBlade` — 背景渐变

`src/icons.js` 的 `unitSVG()` / `toolSVG()` 生成自包含内联 SVG（无 `href`、无 `url()`、无外部图片），造型与 `render.js` 的骨架一致。烟测断言兵种栏 7、商店 7、升级 7、工具 2 个 `.vIcon` 全部为内联 SVG，且页面 `<img>` 数量为 0。

## 训练队列 / 指令 / 克制 / 难度

与原版对齐部分的字段说明未变，详见 [README](../README.md) 与 [架构说明](../docs/ARCHITECTURE.md)：

- `trainSec` 下单即扣钱入队，升级在下单时快照，点队列条目全额退款
- `attack` / `defend` / `garrison` 三指令；驻堡全军回 `fortX()` 并免疫伤害，输出交给城堡射手
- `damageMatrix` 四倍率：弓克剑、投射物打矛士/巨人减半、远程拆雕像减伤
- `difficulties` 三档：`aiIncomeMul` / `aiSpawnMul` / `enemyStatueMul`，重开保留难度

## 矿点

`layout.goldMines` 是数组，每项 `{ xRatio, side }`。`minePositions(state)` 是渲染/逻辑唯一口径；矿工只从 `side === team` 里按「占用最少 → 距离最近」挑矿，交付后清空 `mineIndex`。矿堆是纯矢量绘制，改 `goldMineHeightRatio / goldMineWidthRatio` 即可调大小，**不需要任何图片**。

## 加一个新兵种

1. 在 `units` 里加一项，字段照抄 `sword`，必填 `trainSec`
2. 在 `src/icons.js` 的 `weaponSVG(key)` 加一个分支（图标武器），`src/render.js` 的 `drawWeapon()` 加对应分支（战场武器）
3. 跑 `npm run build && npm run check`
4. 兵种栏、商店、升级面板、训练队列、AI 抽取池、单测里的 SVG 覆盖检查会自动长出

不再需要 `assets/<key>.webp` 与 `manifest.json`。

## 口径

`statueHitRadius` 同时供绘制与伤害判定；`fortX()` 只在 `simulation.js` 定义一次，渲染层用同一表达式算堡区边界。所有动画参数集中在 `animation` 段，所有颜色集中在 `presentation` 段，不要在绘制代码里写死数值或色值。
