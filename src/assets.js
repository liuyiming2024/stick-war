import { ASSET_KEYS, assetPath } from './config.js';

const TIMEOUT_MS = 8000;

export function createAssets() {
  const images = new Map();
  const flashes = new Map();
  const missing = new Set();
  let done = 0;

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
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        done++;
        if (ok && img.naturalWidth) {
          images.set(key, img);
          flashes.set(key, makeFlash(img));   // 预生成白色剪影，运行时不再用 ctx.filter
        } else {
          missing.add(key);
        }
        resolve({ key, ok: ok && !!img.naturalWidth, done, total: ASSET_KEYS.length });
      };
      const timer = setTimeout(() => finish(false), TIMEOUT_MS);
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img.src = assetPath(key);
    });
  }

  return {
    load(onProgress) {
      return Promise.all(ASSET_KEYS.map((key) =>
        loadOne(key).then((info) => { onProgress?.(info.done, info.total, info.key, info.ok); return info; })));
    },
    get: (key) => images.get(key),
    flash: (key) => flashes.get(key),
    isMissing: (key) => missing.has(key),
    missingCount: () => missing.size,
  };
}
