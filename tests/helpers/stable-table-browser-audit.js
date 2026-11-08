// 仅在真实浏览器按钮触发后量测；不能用它证明规则、联网、游戏外场景或未测设备。
// Measure only after a visible browser button; this proves neither rules/networking nor out-of-game/untested-device behavior.
import { stableTableSnapshot, STABLE_TABLE_STAGES } from './stable-table-fixtures.js';
export const STABLE_TABLE_SELECTORS = {
  hand: '.hand-scroll, .chengdu-hand', handPanel: '.hand-panel, .chengdu-hand-panel',
  table: '.table-surface, .chengdu-board', action: '.action-row, .chengdu-action-bar',
  claim: '.claim-slot, .chengdu-claim-slot',
};
export const STABLE_SCROLL_SELECTORS = [
  '.discard-tiles', '.meld-tiles', '.opponent-public-cards', '.shared-radish-pool', '.own-public-cards',
  '.hand-scroll', '.hand-info-row', '.waits-info', '.action-row', '.hand-feedback', '.history-list', '.table-ledger',
  '.chengdu-river', '.chengdu-hand', '.chengdu-public-cards', '.chengdu-action-bar', '.chengdu-history', '.chengdu-ledger',
];
const RIVER_SELECTOR = '.discard-tiles, .chengdu-river';
const TOLERANCE = 1;
const round = (number) => Math.round(number * 100) / 100;

// 等待实际图片/字体和两帧，不写scrollTo或覆盖CSS；超时必须显示在结果中。
// Await actual images/fonts and two frames, without scrollTo or CSS overrides; report timeouts explicitly.
export async function settleStableTable(view) {
  const resources = [...view.document.images].map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => {
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', resolve, { once: true });
  }));
  resources.push(view.document.fonts?.ready || Promise.resolve());
  let timer;
  const timeout = new Promise((resolve) => { timer = view.setTimeout(() => resolve(false), 5000); });
  const ready = await Promise.race([Promise.all(resources).then(() => true), timeout]);
  view.clearTimeout(timer);
  await new Promise((resolve) => view.requestAnimationFrame(() => view.requestAnimationFrame(resolve)));
  return ready;
}
function bounds(element, view) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return { top: round(rect.top), bottom: round(rect.bottom), left: round(rect.left), right: round(rect.right),
    width: round(rect.width), height: round(rect.height), documentTop: round(rect.top + view.scrollY) };
}
function scrollRegions(view, selectors = STABLE_SCROLL_SELECTORS) {
  return selectors.flatMap((selector) => [...view.document.querySelectorAll(selector)].map((element, index) => ({
    key: `${selector}:${index}`, element,
  })));
}

// 所有字段来自DOM实测，手牌documentTop与viewportTop分别保留，防止scroll anchoring掩盖重排。
// All fields are measured: retain both hand document/viewport top so scroll anchoring cannot hide reflow.
export function measureStableTable(view) {
  const document = view.document;
  return {
    viewerRole: document.querySelector('.is-spectator') ? 'spectator' : 'player',
    viewport: { width: view.innerWidth, height: view.innerHeight }, scrollY: round(view.scrollY), scrollX: round(view.scrollX),
    documentHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    regions: Object.fromEntries(Object.entries(STABLE_TABLE_SELECTORS).map(([name, selector]) => [name, bounds(document.querySelector(selector), view)])),
    scrolling: scrollRegions(view).map(({ key, element }) => ({ key, scrollTop: round(element.scrollTop), scrollLeft: round(element.scrollLeft),
      clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
      tabIndex: element.tabIndex, label: element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') || null })),
  };
}

// 数值纯比较函数供Node回归覆盖；缺失手牌必须失败，不能把未量到当稳定。
// Pure comparison is Node-tested; missing hands fail rather than counting as stable.
export function compareStableTable(before, after) {
  const differences = {};
  for (const key of ['scrollY', 'scrollX', 'documentHeight', 'documentWidth']) differences[key] = round(after[key] - before[key]);
  const measuredRegions = before.viewerRole === 'spectator' ? ['table'] : ['hand', 'handPanel'];
  for (const region of measuredRegions) {
    if (!before.regions[region] || !after.regions[region]) return { passed: false, missingRegion: region, differences };
    for (const key of ['top', 'bottom', 'height', 'documentTop', 'left', 'right', 'width']) {
      differences[`${region}.${key}`] = round(after.regions[region][key] - before.regions[region][key]);
    }
  }
  return { passed: Object.values(differences).every((difference) => Math.abs(difference) <= TOLERANCE), differences };
}

// 这是明确按钮所请求的内部位置设置，不触碰window滚动。后续快照切换期间不重设任何位置。
// Explicit diagnostic control positions internal rivers only, never window scrolling; no resets occur during later snapshots.
export function setRiverReviewPosition(view, position) {
  if (!['middle', 'bottom', 'top'].includes(position)) throw new Error('Unknown river position');
  return [...view.document.querySelectorAll(RIVER_SELECTOR)].map((element, index) => {
    const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTop = position === 'bottom' ? maximum : position === 'middle' ? Math.floor(maximum / 2) : 0;
    return { index, position, scrollTop: element.scrollTop, maximum };
  });
}

// 验收当前同尺寸同模式的进行中画面；只切合成视图，不在帧间移动视口或添加稳定样式。
// Audit in-game snapshots at the current case/size; only change synthetic views, never move the viewport or add stabilizing CSS.
export async function auditStableTable(view, caseId, setSnapshot) {
  await setSnapshot(stableTableSnapshot(caseId, 'empty'));
  const resourcesReady = await settleStableTable(view);
  const baseline = measureStableTable(view);
  const samples = [];
  for (const [stageId, label] of STABLE_TABLE_STAGES.slice(1)) {
    const before = measureStableTable(view);
    await setSnapshot(stableTableSnapshot(caseId, stageId));
    await settleStableTable(view);
    const after = measureStableTable(view);
    samples.push({ stageId, label, before, after, fromPrevious: compareStableTable(before, after), fromBaseline: compareStableTable(baseline, after) });
  }
  // 单独验证已有多行牌河回看中/旧底部时再增长；设定位置在before之前，不是强行复位。
  // Separately grow an existing river while reviewing/bottom-scrolled; position once before the baseline, never reset after the change.
  const scrollRetention = [];
  for (const position of ['middle', 'bottom']) {
    await setSnapshot(stableTableSnapshot(caseId, 'many-rows'));
    await settleStableTable(view);
    setRiverReviewPosition(view, position);
    const before = measureStableTable(view);
    await setSnapshot(stableTableSnapshot(caseId, 'river-growth'));
    await settleStableTable(view);
    const after = measureStableTable(view);
    const rivers = before.scrolling.filter((region) => region.key.startsWith('.discard-tiles:') || region.key.startsWith('.chengdu-river:'));
    const preserved = rivers.map((region) => {
      const next = after.scrolling.find((candidate) => candidate.key === region.key);
      return { key: region.key, before: region.scrollTop, after: next?.scrollTop,
        passed: !!next && Math.abs(region.scrollTop - next.scrollTop) <= TOLERANCE };
    });
    scrollRetention.push({ position, before, after, preserved, geometry: compareStableTable(before, after),
      passed: preserved.length > 0 && preserved.every((region) => region.passed) && compareStableTable(before, after).passed });
  }
  await setSnapshot(stableTableSnapshot(caseId, 'history-growth'));
  await settleStableTable(view);
  const reachability = await auditReachability(view);
  return {
    scope: '真实Vue模板/CSS；当前iframe分辨率、同模式游戏中。排除切模式、开局/终局及主动展开详情。键盘入口检查不替代实际按键验收。',
    caseId, tolerancePixels: TOLERANCE, resourcesReady, baseline, samples, scrollRetention, reachability,
    passed: resourcesReady && samples.every((sample) => sample.fromPrevious.passed && sample.fromBaseline.passed) &&
      scrollRetention.every((sample) => sample.passed) && reachability.passed,
  };
}

// 只对实际overflow区验证末端可达、可聚焦与标签；保存/恢复的是区内位置，不改window滚动。
// Verify reachability/focus/labels only for actual overflow; restore local positions, never window scrolling.
export async function auditReachability(view) {
  const startScrollY = view.scrollY;
  const results = [];
  for (const { key, element } of scrollRegions(view)) {
    const overflowY = element.scrollHeight - element.clientHeight > TOLERANCE;
    const overflowX = element.scrollWidth - element.clientWidth > TOLERANCE;
    if (!overflowY && !overflowX) continue;
    const beforeTop = element.scrollTop;
    const beforeLeft = element.scrollLeft;
    const style = view.getComputedStyle(element);
    const keyboardEntry = element.tabIndex >= 0;
    const named = !!(element.getAttribute('aria-label') || element.getAttribute('aria-labelledby'));
    element.scrollTop = element.scrollHeight;
    element.scrollLeft = element.scrollWidth;
    await new Promise((resolve) => view.requestAnimationFrame(() => view.requestAnimationFrame(resolve)));
    const maximumY = element.scrollHeight - element.clientHeight;
    const maximumX = element.scrollWidth - element.clientWidth;
    const actualTop = element.scrollTop;
    const actualLeft = element.scrollLeft;
    const offsetEndReached = (!overflowY || Math.abs(element.scrollTop - maximumY) <= TOLERANCE) &&
      (!overflowX || Math.abs(element.scrollLeft - maximumX) <= TOLERANCE);
    const scrollable = (!overflowY || /auto|scroll/.test(style.overflowY)) && (!overflowX || /auto|scroll/.test(style.overflowX));
    // stable gutter可能包含在scrollWidth中而不属于可滚范围；不能凭差值猜测末牌被遮住。
    // A stable gutter can appear in scrollWidth without scrollable content; offsets alone cannot establish clipping.
    // 另量最后一张真实牌/记录，要求在client内容边界内完整可见，不扩大像素容差或补写scroll位置。
    // Independently measure the final real tile/entry, requiring full visibility within client bounds without widening tolerance/resetting scroll.
    const rect = element.getBoundingClientRect();
    const scaleX = element.offsetWidth ? rect.width / element.offsetWidth : 1;
    const scaleY = element.offsetHeight ? rect.height / element.offsetHeight : 1;
    const clientBounds = {
      left: rect.left + element.clientLeft * scaleX,
      top: rect.top + element.clientTop * scaleY,
      right: rect.left + (element.clientLeft + element.clientWidth) * scaleX,
      bottom: rect.top + (element.clientTop + element.clientHeight) * scaleY,
    };
    const entries = element.querySelectorAll('.mahjong-tile, li');
    const lastContent = entries[entries.length - 1] || element.lastElementChild;
    const lastContentBounds = bounds(lastContent, view);
    const lastContentVisible = isStableTableEndVisible(clientBounds, lastContentBounds, { overflowX, overflowY });
    const contentEndReached = !!lastContent && lastContentVisible && (!overflowX || actualLeft > 0) && (!overflowY || actualTop > 0);
    const endReached = offsetEndReached || contentEndReached;
    results.push({ key, keyboardEntry, named, overflowY, overflowX, maximumY, maximumX, actualTop, actualLeft,
      offsetEndReached, clientBounds, lastContentBounds, lastContentVisible, contentEndReached,
      gutterWidth: element.offsetWidth - element.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth),
      endReached, scrollable, passed: keyboardEntry && named && endReached && scrollable });
    element.scrollTop = beforeTop;
    element.scrollLeft = beforeLeft;
  }
  return { scope: '实际overflow的末端滚动值 + tabindex/aria标签；实际键盘滚动留给可见浏览器复核', results,
    windowScrollUnchanged: view.scrollY === startScrollY,
    passed: results.length > 0 && results.every((result) => result.passed) && view.scrollY === startScrollY };
}

// 独立纯比较保证实际末牌仍在边界外时失败；保留与几何稳定性相同的1px容差。
// Pure comparison fails if the final tile remains outside; use the same 1px geometry tolerance.
export function isStableTableEndVisible(client, content, { overflowX, overflowY }) {
  if (!content) return false;
  return (!overflowX || content.left >= client.left - TOLERANCE && content.right <= client.right + TOLERANCE) &&
    (!overflowY || content.top >= client.top - TOLERANCE && content.bottom <= client.bottom + TOLERANCE);
}
