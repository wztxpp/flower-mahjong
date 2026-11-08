// 原图保护的 Canvas2D 局部合成器。原始 img 永不隐藏；这里仅输出眼睑/头发的小块透明覆盖。
// Original-preserving Canvas2D compositor. The original img never hides; only small transparent eye/hair patches are emitted.
// v1保留旧两帧/原纹理兼容；v2仅从已审查的多帧供体/图集摘取局部像素，不能整脸或整图替换。
// Preserve v1 two-frame/original-texture compatibility; v2 extracts only reviewed donor/atlas ROIs, never replacing a face or whole portrait.
import { advanceFrameClock, blinkFrameAt, motionAt as multiFrameMotionAt, portraitPhase } from './timeline.js';
import { loadMotionImage } from './images.js';
import { geometrySourceFromPixels, prepareGeometryField, renderGeometryPixels, validateHairGeometry } from './geometry.js';
export { MOTION_FRAME_MS, portraitPhase } from './timeline.js';
export { loadMotionImage } from './images.js';
export const MOTION_MAX_PIXELS = 350000;
export const MOTION_MAX_PATCH_PIXELS = 4000000;
const CHARACTER_IDS = new Set(['sweet', 'sunny', 'landlord', 'honest', 'wealthy', 'star', 'elegant']);

// 无效参数不能扩张蒙版或产生NaN；异常控制值回到静止原图。
// Invalid controls never expand masks or produce NaN; invalid values return to still-original art.
const clamp = (value, low, high) => Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : 0;

// v1诊断接口保留原先两个端点，不把新中间帧时间轴套到缺乏真实供体的旧素材上。
// Keep the v1 diagnostic interface at its two endpoints, never applying intermediate-frame timing to old art lacking real donors.
export function motionAt(timeMs, phaseKey) {
  if (!Number.isFinite(timeMs) || timeMs < 0) return { blink: 0, hair: 0 };
  const phase = portraitPhase(phaseKey);
  const period = 4800 + phase * 1600;
  const local = (timeMs + phase * period) % period;
  return { blink: local < 120 ? 1 : 0, hair: Math.sin(timeMs / 1650 + phase * Math.PI * 2) };
}

// 目标框必须是图内整数小区域，供体允许小数；面积限制防止损坏配置变成整脸/整图重绘。
// Target rectangles use interior integer pixels; donors may be fractional. Area caps prevent malformed configuration from repainting a whole face/image.
function validRect(rect, width, height, integers = true) {
  return Array.isArray(rect) && rect.length === 4 && rect.every(integers ? Number.isInteger : Number.isFinite) && rect[0] >= 0 && rect[1] >= 0 &&
    rect[2] > 0 && rect[3] > 0 && rect[0] + rect[2] <= width && rect[1] + rect[3] <= height;
}
// 简单非自交多边形保证蒙版意义明确；不能用重叠边或零面积配置绕过局部区域保护。
// Simple non-self-intersecting polygons keep masks meaningful; overlapping edges or zero area cannot bypass region protection.
function validPolygon(polygon, rect) {
  if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > 40 || !polygon.every((point) =>
    Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) && point[0] >= rect[0] &&
    point[0] <= rect[0] + rect[2] && point[1] >= rect[1] && point[1] <= rect[1] + rect[3])) return false;
  let area = 0;
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const onSegment = (a, b, point) => cross(a, b, point) === 0 && point[0] >= Math.min(a[0], b[0]) && point[0] <= Math.max(a[0], b[0]) && point[1] >= Math.min(a[1], b[1]) && point[1] <= Math.max(a[1], b[1]);
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    if (a[0] === b[0] && a[1] === b[1]) return false;
    area += a[0] * b[1] - b[0] * a[1];
    for (let other = index + 2; other < polygon.length; other += 1) {
      if (index === 0 && other === polygon.length - 1) continue;
      const c = polygon[other];
      const d = polygon[(other + 1) % polygon.length];
      if ((cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
        onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) return false;
    }
  }
  return Math.abs(area) >= 2;
}
// 下载前验证只含已知角色/受限局部区域；任何无效字段返回false，由控制器保留原图。
// Before downloads, allow only known roles/bounded local regions; invalid fields return false so the controller keeps original art.
function validateLegacyDescriptor(descriptor) {
  if (!descriptor || !CHARACTER_IDS.has(descriptor.id) || !/^[a-f0-9]{64}$/.test(descriptor.sourceSha256) ||
    !/^[a-f0-9]{64}$/.test(descriptor.closedSha256) || !Number.isInteger(descriptor.width) || !Number.isInteger(descriptor.height) ||
    descriptor.width < 1 || descriptor.height < 1 || descriptor.width * descriptor.height > 4000000 ||
    descriptor.sourceUrl !== `/characters/${descriptor.id}-scene-base.png` ||
    !new RegExp(`^/portrait-motion/${descriptor.id}/[a-z0-9-]+\\.png$`).test(descriptor.closedUrl) ||
    !Number.isInteger(descriptor.closedWidth || descriptor.width) || !Number.isInteger(descriptor.closedHeight || descriptor.height) ||
    (descriptor.closedWidth ?? descriptor.width) <= 0 || (descriptor.closedHeight ?? descriptor.height) <= 0 ||
    (descriptor.closedWidth ?? descriptor.width) * (descriptor.closedHeight ?? descriptor.height) > 4000000 ||
    !Array.isArray(descriptor.eyes) || descriptor.eyes.length !== 2 || !Array.isArray(descriptor.hairRegions) || descriptor.hairRegions.length > 8) return false;
  const area = descriptor.width * descriptor.height;
  let totalArea = 0;
  for (const eye of descriptor.eyes) {
    if (!eye || !validRect(eye.targetRect, descriptor.width, descriptor.height) || !validRect(eye.sourceRect, descriptor.closedWidth || descriptor.width, descriptor.closedHeight || descriptor.height, false) ||
      !validPolygon(eye.maskPolygon, eye.targetRect) || eye.targetRect[2] * eye.targetRect[3] > area * 0.012) return false;
    totalArea += eye.targetRect[2] * eye.targetRect[3];
  }
  for (const region of descriptor.hairRegions) {
    if (!region || !validRect(region.rect, descriptor.width, descriptor.height) || !validPolygon(region.maskPolygon, region.rect) ||
      (region.featherPx !== undefined && (!Number.isFinite(region.featherPx) || region.featherPx < 2 || region.featherPx > 16)) ||
      !Number.isFinite(region.amplitudeX) || !Number.isFinite(region.amplitudeY) || Math.abs(region.amplitudeX) > 8 || Math.abs(region.amplitudeY) > 8) return false;
    totalArea += region.rect[2] * region.rect[3];
  }
  return totalArea <= area * 0.12;
}

// v2允许多个逻辑帧共用同一物理图集，但同URL的尺寸/摘要必须一致，避免重复解码或互相矛盾的供体。
// V2 allows logical frames to share an atlas, but a shared URL must have identical dimensions/hash to avoid repeated decoding or contradictory donors.
function validateMultiFrameDescriptor(descriptor) {
  const geometryMode = descriptor.hairMode === 'geometry';
  if (!CHARACTER_IDS.has(descriptor.id) || descriptor.sourceUrl !== `/characters/${descriptor.id}-scene-base.png` ||
    !/^[a-f0-9]{64}$/.test(descriptor.sourceSha256) || !Number.isInteger(descriptor.width) || !Number.isInteger(descriptor.height) ||
    descriptor.width < 1 || descriptor.height < 1 || descriptor.width * descriptor.height > 4000000 ||
    !Array.isArray(descriptor.frames) || descriptor.frames.length < 2 || descriptor.frames.length > 16 ||
    !Array.isArray(descriptor.eyes) || descriptor.eyes.length !== 2 ||
    !Array.isArray(descriptor.hairRegions) || descriptor.hairRegions.length > 8 ||
    !Array.isArray(descriptor.blinkSequence) || descriptor.blinkSequence.length < 3 || descriptor.blinkSequence.length > 20 ||
    ![undefined, 'frames', 'geometry'].includes(descriptor.hairMode) ||
    (!geometryMode && (!Array.isArray(descriptor.hairSequence) || descriptor.hairSequence.length < 1 || descriptor.hairSequence.length > 9)) ||
    ![undefined, 'discrete', 'linear'].includes(descriptor.hairInterpolation) ||
    (geometryMode && descriptor.hairInterpolation === 'linear')) return false;
  // 几何模式只有原图连续采样，禁止残留非空姿态序列，以免误把烘焙供体当成当前实现。
  // Geometry samples the original continuously; reject leftover pose sequences rather than misrepresenting baked donors as the active implementation.
  if (geometryMode && descriptor.hairSequence !== undefined && (!Array.isArray(descriptor.hairSequence) ||
    descriptor.hairSequence.length !== 1 || descriptor.hairSequence[0]?.frameId !== null || descriptor.hairSequence[0]?.position !== 0)) return false;
  const frames = new Map();
  const urls = new Map();
  for (const frame of descriptor.frames) {
    if (!frame || typeof frame.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9-]{0,31}$/.test(frame.id) || frames.has(frame.id) ||
      !new RegExp(`^/portrait-motion/${descriptor.id}/[a-z0-9-]+\\.png$`).test(frame.url) || !/^[a-f0-9]{64}$/.test(frame.sha256) ||
      !Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width < 1 || frame.height < 1 ||
      frame.width * frame.height > 4000000) return false;
    const previous = urls.get(frame.url);
    if (previous && (previous.width !== frame.width || previous.height !== frame.height || previous.sha256 !== frame.sha256)) return false;
    frames.set(frame.id, frame);
    urls.set(frame.url, frame);
  }
  const eyeFrameIds = new Set();
  let blinkDurationMs = 0;
  for (const step of descriptor.blinkSequence) {
    if (!step || (step.frameId !== null && !frames.has(step.frameId)) ||
      !Number.isFinite(step.durationMs) || step.durationMs < 20 || step.durationMs > 150) return false;
    if (step.frameId !== null) eyeFrameIds.add(step.frameId);
    blinkDurationMs += step.durationMs;
  }
  if (eyeFrameIds.size < 2 || eyeFrameIds.size > 8 || blinkDurationMs < 200 || blinkDurationMs > 600) return false;
  const hairFrameIds = new Set();
  let previousPosition = -Infinity;
  let hasNeutralHair = false;
  for (const step of geometryMode ? [{ frameId: null, position: 0 }] : descriptor.hairSequence) {
    if (!step || (step.frameId !== null && !frames.has(step.frameId)) || !Number.isFinite(step.position) ||
      step.position < -1 || step.position > 1 || step.position <= previousPosition ||
      (step.frameId === null && step.position !== 0) || (step.position === 0 && step.frameId !== null)) return false;
    previousPosition = step.position;
    if (step.frameId === null) hasNeutralHair = true;
    else hairFrameIds.add(step.frameId);
  }
  if (!hasNeutralHair || (descriptor.hairRegions.length === 0 && hairFrameIds.size !== 0) ||
    (!geometryMode && descriptor.hairRegions.length > 0 && (hairFrameIds.size < 2 || descriptor.hairSequence[0].position !== -1 ||
      descriptor.hairSequence.at(-1).position !== 1)) ||
    [...eyeFrameIds].some((id) => hairFrameIds.has(id)) || frames.size !== eyeFrameIds.size + hairFrameIds.size) return false;
  const area = descriptor.width * descriptor.height;
  let totalArea = 0;
  let patchPixels = 0;
  for (const [regions, kind, requiredIds] of [[descriptor.eyes, 'eye', eyeFrameIds], [descriptor.hairRegions, 'hair', hairFrameIds]]) {
    for (const region of regions) {
      const rect = kind === 'eye' ? region?.targetRect : region?.rect;
      if (!region || !validRect(rect, descriptor.width, descriptor.height) || !validPolygon(region.maskPolygon, rect) ||
        (kind === 'hair' && region.featherPx !== undefined && (!Number.isFinite(region.featherPx) || region.featherPx < 2 || region.featherPx > 16)) ||
        (kind === 'eye' && rect[2] * rect[3] > area * 0.012)) return false;
      if (kind === 'hair' && geometryMode) {
        if (!validateHairGeometry(region) || (region.sourceRects !== undefined && (!region.sourceRects ||
          typeof region.sourceRects !== 'object' || Array.isArray(region.sourceRects) || Object.keys(region.sourceRects).length !== 0))) return false;
      } else if (!region.sourceRects || typeof region.sourceRects !== 'object' || Array.isArray(region.sourceRects) ||
        Object.keys(region.sourceRects).length !== requiredIds.size || (kind === 'hair' && region.geometry !== undefined)) return false;
      for (const frameId of requiredIds) {
        const frame = frames.get(frameId);
        if (!Object.hasOwn(region.sourceRects, frameId) || !validRect(region.sourceRects[frameId], frame.width, frame.height, false)) return false;
      }
      totalArea += rect[2] * rect[3];
      // 每区的蒙版、输出、原图ROI和每个真实供体都计入预算，而不只检查一张纹理的面积。
      // Budget the mask, output, original ROI and every real donor per region, rather than checking only one texture's area.
      // 几何分支按RGBA等价预算计入source、位移/alpha/坐标场、ImageData和小输出canvas，包含1px采样护边。
      // Geometry budgets source RGBA, displacement/alpha/coordinate fields, ImageData and its output canvas in RGBA-equivalent pixels, including a one-pixel sampling apron.
      patchPixels += kind === 'hair' && geometryMode ? 6 * (rect[2] + 2) * (rect[3] + 2) : rect[2] * rect[3] * (requiredIds.size + 3);
    }
  }
  return totalArea <= area * 0.12 && patchPixels <= MOTION_MAX_PATCH_PIXELS;
}

// 明确的版本分支：缺版本/1仅接受旧契约，2仅接受多帧契约，未知版本必须静态回退。
// Explicit version dispatch: absent/one accepts only the old contract, two accepts multi-frame data, and unknown versions fall back to static.
export function validateMotionDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') return false;
  if (descriptor.schemaVersion === 2) return validateMultiFrameDescriptor(descriptor);
  if (descriptor.schemaVersion !== undefined && descriptor.schemaVersion !== 1) return false;
  return validateLegacyDescriptor(descriptor);
}

// 点到多边形的有符号距离只在准备阶段计算，用2px内羽化消除接缝；蒙版外alpha永远为零。
// Compute signed polygon distance only during preparation; 2px inward feathering avoids seams and alpha stays zero outside.
export function maskAlpha(x, y, polygon, feather = 2) {
  let inside = false;
  let distance = Infinity;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [ax, ay] = polygon[previous];
    const [bx, by] = polygon[index];
    if (((ay > y) !== (by > y)) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
    const length = (bx - ax) ** 2 + (by - ay) ** 2;
    const along = length ? clamp(((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / length, 0, 1) : 0;
    distance = Math.min(distance, Math.hypot(x - ax - along * (bx - ax), y - ay - along * (by - ay)));
  }
  return inside ? clamp(distance / feather, 0, 1) : 0;
}

export class PortraitMotionRenderer {
  constructor(canvas, onError = () => {}, phaseKey = '', options = {}) {
    this.canvas = canvas;
    this.onError = onError;
    this.phaseKey = phaseKey;
    this.options = options;
    this.environment = options.environment || globalThis;
    this.context = canvas?.getContext('2d');
    if (!this.context) throw new Error('Canvas2D unavailable');
    this.loaded = false;
    this.disposed = false;
    this.running = false;
    this.frame = null;
    this.lastTime = null;
    this.patches = [];
    this.lastControls = { blink: 0, hair: 0 };
    this.resizeObserver = null;
    this.sized = false;
  }

  // 每个补丁只保存自身ROI像素/蒙版；没有每帧全图getImageData，也不生成替代原图。
  // Each patch stores only its ROI pixels/mask; there is no per-frame full-image readback or replacement original.
  makeCanvas(width, height) {
    const canvas = this.environment.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    if (!canvas.getContext('2d')) throw new Error('Patch Canvas2D unavailable');
    return canvas;
  }
  // 仅准备时读一次原图ROI，额外1px护边供双线性采样；临时纹理立即释放，不保存完整Image。
  // Read the original ROI once during preparation, with a one-pixel bilinear apron; release the temporary texture immediately and retain no full Image.
  prepareGeometryPatch(region, image) {
    const [x, y, width, height] = region.rect;
    const left = Math.max(0, x - 1);
    const top = Math.max(0, y - 1);
    const sourceRect = [left, top, Math.min(image.naturalWidth, x + width + 1) - left, Math.min(image.naturalHeight, y + height + 1) - top];
    const texture = this.makeCanvas(sourceRect[2], sourceRect[3]);
    let source;
    try {
      const context = texture.getContext('2d');
      context.drawImage(image, ...sourceRect, 0, 0, sourceRect[2], sourceRect[3]);
      source = geometrySourceFromPixels(context.getImageData(0, 0, sourceRect[2], sourceRect[3]));
    } finally {
      texture.width = 1;
      texture.height = 1;
    }
    return { rect: region.rect, region, kind: 'hair-geometry', output: this.makeCanvas(1, 1), geometry: { source, sourceRect, field: null, pixels: null } };
  }

  // 只读诊断统计真实typed-array字节及小canvas RGBA等价值；没有生产全局，也不重建缓冲或重读源图。
  // Read-only diagnostics report real typed-array bytes and local-canvas RGBA equivalents, without global hooks, buffer rebuilding or source reloading.
  get geometryMemory() {
    const memory = { sourceBytes: 0, fieldBytes: 0, outputBytes: 0, canvasBytes: 0, outputPixels: 0, regions: 0 };
    for (const patch of this.patches) {
      if (!patch.geometry) continue;
      const { source, field, pixels } = patch.geometry;
      memory.regions += 1;
      memory.sourceBytes += source?.data.byteLength || 0;
      if (field) memory.fieldBytes += field.sourceX.byteLength + field.sourceY.byteLength + field.shiftX.byteLength + field.alpha.byteLength;
      memory.outputBytes += pixels?.data.byteLength || 0;
      memory.canvasBytes += patch.output.width * patch.output.height * 4;
      memory.outputPixels += patch.output.width * patch.output.height;
    }
    return { ...memory, totalBytes: memory.sourceBytes + memory.fieldBytes + memory.outputBytes + memory.canvasBytes };
  }

  preparePatch(rect, polygon, image, sourceRect, kind, region = {}) {
    const [x, y, width, height] = rect;
    const texture = this.makeCanvas(width, height);
    texture.getContext('2d').drawImage(image, ...sourceRect, 0, 0, width, height);
    const mask = this.makeCanvas(width, height);
    const context = mask.getContext('2d');
    const pixels = context.createImageData(width, height);
    // 发区可配置更宽的向内羽化以缓和供体色差，眼区固定2px；羽化始终不能扩张多边形。
    // Hair may use wider inward feathering for donor color seams; eyes stay at 2px and feathering never expands a polygon.
    const featherPx = kind === 'hair' ? region.featherPx ?? 2 : 2;
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) pixels.data[(row * width + column) * 4 + 3] = Math.round(maskAlpha(x + column + 0.5, y + row + 0.5, polygon, featherPx) * 255);
    }
    context.putImageData(pixels, 0, 0);
    const patch = { rect, texture, mask, kind, region, output: this.makeCanvas(width, height) };
    if (kind === 'eye') {
      const output = patch.output.getContext('2d');
      output.drawImage(texture, 0, 0);
      output.globalCompositeOperation = 'destination-in';
      output.drawImage(mask, 0, 0);
      output.globalCompositeOperation = 'source-over';
    }
    return patch;
  }
  // 按物理URL顺序加载并立即摘取ROI，所有逻辑帧共享同一次图集解码，不同时保留整套完整供体。
  // Load physical URLs sequentially and immediately extract ROIs; logical frames share one atlas decode instead of retaining all full donors together.
  async load(descriptor) {
    if (this.disposed || !validateMotionDescriptor(descriptor)) throw new Error('Invalid portrait motion regions');
    const loadImage = this.options.loadImage || ((url) => loadMotionImage(url, this.environment));
    this.descriptor = descriptor;
    try {
      let original = await loadImage(descriptor.sourceUrl);
      if (this.disposed) return;
      if (original.naturalWidth !== descriptor.width || original.naturalHeight !== descriptor.height) throw new Error('Portrait dimensions changed');
      this.patches = descriptor.hairRegions.map((region) => descriptor.schemaVersion === 2 && descriptor.hairMode === 'geometry' ?
        this.prepareGeometryPatch(region, original) : this.preparePatch(region.rect, region.maskPolygon, original, region.rect, 'hair', region));
      if (descriptor.schemaVersion === 2) {
        this.patches.push(...descriptor.eyes.map((eye) =>
          this.preparePatch(eye.targetRect, eye.maskPolygon, original, eye.targetRect, 'eye', eye)));
        for (const patch of this.patches) patch.frames = new Map();
        this.eyeFrameIds = [...new Set(descriptor.blinkSequence.map((step) => step.frameId).filter((id) => id !== null))];
        this.hairFrameIds = new Set((descriptor.hairSequence || []).map((step) => step.frameId).filter((id) => id !== null));
      }
      // 小区域已复制到canvas，原始完整图不再由renderer或全局缓存持有。
      // Small regions are now copied to canvases; neither renderer nor global cache retains the full original image.
      original = null;
      if (descriptor.schemaVersion === 2) {
        const groups = new Map();
        for (const frame of descriptor.frames) {
          if (!groups.has(frame.url)) groups.set(frame.url, []);
          groups.get(frame.url).push(frame);
        }
        for (const [url, frames] of groups) {
          const image = await loadImage(url);
          if (this.disposed) return;
          if (image.naturalWidth !== frames[0].width || image.naturalHeight !== frames[0].height) throw new Error('Portrait dimensions changed');
          for (const patch of this.patches) {
            const [, , width, height] = patch.rect;
            for (const frame of frames) {
              const sourceRect = patch.region.sourceRects?.[frame.id];
              if (!sourceRect) continue;
              const texture = this.makeCanvas(width, height);
              const context = texture.getContext('2d');
              context.drawImage(image, ...sourceRect, 0, 0, width, height);
              if (patch.kind === 'eye') {
                context.globalCompositeOperation = 'destination-in';
                context.drawImage(patch.mask, 0, 0);
                context.globalCompositeOperation = 'source-over';
              }
              patch.frames.set(frame.id, texture);
            }
          }
        }
      } else {
        const closed = await loadImage(descriptor.closedUrl);
        if (this.disposed) return;
        if (closed.naturalWidth !== (descriptor.closedWidth || descriptor.width) ||
          closed.naturalHeight !== (descriptor.closedHeight || descriptor.height)) throw new Error('Portrait dimensions changed');
        this.patches.push(...descriptor.eyes.map((eye) =>
          this.preparePatch(eye.targetRect, eye.maskPolygon, closed, eye.sourceRect, 'eye')));
      }
      this.loaded = true;
      this.resize();
      this.renderFrame({ blink: 0, hair: 0 });
      if (typeof this.environment.ResizeObserver === 'function') {
        this.resizeObserver = new this.environment.ResizeObserver(() => {
          if (this.disposed || !this.loaded) return;
          try { this.resize(); } catch (error) { this.onError(error); }
        });
        this.resizeObserver.observe(this.canvas);
      }
    } catch (error) {
      this.loaded = false;
      this.releasePatches();
      throw error;
    }
  }

  // 局部canvas也显式缩为1×1再释放引用；失败、关闭和换角都走同一清理，不残留上一角色的图块。
  // Explicitly shrink ROI canvases before releasing references; failure, disable and role changes use the same cleanup without retaining old-role patches.
  releasePatches() {
    for (const patch of this.patches) {
      const canvases = new Set([patch.texture, patch.mask, patch.output, ...(patch.frames?.values() || [])].filter(Boolean));
      for (const canvas of canvases) {
        canvas.width = 1;
        canvas.height = 1;
      }
      patch.frames?.clear();
      if (patch.geometry) {
        patch.geometry.source = null;
        patch.geometry.field = null;
        patch.geometry.pixels = null;
      }
    }
    this.patches.length = 0;
    this.eyeFrameIds = [];
    this.hairFrameIds = new Set();
  }

  // 尺寸变化重建透明输出及几何显示场；普通供体蒙版仍复用，不重新下载或读取原图ROI。
  // Resizing rebuilds transparent output and geometry display fields; ordinary donor masks are reused without downloads or original-ROI readback.
  resize() {
    // 分辨率按实际显示尺寸、1.5上限DPR及面积预算计算；诊断页可显式使用源分辨率进行逐像素验收。
    // Size by actual display, capped 1.5 DPR and area budget; diagnostics may explicitly request source resolution for exact pixel checks.
    const descriptor = this.descriptor;
    const bounds = this.canvas.getBoundingClientRect?.() || { width: descriptor.width, height: descriptor.height };
    const ratio = Math.min(1.5, Math.max(1, this.options.pixelRatio || this.environment.devicePixelRatio || 1));
    const displayScale = this.options.sourceResolution ? 1 : Math.max(bounds.width / descriptor.width, bounds.height / descriptor.height) * ratio;
    const scale = this.options.sourceResolution ? 1 : Math.min(1, displayScale, Math.sqrt((this.options.maxPixels || MOTION_MAX_PIXELS) / (descriptor.width * descriptor.height)));
    const width = Math.max(1, Math.floor(descriptor.width * scale));
    const height = Math.max(1, Math.floor(descriptor.height * scale));
    const sizeChanged = this.canvas.width !== width || this.canvas.height !== height;
    const needsGeometry = this.patches.some((patch) => patch.geometry && !patch.geometry.field);
    // 诊断canvas或默认300×150可能已是目标尺寸；首次几何场仍须准备，不能把“尺寸相同”当成“资源已就绪”。
    // Diagnostic or default 300×150 canvases may already match the target size; first geometry preparation must not be skipped merely because dimensions match.
    if (!sizeChanged && !needsGeometry && this.sized) return;
    if (sizeChanged) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.context.setTransform(this.canvas.width / descriptor.width, 0, 0, this.canvas.height / descriptor.height, 0, 0);
    this.sized = true;
    for (const patch of this.patches) {
      if (!patch.geometry) continue;
      if (!sizeChanged && patch.geometry.field) continue;
      // 先释放旧显示场再重建，原图ROI不重读；真实输出与总画布使用完全同一像素格。
      // Release the old display field before rebuilding without rereading the source ROI; local output uses the final canvas's exact pixel grid.
      patch.geometry.field = null;
      patch.geometry.pixels = null;
      patch.output.width = 1;
      patch.output.height = 1;
      const field = prepareGeometryField(patch.region, this.canvas.width / descriptor.width, this.canvas.height / descriptor.height, patch.geometry.sourceRect);
      patch.output.width = field.width;
      patch.output.height = field.height;
      patch.geometry.field = field;
      patch.geometry.pixels = patch.output.getContext('2d').createImageData(field.width, field.height);
    }
    this.renderFrame(this.lastControls);
  }

  // v2的眼睛始终选择单张真实供体。诊断显式帧ID优先，原图null与未知ID都不画眼睛。
  // V2 eyes always select one real donor. Explicit diagnostic IDs take precedence; null original and unknown IDs draw no eye overlay.
  renderFrame(controls = {}) {
    if (!this.loaded || this.disposed) return;
    if (this.descriptor.schemaVersion !== 2) {
      this.renderLegacyFrame(controls);
      return;
    }
    const blink = clamp(controls?.blink ?? 0, 0, 1);
    let blinkFrameId = null;
    if (Object.hasOwn(controls || {}, 'blinkFrameId')) {
      if (this.eyeFrameIds.includes(controls.blinkFrameId)) blinkFrameId = controls.blinkFrameId;
    } else if (blink > 0) {
      // 数字接口仅便于旧诊断选择真实形态；实际时间轴直接给frameId，绝不把闭合程度当alpha。
      // Numeric controls only help old diagnostics select real shapes; runtime timing supplies frameId directly and never treats closure as alpha.
      const levels = this.eyeFrameIds.length === 4 ? [0.2, 0.5, 0.8, 1] : this.eyeFrameIds.map((_, index) => (index + 1) / this.eyeFrameIds.length);
      let closest = 0;
      for (let index = 1; index < levels.length; index += 1) {
        if (Math.abs(levels[index] - blink) < Math.abs(levels[closest] - blink)) closest = index;
      }
      blinkFrameId = this.eyeFrameIds[closest];
    }
    const hairPosition = clamp(controls?.hairPosition ?? controls?.hair ?? 0, -1, 1);
    let hairFromFrameId = null;
    let hairToFrameId = null;
    let hairMix = 0;
    const hasHairOverride = Object.hasOwn(controls || {}, 'hairFrameId');
    const geometryMode = this.descriptor.hairMode === 'geometry';
    const geometryPosition = hasHairOverride ? 0 : hairPosition;
    if (hasHairOverride) {
      if (this.hairFrameIds.has(controls.hairFrameId)) hairFromFrameId = controls.hairFrameId;
      hairToFrameId = hairFromFrameId;
    } else if (!geometryMode && this.descriptor.hairRegions.length > 0) {
      const sequence = this.descriptor.hairSequence;
      let upperIndex = sequence.findIndex((step) => step.position >= hairPosition);
      if (upperIndex < 0) upperIndex = sequence.length - 1;
      const upper = sequence[upperIndex];
      const lower = sequence[Math.max(0, upperIndex - 1)];
      if (this.descriptor.hairInterpolation === 'linear' && upper.position !== lower.position) {
        hairFromFrameId = lower.frameId;
        hairToFrameId = upper.frameId;
        hairMix = (hairPosition - lower.position) / (upper.position - lower.position);
        if (hairMix === 0) hairToFrameId = hairFromFrameId;
        if (hairMix === 1) hairFromFrameId = hairToFrameId;
      } else {
        hairFromFrameId = hairPosition - lower.position <= upper.position - hairPosition ? lower.frameId : upper.frameId;
        hairToFrameId = hairFromFrameId;
      }
    }
    this.lastControls = { blink, hair: hairPosition, blinkFrameId, hairPosition, hairFromFrameId, hairToFrameId, hairMix };
    if (geometryMode) {
      this.lastControls.hairMode = 'geometry';
      this.lastControls.hairGeometryPosition = geometryPosition;
    }
    if (hasHairOverride) this.lastControls.hairFrameId = hairFromFrameId;
    for (const patch of this.patches) this.context.clearRect(...(patch.geometry?.field?.drawRect || patch.rect));
    this.context.globalAlpha = 1;
    for (const patch of this.patches) {
      const [x, y, width, height] = patch.rect;
      if (patch.kind === 'eye') {
        if (blinkFrameId !== null) this.context.drawImage(patch.frames.get(blinkFrameId), x, y, width, height);
        continue;
      }
      if (patch.geometry) {
        if (geometryPosition === 0 || patch.region.geometry.amplitudeX === 0) continue;
        const { source, field, pixels } = patch.geometry;
        renderGeometryPixels(source, field, geometryPosition, pixels.data);
        patch.output.getContext('2d').putImageData(pixels, 0, 0);
        this.context.drawImage(patch.output, ...field.drawRect);
        continue;
      }
      if (hairFromFrameId === null && hairToFrameId === null) continue;
      const output = patch.output.getContext('2d');
      output.clearRect(0, 0, width, height);
      output.globalAlpha = 1;
      output.drawImage(hairFromFrameId === null ? patch.texture : patch.frames.get(hairFromFrameId), 0, 0);
      // 只有明确配置的头发候选可混合，先完整覆盖ROI再施加一次蒙版；必须另做实际鬼影/脸保护验收。
      // Only explicitly configured hair candidates may blend. Cover the ROI before masking once; real ghosting/face-protection review remains mandatory.
      if (hairFromFrameId !== hairToFrameId) {
        output.globalAlpha = hairMix;
        output.drawImage(hairToFrameId === null ? patch.texture : patch.frames.get(hairToFrameId), 0, 0);
      }
      output.globalAlpha = 1;
      output.globalCompositeOperation = 'destination-in';
      output.drawImage(patch.mask, 0, 0);
      output.globalCompositeOperation = 'source-over';
      this.context.drawImage(patch.output, x, y, width, height);
    }
  }

  // 诊断和动画走同一真实合成路径。先清各ROI；睁眼/零摆幅不画任何像素，非ROI始终透明。
  // Diagnostics and animation use the same compositor. Clear each ROI; open eyes/zero sway emit no pixels and non-ROI stays transparent.
  renderLegacyFrame(controls = {}) {
    if (!this.loaded || this.disposed) return;
    const blink = clamp(controls?.blink ?? 0, 0, 1) >= 0.5 ? 1 : 0;
    const hair = clamp(controls?.hair ?? 0, -1, 1);
    this.lastControls = { blink, hair };
    for (const patch of this.patches) this.context.clearRect(...(patch.geometry?.field?.drawRect || patch.rect));
    for (const patch of this.patches) {
      const [x, y, width, height] = patch.rect;
      if (patch.kind === 'eye') {
        if (blink === 0) continue;
        this.context.globalAlpha = 1;
      } else {
        if (hair === 0) continue;
        const output = patch.output.getContext('2d');
        output.clearRect(0, 0, width, height);
        // 薄条逆采样保留原发丝：发根/两端固定，随高度渐变，位移不超过配置8px安全上限。
        // Thin-strip inverse sampling preserves original strands: fixed roots/ends, smooth height falloff and at most configured 8px safety bound.
        for (let row = 0; row < height; row += 2) {
          const bandHeight = Math.min(2, height - row);
          const weight = Math.sin(Math.PI * (row + bandHeight / 2) / height) ** 2;
          const shiftX = hair * patch.region.amplitudeX * weight;
          const shiftY = hair * patch.region.amplitudeY * weight;
          output.drawImage(patch.texture, 0, clamp(row - shiftY, 0, height - bandHeight), width, bandHeight,
            shiftX, row, width, bandHeight);
        }
        output.globalCompositeOperation = 'destination-in';
        output.drawImage(patch.mask, 0, 0);
        output.globalCompositeOperation = 'source-over';
        this.context.globalAlpha = 1;
      }
      this.context.drawImage(patch.output, x, y, width, height);
    }
    this.context.globalAlpha = 1;
  }
  // 重复启动无副作用；30fps时间格保留RAF余量，短眼帧不会因为每次归零余量而再次降帧。
  // Starting repeatedly is harmless; accumulated 30fps slots preserve RAF remainder rather than dropping short eye frames by resetting each time.
  start() {
    if (this.running || !this.loaded || this.disposed) return;
    if (typeof this.environment.requestAnimationFrame !== 'function') throw new Error('Animation clock unavailable');
    this.running = true;
    this.lastTime = null;
    const tick = (time) => {
      if (!this.running || this.disposed) return;
      try {
        const clock = advanceFrameClock(time, this.lastTime);
        this.lastTime = clock.scheduledTimeMs;
        if (clock.shouldDraw) {
          const controls = this.descriptor.schemaVersion === 2 ? {
            ...multiFrameMotionAt(time, this.phaseKey),
            blinkFrameId: blinkFrameAt(time, this.phaseKey, this.descriptor.blinkSequence),
          } : motionAt(time, this.phaseKey);
          this.renderFrame(controls);
        }
        this.frame = this.environment.requestAnimationFrame(tick);
      } catch (error) {
        try { this.stop(); } finally { this.onError(error); }
      }
    };
    this.frame = this.environment.requestAnimationFrame(tick);
  }
  // 暂停清除覆盖，原img立即独立显示；保留补丁供反应结束/恢复前台后复用。
  // Pausing clears overlays so the independent img shows immediately; retain patches for reaction/foreground resumption.
  stop() {
    this.running = false;
    const frame = this.frame;
    this.frame = null;
    if (frame !== null) this.environment.cancelAnimationFrame?.(frame);
    if (this.loaded && !this.disposed) this.renderFrame({ blink: 0, hair: 0 });
  }
  // 永久失效实例，解绑resize并释放补丁/画布内存；即使暂停失败也完成剩余清理。
  // Permanently invalidate, disconnect resize and release patches/buffers even when stopping itself fails.
  dispose() {
    if (this.disposed) return;
    try { this.stop(); } finally {
      this.disposed = true;
      this.loaded = false;
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      this.releasePatches();
      this.canvas.width = 1;
      this.canvas.height = 1;
    }
  }
}
