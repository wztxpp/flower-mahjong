// 明确选择、版本和存储故障的纯回归；不访问浏览器网络，也不把门禁测试当 GPU 验收。
// Pure preference/version/storage-failure regressions, without browser networking or claims of GPU enablement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortraitMotionSettings, parsePortraitMotionSetting, PORTRAIT_MOTION_STORAGE_KEY, PORTRAIT_MOTION_VERSION } from '../src/portrait-motion/settings.js';

// 模拟单一同源存储和 storage 事件，不创建帐号、时间戳或服务端启用记录。
// Model one same-origin store and storage events without accounts, timestamps or server-side settings records.
function storageFixture(value = null) {
  const items = new Map(value === null ? [] : [[PORTRAIT_MOTION_STORAGE_KEY, value]]);
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
  const settings = createPortraitMotionSettings({ environment });
  settings.initialize();
  return { items, listeners, environment, settings };
}

// 默认拒绝宽松值和未知版本，只有完全相符的记录才恢复。
// Reject loose values and unknown versions; only an exact matching record restores animation.
test('settings rejects missing, malformed, stale, future and non-boolean stored choices', () => {
  for (const value of [null, 'true', 'null', '{broken', '{}', JSON.stringify({ enabled: true }),
    JSON.stringify({ version: 'old', enabled: true }), JSON.stringify({ version: 'future', enabled: true }),
    JSON.stringify({ version: PORTRAIT_MOTION_VERSION, enabled: 'true' })]) {
    assert.equal(parsePortraitMotionSetting(value), 'unset');
    const { settings } = storageFixture(value);
    assert.equal(settings.enabled.value, false);
  }
});

test('explicit enablement and decline persist only version and switch across a fresh page', () => {
  const { settings, items, environment } = storageFixture();
  assert.equal(settings.enabled.value, false);
  assert.equal(items.size, 0);
  settings.enable();
  assert.equal(settings.enabled.value, true);
  assert.deepEqual(JSON.parse(items.get(PORTRAIT_MOTION_STORAGE_KEY)), { version: PORTRAIT_MOTION_VERSION, enabled: true });
  const restored = createPortraitMotionSettings({ environment });
  restored.initialize();
  assert.equal(restored.enabled.value, true);
  restored.disable();
  const declined = createPortraitMotionSettings({ environment });
  declined.initialize();
  assert.equal(declined.enabled.value, false);
  assert.equal(declined.choice.value, 'static');
});

test('blocked storage defaults static and explicit page-local choices remain usable', () => {
  const environment = { get localStorage() { throw new Error('Storage disabled'); } };
  const settings = createPortraitMotionSettings({ environment });
  assert.doesNotThrow(() => settings.initialize());
  assert.equal(settings.enabled.value, false);
  assert.equal(settings.storageAvailable.value, false);
  settings.enable();
  assert.equal(settings.enabled.value, true);
  settings.disable();
  assert.equal(settings.enabled.value, false);
  const next = createPortraitMotionSettings({ environment });
  next.initialize();
  assert.equal(next.enabled.value, false);
});

test('failed withdrawal persistence attempts removal without undoing page-local disabling', () => {
  const { settings, environment, items } = storageFixture();
  settings.enable();
  environment.localStorage.setItem = () => { throw new Error('Quota'); };
  settings.disable();
  assert.equal(settings.enabled.value, false);
  assert.equal(settings.storageAvailable.value, false);
  assert.equal(items.size, 0);
});

test('sibling storage withdrawal is shared and listeners release after the final frame', () => {
  const { settings, items, listeners } = storageFixture();
  settings.retain(); settings.retain();
  assert.equal(listeners.size, 1);
  settings.enable();
  items.clear();
  for (const listener of listeners) listener({ key: 'unrelated' });
  assert.equal(settings.enabled.value, true);
  for (const listener of listeners) listener({ key: null });
  assert.equal(settings.enabled.value, false);
  settings.release();
  assert.equal(listeners.size, 1);
  settings.release();
  assert.equal(listeners.size, 0);
});

// 旧许可记录无论接受/拒绝都不能授权新的普通显示开关；新记录独立，避免误迁移法律同意。
// Neither old enablement nor refusal authorizes the new display switch; new records are independent from legal preference.
test('old Live2D choices never enable the new Canvas2D setting', () => {
  for (const enabled of [true, false]) {
    const environment = { localStorage: { getItem: (key) => key === 'huajian-live2d-consent-v1' ? JSON.stringify({ version: 'core-2.1_framework-1.4_2025-02-03_notice-1', enabled }) : null } };
    const settings = createPortraitMotionSettings({ environment });
    settings.initialize();
    assert.equal(settings.enabled.value, false);
  }
});
