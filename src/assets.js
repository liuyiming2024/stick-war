import { ASSET_KEYS, assetPath, CONFIG } from './config.js?v=2.11.0';

// 位图立绘回归（v2.5）：9 张 WebP（7 兵种 + 雕像 + 战场背景）。
// 两段式超时：软超时只放行「可以开战」，不判失败；硬超时才记入缺失。
// 软超时之后才到达的图片仍会补登记，避免弱网下误画线稿替身。
//
// 加载时一次性预生成三种派生画布，运行时只 drawImage，不做每帧 ctx.filter：
//   flash  —— source-in 纯白剪影，用于受击闪白
//   team:0 —— source-atop 淡青绿叠色，玩家阵营
//   team:1 —— source-atop 砖红叠色，敌方阵营
// 叠色保留原立绘的明暗与描边关系，透明区不受影响。
export function createAssets({ softTimeoutMs = 6000, hardTimeoutMs = 20000, onChange } = {}) {
  const images = new Map();
  const variants = new Map();
  const missing = new Set();
  let done = 0;
  const total = ASSET_KEYS.length;

  function derive(img, color, alpha, op) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = op;
    if (alpha !== 1) g.globalAlpha = alpha;
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  function register(key, img) {
    images.set(key, img);
    variants.set(`${key}:flash`, derive(img, '#ffffff', 1, 'source-in'));
    variants.set(`${key}:0`,
      derive(img, CONFIG.presentation.playerColor, 0.30, 'source-atop'));
    variants.set(`${key}:1`,
      derive(img, CONFIG.presentation.enemyColor, 0.58, 'source-atop'));
    onChange?.();
  }

  function loadOne(key) {
    return new Promise((resolve) => {
      const maxAttempts = Math.max(1, (CONFIG.assets.retryCount ?? 0) + 1);
      let attempt = 0;
      let reported = false;
      let registered = false;
      let img = null;

      const doRegister = () => {
        if (registered || !img?.naturalWidth) return;
        registered = true;
        missing.delete(key);
        register(key, img);
      };
      const report = (ok, reason) => {
        if (reported) return;
        reported = true;
        done++;
        resolve({ key, ok, reason, done, total });
      };

      // 软/硬超时在整次 loadOne 的生命周期里只挂一次，重试不重置。
      const soft = setTimeout(() => report(true, 'slow'), softTimeoutMs);
      const hard = setTimeout(() => {
        if (!registered) { missing.add(key); onChange?.(); }
        clearTimeout(soft);
        report(false, 'timeout');
      }, hardTimeoutMs);

      const start = () => {
        img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          doRegister();                 // 硬超时之后才到达也照样补登记
          clearTimeout(soft);
          clearTimeout(hard);
          report(true, 'ok');
        };
        img.onerror = () => {
          if (attempt + 1 < maxAttempts) {
            attempt++;
            // 换一个 URL 绕开被缓存的失败响应
            setTimeout(start, CONFIG.assets.retryDelayMs);
            return;
          }
          clearTimeout(soft);
          clearTimeout(hard);
          missing.add(key);
          onChange?.();
          report(false, 'error');
        };
        img.src = attempt === 0 ? assetPath(key) : `${assetPath(key)}&retry=${attempt}`;
      };
      start();
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
    /** 阵营染色版本；未加载或该 key 无派生时回退原图。 */
    team: (key, team) => variants.get(`${key}:${team}`) ?? images.get(key),
    flash: (key) => variants.get(`${key}:flash`),
    isMissing: (key) => missing.has(key),
    missingCount: () => missing.size,
    count: () => images.size,
  };
}
