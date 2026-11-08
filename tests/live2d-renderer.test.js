// 这些测试使用明确的 DOM/Framework/WebGL 替身，只证明生命周期和边界，不证明 GPU、模型外观或官方编译通过。
// Explicit DOM/Framework/WebGL substitutes verify lifecycle/boundaries only, never GPU support, model appearance or official shader compilation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Live2DRenderer, coverProjection, renderDimensions, resolveLocalAssetUrl, verifyFirstDraw, validateShaderPrograms,
} from '../src/live2d/renderer.js';
import {
  applyIdleMotion, blinkOpeningAt, collectVerifiedBindings, idlePhaseForKey, sampleIdleMotion,
} from '../src/live2d/idle-motion.js';
import { releaseContextShaders, releaseShaderPrograms, runCleanup, safelyRelease } from '../src/live2d/cleanup.js';
import { createRuntimeLoader, readyCoreVersion } from '../src/live2d/loader.js';

// 延迟 Promise 让卸载发生在读取或解码期间，刻意模拟无法及时取消的旧结果。
// A deferred promise places disposal during reading/decoding, including old results that cannot be cancelled promptly.
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

// 最小官方接口替身保留每个 GL 的缓存和全局引用计数观察点；没有伪造可发布的模型资产。
// Minimal official-interface substitutes retain per-GL caches and global-lifetime observations without fabricating publishable model assets.
function mockSdk() {
  const state = { started: false, initialized: false, disposals: 0, models: [], consistency: [] };
  const manager = { _shaderMap: new Map(), getShader(gl) { return this._shaderMap.get(gl); } };
  const sdk = {
    CubismFramework: {
      isStarted: () => state.started,
      startUp: () => { state.started = true; return true; },
      isInitialized: () => state.initialized,
      initialize: () => { state.initialized = true; },
      dispose: () => { state.initialized = false; state.disposals += 1; },
      cleanUp: () => { state.started = false; },
    },
    CubismShaderManager_WebGL: { getInstance: () => manager },
    CubismShaderSet: class {},
    CubismMatrix44: class {
      scale() {}
      translate() {}
      multiplyByMatrix() {}
    },
    CubismUserModel: class {
      constructor() {
        this.draws = 0;
        this.released = false;
        this.model = {
          getParameterCount: () => 0,
          getCanvasWidth: () => 1254,
          getCanvasHeight: () => 1050,
          loadParameters() {},
          update() {},
        };
        state.models.push(this);
      }
      loadModel(buffer, consistency) { state.consistency.push(consistency); }
      getModel() { return this.model; }
      getModelMatrix() { return {}; }
      setRenderTargetSize() {}
      createRenderer() {
        this.renderer = {
          startUp: (gl) => {
            manager._shaderMap.set(gl, {
              _shaderSets: [], _shaderCount: 11, _blendShaderSetMap: new Map(),
              setShaderPath(path) { this.path = path; },
              registerShader() { for (const entry of this._shaderSets) entry.shaderProgram = {}; },
              registerBlendShader() {},
            });
          },
          setIsPremultipliedAlpha() {},
          bindTexture() {},
          setMvpMatrix() {},
          setRenderState() {},
          drawModel: () => { this.draws += 1; },
        };
      }
      getRenderer() { return this.renderer; }
      deleteRenderer() { this.renderer = null; }
      release() { this.released = true; }
    },
  };
  return { sdk, state, manager };
}

// 浏览器替身只记录调用顺序及所有权；readPixels 的合成 alpha 必须在测试报告中明确标识。
// The browser substitute records order/ownership only; its synthetic readPixels alpha is explicitly not rendering evidence.
function harness(options = {}) {
  const shared = options.shared ?? mockSdk();
  const records = { fetches: [], deletedTextures: [], deletedPrograms: [], decoded: [], uploads: [], errors: [], closed: 0, lost: 0, observed: 0, disconnected: 0 };
  const canvasListeners = new Map();
  const windowListeners = new Map();
  const frames = new Map();
  let frameSequence = 0;
  let now = 0;
  const gl = {
    NO_ERROR: 0, RGBA: 6408, UNSIGNED_BYTE: 5121, TEXTURE_2D: 3553,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37441, TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240, TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243,
    LINEAR: 9729, CLAMP_TO_EDGE: 33071, FRAMEBUFFER: 36160, COLOR_BUFFER_BIT: 16384,
    createTexture: () => ({}),
    deleteTexture: (texture) => records.deletedTextures.push(texture),
    deleteProgram: (program) => records.deletedPrograms.push(program),
    bindTexture() {}, pixelStorei() {}, texParameteri() {},
    texImage2D: (...args) => records.uploads.push(args),
    bindFramebuffer() {}, viewport() {}, clearColor() {}, clear() {},
    getError: () => 0,
    isContextLost: () => false,
    readPixels: (x, y, width, height, format, type, pixels) => { if (!options.transparent) pixels[3] = 255; },
    getExtension: () => ({ loseContext: () => { records.lost += 1; } }),
  };
  const canvas = {
    width: 0, height: 0,
    getContext: () => options.noWebGl ? null : gl,
    getBoundingClientRect: () => ({ width: 320, height: 280 }),
    addEventListener: (name, callback) => canvasListeners.set(name, callback),
    removeEventListener: (name) => canvasListeners.delete(name),
  };
  const environment = {
    location: { href: 'https://mahjong.example/table' },
    devicePixelRatio: 2,
    setTimeout, clearTimeout,
    performance: { now: () => now },
    requestAnimationFrame: (callback) => { const id = ++frameSequence; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    getComputedStyle: () => ({ getPropertyValue: () => options.focus ?? '24%' }),
    addEventListener: (name, callback) => windowListeners.set(name, callback),
    removeEventListener: (name) => windowListeners.delete(name),
    ResizeObserver: class {
      observe() { records.observed += 1; }
      disconnect() { records.disconnected += 1; }
    },
    fetch: async (url, request) => {
      records.fetches.push({ url, request });
      if (options.fetch) return options.fetch(url, request);
      return {
        ok: true,
        json: async () => ({ Version: 3, FileReferences: {
          Moc: 'model.moc3', Textures: ['texture-a.png', 'texture-b.png'],
          Physics: 'do-not-fetch.physics3.json', Expressions: [{ File: 'do-not-fetch.exp3.json' }],
        } }),
        arrayBuffer: async () => new ArrayBuffer(8),
        blob: async () => ({ url }),
        text: async () => 'explicitly mocked shader source',
      };
    },
    createImageBitmap: async (blob, decodeOptions) => {
      records.decoded.push({ blob, options: decodeOptions });
      return { close: () => { records.closed += 1; } };
    },
  };
  if (options.decode) environment.createImageBitmap = options.decode;
  const renderer = new Live2DRenderer(canvas, (error) => records.errors.push(error), 'sweet:seat-0', {
    environment, importFramework: async () => shared.sdk,
  });
  const tick = (milliseconds) => {
    now = milliseconds;
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(now);
  };
  return { renderer, gl, canvas, records, environment, canvasListeners, frames, shared, tick };
}
const descriptor = Object.freeze({ modelUrl: '/characters/live2d/sweet/model.model3.json', verifiedBindings: [] });

// URL 契约拒绝跨域、协议绕过和带凭证 URL；相同来源的相对资源仍可正常解析。
// URL contracts reject cross-origin/protocol/credential bypasses while retaining local relative-resource resolution.
test('Live2D resolves only same-origin HTTP assets and rejects external variants', () => {
  const base = 'https://mahjong.example/models/sweet/model.model3.json';
  assert.equal(resolveLocalAssetUrl('textures/a.png', base), 'https://mahjong.example/models/sweet/textures/a.png');
  for (const url of ['https://other.example/a', '//other.example/a', 'data:text/plain,a', 'blob:https://mahjong.example/x', 'https://user:pass@mahjong.example/a', '/model#fragment', '/model?target=external', '']) {
    assert.throws(() => resolveLocalAssetUrl(url, base));
  }
  for (const path of ['../sunny/t.png', '/api/private', '/models/sweetness/t.png', 'textures%2f..%2f..%2ft.png']) {
    assert.throws(() => resolveLocalAssetUrl(path, base, new URL(base).origin, '/models/sweet/'));
  }
});

// 画布像素上限与焦点数学不需要 GPU，保持宽高比例和 object-position 方向。
// Buffer caps and focus math need no GPU and preserve proportional dimensions/object-position direction.
test('Live2D caps DPR and edge while cover projection honors portrait focus', () => {
  assert.deepEqual(renderDimensions(320, 280, 3), { width: 480, height: 420 });
  assert.deepEqual(renderDimensions(1200, 1000, 2), { width: 640, height: 533 });
  assert.deepEqual(renderDimensions(0, 0, 1), { width: 1, height: 1 });
  const center = coverProjection(500, 200, 1254, 1050, 0.5, 0.5);
  assert.equal(center.translateY, 0);
  assert.ok(coverProjection(500, 200, 1254, 1050, 0.5, 0.24).translateY < 0);
  assert.ok(coverProjection(200, 500, 1254, 1050, 0, 0.5).translateX > 0);
  assert.throws(() => coverProjection(1, 0, 1, 1));
});

// 数值接口成功不能代替像素；空透明帧和 GL 错误必须拒绝 loaded。
// Numeric-interface success cannot substitute for pixels: transparent frames and GL errors must reject loaded.
test('Live2D first-draw gate rejects transparent pixels and GL errors', () => {
  const scope = harness({ transparent: true });
  assert.throws(() => verifyFirstDraw(scope.gl, 4, 4), /no visible/);
  scope.gl.getError = () => 1282;
  assert.throws(() => verifyFirstDraw(scope.gl, 4, 4), /1282/);
  scope.renderer.dispose();
});

// 八秒所有候选曲线闭合，三次眨眼左右同步，稳定角色/座位键错开相位。
// Every candidate curve closes after eight seconds, three blinks synchronize both eyes, and stable character/seat keys offset phases.
test('idle math is periodic and deterministic with exactly three synchronized blink pulses', () => {
  assert.equal(idlePhaseForKey('sweet:0'), idlePhaseForKey('sweet:0'));
  assert.ok(Math.abs(idlePhaseForKey('sweet:0') - idlePhaseForKey('sweet:1')) > 0.3);
  const start = sampleIdleMotion(0.83, 1.2);
  const repeated = sampleIdleMotion(8.83, 1.2);
  for (const id of Object.keys(start)) assert.ok(Math.abs(start[id] - repeated[id]) < 1e-12);
  let closingGroups = 0;
  let wasClosing = false;
  for (let time = 0; time < 8; time += 0.01) {
    const sample = sampleIdleMotion(time);
    assert.equal(sample.ParamEyeLOpen, sample.ParamEyeROpen);
    const closing = sample.ParamEyeLOpen < 1;
    if (closing && !wasClosing) closingGroups += 1;
    wasClosing = closing;
    assert.ok(!Object.keys(sample).some((id) => /Front|Mouth/.test(id)));
  }
  assert.equal(closingGroups, 3);
  assert.equal(blinkOpeningAt(1.5), 0);
  const frames = Array.from({ length: 192 }, (_, index) => sampleIdleMotion(index / 24));
  assert.ok(frames.filter((frame) => frame.ParamEyeLOpen === 0).length >= 3);
  assert.ok(Math.max(...frames.map((frame) => frame.ParamHairSideL)) > 0.7);
  assert.ok(Math.min(...frames.map((frame) => frame.ParamHairSideR)) < -0.7);
});

// 参数存在但未审计时不可写；额外前发/嘴部即使误入白名单也没有待机实现。
// Existing-but-unaudited parameters cannot be written, and front-hair/mouth IDs have no idle implementation even if incorrectly allowlisted.
test('idle bindings require both explicit audited IDs and actual Core parameter indexes', () => {
  const ids = ['ParamAngleX', 'ParamEyeLOpen', 'ParamHairBack', 'ParamHairFront', 'ParamMouthOpenY'];
  const writes = [];
  const model = {
    getParameterCount: () => ids.length,
    getParameterId: (index) => ({ getString: () => ({ s: ids[index] }) }),
    getParameterMinimumValue: () => -1,
    getParameterMaximumValue: () => 1,
    getParameterDefaultValue: () => 0.5,
    getParameterIndex: () => assert.fail('must not invent indexes'),
    setParameterValueByIndex: (...args) => writes.push(args),
  };
  assert.deepEqual(collectVerifiedBindings(model, []), []);
  const bindings = collectVerifiedBindings(model, ['ParamAngleX', 'ParamHairFront', 'ParamMouthOpenY', 'ParamAngleY']);
  assert.deepEqual(bindings.map((binding) => binding.id), ['ParamAngleX']);
  applyIdleMotion(model, bindings, 2, 0);
  assert.deepEqual(writes, [[0, 1]]);
  assert.equal(collectVerifiedBindings(model, ['ParamHairBack']).length, 1);
});

// R5 编译失败产生的 0/空项、共享 program、单个 deleteProgram 抛错都不能中断余项清理。
// R5 zero/null entries, shared programs and one throwing deleteProgram cannot interrupt remaining cleanup.
test('shader cleanup skips numeric failures, deduplicates programs and continues after errors', () => {
  const first = {};
  const second = {};
  const calls = [];
  const shader = { _shaderSets: [0, null, { shaderProgram: first }, { shaderProgram: first }, { shaderProgram: second }] };
  const errors = releaseShaderPrograms(shader, { deleteProgram: (program) => { calls.push(program); if (program === first) throw new Error('mock failure'); } });
  assert.deepEqual(calls, [first, second]);
  assert.equal(errors.length, 1);
  assert.deepEqual(shader._shaderSets, []);
});

// 释放一张画布不能释放另一 GL 的 shader；最后仍移除当前缓存键。
// Releasing one canvas cannot release another GL's shader and must remove its own cache key.
test('shader context removal preserves sibling caches even after program deletion throws', () => {
  const gl = { deleteProgram: () => { throw new Error('mock failure'); } };
  const siblingGl = {};
  const sibling = { _shaderSets: [{ shaderProgram: {} }] };
  const manager = { _shaderMap: new Map([[gl, { _shaderSets: [{ shaderProgram: {} }] }], [siblingGl, sibling]]), getShader(context) { return this._shaderMap.get(context); } };
  assert.equal(releaseContextShaders(manager, gl).length, 1);
  assert.deepEqual([...manager._shaderMap.keys()], [siblingGl]);
  assert.equal(sibling._shaderSets.length, 1);
  assert.equal(safelyRelease({ dispose: () => { throw new Error('mock failure'); } }).length, 1);
  assert.equal(runCleanup([() => { throw new Error(); }, () => {}]).length, 1);
});

// 版本函数必须实际成功；script.onload 与存在函数都不足够。
// The version call must actually succeed; script.onload and a defined wrapper are insufficient.
test('Core readiness requires a real successful native version call', () => {
  assert.equal(readyCoreVersion(undefined), null);
  assert.equal(readyCoreVersion({ Version: { csmGetVersion: () => { throw new Error('not ready'); } } }), null);
  assert.equal(readyCoreVersion({ Version: { csmGetVersion: () => 0 } }), null);
  assert.equal(readyCoreVersion({ Version: { csmGetVersion: () => 0x06000001 } }), 0x06000001);
});

// 模拟核心启动，只在 WASM 就绪后导入 renderer；并发调用共用一次加载。
// Simulated Core startup imports the renderer only after WASM readiness and shares a single concurrent load.
test('runtime loader injects only local Core and defers renderer import until native readiness', async () => {
  const timers = new Map();
  const scripts = [];
  let imports = 0;
  let ready = false;
  let timerSequence = 0;
  const environment = {
    location: { href: 'https://mahjong.example/' },
    Live2DCubismCore: { Version: { csmGetVersion: () => { if (!ready) throw new Error('pending'); return 0x06000001; } } },
    setTimeout: (callback, delay) => { const id = ++timerSequence; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    document: {
      querySelector: () => null,
      createElement: () => ({ dataset: {}, addEventListener() {}, removeEventListener() {}, remove() {} }),
      head: { appendChild: (script) => scripts.push(script) },
    },
  };
  const load = createRuntimeLoader({ environment, isAllowed: () => true, importRenderer: async () => { imports += 1; return { Live2DRenderer }; } });
  const first = load();
  assert.equal(first, load());
  assert.equal(imports, 0);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, 'https://mahjong.example/vendor/live2d/live2dcubismcore.min.js');
  ready = true;
  [...timers.values()].find((timer) => timer.delay === 25).callback();
  assert.equal((await first).Live2DRenderer, Live2DRenderer);
  assert.equal(imports, 1);
  assert.equal(timers.size, 0);
});

// 正常流程也只是替身验收：检查真实接口顺序、串行解码、忽略旧物理和完整清理。
// Even the success case is mocked: verify interface order, serial decoding, ignored old physics and complete cleanup.
test('renderer loads through the official interface and verifies its first draw before loaded', async () => {
  const scope = harness();
  await scope.renderer.load(descriptor);
  assert.equal(scope.renderer.loaded, true);
  assert.deepEqual(scope.shared.state.consistency, [true]);
  assert.equal(scope.shared.state.models[0].draws, 1);
  assert.equal(scope.records.uploads.length, 2);
  assert.equal(scope.records.closed, 2);
  assert.ok(scope.records.decoded.every(({ options }) => options.premultiplyAlpha === 'premultiply'));
  assert.ok(scope.records.fetches.every(({ request }) => request.redirect === 'error' && request.mode === 'same-origin'));
  assert.ok(!scope.records.fetches.some(({ url }) => /do-not-fetch/.test(url)));
  assert.equal(scope.renderer.focusY, 0.24);
  scope.renderer.dispose();
  scope.renderer.dispose();
  assert.equal(scope.records.deletedTextures.length, 2);
  assert.equal(scope.shared.manager._shaderMap.size, 0);
  assert.equal(scope.records.lost, 1);
  assert.equal(scope.records.disconnected, 1);
  assert.equal(scope.canvasListeners.size, 0);
  assert.equal(scope.renderer.canvas, null);
});

// 模型/Core 替身可成功但画面仍空，必须向控制器报告失败并撤销所有权。
// Model/Core substitutes can succeed while the frame stays empty; report failure and relinquish all ownership.
test('transparent first frame rejects loading and cleans every allocated texture', async () => {
  const scope = harness({ transparent: true });
  await assert.rejects(scope.renderer.load(descriptor), /no visible model pixels/);
  assert.equal(scope.renderer.loaded, false);
  assert.equal(scope.renderer.disposed, true);
  assert.equal(scope.records.deletedTextures.length, 2);
  assert.equal(scope.records.errors.length, 1);
});

// 没有 WebGL 时不能把官方数值加载当作动态成功，仍释放共享 Framework 所有权。
// Without WebGL, official numeric loading cannot count as dynamic success; shared Framework ownership is released.
test('WebGL absence is an explicit fallback rather than a successful render', async () => {
  const scope = harness({ noWebGl: true });
  await assert.rejects(scope.renderer.load(descriptor), /WebGL is unavailable/);
  assert.equal(scope.renderer.loaded, false);
  assert.equal(scope.records.errors.length, 1);
  assert.equal(scope.shared.state.disposals, 1);
});

// 卸载后才返回清单时，不得再读取 moc3、更不能取得 GL 或调用错误回调覆盖新实例。
// A settings response arriving after disposal cannot fetch moc3, acquire GL or notify over a replacement instance.
test('stale loading completion is rejected without constructing a model', async () => {
  const pending = deferred();
  const scope = harness({ fetch: async () => pending.promise });
  const loading = scope.renderer.load(descriptor);
  scope.renderer.dispose();
  pending.resolve({ ok: true, json: async () => ({ Version: 3, FileReferences: { Moc: 'm.moc3', Textures: ['t.png'] } }) });
  await assert.rejects(loading, { name: 'AbortError' });
  assert.equal(scope.records.fetches.length, 1);
  assert.equal(scope.shared.state.models.length, 0);
  assert.equal(scope.records.errors.length, 0);
});

// 解码取消后晚到的位图必须关闭一次，不能上传到已销毁/替换的画布。
// A bitmap arriving after decode cancellation must close once and cannot upload to a destroyed/replaced canvas.
test('late texture decoding closes the bitmap and never uploads after disposal', async () => {
  const pending = deferred();
  const entered = deferred();
  let closes = 0;
  const scope = harness({ decode: () => { entered.resolve(); return pending.promise; } });
  const loading = scope.renderer.load(descriptor);
  await entered.promise;
  scope.renderer.dispose();
  await assert.rejects(loading, { name: 'AbortError' });
  pending.resolve({ close: () => { closes += 1; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closes, 1);
  assert.equal(scope.records.uploads.length, 0);
});

// 同时运行时先释放一位，另一位的缓存和全局初始化必须保留，最后一位才清空 Framework。
// Releasing one simultaneous portrait preserves its sibling cache/global initialization; the last owner cleans the Framework.
test('multiple portraits isolate shader ownership and delay global Framework disposal', async () => {
  const shared = mockSdk();
  const first = harness({ shared });
  const second = harness({ shared });
  await Promise.all([first.renderer.load(descriptor), second.renderer.load(descriptor)]);
  first.renderer.dispose();
  assert.equal(shared.manager._shaderMap.size, 1);
  assert.equal(shared.state.initialized, true);
  assert.equal(shared.state.disposals, 0);
  assert.equal(second.renderer.loaded, true);
  second.renderer.dispose();
  assert.equal(shared.manager._shaderMap.size, 0);
  assert.equal(shared.state.disposals, 1);
});

// 反应图暂停不累计间隔；30fps 绘制上限及恢复相位通过保留 elapsed 验证。
// Reaction pauses exclude the gap; retained elapsed time verifies the draw-rate cap and resumed phase.
test('animation caps draw frequency and preserves elapsed time across pause/resume', async () => {
  const scope = harness();
  await scope.renderer.load(descriptor);
  const draws = [];
  scope.renderer.draw = (elapsed) => draws.push(elapsed);
  scope.renderer.start();
  scope.tick(10);
  scope.tick(20);
  scope.tick(44);
  scope.renderer.stop();
  assert.equal(draws.length, 2);
  assert.equal(scope.renderer.elapsedMs, 44);
  scope.tick(3044);
  scope.renderer.start();
  scope.tick(3054);
  assert.equal(draws.at(-1), 0.054);
  scope.renderer.dispose();
  assert.equal(scope.frames.size, 0);
});

// contextlost 与重复错误只回报一次，监听与帧循环都停止。
// Context loss and repeated errors notify once and stop listeners/frame scheduling.
test('context loss reports once and releases the canvas before notifying fallback', async () => {
  const scope = harness();
  await scope.renderer.load(descriptor);
  scope.renderer.start();
  let prevented = false;
  scope.canvasListeners.get('webglcontextlost')({ preventDefault: () => { prevented = true; } });
  scope.renderer.fail(new Error('duplicate'));
  assert.equal(prevented, true);
  assert.equal(scope.records.errors.length, 1);
  assert.equal(scope.frames.size, 0);
  assert.equal(scope.renderer.canvas, null);
});

// 某个 SDK 释放函数抛错仍不能阻断纹理、缓存、上下文和其他所有权释放。
// A throwing SDK release cannot block textures, shader caches, context or other ownership cleanup.
test('throwing model release still frees remaining resources and ownership', async () => {
  const scope = harness();
  await scope.renderer.load(descriptor);
  scope.renderer.userModel.deleteRenderer = () => { throw new Error('mock renderer release'); };
  scope.renderer.userModel.release = () => { throw new Error('mock model release'); };
  scope.renderer.dispose();
  assert.equal(scope.records.deletedTextures.length, 2);
  assert.equal(scope.records.lost, 1);
  assert.equal(scope.shared.manager._shaderMap.size, 0);
  assert.equal(scope.shared.state.disposals, 1);
  assert.equal(scope.renderer.userModel, null);
});

// 缺省焦点与原图一致；本人显式 50% 仍有效，不在切层时跳动。
// Missing focus matches original art; explicit own-frame 50% remains valid without a layer-switch jump.
test('missing custom focus defaults to the original 24%, while explicit own art stays centered', async () => {
  for (const [focus, expected] of [['', 0.24], ['50%', 0.5]]) {
    const scope = harness({ focus });
    await scope.renderer.load(descriptor);
    assert.equal(scope.renderer.focusY, expected);
    scope.renderer.dispose();
  }
});

// 只允许未使用保留槽为空；映射范围内失败程序必须拒绝。
// Only unused reserved slots may be empty; failures in mapped ranges must reject.
test('shader validation distinguishes reachable programs from reserved tail slots', () => {
  const shader = { _shaderSets: Array.from({ length: 17 }, (_, index) => index < 14 ? { shaderProgram: {} } : {}), _blendShaderSetMap: new Map([['MultiplyAtop', 11]]) };
  assert.equal(validateShaderPrograms(shader), 14);
  shader._shaderSets[12].shaderProgram = 0;
  assert.throws(() => validateShaderPrograms(shader), /shader 12 failed/);
  shader._shaderSets[12].shaderProgram = {};
  shader._blendShaderSetMap.set('bad', 16);
  assert.throws(() => validateShaderPrograms(shader), /range/);
});
