// 真实合成器的计算/调用/生命周期测试；Canvas测试替身不是肉眼验收，真实像素另在浏览器诊断验证。
// Real compositor math/call/lifecycle tests; Canvas doubles are not visual acceptance, which is verified separately in browser diagnostics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateMotionDescriptor, maskAlpha, motionAt, portraitPhase, PortraitMotionRenderer, MOTION_MAX_PIXELS, loadMotionImage } from '../src/portrait-motion/renderer.js';
import { PORTRAIT_MOTION_CHARACTERS, portraitMotionFor } from '../src/portrait-motion/catalog.js';
import { blinkTimingFor } from '../src/portrait-motion/timeline.js';

const polygon = (x, y, width, height) => [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
const descriptor = () => ({ id: 'sweet', sourceUrl: '/characters/sweet-scene-base.png', sourceSha256: 'a'.repeat(64),
  closedUrl: '/portrait-motion/sweet/closed.png', closedSha256: 'b'.repeat(64), width: 1000, height: 1000, closedWidth: 1001, closedHeight: 1001,
  eyes: [10, 50].map((x) => ({ targetRect: [x, 20, 20, 10], sourceRect: [x + 0.25, 20.125, 20.125, 10.125], maskPolygon: polygon(x, 20, 20, 10) })),
  hairRegions: [{ rect: [100, 10, 20, 100], maskPolygon: polygon(100, 10, 20, 100), amplitudeX: 3, amplitudeY: 0.3, phase: 0 }],
});

// 小尺寸合成清单模拟同一图集的八个真实状态，不把测试纹理当作已经放行的ImageGen美术。
// A compact synthetic manifest models eight real-state atlas entries without presenting test textures as approved ImageGen artwork.
function multiFrameDescriptor({ hair = true } = {}) {
  const legacy = descriptor();
  const eyeIds = ['eye20', 'eye50', 'eye80', 'eye100'];
  const hairIds = hair ? ['hairLeft', 'hairHalfLeft', 'hairHalfRight', 'hairRight'] : [];
  const frameIds = [...eyeIds, ...hairIds];
  return {
    schemaVersion: 2, id: legacy.id, sourceUrl: legacy.sourceUrl, sourceSha256: legacy.sourceSha256,
    width: legacy.width, height: legacy.height,
    frames: frameIds.map((id) => ({ id, url: '/portrait-motion/sweet/atlas.png', sha256: 'c'.repeat(64), width: 1000, height: 1000 })),
    eyes: legacy.eyes.map((eye) => ({ targetRect: eye.targetRect, maskPolygon: eye.maskPolygon,
      sourceRects: Object.fromEntries(eyeIds.map((id) => [id, eye.sourceRect])) })),
    hairRegions: hair ? legacy.hairRegions.map((region) => ({ rect: region.rect, maskPolygon: region.maskPolygon,
      sourceRects: Object.fromEntries(hairIds.map((id) => [id, region.rect])) })) : [],
    // 与首个真实sweet候选相同的9阶段/360ms时间，四个40ms中间帧必须在30fps路径可见。
    // Match the first actual sweet candidate's nine-stage/360ms timing; its 40ms intermediates must appear through the 30fps path.
    blinkSequence: [null, 'eye20', 'eye50', 'eye80', 'eye100', 'eye80', 'eye50', 'eye20', null]
      .map((frameId, index) => ({ frameId, durationMs: [25, 40, 40, 40, 60, 40, 40, 40, 35][index] })),
    hairSequence: hair ? [
      { frameId: 'hairLeft', position: -1 }, { frameId: 'hairHalfLeft', position: -0.5 },
      { frameId: null, position: 0 }, { frameId: 'hairHalfRight', position: 0.5 }, { frameId: 'hairRight', position: 1 },
    ] : [{ frameId: null, position: 0 }],
    hairInterpolation: 'discrete',
  };
}

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
      createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; },
      getImageData(x, y, width, height) {
        operations.push(['getImageData', x, y, width, height]);
        const data = new Uint8ClampedArray(width * height * 4);
        for (let index = 0; index < data.length; index += 4) data.set([index / 4 % 200, 80, 100, 255], index);
        return { width, height, data };
      },
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

test('animation has stable seat phase, a bounded blink and accumulated frame work; stopping/unmounting removes callbacks', async () => {
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
test('every staged catalog entry matches its exact original PNG bytes and generated donor frames', () => {
  assert.equal(portraitMotionFor('unknown'), null);
  assert.equal(portraitMotionFor('__proto__'), null);
  for (const [id, entry] of Object.entries(PORTRAIT_MOTION_CHARACTERS)) {
    assert.equal(validateMotionDescriptor(entry), true, id);
    assert.equal(portraitMotionFor(id), entry);
    const donors = entry.schemaVersion === 2 ? entry.frames.map((frame) => [frame.url, frame.sha256, frame.width, frame.height]) :
      [[entry.closedUrl, entry.closedSha256, entry.closedWidth || entry.width, entry.closedHeight || entry.height]];
    for (const [url, hash, width, height] of [[entry.sourceUrl, entry.sourceSha256, entry.width, entry.height], ...donors]) {
      const bytes = readFileSync(new URL(`../public${url}`, import.meta.url));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), hash);
      assert.equal(bytes.readUInt32BE(16), width);
      assert.equal(bytes.readUInt32BE(20), height);
    }
  }
});

// v2校验在下载前拒绝未知帧、跨角色路径、图集矛盾、越界ROI及不完整序列；临时眼-only候选合法。
// V2 rejects unknown frames, cross-role paths, conflicting atlases, out-of-range ROIs and incomplete sequences before loading; eye-only candidates remain valid.
test('multi-frame descriptors validate shared atlases, independent sequences and bounded inward hair feathering', () => {
  assert.equal(validateMotionDescriptor(multiFrameDescriptor()), true);
  assert.equal(validateMotionDescriptor(multiFrameDescriptor({ hair: false })), true);
  const changes = [
    (entry) => { entry.schemaVersion = 3; },
    (entry) => { entry.frames[0].id = entry.frames[1].id; },
    (entry) => { entry.frames[0].url = '/portrait-motion/sunny/atlas.png'; },
    (entry) => { entry.frames[0].width = 999; },
    (entry) => { entry.frames[0].sha256 = 'd'.repeat(64); },
    (entry) => { entry.frames[0].height = 5000; },
    (entry) => { entry.blinkSequence[1].frameId = 'missing'; },
    (entry) => { entry.blinkSequence[1].durationMs = NaN; },
    (entry) => { entry.blinkSequence[1].durationMs = 10000; },
    (entry) => { entry.eyes[0].sourceRects.eye20 = [-1, 0, 10, 10]; },
    (entry) => { delete entry.eyes[0].sourceRects.eye80; },
    (entry) => { entry.hairSequence[0].position = -2; },
    (entry) => { entry.hairSequence[1].position = -1; },
    (entry) => { entry.hairSequence[2].frameId = 'hairHalfLeft'; },
    (entry) => { entry.hairSequence[0].frameId = null; },
    (entry) => { entry.hairRegions = []; },
    (entry) => { entry.hairInterpolation = 'eye-alpha'; },
    (entry) => { entry.hairRegions[0].featherPx = 1; },
    (entry) => { entry.hairRegions[0].featherPx = 17; },
    (entry) => { entry.hairRegions[0].featherPx = Infinity; },
  ];
  for (const change of changes) {
    const entry = multiFrameDescriptor();
    change(entry);
    assert.equal(validateMotionDescriptor(entry), false, change.toString());
  }
  for (const featherPx of [2, 6, 12, 16]) {
    const entry = multiFrameDescriptor();
    entry.hairRegions[0].featherPx = featherPx;
    assert.equal(validateMotionDescriptor(entry), true);
    assert.equal(maskAlpha(99, 50, entry.hairRegions[0].maskPolygon, featherPx), 0);
  }
});

// 多个逻辑帧只下载一次物理图集；准备后每帧只挑对应小canvas，显式null恢复透明原图。
// Logical frames load one physical atlas; prepared playback chooses only the matching ROI canvas and explicit null restores transparent original art.
test('multi-frame loading shares one atlas and each diagnostic eyelid selects exactly one opaque donor', async () => {
  const requested = [];
  const scope = fixture({ loadImage: async (url) => {
    requested.push(url);
    return { naturalWidth: 1000, naturalHeight: 1000 };
  } });
  const entry = multiFrameDescriptor();
  await scope.renderer.load(entry);
  assert.deepEqual(requested, [entry.sourceUrl, entry.frames[0].url]);
  const alphaValues = [];
  const context = scope.canvas.getContext('2d');
  Object.defineProperty(context, 'globalAlpha', { set: (value) => alphaValues.push(value), configurable: true });
  for (const frameId of ['eye20', 'eye50', 'eye80', 'eye100']) {
    context.operations.length = 0;
    scope.renderer.renderFrame({ blinkFrameId: frameId, hairFrameId: null });
    const draws = context.operations.filter(([name]) => name === 'drawImage');
    assert.equal(draws.length, 2);
    assert.deepEqual(draws.map((draw) => draw[1]), scope.renderer.patches.filter((patch) => patch.kind === 'eye').map((patch) => patch.frames.get(frameId)));
    assert.equal(scope.renderer.lastControls.blinkFrameId, frameId);
  }
  assert.ok(alphaValues.every((value) => value === 1));
  for (const controls of [{ blinkFrameId: null, hairFrameId: null }, { blinkFrameId: 'missing', hairFrameId: 'eye20' }, null]) {
    context.operations.length = 0;
    scope.renderer.renderFrame(controls);
    assert.equal(context.operations.filter(([name]) => name === 'drawImage').length, 0);
  }
  for (const [blink, expectedId] of [[0.2, 'eye20'], [0.5, 'eye50'], [0.8, 'eye80'], [1, 'eye100']]) {
    scope.renderer.renderFrame({ blink, hair: 0 });
    assert.equal(scope.renderer.lastControls.blinkFrameId, expectedId);
  }
  scope.renderer.dispose();
  assert.ok(scope.canvases.every((canvas) => canvas.width === 1 && canvas.height === 1));
});

// 头发默认离散；只有明确开启linear时混合发区，眼供体仍不透明。宽羽化只减小内部alpha。
// Hair is discrete by default; explicit linear mode blends hair only, while eye donors stay opaque. Wider feathering only reduces inward alpha.
test('hair-only interpolation is explicit, neutral is transparent, and configured feathering stays inward', async () => {
  for (const hairInterpolation of ['discrete', 'linear']) {
    const scope = fixture();
    const entry = multiFrameDescriptor();
    entry.hairInterpolation = hairInterpolation;
    entry.hairRegions[0].featherPx = 12;
    await scope.renderer.load(entry);
    const patch = scope.renderer.patches.find((item) => item.kind === 'hair');
    const maskPixels = patch.mask.getContext('2d').operations.find(([name]) => name === 'putImageData')[1].data;
    assert.equal(maskPixels[3], Math.round(maskAlpha(100.5, 10.5, entry.hairRegions[0].maskPolygon, 12) * 255));
    const alphaValues = [];
    Object.defineProperty(patch.output.getContext('2d'), 'globalAlpha', { set: (value) => alphaValues.push(value), configurable: true });
    scope.renderer.renderFrame({ blinkFrameId: 'eye50', hairPosition: -0.75 });
    assert.equal(scope.renderer.lastControls.blinkFrameId, 'eye50');
    assert.equal(scope.renderer.lastControls.hairFromFrameId, 'hairLeft');
    assert.equal(scope.renderer.lastControls.hairToFrameId, hairInterpolation === 'linear' ? 'hairHalfLeft' : 'hairLeft');
    assert.equal(alphaValues.includes(0.5), hairInterpolation === 'linear');
    scope.renderer.renderFrame({ blinkFrameId: null, hairPosition: 0 });
    assert.equal(scope.renderer.lastControls.hairFromFrameId, null);
    assert.equal(scope.renderer.lastControls.hairToFrameId, null);
    scope.renderer.renderFrame({ blinkFrameId: null, hairFrameId: 'hairRight', hairPosition: -1 });
    assert.equal(scope.renderer.lastControls.hairFromFrameId, 'hairRight');
    scope.renderer.dispose();
  }
});

// 逐张加载的取消边界：卸载后当前图片可结束，但后续完整供体不能继续发起，也不能复活图块。
// Sequential-load cancellation: an in-flight image may finish after disposal, but later full donors must not start and patches cannot revive.
test('disposal and partial donor failure release every prepared ROI and stop later image loads', async () => {
  const entry = multiFrameDescriptor();
  for (const [index, frame] of entry.frames.entries()) frame.url = `/portrait-motion/sweet/frame-${index}.png`;
  const requested = [];
  let resolveDonor;
  const scope = fixture({ loadImage: async (url) => {
    requested.push(url);
    if (url === entry.sourceUrl) return { naturalWidth: 1000, naturalHeight: 1000 };
    return new Promise((resolve) => { resolveDonor = resolve; });
  } });
  const loading = scope.renderer.load(entry);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(requested.length, 2);
  scope.renderer.dispose();
  resolveDonor({ naturalWidth: 1000, naturalHeight: 1000 });
  await loading;
  assert.equal(requested.length, 2);
  assert.equal(scope.renderer.loaded, false);
  assert.equal(scope.renderer.patches.length, 0);
  assert.ok(scope.canvases.every((canvas) => canvas.width === 1 && canvas.height === 1));
  let count = 0;
  const broken = fixture({ loadImage: async () => {
    count += 1;
    if (count === 3) throw new Error('Second donor failed');
    return { naturalWidth: 1000, naturalHeight: 1000 };
  } });
  await assert.rejects(broken.renderer.load(entry), /Second donor failed/);
  assert.equal(broken.renderer.patches.length, 0);
  assert.equal(broken.renderer.loaded, false);
  broken.renderer.dispose();
  assert.ok(broken.canvases.every((canvas) => canvas.width === 1 && canvas.height === 1));
});

// 用真正renderer的start/tick/renderFrame检查28个角色/座位的40ms供体顺序，不只验证独立数学函数。
// Exercise the real renderer's start/tick/renderFrame across 28 role/seat keys to verify the 40ms donor sequence, not only a separate math function.
test('actual multi-frame RAF playback visits every 40ms eyelid stage in all role and seat phases', async () => {
  const entry = multiFrameDescriptor({ hair: false });
  const expected = ['eye20', 'eye50', 'eye80', 'eye100', 'eye80', 'eye50', 'eye20'];
  for (const id of ['sweet', 'sunny', 'landlord', 'honest', 'wealthy', 'star', 'elegant']) {
    for (let seat = 0; seat < 4; seat += 1) {
      const scope = fixture();
      const key = `${id}:${seat}`;
      scope.renderer.phaseKey = key;
      await scope.renderer.load(entry);
      const timing = blinkTimingFor(key, 360);
      const nextStart = timing.periodMs - timing.offsetMs;
      const sequence = [];
      scope.renderer.start();
      for (let tick = 0; tick < 600; tick += 1) {
        const time = tick * 1000 / 60;
        const [callbackId, callback] = [...scope.callbacks][0];
        scope.callbacks.delete(callbackId);
        callback(time);
        const frameId = scope.renderer.lastControls.blinkFrameId;
        if (time >= nextStart && time < nextStart + 360 && frameId && sequence.at(-1) !== frameId) sequence.push(frameId);
      }
      assert.deepEqual(sequence, expected, key);
      scope.renderer.dispose();
    }
  }
});

// 全局只保留在途图片，最多两张并行；完成后释放引用，后续显式重载不是永久整图缓存命中。
// Globally retain only pending images, with at most two active; completed references are released, so later explicit loads do not hit a permanent full-image cache.
test('image queue bounds concurrent decodes and drops completed full-image cache entries', async () => {
  const instances = [];
  const timers = new Map();
  let timerId = 0;
  const environment = { Image: class { constructor() { instances.push(this); } },
    setTimeout: (callback) => { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout: (id) => timers.delete(id) };
  const first = loadMotionImage('/bounded-a.png', environment);
  const second = loadMotionImage('/bounded-b.png', environment);
  const third = loadMotionImage('/bounded-c.png', environment);
  assert.equal(instances.length, 2);
  assert.equal(timers.size, 2);
  assert.equal(loadMotionImage('/bounded-a.png', environment), first);
  instances[0].onload();
  await first;
  assert.equal(instances.length, 3);
  assert.equal(timers.size, 2);
  instances[1].onload();
  instances[2].onload();
  await Promise.all([second, third]);
  const reload = loadMotionImage('/bounded-a.png', environment);
  assert.notEqual(reload, first);
  assert.equal(instances.length, 4);
  instances[3].onload();
  await reload;
  assert.equal(timers.size, 0);
});

// 超时不仅释放逻辑槽，还取消底层Image；异常取消/迟到回调不能二次释放并破坏并发上限。
// Timeouts cancel the underlying Image as well as the logical slot; throwing cancellation and late callbacks cannot free a slot twice.
test('image timeout cancels the shared request before the next slot and tolerates failing cleanup', async () => {
  const instances = [];
  const timers = new Map();
  let timerId = 0;
  let activeSources = 0;
  let peakSources = 0;
  const environment = { Image: class {
    constructor() { instances.push(this); this.value = ''; }
    set src(value) {
      if (this.value) activeSources -= 1;
      this.value = value;
      if (value) { activeSources += 1; peakSources = Math.max(peakSources, activeSources); }
      if (!value && this.throwOnCancel) throw new Error('Synthetic cleanup failed after cancellation');
    }
    get src() { return this.value; }
  }, setTimeout: (callback) => { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout: (id) => timers.delete(id) };
  const first = loadMotionImage('/timeout-a.png', environment);
  const shared = loadMotionImage('/timeout-a.png', environment);
  assert.equal(shared, first);
  const firstRejected = assert.rejects(first, /timed out/);
  const second = loadMotionImage('/timeout-b.png', environment);
  const secondRejected = assert.rejects(second, /unavailable/);
  const third = loadMotionImage('/timeout-c.png', environment);
  const lateLoad = instances[0].onload;
  timers.get(1)();
  await firstRejected;
  assert.equal(instances[0].src, '');
  assert.equal(instances.length, 3);
  assert.equal(peakSources, 2);
  lateLoad();
  assert.equal(timers.size, 2);
  instances[1].throwOnCancel = true;
  instances[1].onerror();
  await secondRejected;
  assert.equal(instances[1].src, '');
  instances[2].onload();
  await third;
  assert.equal(timers.size, 0);
  assert.equal(peakSources, 2);
});

// 一个共享加载的拥有者卸载，不得使仍可见的兄弟座位失败，也不得为已卸载者继续准备资源。
// Disposing one owner of a shared load must not fail its visible sibling or continue preparing resources for the disposed owner.
test('disposing one renderer during a shared image load preserves its active sibling', async () => {
  const images = [];
  const environment = { Image: class {
    constructor() { this.naturalWidth = 1000; this.naturalHeight = 1000; images.push(this); }
  } };
  const loadImage = (url) => loadMotionImage(url, environment);
  const first = fixture({ loadImage });
  const second = fixture({ loadImage });
  const entry = multiFrameDescriptor();
  const firstLoad = first.renderer.load(entry);
  const secondLoad = second.renderer.load(entry);
  assert.equal(images.length, 1);
  first.renderer.dispose();
  images[0].onload();
  await firstLoad;
  await Promise.resolve();
  assert.equal(images.length, 2);
  images[1].onload();
  await secondLoad;
  assert.equal(first.renderer.loaded, false);
  assert.equal(first.renderer.patches.length, 0);
  assert.equal(second.renderer.loaded, true);
  assert.ok(second.renderer.patches.every((patch) => patch.frames.size === 4));
  second.renderer.dispose();
});

// 即使单帧ROI面积合规，过多帧的总canvas内存仍可超预算；该场景必须在任何下载前拒绝。
// Even valid single-frame ROI area can exceed the total canvas budget across many frames; reject this before any download.
test('multi-frame validation counts every prepared donor against its memory budget', () => {
  const entry = multiFrameDescriptor();
  entry.width = 2000;
  entry.height = 2000;
  const eyeIds = Array.from({ length: 8 }, (_, index) => `eye${index}`);
  const hairIds = Array.from({ length: 8 }, (_, index) => `hair${index}`);
  entry.frames = [...eyeIds, ...hairIds].map((id) => ({ id, url: '/portrait-motion/sweet/atlas.png', sha256: 'c'.repeat(64), width: 2000, height: 2000 }));
  entry.blinkSequence = eyeIds.map((frameId) => ({ frameId, durationMs: 40 }));
  entry.hairSequence = [...hairIds.slice(0, 4), null, ...hairIds.slice(4)].map((frameId, index) => ({ frameId, position: (index - 4) / 4 }));
  entry.eyes = [10, 250].map((x) => ({ targetRect: [x, 10, 200, 200], maskPolygon: polygon(x, 10, 200, 200),
    sourceRects: Object.fromEntries(eyeIds.map((id) => [id, [x, 10, 200, 200]])) }));
  entry.hairRegions = [{ rect: [500, 500, 600, 600], maskPolygon: polygon(500, 500, 600, 600),
    sourceRects: Object.fromEntries(hairIds.map((id) => [id, [500, 500, 600, 600]])) }];
  assert.ok(2 * 200 * 200 + 600 * 600 <= entry.width * entry.height * 0.12);
  assert.equal(validateMotionDescriptor(entry), false);
  entry.hairRegions[0].rect = [500, 500, 400, 400];
  entry.hairRegions[0].maskPolygon = polygon(500, 500, 400, 400);
  assert.equal(validateMotionDescriptor(entry), true);
});

// 几何模式只借用眼帧清单，发区没有生成供体；单独构造避免把烘焙几何帧误作运行时连续采样。
// Geometry reuses only the eye-frame manifest and has no hair donors; construct it separately rather than treating baked geometric frames as continuous sampling.
function geometryDescriptor() {
  const entry = multiFrameDescriptor({ hair: false });
  entry.hairMode = 'geometry';
  delete entry.hairSequence;
  delete entry.hairInterpolation;
  entry.hairRegions = [{ rect: [100, 10, 20, 100], maskPolygon: polygon(100, 10, 20, 100),
    geometry: { amplitudeX: 8, envelope: 'vertical' }, featherPx: 2 }];
  return entry;
}

// 非法参数、残留发姿态和跨姿态alpha都必须在请求前拒绝，几何模式不降低原区域保护。
// Reject invalid parameters, leftover hair poses and cross-pose alpha before requests; geometry retains the original region protections.
test('geometry descriptors require explicit bounded geometry and no baked hair donors or interpolation', () => {
  assert.equal(validateMotionDescriptor(geometryDescriptor()), true);
  const changes = [
    (entry) => { entry.hairMode = 'unknown'; },
    (entry) => { entry.hairInterpolation = 'linear'; },
    (entry) => { entry.hairSequence = [{ frameId: 'eye20', position: 0 }]; },
    (entry) => { entry.hairRegions[0].geometry.amplitudeX = 25; },
    (entry) => { entry.hairRegions[0].geometry.envelope = 'horizontal'; },
    (entry) => { entry.hairRegions[0].sourceRects = { eye20: [0, 0, 20, 100] }; },
    (entry) => { entry.hairRegions[0].maskPolygon = polygon(0, 0, 1000, 1000); },
    (entry) => { delete entry.hairRegions[0].geometry; },
  ];
  for (const change of changes) {
    const entry = geometryDescriptor();
    change(entry);
    assert.equal(validateMotionDescriptor(entry), false, change.toString());
  }
});

// 实际renderer只在准备时读一次小ROI，逐帧复用RGBA/场，resize不重读；停用清零并释放全部源数组。
// The real renderer reads one small ROI during preparation, reuses RGBA/fields per frame and never rereads on resize; stop clears and disposal releases source arrays.
test('geometry renderer reads original ROIs once and reuses bounded buffers through frames, resize and disposal', async () => {
  const scope = fixture();
  await scope.renderer.load(geometryDescriptor());
  const patch = scope.renderer.patches.find((item) => item.geometry);
  const source = patch.geometry.source;
  const initialField = patch.geometry.field;
  const initialPixels = patch.geometry.pixels;
  const reads = () => scope.canvases.flatMap((canvas) => canvas.getContext('2d').operations.filter(([name]) => name === 'getImageData'));
  assert.deepEqual(reads().map((operation) => operation.slice(1)), [[0, 0, 22, 102]]);
  assert.ok(initialField.width * initialField.height < 20 * 100);
  assert.equal(scope.renderer.geometryMemory.sourceBytes, 22 * 102 * 4);
  assert.ok(scope.renderer.geometryMemory.totalBytes < 6 * 22 * 102 * 4);
  for (const hairPosition of [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]) {
    scope.renderer.renderFrame({ blinkFrameId: 'eye50', hairPosition });
    assert.equal(scope.renderer.lastControls.hairGeometryPosition, hairPosition);
    assert.equal(patch.geometry.source, source);
    assert.equal(patch.geometry.field, initialField);
    assert.equal(patch.geometry.pixels, initialPixels);
  }
  assert.equal(reads().length, 1);
  scope.canvas.getBoundingClientRect = () => ({ width: 200, height: 200 });
  scope.renderer.resize();
  assert.equal(patch.geometry.source, source);
  assert.notEqual(patch.geometry.field, initialField);
  assert.notEqual(patch.geometry.pixels, initialPixels);
  assert.equal(reads().length, 1);
  const operations = scope.canvas.getContext('2d').operations;
  for (const controls of [{ blinkFrameId: null, hairPosition: 0 }, { blinkFrameId: null, hairFrameId: null, hairPosition: 1 }, { hair: NaN }]) {
    operations.length = 0;
    scope.renderer.renderFrame(controls);
    assert.equal(operations.filter(([name]) => name === 'drawImage').length, 0);
  }
  scope.renderer.dispose();
  assert.equal(patch.geometry.source, null);
  assert.equal(patch.geometry.field, null);
  assert.equal(patch.geometry.pixels, null);
  assert.equal(scope.renderer.geometryMemory.totalBytes, 0);
  assert.ok(scope.canvases.every((canvas) => canvas.width === 1 && canvas.height === 1));
});

// 浏览器发现的真实回归：canvas预设源分辨率时尺寸相同，仍必须首次准备field/pixels；重复resize不重建。
// Real-browser regression: a preset source-resolution canvas still requires initial field/pixel preparation despite matching dimensions; repeated resize does not rebuild.
test('geometry initializes fields when canvas dimensions already match and repeated resize is allocation-free', async () => {
  const scope = fixture({ sourceResolution: true });
  scope.canvas.width = 1000;
  scope.canvas.height = 1000;
  await scope.renderer.load(geometryDescriptor());
  const patch = scope.renderer.patches.find((item) => item.geometry);
  assert.ok(patch.geometry.field);
  assert.ok(patch.geometry.pixels);
  assert.doesNotThrow(() => scope.renderer.renderFrame({ hairPosition: 1 }));
  const field = patch.geometry.field;
  const pixels = patch.geometry.pixels;
  const canvasCount = scope.canvases.length;
  scope.renderer.resize();
  scope.observer.callback();
  assert.equal(patch.geometry.field, field);
  assert.equal(patch.geometry.pixels, pixels);
  assert.equal(scope.canvases.length, canvasCount);
  scope.renderer.dispose();
});

// 相同尺寸的首次加载也必须建立源坐标变换，不能只有geometry初始化路径正确而旧供体路径仍用1:1。
// First load must establish source-coordinate transforms even at matching dimensions, including ordinary donor paths rather than geometry alone.
test('preset display-size canvases receive the initial source transform without geometry', async () => {
  const scope = fixture();
  const side = Math.floor(Math.sqrt(MOTION_MAX_PIXELS));
  scope.canvas.width = side;
  scope.canvas.height = side;
  await scope.renderer.load(multiFrameDescriptor({ hair: false }));
  const transforms = scope.canvas.getContext('2d').operations.filter(([name]) => name === 'setTransform');
  assert.deepEqual(transforms, [['setTransform', side / 1000, 0, 0, side / 1000, 0, 0]]);
  scope.renderer.resize();
  assert.equal(scope.canvas.getContext('2d').operations.filter(([name]) => name === 'setTransform').length, 1);
  scope.renderer.dispose();
});

// 浏览器拒绝ROI读取时装饰必须失败回退，临时纹理即使抛错仍缩小，不启动持续时钟。
// A browser ROI-read denial fails decoration safely, shrinking temporary textures even on error and starting no continuous clock.
test('geometry readback failure releases its temporary canvas and cannot start animation', async () => {
  const scope = fixture();
  const createCanvas = scope.environment.document.createElement;
  scope.environment.document.createElement = () => {
    const canvas = createCanvas();
    canvas.getContext('2d').getImageData = () => { throw new Error('Readback blocked'); };
    return canvas;
  };
  await assert.rejects(scope.renderer.load(geometryDescriptor()), /Readback blocked/);
  assert.equal(scope.renderer.loaded, false);
  assert.equal(scope.renderer.patches.length, 0);
  scope.renderer.start();
  assert.equal(scope.callbacks.size, 0);
  scope.renderer.dispose();
  assert.ok(scope.canvases.every((canvas) => canvas.width === 1 && canvas.height === 1));
});
