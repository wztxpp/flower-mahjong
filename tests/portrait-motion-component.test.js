// 编译真实 SFC 并运行 Vue 调度；只替换渲染器与资源目录；像素合同另由真实Canvas2D浏览器验收。
// Compile the actual SFC and run Vue scheduling, replacing only renderer/catalog; actual Canvas2D browsers separately validate pixels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { createRenderer, ref, nextTick, h, markRaw } from 'vue';
import { createPortraitMotionSettings, PORTRAIT_MOTION_KEY } from '../src/portrait-motion/settings.js';

const source = readFileSync(new URL('../src/CharacterArtwork.vue', import.meta.url), 'utf8');
let code = compileScript(parse(source).descriptor, { id: 'artwork-lifecycle', inlineTemplate: true }).content;
code = code.replaceAll(/from ['"]vue['"]/g, `from ${JSON.stringify(import.meta.resolve('vue'))}`)
  .replace("import { loadPortraitMotionRuntime } from './portrait-motion/loader.js';", 'const loadPortraitMotionRuntime = () => { globalThis.artworkRuntimeCalls = (globalThis.artworkRuntimeCalls || 0) + 1; return globalThis.artworkTestRuntime; };')
  .replace("import { portraitMotionFor } from './portrait-motion/catalog.js';", 'const portraitMotionFor = (id) => globalThis.artworkTestCatalog[id] || null;')
  .replace("'./portrait-motion/settings.js'", JSON.stringify(new URL('../src/portrait-motion/settings.js', import.meta.url).href))
  .replace("'./portrait-motion/controller.js'", JSON.stringify(new URL('../src/portrait-motion/controller.js', import.meta.url).href));
const { default: Artwork } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
let settingsCode = compileScript(parse(readFileSync(new URL('../src/PortraitMotionSettings.vue', import.meta.url), 'utf8')).descriptor,
  { id: 'live2d-settings', inlineTemplate: true }).content;
settingsCode = settingsCode.replaceAll(/from ['"]vue['"]/g, `from ${JSON.stringify(import.meta.resolve('vue'))}`)
  .replace("'./portrait-motion/settings.js'", JSON.stringify(new URL('../src/portrait-motion/settings.js', import.meta.url).href));
const { default: Settings } = await import(`data:text/javascript;base64,${Buffer.from(settingsCode).toString('base64')}`);
// 独立成都组件仍使用真实画框，只省略本用例无关的麻将牌绘制；不借 App 给它传显示开关。
// Standalone Chengdu uses actual artwork, omitting only unrelated tile rendering and receiving no settings prop from App.
let tableCode = compileScript(parse(readFileSync(new URL('../src/ChengduTable.vue', import.meta.url), 'utf8')).descriptor,
  { id: 'standalone-chengdu-settings', inlineTemplate: true }).content;
tableCode = tableCode.replaceAll(/from ['"]vue['"]/g, `from ${JSON.stringify(import.meta.resolve('vue'))}`)
  .replace("import MahjongTile from './MahjongTile.vue';", 'const MahjongTile = { render: () => null };')
  .replace("'./CharacterArtwork.vue'", JSON.stringify(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`))
  .replace("'./round-summary.js'", JSON.stringify(new URL('../src/round-summary.js', import.meta.url).href))
  .replace("'./chengdu-event-text.js'", JSON.stringify(new URL('../src/chengdu-event-text.js', import.meta.url).href))
  .replace("'./mahjong-tile-presentation.js'", JSON.stringify(new URL('../src/mahjong-tile-presentation.js', import.meta.url).href));
const { default: ChengduTable } = await import(`data:text/javascript;base64,${Buffer.from(tableCode).toString('base64')}`);



// 自定义 host 节点必须 markRaw，避免 Vue 把普通对象代理后造成假的 DOM 身份失败。
// Custom-host nodes must be markRaw, preventing proxy wrapping from falsely changing DOM identity.
const host = {
  insert(element, parent, anchor = null) {
    if (element.parent) host.remove(element);
    element.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index < 0) parent.children.push(element);
    else parent.children.splice(index, 0, element);
  },
  remove(element) {
    if (element.parent) {
      const index = element.parent.children.indexOf(element);
      if (index >= 0) element.parent.children.splice(index, 1);
    }
    element.parent = null;
  },
  createElement(type) { return markRaw({ type, props: {}, children: [], parent: null, focus() { this.focused = true; } }); },
  createText(text) { return markRaw({ type: '#text', text, parent: null }); },
  createComment(text) { return markRaw({ type: '#comment', text, parent: null }); },
  setText(element, text) { element.text = text; },
  setElementText(element, text) { element.text = text; },
  parentNode(element) { return element.parent; },
  nextSibling(element) { const children = element.parent?.children; return children?.[children.indexOf(element) + 1] || null; },
  patchProp(element, key, previous, value) { element.props[key] = value; },
};
const flush = async () => { for (let index = 0; index < 18; index += 1) await nextTick(); };
const character = (id, reaction = 'base') => ({ id, name: id, portrait: `/${id}-${reaction}.png`, portraitReaction: reaction, portraitPhaseKey: `${id}:0` });
function mount(initial, { settings = createPortraitMotionSettings(), initiallyEnabled = true } = {}) {
  if (initiallyEnabled) settings.enable();
  const role = ref(initial);
  const root = markRaw({ children: [] });
  const app = createRenderer(host).createApp({ setup() { return () => h(Artwork, { character: role.value }); } });
  app.provide(PORTRAIT_MOTION_KEY, settings);
  app.mount(root);
  return { role, root, app, settings };
}
const status = (scope) => scope.root.children[0].props['data-renderer'];
const original = (scope) => scope.root.children[0].children.find((node) => node.props?.class === 'character-artwork-original');

// 真实组件验证原img永远可见、换角代次、反应暂停、关开/卸载拒绝迟到模块。
// Actual components protect the always-visible img, role generations, reaction pauses and stale off/on/unmount imports.
test('real artwork preserves original through role/reaction changes, restart, failure and late imports', async () => {
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  const instances = [];
  class Renderer {
    constructor(canvas, onError, phase) { Object.assign(this, { canvas, onError, phase, loaded: false }); instances.push(this); }
    async load() { this.loaded = true; }
    start() { this.running = true; }
    stop() { this.running = false; }
    dispose() { this.loaded = false; this.disposed = true; }
  }
  const listeners = new Map();
  const media = { matches: false, addEventListener(type, fn) { listeners.set('motion', fn); }, removeEventListener() {} };
  globalThis.document = { hidden: false, addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener() {} };
  globalThis.window = { matchMedia: () => media };
  globalThis.artworkTestCatalog = Object.fromEntries(['sweet', 'sunny'].map((id) => [id, { id, sourceUrl: `/${id}-base.png` }]));
  globalThis.artworkTestRuntime = Promise.resolve({ PortraitMotionRenderer: Renderer });
  let scope;
  try {
    scope = mount(character('sweet'), { initiallyEnabled: false });
    await flush();
    assert.equal(instances.length, 0);
    assert.equal(original(scope).props.src, '/sweet-base.png');
    assert.equal(original(scope).props.style, undefined);
    scope.settings.enable();
    await flush();
    assert.equal(status(scope), 'motion');
    const first = instances[0];
    for (const reaction of ['win', 'discardLoss']) {
      scope.role.value = character('sweet', reaction);
      await flush();
      assert.equal(status(scope), 'original');
      assert.equal(original(scope).props.src, `/sweet-${reaction}.png`);
      assert.equal(first.running, false);
      scope.role.value = character('sweet');
      await flush();
      assert.equal(status(scope), 'motion');
    }
    assert.equal(instances.length, 1);
    globalThis.document.hidden = true;
    listeners.get('visibilitychange')();
    await flush();
    assert.equal(status(scope), 'original');
    assert.equal(first.running, false);
    globalThis.document.hidden = false;
    listeners.get('visibilitychange')();
    media.matches = true;
    listeners.get('motion')();
    await flush();
    assert.equal(status(scope), 'original');
    media.matches = false;
    listeners.get('motion')();
    await flush();
    assert.equal(status(scope), 'motion');
    scope.role.value = character('sunny');
    await flush();
    assert.equal(first.disposed, true);
    assert.notEqual(instances[1].canvas, first.canvas);
    assert.equal(instances[1].phase, 'sunny:0');
    instances[1].onError(new Error('Canvas failed'));
    await flush();
    assert.equal(status(scope), 'fallback');
    assert.equal(original(scope).props.src, '/sunny-base.png');
    scope.settings.disable();
    scope.settings.enable();
    await flush();
    assert.equal(status(scope), 'motion');
    assert.equal(instances.length, 3);
    scope.app.unmount();
    assert.ok(instances.every((instance) => instance.disposed));

    let resolveRuntime;
    const count = instances.length;
    globalThis.artworkTestRuntime = new Promise((resolve) => { resolveRuntime = resolve; });
    scope = mount(character('sweet'));
    await flush();
    scope.role.value = character('sunny');
    await flush();
    scope.role.value = character('sweet');
    await flush();
    resolveRuntime({ PortraitMotionRenderer: Renderer });
    await flush();
    assert.equal(instances.length, count + 1);
    scope.settings.disable();
    await flush();
    globalThis.artworkTestRuntime = new Promise((resolve) => { resolveRuntime = resolve; });
    scope.settings.enable();
    await flush();
    scope.app.unmount();
    resolveRuntime({ PortraitMotionRenderer: Renderer });
    await flush();
    assert.equal(instances.length, count + 1);
  } finally {
    if (scope?.root.children.length) scope.app.unmount();
    globalThis.document = oldDocument;
    globalThis.window = oldWindow;
    delete globalThis.artworkTestCatalog;
    delete globalThis.artworkTestRuntime;
  }
});



// 点击真实设置组件的按钮影响同页全部画框；手动打开/关闭和重复选择不隐式启用或重复加载。
// Actual settings buttons govern all page frames; opening/closing or repeated choices neither imply enablement nor duplicate loads.
test('real settings controls gate sibling frames, reopen safely and show storage failure', async () => {
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  const items = new Map();
  const environment = { localStorage: { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) } };
  const settings = createPortraitMotionSettings({ environment });
  const instances = [];
  class Renderer {
    constructor(canvas) { this.canvas = canvas; instances.push(this); }
    async load() { this.loaded = true; }
    start() {}
    stop() {}
    dispose() { this.loaded = false; this.disposed = true; }
  }
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  globalThis.artworkTestCatalog = { sweet: { id: 'sweet', sourceUrl: '/sweet-base.png' } };
  globalThis.artworkTestRuntime = Promise.resolve({ PortraitMotionRenderer: Renderer });
  globalThis.artworkRuntimeCalls = 0;
  const root = markRaw({ children: [] });
  const app = createRenderer(host).createApp({ render: () => h('div', [h(Settings), h(Artwork, { character: character('sweet') }), h(Artwork, { character: character('sweet') })]) });
  app.provide(PORTRAIT_MOTION_KEY, settings);
  app.mount(root);
  const descendants = (node) => [node, ...(node.children || []).flatMap(descendants)];
  try {
    await flush();
    const details = descendants(root).find((node) => node.type === 'details');
    const summary = descendants(root).find((node) => node.type === 'summary');
    const buttons = descendants(root).filter((node) => node.type === 'button');
    assert.equal(buttons.length, 2);
    assert.equal(globalThis.artworkRuntimeCalls, 0);
    details.open = true;
    details.open = false;
    await flush();
    assert.equal(settings.enabled.value, false);
    details.open = true;
    buttons[1].props.onClick();
    await flush();
    assert.equal(globalThis.artworkRuntimeCalls, 0);
    assert.equal(details.open, false);
    assert.equal(summary.focused, true);
    details.open = true;
    buttons[0].props.onClick();
    await flush();
    assert.equal(globalThis.artworkRuntimeCalls, 2);
    assert.equal(settings.enabled.value, true);
    assert.equal(details.open, false);
    buttons[0].props.onClick();
    await flush();
    assert.equal(globalThis.artworkRuntimeCalls, 2);
    details.open = true;
    buttons[1].props.onClick();
    await flush();
    assert.ok(instances.every((instance) => instance.disposed));
    assert.equal(descendants(root).filter((node) => node.type === 'canvas').length, 0);
    environment.localStorage.setItem = () => { throw new Error('Storage denied'); };
    details.open = true;
    buttons[0].props.onClick();
    await flush();
    assert.equal(settings.enabled.value, true);
    assert.equal(details.open, true);
    assert.ok(descendants(root).some((node) => node.props?.role === 'status' && node.text?.includes('本次选择仅在当前页面生效')));
  } finally {
    app.unmount();
    globalThis.document = oldDocument;
    globalThis.window = oldWindow;
    delete globalThis.artworkTestCatalog;
    delete globalThis.artworkTestRuntime;
    delete globalThis.artworkRuntimeCalls;
  }
});


// 不经 App 的四画框也必须默认静态；启用后加载，停用后释放，牌局视图和动作均不改变。
// Even four frames mounted without App default static, load after enablement and release on disable without game changes/actions.
test('standalone actual ChengduTable gates all four portraits and never changes game state', async () => {
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  const instances = [];
  class Renderer {
    constructor(canvas, onError, phase) { Object.assign(this, { canvas, onError, phase }); instances.push(this); }
    async load() { this.loaded = true; }
    start() {}
    stop() {}
    dispose() { this.loaded = false; this.disposed = true; }
  }
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  globalThis.artworkTestCatalog = { sweet: { id: 'sweet', sourceUrl: '/sweet-base.png' } };
  globalThis.artworkTestRuntime = Promise.resolve({ PortraitMotionRenderer: Renderer });
  globalThis.artworkRuntimeCalls = 0;
  const settings = createPortraitMotionSettings();
  const state = {
    viewerRole: 'player', you: 0, phase: 'playing', seats: [], tableScores: [],
    game: { id: 'settings-test', mySeat: 0, dealerSeat: 0, currentSeat: 0, phase: 'turn', wallCount: 55,
      rules: { endCondition: 'bloodBattle', fanCap: 4, selfDraw: 'addBase' },
      players: Array.from({ length: 4 }, (_, seat) => ({ seat, score: 0, handCount: 13, melds: [], won: null, ...(seat === 0 ? { hand: [0] } : {}) })),
      legalActions: [], history: [], discards: [],
    },
  };
  const snapshot = JSON.stringify(state);
  const root = markRaw({ children: [] });
  const app = createRenderer(host).createApp({ render: () => h(ChengduTable, { state,
    characterForPlayer: (seat) => ({ ...character('sweet'), portraitPhaseKey: `sweet:${seat}` }),
    onAction: () => assert.fail('Consent must not submit an action'),
  }) });
  app.provide(PORTRAIT_MOTION_KEY, settings);
  app.mount(root);
  try {
    await flush();
    assert.equal(globalThis.artworkRuntimeCalls, 0);
    settings.disable();
    await flush();
    assert.equal(globalThis.artworkRuntimeCalls, 0);
    settings.enable();
    await flush();
    assert.equal(instances.length, 4);
    assert.equal(new Set(instances.map((instance) => instance.canvas)).size, 4);
    assert.deepEqual(new Set(instances.map((instance) => instance.phase)), new Set([0, 1, 2, 3].map((seat) => `sweet:${seat}`)));
    settings.disable();
    await flush();
    assert.ok(instances.every((instance) => instance.disposed));
    assert.equal(JSON.stringify(state), snapshot);
  } finally {
    app.unmount();
    globalThis.document = oldDocument;
    globalThis.window = oldWindow;
    delete globalThis.artworkTestCatalog;
    delete globalThis.artworkTestRuntime;
    delete globalThis.artworkRuntimeCalls;
  }
});
