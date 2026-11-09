// 真实桌复用原私有诊断/旧局配置DOM；只开关本页弹层，不提交动作或复制数据。
// Realistic mode reuses existing private diagnostics/legacy configuration DOM; only toggle local UI, never actions or data copies.
const IDS = ['realistic-hand-feedback', 'realistic-start-options'];

// 显式调用浏览器原生popover，避免声明式按钮在嵌套预览宿主中不触发默认行为。
// Explicitly invoke native popovers rather than relying on declarative default activation in nested preview hosts.
// 旧浏览器无该API时保留可关闭的固定面板；输入/选择仍是原组件已有状态。
// Older browsers retain a dismissible fixed-panel fallback with the original component state/inputs.
export function openRealisticPopover(id, pageDocument = globalThis.document) {
  if (!IDS.includes(id)) return false;
  const element = pageDocument?.getElementById?.(id);
  if (!element) return false;
  if (typeof element.showPopover === 'function') {
    element.showPopover();
  } else {
    element.setAttribute('data-realistic-popover-open', 'true');
  }
  return true;
}

// 切显示/卸载也可重复调用；原生层已关闭时不再调用hide，回退标记始终移除。
// Repeat-safe on mode changes/unmount: hide only an open native layer and always remove fallback state.
export function closeRealisticPopover(id, pageDocument = globalThis.document) {
  if (!IDS.includes(id)) return;
  const element = pageDocument?.getElementById?.(id);
  if (!element) return;
  if (typeof element.hidePopover === 'function' && element.matches?.(':popover-open')) element.hidePopover();
  element.removeAttribute('data-realistic-popover-open');
}

// 只有非原生回退需要手动处理Esc/外部点击；原生层的焦点及light-dismiss继续由浏览器负责。
// Only fallback panels need manual Escape/outside dismissal; native focus/light-dismiss remain browser-owned.
export function dismissRealisticPopoverFallback(event, pageDocument = globalThis.document) {
  if (event.type === 'keydown' && event.key !== 'Escape') return;
  for (const id of IDS) {
    const element = pageDocument?.getElementById?.(id);
    if (!element?.hasAttribute('data-realistic-popover-open')) continue;
    if (event.type === 'keydown' || (!element.contains(event.target) && event.target?.getAttribute?.('popovertarget') !== id)) {
      closeRealisticPopover(id, pageDocument);
    }
  }
}

export function closeRealisticPopovers(pageDocument = globalThis.document) {
  IDS.forEach((id) => closeRealisticPopover(id, pageDocument));
}
