// 真正编译App.vue与原CSS，不复制牌桌DOM、不覆盖其布局规则。
// Compile the real App.vue and original CSS; no copied table DOM or overridden layout rules.
import { createApp } from 'vue';
import App from '/src/App.vue';
import '/src/style.css';
import '/src/tabletop.css';
import '/src/realistic-table.css';
import { terminalSummaryFixture } from '../helpers/round-summary-fixtures.js';
import { stableTableSnapshot, STABLE_TABLE_CASES, STABLE_TABLE_STAGES } from '../helpers/stable-table-fixtures.js';
import { measureStableTable, auditStableTable, auditReachability, setRiverReviewPosition, compareStableTable, settleStableTable } from '../helpers/stable-table-browser-audit.js';

// 本地按钮是只读陈列，阻止生产动作、导航、剪贴板和设置事件；滚动/Tab/原生summary仍可用。
// Game buttons are read-only exhibits: block action/navigation/clipboard/settings events; scrolling, Tab, and native summaries remain usable.
document.addEventListener('click', (event) => {
  // 写实邀请入口复用真实剪贴板逻辑，隔离验收只检查可见性，不让fixture改系统剪贴板。
  // The invite control uses real clipboard code; the isolated fixture checks visibility without writing the system clipboard.
  if (event.target.closest('#app [data-realistic-invite]')) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  if (event.target.closest('#app [popovertargetaction="hide"]')) return;
  // 仅放行本地选牌与原下一局入口/关闭；选牌不提交，出牌/准备确认/开局/离桌继续阻断。
  // Allow only local tile selection and existing modal controls; selection never submits, while discard/preparation/start/departure remain blocked.
  // 仅放行写实桌本地显示工具；不放行任何出牌、回应或开局按钮。
  // Allow realistic local display tools only, never discard, claim or start controls.
  if (event.target.closest('#app .table-presentation-switch button, #app .realistic-view-tools button, #app .realistic-view-tools input, #app .realistic-view-tools select, #app .realistic-details button')) return;
  if (event.target.closest('#app .character-hand-table button.tile-interactive:not(:disabled)')) return;
  if (event.target.closest('#app [data-next-round-trigger], #app .next-round-dialog .modal-close, #app .next-round-dialog [data-next-round-return]')) return;
  if (event.target.closest('#app button, #app a, #app input, #app select')) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);
document.addEventListener('submit', (event) => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
// 双保险：客户端不允许API调用；静态图片/模块仍正常加载，服务端另有全方法403。
// Defense in depth: deny client API calls while static assets/modules load normally; the server separately returns 403 for all methods.
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (url.origin !== location.origin || /^\/api(?:\/|$)/i.test(url.pathname)) throw new Error('View-only fixture network boundary');
  return nativeFetch(input, options);
};
let app = createApp(App);
app.mount('#app');
let currentCase = new URL(location.href).searchParams.get('case') || 'flower-3';
let currentCharacter = 'sweet';
let summaryGameNumber = 0;
await window.__stableTableFixture.setSnapshot(stableTableSnapshot(currentCase, 'empty'));
window.stableTablePreview = Object.freeze({
  cases: STABLE_TABLE_CASES, stages: STABLE_TABLE_STAGES,
  async set(caseId, stageId, characterId) {
    const snapshot = stableTableSnapshot(caseId, stageId, characterId);
    // 切玩法是新验收页，不是被测局内变化；显式卸载避免跨模板v-memo缓存混用。
    // A case switch starts a fresh acceptance page, not an in-game transition; unmount to avoid cross-template v-memo reuse.
    if (caseId !== currentCase) { app.unmount(); app = createApp(App); app.mount('#app'); }
    currentCase = caseId;
    currentCharacter = characterId || 'sweet';
    await window.__stableTableFixture.setSnapshot(snapshot);
  },
  // 可见诊断只更换独立合成快照并调用原本地弹层函数，绝不调用mutate或任何API。
  // Visible diagnostics replace isolated synthetic views and call original local modal helpers, never mutate or an API.
  async summary(action, variant = 'normal') {
    const api = window.__stableTableFixture;
    if (action === 'open') await api.openSummary();
    else if (action === 'close') await api.closeSummary();
    else if (action === 'poll') await api.pollSummary();
    else if (action === 'new-game' || action === 'finish' || action === 'load') {
      const snapshot = stableTableSnapshot(currentCase, action === 'new-game' ? 'empty' : 'finished', currentCharacter);
      if (action !== 'load') summaryGameNumber += 1;
      snapshot.state.game.id += `-summary-${summaryGameNumber}`;
      if (action !== 'new-game') {
        const summary = terminalSummaryFixture(snapshot.state, variant);
        if (summary) snapshot.state.game.roundSummary = summary;
        else delete snapshot.state.game.roundSummary;
      }
      if (action === 'finish') {
        const playing = structuredClone(snapshot);
        playing.state.phase = 'playing'; playing.state.game.phase = 'turn';
        delete playing.state.game.roundSummary;
        await api.setSnapshot(playing);
      }
      await api.setSnapshot(snapshot);
      if (action === 'load') await api.openSummary();
    } else throw new Error('Unknown summary fixture action');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return measureRoundSummary();
  },
  // 由外层可见按钮发起，帧内再把焦点放到真正动作节点，避免外层点击先抢焦点导致假通过。
  // A visible outer control starts the test; the frame then focuses actual action nodes, avoiding a false pass after an outer click stole focus.
  actionFocus: () => auditActionFocus(),
  selectHand: () => selectHandPreview(),
  summaryMeasure: () => measureRoundSummary(),
  measure: () => measureStableTable(window),
  audit: () => auditStableTable(window, currentCase, window.__stableTableFixture.setSnapshot),
  reachability: () => auditReachability(window),
  riverPosition: (position) => setRiverReviewPosition(window, position),
});
window.dispatchEvent(new Event('stable-table-ready'));

// 量测实际DOM，不改滚动/焦点；完整记录留在外层诊断JSON，不能将数值检查冒充人工键盘测试。
// Measure actual DOM without changing scroll/focus; results are diagnostics, never a substitute for manual key checks.
function measureRoundSummary() {
  const dialog = document.querySelector('.next-round-dialog');
  const body = dialog?.querySelector('[data-round-summary-scroll]');
  const bounds = (node) => {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom, right: rect.right };
  };
  return {
    ...window.__stableTableFixture.getSummaryState(),
    viewport: { width: innerWidth, height: innerHeight },
    dialog: bounds(dialog), body: bounds(body), footer: bounds(dialog?.querySelector('.next-round-footer')),
    overflow: body ? { clientHeight: body.clientHeight, scrollHeight: body.scrollHeight, clientWidth: body.clientWidth, scrollWidth: body.scrollWidth } : null,
    horizontalOverflow: dialog ? [...dialog.querySelectorAll('*')].filter((node) => node.scrollWidth > node.clientWidth + 1 && node.clientWidth > 0).map((node) => ({ tag: node.tagName, class: node.className, client: node.clientWidth, scroll: node.scrollWidth })).slice(0, 30) : [],
    players: dialog ? [...dialog.querySelectorAll('[data-round-summary-seat]')].map((node) => ({ seat: node.dataset.roundSummarySeat, text: node.innerText, bounds: bounds(node) })) : [],
    focus: { tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.trim().slice(0, 100), insideDialog: Boolean(dialog?.contains(document.activeElement)) },
    details: dialog ? [...dialog.querySelectorAll('details')].map((node) => ({ open: node.open, label: node.querySelector('summary')?.textContent })) : [],
  };
}

// 所有变化只替换合成快照，既不点动作按钮也不调用提交入口；测量保留真实组件watcher和DOM。
// Every transition replaces a synthetic view, never clicks an action or invokes submission; real component watchers and DOM stay intact.
async function auditActionFocus() {
  if (currentCase.endsWith('spectator')) return { passed: true, applicable: false, reason: '观战无操作层' };
  const api = window.__stableTableFixture;
  const results = [];
  const scenarios = [
    ['region', 'empty'], ['button', 'empty'], ['region', 'answered'], ['button', 'answered'],
    ['button', 'replacement'], ['button', 'busy-then-remove'], ['button', 'other-focus'], ['button', 'summary'], ['button', 'new-game'],
  ];
  for (const [targetKind, transition] of scenarios) {
    await api.closeSummary();
    const original = stableTableSnapshot(currentCase, 'claim', currentCharacter);
    await api.setSnapshot(original);
    await settleStableTable(window);
    const run = document.querySelector('.action-row, .chengdu-action-bar');
    const target = targetKind === 'region' ? run : run?.querySelector('button:not(:disabled)');
    if (!target) throw new Error('合成回应缺少可聚焦动作');
    target.focus({ preventScroll: true });
    if (document.activeElement !== target) throw new Error('真实动作节点无法取得焦点');
    const before = measureStableTable(window);
    let focusAfterDisable = null;
    if (transition === 'busy-then-remove') {
      const busySnapshot = structuredClone(original);
      busySnapshot.ui.busy = true;
      await api.setSnapshot(busySnapshot);
      await settleStableTable(window);
      focusAfterDisable = { disabled: target.disabled, target: document.activeElement === target, body: document.activeElement === document.body, hand: document.activeElement === document.querySelector('.hand-scroll, .chengdu-hand') };
    }
    let next = structuredClone(original);
    if (transition === 'summary') next = stableTableSnapshot(currentCase, 'finished', currentCharacter);
    else if (transition === 'replacement') next.state.game.legalActions = [{ type: 'pass' }];
    else {
      next.state.game.legalActions = [];
      if (transition === 'answered') {
        next.state.game.claim.respondedSeats = [0];
        next.state.game.claim.hasResponded = true;
      } else { next.state.game.phase = 'turn'; next.state.game.claim = null; next.state.game.currentSeat = 1; }
      if (transition === 'new-game') next.state.game.id += '-focus-next-game';
    }
    const pending = api.setSnapshot(next);
    let other;
    if (transition === 'other-focus') {
      other = document.querySelector('.header-actions button');
      if (!other) throw new Error('缺少独立桌面工具焦点');
      other.focus({ preventScroll: true });
    }
    if (transition === 'summary') await api.openSummary();
    await pending;
    await settleStableTable(window);
    const after = measureStableTable(window);
    const hand = document.querySelector('.hand-scroll, .chengdu-hand');
    const dialog = document.querySelector('.next-round-dialog');
    const active = document.activeElement;
    const recoveryExpected = ['empty', 'answered', 'replacement', 'busy-then-remove'].includes(transition);
    const correctFocus = recoveryExpected ? active === hand : transition === 'summary'
      ? Boolean(dialog?.contains(active)) : transition === 'other-focus' ? active === other : active !== hand;
    const geometry = compareStableTable(before, after);
    const geometryExpected = transition !== 'summary';
    results.push({ targetKind, transition, passed: !target.isConnected && correctFocus && (!geometryExpected || geometry.passed),
      removedTarget: !target.isConnected, correctFocus, focusAfterDisable, geometry, before, after,
      focus: { tag: active?.tagName, class: active?.className, connected: active?.isConnected, hand: active === hand, dialog: Boolean(dialog?.contains(active)) } });
  }
  await api.closeSummary();
  return { passed: results.every((result) => result.passed), scope: '纯视图同实例实际DOM撤层焦点；无服务器动作', results };
}

// 只触发已放行的私有牌选择处理器，保留真实选中样式与同一实例；不点击任何确认动作。
// Invoke only the allowlisted private tile-selection handler, retaining actual selected styles/the same instance without any confirmation action.
async function selectHandPreview() {
  if (currentCase.endsWith('spectator')) throw new Error('观战没有可选私有手牌');
  let tile = document.querySelector('.character-hand-table button.tile-interactive:not(:disabled)');
  if (!tile) {
    await window.__stableTableFixture.setSnapshot(stableTableSnapshot(currentCase, 'discard', currentCharacter));
    tile = document.querySelector('.character-hand-table button.tile-interactive:not(:disabled)');
  }
  if (!tile) throw new Error('当前纯视图缺少可选手牌');
  tile.focus({ preventScroll: true });
  if (tile.getAttribute('aria-pressed') !== 'true') tile.click();
  await settleStableTable(window);
  const dock = document.querySelector('.hand-action-dock');
  const tileBounds = tile.getBoundingClientRect();
  const dockBounds = dock?.getBoundingClientRect();
  return { passed: tile.getAttribute('aria-pressed') === 'true' && (!dockBounds || tileBounds.top >= dockBounds.bottom),
    selected: tile.getAttribute('aria-pressed'), tile: { top: tileBounds.top, bottom: tileBounds.bottom, width: tileBounds.width, height: tileBounds.height },
    dock: dockBounds ? { top: dockBounds.top, bottom: dockBounds.bottom, height: dockBounds.height } : null,
    selection: { transform: getComputedStyle(tile).transform, outline: getComputedStyle(tile).outline, offset: getComputedStyle(tile).outlineOffset },
    measurement: measureStableTable(window) };
}
