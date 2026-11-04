import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Vue from 'vue';
import * as CharacterAudioModule from '../src/character-audio.js';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';

// Compile the shipped SFCs, as ui.test.js does. A small in-memory Vue renderer
// exercises real button handlers and template refs without a browser, clipboard,
// API requests, or a parallel presentation model.
function compileComponent(filename, dependencies = {}) {
  const { descriptor } = parse(readFileSync(new URL(`../src/${filename}`, import.meta.url), 'utf8'));
  const script = compileScript(descriptor, { id: filename });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings, hoistStatic: false } });
  assert.deepEqual(template.errors, []);
  const modules = { vue: { ...Vue, onMounted() {}, onUnmounted() {} }, ...dependencies };
  const load = code => code
    .replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g, (_, bindings, module) => `const {${bindings.replace(/\s+as\s+/g, ':')}} = modules[${JSON.stringify(module)}];`)
    .replace(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g, (_, binding, module) => `const ${binding} = modules[${JSON.stringify(module)}];`);
  const component = new Function('modules', load(script.content).replace('export default', 'return'))(modules);
  component.render = new Function('modules', `${load(template.code).replace('export function render', 'function render')}\nreturn render;`)(modules);
  return component;
}
const Tile = compileComponent('MahjongTile.vue');
const Icon = compileComponent('Icon.vue');
const App = compileComponent('App.vue', { './MahjongTile.vue': Tile, './Icon.vue': Icon, './character-audio.js': CharacterAudioModule });
const originalDescriptors = Object.fromEntries(['window', 'document', 'navigator', 'sessionStorage', 'localStorage', 'fetch', 'setTimeout', 'clearTimeout'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const mounted = [];
const PUBLIC_ORIGIN = 'https://flower-mahjong-wztxpp.squaresong.chatgpt.site';
const ROOM_A = 'ABCDEF23';
const ROOM_B = 'GHJKLM23';
const TOKEN = 'b'.repeat(64);
const PROFILE = 'a'.repeat(64);
const findAll = (node, predicate) => [node, ...(node.children || []).flatMap(child => findAll(child, predicate))].filter(predicate);
const textOf = node => node.text + node.children.map(textOf).join('');
function hostNode(tag, text = '') {
  return {
    tag, text, children: [], parent: null, props: {}, selectionStart: 0, selectionEnd: 0,
    addEventListener() {}, removeEventListener() {},
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      return findAll(this, node => selector.split(',').some(part => part.trim() === node.tag || (part.trim() === '[tabindex="0"]' && node.props.tabindex === '0')));
    },
    focus() { document.activeElement = this; this.props.onFocus?.({ target: this }); },
    select() { this.selectionStart = 0; this.selectionEnd = String(this.props.value || '').length; },
    blur() { if (document.activeElement === this) document.activeElement = null; },
  };
}
const renderer = Vue.createRenderer({
  createElement: tag => hostNode(tag),
  createText: text => hostNode('#text', text),
  createComment: text => hostNode('#comment', text),
  setText: (node, text) => { node.text = text; },
  setElementText: (node, text) => { node.text = text; node.children = []; },
  parentNode: node => node.parent,
  nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
  patchProp: (node, key, before, value) => { node.props[key] = value; },
  insert(node, parent, anchor = null) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index < 0) parent.children.push(node); else parent.children.splice(index, 0, node);
  },
  remove(node) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
});
function setup({ url = `${PUBLIC_ORIGIN}/?room=OLDROOM2&token=do-not-share&tracking=old#private`, writeText = async () => {}, userAgent = 'Desktop test' } = {}) {
  const timers = [];
  const setLocation = value => { const next = new URL(value, PUBLIC_ORIGIN); Object.assign(window.location, { href: next.href, origin: next.origin, pathname: next.pathname, search: next.search, hash: next.hash }); };
  globalThis.window = { location: {}, history: { replaceState(a, b, value) { setLocation(value); }, pushState(a, b, value) { setLocation(value); } }, addEventListener() {}, removeEventListener() {} };
  setLocation(url);
  globalThis.document = { body: { style: {} }, activeElement: hostNode('button'), hidden: false, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: writeText === null ? undefined : { writeText }, userAgent } });
  const storage = () => { const items = new Map(); return { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key) }; };
  window.sessionStorage = globalThis.sessionStorage = storage();
  window.localStorage = globalThis.localStorage = storage();
  globalThis.fetch = () => { throw new Error('Invitation tests must not make network requests'); };
  globalThis.setTimeout = (callback, delay) => { timers.push({ callback, delay, cancelled: false }); return timers.length; };
  globalThis.clearTimeout = id => { if (timers[id - 1]) timers[id - 1].cancelled = true; };
  let scope;
  const app = renderer.createApp({ ...App, setup(props, context) {
    scope = App.setup(props, context);
    scope.session.value = { roomId: ROOM_A, token: TOKEN, name: '房主' };
    scope.playerToken.value = PROFILE;
    scope.state.value = { id: ROOM_A, revision: 1, phase: 'lobby', you: 0, hostSeat: 0, seats: [{ seat: 0, name: '房主', connected: true }], game: null };
    return scope;
  } });
  const root = hostNode('root'); app.mount(root); mounted.push(app);
  const buttons = () => findAll(root, node => node.tag === 'button' && /复制邀请|复制链接，邀请朋友|邀请链接已复制|^已复制$/.test(textOf(node)));
  const input = () => findAll(root, node => node.tag === 'input' && node.props.id === 'invite-link')[0];
  return { scope, root, timers, setLocation, buttons, input };
}
async function settle() { for (let i = 0; i < 5; i++) await Vue.nextTick(); }
afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount();
  for (const [key, descriptor] of Object.entries(originalDescriptors)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
});

test('all three invitation buttons copy the full public URL with only the current room', async () => {
  const writes = []; const { scope, buttons } = setup({ writeText: async value => writes.push(value) });
  assert.equal(buttons().length, 3);
  for (const button of buttons()) await button.props.onClick();
  assert.deepEqual(writes, Array(3).fill(`${PUBLIC_ORIGIN}/?room=${ROOM_A}`));
  for (const text of writes) {
    assert.deepEqual([...new URL(text).searchParams], [['room', ROOM_A]]);
    assert.equal(new URL(text).hash, '');
    assert.equal(text.includes(TOKEN) || text.includes(PROFILE), false);
  }
  assert.equal(scope.copyDone.value, true);
});

test('invitation URL preserves the current origin and deployment path', async () => {
  const writes = []; const { scope } = setup({ url: 'https://another.example/mahjong/play?room=OLDROOM2&token=secret#old', writeText: async value => writes.push(value) });
  await scope.copyInvite();
  assert.deepEqual(writes, [`https://another.example/mahjong/play?room=${ROOM_A}`]);
});

test('current authoritative room wins over old URL and old saved session, and updates reactively', async () => {
  const writes = []; const { scope } = setup({ writeText: async value => writes.push(value) });
  await scope.copyInvite();
  scope.state.value = { ...scope.state.value, id: ROOM_B };
  await scope.copyInvite();
  assert.deepEqual(writes, [`${PUBLIC_ORIGIN}/?room=${ROOM_A}`, `${PUBLIC_ORIGIN}/?room=${ROOM_B}`]);
});

test('session room is used if authoritative room state is not available', () => {
  const { scope } = setup(); scope.state.value = null;
  assert.equal(scope.shareUrl.value, `${PUBLIC_ORIGIN}/?room=${ROOM_A}`);
  scope.session.value = { ...scope.session.value, roomId: ROOM_B };
  assert.equal(scope.shareUrl.value, `${PUBLIC_ORIGIN}/?room=${ROOM_B}`);
});

test('copy success waits for clipboard completion and expires after 2.5 seconds', async () => {
  let finish; const { scope, timers } = setup({ writeText: () => new Promise(resolve => { finish = resolve; }) });
  const copying = scope.copyInvite();
  assert.equal(scope.copyDone.value, false); assert.equal(scope.showInvite.value, false);
  finish(); await copying;
  assert.equal(scope.copyDone.value, true);
  assert.equal(timers.at(-1).delay, 2500); timers.at(-1).callback();
  assert.equal(scope.copyDone.value, false);
});

test('repeat success restarts the copied indicator lifetime', async () => {
  const { scope, timers } = setup(); await scope.copyInvite(); const first = timers.at(-1);
  await scope.copyInvite(); assert.equal(first.cancelled, true); assert.equal(scope.copyDone.value, true);
  timers.at(-1).callback(); assert.equal(scope.copyDone.value, false);
});

for (const [name, writeText, userAgent] of [
  ['rejected clipboard', async () => { throw new Error('NotAllowedError'); }, 'Desktop test'],
  ['missing clipboard API with a phone user agent', null, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'],
]) {
  test(`${name} shows the exact link in a read-only manual-copy field`, async () => {
    const { scope, root, input } = setup({ writeText, userAgent });
    await scope.copyInvite(); await settle();
    assert.equal(scope.copyDone.value, false); assert.equal(scope.showInvite.value, true);
    assert.match(textOf(root), /浏览器未允许自动复制，请选中下方链接并复制/);
    assert.equal(input().props.value, `${PUBLIC_ORIGIN}/?room=${ROOM_A}`);
    assert.ok(input().props.readonly === '' || input().props.readonly === true);
    assert.equal(input().selectionStart, 0); assert.equal(input().selectionEnd, input().props.value.length);
    input().selectionEnd = 0; input().focus(); assert.equal(input().selectionEnd, input().props.value.length);
  });
  test(`${name} leaves focus on the selected manual-copy field`, async () => {
    const { scope, input } = setup({ writeText, userAgent });
    await scope.copyInvite(); await settle();
    assert.equal(document.activeElement?.props.id, 'invite-link', 'The dialog close button must not steal focus after the input is selected');
    assert.equal(input().selectionEnd, input().props.value.length);
  });
}

test('a failed retry clears any previous success indicator', async () => {
  let reject = false; const { scope } = setup({ writeText: async () => { if (reject) throw new Error('NotAllowedError'); } });
  await scope.copyInvite(); assert.equal(scope.copyDone.value, true);
  reject = true; await scope.copyInvite(); await settle();
  assert.equal(scope.showInvite.value, true);
  assert.equal(scope.copyDone.value, false, 'The failed attempt must not retain an earlier copied label');
});

test('leaving the room clears copied state and ignores a delayed clipboard success', async () => {
  let finish; const { scope, timers } = setup({ writeText: () => new Promise(resolve => { finish = resolve; }) });
  const copying = scope.copyInvite(); scope.resetRoomContext(); finish(); await copying; await settle();
  assert.equal(scope.copyDone.value, false); assert.equal(scope.showInvite.value, false);
  assert.equal(timers.filter(timer => !timer.cancelled && timer.delay === 2500).length, 0);
});

test('leaving the room ignores a delayed clipboard failure and never reopens the dialog', async () => {
  let fail; const { scope } = setup({ writeText: () => new Promise((resolve, reject) => { fail = reject; }) });
  const copying = scope.copyInvite(); scope.resetRoomContext(); fail(new Error('NotAllowedError')); await copying; await settle();
  assert.equal(scope.copyDone.value, false); assert.equal(scope.showInvite.value, false);
});

test('a successful copy indicator is reset when the room context changes', async () => {
  const { scope, timers } = setup(); await scope.copyInvite(); const indicator = timers.at(-1);
  scope.resetRoomContext(); await settle();
  assert.equal(scope.copyDone.value, false); assert.equal(indicator.cancelled, true);
});

// Ordinary room actions also advance the request epoch, but are not a navigation.
test('ordinary room actions do not leave the copied indicator stuck indefinitely', async () => {
  const { scope, timers } = setup(); await scope.copyInvite(); const indicator = timers.at(-1);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ state: { ...scope.state.value, revision: 2 } }) });
  await scope.mutate({}, true);
  indicator.callback();
  assert.equal(scope.copyDone.value, false, 'Copy feedback must expire even when starting or playing a hand advances the request epoch');
});
