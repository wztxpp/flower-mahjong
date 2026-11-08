// 独立资产白名单，不复用旧Live2D模型。只有资产审查后写入的角色才启用；缺项保留原图。
// Independent asset allowlist, never old Live2D models. Only reviewed entries enable motion; missing entries keep original art.
import catalog from '../../public/portrait-motion/catalog.json' with { type: 'json' };
export const PORTRAIT_MOTION_CHARACTERS = Object.freeze(Object.fromEntries(
  Object.entries(catalog).map(([id, descriptor]) => [id, Object.freeze(descriptor)]),
));
export function portraitMotionFor(id) {
  return Object.hasOwn(PORTRAIT_MOTION_CHARACTERS, id) ? PORTRAIT_MOTION_CHARACTERS[id] : null;
}
