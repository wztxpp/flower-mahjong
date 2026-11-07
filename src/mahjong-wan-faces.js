// 用户原始万牌PNG的显示定位；保留原图字节，不重画、补字或改变颜色。
// Presentation coordinates for the user's original wan PNG; no redrawing, substituted glyphs or recoloring.
// 与旧条/筒图集分开，保证旧图与0–17编号保持原样；成都模式万牌沿用18–26。
// Keep separate from the old bamboo/dot atlas and IDs 0–17; Chengdu wan identities use 18–26.
export const MAHJONG_WAN_URL = '/assets/tiles/mahjong-wan-faces-20261107.png';
export const MAHJONG_WAN_WIDTH = 571;
export const MAHJONG_WAN_HEIGHT = 109;
export const MAHJONG_WAN_SOURCE_SHA256 = 'a297105f04baa6e10efb33f6f5370a5a9ab646a379fe5d84050bd269fd5d53d1';

// 每项为原图 [左, 上, 宽, 高]，顺序为一至九万；统一3:4比例避免拉伸文字。
// Source-pixel [left, top, width, height] for one through nine wan; common 3:4 crops avoid glyph stretching.
export const WAN_FACE_CROPS = [
  [57, 24, 51, 68],
  [113, 24, 51, 68],
  [169, 24, 51, 68],
  [224, 24, 51, 68],
  [279, 24, 51, 68],
  [333, 24, 51, 68],
  [388, 24, 51, 68],
  [443, 24, 51, 68],
  [497, 24, 51, 68],
];

// 仅接受18–26整数牌种，返回到60×80视窗的等比变换；隐藏、旧牌或非法值返回null。
// Accept only integer identities 18–26; map proportionally to 60×80, returning null for hidden/old/invalid tiles.
export function wanFaceTransform(tile) {
  if (!Number.isInteger(tile) || tile < 18 || tile > 26) return null;
  const [left, top, width] = WAN_FACE_CROPS[tile - 18];
  const scale = 60 / width;
  return `matrix(${scale} 0 0 ${scale} ${-left * scale} ${-top * scale})`;
}
