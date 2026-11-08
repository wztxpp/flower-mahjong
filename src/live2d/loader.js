// 按需加载本地官方 Core，然后才导入 Framework 入口；普通大厅不会提前下载/执行 SDK。
// Load the local official Core on demand, then import the Framework entry; the ordinary lobby does not eagerly download/execute the SDK.
// 共享的是启动 Promise，不是画布/模型；失败可重试，不把 script.onload 误当 WASM 已就绪。
// Only the startup promise is shared, never canvases/models; failures are retryable and script.onload is not mistaken for WASM readiness.
import { getLive2DConsent } from './consent.js';

export const CORE_SCRIPT_URL = '/vendor/live2d/live2dcubismcore.min.js';
export const CORE_READY_TIMEOUT_MS = 18000;

// 实际调用 Core 的原生版本接口；函数已定义但 WASM 未初始化时，调用仍可能抛错。
// Call Core's native version function: a defined JavaScript wrapper can still throw before WASM initialization.
export function readyCoreVersion(core) {
  try {
    const version = core?.Version?.csmGetVersion();
    return Number.isInteger(version) && version > 0 ? version : null;
  } catch {
    return null;
  }
}

// 允许测试注入 DOM/时钟/模块导入器，生产路径默认使用浏览器；替身测试不是 GPU 验收。
// Tests can inject DOM/clock/import collaborators; production uses browser defaults and mocked tests are not GPU acceptance.
export function createRuntimeLoader({
  environment = globalThis,
  importRenderer = () => import('./renderer.js'),
  timeoutMs = CORE_READY_TIMEOUT_MS,
  isAllowed = () => getLive2DConsent().enabled.value,
} = {}) {
  let startupPromise = null;
  return function loadRuntime() {
    // 即使其他调用入口漏了界面检查，也不能在同意前创建脚本、使用缓存或预取 Framework。
    // Even a caller missing its UI check cannot create scripts, reuse startup or prefetch Framework before assent.
    if (!isAllowed()) return Promise.reject(new Error('Live2D requires explicit current-version consent.'));
    if (startupPromise) return startupPromise;
    startupPromise = new Promise((resolve, reject) => {
      const document = environment.document;
      if (!document?.createElement || !document?.head) {
        reject(new Error('Live2D requires a browser document.'));
        return;
      }
      let script = document.querySelector('script[data-live2d-core="local"]');
      let ownsScript = false;
      let pollTimer = null;
      let timeoutTimer = null;
      let settled = false;
      const coreUrl = new URL(CORE_SCRIPT_URL, environment.location.href);
      if (script && new URL(script.src, environment.location.href).href !== coreUrl.href) {
        reject(new Error('Live2D Core must use the local approved SDK path.'));
        return;
      }

      // 统一成功/失败出口先解绑；失败仅移除本次创建的脚本，不碰其他代码的资源。
      // Both exits detach listeners first; failure removes only a script owned by this attempt.
      const settle = (error) => {
        if (settled) return;
        settled = true;
        environment.clearTimeout(pollTimer);
        environment.clearTimeout(timeoutTimer);
        script?.removeEventListener('error', onScriptError);
        if (error) {
          if (ownsScript) script.remove();
          reject(error);
          return;
        }
        resolve();
      };
      const onScriptError = () => settle(new Error('The local Live2D Core script could not load.'));
      const checkReady = () => {
        if (settled) return;
        if (readyCoreVersion(environment.Live2DCubismCore) !== null) {
          settle(null);
          return;
        }
        pollTimer = environment.setTimeout(checkReady, 25);
      };

      if (!script) {
        script = document.createElement('script');
        script.src = coreUrl.href;
        script.async = true;
        script.dataset.live2dCore = 'local';
        ownsScript = true;
      }
      script.addEventListener('error', onScriptError, { once: true });
      timeoutTimer = environment.setTimeout(
        () => settle(new Error('Live2D Core did not become WASM-ready within 18 seconds.')),
        timeoutMs,
      );
      if (ownsScript) document.head.appendChild(script);
      checkReady();
    }).then(() => {
      // Core 启动中撤销选择时不继续导入；已获准发送的浏览器脚本/模块不能承诺清除缓存。
      // Withdrawal during Core startup prevents the next import; already-authorized browser requests/caches cannot be undone.
      if (!isAllowed()) throw new Error('Live2D consent was withdrawn during startup.');
      return importRenderer();
    }).catch((error) => {
      // 不缓存失败，下一次用户返回画框时允许重新尝试同一批准的本地资源。
      // Do not cache a failure: a later portrait mount may retry the same approved local resource.
      startupPromise = null;
      throw error;
    });
    return startupPromise;
  };
}

export const loadLive2DRuntime = createRuntimeLoader();
