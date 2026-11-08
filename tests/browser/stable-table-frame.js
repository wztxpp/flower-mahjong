// 真正编译App.vue与原CSS，不复制牌桌DOM、不覆盖其布局规则。
// Compile the real App.vue and original CSS; no copied table DOM or overridden layout rules.
import { createApp } from 'vue';
import App from '/src/App.vue';
import '/src/style.css';
import '/src/tabletop.css';
import { terminalSummaryFixture } from '../helpers/round-summary-fixtures.js';
import { stableTableSnapshot, STABLE_TABLE_CASES, STABLE_TABLE_STAGES } from '../helpers/stable-table-fixtures.js';
import { measureStableTable, auditStableTable, auditReachability, setRiverReviewPosition } from '../helpers/stable-table-browser-audit.js';

// 本地按钮是只读陈列，阻止生产动作、导航、剪贴板和设置事件；滚动/Tab/原生summary仍可用。
// Game buttons are read-only exhibits: block action/navigation/clipboard/settings events; scrolling, Tab, and native summaries remain usable.
document.addEventListener('click', (event) => {
  // 仅放行原下一局入口和关闭按钮；开局/离桌/其他生产按钮继续被阻断。
  // Allow only the existing local choice trigger and close control; starts/departures and other production buttons stay blocked.
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
