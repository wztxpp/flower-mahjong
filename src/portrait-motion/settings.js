// 普通本地显示设置，不代表法律同意，不读取/迁移旧 Live2D 许可记录。
// Ordinary local display preference, not legal assent; never read/migrate old Live2D license records.
// 默认静态，旧启用和旧拒绝均不自动改变；只有新的明确启用才能启动局部 Canvas2D 动画。
// Default static preserves either old choice; only a new explicit enable starts local Canvas2D motion.
import { computed, inject, onMounted, onUnmounted, readonly, ref } from 'vue';

export const PORTRAIT_MOTION_KEY = Symbol('portrait-motion');
export const PORTRAIT_MOTION_STORAGE_KEY = 'huajian-portrait-motion-v1';
export const PORTRAIT_MOTION_VERSION = 'canvas-roi-1';
// 缺失、旧版、未知版本、损坏 JSON 或字符串 "true" 均不代表启用；不迁移或猜测旧选择。
// Missing, stale, unknown, malformed or string-true records never mean enablement; do not migrate or infer earlier choices.
export function parsePortraitMotionSetting(value) {
  try {
    const record = JSON.parse(value);
    if (record?.version !== PORTRAIT_MOTION_VERSION || typeof record.enabled !== 'boolean') return 'unset';
    return record.enabled ? 'enabled' : 'static';
  } catch {
    return 'unset';
  }
}

// 可注入环境只供隔离测试；生产读取当前浏览器 localStorage，失败时先保持静态且不阻断游戏。
// Environment injection supports isolated tests; production reads browser storage and fails closed without blocking play.
export function createPortraitMotionSettings({ environment = globalThis } = {}) {
  const choice = ref('unset');
  const storageAvailable = ref(true);
  let initialized = false;
  let consumers = 0;
  let listeningWindow = null;

  function restore() {
    initialized = true;
    try {
      choice.value = parsePortraitMotionSetting(environment.localStorage.getItem(PORTRAIT_MOTION_STORAGE_KEY));
      storageAvailable.value = true;
    } catch {
      choice.value = 'unset';
      storageAvailable.value = false;
    }
  }

  // 玩家显式点击才写入；先改变页内选择以立即停用，即使隐私模式拒绝写入也可继续静态游戏。
  // Persist only an explicit click; update the page first so disabling works immediately even when storage rejects writes.
  function choose(enabled) {
    initialized = true;
    choice.value = enabled ? 'enabled' : 'static';
    try {
      environment.localStorage.setItem(PORTRAIT_MOTION_STORAGE_KEY, JSON.stringify({ version: PORTRAIT_MOTION_VERSION, enabled }));
      storageAvailable.value = true;
    } catch {
      storageAvailable.value = false;
      // 若旧的启用记录无法覆写，尽力移除；两者都失败时，界面明确提示只对本页生效。
      // If an earlier enablement cannot be overwritten, try removal; if both fail the UI states that the choice is page-only.
      if (!enabled) {
        try { environment.localStorage.removeItem(PORTRAIT_MOTION_STORAGE_KEY); } catch { /* 保持本页静态 / Keep this page static. */ }
      }
    }
  }

  // 同源副页撤销/清空记录同样停用；无关存储变化不能抹掉当前页内的选择。
  // Sibling-tab withdrawal or storage clearing also disables; unrelated storage changes must not reset page-local choices.
  function storageChanged(event) {
    if (event.key === PORTRAIT_MOTION_STORAGE_KEY || event.key === null) restore();
  }
  function retain() {
    if (consumers === 0) {
      listeningWindow = environment.window || null;
      listeningWindow?.addEventListener?.('storage', storageChanged);
    }
    consumers += 1;
  }
  function release() {
    consumers = Math.max(0, consumers - 1);
    if (consumers === 0) {
      listeningWindow?.removeEventListener?.('storage', storageChanged);
      listeningWindow = null;
    }
  }

  return {
    choice: readonly(choice),
    enabled: computed(() => choice.value === 'enabled'),
    storageAvailable: readonly(storageAvailable),
    initialize() { if (!initialized) restore(); },
    enable() { choose(true); },
    disable() { choose(false); },
    retain,
    release,
  };
}

let sharedSettings;

// 默认共享同一普通显示设置，不另读一个默认启用开关。
// Share one ordinary display setting instead of reading a second default-on switch.
export function getPortraitMotionSettings() {
  if (!sharedSettings) sharedSettings = createPortraitMotionSettings();
  sharedSettings.initialize();
  return sharedSettings;
}

// 注入仅用于隔离测试；普通 App 与独立 ChengduTable 自动共享同源页面实例，不能用 enabled prop 绕过。
// Injection is for isolated tests; normal App and standalone ChengduTable share page state, which an enabled prop cannot bypass.
export function usePortraitMotionSettings() {
  const injected = inject(PORTRAIT_MOTION_KEY, null);
  const settings = injected || getPortraitMotionSettings();
  settings.initialize();
  onMounted(settings.retain);
  onUnmounted(settings.release);
  return settings;
}
