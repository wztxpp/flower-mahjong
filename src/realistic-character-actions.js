// 写实右手局部替换：底图脸/身体保持固定，仅在已审核的袖臂联合蒙版内清除旧手并画真实供体。
// Local right-arm replacement keeps the base face/body fixed and clears the old arm only inside the reviewed sleeve/arm union.
// Canvas输出包含整张固定底图，展示动作时替代img；透明供体不能仅source-over，否则会留下第二只手。
// Output includes the fixed base and replaces the img during action; source-over alone would leave a duplicate old hand.
import { loadMotionImage } from './portrait-motion/images.js';
import { maskAlpha } from './portrait-motion/renderer.js';
export const REALISTIC_ACTION_MAX_PIXELS = 250000;
export const REALISTIC_ACTION_FRAME_MS = 120;

// 路径限定同角色同视角，像素/帧数有限；本层不读取牌面，也不凭素材推断合法动作。
// Paths stay within one identity/view and dimensions/frame counts are bounded; art never reads tiles or infers legality.
export function validateRealisticAction(descriptor) {
  if (!descriptor || descriptor.approved !== true || !['sweet', 'elegant', 'honest', 'landlord', 'wealthy', 'star'].includes(descriptor.id) ||
    !['front', 'left', 'right'].includes(descriptor.view)) return false;
  const prefix = `/characters/realistic/${descriptor.id}/${descriptor.view}`;
  if (descriptor.baseUrl !== `${prefix}-base.png` || descriptor.sheetUrl !== `${prefix}-actions.png`) return false;
  if (descriptor.cleanPlateUrl !== undefined && descriptor.cleanPlateUrl !== `${prefix}-clean-plate.png`) return false;
  for (const [width, height] of [[descriptor.width, descriptor.height], [descriptor.sheetWidth, descriptor.sheetHeight]]) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 4000000) return false;
  }
  if (!Array.isArray(descriptor.frames) || descriptor.frames.length < 4 || descriptor.frames.length > 12 ||
    !Array.isArray(descriptor.maskPolygon) || descriptor.maskPolygon.length < 3 || descriptor.maskPolygon.length > 40 ||
    !Number.isFinite(descriptor.featherPx) || descriptor.featherPx < 2 || descriptor.featherPx > 16) return false;
  const validPoint = (point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) &&
    point[0] >= 0 && point[1] >= 0 && point[0] <= descriptor.width && point[1] <= descriptor.height;
  if (!descriptor.maskPolygon.every(validPoint)) return false;
  return descriptor.frames.every((frame) => {
    if (!frame || typeof frame !== 'object') return false;
    const { sourceRect } = frame;
    if (descriptor.cleanPlateUrl && (!Array.isArray(frame.maskPolygon) || frame.maskPolygon.length < 3 ||
      frame.maskPolygon.length > 40 || !frame.maskPolygon.every(validPoint))) return false;
    return Array.isArray(sourceRect) && sourceRect.length === 4 && sourceRect.every(Number.isFinite) &&
    sourceRect[0] >= 0 && sourceRect[1] >= 0 && sourceRect[2] > 0 && sourceRect[3] > 0 &&
    sourceRect[0] + sourceRect[2] <= descriptor.sheetWidth && sourceRect[1] + sourceRect[3] <= descriptor.sheetHeight;
  });
}

// 摸牌反向取回，其他公开打/碰/杠使用前向伸手；共用同一真实序列，不宣称分别绘制动作。
// Drawing reverses the reach, while discard/peng/kong use forward reach; these reuse one authored sequence, not distinct artwork.
export function realisticHandFrame(actionType, elapsedMs, frameCount = 4) {
  const type = ['mingGang', 'anGang', 'buGang', 'addGang'].includes(actionType) ? 'gang' : actionType;
  if (!['draw', 'discard', 'peng', 'gang', 'hu'].includes(type) || !Number.isFinite(elapsedMs) || elapsedMs < 0 ||
    !Number.isInteger(frameCount) || frameCount < 4 || frameCount > 12) return null;
  const index = Math.floor(elapsedMs / REALISTIC_ACTION_FRAME_MS);
  if (index >= frameCount) return null;
  return type === 'draw' ? frameCount - 1 - index : index;
}

export class RealisticActionRenderer {
  constructor(canvas, descriptor, environment = globalThis) {
    this.canvas = canvas;
    this.descriptor = descriptor;
    this.environment = environment;
    this.disposed = false;
    this.base = null;
    this.sheet = null;
    this.cleanPlate = null;
    this.frameMasks = [];
    this.mask = null;
    this.patch = null;
    this.lastFrame = null;
  }

  // 共享有界图片队列；每次await之后检查释放状态，迟到结果不能复活旧视角。
  // Use the bounded shared image queue and check disposal after each await so late results cannot revive an old view.
  async prepare() {
    const descriptor = this.descriptor;
    if (!validateRealisticAction(descriptor)) throw new Error('Invalid realistic action descriptor');
    const base = await loadMotionImage(descriptor.baseUrl, this.environment);
    if (this.disposed) return false;
    const sheet = await loadMotionImage(descriptor.sheetUrl, this.environment);
    if (this.disposed) return false;
    if (base.naturalWidth !== descriptor.width || base.naturalHeight !== descriptor.height ||
      sheet.naturalWidth !== descriptor.sheetWidth || sheet.naturalHeight !== descriptor.sheetHeight) throw new Error('Action image dimensions changed');
    this.base = base;
    this.sheet = sheet;
    if (descriptor.cleanPlateUrl) {
      const plate = await loadMotionImage(descriptor.cleanPlateUrl, this.environment);
      if (this.disposed) return false;
      if (plate.naturalWidth !== descriptor.width || plate.naturalHeight !== descriptor.height) throw new Error('Clean plate dimensions changed');
      this.cleanPlate = plate;
    }
    this.resize();
    return true;
  }

  // 输出面积上限约束每人物内存；蒙版只在准备/尺寸改变时计算，不每帧重新算多边形。
  // Cap output area per actor; compute polygon masks only at preparation/resizing, never per frame.
  resize() {
    if (this.disposed || !this.base) return;
    const descriptor = this.descriptor;
    const bounds = this.canvas.getBoundingClientRect?.() || { width: 300, height: 300 };
    const displayScale = Math.max(bounds.width / descriptor.width, bounds.height / descriptor.height, 0.1);
    const scale = Math.min(1, displayScale * 1.5, Math.sqrt(REALISTIC_ACTION_MAX_PIXELS / (descriptor.width * descriptor.height)));
    const width = Math.max(1, Math.floor(descriptor.width * scale));
    const height = Math.max(1, Math.floor(descriptor.height * scale));
    if (this.mask && this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    for (const old of [this.mask, this.patch]) if (old) { old.width = 1; old.height = 1; }
    this.mask = this.environment.document.createElement('canvas');
    this.patch = this.environment.document.createElement('canvas');
    this.mask.width = this.patch.width = width;
    this.mask.height = this.patch.height = height;
    const paintMask = (canvas, polygon) => {
      const context = canvas.getContext('2d');
      const pixels = context.createImageData(width, height);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          pixels.data[(y * width + x) * 4 + 3] = Math.round(255 * maskAlpha((x + 0.5) * descriptor.width / width,
            (y + 0.5) * descriptor.height / height, polygon, descriptor.featherPx));
        }
      }
      context.putImageData(pixels, 0, 0);
    };
    paintMask(this.mask, descriptor.maskPolygon);
    for (const old of this.frameMasks) { old.width = 1; old.height = 1; }
    this.frameMasks = [];
    // 去臂底板模式逐帧只取真实袖臂轮廓；衣服/腰带留在固定底板，不跟随供体闪动。
    // Clean-plate mode samples only each true sleeve/arm silhouette, leaving clothing/belt fixed instead of flickering with donors.
    if (this.cleanPlate) {
      for (const frame of descriptor.frames) {
        const mask = this.environment.document.createElement('canvas');
        mask.width = width;
        mask.height = height;
        paintMask(mask, frame.maskPolygon);
        this.frameMasks.push(mask);
      }
    }
    this.lastFrame = null;
  }

  // 先固定底图，再destination-out旧臂，最后叠已蒙版的真实供体；蒙版外严格不改像素。
  // Draw fixed base, destination-out the old arm, then insert the masked donor; pixels outside the mask stay unchanged.
  draw(frameIndex) {
    if (this.disposed || !this.base || !Number.isInteger(frameIndex) || !this.descriptor.frames[frameIndex]) return false;
    if (this.lastFrame === frameIndex) return true;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const context = this.canvas.getContext('2d');
    const patch = this.patch.getContext('2d');
    patch.globalCompositeOperation = 'source-over';
    patch.clearRect(0, 0, width, height);
    patch.drawImage(this.sheet, ...this.descriptor.frames[frameIndex].sourceRect, 0, 0, width, height);
    patch.globalCompositeOperation = 'destination-in';
    patch.drawImage(this.frameMasks[frameIndex] || this.mask, 0, 0);
    context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, width, height);
    context.drawImage(this.base, 0, 0, width, height);
    context.globalCompositeOperation = 'destination-out';
    context.drawImage(this.mask, 0, 0);
    context.globalCompositeOperation = 'source-over';
    if (this.cleanPlate) {
      // 底板也只允许改动联合蒙版内；即使生成底板的脸漂移，画面仍使用原底图脸。
      // Restrict the clean plate to the union mask too: even if its generated face drifts, the displayed face stays original.
      const plate = this.environment.document.createElement('canvas');
      plate.width = width;
      plate.height = height;
      const plateContext = plate.getContext('2d');
      plateContext.drawImage(this.cleanPlate, 0, 0, width, height);
      plateContext.globalCompositeOperation = 'destination-in';
      plateContext.drawImage(this.mask, 0, 0);
      context.drawImage(plate, 0, 0);
      plate.width = plate.height = 1;
    }
    context.drawImage(this.patch, 0, 0);
    this.lastFrame = frameIndex;
    return true;
  }

  // 重复释放安全；丢弃完整图像引用和局部canvas，不在全局保存已解码图片。
  // Disposal is repeat-safe and drops decoded images/local canvases without a permanent global cache.
  dispose() {
    this.disposed = true;
    this.base = null;
    this.sheet = null;
    this.cleanPlate = null;
    for (const canvas of [this.canvas, this.mask, this.patch, ...this.frameMasks]) if (canvas) { canvas.width = 1; canvas.height = 1; }
    this.frameMasks = [];
    this.mask = null;
    this.patch = null;
  }
}
