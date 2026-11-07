// 用户提供的十八种牌面图集，只负责显示，不改变牌种编号、规则或存档。
// User-supplied eighteen-face atlas: presentation only, with unchanged tile IDs, rules and saves.
// 原 PNG 原样打包；SVG 视窗排除图外汉字标签，不重画图案或改变颜色。
// Bundle the original PNG unchanged; SVG viewports exclude the surrounding labels without redrawing or recoloring artwork.
export const MAHJONG_PHOTO_URL = '/assets/tiles/mahjong-faces-20261107.png';
export const MAHJONG_PHOTO_SOURCE = 'User-supplied eighteen-face artwork, 2026-11-07';
export const MAHJONG_PHOTO_WIDTH = 1774;
export const MAHJONG_PHOTO_HEIGHT = 887;

// 每项为原图 [左, 上, 宽, 高]；协议顺序仍是一至九条，再一至九筒。
// Each entry is [left, top, width, height] in source pixels, ordered bamboo 1–9 then dots 1–9.
// 原图第二排牌身较矮，使用更紧的 3:4 视窗；所有视窗等比缩放，避免圆圈变椭圆。
// The middle row has shorter tile bodies and uses tighter 3:4 crops; uniform scaling keeps circles round.
export const PHOTO_FACE_CROPS = [
  [936, 70, 174, 232],
  [1204, 70, 174, 232],
  [1485, 70, 174, 232],
  [948, 370, 150, 200],
  [1217, 370, 150, 200],
  [1497, 370, 150, 200],
  [936, 638, 174, 232],
  [1205, 638, 174, 232],
  [1485, 638, 174, 232],
  [114, 70, 174, 232],
  [397, 70, 174, 232],
  [667, 70, 174, 232],
  [126, 370, 150, 200],
  [409, 370, 150, 200],
  [679, 370, 150, 200],
  [114, 638, 174, 232],
  [397, 638, 174, 232],
  [667, 638, 174, 232],
];

// 保留既有中心导出供查看与测试使用；现在是原图像素坐标，不再需要旧照片的去斜。
// Retain the center export for inspection/tests; coordinates are now source pixels, without legacy deskewing.
export const PHOTO_FACE_CENTERS = PHOTO_FACE_CROPS.map(([left, top, width, height]) => [
  left + width / 2,
  top + height / 2,
]);

// 把合法牌种的原图矩形映射到 60 × 80 视窗；不修改输入，非法编号返回 null。
// Map a valid tile's source rectangle into a 60 × 80 viewport without mutation; invalid IDs return null.
export function photoFaceTransform(tile) {
  // 严格整数检查保留 null 隐藏牌语义，不把空值或字符串当作一条。
  // Strict integer checks preserve hidden/null semantics rather than coercing blanks or strings into one bamboo.
  if (!Number.isInteger(tile) || tile < 0 || tile >= PHOTO_FACE_CROPS.length) return null;
  const [left, top, width, height] = PHOTO_FACE_CROPS[tile];
  const scaleX = 60 / width;
  const scaleY = 80 / height;
  // 平移把裁切左上角放到原点；宽高比相同，因此横纵缩放一致。
  // Translation places the crop's upper-left at the origin; matching aspect ratios make both scales equal.
  return `matrix(${scaleX} 0 0 ${scaleY} ${-left * scaleX} ${-top * scaleY})`;
}
