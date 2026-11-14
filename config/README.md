# 配置说明

`config/game.json` 是**唯一配置源**。改完执行：

```bash
npm run build     # 重新生成 src/config.generated.js
npm test          # 验证数值没有把逻辑跑坏
```

`src/config.generated.js` 是自动生成的产物，**必须一起提交**（Pages 从 main 分支直出，运行时不跑构建）。CI 会校验两者一致，不一致直接失败。

## 各段含义

| 段 | 作用 |
| --- | --- |
| `meta` | 标题与版本号，菜单展示用 |
| `layout` | 雕像位置、判定半径、地面线、金矿位置、驻守线、尺寸比例 |
| `match` | 初始金币、雕像血量、双方人口上限、固定步长、雕像伤害倍率 |
| `economy` | 矿工每趟收益、挖掘耗时、AI 每秒收入 |
| `upgrade` | 升级单价、等级上限、攻/防/速每级增益与下限 |
| `combat` | 单位推挤、受击闪白时长、投射物速度与命中半径 |
| `ai` | 出兵间隔、随时间缩短的节奏（`rampSec` 后压到最小值） |
| `units` | 7 个兵种的全部数值；`aiUnlockSec` 控制 AI 何时解锁该兵种，`aiWeight` 是抽取权重，`null` 权重表示该方不出 |
| `presentation` | 阵营色、闪光透明度等纯视觉常量 |

## 时间单位

v2 里**所有时间量都是秒**，所有速度都是 `px/s`。v1 里「每帧减 1」的冷却、移速、概率已全部移除，所以改配置时不用再换算刷新率。

## 加一个新兵种

1. 在 `units` 里加一项，字段照抄 `sword`，`projectile` 可为 `null` / `arrow` / `rock` / `magic`
2. 把立绘放进 `assets/<key>.webp`，补 `assets/manifest.json`
3. 跑 `npm run build && npm run check`
4. 兵种栏、商店、升级面板会自动出现，不需要改任何 UI 代码

## 口径

`statueHitRadius` 同时供**绘制**和**伤害判定**使用，改这一处即可，不要再出现「画在 74、判定在 160」那种两套坐标。
