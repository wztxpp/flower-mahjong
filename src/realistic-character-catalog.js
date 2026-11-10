// 写实桌角色只按已保存的身份查询，不重新分配座位，也不重命名服务器角色。
// Realistic actors look up saved identities without reassigning seats or renaming server roles.
// sunny 的当前原画是黄色双马尾；sweet 才是粉衣邻家女孩，故排除的是视觉 sunny。
// Current sunny art is the yellow twin-tail girl; sweet is the pink neighbor, so the visual exclusion is sunny.
import { CHARACTER_PORTRAITS } from './character-portraits.js';
import reviewedCatalog from '../public/characters/realistic/catalog.json' with { type: 'json' };

export const REALISTIC_CHARACTER_IDS = Object.freeze(['sweet', 'elegant', 'landlord', 'honest', 'wealthy', 'star']);
export const REALISTIC_CHARACTER_VIEWS = Object.freeze(['front', 'left', 'right']);

// Three.js 复用已审查的独立整身图；旧拼接、POV和局部动作资料已移除。
// Three.js reuses reviewed independent full figures; retired stitching, POV and motion metadata is removed.
export const APPROVED_REALISTIC_VIEWS = Object.freeze(Object.fromEntries(
  Object.entries(reviewedCatalog).map(([id, views]) => [id, Object.freeze(Object.fromEntries(
    Object.entries(views).map(([position, view]) => [position, Object.freeze(view)]),
  ))]),
));

export const REALISTIC_CHARACTERS = Object.freeze(Object.fromEntries(REALISTIC_CHARACTER_IDS.map((id) => [id,
  Object.freeze({ id, sourceUrl: CHARACTER_PORTRAITS[id].base, handedness: 'right', views: APPROVED_REALISTIC_VIEWS[id] || Object.freeze({}) }),
])));

// left/right 指角色在屏幕上的座位；左位朝右、右位朝左，绝不是对原图水平翻转。
// left/right name on-screen seats: left faces right and right faces left, never a horizontal source flip.
export function realisticViewForPosition(position) {
  if (position === 'left' || position === 'right') return position;
  return 'front';
}

// 未知/原型链键不进入目录；未批准视角返回null，交给组件保留真实原画。
// Unknown/prototype keys cannot enter the catalog; unapproved views return null so the component keeps original art.
export function realisticCharacterView(id, position) {
  if (!Object.hasOwn(REALISTIC_CHARACTERS, id)) return null;
  const view = REALISTIC_CHARACTERS[id].views[realisticViewForPosition(position)];
  return view?.approved === true ? view : null;
}

