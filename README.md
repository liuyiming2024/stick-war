# 火柴人战争（网页版 v2.4）

> 从「一个 18KB 的 `index.html` 包办一切」重构成模块化、可配置、可测试、可继续迭代的静态游戏。
> v2.3：外部位图归零，全部改为 Canvas 路径与内联 SVG，动画由模拟时间驱动。
> v2.4：**美术重制**——暗色低饱和战场、深炭剪影主体、阵营色只作点缀、冷调金属与晶面金矿；修掉 Venn 图式云、积木雕像与细线火柴棍，角色改为有体积的备战姿态。

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

无运行时构建步骤，改完刷新即可；只有改 `config/game.json` 才需要 `npm run build` 重新生成 `src/config.generated.js`。**没有任何图片需要加载**，打开即可开战。

## v2.4：为什么重画

v2.3 的实拍暴露了几处硬伤：三个 `arc` 共用一次 `stroke` 让云变成相交的空心 Venn 图；雕像是梯形+圆头+三角冠的积木；单位是细线火柴棍；高饱和亮绿/亮红平涂加粗黑描边；草叶铺满下半屏像划痕。v2.4 全部重做：

- **调色板**：暮色蓝灰天空、低对比远山剪影、暗橄榄分层地面；阵营色从 `#4dd35c/#ff4d4d` 降为 `#79d4b0/#e2796b`，且只出现在头带、盔缨、胸纹、腰带、护腕与披风，主体是 `#2a3438` 深炭剪影。金属统一冷灰，金色统一暖金。
- **角色**：细线换成有体积的骨架——收腰梯形躯干、带膝/肘弯折的粗四肢、石盔+护鼻+阵营色眼缝+盔缨、飘动披风、靴与护腕。静止时是前倾备战姿态而不是立正；武器按兵种有各自握持倾角，剑刃加中脊高光。
- **云**：每个圆单独 `fill` 且不描边，去掉内部交线，改为低 alpha 雾团 + 底部薄雾；太阳改为柔和径向光晕，不画黑描边圆。
- **雕像**：三层基座带刻线、石甲 V 纹、肩甲、石裙甲、盔脊与面罩缝、多边形剑刃、阵营色披风；裂纹随血量逐条出现。
- **矿堆**：晶洞式岩块 + 三根带晶面高光的棱柱金晶簇（不再是「三根针」）+ 环绕金尘。
- **草**：只在地表边缘成簇生长，每簇三叶，不再满地划痕。
- **聚堆**：同一矿点上的多个矿工在渲染层按 id 稳定横向错开（`visualOffsets()`），**不改物理坐标**，因此判定与 dt 一致性完全不受影响。
- **UI**：暗色玻璃拟态、细金边、克制的 hover 微光；遮罩透明度下调，面板打开时战场仍可读。

所有改动仍满足零位图、零墙钟相位、配置驱动三条硬约束；`animation` / `presentation` 段结构未变，只调了配色值。

## v2.3：统一矢量 + 全要素动画

统一视觉语言在 `src/render.js`（Canvas）与 `src/icons.js`（内联 SVG）两处同源实现：共用 `presentation.outline` 描边色、圆头线帽、「粗描边 → 阵营色细芯」两层画法，以及 `presentation.shadow` 地面投影。兵种造型共用一副骨架，只靠武器/装备区分。

| 元素 | 动画 | 相位源 |
| --- | --- | --- |
| 单位 | 走路摆臂摆腿、身体起伏、呼吸缩放、攻击挥武器、近战挥击弧 | `u.walkPhase` / `u.anim` / `u.atkAnim` |
| 矿工 | 挖掘挥镐、背矿袋晃动、挖掘进度环、矿点飞溅金粒 | `state.elapsed` / `u.mineTimer` |
| 雕像 | 受击抖动、阵营光晕脉动、剑与冠随抖动偏移 | `state.fx.homeShake/enemyShake` |
| 矿堆 | 晶簇闪烁缩放、光晕呼吸、金粒明暗、挖掘粒子 | `state.elapsed` |
| 背景 | 云层视差漂移、草叶摇摆、太阳光晕脉动、远山/地面纹理 | `state.elapsed` |
| 投射物 | 箭矢旋转、落石自旋、法球脉动与拖尾 | `p.age` |
| 金币 | 交付时七枚金币确定性迸发 | `state.fx.goldBurst` |
| 堡区 | 虚线流动、边框脉动 | `state.elapsed` |
| UI 图标 | 摆臂/摆腿/呼吸/法球脉动、hover 加速、× 旋转、面板滑入、队列脉动 | CSS + `document.body.dataset.phase` |

**硬约束**：`render.js` 不允许 `performance.now()`、`Date.now()`、`Math.random()`、`ctx.filter`、`drawImage()`。所有相位只来自 `state.elapsed`、`unit.walkPhase`、`unit.anim`、`projectile.age`、`state.fx`——因此**暂停时画面逐帧完全一致**，且整局可复现。UI 侧的 CSS 动画由 `ui.sync()` 写入 `body[data-phase]` 统一冻结。`scripts/check-vector.mjs` 与 `tests/vector.test.mjs` 静态守着这两条，烟测还直接比对暂停前后两次 `canvas.toDataURL()`。

退役的整条素材链：`assets/`（9 张 webp）、`manifest.json`、`src/assets.js`、`scripts/check-assets.mjs`、两段式加载超时与线稿降级替身。**仓库现在不含任何外部图片文件，页面没有 `<img>`，也没有任何位图请求。**

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
| 三档难度 | 放大 AI 收入、缩短出兵间隔、增加敌方雕像血量 | `match.difficulties` |
| 双侧矿脉、矿工就近挖自家矿 | `layout.goldMines` 双侧各 3 点，按负载/距离分配 | `layout.goldMines` |

**刻意未实现**：单兵手动操控、战役地图/简报、Magikill 眩晕与召唤、Spearton 投矛、火/毒箭、存档、音效、AI 针对性反制。见「已知限制」。

## v1 评审里的问题，逐条收掉

| v1 的问题 | 处理 |
| --- | --- |
| 冷却/移速/概率按帧递减，刷新率决定难度 | 全量秒制（`px/s`、`attackIntervalSec`），`src/timing.js` 固定 1/60 累加器，掉帧最多补 0.1s |
| 矿工是「带贴图的随机数发生器」，站着刷钱 | 真实状态机 `toMine → mining → toHome → 交付`，阶段切换结转剩余 `dt` |
| 矿工 `baseCd:0` 每帧攻击，把敌人闪白永久重置 | 矿工不进战斗分支；受击闪白按秒衰减，改为矢量重描白色骨架 |
| 雕像画在 x=74、伤害判定在 160 | 绘制与判定共用 `statueInset + statueHitRadius` |
| 提示文字被下一帧 `updateUI()` 覆盖 | 独立 `#toast` |
| 按钮只是置灰、仍能点 | 真 `btn.disabled` + `:disabled` 样式 |
| 重开不清升级等级 | `resetMatch()` 重建整份状态（保留 `w/h/difficulty`） |
| AI 无人口上限、只出 3 种兵 | 金币与人口双约束，6 兵种按权重抽取、随时间解锁 |
| 远程兵只有一道弧光 | 真实投射物，有飞行时间、追踪、目标死亡后落空，v2.3 加自旋与拖尾 |
| 20 个单位叠在一个像素 | 同队轻推分离 |
| `draw()` 排序改写物理数组 | 渲染用 `[...units].sort()` 副本 |
| 每帧 `ctx.filter` 闪白 | v2.3 改为纯路径重绘白色骨架，不使用滤镜 |
| 素材缺失文案说替代绘制、实际隐形 | 不再有素材：**位图链整体退役**，全部矢量生成 |
| 无超时、无脏检查 | 不再需要加载超时；背景每帧矢量生成、UI 数值脏检查、支持 DPR |
| manifest 有 `png/jpg` 幽灵字段、体积口径不准 | manifest 与 `check-assets.mjs` 一并删除，改由 `check-vector.mjs` 校验「零外部位图」 |
| 全内联 onclick、字符串拼 handler | 统一 `addEventListener`，兵种栏/商店/升级/工具图标由 `icons.js` 生成 |
| 无配置、无测试、无 CI | 单一配置源 + **46 个单测** + GitHub Actions |
| 全战场只有一个黄圈当金矿 | 双侧各 3 个矢量矿石堆，只挖自家半场 |
| 面板/浮层没有关闭叉号 | 商店、升级、暂停、结算四层都有 `×`，外加 `Esc` 分级后退、点遮罩、底部关闭按钮 |

## 目录结构

```
index.html                    页面骨架
styles/main.css               样式、层级 z-index 约定、SVG/UI 动画
config/game.json              ★ 唯一配置源（含 animation 动画参数、presentation 矢量调色板）
config/README.md              字段含义
src/config.generated.js       生成物，必须提交
src/config.js                 配置访问、升级维度与倍率派生
src/icons.js                  内联 SVG 兵种/工具图标（与 Canvas 同源）
src/timing.js                 固定步长累加器
src/rng.js                    可注入的确定性随机源
src/state.js                  纯状态 / 单位工厂 / 训练队列 / fx 视觉反馈
src/simulation.js             纯逻辑：step / 训练 / 指令 / 城堡射手 / 克制 / 升级
src/render.js                 ★ 全矢量 Canvas 绘制与全部场景动画
src/ui.js                     DOM 绑定、面板、队列条、快捷键
src/main.js                   装配与主循环
scripts/build-config.mjs      配置生成 + 结构校验
scripts/check-vector.mjs      零位图 / 零墙钟相位静态自检
scripts/check-navigation.mjs  退出通道静态自检
scripts/smoke-pages.mjs       Playwright 可达性烟测（48 项）
scripts/serve.mjs             零依赖静态服务
tests/                         node:test，46 个用例（5 个文件）
docs/ARCHITECTURE.md          分层、状态机、时间约定、扩展点
.github/workflows/ci.yml       CI
```

分层原则：`state.js` 与 `simulation.js` 不引用任何 DOM，可在 Node 里整局推演；渲染与 UI 只读状态。

## 改数值

```bash
vim config/game.json
npm run build              # 重新生成 src/config.generated.js
npm run smoke              # 可选：本机 Chrome 跑 48 项可达性断言
npm run check              # 生成 + 46 单测 + 矢量静态自检
```

`src/config.generated.js` 必须一起提交（Pages 直出静态文件）。CI 用 `git diff --exit-code` 守住一致性。加新兵种只改配置和 `icons.js` 的 `weaponSVG()`，UI 与渲染自动长出。改动画节奏只动 `animation` 段，不用碰绘制代码。

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
npm run smoke     # 需要本机 Chrome；自动起静态服务，48 项断言
```

覆盖：首页 200、即时开战、零位图请求、零 `<img>`、7+7+7+2 个内联 SVG、Canvas 非空绘制、6 个矿点、难度三档、训练队列下单/退款、驻堡切换、商店与升级的全部退出通道（`×`/`Esc`/遮罩/底部按钮）、面板不叠层、矿工升级维度、**暂停前后两次 `toDataURL()` 完全一致且 CSS 动画冻结**、恢复后画面继续动画、结算统计与返回、菜单按钮。

CI 里跑 `scripts/check-navigation.mjs` 与 `scripts/check-vector.mjs` 做静态兜底（不需要浏览器）。

## GitHub Pages

Pages 配置为 **legacy / `main` 分支 / 根目录**，push 到 `main` 自动发布，无需部署工作流。根目录 `.nojekyll` 避免 Jekyll 过滤，全部资源相对路径适配 `/stick-war/` 前缀。

## 已知限制

- 升级在**训练下单时快照**，已出场单位不回溯加成
- 没有单兵手动操控、战役地图/简报、存档、音效、多人
- Magikill 眩晕与召唤、Spearton 投矛、箭矢属性升级（火/毒/倒刺）尚未实现
- AI 只有一套节奏曲线，不根据玩家兵种做针对性反制
- 仓库还没有 LICENSE
- 单位只有一维 x 轴，没有纵深、碰撞体积与寻路

以上留作后续迭代入口。
