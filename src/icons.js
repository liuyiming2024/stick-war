import { CONFIG } from './config.js';

const P = CONFIG.presentation;

// 与 render.js 同源：深炭剪影 + 细描边收形，阵营色只出现在头带/胸纹/护腕，
// 金属武器用冷灰多边形。所有图标都是自包含内联 SVG，不产生任何资源请求。
const BONES = `
  <path d="M32 41 L32 24"/>
  <path class="vArmL" d="M32 28 L22 36 L18 46"/>
  <path class="vArmR" d="M32 28 L42 36 L46 46"/>
  <path class="vLegL" d="M32 41 L26 50 L24 59"/>
  <path class="vLegR" d="M32 41 L38 50 L40 59"/>
`;

function weaponSVG(key, accent) {
  const O = P.outline, M = P.weapon, E = P.weaponEdge, G = P.goldDark;
  const a = (extra) => `stroke="${O}" stroke-width="1.6" stroke-linejoin="round" ${extra}`;
  switch (key) {
    case 'sword':
      return `<g class="vWeapon">
  <path d="M46 46 L58 12 L60 14 L49 47 Z" fill="${M}" ${a()}/>
  <path d="M58 12 L60 14 L49 47 L46 46 Z" fill="${E}" stroke="none"/>
  <path d="M42 45 L50 45" ${a(`stroke="${G}" stroke-width="3.4"`)}/>
  <path d="M43 48 L47 48" ${a(`stroke="${P.wood}" stroke-width="3"`)}/>
</g>`;
    case 'spear':
      return `<g class="vWeapon">
  <path d="M42 52 L56 8" ${a(`stroke="${P.wood}" stroke-width="3.2"`)}/>
  <path d="M56 6 L60 16 L52 14 Z" fill="${M}" ${a()}/>
  <path d="M56 6 L60 16 L55 12 Z" fill="${E}" stroke="none"/>
</g>`;
    case 'archer':
      return `<g class="vWeapon">
  <path d="M48 18 Q57 32 48 46" fill="none" ${a(`stroke="${P.wood}" stroke-width="3"`)}/>
  <path d="M48 18 L44 32 L48 46" fill="none" ${a(`stroke="${E}" stroke-width="1.4"`)}/>
  <path d="M44 32 L56 32" ${a(`stroke="${M}" stroke-width="1.6"`)}/>
</g>`;
    case 'stone':
      return `<g class="vWeapon">
  <path d="M44 46 Q52 24 57 36" fill="none" ${a(`stroke="${P.wood}" stroke-width="2.4"`)}/>
  <path d="M53 33 L60 34 L58 41 L52 40 Z" fill="${P.rockLight}" ${a()}/>
</g>`;
    case 'giant':
      return `<g class="vWeapon">
  <path d="M44 47 L55 30" ${a(`stroke="${P.wood}" stroke-width="4.4"`)}/>
  <path d="M52 22 L62 24 L62 36 L52 34 Z" fill="${P.metalDark}" ${a()}/>
  <path d="M52 22 L62 24 L57 28 L52 26 Z" fill="${M}" stroke="none"/>
</g>`;
    case 'wizard':
      return `<g class="vWeapon">
  <path d="M45 50 L52 18" ${a(`stroke="${P.wood}" stroke-width="3"`)}/>
  <circle class="vOrb" cx="52" cy="14" r="6" fill="${accent}" ${a()}/>
  <circle cx="50" cy="12" r="2" fill="#fff" stroke="none"/>
</g>`;
    case 'miner':
      return `<g class="vWeapon">
  <path d="M43 48 L54 24" ${a(`stroke="${P.wood}" stroke-width="3.2"`)}/>
  <path d="M47 22 L59 19 L62 27 L52 29 Z" fill="${M}" ${a()}/>
  <path d="M47 22 L59 19 L54 25 Z" fill="${E}" stroke="none"/>
</g>`;
    default:
      return '';
  }
}

/** 内联 SVG 兵种图标：兵种栏 / 商店 / 升级面板共用，不产生任何图片请求。 */
export function unitSVG(key, team = 0) {
  const accent = team === 0 ? P.playerColor : P.enemyColor;
  return `<svg class="vIcon" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <g stroke="${P.outline}" stroke-width="8.2">${BONES}</g>
    <g stroke="${P.bone}" stroke-width="5.2">${BONES}</g>
    <g stroke="${P.boneLight}" stroke-width="2.6">${BONES}</g>
  </g>
  <path d="M25 27 L39 27 L42 40 L22 40 Z" fill="${P.cape}" stroke="${accent}" stroke-width="1.2" opacity=".8"/>
  <rect x="27" y="26" width="10" height="16" rx="4" fill="${P.boneLight}" stroke="${P.outline}" stroke-width="1.8"/>
  <path d="M28 31 L32 34 L36 31" fill="none" stroke="${accent}" stroke-width="1.6"/>
  <rect x="26" y="39" width="12" height="2.4" rx="1" fill="${accent}"/>
  <circle cx="32" cy="15" r="8" fill="${P.bone}" stroke="${P.outline}" stroke-width="2.6"/>
  <path d="M24 14 A8 8 0 0 1 40 14 L40 17 L24 17 Z" fill="${P.metalDark}" stroke="${P.outline}" stroke-width="1.8"/>
  <path d="M32 6 L32 17" stroke="rgba(230,240,242,.5)" stroke-width="1.2"/>
  <path d="M27 17 L30 17 M34 17 L37 17" stroke="${accent}" stroke-width="2" stroke-linecap="round"/>
  ${weaponSVG(key, accent)}
</svg>`;
}

/** 工具按钮图标，与兵种图标同一套线性语言。 */
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

/** 供测试用：每个 SVG 都不得引用外部资源。 */
export function hasExternalResource(svg) {
  return /(?:href|src)\s*=\s*["'](?!#)/i.test(svg) || /url\(/i.test(svg) || /\.(?:webp|png|jpe?g|gif|svg)/i.test(svg);
}
