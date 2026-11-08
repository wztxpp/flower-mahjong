// 连续局部头发几何候选：只从原图ROI反采样，不混合两种姿态，不访问DOM或整张人物图。
// Continuous local-hair geometry candidate: inverse-sample only the original ROI, without pose crossfades, DOM access or full-portrait processing.
// renderer负责一次读取ROI与显示尺寸；本模块缓存位移/蒙版场，逐帧仅更新同一个小RGBA输出缓冲。
// The renderer owns one-time ROI readback/display sizing; this module caches displacement/mask fields and updates one small reusable RGBA output per frame.
export const HAIR_GEOMETRY_MAX_AMPLITUDE = 24;
export const HAIR_GEOMETRY_MIN_JACOBIAN = 0.05;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// 返回多边形内部到最近边的距离，边界及外部为0；只在准备/测试阶段使用，不放进逐帧循环。
// Return distance to the nearest polygon edge inside, zero on/outside it; preparation/tests use this, never the per-frame loop.
export function polygonInteriorDistance(x, y, polygon) {
  let inside = false;
  let distanceSquared = Infinity;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [ax, ay] = polygon[previous];
    const [bx, by] = polygon[index];
    if (((ay > y) !== (by > y)) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
    const lengthSquared = (bx - ax) ** 2 + (by - ay) ** 2;
    const along = lengthSquared ? clamp(((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / lengthSquared, 0, 1) : 0;
    distanceSquared = Math.min(distanceSquared, (x - ax - along * (bx - ax)) ** 2 + (y - ay - along * (by - ay)) ** 2);
  }
  return inside ? Math.sqrt(distanceSquared) : 0;
}

// 距离函数是1-Lipschitz，smoothstep最大斜率1.5，边界过渡宽2|A|，故vertical的|∂dx/∂x|≤0.75。
// Distance is 1-Lipschitz, smoothstep's maximum slope is 1.5 and the boundary ramp is 2|A|, so vertical |∂dx/∂x| is at most 0.75.
// horizontal另加|A|π/根线跨度项，整体乘明确motionScale；下界<0.05就拒绝，不静默降幅或允许局部折叠。dy始终0。
// Horizontal adds |A|π/pin-span and explicit motionScale multiplies the bound; reject bounds below 0.05 without silent reductions or folds. Vertical displacement is always zero.
export function geometryJacobianLowerBound(region) {
  const amplitude = Math.abs(region?.geometry?.amplitudeX);
  const envelope = region?.geometry?.envelope ?? 'vertical';
  if (!Number.isFinite(amplitude) || !Array.isArray(region?.rect) || !Number.isFinite(region.rect[2]) || region.rect[2] <= 0) return -Infinity;
  if (amplitude === 0) return 1;
  const axis = envelope === 'horizontal' ? 0 : 1;
  const start = region.geometry.pinStart ?? region.rect[axis];
  const end = region.geometry.pinEnd ?? region.rect[axis] + region.rect[axis + 2];
  const scale = region.geometry.motionScale ?? 1;
  return 1 - scale * (0.75 + (envelope === 'horizontal' ? amplitude * Math.PI / Math.abs(end - start) : 0));
}

// 区域几何已由renderer检验；这里只接受有限水平振幅与两个已实现包络，拒绝未知几何字段。
// The renderer validates region geometry; here accept finite horizontal amplitude and the two implemented envelopes, rejecting unknown geometry fields.
export function validateHairGeometry(region) {
  const geometry = region?.geometry;
  if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry) || !Array.isArray(region?.rect) || region.rect.length !== 4) return false;
  const axis = geometry.envelope === 'horizontal' ? 0 : 1;
  const start = geometry.pinStart ?? region.rect[axis];
  const end = geometry.pinEnd ?? region.rect[axis] + region.rect[axis + 2];
  const scale = geometry.motionScale ?? 1;
  return Object.keys(geometry).every((key) => ['amplitudeX', 'envelope', 'motionScale', 'pinStart', 'pinEnd'].includes(key)) &&
    Number.isFinite(geometry.amplitudeX) && Math.abs(geometry.amplitudeX) <= HAIR_GEOMETRY_MAX_AMPLITUDE &&
    ['vertical', 'horizontal'].includes(geometry.envelope ?? 'vertical') &&
    Number.isFinite(scale) && scale > 0 && scale <= 1 &&
    Number.isFinite(start) && Number.isFinite(end) && Math.abs(end - start) >= 1 &&
    start >= region.rect[axis] && start <= region.rect[axis] + region.rect[axis + 2] &&
    end >= region.rect[axis] && end <= region.rect[axis] + region.rect[axis + 2] &&
    geometryJacobianLowerBound(region) >= HAIR_GEOMETRY_MIN_JACOBIAN;
}

// 单个原图坐标的单位控制位移。矩形根/末端及真实mask边界全部归零；返回源像素，不是屏幕像素。
// Unit-control displacement at one original-image coordinate. Rectangle roots/ends and actual mask boundaries stay fixed; units are source pixels, not screen pixels.
export function geometryDisplacementAt(region, x, y, distance = polygonInteriorDistance(x, y, region.maskPolygon)) {
  const amplitude = region.geometry.amplitudeX;
  if (distance <= 0 || amplitude === 0) return 0;
  const horizontal = region.geometry.envelope === 'horizontal';
  const axis = horizontal ? 0 : 1;
  const start = region.geometry.pinStart ?? region.rect[axis];
  const end = region.geometry.pinEnd ?? region.rect[axis] + region.rect[axis + 2];
  const along = ((horizontal ? x : y) - start) / (end - start);
  if (along <= 0 || along >= 1) return 0;
  const edge = clamp(distance / (2 * Math.abs(amplitude)), 0, 1);
  const edgeWeight = edge * edge * (3 - 2 * edge);
  return amplitude * (region.geometry.motionScale ?? 1) * Math.sin(Math.PI * along) ** 2 * edgeWeight;
}

// 对齐最终canvas的实际像素格，避免小输出再次缩放；sourceRect可含1px采样护边，输出mask仍不扩大。
// Align to final-canvas pixel cells to avoid rescaling the small output; sourceRect may include a one-pixel sampling apron without expanding the output mask.
export function prepareGeometryField(region, scaleX, scaleY, sourceRect = region.rect) {
  if (!validateHairGeometry(region) || !Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0 || scaleX > 1 || scaleY > 1) {
    throw new Error('Invalid local hair geometry field');
  }
  const [left, top, sourceWidth, sourceHeight] = region.rect;
  const pixelLeft = Math.floor(left * scaleX);
  const pixelTop = Math.floor(top * scaleY);
  const width = Math.ceil((left + sourceWidth) * scaleX) - pixelLeft;
  const height = Math.ceil((top + sourceHeight) * scaleY) - pixelTop;
  const sourceX = new Float32Array(width);
  const sourceY = new Float32Array(height);
  const shiftX = new Float32Array(width * height);
  const alpha = new Uint8ClampedArray(width * height);
  const feather = region.featherPx ?? 2;
  for (let column = 0; column < width; column += 1) sourceX[column] = (pixelLeft + column + 0.5) / scaleX - sourceRect[0] - 0.5;
  for (let row = 0; row < height; row += 1) {
    const y = (pixelTop + row + 0.5) / scaleY;
    sourceY[row] = y - sourceRect[1] - 0.5;
    for (let column = 0; column < width; column += 1) {
      const x = (pixelLeft + column + 0.5) / scaleX;
      const index = row * width + column;
      const distance = polygonInteriorDistance(x, y, region.maskPolygon);
      alpha[index] = Math.round(clamp(distance / feather, 0, 1) * 255);
      shiftX[index] = geometryDisplacementAt(region, x, y, distance);
    }
  }
  return {
    width, height, sourceX, sourceY, shiftX, alpha,
    drawRect: [pixelLeft / scaleX, pixelTop / scaleY, width / scaleX, height / scaleY],
    jacobianLowerBound: geometryJacobianLowerBound(region),
  };
}

// 原图ROI一次性记录是否全不透明；常见场景图走更便宜的RGB分支，透明PNG仍按预乘alpha正确插值。
// Record once whether the original ROI is opaque; ordinary scene art takes a cheaper RGB path while transparent PNGs interpolate premultiplied alpha correctly.
export function geometrySourceFromPixels(pixels) {
  let opaque = true;
  for (let index = 3; index < pixels.data.length; index += 4) {
    if (pixels.data[index] !== 255) { opaque = false; break; }
  }
  return { width: pixels.width, height: pixels.height, data: pixels.data, opaque };
}

// 在复用的output中原地写入双线性反采样结果；每像素只采同一原图的四个邻点，不跨姿态alpha混合。
// Write bilinear inverse samples into reusable output in place; each pixel samples four neighbors from the same original, never alpha-blending poses.
// field在resize时准备；零位与无效控制由renderer不绘制，纯函数仍允许0以便验证精确恒等采样。
// Fields are prepared on resize. The renderer emits nothing for neutral/invalid controls; this pure function accepts zero for exact identity tests.
export function renderGeometryPixels(source, field, position, output) {
  const control = Number.isFinite(position) ? clamp(position, -1, 1) : 0;
  const pixels = source.data;
  for (let row = 0; row < field.height; row += 1) {
    const y = clamp(field.sourceY[row], 0, source.height - 1);
    const y0 = Math.floor(y);
    const y1 = Math.min(y0 + 1, source.height - 1);
    const fractionY = y - y0;
    for (let column = 0; column < field.width; column += 1) {
      const index = row * field.width + column;
      const target = index * 4;
      const mask = field.alpha[index];
      if (mask === 0) {
        output[target] = 0;
        output[target + 1] = 0;
        output[target + 2] = 0;
        output[target + 3] = 0;
        continue;
      }
      const x = clamp(field.sourceX[column] - field.shiftX[index] * control, 0, source.width - 1);
      const x0 = Math.floor(x);
      const x1 = Math.min(x0 + 1, source.width - 1);
      const fractionX = x - x0;
      const a = (y0 * source.width + x0) * 4;
      const b = (y0 * source.width + x1) * 4;
      const c = (y1 * source.width + x0) * 4;
      const d = (y1 * source.width + x1) * 4;
      const weightA = (1 - fractionX) * (1 - fractionY);
      const weightB = fractionX * (1 - fractionY);
      const weightC = (1 - fractionX) * fractionY;
      const weightD = fractionX * fractionY;
      if (source.opaque) {
        for (let channel = 0; channel < 3; channel += 1) {
          output[target + channel] = pixels[a + channel] * weightA + pixels[b + channel] * weightB + pixels[c + channel] * weightC + pixels[d + channel] * weightD;
        }
        output[target + 3] = mask;
      } else {
        const alphaA = pixels[a + 3] * weightA;
        const alphaB = pixels[b + 3] * weightB;
        const alphaC = pixels[c + 3] * weightC;
        const alphaD = pixels[d + 3] * weightD;
        const alpha = alphaA + alphaB + alphaC + alphaD;
        for (let channel = 0; channel < 3; channel += 1) {
          output[target + channel] = alpha > 0 ? (pixels[a + channel] * alphaA + pixels[b + channel] * alphaB + pixels[c + channel] * alphaC + pixels[d + channel] * alphaD) / alpha : 0;
        }
        output[target + 3] = alpha * mask / 255;
      }
    }
  }
  return output;
}
