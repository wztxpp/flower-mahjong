// 原图保护的 Canvas2D 局部合成器。原始 img 永不隐藏；这里仅输出眼睑/头发的小块透明覆盖。
// Original-preserving Canvas2D compositor. The original img never hides; only small transparent eye/hair patches are emitted.
// 生成闭眼图只裁 eyes 的 sourceRect；头发只采样原图，不使用重建脸、背景或任何 SDK。
// Generated closed art is cropped only by eye sourceRect; hair samples only the original, without rebuilt faces/backgrounds or SDKs.
export const MOTION_FRAME_MS = 1000 / 24;
export const MOTION_MAX_PIXELS = 350000;
const imagePromises = new Map();
const CHARACTER_IDS = new Set(['sweet', 'sunny', 'landlord', 'honest', 'wealthy', 'star', 'elegant']);

// 同页多座位及开关重启共用一次解码；失败不永远缓存。中止一个座位不能取消另一个座位的图片。
// Seats and restarts share a decode; failures are not cached forever. Disposing one seat cannot cancel another seat's image.
export function loadMotionImage(url, environment = globalThis) {
  if (imagePromises.has(url)) return imagePromises.get(url);
  const pending = new Promise((resolve, reject) => {
    const image = new environment.Image();
    let timeout;
    const finish = (error) => {
      environment.clearTimeout?.(timeout);
      image.onload = null;
      image.onerror = null;
      if (error) reject(error);
      else resolve(image);
    };
    image.onload = () => finish();
    image.onerror = () => finish(new Error('Portrait image unavailable'));
    timeout = environment.setTimeout?.(() => finish(new Error('Portrait image timed out')), 15000);
    image.src = url;
  });
  imagePromises.set(url, pending);
  pending.catch(() => { if (imagePromises.get(url) === pending) imagePromises.delete(url); });
  return pending;
}

// 无效参数不能扩张蒙版或产生 NaN；异常时间/控制值回到原图静止帧。
// Invalid controls must not expand masks or produce NaN; invalid time/control values return to the still original.
const clamp = (value, low, high) => Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : 0;
export function portraitPhase(key) {
  let hash = 2166136261;
  for (const character of String(key)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return (hash % 10000) / 10000;
}
export function motionAt(timeMs, phaseKey) {
  if (!Number.isFinite(timeMs) || timeMs < 0) return { blink: 0, hair: 0 };
  const phase = portraitPhase(phaseKey);
  const period = 4800 + phase * 1600;
  const local = (timeMs + phase * period) % period;
  // 只有原睁眼与ImageGen闭眼两个真实端点，闭眼120ms；不叠化出灰虹膜或伪造半闭形状。
  // Use only original-open/ImageGen-closed endpoints for a 120ms blink, without gray-iris crossfades or invented half-closed shapes.
  const blink = local < 120 ? 1 : 0;
  return { blink, hair: Math.sin(timeMs / 1650 + phase * Math.PI * 2) };
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
export function validateMotionDescriptor(descriptor) {
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
      !Number.isFinite(region.amplitudeX) || !Number.isFinite(region.amplitudeY) || Math.abs(region.amplitudeX) > 8 || Math.abs(region.amplitudeY) > 8) return false;
    totalArea += region.rect[2] * region.rect[3];
  }
  return totalArea <= area * 0.12;
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
    this.lastTime = -Infinity;
    this.patches = [];
    this.lastControls = { blink: 0, hair: 0 };
    this.resizeObserver = null;
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
  preparePatch(rect, polygon, image, sourceRect, kind, region = {}) {
    const [x, y, width, height] = rect;
    const texture = this.makeCanvas(width, height);
    texture.getContext('2d').drawImage(image, ...sourceRect, 0, 0, width, height);
    const mask = this.makeCanvas(width, height);
    const context = mask.getContext('2d');
    const pixels = context.createImageData(width, height);
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) pixels.data[(row * width + column) * 4 + 3] = Math.round(maskAlpha(x + column + 0.5, y + row + 0.5, polygon) * 255);
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
  // 一次并行获取两个端点，准备仅局部的纹理/蒙版；卸载后不接纳迟到图片。
  // Load both endpoints once and prepare local textures/masks; never adopt images that finish after disposal.
  async load(descriptor) {
    if (this.disposed || !validateMotionDescriptor(descriptor)) throw new Error('Invalid portrait motion regions');
    const loadImage = this.options.loadImage || ((url) => loadMotionImage(url, this.environment));
    const [original, closed] = await Promise.all([loadImage(descriptor.sourceUrl), loadImage(descriptor.closedUrl)]);
    if (this.disposed) return;
    if (original.naturalWidth !== descriptor.width || original.naturalHeight !== descriptor.height ||
      closed.naturalWidth !== (descriptor.closedWidth || descriptor.width) || closed.naturalHeight !== (descriptor.closedHeight || descriptor.height)) throw new Error('Portrait dimensions changed');
    this.descriptor = descriptor;
    this.patches = [
      ...descriptor.hairRegions.map((region) => this.preparePatch(region.rect, region.maskPolygon, original, region.rect, 'hair', region)),
      ...descriptor.eyes.map((eye) => this.preparePatch(eye.targetRect, eye.maskPolygon, closed, eye.sourceRect, 'eye')),
    ];
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
  }

  // 尺寸变化只重建透明画布缓冲，不重新下载图片或计算蒙版。
  // Resizing changes only the transparent canvas buffer, without image downloads or mask recomputation.
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
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.context.setTransform(this.canvas.width / descriptor.width, 0, 0, this.canvas.height / descriptor.height, 0, 0);
    this.renderFrame(this.lastControls);
  }

  // 诊断和动画走同一真实合成路径。先清各ROI；睁眼/零摆幅不画任何像素，非ROI始终透明。
  // Diagnostics and animation use the same compositor. Clear each ROI; open eyes/zero sway emit no pixels and non-ROI stays transparent.
  renderFrame(controls = {}) {
    if (!this.loaded || this.disposed) return;
    const blink = clamp(controls?.blink ?? 0, 0, 1) >= 0.5 ? 1 : 0;
    const hair = clamp(controls?.hair ?? 0, -1, 1);
    this.lastControls = { blink, hair };
    for (const patch of this.patches) this.context.clearRect(...patch.rect);
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
  // 重复启动无副作用；RAF只负责调度，24fps门槛控制真正的局部绘制。
  // Starting repeatedly is harmless; RAF schedules while a 24fps gate bounds actual local drawing.
  start() {
    if (this.running || !this.loaded || this.disposed) return;
    if (typeof this.environment.requestAnimationFrame !== 'function') throw new Error('Animation clock unavailable');
    this.running = true;
    this.lastTime = -Infinity;
    const tick = (time) => {
      if (!this.running || this.disposed) return;
      try {
        if (time - this.lastTime >= MOTION_FRAME_MS) {
          this.lastTime = time;
          this.renderFrame(motionAt(time, this.phaseKey));
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
      this.patches.length = 0;
      this.canvas.width = 1;
      this.canvas.height = 1;
    }
  }
}
