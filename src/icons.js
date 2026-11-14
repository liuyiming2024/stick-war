import { CONFIG } from './config.js';

const P = CONFIG.presentation;
const TAU = Math.PI * 2;

// 所有矢量元素共用同一套描边色、圆头线帽与「粗描边 + 彩色芯」两层画法。
// Canvas 版在 render.js 的 drawSkeleton() 里，两者造型保持一致。
const SKELETON = `
  <path d="M32 23 L32 41"/>
  <path class="vArmL" d="M32 28 L20 36"/>
  <path class="vArmR" d="M32 28 L44 36"/>
  <path class="vLegL" d="M32 41 L24 58"/>
  <path class="vLegR" d="M32 41 L40 58"/>
`;

function weaponSVG(key) {
  const stroke = `fill="none" stroke="${P.outline}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"`;
  switch (key) {
    case 'sword':
      return `<g class="vWeapon"><path d="M46 34 L56 10" ${stroke} stroke-width="3"/>` +
        `<path d="M52 12 L58 6 L60 8 L55 15 Z" fill="${P.weapon}" stroke="${P.outline}" stroke-width="2"/>` +
        `<path d="M43 32 L49 38" ${stroke}/></g>`;
    case 'spear':
      return `<g class="vWeapon"><path d="M46 44 L54 6" ${stroke} stroke-width="3"/>` +
        `<path d="M54 4 L58 12 L51 12 Z" fill="${P.weapon}" stroke="${P.outline}" stroke-width="2"/></g>`;
    case 'archer':
      return `<g class="vWeapon"><path d="M48 16 Q58 32 48 48" ${stroke} stroke-width="3"/>` +
        `<path d="M48 16 L48 48" ${stroke} stroke-width="1.6"/>` +
        `<path d="M48 32 L40 32" ${stroke} stroke-width="1.6"/></g>`;
    case 'stone':
      return `<g class="vWeapon"><path d="M44 36 Q52 20 56 34" ${stroke} stroke-width="2.4"/>` +
        `<circle cx="56" cy="35" r="4.5" fill="${P.rockDark}" stroke="${P.outline}" stroke-width="2"/></g>`;
    case 'giant':
      return `<g class="vWeapon"><path d="M44 38 L56 8" ${stroke} stroke-width="7"/>` +
        `<path d="M50 12 L58 6" ${stroke} stroke-width="2"/></g>`;
    case 'wizard':
      return `<g class="vWeapon"><path d="M47 46 L53 14" ${stroke} stroke-width="3"/>` +
        `<circle class="vOrb" cx="54" cy="11" r="5" fill="${P.goldColor}" stroke="${P.outline}" stroke-width="2"/></g>`;
    case 'miner':
      return `<g class="vWeapon"><path d="M43 38 L55 20" ${stroke} stroke-width="3"/>` +
        `<path d="M49 18 Q56 14 59 20" ${stroke} stroke-width="3.4"/></g>`;
    default:
      return '';
  }
}

/** 内联 SVG 兵种图标，供兵种栏 / 商店 / 升级面板复用；不产生任何图片请求。 */
export function unitSVG(key, team = 0) {
  const color = team === 0 ? P.playerColor : P.enemyColor;
  return `<svg class="vIcon" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <g stroke="${P.outline}" stroke-width="6.4">${SKELETON}</g>
    <g stroke="${color}" stroke-width="3.2">${SKELETON}</g>
  </g>
  <circle cx="32" cy="15" r="8" fill="${color}" stroke="${P.outline}" stroke-width="3"/>
  ${weaponSVG(key)}
</svg>`;
}

/** 工具按钮图标，与兵种图标同一套线性语言。 */
export function toolSVG(kind) {
  if (kind === 'shop') {
    return `<svg class="vIcon vTool" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <path d="M8 26 L32 8 L56 26" fill="none" stroke="${P.outline}" stroke-width="5" stroke-linejoin="round"/>
  <rect x="10" y="26" width="44" height="30" rx="3" fill="${P.rockDark}" stroke="${P.outline}" stroke-width="4"/>
  <circle cx="22" cy="41" r="3.5" fill="${P.goldColor}"/><circle cx="32" cy="41" r="3.5" fill="${P.goldColor}"/><circle cx="42" cy="41" r="3.5" fill="${P.goldColor}"/>
</svg>`;
  }
  return `<svg class="vIcon vTool" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <path d="M32 8 L46 28 L37 28 L37 54 L27 54 L27 28 L18 28 Z" fill="${P.goldColor}" stroke="${P.outline}" stroke-width="4" stroke-linejoin="round"/>
</svg>`;
}

/** 供测试用：每个兵种都必须有矢量图标，且 SVG 里不得引用外部资源。 */
export function hasExternalResource(svg) {
  return /(?:href|src)\s*=\s*["'](?!#)/i.test(svg) || /url\(/i.test(svg) || /\.(?:webp|png|jpe?g|gif|svg)/i.test(svg);
}

export const TAU_RAD = TAU;
