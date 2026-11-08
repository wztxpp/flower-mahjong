// 固定角色资源目录，只接纳逐个完成模型验收的能力，不把参数名存在当作真实绑定。
// Fixed character resources admit only individually audited bindings, never parameter-name existence.
// 逐人核验模型哈希、Core 绑定及离线视觉后才 available=true；这不是浏览器 GPU 或发布验收。
// Each available role has verified model hashes, Core bindings and offline visuals; this does not imply browser GPU or release acceptance.
const CHARACTER_IDS = ['sweet', 'sunny', 'elegant', 'star', 'wealthy', 'honest', 'landlord'];
// 本次重建资产的独立 Core/离线视觉报告，只有列出的角色可以开始浏览器验收。
// Only the rebuilt roles with independent Core/offline visual reports may enter browser acceptance.
const VERIFIED_MODELS = Object.freeze({
  // 地主：当前帽缘/灰鬓发专项与完整192帧证据，帽子随头但不受侧发参数。
  // Landlord: current hat/temple-hair and full-sequence evidence; the hat follows the head, not side hair.
  landlord: Object.freeze([
    'ParamAngleX', 'ParamAngleY', 'ParamAngleZ',
    'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ',
    'ParamBreath', 'ParamEyeLOpen', 'ParamEyeROpen', 'ParamHairSideL', 'ParamHairSideR',
  ]),
  sweet: Object.freeze([
    'ParamAngleX', 'ParamAngleY', 'ParamAngleZ',
    'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ',
    'ParamBreath', 'ParamEyeLOpen', 'ParamEyeROpen', 'ParamHairSideL', 'ParamHairSideR',
  ]),
  star: Object.freeze([
    'ParamAngleX', 'ParamAngleY', 'ParamAngleZ',
    'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ',
    'ParamBreath', 'ParamEyeLOpen', 'ParamEyeROpen',
    'ParamHairSideL', 'ParamHairSideR',
  ]),
  sunny: Object.freeze([
    'ParamAngleX', 'ParamAngleY', 'ParamAngleZ',
    'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ',
    'ParamBreath', 'ParamEyeLOpen', 'ParamEyeROpen',
    'ParamHairSideL', 'ParamHairSideR',
  ]),
  wealthy: Object.freeze([
    'ParamAngleX', 'ParamAngleY', 'ParamAngleZ',
    'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ',
    'ParamBreath', 'ParamEyeLOpen', 'ParamEyeROpen',
    'ParamHairSideL', 'ParamHairSideR',
  ]),
  honest: Object.freeze([
    'ParamAngleX', 'ParamAngleY', 'ParamAngleZ',
    'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ',
    'ParamBreath', 'ParamEyeLOpen', 'ParamEyeROpen',
    'ParamHairSideL', 'ParamHairSideR',
  ]),
  elegant: Object.freeze([
    'ParamAngleX', 'ParamAngleY', 'ParamAngleZ',
    'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ',
    'ParamBreath', 'ParamEyeLOpen', 'ParamEyeROpen',
    'ParamHairSideL', 'ParamHairSideR',
  ]),
});

export const LIVE2D_CHARACTERS = Object.freeze(Object.fromEntries(CHARACTER_IDS.map((id) => [id, Object.freeze({
  id,
  available: Object.hasOwn(VERIFIED_MODELS, id),
  modelUrl: `/live2d/${id}/character.model3.json`,
  backgroundUrl: `/live2d/${id}/background.png`,
  verifiedBindings: VERIFIED_MODELS[id] || Object.freeze([]),
})])));

// 非目录角色、尚未恢复的模型一律不用 SDK；这不是把别人的皮肤当成缺失角色。
// Unknown or unrestored characters do not use the SDK; a missing role never borrows another role's model.
export function live2DCharacterFor(id) {
  const descriptor = LIVE2D_CHARACTERS[id];
  return descriptor?.available ? descriptor : null;
}
