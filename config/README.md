# 配置说明

`config/game.json` 是**唯一配置源**。改完执行：

```bash
npm run build     # 重新生成 src/config.generated.js + 结构校验
npm run check     # 生成 + 82 个单测 + 素材/渲染确定性静态自检
npm run smoke     # 可选：76 项页面可达性断言
```

`src/config.generated.js` 必须一起提交（Pages 从 `main` 直出，运行时不跑构建）。CI 用 `git diff --exit-code -- src/config.generated.js index.html src/` 校验漂移。

**`meta.version` 同时是 ESM 缓存指纹**：`scripts/stamp-cache.mjs` 会给 `index.html` 的 module script / stylesheet 与 `src/*.js` 的所有相对 import 追加 `?v=<version>`。改版本号后**必须** `npm run build`，否则浏览器会继续用旧 URL 的缓存模块（现象是线上停在旧版本，甚至因导出不匹配白屏）。`check-assets.mjs` 会静态校验 19 条 import 的指纹全等于当前版本。

`scripts/build-config.mjs` 同时承担结构校验：必填段、单位字段、`trainSec > 0`、难度三档、`damageMatrix` 四个倍率、**世界尺寸与缩放上下限**、**每个矿点距回营点的距离不得小于 `minMineHomeDistanceRatio × world.width` 且不得越过中线**、`counterMatrix` 三元组合法、波次参数比例关系、`assets` 软/硬超时与重试、`animation` 全部参数为正、`presentation` 调色板齐全。

## 各段含义

| 段 | 作用 |
| --- | --- |
| `meta` | 标题与版本号（菜单展示，格式 `x.y.z`；同时是 ESM 与素材 URL 的缓存指纹） |
| `world` | **v2.8**：固定逻辑世界 `width/height`、镜头缩放 `minScale/maxScale`、跟随锚点 `followAnchorRatio`、插值速度 `followLerpPerSec`、按钮步进 `panStepRatio`、窄屏默认跟随阈值 `mobileFollowWidth` |
| `layout` | 雕像位置与判定半径、地面线、驻守线、`fortInsetRatio`、`goldMines` 矿点数组、矿堆绘制比例、单位尺寸比例 |
| `match` | 初始金币、雕像血量、人口上限、固定步长、雕像伤害倍率、`fortArcher*` 城堡射手、`difficulties` 三档难度 |
| `economy` | 矿工每趟收益、挖掘耗时、AI 收入、`castleGoldPerSec` 被动收入、`bagPerLevel` / `pickaxePerLevel`；**v2.8** `carrySpeedMul` 背矿减速、`minMineHomeDistanceRatio` 矿点距回营点最短比例 |
| `upgrade` | 升级单价、等级上限、攻/防/速每级增益、`speedPerLevel` 移速增益与下限 |
| `combat` | 推挤、受击闪白、投射物参数、`damageMatrix` 克制倍率 |
| `ai` | v2.7 发育决策：`decisionIntervalSec`、`rampSec`、`minerTargetStart/End` 与三个 `ReserveGold`、`upgradeIntervalSec`、`upgradePlan`；**v2.8** `counterMatrix` / `counterSaturation` 克制权重、`wave`（首波/增长/上限/集结/进攻/重整时长与比例） |
| `units` | 7 个兵种全部数值；`trainSec`、`aiUnlockSec`、`aiWeight`、`projectile`、`kind` |
| `assets` | 位图加载 `softTimeoutSec` / `hardTimeoutSec`，弱网软超时先放行开战、硬超时才记缺失；`retryCount` / `retryDelayMs` 控制失败重试 |
| `animation` | 全部动画参数：步态/呼吸/挥击/挖掘/背矿/晶簇/雕像/拖尾等，见下 |
| `presentation` | 调色板：矢量特效层、血条、粒子、暗色 HUD 与阵营色 |

## assets：位图素材

`assets/` 下 10 张 WebP（7 兵种 + `statue` + `battlefield` + `goldmine` 金矿插画），键由 `src/config.js` 的 `ASSET_KEYS` 定义，路径由 `assetPath()` 生成并带 `?v=<meta.version>` 指纹。`assets/manifest.json` 登记每个文件的画布尺寸与字节数，`scripts/check-assets.mjs` 逐项校验并解析 RIFF/WebP 头。`assets.retryCount` / `retryDelayMs` 控制 `onerror` 重试次数与间隔。

`src/assets.js` 在加载时为每个 key 预生成三份派生画布：

- `team:0` / `team:1`：`source-atop` 叠阵营色，保留立绘原有明暗与描边
- `flash`：`source-in` 纯白剪影，用于受击闪白

运行时只 `drawImage`，不做每帧 `ctx.filter`。素材缺失或尚未到达时 `render.js` 画线稿火柴人替身，不会隐形。

## animation：全部相位由模拟时间驱动

`render.js` 只读 `A.<key>`，改节奏不需要碰绘制代码。所有值必须为正（build 脚本强制）。

| 类别 | 键 | 作用 |
| --- | --- | --- |
| 步态 | `walkHz` / `walkLegSwing` / `walkArmSwing` | `u.walkPhase` 只在单位真正移动时按 `walkHz` 累加；静止只保留呼吸 |
| 身体 | `breathHz` / `breathRatio` / `bobRatio` / `attackSwingRad` | 呼吸用 `u.anim`；走路起伏用 `walkPhase`；位图倾斜与前冲用 `u.atkAnim` |
| 矿工 | `mineSwingHz` / `carryBobHz` / `carryBobRatio` | 挖掘前俯、背矿晃动与进度环粒子 |
| 背景 | `cloudSpeedPxPerSec` / `grassSwayHz` / `grassCount` | 位图背景上的确定性飘尘（云/山/草由位图提供，不再矢量绘制） |
| 矿堆 | `mineGlowHz` / `crystalTwinkleHz` | 光晕呼吸、晶簇闪烁与金粒明暗 |
| 雕像 | `statuePulseHz` / `statueShakePx` / `statueShakeSec` / `goldBurstSec` | 光晕脉动、受击抖动、金币交付迸发（`state.fx` 计时） |
| 投射物 | `projectileSpinHz` / `trailDots` | 落石自旋、法球脉动、拖尾点数 |
| 堡区 | `fortPulseHz` | 驻堡虚线流动与边框脉动 |

**约束**：`render.js` 禁止墙钟时间与随机源（`performance.now` / `Date.now` / `Math.random` / `ctx.filter`）。相位只允许 `state.elapsed`、`u.walkPhase`、`u.anim`、`p.age`、`state.fx`。`state.fx` 由 `simulation.step()` 按秒递减，暂停时随 `step` 一起冻结；`ui.sync()` 把 `state.phase` 写到 `body[data-phase]`，CSS 动画（含位图 `.unitBmp` 的浮动）在非 `playing` 时统一 `animation-play-state: paused`。

`scripts/check-assets.mjs` 会断言至少 12 个 `animation` 键真的被渲染层消费，避免「配了不用」。当前消费 18/23。

## presentation：调色板

单位与背景由位图提供，这一段主要服务于**矢量特效层与暗色 HUD**：

- `outline` — 矢量描边；`shadow` — 地面投影
- `playerColor` / `enemyColor` — 阵营色；同时用于 `assets.js` 的立绘染色、血条、拖尾与 UI 强调色
- `weapon` / `weaponEdge` / `metalDark` — 冷灰金属；`goldDark` / `goldLight` — 菱形矿点与金色粒子；`rockDark` / `rockLight` — 保留的备用岩面色（v2.6 起渲染层不再消费，build 仍校验存在）
- `stoneLight` / `stoneMid` / `stoneDark` — 雕像备用；`skyTop` / `skyBottom` / `hillFar` / `groundTop` 等 — 背景位图缺失时的降级底色
- `trailPlayer` / `trailEnemy` / `fortTint` / `mineGlow` / `crack` — 拖尾、护罩、光晕、裂纹

改配色只需动这一段，Canvas 特效与 UI 同时生效（位图立绘本身不受影响，阵营染色会跟着变）。

## 图标

`src/icons.js` 的 `unitIconHTML(key)` 返回 `<img class="unitBmp" src="./assets/<key>.webp">`，供兵种栏 / 商店 / 升级面板复用；工具按钮（商店 / 升级）没有位图素材，`toolSVG()` 仍生成自包含内联 SVG（无 `href`、无 `url()`、无外部图片）。烟测断言 7+7+7 张位图全部解码、2 个工具 SVG 存在。

## 训练队列 / 指令 / 克制 / 难度

与原版对齐部分的字段说明未变，详见 [README](../README.md) 与 [架构说明](../docs/ARCHITECTURE.md)：

- `trainSec` 下单即扣钱入队，升级在下单时快照，点队列条目全额退款
- `attack` / `defend` / `garrison` 三指令；驻堡全军回 `fortX()` 并免疫伤害，输出交给城堡射手
- `damageMatrix` 四倍率：弓克剑、投射物打矛士/巨人减半、远程拆雕像减伤
- `difficulties` 三档：`aiIncomeMul` 放大**矿工每趟交付收益**、`aiSpawnMul` 缩放**训练时长**、`enemyStatueMul` 加敌方雕像血量；三者都不再改「出兵间隔」，重开保留难度
- `economy.aiGoldPerSec=1.5` 已低于一趟矿的 `goldPerTrip=6`：AI 的钱主要来自自己训练的矿工真实往返，`state.aiUpgrades` 是与玩家 `state.upgrades` 完全隔离的独立 Armory
- `aiGrowthInfo(state)` 是顶栏、结算与烟测共用的敌方发育快照口径

## 矿点

`layout.goldMines` 是数组，每项 `{ xRatio, side }`。`minePositions(state)` 是渲染/逻辑唯一口径；矿工只从 `side === team` 里按「占用最少 → 距离最近」挑矿，交付后清空 `mineIndex`。v2.6 起矿点是**金色菱形几何标记**（不是插画），改 `goldMineHeightRatio / goldMineWidthRatio` 即可调大小；脉动/闪烁分别取 `animation.mineGlowHz` / `crystalTwinkleHz`。

## 加一个新兵种

1. 在 `units` 里加一项，字段照抄 `sword`，必填 `trainSec`
2. 补 `assets/<key>.webp` 并在 `assets/manifest.json` 登记画布尺寸与字节数
3. `render.js` 的备用线稿 `drawStickFigure()` 可加一个武器分支（仅在素材缺失时出现）
4. 跑 `npm run build && npm run check`
5. 兵种栏、商店、升级面板、训练队列、AI 抽取池自动长出

## 口径

`statueHitRadius` 同时供绘制与伤害判定；`fortX()` 只在 `simulation.js` 定义一次，渲染层用同一表达式算堡区边界。所有动画参数集中在 `animation` 段，所有颜色集中在 `presentation` 段，不要在绘制代码里写死数值或色值。
