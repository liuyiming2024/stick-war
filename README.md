# 火柴人战争（网页版 v2）

> 从「一个 18KB 的 index.html 包办一切」重构成模块化、可配置、可测试、可继续迭代的静态游戏。

[![CI](https://github.com/liuyiming2024/stick-war/actions/workflows/ci.yml/badge.svg)](https://github.com/liuyiming2024/stick-war/actions/workflows/ci.yml)

- 🎮 在线试玩：https://liuyiming2024.github.io/stick-war/
- 📦 仓库：https://github.com/liuyiming2024/stick-war
- 🧭 架构说明：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## 本地运行

v2 使用 ES Modules，**不能双击 `index.html` 用 `file://` 打开**（浏览器会拦 CORS）。起一个静态服务器即可，零依赖：

```bash
npm run serve          # http://localhost:4173/
# 或者
python3 -m http.server 4173
```

改完代码刷新页面就能看到效果，没有构建步骤。

## v1 评审里的问题，这一版逐条收掉

| v1 的问题 | v2 的处理 |
| --- | --- |
| 冷却/移速/概率都按帧递减，刷新率决定难度 | 全量改成秒制（`px/s`、`attackIntervalSec`），`src/timing.js` 固定 1/60 步长累加器，掉帧最多补 0.1s |
| 矿工是「带贴图的随机数发生器」，站着刷钱 | 真实状态机 `toMine → mining → toHome → 交付`，头顶有挖掘进度环，背矿时显示金块 |
| 矿工 `baseCd:0` 每帧攻击，把敌人闪白永久重置 | 矿工不进战斗分支；受击闪白按秒衰减，测试专门回归这一条 |
| 雕像画在 x=74、伤害判定却在 160 | 绘制与判定共用 `layout.statueInset + statueHitRadius`，并有单测守着 |
| 提示文字被下一帧 `updateUI()` 覆盖 | 独立 `#toast`，不再写进金币节点 |
| 按钮只是置灰、仍能点 | 真 `btn.disabled`，同时加 `:disabled` 样式 |
| 重开不清升级等级 | `resetMatch()` 重建整份状态，等级/金币/计时器全归零 |
| AI 无人口上限、只出 3 种兵 | 受金币与人口双约束，6 兵种按权重抽取、随时间解锁，出兵间隔随对局时长收紧 |
| 远程兵只有一道弧光，没有飞行 | 箭矢 / 落石 / 法球是真实投射物，有飞行时间、追踪目标与目标死亡后的落空 |
| 20 个单位叠在一个像素 | 同队轻推分离（`combat.separationPxPerSec`） |
| `draw()` 排序改写物理数组，影响倒序 splice 删人 | 渲染用 `[...units].sort()` 副本，物理层用 `filter` 清理 |
| 每帧 `ctx.filter` 闪白，移动端很贵 | 加载时预生成白色剪影贴图，运行时只 `drawImage` |
| 素材缺失文案说「替代绘制」，实际直接隐形 | 真降级：火柴人线稿（头/四肢/武器按兵种区分）+ 纯色石像 |
| 无超时、无重试、无脏检查 | 8s 加载超时；背景矩形缓存到 resize；UI 数值脏检查；支持 DPR |
| README 体积口径不准、manifest 有 `png`/`jpg` 幽灵字段 | 清掉幽灵字段；`scripts/check-assets.mjs` 逐项校验字节数，并解析 WebP 头校验画布尺寸（9/9 通过）：合计 **129816 字节 / 126.8 KiB / 9 个文件** |
| 全内联 onclick、字符串拼 handler | 统一 `addEventListener`，商店/兵种栏/升级面板都由配置自动生成 |
| 无配置、无测试、无 CI | `config/game.json` 单一配置源 + 22 个单测 + GitHub Actions |

## 目录结构

```
index.html                    页面骨架（只剩结构）
styles/main.css               样式
config/game.json              ★ 唯一配置源，调数值改这里
config/README.md              每个配置字段的含义
src/config.generated.js       由 build 脚本生成，必须提交
src/config.js                 配置访问、升级倍率计算
src/timing.js                 固定步长累加器
src/rng.js                    可注入的确定性随机源
src/state.js                  纯状态 / 单位工厂
src/simulation.js             纯逻辑：step / 出兵 / 升级（可单测，不碰 DOM）
src/assets.js                 素材加载、闪白贴图、超时降级
src/render.js                 Canvas 绘制与线稿替身
src/ui.js                     DOM 绑定、面板、快捷键
src/main.js                   装配与主循环
scripts/                      配置生成 / 静态服务 / 素材校验（含 WebP 头解析）
docs/ARCHITECTURE.md          分层、状态机、时间约定与扩展点
tests/                         node:test，22 个用例
.github/workflows/ci.yml       CI
```

分层原则：`simulation.js` 与 `state.js` 不引用任何 DOM，所以能在 Node 里直接推演整局；渲染与 UI 只读状态。

## 改数值

```bash
vim config/game.json       # 改兵种、经济、AI、升级、布局
npm run build              # 重新生成 src/config.generated.js
npm run check              # 生成 + 22 个测试 + 素材字节/尺寸校验
git add config/game.json src/config.generated.js
```

`src/config.generated.js` 要一起提交（Pages 直出静态文件，运行时不跑构建）。CI 会比对两者，漂移直接失败。加新兵种只改配置和素材，UI 会自动长出来，详见 `config/README.md`。

## 操作

| 操作 | 键 |
| --- | --- |
| 出兵 7 兵种 | `1`–`7`，或点底部图标 / 商店卡片 |
| 进攻 / 固守 | `A` / `D`（按钮有选中态） |
| 暂停 / 继续 | `P` |
| 关闭面板 | `Esc` |
| 开始对局 | `Enter` |

## 结算统计

对局结束的浮层会给出用时、我方出兵数、运矿趟数、敌方出兵数，全部来自 `state.stats`（纯逻辑层累加，重开归零）。想加别的指标，在 `simulation.js` 里累加、在 `ui.js` 的 `showEnd()` 里读即可，不用碰渲染。

## GitHub Pages

当前 Pages 配置是 **legacy / `main` 分支 / 根目录**，所以 push 到 `main` 就会自动发布，不需要额外的部署工作流；CI 只负责保证推上去的代码是能跑的。仓库根目录留了 `.nojekyll`，避免 Jekyll 过滤文件。所有资源都用相对路径，适配项目站 `/stick-war/` 前缀。

## 已知限制

- 升级在**出兵时快照**，已出场单位不回溯加成；想全军生效需要重开或扩展为动态倍率
- 没有音效、存档、多人、难度选择；AI 只有一套节奏曲线
- 素材沿用 v1，未声明来源与授权，仓库也还没有 LICENSE
- 单位只有一维 x 轴，没有纵深、碰撞体积与寻路

以上都留作后续迭代的入口。
