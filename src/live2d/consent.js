// Live2D 的本地显示选择：只保存官方许可引用版本和开关，不采集身份、不访问服务器。
// Local Live2D presentation choice: store only the official-license reference version and switch, with no identity or server access.
// 所有画框（含独立挂载）共享同一选择；只有当前版本的明确 true 可以自动恢复动态。
// Every frame, including standalone mounts, shares the choice; only an explicit true for this exact version restores animation.
import { computed, inject, onMounted, onUnmounted, readonly, ref } from 'vue';

export const LIVE2D_CONSENT_KEY = Symbol('live2d-consent');
export const LIVE2D_CONSENT_STORAGE_KEY = 'huajian-live2d-consent-v1';
export const LIVE2D_CONSENT_VERSION = 'core-2.1_framework-1.4_2025-02-03_notice-1';
export const LIVE2D_LICENSE_URLS = Object.freeze({
  coreChinese: 'https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_cn.html',
  coreJapanese: 'https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_jp.html',
  frameworkChinese: 'https://www.live2d.com/eula/live2d-open-software-license-agreement_cn.html',
  frameworkJapanese: 'https://www.live2d.com/eula/live2d-open-software-license-agreement_jp.html',
});

// 缺失、旧版、未知版本、损坏 JSON 或字符串 "true" 均不代表同意；不迁移或猜测旧选择。
// Missing, stale, unknown, malformed or string-true records never mean assent; do not migrate or infer earlier choices.
export function parseLive2DConsent(value) {
  try {
    const record = JSON.parse(value);
    if (record?.version !== LIVE2D_CONSENT_VERSION || typeof record.enabled !== 'boolean') return 'unset';
    return record.enabled ? 'enabled' : 'static';
  } catch {
    return 'unset';
  }
}

// 可注入环境只供隔离测试；生产读取当前浏览器 localStorage，失败时先保持静态且不阻断游戏。
// Environment injection supports isolated tests; production reads browser storage and fails closed without blocking play.
export function createLive2DConsent({ environment = globalThis } = {}) {
  const choice = ref('unset');
  const storageAvailable = ref(true);
  let initialized = false;
  let consumers = 0;
  let listeningWindow = null;

  function restore() {
    initialized = true;
    try {
      choice.value = parseLive2DConsent(environment.localStorage.getItem(LIVE2D_CONSENT_STORAGE_KEY));
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
      environment.localStorage.setItem(LIVE2D_CONSENT_STORAGE_KEY, JSON.stringify({ version: LIVE2D_CONSENT_VERSION, enabled }));
      storageAvailable.value = true;
    } catch {
      storageAvailable.value = false;
      // 若旧的同意记录无法覆写，尽力移除；两者都失败时，界面明确提示只对本页生效。
      // If an earlier assent cannot be overwritten, try removal; if both fail the UI states that the choice is page-only.
      if (!enabled) {
        try { environment.localStorage.removeItem(LIVE2D_CONSENT_STORAGE_KEY); } catch { /* 保持本页静态 / Keep this page static. */ }
      }
    }
  }

  // 同源副页撤销/清空记录同样停用；无关存储变化不能抹掉当前页内的选择。
  // Sibling-tab withdrawal or storage clearing also disables; unrelated storage changes must not reset page-local choices.
  function storageChanged(event) {
    if (event.key === LIVE2D_CONSENT_STORAGE_KEY || event.key === null) restore();
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
    accept() { choose(true); },
    decline() { choose(false); },
    retain,
    release,
  };
}

let sharedConsent;

// 组件之外的 SDK 入口使用同一门禁，不另读一个默认同意开关。
// The non-component SDK entry shares this gate rather than reading a separate default-on switch.
export function getLive2DConsent() {
  if (!sharedConsent) sharedConsent = createLive2DConsent();
  sharedConsent.initialize();
  return sharedConsent;
}

// 注入仅用于隔离测试；普通 App 与独立 ChengduTable 自动共享同源页面实例，不能用 enabled prop 绕过。
// Injection is for isolated tests; normal App and standalone ChengduTable share page state, which an enabled prop cannot bypass.
export function useLive2DConsent() {
  const injected = inject(LIVE2D_CONSENT_KEY, null);
  const consent = injected || getLive2DConsent();
  consent.initialize();
  onMounted(consent.retain);
  onUnmounted(consent.release);
  return consent;
}
