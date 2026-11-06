// 牌面资源和坐标是显示数据，不是游戏规则；保留原图与坐标精度，避免牌面错位。
// Face resources and coordinates are display data, not rules; preserve the original image and precision to avoid misalignment.
// 保留用户提供的原始 JPEG，仅变换视窗，不重画牌面数量、笔触和颜色。
// Exact original artwork supplied by the user. Only the viewport is transformed;
// the JPEG is retained intact so tile counts, brushwork, and colours are not redrawn.
export const MAHJONG_PHOTO_URL = '/assets/tiles/reference-mahjong.jpg';
export const MAHJONG_PHOTO_SOURCE =
  'https://b0.bdstatic.com/ugc/personal_page_ai/MLwwl9fZ-MKPaOZU4DLCuw2593740273fcd0025b048d136e631f45.jpg';

// 去斜后的照片坐标中心：先一至九条，再一至九筒；全部牌面都在 800 × 800 原图中。
// Centers in the deskewed photograph coordinate system (bamboo 1–9, dots 1–9).
// Every requested face is present in the 800 × 800 source photograph.
// 下标对应协议牌种：先九种条，再九种筒；每项为校正后坐标系中的中心。
// Indices match protocol tile IDs: nine bamboo faces followed by nine dots, each with a corrected-coordinate center.
export const PHOTO_FACE_CENTERS = [
  [-192.07, 486.35],
  [-110.8, 488.86],
  [-30.05, 490.28],
  [52.4, 488.68],
  [132.08, 488.03],
  [212.34, 486.94],
  [291.42, 488.27],
  [366.97, 486.88],
  [443.2, 486.94],
  [-192.41, 393.46],
  [-110.37, 393.41],
  [-28.55, 393.94],
  [51.61, 394.31],
  [130.66, 394.55],
  [208.61, 395.24],
  [283.82, 395.65],
  [361.08, 396.35],
  [435.72, 396.72],
];

// 近似平面的照片只需一次仿射校正；一条小鸟视窗略宽，其他裁剪排除照片中的牌边。
// One affine camera correction is sufficient for the nearly planar photo.
// deskewedX = (x - .59y) / 1.2655; deskewedY = (.45x + y) / 1.2655.
// The bird needs a slightly wider viewport; other faces exclude photo tile edges.
// 将原照片中的指定牌面映射到 60 × 80 的 SVG 视窗；只变换显示，不修改照片文件。
// Map one photographed face into a 60 × 80 SVG viewport; transform its display without changing the image file.
export function photoFaceTransform(tile) {
  // 拒绝 null、小数和越界编号，调用者据此显示空白。
  // Reject null, fractional and out-of-range IDs so the caller can render a blank.
  if (!Number.isInteger(tile) || tile < 0 || tile >= PHOTO_FACE_CENTERS.length) return null;
  // deskewedX/deskewedY 是去斜后坐标轴；scaleX/scaleY 是横纵缩放比例，一条小鸟的裁剪窗口稍宽。
  // deskewedX/deskewedY are deskewed axes; scaleX/scaleY are horizontal/vertical scales. The one-bamboo bird needs a wider crop.
  const [deskewedX, deskewedY] = PHOTO_FACE_CENTERS[tile];
  const scaleX = 60 / (tile === 0 ? 78 : 70);
  const scaleY = 80 / (tile === 0 ? 90 : 84);
  const determinant = 1.2655;
  // SVG matrix(a b c d e f)：前四项合成去斜和缩放，最后两项把牌心移到 (30, 40)。
  // SVG matrix(a b c d e f): the first four combine deskew and scale; the last two center the face at (30, 40).
  return `matrix(${scaleX / determinant} ${(scaleY * 0.45) / determinant} ${(-scaleX * 0.59) / determinant} ${scaleY / determinant} ${30 - scaleX * deskewedX} ${40 - scaleY * deskewedY})`;
}
