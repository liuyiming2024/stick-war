# 配置说明

`config/game.json` 是**唯一配置源**。改完执行：

```bash
npm run build     # 重新生成 src/config.generated.js
npm run check     # 生成 + 40 个单测 + 素材字节/尺寸校验
npm run smoke     # 可选：41 项页面可达性断言
```

`src/config.generated.js` 是自动生成的产物，**必须一起提交**（Pages 从 `main` 分支直出，运行时不跑构建）。CI 用 `git diff --exit-code` 校验两者，漂移直接失败。

`scripts/build-config.mjs` 同时承担结构校验：必填段、单位字段、`trainSec > 0`、难度三档、`damageMatrix` 四个倍率、矿点分布、素材超时。改配置不用手写校验逻辑。

## 各段含义

| 段 | 作用 |
| --- | --- |
| `meta` | 标题与版本号（菜单展示，格式 `x.y.z`） |
| `layout` | 雕像位置与判定半径、地面线、驻守线、堡区位置 `fortInsetRatio`、`goldMines` 矿点数组、矿堆绘制比例、单位尺寸比例 |
| `match` | 初始金币、雕像血量、人口上限、固定步长、雕像伤害倍率、`fortArcher*` 城堡射手、**`difficulties` 三档难度** |
| `economy` | 矿工每趟收益、挖掘耗时、AI 每秒收入、**`castleGoldPerSec` 被动收入**、`bagPerLevel` / `pickaxePerLevel` |
| `upgrade` | 升级单价、等级上限、攻/防/速每级增益、`speedPerLevel` 移速增益与下限 |
| `combat` | 推挤、受击闪白、投射物参数、**`damageMatrix` 克制倍率** |
| `ai` | 出兵间隔、随时间收紧的节奏（`rampSec` 后压到最小值） |
| `units` | 7 个兵种全部数值；`trainSec` 训练时长、`aiUnlockSec` 解锁时间、`aiWeight` 抽取权重、`projectile` 投射物类型、`kind` 决定走矿工还是战斗状态机 |
| `assets` | 素材加载软/硬超时（秒） |
| `presentation` | 阵营色、闪光、矿堆阴影/光晕、堡区着色 |

## 训练队列

- `units.*.trainSec` 是下单到出场的时间；`spawnPlayer()` 立即扣钱并把 `{ type, team, due, upgrades }` 压入 `state.training`
- `due = elapsed + trainSec`；`tickTraining()` 只把 `elapsed - due` 的剩余时间交给新单位，保证不同步长下轨迹一致
- **升级在下单时快照**（浅拷贝 `upgrades[type]`），排队期间再升级不影响该单位
- 人口上限 = `countTeam + pendingTeam`，不能靠排队绕过 `popMax`
- 点队列条目调 `cancelTraining()`，全额退款且不生成幽灵单位

## 三条指令与城堡射手

| 模式 | 行为 |
| --- | --- |
| `attack` | 推进到敌方雕像判定线 |
| `defend` | 守在 `w * defendLineRatio` |
| `garrison` | 全军撤回 `fortX() = statueInset * fortInsetRatio`，不追击不挖矿；堡内单位免疫伤害，输出交给城堡射手 |

`fortArcherPerUnits` 个堡内单位折算 1 名射手，每 `fortArcherIntervalSec` 放一箭（多发时周期按射手数缩短），射程 `w * fortArcherRangeRatio`，伤害 `fortArcherDamage`。渲染层的堡区边界与逻辑层共用同一表达式。

## 克制关系

`combat.damageMatrix` 四个倍率：

| 键 | 作用路径 |
| --- | --- |
| `archerVsSwordwrath` | 弓箭手命中剑士（原版「弓克剑」） |
| `rangedVsSpearton` | **任意**投射物命中矛士（盾挡箭） |
| `rangedVsGiant` | 任意投射物命中巨人 |
| `rangedVsStatue` | 远程兵拆雕像（`statueDamageMul` 之外再乘一次） |

`applyDamage()` 统一处理单位命中；`tickFighter()` 的拆雕像分支单独应用 `rangedVsStatue`。

## 矿工 Armory

`upgradeStats('miner')` 返回 `['bag', 'pick', 'spd']`，其他兵种是 `['atk', 'def', 'spd']`。派生关系在 `src/config.js` 的 `bonusFor()`：

- `goldMul = 1 + bag * bagPerLevel` → `unit.goldPerTrip`
- `mineSpeedMul = 1 + pick * pickaxePerLevel` → `unit.mineDuration = mineDurationSec / mineSpeedMul`
- `speedMul = 1 + spd * speedPerLevel` → `unit.speed`

升级面板、按钮配色、等级文案都由 `upgradeStats()` 自动生成，加新维度只改这一个函数。

## 难度

`match.difficulties` 三档，每档 `{ label, aiIncomeMul, aiSpawnMul, enemyStatueMul }`：

- `aiIncomeMul` 缩放 AI 的（城堡 + 额外）收入
- `aiSpawnMul` 缩放 `aiInterval()` 的结果（越小出兵越密）
- `enemyStatueMul` 在 `createState()` 里作用于 `enemyHp`

`setDifficulty()` 在主菜单选择时写入 `state.difficulty`，`resetMatch()` 保留该字段。非法值回退 `normal`。

## 矿点

`layout.goldMines` 是数组，每项 `{ xRatio, side }`：

- `xRatio` 是画布宽度比例，`side: 0` 归我方、`side: 1` 归敌方；`minePositions(state)` 换算成像素坐标，渲染层与逻辑层共用这一份
- 矿工只从 `side === team` 的矿点里挑：**先按占用数最少，再按距离最近**；交付后清空 `mineIndex`，下一趟重新挑
- 加矿点只需往数组里加一项；`build-config` 会校验两侧都非空、`xRatio ∈ (0,1)`、按 x 递增
- 矿堆是 `render.js` 里的纯矢量绘制，改 `goldMineHeightRatio / goldMineWidthRatio` 即可调大小，不需要新图片

## 时间单位与一致性

**所有时间量都是秒**，所有速度都是 `px/s`。v1 的「每帧减 1」已全部移除。

两处容易踩的坑，都由严格单测守着：

1. 矿工阶段切换**结转剩余 `dt`**（挖掘完成/交付落在步中间时继续行走）
2. 训练完成**只消费 `elapsed - due`**，不白拿一个完整 `dt`

`tests/simulation.test.mjs` 有 60/120Hz 严格一致性断言；`tests/mechanics.test.mjs` 覆盖训练、取消、克制、驻堡、难度。

## 加一个新兵种

1. 在 `units` 里加一项，字段照抄 `sword`，必填 `trainSec`；`projectile` 可为 `null` / `arrow` / `rock` / `magic`
2. 把立绘放进 `assets/<key>.webp`，补 `assets/manifest.json`
3. 跑 `npm run build && npm run check`
4. 兵种栏、商店、升级面板、训练队列、AI 抽取池会自动出现，不需要改 UI 代码

## 口径

`statueHitRadius` 同时供**绘制**和**伤害判定**使用，改这一处即可，不要再出现「画在 74、判定在 160」那种两套坐标。同理 `fortX()` 只在 `simulation.js` 定义一次，渲染层用同一表达式算边界。
