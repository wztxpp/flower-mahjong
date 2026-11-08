// 真实合成器的计算/调用/生命周期测试；Canvas测试替身不是肉眼验收，真实像素另在浏览器诊断验证。
// Real compositor math/call/lifecycle tests; Canvas doubles are not visual acceptance, which is verified separately in browser diagnostics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateMotionDescriptor, maskAlpha, motionAt, portraitPhase, PortraitMotionRenderer, MOTION_MAX_PIXELS, loadMotionImage } from '../src/portrait-motion/renderer.js';
import { PORTRAIT_MOTION_CHARACTERS, portraitMotionFor } from '../src/portrait-motion/catalog.js';

const polygon = (x, y, width, height) => [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
const descriptor = () => ({ id: 'sweet', sourceUrl: '/characters/sweet-scene-base.png', sourceSha256: 'a'.repeat(64),
  closedUrl: '/portrait-motion/sweet/closed.png', closedSha256: 'b'.repeat(64), width: 1000, height: 1000, closedWidth: 1001, closedHeight: 1001,
  eyes: [10, 50].map((x) => ({ targetRect: [x, 20, 20, 10], sourceRect: [x + 0.25, 20.125, 20.125, 10.125], maskPolygon: polygon(x, 20, 20, 10) })),
  hairRegions: [{ rect: [100, 10, 20, 100], maskPolygon: polygon(100, 10, 20, 100), amplitudeX: 3, amplitudeY: 0.3, phase: 0 }],
});

// 节点替身记录真实renderer调用，确保每帧只画ROI、零姿态不画图、不做整图readback。
// Canvas nodes record real renderer calls: frames draw only ROIs, neutral controls draw nothing, and no full-image readback occurs.
function fixture(options = {}) {
  const canvases = [];
  const callbacks = new Map();
  let sequence = 0;
  const observers = [];
  const makeCanvas = () => {
    const operations = [];
    const context = {
      operations,
      clearRect(...args) { operations.push(['clearRect', ...args]); },
      drawImage(...args) { operations.push(['drawImage', ...args]); },
      setTransform(...args) { operations.push(['setTransform', ...args]); },
      createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; },
      putImageData(...args) { operations.push(['putImageData', ...args]); },
    };
    const canvas = { width: 0, height: 0, getContext: () => context, getBoundingClientRect: () => ({ width: 1000, height: 1000 }) };
    canvases.push(canvas);
    return canvas;
  };
  const environment = {
    document: { createElement: makeCanvas }, devicePixelRatio: 4,
    requestAnimationFrame: (callback) => { const id = ++sequence; callbacks.set(id, callback); return id; },
    cancelAnimationFrame: (id) => callbacks.delete(id),
    ResizeObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } },
  };
  const canvas = makeCanvas();
  const errors = [];
  const renderer = new PortraitMotionRenderer(canvas, (error) => errors.push(error), 'sweet:2', { environment,
    loadImage: async (url) => ({ naturalWidth: url.includes('closed') ? 1001 : 1000, naturalHeight: url.includes('closed') ? 1001 : 1000 }), ...options });
  return { renderer, canvas, canvases, callbacks, errors, environment, get observer() { return observers[0]; } };
}

test('descriptor validation accepts fractional source crops and rejects unsafe identities, dimensions, polygons and extents', () => {
  assert.equal(validateMotionDescriptor(descriptor()), true);
  for (const change of [
    { sourceUrl: '/characters/sunny-scene-base.png' }, { closedUrl: '/live2d/sweet/texture.png' }, { id: 'unknown' },
    { sourceSha256: 'invalid' }, { closedSha256: null }, { closedWidth: 0 }, { closedHeight: Infinity }, { width: -1 }, { height: NaN },
    { eyes: [] }, { eyes: [null, null] }, { hairRegions: [null] }, { hairRegions: [{ ...descriptor().hairRegions[0], amplitudeX: 100 }] },
  ]) assert.equal(validateMotionDescriptor({ ...descriptor(), ...change }), false, JSON.stringify(change));
  for (const eyeChange of [
    { targetRect: [10.5, 20, 20, 10] }, { sourceRect: [-1, 20, 20, 10] }, { sourceRect: [1000, 20, 20, 10] },
    { maskPolygon: [[10, 20], [30, 30], [10, 30], [30, 20]] }, { maskPolygon: [[10, 20], [20, 20], [30, 20]] },
    { maskPolygon: [[0, 0], [30, 20], [10, 30]] },
  ]) {
    const entry = descriptor();
    Object.assign(entry.eyes[0], eyeChange);
    assert.equal(validateMotionDescriptor(entry), false, JSON.stringify(eyeChange));
  }
});

test('polygon mask is exactly transparent outside and feathered only inward', () => {
  const triangle = [[10, 10], [30, 10], [20, 30]];
  for (const [x, y] of [[0, 0], [10, 20], [30, 20], [9.999, 10], [20, 30]]) assert.equal(maskAlpha(x, y, triangle), 0);
  assert.equal(maskAlpha(20, 15, triangle), 1);
  assert.ok(maskAlpha(20, 10.5, triangle) > 0 && maskAlpha(20, 10.5, triangle) < 1);
});

test('open/still frame emits zero overlay pixels; eye and hair draws remain local under arbitrary controls', async () => {
  const { renderer, canvas } = fixture();
  await renderer.load(descriptor());
  assert.ok(canvas.width * canvas.height <= MOTION_MAX_PIXELS);
  const operations = canvas.getContext('2d').operations;
  const check = (controls, expected) => {
    operations.length = 0;
    renderer.renderFrame(controls);
    const draws = operations.filter(([name]) => name === 'drawImage');
    assert.equal(draws.length, expected);
    for (const draw of draws) assert.ok(descriptor().eyes.some((eye) => JSON.stringify(eye.targetRect) === JSON.stringify(draw.slice(2))) ||
      descriptor().hairRegions.some((hair) => JSON.stringify(hair.rect) === JSON.stringify(draw.slice(2))));
    assert.equal(operations.filter(([name]) => name === 'clearRect').length, 3);
  };
  check({ blink: 0, hair: 0 }, 0);
  check({ blink: 1, hair: 0 }, 2);
  check({ blink: 0.49, hair: 0 }, 0);
  check({ blink: 0.5, hair: 0 }, 2);
  check({ blink: 0, hair: -1 }, 1);
  check({ blink: 0, hair: 1 }, 1);
  check({ blink: -1000, hair: NaN }, 0);
  check({ blink: Infinity, hair: Infinity }, 0);
  check({ blink: 1000, hair: -1000 }, 3);
  check(null, 0);
  renderer.dispose();
});

test('source diagnostics stay exact-size and resizing neither loads images nor regenerates masks', async () => {
  const scope = fixture({ sourceResolution: true });
  await scope.renderer.load(descriptor());
  assert.equal(scope.canvas.width, 1000);
  assert.equal(scope.canvas.height, 1000);
  const preparedCount = scope.canvases.length;
  scope.observer.callback();
  assert.equal(scope.canvases.length, preparedCount);
  scope.renderer.dispose();
  assert.equal(scope.observer.disconnected, true);
  assert.equal(scope.canvas.width, 1);
});

test('animation has stable seat phase, a bounded blink and 24fps work; stopping/unmounting removes callbacks', async () => {
  assert.equal(portraitPhase('sweet:2'), portraitPhase('sweet:2'));
  assert.notEqual(portraitPhase('sweet:1'), portraitPhase('sweet:2'));
  for (let time = 0; time < 30000; time += 13) {
    const value = motionAt(time, 'sweet:2');
    assert.ok(value.blink === 0 || value.blink === 1);
    assert.ok(value.hair >= -1 && value.hair <= 1);
  }
  assert.deepEqual(motionAt(NaN, 'sweet:2'), { blink: 0, hair: 0 });
  const { renderer, callbacks, canvas } = fixture();
  await renderer.load(descriptor());
  renderer.start();
  renderer.start();
  assert.equal(callbacks.size, 1);
  const runFrame = (time) => { const [id, callback] = [...callbacks][0]; callbacks.delete(id); callback(time); };
  const operations = canvas.getContext('2d').operations;
  runFrame(0);
  operations.length = 0;
  runFrame(10);
  assert.equal(operations.length, 0);
  runFrame(50);
  assert.ok(operations.length > 0);
  renderer.stop();
  assert.equal(callbacks.size, 0);
  renderer.start();
  assert.equal(callbacks.size, 1);
  renderer.dispose();
  renderer.dispose();
  assert.equal(callbacks.size, 0);
});

// 绘制中途失败也必须停时钟；原图由组件独立持有，不被错误清理删除。
// Mid-frame failure stops the clock; independently owned original art is never deleted during error cleanup.
test('drawing failure stops future frames and reports the error without retaining animation ownership', async () => {
  const { renderer, callbacks, canvas, errors } = fixture();
  await renderer.load(descriptor());
  canvas.getContext('2d').drawImage = () => { throw new Error('Canvas draw failed'); };
  renderer.start();
  const [id, callback] = [...callbacks][0];
  callbacks.delete(id);
  callback(1000);
  assert.equal(errors.length, 1);
  assert.equal(renderer.running, false);
  assert.equal(callbacks.size, 0);
  renderer.dispose();
});

test('late image loads, missing Canvas2D and corrupt sizes cannot revive disposed art', async () => {
  assert.throws(() => new PortraitMotionRenderer({ getContext: () => null }), /Canvas2D/);
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const scope = fixture({ loadImage: () => pending });
  const loading = scope.renderer.load({ ...descriptor(), closedWidth: 1000, closedHeight: 1000 });
  scope.renderer.dispose();
  resolve({ naturalWidth: 1000, naturalHeight: 1000 });
  await loading;
  assert.equal(scope.renderer.loaded, false);
  assert.equal(scope.renderer.patches.length, 0);
  const broken = fixture({ loadImage: async () => ({ naturalWidth: 2, naturalHeight: 2 }) });
  await assert.rejects(broken.renderer.load(descriptor()), /dimensions/);
  broken.renderer.dispose();
});

test('sibling image requests share one decode; failed and timed-out requests can retry', async () => {
  const instances = [];
  const timers = new Map();
  const environment = { Image: class { constructor() { instances.push(this); } },
    setTimeout: (callback) => { const key = timers.size + 1; timers.set(key, callback); return key; }, clearTimeout: (key) => timers.delete(key) };
  const first = loadMotionImage('/shared-test.png', environment);
  assert.equal(loadMotionImage('/shared-test.png', environment), first);
  assert.equal(instances.length, 1);
  instances[0].onload();
  await first;
  assert.equal(timers.size, 0);
  const failed = loadMotionImage('/retry-test.png', environment);
  instances[1].onerror();
  await assert.rejects(failed, /unavailable/);
  const retried = loadMotionImage('/retry-test.png', environment);
  [...timers.values()][0]();
  await assert.rejects(retried, /timed out/);
  assert.equal(instances[2].onload, null);
});

// 验证原图和生成闭眼帧的实际文件SHA/PNG尺寸，防止代码默认睁眼时悄悄换成生成图。
// Check real source/generated PNG hashes and sizes, preventing a generated image from silently replacing original open art.
test('every staged catalog entry matches its exact original PNG bytes and generated closed frame', () => {
  assert.equal(portraitMotionFor('unknown'), null);
  assert.equal(portraitMotionFor('__proto__'), null);
  for (const [id, entry] of Object.entries(PORTRAIT_MOTION_CHARACTERS)) {
    assert.equal(validateMotionDescriptor(entry), true, id);
    assert.equal(portraitMotionFor(id), entry);
    for (const [url, hash, width, height] of [
      [entry.sourceUrl, entry.sourceSha256, entry.width, entry.height],
      [entry.closedUrl, entry.closedSha256, entry.closedWidth || entry.width, entry.closedHeight || entry.height],
    ]) {
      const bytes = readFileSync(new URL(`../public${url}`, import.meta.url));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), hash);
      assert.equal(bytes.readUInt32BE(16), width);
      assert.equal(bytes.readUInt32BE(20), height);
    }
  }
});
