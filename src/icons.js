import { CONFIG, assetPath } from './config.js?v=2.10.0';

const P = CONFIG.presentation;

// v2.5：兵种立绘全部回到 WebP 位图（原版白色火柴人，透明底）。
// 工具按钮没有对应位图素材，仍用内联 SVG，保持与 UI 同一套描边语言。
export function unitIconHTML(key) {
  return `<img class="unitBmp" src="${assetPath(key)}" alt="" decoding="async">`;
}

/** 供测试用：工具 SVG 不得引用外部资源。 */
export function hasExternalResource(svg) {
  return /(?:href|src)\s*=\s*["'](?!#)/i.test(svg) || /url\(/i.test(svg) || /\.(?:webp|png|jpe?g|gif|svg)/i.test(svg);
}

/** v2.9：宝石图标。刻意不用 .vIcon 类——工具按钮计数断言只管商店/升级两个。 */
export function gemSVG() {
  const O = P.outline;
  return `<svg class="gemIcon" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <path d="M14 22 L22 10 H42 L50 22 L32 54 Z" fill="${P.gem}" stroke="${O}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M14 22 H50 M22 10 L26 22 L32 54 L38 22 L42 10" fill="none" stroke="${P.gemDark}" stroke-width="1.8" stroke-linejoin="round"/>
  <path d="M22 10 L26 22 H14 Z M42 10 L38 22 H50 Z" fill="${P.gemLight}" opacity=".75"/>
  <path d="M26 22 L32 54 L38 22 Z" fill="${P.gemLight}" opacity=".28"/>
</svg>`;
}

/** 工具按钮图标：商店与升级，纯内联矢量，无资源请求。 */
export function toolSVG(kind) {
  const O = P.outline;
  if (kind === 'shop') {
    return `<svg class="vIcon vTool" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <path d="M8 25 L32 8 L56 25" fill="none" stroke="${P.goldColor}" stroke-width="3" stroke-linejoin="round"/>
  <rect x="10" y="25" width="44" height="30" rx="4" fill="${P.bone}" stroke="${O}" stroke-width="3"/>
  <rect x="14" y="29" width="36" height="22" rx="2" fill="${P.boneLight}" stroke="${P.metalDark}" stroke-width="1.2"/>
  <path d="M22 40 h5 M32 40 h5 M42 40 h5" stroke="${P.goldColor}" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M22 46 h20" stroke="${P.metalDark}" stroke-width="1.4"/>
</svg>`;
  }
  return `<svg class="vIcon vTool" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <path d="M32 8 L45 27 L37 27 L37 54 L27 54 L27 27 L19 27 Z" fill="${P.goldColor}" stroke="${O}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M32 12 L32 50" stroke="${P.goldLight}" stroke-width="1.4" opacity=".8"/>
  <circle cx="32" cy="20" r="2.4" fill="${O}"/>
</svg>`;
}
