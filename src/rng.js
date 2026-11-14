// 可注入的确定性伪随机源：逻辑层只用它，方便测试复现。
export function createRng(seed = 20261114) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    chance: (p) => next() < p,
    pickWeighted(items, weightOf) {
      let total = 0;
      for (const it of items) total += weightOf(it);
      if (total <= 0) return items[0] ?? null;
      let roll = next() * total;
      for (const it of items) {
        roll -= weightOf(it);
        if (roll < 0) return it;
      }
      return items[items.length - 1];
    },
  };
}
