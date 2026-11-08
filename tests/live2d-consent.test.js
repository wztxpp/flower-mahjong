// 明确选择、版本和存储故障的纯回归；不访问浏览器网络，也不把门禁测试当 GPU 验收。
// Pure assent/version/storage-failure regressions, without browser networking or claims of GPU acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLive2DConsent, parseLive2DConsent, LIVE2D_CONSENT_STORAGE_KEY, LIVE2D_CONSENT_VERSION } from '../src/live2d/consent.js';
import { createRuntimeLoader } from '../src/live2d/loader.js';

// 模拟单一同源存储和 storage 事件，不创建帐号、时间戳或服务端同意记录。
// Model one same-origin store and storage events without accounts, timestamps or server-side consent records.
function storageFixture(value = null) {
  const items = new Map(value === null ? [] : [[LIVE2D_CONSENT_STORAGE_KEY, value]]);
  const listeners = new Set();
  const environment = {
    localStorage: {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => items.set(key, value),
      removeItem: (key) => items.delete(key),
    },
    window: {
      addEventListener: (type, listener) => { if (type === 'storage') listeners.add(listener); },
      removeEventListener: (type, listener) => { if (type === 'storage') listeners.delete(listener); },
    },
  };
  const consent = createLive2DConsent({ environment });
  consent.initialize();
  return { items, listeners, environment, consent };
}

// 默认拒绝宽松值和未知版本，只有完全相符的记录才恢复。
// Reject loose values and unknown versions; only an exact matching record restores animation.
test('consent rejects missing, malformed, stale, future and non-boolean stored choices', () => {
  for (const value of [null, 'true', 'null', '{broken', '{}', JSON.stringify({ enabled: true }),
    JSON.stringify({ version: 'old', enabled: true }), JSON.stringify({ version: 'future', enabled: true }),
    JSON.stringify({ version: LIVE2D_CONSENT_VERSION, enabled: 'true' })]) {
    assert.equal(parseLive2DConsent(value), 'unset');
    const { consent } = storageFixture(value);
    assert.equal(consent.enabled.value, false);
  }
});

test('explicit acceptance and decline persist only version and switch across a fresh page', () => {
  const { consent, items, environment } = storageFixture();
  assert.equal(consent.enabled.value, false);
  assert.equal(items.size, 0);
  consent.accept();
  assert.equal(consent.enabled.value, true);
  assert.deepEqual(JSON.parse(items.get(LIVE2D_CONSENT_STORAGE_KEY)), { version: LIVE2D_CONSENT_VERSION, enabled: true });
  const restored = createLive2DConsent({ environment });
  restored.initialize();
  assert.equal(restored.enabled.value, true);
  restored.decline();
  const declined = createLive2DConsent({ environment });
  declined.initialize();
  assert.equal(declined.enabled.value, false);
  assert.equal(declined.choice.value, 'static');
});

test('blocked storage defaults static and explicit page-local choices remain usable', () => {
  const environment = { get localStorage() { throw new Error('Storage disabled'); } };
  const consent = createLive2DConsent({ environment });
  assert.doesNotThrow(() => consent.initialize());
  assert.equal(consent.enabled.value, false);
  assert.equal(consent.storageAvailable.value, false);
  consent.accept();
  assert.equal(consent.enabled.value, true);
  consent.decline();
  assert.equal(consent.enabled.value, false);
  const next = createLive2DConsent({ environment });
  next.initialize();
  assert.equal(next.enabled.value, false);
});

test('failed withdrawal persistence attempts removal without undoing page-local disabling', () => {
  const { consent, environment, items } = storageFixture();
  consent.accept();
  environment.localStorage.setItem = () => { throw new Error('Quota'); };
  consent.decline();
  assert.equal(consent.enabled.value, false);
  assert.equal(consent.storageAvailable.value, false);
  assert.equal(items.size, 0);
});

test('sibling storage withdrawal is shared and listeners release after the final frame', () => {
  const { consent, items, listeners } = storageFixture();
  consent.retain(); consent.retain();
  assert.equal(listeners.size, 1);
  consent.accept();
  items.clear();
  for (const listener of listeners) listener({ key: 'unrelated' });
  assert.equal(consent.enabled.value, true);
  for (const listener of listeners) listener({ key: null });
  assert.equal(consent.enabled.value, false);
  consent.release();
  assert.equal(listeners.size, 1);
  consent.release();
  assert.equal(listeners.size, 0);
});

// 直接调用加载器也必须通过门禁；已同意后开始的 Core 等待不能在撤销后继续导入 Framework。
// Direct loader calls also require assent; Core startup begun with assent cannot import Framework after withdrawal.
test('runtime entry never touches DOM or imports modules before acceptance or after decline', async () => {
  const { consent } = storageFixture();
  let touches = 0;
  const load = createRuntimeLoader({
    isAllowed: () => consent.enabled.value,
    environment: { get document() { touches += 1; throw new Error('Must not touch DOM'); } },
    importRenderer: () => { touches += 1; },
  });
  await assert.rejects(load(), /consent/);
  consent.decline();
  await assert.rejects(load(), /consent/);
  assert.equal(touches, 0);
});

test('withdrawal during Core startup prevents Framework import and a later explicit choice can retry', async () => {
  const { consent } = storageFixture();
  let ready = false;
  let imports = 0;
  let scripts = 0;
  const timers = new Map();
  let sequence = 0;
  const load = createRuntimeLoader({
    isAllowed: () => consent.enabled.value,
    importRenderer: async () => { imports += 1; return {}; },
    environment: {
      location: { href: 'https://example.test/' },
      Live2DCubismCore: { Version: { csmGetVersion() { return ready ? 1 : 0; } } },
      setTimeout: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
      clearTimeout: (id) => timers.delete(id),
      document: {
        querySelector: () => null,
        createElement: () => ({ dataset: {}, addEventListener() {}, removeEventListener() {}, remove() {} }),
        head: { appendChild() { scripts += 1; } },
      },
    },
  });
  consent.accept();
  const pending = load();
  assert.equal(scripts, 1);
  consent.decline();
  ready = true;
  [...timers.values()].find((timer) => timer.delay === 25).callback();
  await assert.rejects(pending, /withdrawn/);
  assert.equal(imports, 0);
  assert.equal(timers.size, 0);
  await assert.rejects(load(), /consent/);
  consent.accept();
  await load();
  assert.equal(imports, 1);
});
