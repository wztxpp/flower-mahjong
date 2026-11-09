// 本机弹层只允许两个既有DOM目标，兼容缺少原生API的浏览器，并能完整关闭清理。
// Local popovers allow only the two existing DOM targets, support missing native APIs and cleanly dismiss.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openRealisticPopover, closeRealisticPopover, closeRealisticPopovers, dismissRealisticPopoverFallback } from '../src/realistic-popover.js';
function fixture(native) {
  const attributes = new Map();
  let open = false;
  const element = {
    setAttribute(key, value) { attributes.set(key, value); },
    removeAttribute(key) { attributes.delete(key); },
    hasAttribute(key) { return attributes.has(key); },
    contains(target) { return target === element; },
    matches(selector) { return selector === ':popover-open' && open; },
    ...(native ? { showPopover() { open = true; }, hidePopover() { open = false; } } : {}),
  };
  return { element, attributes, isOpen: () => open, document: { getElementById: (id) => id === 'realistic-hand-feedback' ? element : null } };
}
test('native open/close uses existing element and rejects unrelated targets', () => {
  const view = fixture(true);
  assert.equal(openRealisticPopover('other', view.document), false);
  assert.equal(openRealisticPopover('realistic-start-options', view.document), false);
  assert.equal(openRealisticPopover('realistic-hand-feedback', view.document), true);
  assert.equal(view.isOpen(), true);
  closeRealisticPopover('realistic-hand-feedback', view.document);
  closeRealisticPopovers(view.document);
  assert.equal(view.isOpen(), false);
});
test('fallback keeps inside clicks and dismisses Escape/outside interactions', () => {
  const view = fixture(false);
  openRealisticPopover('realistic-hand-feedback', view.document);
  assert.equal(view.attributes.get('data-realistic-popover-open'), 'true');
  dismissRealisticPopoverFallback({ type: 'pointerdown', target: view.element }, view.document);
  assert.equal(view.attributes.size, 1);
  dismissRealisticPopoverFallback({ type: 'keydown', key: 'ArrowRight' }, view.document);
  assert.equal(view.attributes.size, 1);
  dismissRealisticPopoverFallback({ type: 'keydown', key: 'Escape' }, view.document);
  assert.equal(view.attributes.size, 0);
  openRealisticPopover('realistic-hand-feedback', view.document);
  dismissRealisticPopoverFallback({ type: 'pointerdown', target: {} }, view.document);
  assert.equal(view.attributes.size, 0);
});
