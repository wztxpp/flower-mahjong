// 单画布的真实 Cubism 渲染器：读取本地 moc3/纹理，完成真实首帧像素验证后才报告 loaded。
// A real, single-canvas Cubism renderer loads local moc3/textures and reports loaded only after actual first-frame pixel verification.
// 官方源码保持原字节；R5 的有界着色器加载/逐上下文清理由这里适配，不能用 Core 数值检查冒充 GPU 验收。
// Official sources remain byte-exact; this adapter owns bounded R5 shader loading/context cleanup, and Core numeric checks are not GPU acceptance.
import { applyIdleMotion, collectVerifiedBindings, idlePhaseForKey } from './idle-motion.js';
import { releaseContextShaders, runCleanup } from './cleanup.js';

export const MAX_RENDER_EDGE = 640;
export const MAX_DEVICE_PIXEL_RATIO = 1.5;
export const FRAME_INTERVAL_MS = 1000 / 30;
export const ASSET_TIMEOUT_MS = 18000;
export const SHADER_ROOT = '/vendor/live2d/shaders/';

// 属性名与固定 R5 官方 loadShaders 清单一致；这里只改变读取的取消/超时策略，不重写着色器。
// Property names match the pinned R5 loadShaders inventory; only cancellation/timeouts change, never shader source bytes.
const SHADER_SOURCES = Object.freeze([
  ['vertshadersrc.vert', '_vertShaderSrc'],
  ['vertshadersrcmasked.vert', '_vertShaderSrcMasked'],
  ['vertshadersrcsetupmask.vert', '_vertShaderSrcSetupMask'],
  ['fragshadersrcsetupmask.frag', '_fragShaderSrcSetupMask'],
  ['fragshadersrcpremultipliedalpha.frag', '_fragShaderSrcPremultipliedAlpha'],
  ['fragshadersrcmaskpremultipliedalpha.frag', '_fragShaderSrcMaskPremultipliedAlpha'],
  ['fragshadersrcmaskinvertedpremultipliedalpha.frag', '_fragShaderSrcMaskInvertedPremultipliedAlpha'],
  ['vertshadersrccopy.vert', '_vertShaderSrcCopy'],
  ['fragshadersrccopy.frag', '_fragShaderSrcCopy'],
  ['fragshadersrccolorblend.frag', '_fragShaderSrcColorBlend'],
  ['fragshadersrcalphablend.frag', '_fragShaderSrcAlphaBlend'],
  ['vertshadersrcblend.vert', '_vertShaderSrcBlend'],
  ['fragshadersrcpremultipliedalphablend.frag', '_fragShaderSrcBlend'],
]);
let frameworkPromise = null;
const frameworkOwners = new Map();

// loader 已确认 Core 的 WASM 就绪后才触发此动态导入；测试可替换这一边界，不替换生产模型。
// This import runs only after the loader confirms Core WASM readiness; tests may replace the boundary, never production models.
async function importFramework() {
  if (!frameworkPromise) {
    frameworkPromise = Promise.all([
      import('../../vendor/live2d/Framework/src/live2dcubismframework.ts'),
      import('../../vendor/live2d/Framework/src/model/cubismusermodel.ts'),
      import('../../vendor/live2d/Framework/src/math/cubismmatrix44.ts'),
      import('../../vendor/live2d/Framework/src/rendering/cubismshader_webgl.ts'),
    ]).then(([framework, model, matrix, shader]) => ({ ...framework, ...model, ...matrix, ...shader }))
      .catch((error) => {
        frameworkPromise = null;
        throw error;
      });
  }
  return frameworkPromise;
}

// 同页四个实例共用 Framework 的 ID 管理器；最后一个所有者释放后才能全局清理。
// Concurrent portraits share the Framework ID manager; global cleanup is legal only after the last owner releases it.
function retainFramework(sdk) {
  const framework = sdk.CubismFramework;
  if (!framework.isStarted() && !framework.startUp()) throw new Error('Cubism Framework startup failed.');
  if (!framework.isInitialized()) framework.initialize();
  frameworkOwners.set(framework, (frameworkOwners.get(framework) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = frameworkOwners.get(framework) - 1;
    if (remaining > 0) {
      frameworkOwners.set(framework, remaining);
      return;
    }
    frameworkOwners.delete(framework);
    runCleanup([() => framework.dispose(), () => framework.cleanUp()]);
  };
}

// 所有模型、纹理和着色器都必须是同源 HTTP(S)，拒绝凭证、跨域、data/blob 和重定向。
// Models, textures and shaders must use same-origin HTTP(S), without URL credentials, cross-origin/data/blob URLs or redirects.
export function resolveLocalAssetUrl(value, baseUrl, expectedOrigin = new URL(baseUrl).origin, requiredDirectory = null) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Live2D asset URL is missing.');
  const url = new URL(value, baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== expectedOrigin || url.username || url.password) {
    throw new Error('Live2D assets must use approved same-origin URLs.');
  }
  if (url.search || url.hash) throw new Error('Live2D asset URLs cannot contain queries or fragments.');
  if (/%(?:2f|5c|2e)/i.test(url.pathname)) throw new Error('Live2D asset URLs cannot contain encoded path separators or traversal.');
  if (requiredDirectory && !url.pathname.startsWith(requiredDirectory)) {
    throw new Error('Live2D model resources must remain in their own model directory.');
  }
  return url.href;
}

// 按 CSS 尺寸与有限 DPR 保持比例，限制画布长边，避免四座同时创建过大的 GPU 缓冲。
// Preserve CSS aspect at bounded DPR/long edge, avoiding oversized simultaneous GPU buffers.
export function renderDimensions(width, height, devicePixelRatio = 1) {
  const cssWidth = Math.max(1, Number.isFinite(width) ? width : 1);
  const cssHeight = Math.max(1, Number.isFinite(height) ? height : 1);
  const ratio = Math.min(MAX_DEVICE_PIXEL_RATIO, Math.max(1, devicePixelRatio || 1));
  const scale = Math.min(ratio, MAX_RENDER_EDGE / Math.max(cssWidth, cssHeight));
  return { width: Math.max(1, Math.round(cssWidth * scale)), height: Math.max(1, Math.round(cssHeight * scale)) };
}

// 模型默认高为 2；此投影实现等比 cover，焦点与 CSS object-position 的百分比语义一致。
// The model matrix has height two; this projection implements proportional cover with CSS object-position percentage semantics.
export function coverProjection(width, height, modelWidth, modelHeight, focusX = 0.5, focusY = 0.5) {
  if (![width, height, modelWidth, modelHeight].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('Live2D canvas and model dimensions must be positive.');
  }
  const targetAspect = width / height;
  const modelAspect = modelWidth / modelHeight;
  const scale = Math.max(1, targetAspect / modelAspect);
  const horizontalFocus = Math.max(0, Math.min(1, focusX));
  const verticalFocus = Math.max(0, Math.min(1, focusY));
  return {
    scaleX: scale / targetAspect,
    scaleY: scale,
    translateX: (1 - 2 * horizontalFocus) * (modelAspect * scale / targetAspect - 1),
    translateY: (2 * verticalFocus - 1) * (scale - 1),
  };
}

// 原始像素必须至少包含一个非透明像素；背景由 CSS 绘制，不能替真正模型通过此门槛。
// At least one actual model pixel must have alpha; CSS owns the background so it cannot satisfy this rendering gate.
export function verifyFirstDraw(gl, width, height) {
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const error = gl.getError();
  if (error !== gl.NO_ERROR) throw new Error(`Live2D first-frame WebGL error: ${error}.`);
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 0) return;
  }
  throw new Error('Live2D first frame contains no visible model pixels.');
}

// 固定 R5 给 Normal/Over 预留三个未使用尾槽；只验真实标准/复制及混合映射可到达的槽。
// Pinned R5 reserves three unused Normal/Over tail slots; validate only reachable standard/copy/blend slots.
// 不能放松为“存在任意程序”：任一会绘制的掩膜/混合程序失败仍必须阻止 loaded。
// Merely finding any program is insufficient: every reachable mask/blend program must be valid before loaded.
export function validateShaderPrograms(shader) {
  const sets = shader?._shaderSets;
  const blendMap = shader?._blendShaderSetMap;
  if (!Array.isArray(sets) || typeof blendMap?.values !== 'function') throw new Error('Unsupported official shader registry');
  const required = new Set(Array.from({ length: 11 }, (_, index) => index));
  for (const base of blendMap.values()) {
    if (!Number.isInteger(base) || base < 11 || base + 2 >= sets.length) throw new Error('Invalid official blend shader range');
    for (let offset = 0; offset < 3; offset += 1) required.add(base + offset);
  }
  for (const index of required) {
    const program = sets[index]?.shaderProgram;
    if (!program || typeof program !== 'object') throw new Error(`Official Live2D shader ${index} failed to compile/link`);
  }
  return required.size;
}

// 每个实例独占捕获的 canvas；一次 load 后换角色必须新建实例，不能让旧请求复用新画布。
// Each instance exclusively owns its captured canvas; changing characters requires a fresh instance rather than reusing it for stale work.
export class Live2DRenderer {
  constructor(canvas, onError = () => {}, phaseKey = '', dependencies = {}) {
    this.canvas = canvas;
    this.onError = onError;
    this.environment = dependencies.environment ?? globalThis;
    this.importFramework = dependencies.importFramework ?? importFramework;
    this.phaseSeconds = idlePhaseForKey(phaseKey);
    this.loaded = false;
    this.disposed = false;
    this.startedLoading = false;
    this.running = false;
    this.elapsedMs = 0;
    this.startedAt = 0;
    this.lastFrameAt = -Infinity;
    this.frameHandle = null;
    this.generation = 0;
    this.abortController = new AbortController();
    this.textures = [];
    this.bindings = [];
    this.gl = null;
    this.userModel = null;
    this.sdk = null;
    this.releaseFramework = null;
    this.shaderManager = null;
    this.resizeObserver = null;
    this.hasReportedError = false;
    this.onContextLost = (event) => {
      event.preventDefault();
      this.fail(new Error('Live2D WebGL context was lost.'));
    };
    this.onResize = () => {
      try {
        this.resize();
      } catch (error) {
        this.fail(error);
      }
    };
  }

  // 每个 await 后检查所有权，取消或卸载后的完成结果不能变为 loaded 或写入 GPU。
  // Recheck ownership after each await so cancellation/unmount can never produce loaded state or GPU writes.
  assertCurrent(generation) {
    if (this.disposed || generation !== this.generation || this.abortController.signal.aborted) {
      throw new DOMException('Live2D load was cancelled.', 'AbortError');
    }
  }

  // 单个读取与正文解码共同受 18 秒超时及实例取消控制，禁止跟随重定向到外部服务。
  // A fetch plus body decoding shares an 18-second deadline and instance cancellation, without following redirects to external services.
  async fetchAsset(url, bodyMethod) {
    const controller = new AbortController();
    const lifetimeSignal = this.abortController.signal;
    const abort = () => controller.abort(lifetimeSignal.reason);
    lifetimeSignal.addEventListener('abort', abort, { once: true });
    if (lifetimeSignal.aborted) abort();
    const timer = this.environment.setTimeout(() => controller.abort(new Error('Live2D asset loading timed out.')), ASSET_TIMEOUT_MS);
    try {
      const response = await this.environment.fetch(url, {
        signal: controller.signal,
        mode: 'same-origin',
        credentials: 'same-origin',
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`Live2D asset returned HTTP ${response.status}.`);
      return await response[bodyMethod]();
    } finally {
      this.environment.clearTimeout(timer);
      lifetimeSignal.removeEventListener('abort', abort);
    }
  }

  // 纹理逐张解码，超时/卸载时拒绝；晚到的 ImageBitmap 仍须 close，不能留下原生图像内存。
  // Decode textures serially, reject timeout/unmount, and close even a late ImageBitmap to release native image memory.
  async decodeTexture(blob) {
    if (typeof this.environment.createImageBitmap !== 'function') {
      throw new Error('This browser does not support the required ImageBitmap texture decoder.');
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const signal = this.abortController.signal;
      const finish = (error, bitmap) => {
        if (settled) {
          bitmap?.close();
          return;
        }
        settled = true;
        this.environment.clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(bitmap);
      };
      const abort = () => finish(new DOMException('Live2D texture decode was cancelled.', 'AbortError'));
      const timer = this.environment.setTimeout(
        () => finish(new Error('Live2D texture decoding timed out.')),
        ASSET_TIMEOUT_MS,
      );
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      Promise.resolve().then(() => this.environment.createImageBitmap(blob, {
        premultiplyAlpha: 'premultiply',
        colorSpaceConversion: 'none',
      })).then((bitmap) => finish(null, bitmap), (error) => finish(error));
    });
  }

  // R5 默认 shader fetch 无取消接口；我们读取同一官方源码，再同步调用原编译/注册函数。
  // R5's default shader fetch lacks cancellation; fetch identical official sources here, then use its unchanged compiler/registration functions.
  async prepareShaders(generation) {
    const shader = this.shaderManager.getShader(this.gl);
    shader.setShaderPath(SHADER_ROOT);
    const sources = await Promise.all(SHADER_SOURCES.map(async ([filename, property]) => {
      const url = resolveLocalAssetUrl(SHADER_ROOT + filename, this.environment.location.href);
      return { property, source: await this.fetchAsset(url, 'text') };
    }));
    this.assertCurrent(generation);
    for (const { property, source } of sources) {
      if (!source.trim()) throw new Error('An official Live2D shader source is empty.');
      shader[property] = source;
    }
    shader._shaderSets = Array.from({ length: shader._shaderCount }, () => new this.sdk.CubismShaderSet());
    shader.registerShader();
    shader.registerBlendShader();
    validateShaderPrograms(shader);
    shader._isShaderLoaded = true;
    shader._isShaderLoading = false;
    this.checkGlError('shader preparation');
  }

  // 固定一次加载：先获取官方模型，再串行上传纹理；不读取模型清单的 motions/expressions/physics。
  // Load once: instantiate the official model and upload textures serially; ignore motions/expressions/physics entries in model settings.
  async load(descriptor) {
    if (this.startedLoading || this.disposed) throw new Error('A Live2D renderer can load only once.');
    this.startedLoading = true;
    const generation = ++this.generation;
    try {
      this.descriptor = descriptor;
      const pageUrl = this.environment.location.href;
      const modelUrl = resolveLocalAssetUrl(descriptor?.modelUrl, pageUrl);
      const origin = new URL(pageUrl).origin;
      const settings = await this.fetchAsset(modelUrl, 'json');
      this.assertCurrent(generation);
      const references = settings?.FileReferences;
      if (settings?.Version !== 3 || typeof references?.Moc !== 'string' || !Array.isArray(references.Textures) || !references.Textures.length) {
        throw new Error('Live2D requires a version-three model with moc3 and textures.');
      }
      // 清单中的相对文件只能留在本角色目录，不能转去另一角色、API 或同源任意地址。
      // Manifest references stay inside this character's directory, never another role, API or arbitrary same-origin target.
      const modelDirectory = new URL('.', modelUrl).pathname;
      const mocUrl = resolveLocalAssetUrl(references.Moc, modelUrl, origin, modelDirectory);
      const textureUrls = references.Textures.map((url) => resolveLocalAssetUrl(url, modelUrl, origin, modelDirectory));
      const moc = await this.fetchAsset(mocUrl, 'arrayBuffer');
      this.assertCurrent(generation);
      const sdk = await this.importFramework();
      this.assertCurrent(generation);
      this.sdk = sdk;
      this.releaseFramework = retainFramework(sdk);
      this.gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power' });
      if (!this.gl) throw new Error('WebGL is unavailable; the static portrait remains visible.');
      this.canvas.addEventListener('webglcontextlost', this.onContextLost);
      this.userModel = new sdk.CubismUserModel();
      // true 由官方 CubismMoc 执行一致性校验；成功仍不代表已渲染。
      // true requests official CubismMoc consistency checking; success is still not proof of rendering.
      this.userModel.loadModel(moc, true);
      if (!this.userModel.getModel()) throw new Error('Official Cubism Core rejected the moc3 model.');
      this.bindings = collectVerifiedBindings(this.userModel.getModel(), descriptor.verifiedBindings);
      this.resize();
      this.userModel.createRenderer(this.canvas.width, this.canvas.height);
      const renderer = this.userModel.getRenderer();
      // 提前保存管理器，即使 startUp 中途失败也能清掉已经登记的当前 GL。
      // Capture the manager before startUp so a partial startup can still release its registered GL context.
      this.shaderManager = sdk.CubismShaderManager_WebGL.getInstance();
      renderer.startUp(this.gl);
      renderer.setIsPremultipliedAlpha(true);
      for (let index = 0; index < textureUrls.length; index += 1) {
        const blob = await this.fetchAsset(textureUrls[index], 'blob');
        this.assertCurrent(generation);
        const bitmap = await this.decodeTexture(blob);
        try {
          this.assertCurrent(generation);
          const texture = this.gl.createTexture();
          if (!texture) throw new Error('Live2D could not allocate a texture.');
          this.textures.push(texture);
          this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
          this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
          this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
          this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
          this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
          this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, bitmap);
          renderer.bindTexture(index, texture);
          this.gl.bindTexture(this.gl.TEXTURE_2D, null);
          this.checkGlError('texture upload');
        } finally {
          bitmap.close();
        }
      }
      await this.prepareShaders(generation);
      this.assertCurrent(generation);
      this.draw(0);
      verifyFirstDraw(this.gl, this.canvas.width, this.canvas.height);
      this.assertCurrent(generation);
      this.loaded = true;
      if (typeof this.environment.ResizeObserver === 'function') {
        this.resizeObserver = new this.environment.ResizeObserver(this.onResize);
        this.resizeObserver.observe(this.canvas);
      } else {
        this.environment.addEventListener('resize', this.onResize);
      }
      return this;
    } catch (error) {
      if (!this.disposed) this.fail(error);
      throw error;
    }
  }

  // 计算焦点时读取每个画框继承的 CSS，允许本人 50% 与对手 24/33/20% 共用同一角色目录。
  // Read inherited per-frame CSS focus so self 50% and opponent 24/33/20% can share a single character descriptor.
  resize() {
    if (this.disposed || !this.gl) return;
    const rectangle = this.canvas.getBoundingClientRect();
    const size = renderDimensions(rectangle.width, rectangle.height, this.environment.devicePixelRatio);
    if (this.canvas.width !== size.width) this.canvas.width = size.width;
    if (this.canvas.height !== size.height) this.canvas.height = size.height;
    this.userModel?.setRenderTargetSize(size.width, size.height);
    const focusValue = this.environment.getComputedStyle?.(this.canvas).getPropertyValue('--portrait-focus-y')?.trim();
    const focusNumber = Number.parseFloat(focusValue);
    // 缺省须与 CharacterArtwork 的 object-position 24% 相同；本人画框显式继承 50%。
    // Match CharacterArtwork's default 24% object-position; own frames explicitly inherit 50%.
    this.focusY = Number.isFinite(focusNumber) ? Math.max(0, Math.min(1, focusNumber / 100)) : 0.24;
    // 暂停中的容器改变尺寸也重画同一时间点，不重新启动动画或眨眼周期。
    // A resized paused frame redraws its retained instant without restarting animation or its blink cycle.
    if (this.loaded && !this.running) this.draw(this.elapsedMs / 1000);
  }

  // 按实际模型画布尺寸投影并更新允许参数；不把背景画入可验证的透明 WebGL 层。
  // Project actual model-canvas dimensions and update allowed parameters; never draw the background into the verified transparent WebGL layer.
  draw(elapsedSeconds) {
    if (this.disposed || !this.userModel || this.gl.isContextLost()) throw new Error('Live2D drawing context is unavailable.');
    const model = this.userModel.getModel();
    model.loadParameters();
    applyIdleMotion(model, this.bindings, elapsedSeconds, this.phaseSeconds);
    model.update();
    const projection = coverProjection(
      this.canvas.width, this.canvas.height, model.getCanvasWidth(), model.getCanvasHeight(), 0.5, this.focusY,
    );
    const matrix = new this.sdk.CubismMatrix44();
    matrix.scale(projection.scaleX, projection.scaleY);
    matrix.translate(projection.translateX, projection.translateY);
    matrix.multiplyByMatrix(this.userModel.getModelMatrix());
    const renderer = this.userModel.getRenderer();
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    renderer.setMvpMatrix(matrix);
    renderer.setRenderState(null, [0, 0, this.canvas.width, this.canvas.height]);
    renderer.drawModel();
    this.checkGlError('model drawing');
  }

  // 任何 WebGL 错误都使动态层失败并回退，不清空错误队列后假装成功。
  // Any WebGL error fails the dynamic layer into fallback, rather than silently draining errors and reporting success.
  checkGlError(stage) {
    const error = this.gl.getError();
    if (error !== this.gl.NO_ERROR) throw new Error(`Live2D ${stage} WebGL error: ${error}.`);
  }

  // 恢复既有累计时间，以 30fps 上限绘制；RAF 时间只作节流，暂停时不会累计后台时间。
  // Resume retained elapsed time with a 30fps draw cap; RAF time throttles frames and paused/background time never accrues.
  start() {
    if (!this.loaded || this.disposed || this.running) return;
    this.running = true;
    this.startedAt = this.environment.performance.now();
    this.lastFrameAt = -Infinity;
    const frame = (now) => {
      if (!this.running || this.disposed) return;
      try {
        if (now - this.lastFrameAt >= FRAME_INTERVAL_MS) {
          this.draw((this.elapsedMs + Math.max(0, now - this.startedAt)) / 1000);
          this.lastFrameAt = now;
        }
        this.frameHandle = this.environment.requestAnimationFrame(frame);
      } catch (error) {
        this.fail(error);
      }
    };
    this.frameHandle = this.environment.requestAnimationFrame(frame);
  }

  // 停止只冻结时间，不释放模型；三秒反应 PNG 结束后可无跳变地继续原待机周期。
  // Stop freezes time without releasing the model, allowing reaction PNGs to return to the same idle phase.
  stop() {
    if (this.running) this.elapsedMs += Math.max(0, this.environment.performance.now() - this.startedAt);
    this.running = false;
    if (this.frameHandle !== null) this.environment.cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
  }

  // 错误只通知一次，通知前已终止所有权；外部回调即使抛错也不会阻断清理。
  // Notify an error once, after releasing ownership; an external callback cannot interrupt resource cleanup.
  fail(error) {
    if (this.disposed || this.hasReportedError) return;
    this.hasReportedError = true;
    this.dispose();
    runCleanup([() => this.onError(error)]);
  }

  // 最后释放上下文；任一官方 release 抛错都不能阻止取消、纹理、监听器或其他所有权释放。
  // Release the context last; a throwing official release must not prevent cancellation, texture/listener cleanup or relinquishing ownership.
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.loaded = false;
    this.generation += 1;
    const gl = this.gl;
    const userModel = this.userModel;
    const textures = this.textures;
    try {
      runCleanup([
        () => this.stop(),
        () => this.abortController.abort(),
        () => this.resizeObserver?.disconnect(),
        () => this.environment.removeEventListener?.('resize', this.onResize),
        () => this.canvas?.removeEventListener('webglcontextlost', this.onContextLost),
        () => userModel?.deleteRenderer(),
        () => userModel?.release(),
        ...textures.map((texture) => () => gl?.deleteTexture(texture)),
        () => releaseContextShaders(this.shaderManager, gl),
        () => this.releaseFramework?.(),
        () => gl?.getExtension('WEBGL_lose_context')?.loseContext(),
      ]);
    } finally {
      this.textures = [];
      this.bindings = [];
      this.userModel = null;
      this.gl = null;
      this.sdk = null;
      this.shaderManager = null;
      this.releaseFramework = null;
      this.resizeObserver = null;
      this.canvas = null;
      this.descriptor = null;
    }
  }
}
