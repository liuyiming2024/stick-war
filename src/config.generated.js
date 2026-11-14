// 本文件由 scripts/build-config.mjs 自动生成，请勿手改。
// 修改 config/game.json 后执行 npm run build。
export default Object.freeze({
  "meta": {
    "title": "火柴人战争",
    "version": "2.0.0",
    "subtitle": "固定步长 · 矿工经济闭环 · 兵种独立升级"
  },
  "layout": {
    "statueInset": 74,
    "statueHitRadius": 60,
    "statueHeightRatio": 0.36,
    "groundRatio": 0.76,
    "goldMineXRatio": 0.5,
    "goldMineYRatio": 0.752,
    "spawnInset": 120,
    "defendLineRatio": 0.3,
    "unitHeightRatio": 0.155,
    "giantHeightMul": 1.5,
    "minerHeightMul": 0.95,
    "canvasBottomReserve": 120
  },
  "match": {
    "startingGold": 120,
    "statueHp": 1600,
    "popMax": 20,
    "aiPopMax": 20,
    "fixedStep": 0.016666666666666666,
    "maxFrameDelta": 0.1,
    "statueDamageMul": 0.6,
    "statueAttackIntervalSec": 1.2
  },
  "economy": {
    "goldPerTrip": 6,
    "mineDurationSec": 1.6,
    "mineArriveEps": 8,
    "aiStartGold": 60,
    "aiGoldPerSec": 7
  },
  "upgrade": {
    "cost": 80,
    "maxLevel": 8,
    "dmgPerLevel": 0.15,
    "defReductionPerLevel": 0.12,
    "defFloor": 0.35,
    "cdReductionPerLevel": 0.1,
    "cdFloor": 0.45
  },
  "combat": {
    "separationPxPerSec": 30,
    "hitFlashSec": 0.16,
    "attackAnimSec": 0.23,
    "projectileSpeedPxPerSec": 420,
    "projectileHitRadius": 12,
    "projectileTtlSec": 3
  },
  "ai": {
    "spawnIntervalSec": 3.2,
    "spawnIntervalMinSec": 1.1,
    "rampSec": 90
  },
  "units": {
    "miner": {
      "name": "矿工",
      "desc": "往返金矿与雕像，每趟运回金币",
      "cost": 25,
      "hp": 100,
      "speedPxPerSec": 66,
      "dmg": 0,
      "range": 0,
      "radius": 11,
      "attackIntervalSec": 0,
      "kind": "miner",
      "projectile": null,
      "aiUnlockSec": null,
      "aiWeight": 0
    },
    "sword": {
      "name": "剑士",
      "desc": "近战主力，便宜且成型快",
      "cost": 50,
      "hp": 200,
      "speedPxPerSec": 102,
      "dmg": 14,
      "range": 24,
      "radius": 12,
      "attackIntervalSec": 1.17,
      "kind": "fighter",
      "projectile": null,
      "aiUnlockSec": 0,
      "aiWeight": 5
    },
    "spear": {
      "name": "矛士",
      "desc": "血厚抗线，长兵器先手",
      "cost": 75,
      "hp": 280,
      "speedPxPerSec": 78,
      "dmg": 22,
      "range": 34,
      "radius": 13,
      "attackIntervalSec": 1.33,
      "kind": "fighter",
      "projectile": null,
      "aiUnlockSec": 0,
      "aiWeight": 3
    },
    "archer": {
      "name": "弓箭手",
      "desc": "远程射击，箭矢有飞行时间",
      "cost": 100,
      "hp": 140,
      "speedPxPerSec": 84,
      "dmg": 16,
      "range": 150,
      "radius": 12,
      "attackIntervalSec": 1.5,
      "kind": "fighter",
      "projectile": "arrow",
      "aiUnlockSec": 0,
      "aiWeight": 3
    },
    "stone": {
      "name": "投石兵",
      "desc": "超远程重击，抛物线落石",
      "cost": 140,
      "hp": 180,
      "speedPxPerSec": 72,
      "dmg": 24,
      "range": 170,
      "radius": 12,
      "attackIntervalSec": 1.67,
      "kind": "fighter",
      "projectile": "rock",
      "aiUnlockSec": 20,
      "aiWeight": 1
    },
    "giant": {
      "name": "巨人",
      "desc": "高攻高血，推进缓慢",
      "cost": 175,
      "hp": 700,
      "speedPxPerSec": 39,
      "dmg": 40,
      "range": 30,
      "radius": 17,
      "attackIntervalSec": 1.83,
      "kind": "fighter",
      "projectile": null,
      "aiUnlockSec": 30,
      "aiWeight": 1
    },
    "wizard": {
      "name": "巫师",
      "desc": "高伤法术，脆皮后排",
      "cost": 220,
      "hp": 160,
      "speedPxPerSec": 60,
      "dmg": 30,
      "range": 120,
      "radius": 13,
      "attackIntervalSec": 1.58,
      "kind": "fighter",
      "projectile": "magic",
      "aiUnlockSec": 45,
      "aiWeight": 1
    }
  },
  "presentation": {
    "playerColor": "#4dd35c",
    "enemyColor": "#ff4d4d",
    "goldColor": "#ffd24d",
    "flashAlpha": 0.55,
    "backgroundTint": "rgba(120,180,80,.14)"
  }
});
