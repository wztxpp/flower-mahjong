// 连续发区采样的真实RGBA/几何单测；验证的是公式和内存缓冲，不是角色美观或浏览器性能。
// Real RGBA/geometry tests for continuous hair sampling; these prove formulas and buffers, not character appearance or browser performance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  geometryDisplacementAt, geometryJacobianLowerBound, geometrySourceFromPixels,
  polygonInteriorDistance, prepareGeometryField, renderGeometryPixels, validateHairGeometry,
} from '../src/portrait-motion/geometry.js';

const rectangle = (x, y, width, height) => [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
const region = () => ({ rect: [0, 0, 100, 100], maskPolygon: rectangle(0, 0, 100, 100), featherPx: 2,
  geometry: { amplitudeX: 24, envelope: 'vertical' } });

// 禁止超振幅/额外位移轴/非法根区间/不安全横向导数；明确motionScale保留根线，不做隐式降幅。
// Reject excess amplitude, extra displacement axes, invalid pin intervals and unsafe horizontal derivatives; explicit motionScale retains root planes without silent reductions.
test('geometry validates amplitudes, signed pin spans, explicit scale and conservative monotone Jacobian bounds', () => {
  assert.equal(validateHairGeometry(region()), true);
  assert.equal(geometryJacobianLowerBound(region()), 0.25);
  for (const geometry of [
    { amplitudeX: 25 }, { amplitudeX: -25 }, { amplitudeX: Infinity }, { amplitudeX: NaN },
    { amplitudeX: 10, amplitudeY: 1 }, { amplitudeX: 10, envelope: 'diagonal' },
    { amplitudeX: 10, motionScale: 0 }, { amplitudeX: 10, motionScale: 1.01 }, { amplitudeX: 10, motionScale: NaN },
    { amplitudeX: 10, pinStart: -1 }, { amplitudeX: 10, pinEnd: 101 },
    { amplitudeX: 10, pinStart: 50, pinEnd: 50 }, { amplitudeX: 10, pinStart: 50, pinEnd: 50.5 },
    { amplitudeX: 24, envelope: 'horizontal' },
  ]) assert.equal(validateHairGeometry({ ...region(), geometry }), false, JSON.stringify(geometry));
  for (const amplitudeX of [-24, 0, 24]) {
    const entry = region();
    entry.geometry = { amplitudeX, envelope: 'horizontal', motionScale: 0.5, pinStart: 90, pinEnd: 10 };
    assert.equal(validateHairGeometry(entry), true);
    assert.ok(geometryJacobianLowerBound(entry) >= 0.05);
  }
});

// 根/肩末端、反向根区间、凹mask边界与外部严格不动；所有内部反采样点留在同一受限ROI。
// Roots/shoulder ends, reversed pin intervals, concave boundaries and outside points stay fixed; all interior inverse samples remain in the bounded ROI.
test('source-space displacement pins roots and boundaries and stays smaller than distance to the mask edge', () => {
  const entry = region();
  entry.maskPolygon = [[0, 0], [100, 0], [100, 100], [60, 100], [60, 40], [40, 40], [40, 100], [0, 100]];
  for (const [x, y] of [[50, 0], [50, 40], [40, 70], [0, 40], [100, 40], [50, 70], [-1, 50], [101, 50]]) {
    assert.equal(geometryDisplacementAt(entry, x, y), 0);
  }
  for (let y = 0; y <= 100; y += 0.5) {
    let previousSample = -1;
    for (let x = 0; x <= 100; x += 0.5) {
      const distance = polygonInteriorDistance(x, y, entry.maskPolygon);
      const dx = geometryDisplacementAt(entry, x, y);
      assert.ok(Math.abs(dx) <= distance + 1e-9);
      const sample = x - dx;
      if (x > 0) assert.ok((sample - previousSample) / 0.5 >= 0.25 - 1e-8);
      previousSample = sample;
    }
  }
  entry.geometry.pinStart = 80;
  entry.geometry.pinEnd = 20;
  for (const y of [0, 20, 80, 100]) assert.equal(geometryDisplacementAt(entry, 20, y), 0);
  assert.ok(geometryDisplacementAt(entry, 20, 50) > 0);
});

// 显示场与实际输出像素格对齐，不根据位移扩mask；缩小后只保留少量像素，原图采样坐标仍是源像素。
// Display fields align to output pixel cells without growing masks; reduced displays use few pixels while sampling coordinates remain in source units.
test('prepared fields are display-scaled, aligned and exactly transparent outside their source polygon', () => {
  const entry = { rect: [11, 13, 80, 90], maskPolygon: [[20, 20], [85, 25], [70, 95], [15, 80]],
    geometry: { amplitudeX: 24, envelope: 'vertical' }, featherPx: 6 };
  const field = prepareGeometryField(entry, 0.25, 0.3);
  assert.ok(field.width * field.height < 80 * 90 / 8);
  assert.equal(field.drawRect[0] * 0.25, Math.floor(entry.rect[0] * 0.25));
  assert.equal(field.drawRect[1] * 0.3, Math.floor(entry.rect[1] * 0.3));
  for (let row = 0; row < field.height; row += 1) {
    for (let column = 0; column < field.width; column += 1) {
      const index = row * field.width + column;
      const x = field.sourceX[column] + entry.rect[0] + 0.5;
      const y = field.sourceY[row] + entry.rect[1] + 0.5;
      if (polygonInteriorDistance(x, y, entry.maskPolygon) === 0) {
        assert.equal(field.alpha[index], 0);
        assert.equal(field.shiftX[index], 0);
      }
    }
  }
  for (const scale of [0, -1, Infinity, NaN, 1.1]) assert.throws(() => prepareGeometryField(entry, scale, 1), /geometry field/);
});

// 已知RGB渐变可独立算出双线性结果；每次输出只来自一个反采样位置，不能夹杂另一姿态或旧发纹理。
// A known RGB gradient supplies independently calculated bilinear results; each output comes from one inverse sample, not another pose or old-hair blend.
test('bilinear RGBA sampling is exact for neutral pixels and follows one continuously displaced original', () => {
  const size = 32;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      data.set([x * 6, y * 6, 75, 255], index);
    }
  }
  const source = geometrySourceFromPixels({ width: size, height: size, data });
  assert.equal(source.opaque, true);
  const entry = { rect: [0, 0, size, size], maskPolygon: rectangle(0, 0, size, size), geometry: { amplitudeX: 8, envelope: 'vertical' } };
  const field = prepareGeometryField(entry, 1, 1);
  const output = new Uint8ClampedArray(data.length);
  const target = (16 * size + 16) * 4;
  for (const position of [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]) {
    assert.equal(renderGeometryPixels(source, field, position, output), output);
    const expectedX = 16 - geometryDisplacementAt(entry, 16.5, 16.5) * position;
    assert.ok(Math.abs(output[target] - expectedX * 6) <= 1);
    assert.equal(output[target + 1], 16 * 6);
    assert.equal(output[target + 2], 75);
    assert.equal(output[target + 3], 255);
    for (let index = 0; index < field.alpha.length; index += 1) assert.equal(output[index * 4 + 3], field.alpha[index]);
  }
  renderGeometryPixels(source, field, 0, output);
  for (let index = 0; index < field.alpha.length; index += 1) {
    if (field.alpha[index] === 0) continue;
    assert.deepEqual([...output.slice(index * 4, index * 4 + 3)], [...data.slice(index * 4, index * 4 + 3)]);
  }
});

// 透明PNG的隐藏RGB不能污染发丝颜色；预乘alpha插值与全零mask清除都使用实际数组断言。
// Hidden RGB in transparent PNG pixels must not tint strands; real arrays verify premultiplied interpolation and zero-mask clearing.
test('transparent source samples use premultiplied interpolation and zero mask clears stale output', () => {
  const source = geometrySourceFromPixels({ width: 2, height: 2,
    data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 255, 0, 0]) });
  assert.equal(source.opaque, false);
  const field = { width: 1, height: 1, sourceX: new Float32Array([0.5]), sourceY: new Float32Array([0.5]),
    shiftX: new Float32Array([0]), alpha: new Uint8ClampedArray([255]) };
  const output = new Uint8ClampedArray(4);
  renderGeometryPixels(source, field, 1, output);
  assert.deepEqual([...output], [255, 0, 0, 128]);
  field.alpha[0] = 0;
  renderGeometryPixels(source, field, 1, output);
  assert.deepEqual([...output], [0, 0, 0, 0]);
});
