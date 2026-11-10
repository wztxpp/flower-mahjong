// 复用花麻将原始万牌 PNG 与裁剪坐标；源文件保持原样，纸色只在显示时归一化。
// Reuse Flower Mahjong's original wan PNG and crops; keep source bytes intact and normalize only displayed paper.
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

// 与花麻将/成麻 SVG 使用相同的 sRGB 纸色规则；不把已有红黑笔画重新画成字体。
// Match Flower/Chengdu SVG paper correction in sRGB; never substitute fonts for original red/black ink.
export const WAN_PAPER_RGB = [255, 245, 223];
export const WAN_PAPER_START = 200;
export const WAN_PAPER_END = 240;

// 输入一组可变 RGBA 字节，原地处理近白纸色并返回同一数组；alpha 和深色墨迹不变。
// Mutate and return RGBA bytes, blending only near-white paper; alpha and dark ink stay untouched.
export function normalizeWanPaper(pixels) {
  for (let i = 0; i < pixels.length; i += 4) {
    const minimumChannel = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
    const weight = Math.max(0, Math.min(1, (minimumChannel - WAN_PAPER_START) / (WAN_PAPER_END - WAN_PAPER_START)));
    for (let channel = 0; channel < 3; channel++) {
      pixels[i + channel] = Math.round(pixels[i + channel] * (1 - weight) + WAN_PAPER_RGB[channel] * weight);
    }
  }
  return pixels;
}

// 加载时只建立一次显示图集。原始 PNG 不写回，九张纹理共用校正后的临时 Canvas。
// Build one display atlas on load; never rewrite the PNG, and share the corrected canvas across all nine faces.
export function createWanDisplayAtlas(image, createCanvas) {
  const canvas = createCanvas();
  canvas.width = MAHJONG_WAN_WIDTH;
  canvas.height = MAHJONG_WAN_HEIGHT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Wan tile canvas is unavailable');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  normalizeWanPaper(imageData.data);
  context.putImageData(imageData, 0, 0);
  return canvas;
}

// 只处理一至九万；无图集或无效输入不画任何内容，由调用方保留加载占位。
// Draw only ranks one through nine of wan; unavailable/invalid faces remain a loading placeholder.
export function paintWanFace(context, width, height, tile, atlas) {
  if (!atlas || !tile || tile.suit !== 'wan' || !Number.isInteger(tile.rank) || tile.rank < 1 || tile.rank > 9) return false;
  const [left, top, sourceWidth, sourceHeight] = WAN_FACE_CROPS[tile.rank - 1];
  context.save();
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#fff5df';
  context.fillRect(0, 0, width, height);
  context.drawImage(atlas, left, top, sourceWidth, sourceHeight, 0, 0, width, height);
  context.strokeStyle = '#fff5df';
  context.lineWidth = 4;
  context.strokeRect(0, 0, width, height);
  context.restore();
  return true;
}
