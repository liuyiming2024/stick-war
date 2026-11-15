// v2.11：localStorage 战绩。无痕模式 / 存储被禁用时自动降级为内存对象，
// 页面不报错、不阻塞开局。纯浏览器层，不进 simulation.js。

const DEFAULTS = {
  wins: 0, losses: 0, matches: 0,
  bestWinSec: null,
  totalGems: 0,
  lastDifficulty: 'normal',
  muted: false,
};

export function createProgress(storageKey) {
  let mem = { ...DEFAULTS };
  let storage = null;
  try {
    storage = window.localStorage;
  } catch { storage = null; }

  function load() {
    if (!storage) return { ...mem };
    try {
      const raw = storage.getItem(storageKey);
      if (!raw) return { ...DEFAULTS };
      const parsed = JSON.parse(raw);
      const out = { ...DEFAULTS };
      for (const [k, def] of Object.entries(DEFAULTS)) {
        const v = parsed[k];
        if (typeof def === 'number') {
          if (Number.isFinite(v) && v >= 0) out[k] = v;
        } else if (def === null) {
          if (Number.isFinite(v) && v >= 0) out[k] = v;
        } else if (typeof def === 'boolean') {
          if (typeof v === 'boolean') out[k] = v;
        } else if (typeof v === 'string' && v.length < 40) {
          out[k] = v;
        }
      }
      mem = out;
      return { ...out };
    } catch { return { ...DEFAULTS }; }
  }

  function save(next) {
    mem = { ...mem, ...next };
    if (!storage) return { ...mem };
    try { storage.setItem(storageKey, JSON.stringify(mem)); } catch { /* 配额满则只留内存 */ }
    return { ...mem };
  }

  /** 一局结束时记录；bestWinSec 只在胜利且更快时更新。 */
  function record(state, result) {
    const p = load();
    const next = {
      matches: p.matches + 1,
      wins: p.wins + (result === 'won' ? 1 : 0),
      losses: p.losses + (result === 'lost' ? 1 : 0),
      totalGems: p.totalGems + Math.max(0, Math.round(state.stats.gemsSpent)),
      lastDifficulty: state.difficulty,
    };
    if (result === 'won' && (p.bestWinSec === null || state.elapsed < p.bestWinSec)) {
      next.bestWinSec = state.elapsed;
    }
    return save(next);
  }

  function setMuted(muted) { return save({ muted: !!muted }); }
  function reset() { return save({ ...DEFAULTS, muted: mem.muted }); }

  return { load, save, record, setMuted, reset, key: storageKey };
}

export function formatClock(seconds) {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const n = Math.floor(seconds);
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}
