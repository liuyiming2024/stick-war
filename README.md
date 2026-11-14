# 火柴人战争（网页版 v2.2）

> 从「一个 18KB 的 `index.html` 包办一切」重构成模块化、可配置、可测试、可继续迭代的静态游戏。
> v2.2 对齐 2009 年 Flash 原版 v1.2 的核心机制：训练队列、三指令、城堡射手、兵种克制、矿工 Armory、三档难度。

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

无运行时构建步骤。改完刷新即可；只有改 `config/game.json` 才需要 `npm run build` 重新生成 `src/config.generated.js`。

## 对齐原版的机制（v2.2）

参考 2009 Stickpage / Crazy Jay 的 Stick War v1.2 及其 Wiki、后续 Legacy 的 Armory 设计，落地了以下可验证的机制：

| 原版机制 | 本实现 | 配置项 |
| --- | --- | --- |
| 单位需要训练时间，可再点一次取消 | `state.training` 队列 + `trainSec`，下单扣钱并快照升级，点队列条目全额退款；人口上限包含排队单位 | `units.*.trainSec` |
| 三指令 Attack / Defend / Garrison | `setMode('attack'/'defend'/'garrison')`；驻堡把全军收回 `fortX()` 并不再追击，输出交给城堡射手 | `layout.fortInsetRatio`、`match.fortArcher*` |
| Garrison 时城堡按比例放箭 | 每 `fortArcherPerUnits` 个堡内单位折算 1 名射手，周期 `fortArcherIntervalSec`，堡内单位免疫伤害 | `match.fortArcherPerUnits` |
| 城堡每秒被动产金 | `economy.castleGoldPerSec`，与矿工收入叠加；AI 侧按难度倍率 | `economy.castleGoldPerSec` |
| 弓克剑、远程打不动巨人与雕像、矛士盾挡箭 | `combat.damageMatrix` 四个倍率，作用于投射物命中与拆雕像两条路径 | `combat.damageMatrix` |
| 矿工 Armory：背包 / 镐 / 移速 | 矿工升级维度改为 `bag/pick/spd`（其他兵种仍是 `atk/def/spd`），派生 `goldPerTrip`、`mineDuration`、`speed` | `economy.bagPerLevel`、`pickaxePerLevel` |
| 难度 Normal / Hard / Insane | 放大 AI 收入、缩短出兵间隔、增加敌方雕像血量；主菜单可选，重开保留 | `match.difficulties` |
| 双侧矿脉、矿工就近挖自家矿 | v2.1 已落地；v2.2 保持并补上「阶段切换结转剩余 dt」 | `layout.goldMines` |

**刻意未实现**（工程取舍，见「已知限制」）：战役地图与过关简报、单兵手动操控（WASD/Space）、Magikill 眩晕与召唤小兵、Spearton 投矛、火/毒箭、存档、音效。这些都需要输入层与更多状态机，留作后续迭代。

## v1 评审里的问题，逐条收掉

| v1 的问题 | 处理 |
| --- | --- |
| 冷却/移速/概率按帧递减，刷新率决定难度 | 全量秒制（`px/s`、`attackIntervalSec`），`src/timing.js` 固定 1/60 累加器，掉帧最多补 0.1s |
| 矿工是「带贴图的随机数发生器」，站着刷钱 | 真实状态机 `toMine → mining → toHome → 交付`，带挖掘进度环与背矿金块 |
| 矿工 `baseCd:0` 每帧攻击，把敌人闪白永久重置 | 矿工不进战斗分支；受击闪白按秒衰减 |
| 雕像画在 x=74、伤害判定在 160 | 绘制与判定共用 `statueInset + statueHitRadius`，单测守着 |
| 提示文字被下一帧 `updateUI()` 覆盖 | 独立 `#toast`，不写进金币节点 |
| 按钮只是置灰、仍能点 | 真 `btn.disabled` + `:disabled` 样式 |
| 重开不清升级等级 | `resetMatch()` 重建整份状态 |
| AI 无人口上限、只出 3 种兵 | 金币与人口双约束，6 兵种按权重抽取、随时间解锁，间隔随对局收紧 |
| 远程兵只有一道弧光 | 箭矢 / 落石 / 法球是真实投射物，有飞行时间、追踪、目标死亡后落空 |
| 20 个单位叠在一个像素 | 同队轻推分离 |
| `draw()` 排序改写物理数组 | 渲染用 `[...units].sort()` 副本，物理层 `filter` 清理 |
| 每帧 `ctx.filter` 闪白 | 加载时预生成白色剪影，运行时只 `drawImage` |
| 素材缺失文案说替代绘制、实际隐形 | 真降级：火柴人线稿 + 纯色石像 |
| 无超时、无脏检查 | 两段式超时（软 6s 放行 / 硬 20s 判缺失）+ 背景矩形缓存 + UI 脏检查 + DPR |
| README 体积口径不准、manifest 有幽灵字段 | `check-assets.mjs` 逐项校验字节数并解析 WebP 头校验画布尺寸：**129816 字节 / 126.8 KiB / 9 文件，9/9 通过** |
| 全内联 onclick、字符串拼 handler | 统一 `addEventListener`，兵种栏/商店/升级面板由配置生成 |
| 无配置、无测试、无 CI | 单一配置源 + **40 个单测** + GitHub Actions |
| 全战场只有一个黄圈当金矿 | `layout.goldMines` 双侧各 3 点，只挖自家半场，按负载/距离分配 |
| 金矿没有形象 | 纯矢量矿石堆（岩石 + 嵌金块 + 金晶簇 + 阴影 + 呼吸光晕） |
| 面板/浮层没有关闭叉号 | 商店、升级、暂停、结算四层都有 `×`，外加 `Esc` 分级后退、点遮罩、底部关闭按钮 |
| 素材加载慢就误判缺失 | 晚到的图片补登记，不误画线稿替身 |

## 目录结构

```
index.html                    页面骨架
styles/main.css               样式（含层级 z-index 约定）
config/game.json              ★ 唯一配置源
config/README.md              字段含义
src/config.generated.js       生成物，必须提交
src/config.js                 配置访问、升级维度与倍率派生
src/timing.js                 固定步长累加器
src/rng.js                    可注入的确定性随机源
src/state.js                  纯状态 / 单位工厂 / 训练队列
src/simulation.js             纯逻辑：step / 训练 / 指令 / 城堡射手 / 克制 / 升级
src/assets.js                 素材加载、闪白贴图、超时降级
src/render.js                 Canvas 绘制、矿石堆、堡区、线稿替身
src/ui.js                     DOM 绑定、面板、队列条、快捷键
src/main.js                   装配与主循环
scripts/build-config.mjs      配置生成 + 结构校验
scripts/check-assets.mjs      素材字节数 / WebP 头解析
scripts/check-navigation.mjs  退出通道静态自检
scripts/smoke-pages.mjs       Playwright 可达性烟测（41 项）
scripts/serve.mjs             零依赖静态服务
tests/                         node:test，40 个用例（4 个文件）
docs/ARCHITECTURE.md          分层、状态机、时间约定、扩展点
.github/workflows/ci.yml       CI
```

分层原则：`state.js` 与 `simulation.js` 不引用任何 DOM，可在 Node 里整局推演；渲染与 UI 只读状态。

## 改数值

```bash
vim config/game.json
npm run build              # 重新生成 src/config.generated.js
npm run smoke              # 可选：本机 Chrome 跑 41 项可达性断言
npm run check              # 生成 + 40 单测 + 素材校验
```

`src/config.generated.js` 必须一起提交（Pages 直出静态文件，运行时不跑构建）。CI 用 `git diff --exit-code` 守住一致性。加新兵种只改配置和素材，UI 自动长出，详见 `config/README.md`。

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

两个容易踩的坑，都由严格单测守着：

1. **矿工阶段切换结转剩余 `dt`**——挖掘完成/交付落在步中间时，剩余时间继续用于行走，否则 1/60 与 1/120 的轨迹会漂移。
2. **训练完成只消费 `elapsed - due`**——新单位不是从训练到期的那一步起白拿一个完整 `dt`；否则不同步长下整局经济会差一个步长。

`tests/simulation.test.mjs` 与 `tests/mechanics.test.mjs` 里有 60/120Hz 严格一致性、位移与 dt 成正比、冷却按秒递减等断言。

## 页面可达性

「可达」= **每个能进的层都能出、每份资源都能取到**：

```bash
npm run smoke     # 需要本机 Chrome；自动起静态服务，41 项断言
```

覆盖：首页 200、开始按钮放行、全部 JS/CSS/WebP 无 4xx、无运行时异常、6 个矿点装配、难度三档与生效、训练队列下单/扣钱/取消退款、驻堡指令切换、商店与升级的进入退出（`×`/`Esc`/遮罩/底部按钮）、面板切换不叠层、矿工升级维度、暂停自动收起面板、结算统计与返回、菜单按钮。

CI 里跑 `scripts/check-navigation.mjs` 做静态兜底（不需要浏览器）。

## 结算统计

浮层给出用时、难度、双方出兵、运矿趟数、取消训练次数、城堡弓箭数，全部来自 `state.stats`（纯逻辑层累加，`resetMatch` 归零）。新增指标在 `simulation.js` 累加、在 `ui.js` 的 `showEnd()` 读取即可。

## GitHub Pages

Pages 配置为 **legacy / `main` 分支 / 根目录**，push 到 `main` 自动发布，无需部署工作流；CI 只负责保证推上去的代码能跑。根目录 `.nojekyll` 避免 Jekyll 过滤，全部资源用相对路径适配 `/stick-war/` 前缀。

## 已知限制

- 升级在**训练下单时快照**，已出场单位不回溯加成
- 没有单兵手动操控、战役地图/简报、存档、音效、多人
- Magikill 眩晕与召唤、Spearton 投矛、箭矢属性升级（火/毒/倒刺）尚未实现
- AI 只有一套节奏曲线，不根据玩家兵种做针对性反制
- 素材沿用 v1，未声明来源与授权，仓库也还没有 LICENSE
- 单位只有一维 x 轴，没有纵深、碰撞体积与寻路

以上留作后续迭代入口。
