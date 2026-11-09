// 写实桌角色只按已保存的身份查询，不重新分配座位，也不重命名服务器角色。
// Realistic actors look up saved identities without reassigning seats or renaming server roles.
// sunny 的当前原画是黄色双马尾；sweet 才是粉衣邻家女孩，故排除的是视觉 sunny。
// Current sunny art is the yellow twin-tail girl; sweet is the pink neighbor, so the visual exclusion is sunny.
import { CHARACTER_PORTRAITS } from './character-portraits.js';
import reviewedCatalog from '../public/characters/realistic/catalog.json' with { type: 'json' };

export const REALISTIC_CHARACTER_IDS = Object.freeze(['sweet', 'elegant', 'landlord', 'honest', 'wealthy', 'star']);
export const REALISTIC_CHARACTER_VIEWS = Object.freeze(['front', 'left', 'right']);

// 只有完成人物一致性、左右饰物、手部和连续帧检查的独立图集才可以加入此表。
// Only independent atlases reviewed for identity, asymmetric accessories, hands and frame continuity belong here.
// 底姿态、眼发及右手动作分别登记；没有action就没有已验收的出手帧，不能冒称整套动作完成。
// Bases, eye/hair motion and right-arm actions are recorded separately; missing action means no accepted hand sequence.
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

