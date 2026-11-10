// 编译实际写实SFC并用内存DOM挂载：验证Vue生命周期和事件，而不是另写一套牌桌实现。
// Compile and mount shipped realistic SFCs in memory: verify Vue lifecycle/events, never a parallel table implementation.
// 此处不证明像素、触屏或浏览器布局；这些仍需隔离浏览器验收。
// This does not prove pixels, touchscreen behavior or browser layout; those require the isolated browser audit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import * as Vue from 'vue';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';

// 装载器递归解析真实相对依赖；只重写编译后的import，不替换被测setup或生命周期。
// Recursively resolve real relative dependencies, rewriting compiled imports only, never tested setup or lifecycle hooks.
const componentCache = new Map();
export async function loadRealisticComponent(filename) {
  const absolute = resolve(new URL('../src/', import.meta.url).pathname, filename);
  if (componentCache.has(absolute)) return componentCache.get(absolute);
  const { descriptor } = parse(readFileSync(absolute, 'utf8'));
  const script = compileScript(descriptor, { id: filename });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: filename,
    compilerOptions: { bindingMetadata: script.bindings, hoistStatic: false } });
  assert.deepEqual(template.errors, []);
  const modules = { vue: Vue };
  const imports = [...`${script.content}\n${template.code}`.matchAll(/import\s+[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g)];
  for (const [, specifier] of imports) {
    if (modules[specifier]) continue;
    const target = specifier.startsWith('.') ? resolve(dirname(absolute), specifier) : specifier;
    modules[specifier] = target.endsWith('.vue')
      ? { default: await loadRealisticComponent(target) }
      : await import(specifier.startsWith('.') ? pathToFileURL(target).href : target);
  }
  const rewrite = (code) => code
    .replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
      (_, bindings, specifier) => `const {${bindings.replace(/\s+as\s+/g, ':')}} = modules[${JSON.stringify(specifier)}];`)
    .replace(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g,
      (_, binding, specifier) => `const ${binding} = modules[${JSON.stringify(specifier)}].default;`);
  const component = new Function('modules', rewrite(script.content).replace('export default', 'return'))(modules);
  component.render = new Function('modules', `${rewrite(template.code).replace('export function render', 'function render')}\nreturn render;`)(modules);
  componentCache.set(absolute, component);
  return component;
}

// 节点保留真实父链、事件prop和捕获状态；所有几何尺寸都是明确合成值，不冒充浏览器测量。
// Nodes retain parent links, event props and capture state; geometry is explicitly synthetic, not browser measurement.
function hostNode(tag, text = '') {
  return Vue.markRaw({
    tag, text, props: {}, children: [], parent: null, style: {}, captured: new Set(),
    get tagName() { return this.tag.toUpperCase(); },
    get options() { return this.children.filter((child) => child.tag === 'option'); },
    get value() { return this.props.value; },
    set value(value) { this.props.value = value; },
    getRootNode() { return globalThis.document; },
    get isConnected() { return this.tag === 'root' || Boolean(this.parent?.isConnected); },
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 700, width: 900, height: 700 }; },
    setPointerCapture(pointerId) { this.captured.add(pointerId); },
    releasePointerCapture(pointerId) { this.captured.delete(pointerId); },
    hasPointerCapture(pointerId) { return this.captured.has(pointerId); },
    setAttribute(name, value) { this.props[name] = value; },
    removeAttribute(name) { delete this.props[name]; },
    addEventListener() {}, removeEventListener() {},
    closest(selector) { return selector.includes(this.tag) ? this : null; },
  });
}
const renderer = Vue.createRenderer({
  createElement: hostNode,
  createText: (text) => hostNode('#text', text),
  createComment: (text) => hostNode('#comment', text),
  setText(node, text) { node.text = text; },
  setElementText(node, text) { node.text = text; node.children = []; },
  parentNode: (node) => node.parent,
  nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
  patchProp(node, key, before, after) { node.props[key] = after; },
  insert(node, parent, anchor = null) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index < 0) parent.children.push(node);
    else parent.children.splice(index, 0, node);
  },
  remove(node) {
    // 浏览器移除元素自动释放指针捕获；内存宿主也必须模拟，避免误报卸载泄漏。
    // Browsers release capture on element removal; model that behavior instead of reporting a false unmount leak.
    realisticNodes(node, () => true).forEach((child) => child.captured.clear());
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = null;
  },
});
export function realisticNodes(root, predicate) {
  return [root, ...root.children.flatMap((child) => realisticNodes(child, () => true))].filter(predicate);
}

// 可控事件目标记录清理结果；不吞掉回调错误，以便取消/隐藏测试暴露真实缺陷。
// Controllable event targets record cleanup and do not swallow callback errors, exposing real cancel/visibility defects.
function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatch(type, event = {}) { for (const listener of listeners.get(type) || []) listener(event); },
  };
}

// 每个测试拥有独立浏览器能力和假时钟；结束恢复原描述符，不影响并行测试文件。
// Each test owns independent browser capabilities and a fake clock; restore descriptors afterward without affecting other test files.
let activeBrowser = null;
export function realisticBrowser(t, reducedMotion = false) {
  const cleanups = [];
  const keys = ['window', 'document', 'Document', 'ShadowRoot', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'];
  const originals = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const timers = new Map();
  const frames = new Map();
  const observers = [];
  let sequence = 0;
  const media = { ...eventTarget(), matches: reducedMotion };
  const window = { ...eventTarget(), innerWidth: 900, innerHeight: 700, matchMedia: () => media };
  const document = { ...eventTarget(), hidden: false, visibilityState: 'visible' };
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  // Vue原生range的v-model更新会检查Document/ShadowRoot；提供类型外壳而不伪造布局。
  // Vue range v-model updates inspect Document/ShadowRoot types; supply type shells without fabricating layout.
  Object.assign(globalThis, { window, document, Document: class {}, ShadowRoot: class {}, ResizeObserver,
    requestAnimationFrame(callback) { frames.set(++sequence, callback); return sequence; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback) { timers.set(++sequence, callback); return sequence; },
    clearTimeout(id) { timers.delete(id); },
  });
  window.requestAnimationFrame = globalThis.requestAnimationFrame;
  window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
  window.setTimeout = globalThis.setTimeout;
  window.clearTimeout = globalThis.clearTimeout;
  t.after(() => {
    cleanups.forEach((cleanup) => cleanup());
    activeBrowser = null;
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  activeBrowser = { cleanups };
  return { window, document, media, observers, timers, frames, cleanups,
    flushTimers() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((callback) => callback()); },
    flushFrames() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(100)); },
  };
}

// 合成已裁剪视图，不包含生产状态；手牌故意与隐藏胡牌不同以检测泄露。
// Synthetic filtered views contain no production data; own hands differ from hidden win tiles to detect leaks.
export function realisticFixture(count = 3) {
  return { id: 'SYNTHETIC', roomId: 'SYNTHETIC', viewerRole: 'player', you: 0, phase: 'playing', gameMode: 'flower',
    seats: Array.from({ length: count }, (_, seat) => ({ seat, name: `测试玩家${seat}`, connected: true })),
    game: { id: 'synthetic-round', gameMode: 'flower', schemaVersion: 3, phase: 'turn', mySeat: 0,
      currentSeat: 0, revision: 10, wallCount: 104, rules: { playerCount: count, turnDirection: 'counterclockwise' },
      players: Array.from({ length: count }, (_, seat) => ({ seat, handCount: 13, score: 0, huCount: 0,
        ...(seat === 0 ? { hand: [0, 1, 2] } : {}), melds: [], winPile: [], radishes: [] })),
      discards: [], sharedRadishes: [], pendingKongRadishes: 0,
      history: [{ type: 'draw', seat: 1, revision: 8 }, { type: 'discard', seat: 1, tile: 4, revision: 9 }],
      legalActions: [{ type: 'discard', tile: 0 }],
    },
  };
}

export async function mountRealistic(t, state = realisticFixture(), extraProps = {}) {
  const component = await loadRealisticComponent('RealisticTable.vue');
  const props = Vue.reactive({ state, characterForPlayer: (seat) => ({ id: 'sweet', name: `角色${seat}`, portrait: '/characters/sweet.png' }), ...extraProps });
  const root = hostNode('root');
  let instance;
  const app = renderer.createApp({ render() { return Vue.h(component, { ...props, ref: (value) => { instance = value; } }); } });
  const unmount = app.unmount.bind(app);
  let unmounted = false;
  app.unmount = () => { if (!unmounted) { unmounted = true; unmount(); } };
  app.mount(root);
  if (activeBrowser) activeBrowser.cleanups.push(() => app.unmount());
  else t.after(() => app.unmount());
  await Vue.nextTick();
  return { props, root, app, get instance() { return instance; }, get scope() { return instance?.$?.setupState; } };
}

test('solid shells preserve canonical hidden-face privacy and close all rounded edges', async () => {
  const component = await loadRealisticComponent('RealisticTableTile.vue');
  const root = hostNode('root');
  const app = renderer.createApp(component, { tile: 17, back: true, small: true });
  app.mount(root); await Vue.nextTick();
  // 三层各含四条直边和十二个圆角片；两张底盖闭合实体，不再断言旧方盒。
  // Three bands each contain four straight sides and twelve corner facets; two caps close the solid, not the old square box.
  const panels = realisticNodes(root, (node) => node.props.class === 'realistic-tile-shell-panel');
  assert.equal(panels.length, 48);
  assert.ok(panels.every((panel) => panel.props.style.transform.includes('matrix3d(')));
  assert.equal(realisticNodes(root, (node) => node.props.class === 'realistic-tile-bottom').length, 1);
  assert.equal(realisticNodes(root, (node) => node.props.class === 'realistic-tile-face').length, 1);
  assert.equal(realisticNodes(root, (node) => node.props['aria-label'] === '背面牌').length, 1);
  assert.equal(realisticNodes(root, (node) => node.props.class === 'tile-photo-face').length, 0);
  assert.equal(realisticNodes(root, (node) => node.tag === 'button').length, 0);
  app.unmount();
});
test('hidden walls free scene space while remaining count and rules stay untouched', async (t) => {
  realisticBrowser(t);
  const state = realisticFixture(4); const before = JSON.stringify(state);
  const mounted = await mountRealistic(t, state);
  assert.equal(realisticNodes(mounted.root, (node) => /realistic-wall-(zone|stack)/.test(String(node.props.class))).length, 0);
  const total = realisticNodes(mounted.root, (node) => node.props.class === 'realistic-wall-total')[0];
  assert.ok(total);
  assert.match(JSON.stringify(total.children.map((node) => node.text)), /104/);
  assert.equal(JSON.stringify(state), before);
});
test('private hand anchor follows rack geometry rather than variable panel height', async (t) => {
  const browser = realisticBrowser(t);
  const mounted = await mountRealistic(t, realisticFixture(), { hasPrivateControls: true });
  const controls = realisticNodes(mounted.root, (node) => node.props.id === 'realistic-private-controls')[0];
  const initial = parseFloat(controls.props.style.top);
  mounted.scope.handBottomOffset += 40;
  await Vue.nextTick();
  assert.equal(parseFloat(controls.props.style.top), initial - 40, 'More content above the hand does not move the rack off the rim');
  mounted.app.unmount();
  assert.ok(browser.observers.every((observer) => observer.disconnected));
});

// 在组件尚未交付时也可先验证测试宿主；后续测试全部装载真实SFC。
// Validate the host independently while components are being completed; subsequent tests load actual SFCs.
test('realistic test host preserves move order and pointer capture', () => {
  const root = hostNode('root');
  const child = hostNode('div');
  renderer.render(Vue.h('section', [Vue.h('div')]), root);
  assert.equal(realisticNodes(root, (node) => node.tag === 'div').length, 1);
  child.setPointerCapture(7);
  assert.equal(child.hasPointerCapture(7), true);
  child.releasePointerCapture(7);
  assert.equal(child.hasPointerCapture(7), false);
  renderer.render(null, root);
  assert.equal(root.children.length, 0);
});


// 已批准独立姿态使用透明底图；减少动态时不能偷偷启动眼发或重播历史动作。
// Approved independent poses use their cutouts; reduced motion never starts idle animation or historical actions.
test('real actor retains approved art, emits no actions and removes lifecycle listeners', async (t) => {
  const browser = realisticBrowser(t, true);
  const component = await loadRealisticComponent('RealisticCharacter.vue');
  const events = [];
  const root = hostNode('root');
  const app = renderer.createApp(component, { character: { id: 'sweet', name: '测试角色', portrait: '/characters/sweet.png' },
    position: 'left', enabled: false, action: { type: 'discard', eventKey: 'old' }, onAction: (...args) => events.push(args) });
  browser.cleanups.push(() => { if (root.children.length) app.unmount(); });
  app.mount(root);
  await Vue.nextTick();
  const frame = realisticNodes(root, (node) => String(node.props.class || '').split(/\s+/).includes('realistic-character'))[0];
  assert.equal(frame.props['data-art-status'], 'approved-single-source');
  assert.equal(frame.props['data-view'], 'left');
  assert.equal(realisticNodes(root, (node) => node.props.class === 'realistic-character-loader').length, 0);
  assert.equal(browser.frames.size, 0);
  assert.deepEqual(events, []);
  app.unmount();
  assert.equal(browser.document.listeners.get('visibilitychange')?.size || 0, 0);
  assert.equal(browser.media.listeners.get('change')?.size || 0, 0);
});

// 每一视角只能引用一张完整源；前景是同源遮挡，不请求旧上身/下身/眼发/动作供体。
// Each view has one complete source. Foreground is same-source occlusion, never old body/motion donors.
test('eighteen whole-source figures share their source between occlusion layers and never load old motion', async (t) => {
  const browser = realisticBrowser(t, false);
  const component = await loadRealisticComponent('RealisticCharacter.vue');
  const { REALISTIC_CHARACTER_IDS, realisticCharacterView } = await import('../src/realistic-character-catalog.js');
  const { realisticFigureModel } = await import('../src/realistic-character-figure.js');
  const clipIds = new Set();
  let count = 0;
  for (const id of REALISTIC_CHARACTER_IDS) for (const position of ['north', 'left', 'right']) {
    const figure = realisticFigureModel(realisticCharacterView(id, position));
    assert.ok(figure, `${id}/${position}`);
    const root = hostNode('root');
    const app = renderer.createApp(component, { character: { id, name: id }, position, enabled: true,
      action: { type: 'discard', eventKey: 'must-not-reuse-old-arm' } });
    browser.cleanups.push(() => { if (root.children.length) app.unmount(); });
    app.mount(root); await Vue.nextTick();
    const back = realisticNodes(root, (node) => node.props.class === 'realistic-figure-back');
    const front = realisticNodes(root, (node) => node.props.class === 'realistic-figure-front');
    assert.equal(back.length, 1); assert.equal(back[0].props.src, figure.url);
    assert.equal(front.length, figure.clipPolygons.length ? 1 : 0);
    if (front.length) assert.equal(front[0].props.src, back[0].props.src);
    assert.equal(realisticNodes(root, (node) => /realistic-body-(lower|upper|sleeve)|realistic-character-artwork/.test(String(node.props.class))).length, 0);
    const clip = realisticNodes(root, (node) => node.tag === 'clipPath')[0];
    assert.ok(clip); clipIds.add(clip.props.id);
    if (front.length) assert.ok(front[0].props.style.clipPath.includes(clip.props.id));
    assert.equal(browser.frames.size, 0);
    app.unmount(); count += 1;
  }
  assert.equal(count, 18); assert.ok(clipIds.size > 0);
});

// 模式开关只选展示，不包裹/替换原手牌组件；此结构断言补充稍后的真实patch交互测试。
// The switch selects presentation without gating/replacing existing hand components; this supplements real patch interaction tests.
test('App keeps original hands and action authority independent of realistic scene', () => {
  const source = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8');
  const { descriptor } = parse(source);
  const realisticTag = descriptor.template.content.match(/<RealisticTable\b[^>]*>/)?.[0];
  const chengduTag = descriptor.template.content.match(/<ChengduTable\b[^>]*>/)?.[0];
  assert.ok(realisticTag);
  assert.doesNotMatch(realisticTag, /@action=|@start=|mutate/);
  assert.match(chengduTag, /@action="mutate"/);
  assert.match(chengduTag, /v-if="isChengduRoom && game"/);
  assert.match(chengduTag, /:realistic="tablePresentation === 'realistic'"/);
  const choose = descriptor.scriptSetup.content.match(/function chooseTablePresentation\(value\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(choose);
  assert.doesNotMatch(choose, /mutate|selectedTile|state\.value|session|fetch/);
});


// 完整历史不驱动装饰；只播放App已授予的FIFO帧，挂载/相同帧/旧桌帧均不能补演。
// Full history never drives decoration: consume only App-authorized FIFO frames, never mounted/duplicate/foreign frames.
test('real table consumes only new authorized presentation frames and resets explicitly', async (t) => {
  const browser = realisticBrowser(t);
  const state = realisticFixture();
  const frame = (sequence, events, extra = {}) => ({ roomId: state.id, gameId: state.game.id, sequence, events, reset: false, ...extra });
  const mounted = await mountRealistic(t, state, { presentationFrame: frame(1, [{ type: 'discard', seat: 1, tile: 4, eventKey: 'old' }]) });
  assert.deepEqual(mounted.scope.flights, []);
  mounted.props.state.game.history = [...mounted.props.state.game.history, { type: 'discard', seat: 1, tile: 6 }];
  await Vue.nextTick();
  assert.deepEqual(mounted.scope.flights, []);
  mounted.props.presentationFrame = frame(2, [{ type: 'draw', seat: 1, tile: 17, eventKey: 'new-draw' }]);
  await Vue.nextTick();
  assert.equal(mounted.scope.flights.length, 1);
  assert.equal(mounted.scope.flights[0].hidden, true);
  assert.equal(mounted.scope.flights[0].tile, null);
  mounted.props.presentationFrame = { ...mounted.props.presentationFrame };
  await Vue.nextTick();
  assert.equal(mounted.scope.flights.length, 1);
  mounted.props.presentationFrame = frame(3, [], { reset: true });
  await Vue.nextTick();
  assert.deepEqual(mounted.scope.flights, []);
  assert.equal(browser.timers.size, 0);
  mounted.props.presentationFrame = frame(4, [{ type: 'discard', seat: 1, tile: 6, eventKey: 'foreign' }], { roomId: 'OTHER' });
  await Vue.nextTick();
  assert.deepEqual(mounted.scope.flights, []);
  mounted.props.presentationFrame = frame(5, [{ type: 'discard', seat: 1, tile: 6, eventKey: 'live' }]);
  await Vue.nextTick();
  assert.equal(mounted.scope.flights.length, 1);
  mounted.props.state.game.id = 'new-round';
  await Vue.nextTick();
  assert.deepEqual(mounted.scope.flights, []);
});

// 从真实DOM事件进入拖拽，逐个取消路径应释放捕获并回原点，而不是只改显示类名。
// Enter drag through real template handlers; each cancel path must release capture and reset coordinates, not only a CSS class.
for (const ending of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur', 'visibility', 'resize', 'observer', 'unmount']) {
  test(`real table drag resets on ${ending}`, async (t) => {
    const browser = realisticBrowser(t);
    const mounted = await mountRealistic(t);
    const viewport = realisticNodes(mounted.root, (node) => String(node.props.class).includes('realistic-viewport'))[0];
    const scope = mounted.scope;
    viewport.props.onPointerdown({ button: 0, pointerId: 4, clientX: 10, clientY: 10, target: viewport });
    viewport.props.onPointermove({ pointerId: 4, clientX: 100, clientY: 80 });
    assert.deepEqual(scope.pan, { x: 90, y: 70 });
    assert.equal(viewport.hasPointerCapture(4), true);
    if (ending.startsWith('pointer') || ending === 'lostpointercapture') {
      const key = { pointerup: 'onPointerup', pointercancel: 'onPointercancel', lostpointercapture: 'onLostpointercapture' }[ending];
      viewport.props[key]({ pointerId: 4 });
    } else if (ending === 'blur') browser.window.dispatch('blur');
    else if (ending === 'resize') browser.window.dispatch('resize');
    else if (ending === 'observer') browser.observers[0].callback([]);
    else if (ending === 'visibility') { browser.document.hidden = true; browser.document.dispatch('visibilitychange'); }
    else mounted.app.unmount();
    await Vue.nextTick();
    assert.deepEqual(scope.pan, { x: 0, y: 0 });
    assert.equal(scope.dragging, false);
    assert.equal(viewport.hasPointerCapture(4), false);
    if (ending === 'unmount') {
      assert.ok(browser.observers.every((observer) => observer.disconnected));
      assert.equal(browser.window.listeners.get('blur')?.size || 0, 0);
      assert.equal(browser.window.listeners.get('resize')?.size || 0, 0);
      assert.equal(browser.timers.size, 0);
    }
  });
}

test('reduced motion and hidden documents consume frames without delayed replay', async (t) => {
  const browser = realisticBrowser(t, true);
  const mounted = await mountRealistic(t);
  const frame = (sequence) => ({ roomId: mounted.props.state.id, gameId: mounted.props.state.game.id, sequence,
    events: [{ type: 'discard', seat: 1, tile: 16, eventKey: `event-${sequence}` }] });
  mounted.props.presentationFrame = frame(1);
  await Vue.nextTick();
  assert.deepEqual(mounted.scope.flights, []);
  browser.media.matches = false; browser.media.dispatch('change');
  mounted.props.presentationFrame = frame(1);
  await Vue.nextTick();
  assert.deepEqual(mounted.scope.flights, []);
  browser.document.hidden = true; browser.document.dispatch('visibilitychange');
  mounted.props.presentationFrame = frame(2);
  await Vue.nextTick();
  browser.document.hidden = false; browser.document.dispatch('visibilitychange');
  mounted.props.presentationFrame = frame(2);
  await Vue.nextTick();
  assert.deepEqual(mounted.scope.flights, []);
});

test('public scene exposes no action emit and hidden cards have no face metadata', async (t) => {
  realisticBrowser(t);
  const state = realisticFixture();
  state.game.players[1].winPile = [{ tile: 17, hidden: true, source: 'selfDraw' }];
  state.game.players[1].melds = [{ type: 'anGang', tile: 16, hidden: true, tiles: [16, 16, 16, 16] }];
  const mounted = await mountRealistic(t, state);
  const component = await loadRealisticComponent('RealisticTable.vue');
  assert.deepEqual(component.emits, ['next-round', 'copy-invite', 'controls-target']);
  const win = realisticNodes(mounted.root, (node) => node.props['data-win-seat'] === 1)[0];
  const serialized = JSON.stringify(realisticNodes(win, () => true).map(({ props, text }) => ({ props, text })));
  assert.doesNotMatch(serialized, /九筒|mahjong-photo/);
  assert.ok(mounted.scope.model.seats.find(({ seat }) => seat === 1).melds[0].tiles.every(({ hidden, tile }) => hidden && tile === null));
});

// 方向键平移也必须在焦点离开场景时恢复，避免Tab离开后收不到keyup而留在偏移处。
// Keyboard panning must reset when scene focus leaves, avoiding a stranded offset if Tab prevents its keyup delivery.
test('keyboard pan springs home on keyup and viewport focus loss', async (t) => {
  realisticBrowser(t);
  const mounted = await mountRealistic(t);
  const viewport = realisticNodes(mounted.root, (node) => String(node.props.class).includes('realistic-viewport'))[0];
  viewport.props.onKeydown({ key: 'ArrowRight', preventDefault() {} });
  assert.deepEqual(mounted.scope.pan, { x: 40, y: 0 });
  viewport.props.onKeyup({ key: 'ArrowRight' });
  assert.deepEqual(mounted.scope.pan, { x: 0, y: 0 });
  viewport.props.onKeydown({ key: 'ArrowLeft', preventDefault() {} });
  assert.deepEqual(mounted.scope.pan, { x: -40, y: 0 });
  assert.equal(typeof viewport.props.onBlur, 'function', 'Viewport needs its own blur reset, beyond window blur');
  viewport.props.onBlur({});
  assert.deepEqual(mounted.scope.pan, { x: 0, y: 0 });
});

// 全部视角共享斜视房间；三人换到侧家时真的出现北家，不能只换名字或裁掉对家。
// All viewpoints share the seated room; a side player's three-seat view truly gains an opposite actor, not only renamed labels.
test('real table preserves physical seats and the whole room through every viewpoint', async (t) => {
  realisticBrowser(t);
  const mounted = await mountRealistic(t);
  const expected = [
    [[0, 'south'], [2, 'right'], [1, 'left']],
    [[1, 'south'], [0, 'right'], [2, 'north']],
    [[2, 'south'], [1, 'north'], [0, 'left']],
  ];
  for (const count of [3, 4]) {
    for (let ownSeat = 0; ownSeat < count; ownSeat++) {
      const state = realisticFixture(count);
      state.you = state.game.mySeat = ownSeat;
      mounted.props.state = state;
      await Vue.nextTick();
      assert.deepEqual(mounted.scope.scene, { width: 1360, height: 1700, focusHeight: 950 });
      const planes = realisticNodes(mounted.root, (node) => node.props['data-realistic-seat'] !== undefined);
      assert.equal(planes.length, count);
      const positions = planes.map((node) => [node.props['data-realistic-seat'], node.props['data-position']]);
      if (count === 3) assert.deepEqual(positions, expected[ownSeat]);
      assert.equal(positions.find(([seat]) => seat === ownSeat)[1], 'south');
      assert.match(mounted.scope.tableProjectionStyle.transform, /^matrix3d\(/);
    }
  }
});

// 同次轮询带来的多条事件不能立刻覆盖同一人物；延迟回调也必须被后台/换局清理。
// A polled batch cannot immediately overwrite one actor; queued start callbacks are canceled with other animation timers.
test('batched actor starts follow flight order and never start after background cleanup', async (t) => {
  const browser = realisticBrowser(t);
  const mounted = await mountRealistic(t);
  mounted.props.presentationFrame = { roomId: mounted.props.state.id, gameId: mounted.props.state.game.id, sequence: 1,
    events: [{ type: 'draw', seat: 1, eventKey: 'draw' }, { type: 'discard', seat: 1, tile: 6, eventKey: 'discard' }] };
  await Vue.nextTick();
  assert.equal(mounted.scope.flights.length, 2);
  assert.equal(mounted.scope.flights[1].delay, 120);
  assert.equal(mounted.scope.characterActions[1].type, 'draw');
  browser.document.hidden = true;
  browser.document.dispatch('visibilitychange');
  assert.equal(browser.timers.size, 0);
  browser.flushTimers();
  await Vue.nextTick();
  assert.deepEqual(mounted.scope.characterActions, {});
  assert.deepEqual(mounted.scope.flights, []);
});

// 本人是第一人称位置，不能重复放正面小人；观众没有本人身份，仍可看公开南家人物。
// Self occupies a first-person viewpoint without a duplicate facing actor; spectators have no self and retain the public south actor.
test('self actor is replaced only by its approved identity-specific POV and spectators retain public actors', async (t) => {
  realisticBrowser(t);
  const { realisticCharacterView } = await import('../src/realistic-character-catalog.js');
  const { realisticPovModel } = await import('../src/realistic-character-body.js');
  const ids = ['sweet', 'elegant', 'landlord', 'honest'];
  const mounted = await mountRealistic(t, realisticFixture(4), {
    characterForPlayer: (seat) => ({ id: ids[seat], name: `合成角色${seat}`, portrait: '/synthetic.png' }),
  });
  const hasClass = (node, name) => String(node.props.class || '').split(/\s+/).includes(name);
  for (let seat = 0; seat < 4; seat++) {
    const state = realisticFixture(4);
    state.you = state.game.mySeat = seat;
    mounted.props.state = state;
    await Vue.nextTick();
    const south = realisticNodes(mounted.root, (node) => hasClass(node, 'realistic-player-south'))[0];
    assert.equal(realisticNodes(south, (node) => hasClass(node, 'realistic-character')).length, 0);
    assert.equal(realisticNodes(mounted.root, (node) => hasClass(node, 'realistic-character')).length, 3);
    const expected = realisticPovModel(realisticCharacterView(ids[seat], 'south'));
    const povs = realisticNodes(mounted.root, (node) => hasClass(node, 'realistic-self-pov'));
    assert.equal(povs.length, expected ? 1 : 0, 'missing approval never borrows another character or front-facing body');
    if (expected) {
      const image = realisticNodes(povs[0], (node) => node.tag === 'image')[0];
      assert.equal(image.props.href, expected.url);
      assert.equal(povs[0].props.viewBox, expected.viewBox);
    }
  }
  const spectator = realisticFixture(4);
  spectator.viewerRole = 'spectator'; spectator.you = null; spectator.game.mySeat = null;
  delete spectator.game.players[0].hand;
  mounted.props.state = spectator;
  await Vue.nextTick();
  assert.equal(realisticNodes(mounted.root, (node) => hasClass(node, 'realistic-self-pov')).length, 0);
  assert.equal(realisticNodes(mounted.root, (node) => hasClass(node, 'realistic-character')).length, 4);
});

// 桌下按钮产生稳定查看位置；从该位置拖拽使用当前pan，不能第一帧跳回零点再计算偏移。
// The under-table button holds its view; dragging begins at current pan rather than jumping to zero before adding movement.
test('under-table button holds framing, drags from its current pan, and resets with release or Full table', async (t) => {
  realisticBrowser(t);
  const { clampRealisticScenePan } = await import('../src/realistic-table-perspective.js');
  const mounted = await mountRealistic(t);
  const textOf = (node) => node.text + node.children.map(textOf).join('');
  const button = (text) => realisticNodes(mounted.root, (node) => node.tag === 'button' && textOf(node) === text)[0];
  const viewport = realisticNodes(mounted.root, (node) => String(node.props.class).includes('realistic-viewport'))[0];
  const controls = realisticNodes(mounted.root, (node) => node.props.id === 'realistic-private-controls')[0];
  button('桌下').props.onClick();
  await Vue.nextTick();
  const under = { ...mounted.scope.pan };
  assert.ok(under.y < 0);
  assert.equal(mounted.scope.dragging, false);
  button('桌下').props.onClick();
  await Vue.nextTick();
  assert.deepEqual(mounted.scope.pan, under, 'repeated under-table clicks are idempotent');
  mounted.props.state.game.revision++;
  await Vue.nextTick();
  assert.deepEqual(mounted.scope.pan, under, 'ordinary snapshot updates do not cancel the stable view');
  viewport.props.onPointerdown({ button: 0, pointerId: 24, clientX: 50, clientY: 100, target: viewport });
  viewport.props.onPointermove({ pointerId: 24, clientX: 80, clientY: 180 });
  assert.deepEqual(mounted.scope.pan, clampRealisticScenePan({ x: under.x + 30, y: under.y + 80 }, 900, 700, mounted.scope.zoom));
  assert.equal(viewport.hasPointerCapture(24), true);
  viewport.props.onPointerup({ pointerId: 24 });
  await Vue.nextTick();
  assert.deepEqual(mounted.scope.pan, { x: 0, y: 0 });
  assert.equal(viewport.hasPointerCapture(24), false);
  mounted.scope.zoom = 2;
  await Vue.nextTick();
  button('桌下').props.onClick();
  await Vue.nextTick();
  button('全桌').props.onClick();
  await Vue.nextTick();
  assert.equal(mounted.scope.zoom, 1);
  assert.deepEqual(mounted.scope.pan, { x: 0, y: 0 });
  assert.equal(realisticNodes(mounted.root, (node) => node.props.id === 'realistic-private-controls')[0], controls, 'camera changes preserve the live Teleport destination');
});

// 查看中resize或私有键盘/触摸交互不得复制目标或抢走原生横滚；viewport pan只响应场景输入。
// Resize keeps the live target; private keyboard/touch input retains native scrolling rather than becoming a scene drag.
test('under-table resize resets camera without replacing controls and private input does not pan', async (t) => {
  const browser = realisticBrowser(t);
  const mounted = await mountRealistic(t);
  const controls = realisticNodes(mounted.root, (node) => node.props.id === 'realistic-private-controls')[0];
  const viewport = realisticNodes(mounted.root, (node) => String(node.props.class).includes('realistic-viewport'))[0];
  mounted.scope.viewUnderTable();
  assert.ok(mounted.scope.pan.y < 0);
  browser.observers[0].callback([]);
  await Vue.nextTick();
  assert.deepEqual(mounted.scope.pan, { x: 0, y: 0 });
  assert.equal(realisticNodes(mounted.root, (node) => node.props.id === 'realistic-private-controls')[0], controls);
  const privateTarget = { closest: () => controls };
  let prevented = false;
  viewport.props.onKeydown({ key: 'ArrowRight', target: privateTarget, preventDefault() { prevented = true; } });
  viewport.props.onPointerdown({ button: 0, pointerId: 44, clientX: 0, clientY: 0, target: privateTarget });
  viewport.props.onPointermove({ pointerId: 44, clientX: 100, clientY: 100 });
  assert.equal(prevented, false, 'private arrow keys remain native');
  assert.equal(viewport.hasPointerCapture(44), false);
  assert.deepEqual(mounted.scope.pan, { x: 0, y: 0 });
});

// 浏览器选字/拖图与场景平移互斥；右键同样支持，但私有控件必须保留默认手势。
// Native selection/image dragging is exclusive with panning; right drag works without stealing private-control gestures.
test('scene pan prevents native selection for both mouse buttons while preserving private controls', async (t) => {
  realisticBrowser(t);
  const mounted = await mountRealistic(t, realisticFixture(), { hasPrivateControls: true });
  const viewport = realisticNodes(mounted.root, (node) => String(node.props.class).includes('realistic-viewport'))[0];
  for (const button of [0, 2]) {
    let prevented = 0;
    viewport.props.onPointerdown({ button, pointerId: 71, clientX: 0, clientY: 0, target: viewport, preventDefault() { prevented += 1; } });
    assert.equal(prevented, 1);
    viewport.props.onPointermove({ pointerId: 71, clientX: 20, clientY: 30 });
    assert.deepEqual(mounted.scope.pan, { x: 20, y: 30 });
    viewport.props.onPointerup({ pointerId: 71 });
  }
  for (const eventName of ['onDragstart', 'onSelectstart', 'onContextmenu']) {
    let prevented = 0;
    viewport.props[eventName]({ target: viewport, preventDefault() { prevented += 1; } });
    assert.equal(prevented, 1);
    viewport.props[eventName]({ target: { closest: () => ({}) }, preventDefault() { prevented += 1; } });
    assert.equal(prevented, 1, 'Private controls keep native gestures');
  }
});

// 对手暗手只能竖立背牌；终局公开牌仍平摊，不能把姿态开关当成看牌权限。
// Opponent concealed racks stand upright; public terminal hands stay flat, and posture never grants visibility.
test('only concealed hand racks stand upright, never rivers or exposed tiles', async (t) => {
  realisticBrowser(t);
  const mounted = await mountRealistic(t, realisticFixture(), { hasPrivateControls: true });
  const hands = realisticNodes(mounted.root, (node) => String(node.props.class).includes('realistic-hand-zone'));
  assert.ok(hands.length > 0);
  for (const hand of hands) {
    const tiles = realisticNodes(hand, (node) => String(node.props.class).includes('realistic-solid-tile'));
    assert.ok(tiles.length > 0);
    assert.ok(tiles.every((node) => String(node.props.class).includes('is-upright')));
    assert.equal(realisticNodes(hand, (node) => String(node.props.class).includes('tile-photo-face')).length, 0);
  }
});
