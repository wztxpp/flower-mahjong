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

// 实际Vue包装只拥有视图选择，不能让专注/视角/弹层改变输入牌局。
// The actual Vue wrapper owns presentation choices, never gameplay state.
test('Three wrapper keeps controls mounted across view and focus changes', async (t) => {
  realisticBrowser(t);
  const state = realisticFixture();
  const original = structuredClone(state);
  const mounted = await mountRealistic(t, state, { hasPrivateControls: true });
  const target = realisticNodes(mounted.root, (node) => node.props.id === 'realistic-private-controls')[0];
  assert.ok(target?.isConnected);
  mounted.scope.setView('top');
  mounted.scope.setFocus(true);
  mounted.scope.setView('left');
  assert.equal(mounted.scope.activeView, 'top', 'focus locks camera selection');
  mounted.scope.onKey({ key: 'Escape' });
  assert.equal(mounted.scope.focused, false);
  mounted.scope.showDetails = true;
  await Vue.nextTick();
  assert.equal(realisticNodes(mounted.root, (node) => node.props.id === 'realistic-private-controls')[0], target);
  assert.deepEqual(state, original);
  mounted.app.unmount();
  assert.equal(target.isConnected, false);
});

// 真实公开详情组件受投影守卫控制；隐藏牌种不同也不能影响牌面或可访问文字。
// Actual detail markup follows privacy projection; concealed identities cannot affect faces or accessible text.
test('public Three detail DOM never reveals opponent identities or emits actions', async (t) => {
  realisticBrowser(t);
  const state = realisticFixture();
  state.game.players[1].hand = [17, 16];
  state.game.players[1].winPile = [{ tile: 17, hidden: true, source: 'selfDraw' }];
  const mounted = await mountRealistic(t, state);
  mounted.scope.showDetails = true;
  await Vue.nextTick();
  const snapshot = () => realisticNodes(mounted.root, () => true).map((node) => ({ tag: node.tag, text: node.text, title: node.props.title, label: node.props['aria-label'], href: node.props.href }));
  const before = snapshot();
  mounted.props.state.game.players[1].hand = [0, 1];
  mounted.props.state.game.players[1].winPile[0].tile = 0;
  await Vue.nextTick();
  assert.deepEqual(snapshot(), before);
  const opponent = mounted.scope.model.seats.find((seat) => seat.seat === 1);
  assert.ok(opponent.hand.every((tile) => tile.hidden && tile.tile === null));
  assert.equal(opponent.wins[0].tile, null);
  assert.deepEqual(mounted.instance.$options.emits, ['next-round', 'copy-invite', 'controls-target', 'fallback']);
});

// 卸载和异步失败后仍成对清理监听，旧装载不得复活画布。
// Teardown pairs listeners and guards late async loads from reviving a canvas.
test('Three wrapper cleans listeners and explicitly guards late imports', async (t) => {
  const browser = realisticBrowser(t);
  const mounted = await mountRealistic(t);
  assert.equal(browser.document.listeners.get('keydown').size, 1);
  assert.equal(browser.media.listeners.get('change').size, 1);
  mounted.app.unmount();
  assert.equal(browser.document.listeners.get('keydown').size, 0);
  assert.equal(browser.document.listeners.get('pointerdown').size, 0);
  assert.equal(browser.media.listeners.get('change').size, 0);
  const source = readFileSync(new URL('../src/RealisticTable.vue', import.meta.url), 'utf8');
  assert.match(source, /if \(disposed\) return/);
  assert.match(source, /renderer\?\.dispose\(\)/);
  assert.match(source, /createFrameGate\(props.presentationFrame\?\.sequence/);
});
