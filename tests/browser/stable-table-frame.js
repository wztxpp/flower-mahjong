// 真正编译App.vue与原CSS，不复制牌桌DOM、不覆盖其布局规则。
// Compile the real App.vue and original CSS; no copied table DOM or overridden layout rules.
import { createApp } from 'vue';
import App from '/src/App.vue';
import '/src/style.css';
import '/src/tabletop.css';
import { stableTableSnapshot, STABLE_TABLE_CASES, STABLE_TABLE_STAGES } from '../helpers/stable-table-fixtures.js';
import { measureStableTable, auditStableTable, auditReachability, setRiverReviewPosition } from '../helpers/stable-table-browser-audit.js';

// 本地按钮是只读陈列，阻止生产动作、导航、剪贴板和设置事件；滚动/Tab/原生summary仍可用。
// Game buttons are read-only exhibits: block action/navigation/clipboard/settings events; scrolling, Tab, and native summaries remain usable.
document.addEventListener('click', (event) => {
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
createApp(App).mount('#app');
let currentCase = new URL(location.href).searchParams.get('case') || 'flower-3';
await window.__stableTableFixture.setSnapshot(stableTableSnapshot(currentCase, 'empty'));
window.stableTablePreview = Object.freeze({
  cases: STABLE_TABLE_CASES, stages: STABLE_TABLE_STAGES,
  async set(caseId, stageId) { currentCase = caseId; await window.__stableTableFixture.setSnapshot(stableTableSnapshot(caseId, stageId)); },
  measure: () => measureStableTable(window),
  audit: () => auditStableTable(window, currentCase, window.__stableTableFixture.setSnapshot),
  reachability: () => auditReachability(window),
  riverPosition: (position) => setRiverReviewPosition(window, position),
});
window.dispatchEvent(new Event('stable-table-ready'));
