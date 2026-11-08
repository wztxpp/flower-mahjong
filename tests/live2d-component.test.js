// 编译真实 SFC 并运行 Vue 调度；只替换 SDK 与资源目录，不冒充 WebGL 可见验收。
// Compile the actual SFC and run Vue scheduling, replacing only SDK/catalog; this is not visible WebGL validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { createRenderer, ref, nextTick, h, markRaw } from 'vue';
import { createLive2DConsent, LIVE2D_CONSENT_KEY } from '../src/live2d/consent.js';

const source = readFileSync(new URL('../src/CharacterArtwork.vue', import.meta.url), 'utf8');
let code = compileScript(parse(source).descriptor, { id: 'artwork-lifecycle', inlineTemplate: true }).content;
code = code.replaceAll(/from ['"]vue['"]/g, `from ${JSON.stringify(import.meta.resolve('vue'))}`)
  .replace("import { loadLive2DRuntime } from './live2d/loader.js';", 'const loadLive2DRuntime = () => { globalThis.artworkRuntimeCalls = (globalThis.artworkRuntimeCalls || 0) + 1; return globalThis.artworkTestRuntime; };')
  .replace("import { live2DCharacterFor } from './live2d/catalog.js';", 'const live2DCharacterFor = (id) => globalThis.artworkTestCatalog[id] || null;')
  .replace("'./live2d/consent.js'", JSON.stringify(new URL('../src/live2d/consent.js', import.meta.url).href))
  .replace("'./live2d/portrait-controller.js'", JSON.stringify(new URL('../src/live2d/portrait-controller.js', import.meta.url).href));
const { default: Artwork } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
let settingsCode = compileScript(parse(readFileSync(new URL('../src/Live2DSettings.vue', import.meta.url), 'utf8')).descriptor,
  { id: 'live2d-settings', inlineTemplate: true }).content;
settingsCode = settingsCode.replaceAll(/from ['"]vue['"]/g, `from ${JSON.stringify(import.meta.resolve('vue'))}`)
  .replace("'./live2d/consent.js'", JSON.stringify(new URL('../src/live2d/consent.js', import.meta.url).href));
const { default: Settings } = await import(`data:text/javascript;base64,${Buffer.from(settingsCode).toString('base64')}`);
// 独立成都组件仍使用真实画框，只省略本用例无关的麻将牌绘制；不借 App 给它传许可开关。
// Standalone Chengdu uses actual artwork, omitting only unrelated tile rendering and receiving no consent prop from App.
let tableCode = compileScript(parse(readFileSync(new URL('../src/ChengduTable.vue', import.meta.url), 'utf8')).descriptor,
  { id: 'standalone-chengdu-consent', inlineTemplate: true }).content;
tableCode = tableCode.replaceAll(/from ['"]vue['"]/g, `from ${JSON.stringify(import.meta.resolve('vue'))}`)
  .replace("import MahjongTile from './MahjongTile.vue';", 'const MahjongTile = { render: () => null };')
  .replace("'./CharacterArtwork.vue'", JSON.stringify(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`))
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
function mount(initial, { consent = createLive2DConsent(), accepted = true } = {}) {
  if (accepted) consent.accept();
  const role = ref(initial);
  const root = markRaw({ children: [] });
  const app = createRenderer(host).createApp({ setup() { return () => h(Artwork, { character: role.value }); } });
  app.provide(LIVE2D_CONSENT_KEY, consent);
  app.mount(root);
  return { role, root, app, consent };
}
const background = (scope) => scope.root.children[0].children.find((node) => node.props?.class?.includes('character-artwork-background'));
const status = (scope) => scope.root.children[0].props['data-renderer'];

test('real Vue lifecycle protects canvas ownership, batched role/reaction changes and old backgrounds', async () => {
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  const instances = [];
  class Renderer {
    constructor(canvas, onError, phase) { Object.assign(this, { canvas, onError, phase, loaded: false }); instances.push(this); }
    async load() { this.loaded = true; }
    start() {}
    stop() {}
    dispose() { this.loaded = false; this.disposed = true; }
  }
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  globalThis.window = { matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; } };
  globalThis.artworkTestCatalog = Object.fromEntries(['sweet', 'sunny'].map((id) => [id, { id, backgroundUrl: `/${id}/background.png` }]));
  const scopes = [];
  try {
    globalThis.artworkTestRuntime = Promise.resolve({ Live2DRenderer: Renderer });
    let scope = mount(character('sweet', 'win')); scopes.push(scope);
    await flush();
    scope.role.value = character('sunny');
    await flush();
    assert.equal(instances.length, 1);
    assert.notEqual(status(scope), 'fallback');
    scope.app.unmount();

    instances.length = 0;
    scope = mount(character('sweet')); scopes.push(scope);
    await flush();
    const first = background(scope);
    first.props.onLoad({ currentTarget: first });
    await flush();
    assert.equal(status(scope), 'live2d');
    scope.role.value = character('sunny');
    await flush();
    const second = background(scope);
    first.props.onError({ currentTarget: first });
    second.props.onLoad({ currentTarget: second });
    await flush();
    assert.equal(status(scope), 'live2d');
    scope.role.value = character('sweet');
    await flush();
    const current = background(scope);
    assert.notEqual(current, first);
    first.props.onError({ currentTarget: first });
    first.props.onLoad({ currentTarget: first });
    await flush();
    assert.equal(status(scope), 'original');
    current.props.onLoad({ currentTarget: current });
    await flush();
    assert.equal(status(scope), 'live2d');
    assert.equal(new Set(instances.map((instance) => instance.canvas)).size, 3);
    assert.ok(instances.slice(0, 2).every((instance) => instance.disposed));
    scope.app.unmount();

    instances.length = 0;
    let resolveRuntime;
    globalThis.artworkTestRuntime = new Promise((resolve) => { resolveRuntime = resolve; });
    scope = mount(character('sweet')); scopes.push(scope);
    await flush();
    scope.role.value = character('sunny');
    await flush();
    scope.role.value = character('sweet');
    await flush();
    resolveRuntime({ Live2DRenderer: Renderer });
    await flush();
    assert.equal(instances.length, 1);
    assert.equal(instances[0].phase, 'sweet:0');
    assert.notEqual(status(scope), 'fallback');
    scope.app.unmount();

    instances.length = 0;
    globalThis.artworkTestRuntime = new Promise((resolve) => { resolveRuntime = resolve; });
    scope = mount(character('sweet')); scopes.push(scope);
    await flush();
    scope.app.unmount();
    resolveRuntime({ Live2DRenderer: Renderer });
    await flush();
    assert.equal(instances.length, 0);
  } finally {
    for (const scope of scopes) if (scope.root.children.length) scope.app.unmount();
    globalThis.document = oldDocument;
    globalThis.window = oldWindow;
    delete globalThis.artworkTestCatalog;
    delete globalThis.artworkTestRuntime;
  }
});


// 运行真实画框与真实设置按钮：打开、拒绝、同意、关闭和迟到 Promise 均走生产逻辑。
// Run actual frames and settings controls through opening, decline, assent, disable and late-promise production paths.
test('standalone artwork requires explicit consent and disabling releases active and pending renderers', async () => {
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  const instances = [];
  class Renderer {
    constructor(canvas) { this.canvas = canvas; this.loaded = false; this.releases = 0; instances.push(this); }
    async load() { this.loaded = true; }
    start() {}
    stop() {}
    dispose() { this.loaded = false; this.releases += 1; }
  }
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  globalThis.artworkTestCatalog = { sweet: { id: 'sweet', backgroundUrl: '/live2d/sweet/background.png' } };
  globalThis.artworkTestRuntime = Promise.resolve({ Live2DRenderer: Renderer });
  globalThis.artworkRuntimeCalls = 0;
  const scope = mount(character('sweet'), { accepted: false });
  try {
    await flush();
    assert.equal(globalThis.artworkRuntimeCalls, 0);
    assert.equal(background(scope), undefined);
    assert.equal(status(scope), 'original');
    scope.consent.decline();
    await flush();
    assert.equal(globalThis.artworkRuntimeCalls, 0);
    scope.consent.accept();
    await flush();
    assert.equal(globalThis.artworkRuntimeCalls, 1);
    assert.equal(instances.length, 1);
    const previousBackground = background(scope);
    previousBackground.props.onLoad({ currentTarget: previousBackground });
    await flush();
    assert.equal(status(scope), 'live2d');
    scope.consent.decline();
    assert.equal(instances[0].releases, 1);
    await flush();
    assert.equal(status(scope), 'original');
    assert.equal(background(scope), undefined);
    previousBackground.props.onError({ currentTarget: previousBackground });
    await flush();
    assert.equal(status(scope), 'original');

    let resolveRuntime;
    globalThis.artworkTestRuntime = new Promise((resolve) => { resolveRuntime = resolve; });
    scope.consent.accept();
    await flush();
    scope.consent.decline();
    resolveRuntime({ Live2DRenderer: Renderer });
    await flush();
    assert.equal(instances.length, 1);
    assert.equal(status(scope), 'original');

    globalThis.artworkTestRuntime = Promise.resolve({ Live2DRenderer: Renderer });
    scope.consent.accept();
    await flush();
    assert.equal(instances.length, 2);
    assert.notEqual(instances[1].canvas, instances[0].canvas);
    const nextBackground = background(scope);
    assert.notEqual(nextBackground, previousBackground);
    // 同一微任务批次关闭再打开仍必须换节点，不能复用已 loseContext 的 canvas。
    // Disable/re-enable within one microtask batch must replace the already-lost canvas.
    scope.consent.decline();
    scope.consent.accept();
    await flush();
    assert.equal(instances[1].releases, 1);
    assert.equal(instances.length, 3);
    assert.notEqual(instances[2].canvas, instances[1].canvas);
    assert.notEqual(background(scope), nextBackground);
    nextBackground.props.onLoad({ currentTarget: nextBackground });
    nextBackground.props.onError({ currentTarget: nextBackground });
    await flush();
    assert.equal(status(scope), 'original');
    const finalBackground = background(scope);
    finalBackground.props.onLoad({ currentTarget: finalBackground });
    await flush();
    assert.equal(status(scope), 'live2d');
  } finally {
    scope.app.unmount();
    globalThis.document = oldDocument;
    globalThis.window = oldWindow;
    delete globalThis.artworkTestCatalog;
    delete globalThis.artworkTestRuntime;
    delete globalThis.artworkRuntimeCalls;
  }
});


// 点击真实设置组件的按钮影响同页全部画框；手动打开/关闭和重复选择不隐式启用或重复加载。
// Actual settings buttons govern all page frames; opening/closing or repeated choices neither imply assent nor duplicate loads.
test('real settings controls gate sibling frames, reopen safely and show storage failure', async () => {
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  const items = new Map();
  const environment = { localStorage: { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) } };
  const consent = createLive2DConsent({ environment });
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
  globalThis.artworkTestCatalog = { sweet: { id: 'sweet', backgroundUrl: '/live2d/sweet/background.png' } };
  globalThis.artworkTestRuntime = Promise.resolve({ Live2DRenderer: Renderer });
  globalThis.artworkRuntimeCalls = 0;
  const root = markRaw({ children: [] });
  const app = createRenderer(host).createApp({ render: () => h('div', [h(Settings), h(Artwork, { character: character('sweet') }), h(Artwork, { character: character('sweet') })]) });
  app.provide(LIVE2D_CONSENT_KEY, consent);
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
    assert.equal(consent.enabled.value, false);
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
    assert.equal(consent.enabled.value, true);
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
    assert.equal(consent.enabled.value, true);
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


// 不经 App 的四画框也必须默认静态；同意后加载，停用后释放，牌局视图和动作均不改变。
// Even four frames mounted without App default static, load after assent and release on disable without game changes/actions.
test('standalone actual ChengduTable gates all four portraits and never changes game state', async () => {
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
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
  globalThis.artworkTestCatalog = { sweet: { id: 'sweet', backgroundUrl: '/live2d/sweet/background.png' } };
  globalThis.artworkTestRuntime = Promise.resolve({ Live2DRenderer: Renderer });
  globalThis.artworkRuntimeCalls = 0;
  const consent = createLive2DConsent();
  const state = {
    viewerRole: 'player', you: 0, phase: 'playing', seats: [], tableScores: [],
    game: { id: 'consent-test', mySeat: 0, dealerSeat: 0, currentSeat: 0, phase: 'turn', wallCount: 55,
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
  app.provide(LIVE2D_CONSENT_KEY, consent);
  app.mount(root);
  try {
    await flush();
    assert.equal(globalThis.artworkRuntimeCalls, 0);
    consent.decline();
    await flush();
    assert.equal(globalThis.artworkRuntimeCalls, 0);
    consent.accept();
    await flush();
    assert.equal(instances.length, 4);
    assert.equal(new Set(instances.map((instance) => instance.canvas)).size, 4);
    consent.decline();
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
