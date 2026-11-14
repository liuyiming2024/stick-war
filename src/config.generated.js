// 本文件由 scripts/build-config.mjs 自动生成，请勿手改。
// 修改 config/game.json 后执行 npm run build。
export default Object.freeze({
  "meta": {
    "title": "火柴人战争",
    "version": "2.7.1",
    "subtitle": "位图立绘 · 敌方经济发育"
  },
  "layout": {
    "statueInset": 74,
    "statueHitRadius": 60,
    "statueHeightRatio": 0.36,
    "groundRatio": 0.76,
    "goldMines": [
      {
        "xRatio": 0.14,
        "side": 0
      },
      {
        "xRatio": 0.22,
        "side": 0
      },
      {
        "xRatio": 0.3,
        "side": 0
      },
      {
        "xRatio": 0.7,
        "side": 1
      },
      {
        "xRatio": 0.78,
        "side": 1
      },
      {
        "xRatio": 0.86,
        "side": 1
      }
    ],
    "goldMineYRatio": 0.752,
    "goldMineHeightRatio": 0.09,
    "goldMineWidthRatio": 1.25,
    "spawnInset": 120,
    "defendLineRatio": 0.3,
    "fortInsetRatio": 0.6,
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
    "statueAttackIntervalSec": 1.2,
    "fortArcherIntervalSec": 1.1,
    "fortArcherDamage": 12,
    "fortArcherRangeRatio": 0.62,
    "fortArcherPerUnits": 3,
    "difficulties": {
      "normal": {
        "label": "普通",
        "aiIncomeMul": 1,
        "aiSpawnMul": 1,
        "enemyStatueMul": 1
      },
      "hard": {
        "label": "困难",
        "aiIncomeMul": 1.35,
        "aiSpawnMul": 0.8,
        "enemyStatueMul": 1.25
      },
      "insane": {
        "label": "疯狂",
        "aiIncomeMul": 1.7,
        "aiSpawnMul": 0.6,
        "enemyStatueMul": 1.5
      }
    }
  },
  "economy": {
    "goldPerTrip": 6,
    "mineDurationSec": 1.6,
    "mineArriveEps": 8,
    "aiStartGold": 120,
    "aiGoldPerSec": 1.5,
    "castleGoldPerSec": 1,
    "bagPerLevel": 0.2,
    "pickaxePerLevel": 0.2
  },
  "upgrade": {
    "cost": 80,
    "maxLevel": 8,
    "dmgPerLevel": 0.15,
    "defReductionPerLevel": 0.12,
    "defFloor": 0.35,
    "cdReductionPerLevel": 0.1,
    "cdFloor": 0.45,
    "speedPerLevel": 0.1
  },
  "combat": {
    "separationPxPerSec": 30,
    "hitFlashSec": 0.16,
    "attackAnimSec": 0.23,
    "projectileSpeedPxPerSec": 420,
    "projectileHitRadius": 12,
    "projectileTtlSec": 3,
    "damageMatrix": {
      "rangedVsGiant": 0.5,
      "rangedVsSpearton": 0.5,
      "rangedVsStatue": 0.5,
      "archerVsSwordwrath": 1.5
    }
  },
  "ai": {
    "decisionIntervalSec": 1.3,
    "rampSec": 120,
    "minerTargetStart": 3,
    "minerTargetEnd": 6,
    "minerReserveGold": 25,
    "militaryReserveGold": 25,
    "upgradeIntervalSec": 13,
    "upgradeReserveGold": 20,
    "upgradePlan": [
      [
        "miner",
        "bag"
      ],
      [
        "miner",
        "pick"
      ],
      [
        "sword",
        "atk"
      ],
      [
        "archer",
        "atk"
      ],
      [
        "sword",
        "def"
      ],
      [
        "spear",
        "def"
      ],
      [
        "miner",
        "bag"
      ],
      [
        "miner",
        "pick"
      ],
      [
        "stone",
        "atk"
      ],
      [
        "giant",
        "def"
      ],
      [
        "wizard",
        "atk"
      ],
      [
        "sword",
        "spd"
      ],
      [
        "archer",
        "spd"
      ],
      [
        "spear",
        "atk"
      ]
    ]
  },
  "units": {
    "miner": {
      "name": "矿工",
      "desc": "就近往返自家矿脉，每趟运回金币；不能攻击",
      "cost": 25,
      "hp": 100,
      "speedPxPerSec": 66,
      "dmg": 0,
      "range": 0,
      "radius": 11,
      "attackIntervalSec": 0,
      "kind": "miner",
      "projectile": null,
      "trainSec": 4,
      "aiUnlockSec": null,
      "aiWeight": 0
    },
    "sword": {
      "name": "剑士",
      "desc": "最便宜、训练最快的前排，怕弓箭与矛士",
      "cost": 50,
      "hp": 200,
      "speedPxPerSec": 102,
      "dmg": 14,
      "range": 24,
      "radius": 12,
      "attackIntervalSec": 1.17,
      "kind": "fighter",
      "projectile": null,
      "trainSec": 3,
      "aiUnlockSec": 0,
      "aiWeight": 5
    },
    "spear": {
      "name": "矛士",
      "desc": "厚血抗线，盾牌大幅削减远程伤害",
      "cost": 75,
      "hp": 280,
      "speedPxPerSec": 78,
      "dmg": 22,
      "range": 34,
      "radius": 13,
      "attackIntervalSec": 1.33,
      "kind": "fighter",
      "projectile": null,
      "trainSec": 10,
      "aiUnlockSec": 0,
      "aiWeight": 3
    },
    "archer": {
      "name": "弓箭手",
      "desc": "远程射击；克剑士，但打不动巨人与雕像",
      "cost": 100,
      "hp": 140,
      "speedPxPerSec": 84,
      "dmg": 16,
      "range": 150,
      "radius": 12,
      "attackIntervalSec": 1.5,
      "kind": "fighter",
      "projectile": "arrow",
      "trainSec": 8,
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
      "trainSec": 8,
      "aiUnlockSec": 20,
      "aiWeight": 1
    },
    "giant": {
      "name": "巨人",
      "desc": "专拆雕像，训练极慢；近战才能有效击杀",
      "cost": 175,
      "hp": 700,
      "speedPxPerSec": 39,
      "dmg": 40,
      "range": 30,
      "radius": 17,
      "attackIntervalSec": 1.83,
      "kind": "fighter",
      "projectile": null,
      "trainSec": 20,
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
      "trainSec": 20,
      "aiUnlockSec": 45,
      "aiWeight": 1
    }
  },
  "assets": {
    "softTimeoutSec": 6,
    "hardTimeoutSec": 20
  },
  "animation": {
    "walkHz": 1.8,
    "walkLegSwing": 0.46,
    "walkArmSwing": 0.34,
    "breathHz": 0.55,
    "breathRatio": 0.011,
    "bobRatio": 0.014,
    "attackSwingRad": 1.15,
    "mineSwingHz": 2.4,
    "carryBobHz": 2.6,
    "carryBobRatio": 0.018,
    "cloudSpeedPxPerSec": 12,
    "cloudCount": 6,
    "grassSwayHz": 0.9,
    "grassCount": 34,
    "mineGlowHz": 0.35,
    "crystalTwinkleHz": 1.7,
    "statuePulseHz": 0.5,
    "statueShakePx": 4,
    "statueShakeSec": 0.32,
    "goldBurstSec": 0.7,
    "projectileSpinHz": 3.2,
    "fortPulseHz": 0.8,
    "trailDots": 4
  },
  "presentation": {
    "playerColor": "#79d4b0",
    "enemyColor": "#e2796b",
    "goldColor": "#e8b865",
    "flashAlpha": 0.62,
    "outline": "#0d1417",
    "shadow": "rgba(6,10,12,.42)",
    "skyTop": "#141f2b",
    "skyBottom": "#45525a",
    "skyGlow": "#c28a55",
    "sun": "#f0c98a",
    "cloud": "rgba(196,214,222,.14)",
    "hillFar": "#2c3b40",
    "hillNear": "#35474a",
    "hillMist": "rgba(150,176,180,.07)",
    "groundTop": "#4a5742",
    "groundBottom": "#202a24",
    "groundEdge": "#6c8156",
    "grassBlade": "rgba(126,158,104,.5)",
    "soil": "rgba(18,24,20,.34)",
    "stoneLight": "#8d9a99",
    "stoneMid": "#637072",
    "stoneDark": "#3b4748",
    "weapon": "#aebec6",
    "weaponEdge": "#e6f0f2",
    "metalDark": "#5c6d75",
    "bone": "#2a3438",
    "boneLight": "#3d4a4e",
    "wood": "#7a5a3c",
    "cape": "rgba(14,20,23,.55)",
    "goldDark": "#a97426",
    "goldLight": "#ffe0a0",
    "rockDark": "#394039",
    "rockLight": "#5d6659",
    "crack": "rgba(12,18,20,.72)",
    "trailPlayer": "rgba(121,212,176,.75)",
    "trailEnemy": "rgba(226,121,107,.75)",
    "backgroundTint": "rgba(10,16,18,.12)",
    "mineShadow": "rgba(6,10,10,.45)",
    "mineGlow": "rgba(232,184,101,.28)",
    "fortTint": "rgba(110,170,190,.13)"
  }
});
