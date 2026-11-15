import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG as C } from '../src/config.js';
import { createState, spawnUnit, countTeam, resetMatch } from '../src/state.js';
import { createRng } from '../src/rng.js';
import { step, spawnPlayer, doUpgrade, setDifficulty } from '../src/simulation.js';

const playing = (difficulty = 'normal') => {
  const s = createState(800, 600, difficulty);
  s.phase = 'playing';
  return s;
};
/** AI 完全静音：用于验证「没有发育预算时不会凭空刷兵」。 */
const quiet = (s) => { s.limits.aiPopMax = 0; return s; };
const run = (s, seconds, dt = 1 / 60, seed = 7) => {
  const rng = createRng(seed);
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) step(s, dt, rng);
};
const aiMiners = (s) => s.units.filter((u) => u.team === 1 && u.kind === 'miner' && u.hp > 0);
const aiFighters = (s) => s.units.filter((u) => u.team === 1 && u.kind !== 'miner' && u.hp > 0);

// ── 开局：先发育，不哐哐派兵 ────────────────────────────────────────────

test('开局前几笔 AI 订单全是矿工，战斗兵要等经济铺开', () => {
  const s = playing();
  run(s, 3.0);
  const orders = s.training.filter((t) => t.team === 1);
  assert.ok(orders.length >= 2, `3 秒内应有至少 2 笔决策，实际 ${orders.length}`);
  assert.ok(orders.every((t) => t.type === 'miner'),
    `开局订单应全是矿工，实际 ${orders.map((t) => t.type).join(',')}`);
  assert.equal(aiFighters(s).length, 0, '矿工没铺开前不该有战斗兵');
  assert.equal(s.stats.aiSpawned, 0, '矿工还在训练队列里，尚未出场');
});

test('AI 矿工逐步补到配置目标，并受人口上限约束', () => {
  const s = playing();
  s.aiGold = 100000;
  run(s, 30);
  assert.ok(aiMiners(s).length >= C.ai.minerTargetStart,
    `30 秒应有 ≥${C.ai.minerTargetStart} 个矿工，实际 ${aiMiners(s).length}`);
  assert.ok(aiMiners(s).length <= C.ai.minerTargetEnd + 1,
    `矿工不应无限堆，实际 ${aiMiners(s).length}`);

  const capped = playing();
  capped.aiGold = 100000;
  capped.limits.aiPopMax = 3;
  run(capped, 60);
  assert.ok(countTeam(capped, 1) <= 3, `敌方实际 ${countTeam(capped, 1)} 个单位`);
});

test('aiPopMax=0 时 AI 完全不动：不训练、不升级、不花钱', () => {
  const s = quiet(playing());
  const gold0 = s.aiGold;
  run(s, 30);
  assert.equal(s.training.filter((t) => t.team === 1).length, 0);
  assert.equal(s.stats.aiSpawned, 0);
  assert.equal(s.stats.aiUpgrades, 0);
  assert.equal(s.aiPlanIndex, 0);
  assert.ok(Math.abs(s.aiGold - (gold0 + (C.economy.castleGoldPerSec + C.economy.aiGoldPerSec) * 30)) < 1e-6,
    '只剩被动收入，没有任何主动花费');
});

// ── 真实经济：矿工往返交付产生收入 ─────────────────────────────────────

test('AI 矿工真实往返自家矿脉并交付，收入不再是凭空刷出来的', () => {
  const s = playing();
  // 只留 AI，避免玩家单位打死矿工；给足金币让经济线完整跑起来
  s.homeHp = 1e9;
  s.aiGold = 100000;
  run(s, 40);
  assert.ok(aiMiners(s).length >= C.ai.minerTargetStart);
  assert.ok(s.stats.aiTrips > 0, `AI 矿工一趟都没交付，实际 ${s.stats.aiTrips}`);
  assert.ok(s.stats.aiGoldEarned >= s.stats.aiTrips * C.economy.goldPerTrip - 1e-6,
    '每趟交付金额应等于 goldPerTrip（普通难度 aiIncomeMul=1）');
  assert.equal(s.stats.trips, 0, '玩家没有矿工，玩家趟数必须保持 0');
  for (const u of aiMiners(s)) {
    assert.ok(u.x > s.w * 0.5, `敌方矿工不该跑到我方半场：x=${u.x}`);
  }
});

test('矿工收益随难度倍率放大，被动收入不再是主要来源', () => {
  // 隔离掉 AI 自己的升级决策：直接放一个未升级的矿工跑几趟，
  // 否则 insane 因收入更高会先买背包，把「每趟收益」这个口径搅乱。
  const perTrip = (difficulty) => {
    const s = quiet(playing(difficulty));
    spawnUnit(s, 'miner', 1, null);
    run(s, 8, 1 / 60, 11);
    assert.ok(s.stats.aiTrips > 0, `${difficulty} 应有交付`);
    return s.stats.aiGoldEarned / s.stats.aiTrips;
  };
  const n = perTrip('normal');
  const i = perTrip('insane');
  assert.ok(Math.abs(n - C.economy.goldPerTrip) < 1e-9, `普通每趟 ${n}`);
  assert.ok(Math.abs(i / n - C.match.difficulties.insane.aiIncomeMul) < 1e-9,
    `每趟收益倍率 ${i / n}`);
  assert.ok(C.economy.aiGoldPerSec < C.economy.goldPerTrip,
    '凭空被动收入必须低于一趟矿，否则「发育」没有意义');
});

// ── 科技：独立 Armory、按计划升级、快照生效 ────────────────────────────

test('AI 按 upgradePlan 自己花钱升级，与玩家 Armory 完全隔离', () => {
  const s = playing();
  s.homeHp = 1e9;
  s.aiGold = 100000;
  run(s, 60);
  assert.ok(s.stats.aiUpgrades >= 2, `60 秒内应至少买 2 级科技，实际 ${s.stats.aiUpgrades}`);
  assert.ok(s.aiPlanIndex >= 2);
  assert.ok(s.aiUpgrades.miner.bag >= 1 || s.aiUpgrades.miner.pick >= 1,
    '前两笔科技应投在矿工经济上');
  // 玩家没花过钱，玩家 Armory 必须仍是全 0
  for (const type of Object.keys(s.upgrades)) {
    for (const [stat, lv] of Object.entries(s.upgrades[type])) {
      assert.equal(lv, 0, `玩家 ${type}.${stat} 被 AI 升级污染了`);
    }
  }
  assert.ok(s.upgrades !== s.aiUpgrades, '两份 Armory 不能是同一个对象');
});

test('AI 升级通过训练快照生效：新出场的单位属性真的变高', () => {
  const s = playing();
  s.homeHp = 1e9;
  s.aiGold = 100000;
  s.limits.aiPopMax = 1000;
  // v2.8 起 assault 阶段不买科技，90 秒通常只走到 planIndex=2（miner 背包/镐）。
  // 因此这里以「已买到的前两级矿工科技」验证快照，不强求走到 sword.atk。
  run(s, 120);
  assert.ok(s.aiPlanIndex >= 2, `至少应买完两级矿工科技，实际 planIndex=${s.aiPlanIndex}`);
  assert.ok(s.aiUpgrades.miner.bag >= 1 && s.aiUpgrades.miner.pick >= 1);
  const miners = aiMiners(s);
  assert.ok(miners.length > 0, '应已有矿工出场');
  assert.ok(miners.some((u) => u.goldPerTrip > C.economy.goldPerTrip + 1e-9),
    '背包升级应提高矿工每趟收益');
  assert.ok(miners.some((u) => u.mineDuration < C.economy.mineDurationSec - 1e-9),
    '镐升级应缩短挖掘耗时');
  // 科技线推进到兵种攻防后，快照结构必须真的被 bonusFor 读到。
  // 不依赖「恰好还有剑士活着」——波次里前排会阵亡，直接用同一份快照派生一个单位。
  if (s.aiUpgrades.sword.atk >= 1) {
    const u = spawnUnit(s, 'sword', 1, { sword: { ...s.aiUpgrades.sword } });
    const expected = C.units.sword.dmg *
      (1 + s.aiUpgrades.sword.atk * C.upgrade.dmgPerLevel);
    assert.ok(Math.abs(u.dmg - expected) < 1e-9,
      `AI 升级快照未生效：dmg=${u.dmg}，期望 ${expected}`);
    assert.ok(u.dmg > C.units.sword.dmg + 1e-9, '升级后剑士伤害应高于基础值');
  }
});

test('旧 bug 回归：玩家升级快照必须真的影响训练出的单位', () => {
  const s = quiet(playing());
  s.gold = 10000;
  assert.equal(doUpgrade(s, 'sword', 'atk').ok, true);
  assert.equal(s.upgrades.sword.atk, 1);
  assert.equal(spawnPlayer(s, 'sword').ok, true);
  run(s, C.units.sword.trainSec + 0.1);
  const u = s.units.find((v) => v.team === 0 && v.type === 'sword');
  assert.ok(u, '训练完成后单位应出场');
  const expected = C.units.sword.dmg * (1 + C.upgrade.dmgPerLevel);
  assert.ok(Math.abs(u.dmg - expected) < 1e-9,
    `升级快照未生效：dmg=${u.dmg}，期望 ${expected}`);
});

// ── 难度 / 确定性 / 重开 ───────────────────────────────────────────────

test('难度 aiSpawnMul 缩放训练时长，而不是缩短刷兵间隔', () => {
  // 单步触发决策：enqueue 用的是 step 开头已 += dt 的 elapsed，
  // 因此 due - elapsed 恰好等于 trainSec * mul，没有多跑一步的残差。
  const trainGap = (difficulty) => {
    const s = playing(difficulty);
    s.aiDecisionTimer = 1 / 120;
    step(s, 1 / 60, createRng(1));
    const t = s.training.find((v) => v.team === 1);
    assert.ok(t, `${difficulty} 应在首个决策 tick 下单`);
    assert.equal(t.type, 'miner');
    return t.due - s.elapsed;
  };
  const normal = trainGap('normal');
  const insane = trainGap('insane');
  assert.ok(Math.abs(normal - C.units.miner.trainSec) < 1e-9, `普通训练时长 ${normal}`);
  assert.ok(Math.abs(insane / normal - C.match.difficulties.insane.aiSpawnMul) < 1e-9,
    `训练时长倍率 ${insane / normal}`);
  assert.ok(C.ai.decisionIntervalSec > 0, '决策间隔与出兵节奏解耦');
});

test('AI 发育按秒推进，60Hz 与 120Hz 结果一致', () => {
  const a = playing();
  const b = playing();
  for (const s of [a, b]) { s.homeHp = 1e9; s.aiGold = 100000; }
  run(a, 25, 1 / 60, 5);
  run(b, 25, 1 / 120, 5);
  assert.ok(Math.abs(a.elapsed - b.elapsed) < 1e-9);
  assert.equal(a.stats.aiTrips, b.stats.aiTrips, '运矿趟数不能因帧率不同而变化');
  assert.equal(a.stats.aiUpgrades, b.stats.aiUpgrades, '科技级数不能因帧率不同而变化');
  assert.deepEqual(a.aiUpgrades, b.aiUpgrades);
  assert.ok(Math.abs(a.stats.aiSpawned - b.stats.aiSpawned) <= 1,
    `出兵数差 ${a.stats.aiSpawned} vs ${b.stats.aiSpawned}`);
});

test('重开清空整份 AI 发育状态，难度保留', () => {
  const s = playing();
  s.homeHp = 1e9;
  s.aiGold = 100000;
  run(s, 40);
  assert.ok(s.stats.aiUpgrades > 0 && s.aiPlanIndex > 0);
  setDifficulty(s, 'hard');
  resetMatch(s);
  assert.equal(s.difficulty, 'hard');
  assert.equal(s.aiPlanIndex, 0);
  assert.equal(s.stats.aiUpgrades, 0);
  assert.equal(s.stats.aiTrips, 0);
  assert.equal(s.stats.aiMinersTrained, 0);
  assert.equal(s.aiDecisionTimer, C.ai.decisionIntervalSec);
  assert.equal(s.aiUpgradeTimer, C.ai.upgradeIntervalSec);
  for (const type of Object.keys(s.aiUpgrades)) {
    for (const lv of Object.values(s.aiUpgrades[type])) assert.equal(lv, 0);
  }
});
