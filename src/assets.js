import { ASSET_KEYS, assetPath } from './config.js';

// 两段式超时：软超时只放行「可以开战」，不判失败；硬超时才记入缺失。
// 软超时之后才到达的图片仍会补登记，避免弱网下误画线稿替身。
export function createAssets({ softTimeoutMs = 6000, hardTimeoutMs = 20000, onChange } = {}) {
  const images = new Map();
  const flashes = new Map();
  const missing = new Set();
  let done = 0;
  const total = ASSET_KEYS.length;

  function makeFlash(img) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  function loadOne(key) {
    return new Promise((resolve) => {
      const img = new Image();
      let reported = false;
      let registered = false;

      const register = () => {
        if (registered || !img.naturalWidth) return;
        registered = true;
        images.set(key, img);
        flashes.set(key, makeFlash(img));  // 预生成白色剪影，运行时不再用 ctx.filter
        onChange?.();
      };
      const report = (ok, reason) => {
        if (reported) return;
        reported = true;
        done++;
        resolve({ key, ok, reason, done, total });
      };

      const soft = setTimeout(() => report(true, 'slow'), softTimeoutMs);
      const hard = setTimeout(() => {
        if (!registered) { missing.add(key); onChange?.(); }
        clearTimeout(soft);
        report(false, 'timeout');
      }, hardTimeoutMs);

      img.onload = () => {
        register();
        clearTimeout(soft);
        clearTimeout(hard);
        report(true, 'ok');
      };
      img.onerror = () => {
        clearTimeout(soft);
        clearTimeout(hard);
        missing.add(key);
        onChange?.();
        report(false, 'error');
      };
      img.src = assetPath(key);
    });
  }

  return {
    load(onProgress) {
      return Promise.all(ASSET_KEYS.map((key) => loadOne(key).then((info) => {
        onProgress?.(info.done, info.total, info.key, info.ok, info.reason);
        return info;
      })));
    },
    get: (key) => images.get(key),
    flash: (key) => flashes.get(key),
    isMissing: (key) => missing.has(key),
    missingCount: () => missing.size,
  };
}
