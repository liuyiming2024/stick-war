import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG as C } from '../src/config.js';
import { createState, resetMatch } from '../src/state.js';
import {
  canAfford, grantGems, spawnPlayer, cancelTraining, doUpgrade,
} from '../src/simulation.js';

const playing = () => {
  const s = createState();
  s.phase = 'playing';
  s.limits.aiPopMax = 0;   // 隔离 AI，纯测玩家经济
  return s;
};

// ── 宝石：免费、无限、可当金币花 ───────────────────────────────────────

test('开局自带宝石，金币起步也更宽裕', () => {
  const s = playing();
  assert.ok(s.gems >= C.gems.starting);
  assert.equal(s.gold, C.match.startingGold);
  assert.ok(C.match.startingGold >= 200, '降难度后起始金币应明显提高');
  assert.ok(s.gems > 0 && Number.isFinite(s.gems));
});

test('领取宝石免费、无冷却、无上限，可无限次调用', () => {
  const s = playing();
  const g0 = s.gems, gold0 = s.gold;
  for (let i = 0; i < 200; i++) {
    const r = grantGems(s);
    assert.equal(r.ok, true);
    assert.equal(r.amount, C.gems.grantAmount);
    assert.equal(r.total, g0 + (i + 1) * C.gems.grantAmount);
  }
  assert.equal(s.gems, g0 + 200 * C.gems.grantAmount);
  assert.equal(s.gold, gold0, '领取宝石不花金币');
  assert.equal(s.stats.gemsGranted, 200, '200 次领取全部生效，没有被冷却拦下');
  // 配置层也禁止任何形式的限制
  assert.ok(!('cooldownSec' in C.gems) && !('maxTotal' in C.gems) && !('cost' in C.gems));
  assert.equal(C.gems.autoSpend, true);
});

test('canAfford 把宝石按 1:1 折算进购买力', () => {
  const s = playing();
  s.gold = 0;
  s.gems = 50;
  assert.equal(canAfford(s, 50), true);
  assert.equal(canAfford(s, 51), false);
  s.gems = 0;
  assert.equal(canAfford(s, 1), false);
  s.gold = 50;
  assert.equal(canAfford(s, 50), true, '金币够时不依赖宝石');
});

test('金币不足时下单自动扣宝石，paid 记录实扣构成', () => {
  const s = playing();
  s.gold = 0;
  s.gems = 100;
  const cost = C.units.sword.cost;
  const r = spawnPlayer(s, 'sword');
  assert.equal(r.ok, true);
  assert.equal(r.paid.fromGold, 0);
  assert.equal(r.paid.gems, cost / C.gems.goldPerGem);
  assert.equal(s.gold, 0);
  assert.equal(s.gems, 100 - cost / C.gems.goldPerGem);
  assert.equal(s.training.length, 1);
  assert.equal(s.stats.gemPayments, 1);
  assert.equal(s.stats.gemsSpent, cost / C.gems.goldPerGem);
});

test('金币部分够时，只补差额、向上取整到整颗宝石', () => {
  const s = playing();
  s.gold = 20;
  s.gems = 100;
  const cost = C.units.sword.cost;
  const r = spawnPlayer(s, 'sword');
  assert.equal(r.ok, true);
  assert.equal(r.paid.fromGold, 20);
  assert.equal(r.paid.gems, Math.ceil((cost - 20) / C.gems.goldPerGem));
  assert.equal(s.gold, 0);
  assert.ok(Number.isInteger(s.gems), '宝石余额必须保持整数');
});

test('金币充足时完全不动宝石', () => {
  const s = playing();
  s.gold = 10000;
  const g0 = s.gems;
  const r = spawnPlayer(s, 'sword');
  assert.equal(r.ok, true);
  assert.equal(r.paid.gems, 0);
  assert.equal(s.gems, g0);
  assert.equal(s.stats.gemPayments, 0);
});

test('取消训练按原路退款，不能把无限宝石洗成金币', () => {
  const s = playing();
  s.gold = 20;
  s.gems = 100;
  const gold0 = s.gold, gems0 = s.gems;
  const r = spawnPlayer(s, 'sword');
  const id = r.trainingId;
  assert.ok(s.gems < gems0, '确实花掉了宝石');
  const back = cancelTraining(s, id);
  assert.equal(back.ok, true);
  assert.equal(back.refund, C.units.sword.cost);
  assert.ok(Math.abs(s.gold - gold0) < 1e-9, '金币原样退回');
  assert.equal(s.gems, gems0, '宝石原样退回，没有变成金币');
  assert.equal(s.training.length, 0);
  assert.equal(s.stats.cancelled, 1);
});

test('升级同样可以用宝石支付', () => {
  const s = playing();
  s.gold = 0;
  s.gems = 100;
  const r = doUpgrade(s, 'sword', 'atk');
  assert.equal(r.ok, true);
  assert.equal(r.paid.gems, C.upgrade.cost / C.gems.goldPerGem);
  assert.equal(s.upgrades.sword.atk, 1);
  assert.equal(s.gems, 100 - C.upgrade.cost / C.gems.goldPerGem);
});

test('金币和宝石都为空时明确提示去领宝石', () => {
  const s = playing();
  s.gold = 0;
  s.gems = 0;
  const r = spawnPlayer(s, 'giant');
  assert.equal(r.ok, false);
  assert.match(r.reason, /宝石/);
  const u = doUpgrade(s, 'sword', 'atk');
  assert.equal(u.ok, false);
  assert.match(u.reason, /宝石/);
});

test('钱不够就再领一次：宝石无限，买满最贵兵种与全部升级', () => {
  const s = playing();
  s.gold = 0;
  s.gems = 0;
  const topUp = (amount) => { while (!canAfford(s, amount)) grantGems(s); };
  topUp(C.units.wizard.cost);
  assert.equal(spawnPlayer(s, 'wizard').ok, true);
  for (let i = 0; i < C.upgrade.maxLevel; i++) {
    topUp(C.upgrade.cost);
    assert.equal(doUpgrade(s, 'giant', 'def').ok, true, `第 ${i + 1} 级升级不该因缺钱失败`);
  }
  assert.equal(s.upgrades.giant.def, C.upgrade.maxLevel);
  assert.ok(s.stats.gemsGranted > 1, '确实触发了多次免费领取，没有总量上限');
  assert.ok(s.gems >= 0, '宝石余额不会被扣成负数');
});

test('重开清空宝石领取/消费统计，但恢复初始赠送', () => {
  const s = playing();
  grantGems(s);
  s.gold = 0;
  spawnPlayer(s, 'sword');
  assert.ok(s.stats.gemsGranted > 0 && s.stats.gemPayments > 0);
  resetMatch(s);
  assert.equal(s.gems, C.gems.starting);
  assert.equal(s.gold, C.match.startingGold);
  assert.equal(s.stats.gemsGranted, 0);
  assert.equal(s.stats.gemPayments, 0);
  assert.equal(s.stats.gemsSpent, 0);
});

// ── 难度整体下调 ────────────────────────────────────────────────────────

test('普通档比疯狂档明显更宽松：收入低、训练慢、敌方雕像薄', () => {
  const n = C.match.difficulties.normal, i = C.match.difficulties.insane;
  assert.ok(n.aiIncomeMul < i.aiIncomeMul, '普通档敌方收入倍率更低');
  assert.ok(n.aiSpawnMul > i.aiSpawnMul, '普通档敌方训练更慢');
  assert.ok(n.enemyStatueMul < i.enemyStatueMul, '普通档敌方雕像更薄');
  assert.ok(n.aiIncomeMul < 1, '普通档敌方收入应低于基准');
});

test('敌方凭空被动收入进一步削弱，首波更小、集结更晚', () => {
  assert.ok(C.economy.aiGoldPerSec <= 1, '凭空收入 ≤1 金/秒');
  assert.ok(C.economy.aiGoldPerSec < C.economy.goldPerTrip, '仍以真实采矿为主');
  assert.ok(C.ai.wave.firstWaveSize <= 3, '首波不超过 3 个');
  assert.ok(C.ai.wave.maxWaveSize <= 6, '波容上限下调');
  assert.ok(C.ai.wave.buildMinSec >= 18, '发育期拉长，开局不会立刻压过来');
  assert.ok(C.ai.wave.regroupSec >= 10, '重整冷却拉长');
});

test('三档难度下玩家都能靠宝石兜底，不会被卡死', () => {
  for (const d of ['normal', 'hard', 'insane']) {
    const s = createState(C.world.width, C.world.height, d);
    s.phase = 'playing';
    s.limits.aiPopMax = 0;
    s.gold = 0;
    assert.equal(spawnPlayer(s, 'giant').ok, true, `${d} 下开局应有宝石兜底`);
  }
});
