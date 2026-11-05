import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Vue from 'vue';
import * as CharacterAudioModule from '../src/character-audio.js';
import * as Renderer from 'vue/server-renderer';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { getPlayerView } from '../shared/game.js';
import { postHuKongGame } from './fixtures/post-hu-kong.js';

// Compile the actual SFCs so these checks exercise the shipped template and setup,
// rather than maintaining a separate presentation model in the tests.
function compileComponent(filename, dependencies = {}) {
  const { descriptor } = parse(readFileSync(new URL(`../src/${filename}`, import.meta.url), 'utf8'));
  const script = compileScript(descriptor, { id: filename });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: filename, ssr: true, ssrCssVars: [], compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  const modules = { vue: { ...Vue, onMounted() {}, onUnmounted() {} }, 'vue/server-renderer': Renderer, ...dependencies };
  const load = code => code
    .replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g, (_, bindings, module) => `const {${bindings.replace(/\s+as\s+/g, ':')}} = modules[${JSON.stringify(module)}];`)
    .replace(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g, (_, binding, module) => `const ${binding} = modules[${JSON.stringify(module)}];`);
  const component = new Function('modules', load(script.content).replace('export default', 'return'))(modules);
  component.ssrRender = new Function('modules', `${load(template.code).replace('export function ssrRender', 'function ssrRender')}\nreturn ssrRender;`)(modules);
  return component;
}
const Tile = compileComponent('MahjongTile.vue');
const Icon = compileComponent('Icon.vue');
const App = compileComponent('App.vue', { './MahjongTile.vue': Tile, './Icon.vue': Icon, './character-audio.js': CharacterAudioModule });
const originals = Object.fromEntries(['window', 'document', 'sessionStorage', 'localStorage', 'fetch', 'setTimeout', 'clearTimeout'].map(key => [key, globalThis[key]]));
let scheduled = [];
function browser({ search = '', active = null, rooms = null, profile = 'a'.repeat(64), blocked = false, malformed = false } = {}) {
  scheduled = [];
  const sessionItems = new Map(); const localItems = new Map();
  const storage = items => ({ getItem(key) { if (blocked) throw new Error('Storage blocked'); return items.get(key) ?? null; }, setItem(key, value) { if (blocked) throw new Error('Storage blocked'); items.set(key, value); }, removeItem(key) { if (blocked) throw new Error('Storage blocked'); items.delete(key); } });
  if (active) sessionItems.set('huajian-mahjong-session-v1', JSON.stringify(active));
  if (rooms) sessionItems.set('huajian-mahjong-rooms-v2', JSON.stringify(rooms));
  if (malformed) sessionItems.set('huajian-mahjong-session-v1', '{bad json');
  if (profile) localItems.set('huajian-mahjong-player-v1', JSON.stringify(profile));
  const events = new Map();
  const setLocation = value => { const url = new URL(value, 'https://example.test'); Object.assign(globalThis.window.location, { search: url.search, href: url.href, origin: url.origin, pathname: url.pathname }); };
  globalThis.window = { location: {}, history: { replaceState(a, b, url) { setLocation(url); }, pushState(a, b, url) { setLocation(url); } }, addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name) { events.delete(name); } };
  setLocation(`https://example.test/play${search}`);
  globalThis.document = { hidden: false, body: { style: {} }, activeElement: { blur() {} }, addEventListener() {}, removeEventListener() {} };
  globalThis.sessionStorage = window.sessionStorage = storage(sessionItems);
  globalThis.localStorage = window.localStorage = storage(localItems);
  globalThis.setTimeout = (callback, delay) => { scheduled.push({ callback, delay, cancelled: false }); return scheduled.length; };
  globalThis.clearTimeout = id => { if (scheduled[id - 1]) scheduled[id - 1].cancelled = true; };
  return { sessionItems, localItems, setLocation, events };
}
const credential = (roomId = 'ABCDEF23', token = 'b'.repeat(64)) => ({ roomId, token, name: '本人的名字' });
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const emptyHistory = () => ({ summary: { settledGames: 0, totalScore: 0 }, records: [] });
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function lobby() { return App.setup({}, { expose() {} }); }
function fixture({ legacy = false, postHu = false, schemaVersion = legacy ? 1 : 2 } = {}) {
  const players = [0, 1, 2].map(seat => ({ seat, handCount: 13, huCount: 0, score: 0, hand: seat === 0 ? [0, 1, 2, 3] : undefined, melds: [], radishes: [], winPile: [] }));
  if (postHu) { players[0].huCount = 1; players[0].winPile = [{ tile: 3, source: 'discard', virtual: false }]; }
  return { id: 'ABCDEF23', revision: 3, you: 0, hostSeat: 0, phase: 'playing', seats: players.map(player => ({ seat: player.seat, name: `牌友${player.seat + 1}`, connected: true })), game: { schemaVersion, players, phase: 'turn', turnStep: legacy ? 'draw' : 'discard', currentSeat: 0, drawnTile: legacy ? null : 3, wallCount: 70, discards: [], history: [], lockedWaits: [], legalActions: legacy ? [{ type: 'draw' }] : postHu ? [{ type: 'hu' }, { type: 'pass' }, { type: 'discard', tile: 3 }] : [{ type: 'discard', tile: 0 }], huDiagnostic: { canHu: postHu, code: postHu ? 'AVAILABLE' : 'SHAPE', message: postHu ? '当前可以胡牌。' : '当前牌型还不满足胡牌条件。' } } };
}
function setup(state) {
  browser();
  const scope = App.setup({}, { expose() {} });
  scope.session.value = credential();
  scope.state.value = state;
  return scope;
}
async function render(scope) { return Renderer.renderToString(Vue.createSSRApp({ ...App, setup: () => scope })); }

after(() => { for (const [key, value] of Object.entries(originals)) globalThis[key] = value; });

test('new board uses frozen-hand decisions, a visible win pile and own private diagnostic', async () => {
  const scope = setup(fixture({ postHu: true }));
  scope.state.value.game.players[1].winPile = [{ tile: 16, source: 'discard', virtual: true }];
  const html = await render(scope);
  assert.match(html, /胡后固定/);
  assert.match(html, /不胡 \/ 过 · 打出新牌/);
  assert.match(html, /共胡记牌，不另算实物牌/);
  assert.match(html, /查看当前胡牌判断|当前可以胡牌/);
  assert.match(html, /仅自己可见/);
  assert.doesNotMatch(html, /选牌后打出|摸一张/);
});

test('legacy board keeps draw control and switches tables in the same tab', async () => {
  const scope = setup(fixture({ legacy: true }));
  const html = await render(scope);
  assert.match(html, /本桌已开局，继续使用旧规则/);
  assert.match(html, /离开旧桌，返回大厅换新桌/);
  assert.doesNotMatch(html, /target="_blank"/);
  assert.match(html, /摸一张/);
  assert.doesNotMatch(html, /胡后固定|查看当前胡牌判断/);
  scope.showRules.value = true;
  const rules = await render(scope);
  assert.match(rules, /本桌旧规则/);
  assert.doesNotMatch(rules, /三个牌区，每次胡都重算番/);
});

test('radish total differs from the latest increment, and fifth kong retains five tiles', async () => {
  const state = fixture();
  state.game.players[0].radishes = [0, 1, 2, 3, 4, 5, 6, 7];
  state.game.players[0].melds = [{ type: 'buGang', tiles: [3, 3, 3, 3, 3] }];
  state.game.history = [{ revision: 1, type: 'anGang', seat: 0, radish: 1, message: '暗杠' }, { revision: 2, type: 'hu', seat: 0, newRadishes: [2, 3, 4, 5, 6, 7], message: '胡' }];
  const scope = setup(state);
  const html = await render(scope);
  assert.match(html, /共 8 张/);
  assert.match(html, /首胡 \+6/);
  assert.match(html, /补杠 · 5 张/);
  assert.equal(scope.radishIncrement(0), 6);
  assert.match(scope.scoreSummary({ fan: 5, fanPoints: 10, radishBonus: 4, dragonBonus: 0, total: 14 }), /5 番 10 分 \+ 萝卜 4/);
});

test('all-player hu ends distinctly and compact new rules contain confirmed fan values', async () => {
  const state = fixture(); state.phase = 'finished'; state.game.phase = 'finished'; state.game.finishReason = 'allPlayersHu'; state.game.legalActions = [];
  const scope = setup(state); scope.showRules.value = true;
  const html = await render(scope);
  assert.match(html, /三家都胡了，本局结束/);
  assert.match(html, /5 番 10 分 · 6 番 12 分 · 7 番 14 分/);
  assert.match(html, /暂不叠加番分、萝卜和神龙/);
});

test('eight circles has eight explicitly black marks, and bamboo one is a bird', async () => {
  const circles = await Renderer.renderToString(Vue.createSSRApp(Tile, { tile: 16 }));
  assert.equal((circles.match(/class="tile-ink-black"/g) || []).length, 8);
  assert.doesNotMatch(circles, /class="tile-ink-red"|class="tile-ink-green"/);
  assert.match(circles, /aria-label="8筒"/);
  const bamboo = await Renderer.renderToString(Vue.createSSRApp(Tile, { tile: 0 }));
  assert.match(bamboo, /class="bamboo-bird"/);
});

test('unchanged polling preserves the hand snapshot and only applies connection flags', async () => {
  const scope = setup(fixture()); const gameBefore = scope.state.value.game;
  let requested;
  globalThis.fetch = async url => { requested = url; return { ok: true, json: async () => ({ unchanged: true, revision: 3, connections: [true, false, true] }) }; };
  await scope.refresh();
  assert.equal(requested, '/api/rooms/ABCDEF23?since=3');
  assert.equal(scope.state.value.game, gameBefore);
  assert.equal(scope.seats.value[1].connected, false);
  assert.ok(scheduled.at(-1).delay >= 80 && scheduled.at(-1).delay <= 350);
  globalThis.document.hidden = true;
  assert.equal(scope.pollInterval(), 3000);
});

test('successful action uses its authoritative response without a second GET', async () => {
  const scope = setup(fixture()); const calls = [];
  const next = fixture(); next.revision = 4; next.game.currentSeat = 1;
  globalThis.fetch = async (url, options) => { calls.push({ url, method: options.method }); return { ok: true, json: async () => ({ state: next }) }; };
  await scope.mutate({ type: 'discard', tile: 0 });
  assert.deepEqual(calls.map(call => call.method), ['POST']);
  assert.equal(scope.state.value.revision, 4);
  assert.equal(scope.game.value.currentSeat, 1);
  assert.equal(scope.busy.value, false);
});

test('revision conflicts synchronise before allowing another action', async () => {
  const scope = setup(fixture()); const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(options.method);
    if (options.method === 'POST') return { ok: false, status: 409, json: async () => ({ error: 'stale' }) };
    assert.equal(scope.syncing.value, true);
    await scope.mutate({ type: 'discard', tile: 0 });
    const next = fixture(); next.revision = 4;
    return { ok: true, json: async () => ({ state: next }) };
  };
  await scope.mutate({ type: 'discard', tile: 0 });
  assert.deepEqual(calls, ['POST', 'GET']);
  assert.equal(scope.syncing.value, false);
  assert.equal(scope.state.value.revision, 4);
});


test('unchanged partial-lobby response ignores empty seats without entering offline state', async () => {
  const state = fixture(); state.phase = 'lobby'; state.game = null; state.seats = [state.seats[0], null, null];
  const scope = setup(state);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ unchanged: true, revision: 3, connections: [true, false, false] }) });
  await scope.refresh();
  assert.equal(scope.offline.value, false);
  assert.equal(scope.filledSeats.value, 1);
  assert.ok(scheduled.at(-1).delay > 900 && scheduled.at(-1).delay <= 1000);
});


test('overlapping refresh attempts never issue overlapping GET requests', async () => {
  const scope = setup(fixture()); let release; let reads = 0;
  globalThis.fetch = () => { reads++; return new Promise(resolve => { release = resolve; }); };
  const first = scope.refresh();
  await scope.refresh();
  assert.equal(reads, 1);
  release({ ok: true, json: async () => ({ unchanged: true, revision: 3, connections: [true, true, true] }) });
  await first;
  assert.equal(scope.offline.value, false);
});

test('uncertain action outcome is read back, never automatically repeated', async () => {
  const scope = setup(fixture()); const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(options.method);
    if (options.method === 'POST') throw new TypeError('network failed after submission');
    assert.equal(scope.syncing.value, true);
    const next = fixture(); next.revision = 4; next.game.currentSeat = 1;
    return { ok: true, json: async () => ({ state: next }) };
  };
  await scope.mutate({ type: 'discard', tile: 0 });
  assert.deepEqual(calls, ['POST', 'GET']);
  assert.equal(scope.offline.value, false);
  assert.equal(scope.syncing.value, false);
  assert.equal(scope.game.value.currentSeat, 1);
  assert.equal(scope.error.value, '牌局已同步，请查看最新牌面后继续。');
});

test('root with a saved legacy session renders the lobby immediately, never resumes or polls it', async () => {
  const storage = browser({ active: credential() }); const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return response(url === '/api/profile' ? { playerToken: 'a'.repeat(64) } : url.endsWith('/history') ? emptyHistory() : { left: true }); };
  const scope = lobby(); await scope.initialize();
  assert.equal(scope.inRoom.value, false); assert.equal(scope.restoring.value, false); assert.equal(scope.busy.value, false);
  await settle();
  assert.deepEqual(calls.map(call => call.url), ['/api/profile', '/api/rooms/ABCDEF23/leave', '/api/profile/history']);
  assert.equal(scope.session.value, null); assert.equal(scope.roomCode.value, '');
  assert.equal(storage.sessionItems.has('huajian-mahjong-session-v1'), false);
  assert.equal(JSON.parse(storage.sessionItems.get('huajian-mahjong-rooms-v2')).ABCDEF23.token, credential().token);
  const html = await render(scope); assert.match(html, /创建一张牌桌/); assert.doesNotMatch(html, /恢复上一桌|正在回到牌桌/);
});

test('an invitation for B takes precedence over the saved active A, with no accidental A resume', async () => {
  browser({ active: credential(), search: '?room=GHJKLM23' }); const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return response(url === '/api/profile' ? { playerToken: 'a'.repeat(64) } : url.endsWith('/history') ? emptyHistory() : { left: true }); };
  const scope = lobby(); await scope.initialize(); await settle();
  assert.equal(scope.entryMode.value, 'join'); assert.equal(scope.roomCode.value, 'GHJKLM23'); assert.equal(scope.inRoom.value, false);
  assert.equal(calls.filter(call => call.url.includes('/resume')).length, 0);
  assert.deepEqual(calls.filter(call => call.url.includes('/rooms/')).map(call => call.url), ['/api/rooms/ABCDEF23/leave']);
  scope.name.value = '另一名字';
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); const state = fixture(); state.id = 'GHJKLM23'; return response({ roomId: state.id, token: 'c'.repeat(64), state }); };
  await scope.enterRoom(); assert.equal(scope.session.value.roomId, 'GHJKLM23'); assert.equal(window.location.search, '?room=GHJKLM23');
  assert.equal(calls.at(-1).options.headers.Authorization, undefined);
});

test('explicit same-room refresh resumes only its exact stored seat token', async () => {
  const correct = credential(); const wrong = credential('GHJKLM23', 'c'.repeat(64));
  browser({ active: wrong, rooms: { ABCDEF23: correct, GHJKLM23: wrong }, search: '?room=abcdef23' }); const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return response(url === '/api/profile' ? { playerToken: 'a'.repeat(64) } : url.endsWith('/resume') ? { state: fixture() } : { left: true }); };
  const scope = lobby(); await scope.initialize(); await settle();
  assert.equal(scope.inRoom.value, true); assert.equal(scope.session.value.token, correct.token);
  assert.deepEqual(calls.filter(call => call.url !== '/api/profile').map(call => call.url), ['/api/rooms/GHJKLM23/leave', '/api/rooms/ABCDEF23/resume']);
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${wrong.token}`);
  assert.equal(calls[2].options.headers.Authorization, `Bearer ${correct.token}`);
});

test('returning to the lobby closes overlays, releases focus, resets controls, and retains only explicit reconnect credentials', async () => {
  const scope = setup(fixture()); scope.playerToken.value = 'a'.repeat(64); scope.saveSession(credential());
  let blurred = false; document.activeElement = { blur() { blurred = true; } }; document.body.style.overflow = 'hidden';
  scope.showRules.value = true; scope.showInvite.value = true; scope.copyDone.value = true; scope.busy.value = true; scope.syncing.value = true; scope.offline.value = true;
  scope.error.value = 'old error'; scope.selectedTile.value = 0; scope.selectedHandIndex.value = 0;
  const calls = []; globalThis.fetch = async (url, options) => { calls.push({ url, options }); return response(url === '/api/profile' ? { playerToken: 'a'.repeat(64) } : url.endsWith('/history') ? emptyHistory() : { left: true }); };
  await scope.newTable(); await settle();
  for (const key of ['showRules', 'showInvite', 'copyDone', 'busy', 'syncing', 'offline', 'restoring', 'inRoom']) assert.equal(scope[key].value, false, key);
  assert.equal(scope.error.value, ''); assert.equal(scope.selectedTile.value, null); assert.equal(scope.selectedHandIndex.value, null); assert.equal(document.body.style.overflow, ''); assert.equal(blurred, true);
  assert.equal(scope.savedRooms.get('ABCDEF23').token, credential().token);
  assert.equal(calls[0].url, '/api/rooms/ABCDEF23/leave');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${credential().token}`);
});

test('late polling response cannot restore a table after returning to the lobby', async () => {
  const scope = setup(fixture()); scope.playerToken.value = 'a'.repeat(64); let release; let signal;
  globalThis.fetch = (url, options) => {
    if (options.method === 'GET' && url.includes('/rooms/')) { signal = options.signal; return new Promise(resolve => { release = resolve; }); }
    return Promise.resolve(response(url === '/api/profile' ? { playerToken: 'a'.repeat(64) } : url.endsWith('/history') ? emptyHistory() : { left: true }));
  };
  const pending = scope.refresh(); await scope.newTable(); await settle();
  assert.equal(signal.aborted, true);
  release(response({ state: fixture() })); await pending;
  assert.equal(scope.state.value, null); assert.equal(scope.session.value, null); assert.equal(scope.inRoom.value, false);
  assert.equal(scheduled.filter(task => !task.cancelled && task.callback === scope.refresh).length, 0);
});

test('late mutation success and failure cannot reset a newer lobby state or restart polling', async () => {
  for (const succeeds of [true, false]) {
    const scope = setup(fixture()); scope.playerToken.value = 'a'.repeat(64); let release; let reject; let signal;
    globalThis.fetch = (url, options) => {
      if (url.endsWith('/action')) { signal = options.signal; return new Promise((resolve, fail) => { release = resolve; reject = fail; }); }
      return Promise.resolve(response(url === '/api/profile' ? { playerToken: 'a'.repeat(64) } : url.endsWith('/history') ? emptyHistory() : { left: true }));
    };
    const pending = scope.mutate({ type: 'discard', tile: 0 }); await scope.newTable(); await settle();
    scope.error.value = 'new lobby feedback'; scope.busy.value = true;
    if (succeeds) release(response({ state: fixture() })); else reject(new TypeError('late network failure'));
    await pending;
    assert.equal(signal.aborted, true); assert.equal(scope.state.value, null); assert.equal(scope.busy.value, true); assert.equal(scope.error.value, 'new lobby feedback'); assert.equal(scope.offline.value, false);
    assert.equal(scheduled.filter(task => !task.cancelled && task.callback === scope.refresh).length, 0);
  }
});

test('late create response is detached instead of opening an unwanted table', async () => {
  browser(); const scope = lobby(); scope.name.value = '我的名字'; scope.playerToken.value = 'a'.repeat(64);
  let release; let signal; const calls = [];
  globalThis.fetch = (url, options) => {
    calls.push({ url, options });
    if (url === '/api/rooms') { signal = options.signal; return new Promise(resolve => { release = resolve; }); }
    return Promise.resolve(response(url === '/api/profile' ? { playerToken: 'a'.repeat(64) } : url.endsWith('/history') ? emptyHistory() : { left: true }));
  };
  const entering = scope.enterRoom(); await settle(); await scope.newTable(); await settle();
  assert.equal(signal.aborted, true);
  release(response({ roomId: 'ABCDEF23', token: credential().token, state: fixture() })); await entering; await settle();
  assert.equal(scope.inRoom.value, false); assert.equal(window.location.search, ''); assert.equal(scope.busy.value, false);
  assert.equal(calls.filter(call => call.url.endsWith('/leave')).length, 1);
  assert.equal(calls.at(-1).options.headers.Authorization, `Bearer ${credential().token}`);
});

test('browser Back and Forward between root and explicit room use leave then authenticated resume', async () => {
  const storage = browser({ search: '?room=ABCDEF23', active: credential() }); const scope = lobby(); const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return response(url === '/api/profile' ? { playerToken: 'a'.repeat(64) } : url.endsWith('/resume') ? { state: fixture() } : url.endsWith('/history') ? emptyHistory() : { left: true }); };
  await scope.initialize(); assert.equal(scope.inRoom.value, true);
  storage.setLocation('/play'); scope.onPopState(); await settle(); assert.equal(scope.inRoom.value, false);
  storage.setLocation('/play?room=ABCDEF23'); scope.onPopState(); await settle(); assert.equal(scope.inRoom.value, true);
  assert.deepEqual(calls.filter(call => call.url.includes('/rooms/')).map(call => call.url), ['/api/rooms/ABCDEF23/resume', '/api/rooms/ABCDEF23/leave', '/api/rooms/ABCDEF23/resume']);
});

test('late resume after navigating to root is ignored and explicitly detached', async () => {
  const storage = browser({ search: '?room=ABCDEF23', active: credential() }); const scope = lobby(); let release; const calls = [];
  globalThis.fetch = (url, options) => { calls.push({ url, options }); if (url.endsWith('/resume')) return new Promise(resolve => { release = resolve; }); return Promise.resolve(response(url === '/api/profile' ? { playerToken: 'a'.repeat(64) } : url.endsWith('/history') ? emptyHistory() : { left: true })); };
  const initializing = scope.initialize(); await settle(); assert.equal(scope.restoring.value, true);
  storage.setLocation('/play'); scope.onPopState(); await settle();
  release(response({ state: fixture() })); await initializing; await settle();
  assert.equal(scope.inRoom.value, false); assert.equal(scope.restoring.value, false); assert.equal(window.location.search, '');
  assert.equal(calls.filter(call => call.url.endsWith('/leave')).length, 2); // Immediate detach plus compensation for the late successful resume.
});

test('blocked or malformed browser storage never crashes or traps the root in restoring', async () => {
  for (const options of [{ blocked: true }, { malformed: true, profile: null }]) {
    browser(options); const scope = lobby();
    globalThis.fetch = async url => response(url === '/api/profile' ? { playerToken: 'd'.repeat(64) } : emptyHistory());
    await scope.initialize(); await settle();
    assert.equal(scope.inRoom.value, false); assert.equal(scope.restoring.value, false); assert.equal(scope.busy.value, false); assert.equal(scope.historyLoading.value, false);
    assert.match(scope.storageWarning.value, /浏览器/); assert.equal(scope.playerToken.value.length, 64);
  }
});

test('history shows own finalized totals separately from provisional games and never exposes credentials', async () => {
  browser(); const scope = lobby(); scope.playerToken.value = 'a'.repeat(64); const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return response({ summary: { settledGames: 1, totalScore: 18 }, records: [
    { gameId: 'g2', roomId: 'GHJKLM23', seat: 0, name: '改名以后', status: 'detached', score: 7, huCount: 1, startedAt: Date.now(), players: [{ seat: 0, name: '改名以后', score: 7 }], events: [{ type: 'hu', message: '自摸计分', delta: 7 }] },
    { gameId: 'g1', roomId: 'ABCDEF23', seat: 0, name: '原来的名字', status: 'finished', score: 18, huCount: 2, startedAt: Date.now(), players: [], events: [] }
  ] }); };
  await scope.loadHistory(); const html = await render(scope);
  assert.match(html, /累计已结算虚拟积分/); assert.match(html, /\+18/); assert.match(html, /已离桌 · 未结算/); assert.match(html, /不计入累计已结算积分/); assert.match(html, /改名以后/); assert.match(html, /原来的名字/); assert.match(html, /自摸计分/);
  assert.doesNotMatch(html, /恢复上一桌|href="[^\"]*room=|aaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbb/);
  assert.equal(calls[0].url, '/api/profile/history'); assert.equal(calls[0].options.headers.Authorization, `Bearer ${'a'.repeat(64)}`); assert.equal(calls[0].options.headers['X-Player-Token'], undefined);
});

test('new table entry waits for old leave confirmation, with retryable feedback on failure', async () => {
  const scope = setup(fixture()); scope.playerToken.value = 'a'.repeat(64); let failLeave = true; const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); if (url.endsWith('/leave') && failLeave) throw new TypeError('offline'); return response(url === '/api/profile' ? { playerToken: 'a'.repeat(64) } : url.endsWith('/history') ? emptyHistory() : url === '/api/rooms' ? { roomId: 'GHJKLM23', token: 'c'.repeat(64), state: { ...fixture(), id: 'GHJKLM23' } } : { left: true }); };
  await scope.newTable(); await settle(); scope.name.value = '新桌玩家'; await scope.enterRoom();
  assert.equal(calls.some(call => call.url === '/api/rooms'), false); assert.match(scope.error.value, /离桌通知尚未确认/); assert.equal(scope.busy.value, false);
  failLeave = false; await scope.enterRoom(); assert.equal(scope.inRoom.value, true); assert.equal(scope.session.value.roomId, 'GHJKLM23');
});

test('released lobby credentials are removed and a later invitation allows a new join', async () => {
  const scope = setup(fixture()); scope.playerToken.value = 'a'.repeat(64); scope.saveSession(credential()); const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return response(url.endsWith('/leave') ? { left: true, detached: false } : url.endsWith('/history') ? emptyHistory() : { roomId: 'ABCDEF23', token: 'c'.repeat(64), state: fixture() }); };
  await scope.newTable(); await settle(); assert.equal(scope.savedRooms.has('ABCDEF23'), false);
  scope.entryMode.value = 'join'; scope.roomCode.value = 'ABCDEF23'; scope.name.value = '再加入'; await scope.enterRoom();
  assert.equal(calls.at(-1).url, '/api/rooms/ABCDEF23/join'); assert.equal(scope.session.value.token, 'c'.repeat(64));
});

test('expired stored seat is cleared after explicit resume failure, then next click joins normally', async () => {
  browser(); const scope = lobby(); scope.playerToken.value = 'a'.repeat(64); scope.saveSession(credential()); scope.session.value = null;
  scope.entryMode.value = 'join'; scope.roomCode.value = 'ABCDEF23'; scope.name.value = '再落座'; const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return url.endsWith('/resume') ? response({ error: '座位凭证失效' }, 401) : response({ roomId: 'ABCDEF23', token: 'c'.repeat(64), state: fixture() }); };
  await scope.enterRoom(); assert.equal(scope.savedRooms.has('ABCDEF23'), false); assert.equal(scope.inRoom.value, false);
  await scope.enterRoom(); assert.equal(scope.inRoom.value, true); assert.deepEqual(calls.map(call => call.url), ['/api/rooms/ABCDEF23/resume', '/api/rooms/ABCDEF23/join']);
});

test('pending departure survives root reload and must finish before a new room is created', async () => {
  const storage = browser({ active: credential() }); const first = lobby(); let failLeave = true; const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options }); if (url.endsWith('/leave') && failLeave) throw new TypeError('offline');
    return response(url === '/api/profile' ? { playerToken: 'a'.repeat(64) } : url.endsWith('/history') ? emptyHistory() : url === '/api/rooms' ? { roomId: 'GHJKLM23', token: 'c'.repeat(64), state: { ...fixture(), id: 'GHJKLM23' } } : { left: true, detached: true });
  };
  await first.initialize(); await settle();
  assert.equal(storage.sessionItems.has('huajian-mahjong-session-v1'), false);
  assert.equal(JSON.parse(storage.sessionItems.get('huajian-mahjong-departures-v1')).ABCDEF23.token, credential().token);
  const reloaded = lobby(); await reloaded.initialize(); await settle(); reloaded.name.value = '新桌'; await reloaded.enterRoom();
  assert.equal(calls.some(call => call.url === '/api/rooms'), false); assert.equal(reloaded.inRoom.value, false);
  failLeave = false; await reloaded.enterRoom();
  assert.equal(reloaded.session.value.roomId, 'GHJKLM23'); assert.equal(storage.sessionItems.has('huajian-mahjong-departures-v1'), false);
  assert.equal(calls.filter(call => call.url.includes('/rooms/') && !call.url.endsWith('/leave')).length, 0);
});

test('stale resume compensation never detaches the same seat selected again by newer navigation', async () => {
  const storage = browser({ search: '?room=ABCDEF23', active: credential() }); const scope = lobby(); const calls = []; let releaseOld; let resumes = 0;
  globalThis.fetch = (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/resume')) { resumes++; if (resumes === 1) return new Promise(resolve => { releaseOld = resolve; }); return Promise.resolve(response({ state: fixture() })); }
    return Promise.resolve(response(url === '/api/profile' ? { playerToken: 'a'.repeat(64) } : url.endsWith('/history') ? emptyHistory() : { left: true, detached: true }));
  };
  const old = scope.initialize(); await settle(); storage.setLocation('/play'); scope.onPopState(); await settle();
  storage.setLocation('/play?room=ABCDEF23'); scope.onPopState(); await settle(); assert.equal(scope.inRoom.value, true);
  const leavesBefore = calls.filter(call => call.url.endsWith('/leave')).length;
  releaseOld(response({ state: fixture() })); await old; await settle();
  assert.equal(scope.inRoom.value, true); assert.equal(scope.session.value.token, credential().token);
  assert.equal(calls.filter(call => call.url.endsWith('/leave')).length, leavesBefore);
});

test('identity bootstrap is persisted before registration and reused by concurrent tabs and failed retries', async () => {
  const storage = browser({ profile: null }); const first = lobby(); const second = lobby(); const submitted = []; let fail = true;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/profile'); const candidate = JSON.parse(options.body).playerToken; submitted.push(candidate);
    assert.match(candidate, /^[a-f0-9]{64}$/); assert.equal(JSON.parse(storage.localItems.get('huajian-mahjong-player-v1')), candidate);
    assert.equal(options.headers['X-Player-Token'], undefined);
    if (fail) throw new TypeError('registration interrupted'); return response({ playerToken: candidate });
  };
  const results = await Promise.allSettled([first.ensureProfile(), second.ensureProfile()]); assert.equal(results.every(result => result.status === 'rejected'), true);
  assert.equal(new Set(submitted).size, 1); fail = false; await first.ensureProfile();
  assert.equal(first.playerToken.value, submitted[0]); assert.equal(new Set(submitted).size, 1);
});

test('room mutations carry the identity in the body and never in an unredacted custom header or URL', async () => {
  const scope = setup(fixture()); scope.playerToken.value = 'a'.repeat(64); let request;
  globalThis.fetch = async (url, options) => { request = { url, options }; return response({ state: fixture() }); };
  await scope.mutate({ type: 'discard', tile: 0 });
  assert.equal(JSON.parse(request.options.body).profileToken, scope.playerToken.value);
  assert.equal(request.options.headers.Authorization, `Bearer ${credential().token}`);
  assert.equal(request.options.headers['X-Player-Token'], undefined); assert.equal(request.url.includes(scope.playerToken.value), false);
});

test('replacement occupant does not inherit a finished player hand or score, while result keeps original names', async () => {
  const state = fixture(); state.phase = 'finished'; state.game.phase = 'finished'; state.game.legalActions = [];
  state.game.participantNames = ['原玩家', '老牌友二', '老牌友三'];
  state.seats[0] = { seat: 0, name: '新玩家', connected: true, isCurrentParticipant: false, score: 0 };
  state.game.players[0].score = 24; state.game.players[1].score = -12; state.game.players[2].score = -12;
  const scope = setup(state); const html = await render(scope);
  assert.equal(scope.me.value.score, 0); assert.equal(scope.hand.value.length, 0); assert.equal(scope.scoreSeats.value[0].name, '原玩家'); assert.equal(scope.scoreSeats.value[0].score, 24);
  assert.match(html, /已落座，等待下一局/); assert.match(html, /上一局结算/); assert.match(html, /原玩家/); assert.doesNotMatch(html, /aria-label="我的手牌与操作"/);
});

test('malformed optional nickname in saved credentials does not break the lobby form', async () => {
  browser({ active: { ...credential(), name: { unexpected: true } } }); const scope = lobby();
  globalThis.fetch = async url => response(url === '/api/profile' ? { playerToken: 'a'.repeat(64) } : url.endsWith('/history') ? emptyHistory() : { left: true, detached: true });
  await scope.initialize(); await settle(); assert.equal(scope.name.value, ''); await scope.enterRoom(); assert.match(scope.error.value, /落座名/); assert.equal(scope.busy.value, false);
});

test('schema 3 renders one central shared pool and never repeats flip provenance as personal radishes', async () => {
  const state = fixture({ schemaVersion: 3 });
  state.game.players[0].radishes = [0, 1, 2, 3, 4, 5];
  state.game.players[1].radishes = [7]; state.game.players[2].radishes = [8];
  state.game.sharedRadishes = state.game.players.flatMap(player => player.radishes);
  state.game.firstHuRadishesRevealed = true;
  state.game.history = [{ type: 'hu', seat: 0, newRadishes: [0, 1, 2, 3, 4, 5], message: '首胡' }, { type: 'anGang', seat: 2, radish: 8, message: '暗杠' }];
  const html = await render(setup(state));
  assert.equal((html.match(/aria-labelledby="shared-radish-title"/g) || []).length, 1);
  const pool = html.match(/<section class="shared-radish-pool"[\s\S]*?<\/section>/)?.[0];
  assert.ok(pool); assert.match(pool, /共 8 张/); assert.match(pool, /牌友3杠牌 \+1/);
  assert.equal((pool.match(/aria-label="\d+[条筒]"/g) || []).length, 8);
  assert.doesNotMatch(html, /class="radish-row"|我的萝卜/);
  assert.match(html, /三家共用这一池，后续胡牌不再加六张/);
});

test('schema 3 empty pool and first table hu are explicit, with no personal first-hu labels', async () => {
  const state = fixture({ schemaVersion: 3 }); state.game.sharedRadishes = [];
  const scope = setup(state); let html = await render(scope);
  assert.match(html, /首胡才翻萝卜：6 张基础 \+ 0 张已成杠累计/);
  state.game.sharedRadishes = [0, 1, 2, 3, 4, 5];
  state.game.history = [{ type: 'hu', seat: 1, newRadishes: [...state.game.sharedRadishes], message: '首胡' }];
  scope.state.value = { ...state, game: { ...state.game } }; html = await render(scope);
  assert.match(html, /全桌首胡 \+6/); assert.doesNotMatch(html, /我的萝卜/);
});

test('schema 3 hu-plus-peng claim displays both legal choices and accurate guidance', async () => {
  const state = fixture({ schemaVersion: 3 }); state.game.phase = 'claim'; state.game.currentSeat = 1;
  state.game.claim = { tile: 3, discardSeat: 1 };
  state.game.legalActions = [{ type: 'hu' }, { type: 'peng', tile: 3 }, { type: 'pass' }];
  const scope = setup(state); const html = await render(scope);
  assert.deepEqual(scope.primaryActions.value.map(action => action.type), ['hu', 'peng', 'pass']);
  assert.match(html, /你可以选择胡、碰或过/);
  const buttons = (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) || []).map(button => button.replace(/<[^>]*>/g, '').trim());
  assert.ok(buttons.includes('胡牌')); assert.ok(buttons.includes('碰')); assert.ok(buttons.includes('过'));
  assert.doesNotMatch(html, />明杠<\/button>/);
  scope.state.value.game.legalActions = [{ type: 'hu' }, { type: 'pass' }];
  const huOnly = await render(scope); assert.doesNotMatch(huOnly, /你可以选择胡、碰或过|>碰<\/button>|>明杠<\/button>/);
});

test('server-derived post-hu selfdraw retains hu and pass choices with no competing kong', async () => {
  const state = fixture({ schemaVersion: 3, postHu: true });
  state.game = getPlayerView(postHuKongGame({ winningDraw: true }), 0);
  const scope = setup(state); const html = await render(scope);
  assert.equal(scope.canHu.value, true);
  assert.deepEqual(scope.gangActions.value, []);
  assert.deepEqual(scope.primaryActions.value.map(action => action.type), ['hu', 'pass']);
  assert.match(html, /胡牌<\/button>/);
  assert.match(html, /不胡 \/ 过 · 打出新牌/);
  assert.doesNotMatch(html, /当前必须杠牌|暂不杠|本轮再胡需换尽原听口|选牌后打出/);
});

test('server-derived post-hu three-bamboo draw offers only supplement kong, never pass or skip kong', async () => {
  const state = fixture({ schemaVersion: 3, postHu: true });
  state.game = getPlayerView(postHuKongGame(), 0);
  const scope = setup(state);
  const html = await render(scope);
  assert.deepEqual(state.game.legalActions, [{ type: 'buGang', tile: 2 }]);
  assert.equal(state.game.drawnTile, 2);
  assert.deepEqual(state.game.waitTiles, [9, 12]);
  assert.equal(scope.canHu.value, false);
  assert.deepEqual(scope.gangActions.value, [{ type: 'buGang', tile: 2 }]);
  assert.deepEqual(scope.primaryActions.value, []);
  assert.deepEqual(scope.discardOptions.value, []);
  assert.match(html, /1筒、4筒/);
  assert.match(html, /补杠 · 3条/);
  assert.match(html, /原手牌不能换打；当前必须杠牌/);
  assert.doesNotMatch(html, /不胡|不杠|过 · 打出新牌|>过<\/button>|胡牌<\/button>|选牌后打出/);
});

test('schema 3 hu summaries name the actual sole payer, including exclusive big-single scores', async () => {
  const state = fixture({ schemaVersion: 3, postHu: true }); state.game.players[1].huCount = 1;
  const score = { fan: 4, fanPoints: 8, copyFanBonus: 3, radishBonus: 4, dragonBonus: 0, total: 12 };
  const payments = [{ seat: 0, delta: 12 }, { seat: 2, delta: -12 }];
  state.game.scoreBreakdown = score;
  state.game.history = [{ type: 'hu', seat: 0, score, payments, message: '继续自摸' }];
  const scope = setup(state); const html = await render(scope);
  assert.match(html, /4 番 8 分 \+ 共享萝卜 4 = 12 分 \/ 付款方；牌友3付12分/);
  assert.doesNotMatch(html, /另外两家|\+ 神龙|牌友2付/);
  assert.match(scope.scoreSummary({ ...score, bigSingle: true, overlapPolicy: 'exclusive', total: 50 }, [{ seat: 0, delta: 50 }, { seat: 2, delta: -50 }]), /大单钓：50 分 \/ 付款方.*牌友3付50分/);
  assert.doesNotMatch(scope.scoreSummary({ ...score, bigSingle: true, overlapPolicy: 'exclusive', total: 50 }), /另外两家/);
});

test('schema 3 final dragon settlement is labeled separately from hu and immediate kong payments', async () => {
  const state = fixture({ schemaVersion: 3 }); state.phase = 'finished'; state.game.phase = 'finished'; state.game.legalActions = [];
  const dragon = { type: 'dragonSettlement', seat: 0, points: 20, dragons: [{ tile: 11, count: 7, points: 20 }], payments: [{ seat: 0, delta: 40 }, { seat: 1, delta: -20 }, { seat: 2, delta: -20 }], message: '局末神龙结算' };
  state.game.dragonSettlement = { settled: true, entries: [dragon] }; state.game.history = [dragon];
  const html = await render(setup(state));
  assert.match(html, /局末神龙已结算，本局只结一次/); assert.match(html, /局末神龙明细/);
  assert.match(html, /局末神龙 · 本局结算一次/); assert.match(html, /3筒 7 张 · 20 分/);
  assert.match(html, /牌友2付20分 · 牌友3付20分/); assert.doesNotMatch(html, /即时杠分：/);
});

test('schema 2 preserves its personal pool, repeat-hu restriction, scoring and rule explanations', async () => {
  const state = fixture({ postHu: true }); state.game.players[0].radishes = [0, 1]; state.game.players[1].radishes = [2]; state.game.players[0].huLockActive = true;
  const scope = setup(state); scope.showRules.value = true; const html = await render(scope);
  assert.match(html, /本桌保留 v0.3.1 旧规则/); assert.match(html, /本桌旧规则 · v0.3.1/); assert.match(html, /我的萝卜/);
  assert.match(html, /每次合法杠立即翻 1 张自己的萝卜/); assert.match(html, /原听口还有重合时不能再胡/);
  assert.match(html, /普通胡牌时另计/); assert.match(html, /本轮再胡需换尽原听口/);
  assert.doesNotMatch(html, /aria-labelledby="shared-radish-title"|六张加 3 番|神龙留到局末，只结一次/);
  assert.match(scope.scoreSummary({ fan: 1, fanPoints: 1, radishBonus: 2, dragonBonus: 10, total: 13 }), /萝卜 2 \+ 神龙 10/);
});

test('current lobby rules explain six-copy fan, shared radishes, consecutive hu and separate final dragon counts', async () => {
  browser(); const scope = lobby(); scope.showRules.value = true; const html = await render(scope);
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  assert.ok(html.includes(`朋友内测版 · v${version}`)); assert.ok(html.includes(`规则原型 v${version}`));
  assert.match(html, /六张加 3 番/); assert.match(html, /六张同牌加到 4 番/);
  assert.match(html, /七张加 4 番，八张加 5 番/); assert.match(html, /逐张加杠至八张/);
  assert.match(html, /首胡翻 6 张，加上首胡前每次成功杠累计的 1 张/);
  assert.match(html, /本人的手牌区、碰杠区、胡牌区，加上全桌共享萝卜/);
  assert.match(html, /普通加番只计算自己的三个牌区，不含萝卜/);
  assert.match(html, /只由本次胡之前还未胡的其他玩家付款/);
  assert.doesNotMatch(html, /可胡时先选择胡或过，不同时开放杠|本桌旧规则|恢复上一桌/);
});

test('radish rules and zero-payer summaries match new and preserved old saved rules', async () => {
  const state = fixture({ schemaVersion: 3 });
  state.game.rules = { radishCountsWinPile: true, selfDrawOnlyUnwon: true };
  const scope = setup(state); scope.showRules.value = true;
  const html = await render(scope);
  assert.match(html, /胡牌区（含共胡）、碰杠区、手牌区全部参与匹配/);
  assert.match(html, /七筒 2 张×萝卜 1 张，加四筒 1 张×萝卜 2 张，共 4 分/);
  assert.match(scope.scoreSummary({ fan: 1, fanPoints: 1, radishBonus: 4, total: 5 }, [{ seat: 0, delta: 0 }]), /共享萝卜 4.*本次无付款方，收入 0 分/);
  state.game.rules = { radishCountsWinPile: false };
  const oldScope = setup(state); oldScope.showRules.value = true;
  const oldHtml = await render(oldScope);
  assert.match(oldHtml, /本局保留开局时 v0.4.0 的萝卜规则/);
  assert.match(oldHtml, /本局保留开局时的自摸付款规则/);
});

test('latest kong-discard rules explicitly name the sole discarder payer without selfdraw wording', async () => {
  for (const state of [null, fixture({ schemaVersion: 3 })]) {
    browser();
    const scope = state ? setup(state) : lobby();
    scope.showRules.value = true;
    const html = await render(scope);
    assert.match(html, /仅由实际出牌者付款，不按自摸结算/);
    assert.doesNotMatch(html, /按自摸付款方式结算|杠后接胡按自摸|杠后出牌，可按自摸接胡/);
  }
});

test('shared radishes sort by suit and ascending rank reactively without changing server pool order', async () => {
  const state = fixture({ schemaVersion: 3 }); state.game.sharedRadishes = [17,2,9,0,12,2];
  const scope = setup(state);
  assert.deepEqual(scope.sharedRadishes.value,[0,2,2,9,12,17]);
  assert.deepEqual(state.game.sharedRadishes,[17,2,9,0,12,2]);
  scope.state.value.game.sharedRadishes.push(1,10);
  assert.deepEqual(scope.sharedRadishes.value,[0,1,2,2,9,10,12,17]);
  assert.deepEqual(scope.state.value.game.sharedRadishes,[17,2,9,0,12,2,1,10]);
  const html = await render(scope); assert.match(html,/共 8 张/);
});

test('entry exposes optional character preference and submits selected value', async () => {
  browser();
  const scope = lobby();
  const html = await render(scope);
  assert.match(html, /id="preferred-character"/);
  assert.match(html, /随机分配/);
  assert.match(html, /小桃 · 萝莉音/);
  assert.match(html, /清岚 · 御姐音/);
  assert.match(html, /晴禾 · 阳光少女音/);
  scope.name.value = '测试角色'; scope.preferredCharacter.value = 'elegant';
  let submitted;
  globalThis.fetch = async (path, options) => {
    if (path === '/api/profile') return response({ playerToken: 'a'.repeat(64) });
    submitted = JSON.parse(options.body);
    return response({ roomId: 'ABCDEF23', token: 'b'.repeat(64), state: { id: 'ABCDEF23', revision: 0, phase: 'lobby', you: 0, hostSeat: 0, seats: [{seat:0,name:'测试角色',preferredCharacter:'elegant'}], game: null } });
  };
  await scope.enterRoom();
  assert.equal(submitted.preferredCharacter, 'elegant');
});

test('character portraits use server assignment independent of viewer position', async () => {
  const value = fixture(); value.game.characters = ['sunny', 'sweet', 'elegant'];
  const scope = setup(value);
  assert.equal(scope.characterForPlayer(0).id, 'sunny');
  assert.equal(scope.characterForPlayer(1).id, 'sweet');
  assert.equal(scope.characterForPlayer(2).id, 'elegant');
  value.you = 2;
  assert.equal(scope.characterForPlayer(0).id, 'sunny');
  const html = await render(scope);
  assert.match(html, /characters\/sunny.png/);
  assert.match(html, /characters\/sweet.png/);
  assert.match(html, /characters\/elegant.png/);
});

test('foreground resume establishes a full silent baseline after hidden polling', async () => {
  const scope = setup(fixture());
  const a = { type: 'discard', seat: 0, tile: 0 };
  scope.applyState({ ...fixture(), revision: 4, game: { ...fixture().game, id:'voice-test', history: [a] } });
  document.hidden = true; scope.visibilityChanged();
  scope.applyState({ ...fixture(), revision: 5, game: { ...fixture().game, id:'voice-test', history: [a,{type:'peng',seat:1}] } });
  document.hidden = false; scope.visibilityChanged();
  let path;
  globalThis.fetch = async requested => {
    path = requested;
    return response({state:{...fixture(),revision:6,game:{...fixture().game,id:'voice-test',history:[a,{type:'peng',seat:1},{type:'hu',seat:2}]}}});
  };
  await scope.refresh();
  assert.equal(path, '/api/rooms/ABCDEF23');
  // With the new full baseline established, the following action alone is new.
  assert.deepEqual(scope.voiceCursor.consume({...fixture(),revision:7,game:{...fixture().game,id:'voice-test',history:[a,{type:'peng',seat:1},{type:'hu',seat:2},{type:'discard',seat:0,tile:2}]}}),['/voices/sweet/tiao-3.mp3']);
});

test('a delayed hidden request cannot consume the foreground audio baseline',async()=>{
  const scope=setup(fixture()); let deliver; const requested=[]
  document.hidden=true; scope.visibilityChanged()
  globalThis.fetch=async path=>{requested.push(path);return new Promise(resolve=>{deliver=resolve})}
  const pending=scope.refresh(); await settle()
  document.hidden=false; scope.visibilityChanged()
  deliver(response({state:{...fixture(),revision:4,game:{...fixture().game,id:'race',history:[{type:'discard',seat:0,tile:1}]}}}))
  await pending
  globalThis.fetch=async path=>{requested.push(path);return response({state:{...fixture(),revision:5,game:{...fixture().game,id:'race',history:[{type:'discard',seat:0,tile:1},{type:'peng',seat:1}]}}})}
  await scope.refresh()
  assert.equal(requested.at(-1),'/api/rooms/ABCDEF23')
  assert.deepEqual(scope.voiceCursor.consume({...fixture(),revision:5,game:{...fixture().game,id:'race',history:[{type:'discard',seat:0,tile:1},{type:'peng',seat:1}]}}),[])
});

test('new special rules show scoring explanation while pre-feature games retain the old-rate notice', async () => {
  browser(); let scope=lobby(); scope.showRules.value=true;
  let html=await render(scope);
  assert.match(html,/七对首次胡后/); assert.match(html,/立即向另外两家各收 50 分/);
  scope=setup(fixture({schemaVersion:3})); scope.showRules.value=true;
  html=await render(scope);
  assert.match(html,/本桌保留开局时的牌型计分/);
  assert.match(html,/本桌保留旧大单钓/);
  assert.doesNotMatch(html,/class="special-pattern-rules"/);
});

test('new score summary labels pattern fan and omits misleading zero-point big-single add-on', () => {
  const value=fixture({schemaVersion:3});value.game.rules={specialHuPatterns:true};
  const scope=setup(value);
  const summary=scope.scoreSummary({fan:5,fanPoints:10,radishBonus:2,total:12,bigSingle:true,bigSinglePoints:0,overlapPolicy:'fan',patternBonuses:[{type:'bigSingle',fan:2},{type:'pureSuit',fan:2}]});
  assert.match(summary,/大单吊 \+2番、清一色 \+2番/);
  assert.match(summary,/5 番 10 分/);
  assert.doesNotMatch(summary,/大单钓 0/);
  assert.match(scope.scoreSummary({fan:5,fanPoints:10,radishBonus:0,total:10,sevenPairsFixed:true,patternBonuses:[{type:'sevenPairs',fan:5}]}),/七对固定5番/);
});

test('extended kong actions and meld labels show sixth through eighth tiles without merging duplicate pengs', async () => {
  for (const count of [5, 6, 7]) {
    const state = fixture();
    state.game.players[0].melds = [{ type: 'peng', tile: 12, tiles: [12, 12, 12] }, { type: 'buGang', tile: 16, tiles: Array(count).fill(16) }];
    state.game.legalActions = [{type:'addGang', tile:16}];
    const scope = setup(state);
    assert.equal(scope.actionLabel({type:'addGang',tile:16}), `加第 ${count+1} 张 · 8筒`);
    assert.equal(scope.meldLabel(state.game.players[0].melds[1]), `补杠 · ${count} 张`);
    const html=await render(scope);
    assert.match(html,new RegExp(`加第 ${count+1} 张 · 8筒`));
  }
  const duplicate=fixture(); duplicate.game.players[0].melds=[{type:'peng',tile:16,tiles:[16,16,16]},{type:'mingGang',tile:16,tiles:[16,16,16,16]}];
  assert.equal(setup(duplicate).actionLabel({type:'addGang',tile:16}),'加第 5 张 · 8筒');
  const scope=setup(fixture());
  assert.equal(scope.meldLabel({type:'anGang',hidden:true,tile:null,tiles:Array(8).fill(null)}),'暗杠 · 8 张');
});

test('latest rules distinguish exposed-kong replacement hu from own-kong replacement hu and discarded tiles', async () => {
  browser();const scope=lobby();scope.showRules.value=true;const html=await render(scope);
  assert.match(html,/本次补摸胡只由该明杠的出牌者付款/);
  assert.match(html,/自己摸来的暗杠、补杠、加杠后补摸胡才由另外两家付款/);
  assert.match(html,/杠后打出的牌被胡，仍只由该张牌的出牌者付款/);
});

test('rob-kong response distinguishes pending upgrade from completed kong or ordinary discard', async () => {
  const state=fixture({schemaVersion:3});
  state.game.phase='claim';
  state.game.claim={kind:'robKong',discardSeat:1,tile:16,eligibleSeats:[0],respondedSeats:[]};
  state.game.legalActions=[{type:'hu'},{type:'pass'}];
  const scope=setup(state);
  assert.match(scope.statusTitle.value,/可以抢杠/);
  assert.match(scope.statusDetail.value,/只能抢杠胡或过/);
  let html=await render(scope);
  assert.match(html,/正在补杠/);
  assert.equal(scope.winLabel({tile:16,source:'robKong'}),'8筒 · 抢杠胡');
  assert.match(scope.scoreSummary({fan:2,fanPoints:2,total:2,radishBonus:0,patternBonuses:[{type:'robKong',fan:1}]}),/抢杠 \+1番/);
  state.game.legalActions=[];
  const waiting=setup(state);
  assert.match(waiting.statusDetail.value,/暂不收杠分、不翻萝卜/);
});

test('pre-first-win kong radishes show only pending count, not imaginary revealed tiles', async () => {
  const state=fixture({schemaVersion:3});
  state.game.sharedRadishes=[];
  state.game.firstHuRadishesRevealed=false;
  state.game.pendingKongRadishes=5;
  const scope=setup(state);
  const html=await render(scope);
  assert.match(html,/首胡待翻 \+5 张杠萝卜/);
  assert.match(html,/6 张基础 \+ 5 张已成杠累计/);
  assert.doesNotMatch(html,/每杠添 1 张；全桌第一次胡牌添 6 张/);
});

test('dealer marker follows server dealer independently of host', async () => {
  const state=fixture({schemaVersion:3}); state.game.dealerSeat=1;
  const scope=setup(state);const html=await render(scope);
  assert.match(html,/dealer-tag/);
  assert.match(html,/庄/);
  assert.match(html,/房主/);
});

test('latest rules permit ordinary repeat discard hu without waiting for natural draw', async () => {
  browser(); const scope=lobby();scope.showRules.value=true;const html=await render(scope);
  assert.match(html,/自己已经胡过不限制接炮/);
  assert.match(html,/可以再次胡，不必等自己下一次正常摸牌/);
  assert.match(html,/普通弃牌也不能接胡/);
});

function startFixture(phase = 'lobby') {
  const state = fixture({ schemaVersion: 3 });
  state.phase = phase;
  if (phase === 'lobby') state.game = null;
  else { state.game.phase = 'finished'; state.game.legalActions = []; }
  return state;
}

test('host gets an accessible checked option before first start and same-room next game only', async () => {
  for (const phase of ['lobby', 'finished']) {
    const scope = setup(startFixture(phase));
    const html = await render(scope);
    assert.match(html, /for="auto-discard-after-hu"/);
    assert.match(html, /id="auto-discard-after-hu"[^>]*checked/);
    assert.match(html, /aria-describedby="auto-discard-help"/);
    assert.match(html, phase === 'finished' ? /下一局选项/ : /开局选项/);
    scope.state.value.you = 1;
    assert.doesNotMatch(await render(scope), /id="auto-discard-after-hu"/);
  }
  assert.doesNotMatch(await render(setup(fixture({ schemaVersion: 3 }))), /id="auto-discard-after-hu"/);
});

test('start submits the selected boolean for first and next games without changing the old game rule', async () => {
  for (const phase of ['lobby', 'finished']) for (const choice of [true, false]) {
    const scope = setup(startFixture(phase));
    if (scope.game.value) scope.game.value.rules = { autoDiscardAfterHu: !choice };
    scope.autoDiscardAfterHu.value = choice;
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      const state = fixture({ schemaVersion: 3 }); state.revision = 4;
      state.game.rules = { autoDiscardAfterHu: choice };
      return response({ state });
    };
    if (scope.game.value) assert.equal(scope.gameAutoDiscardAfterHu.value, !choice);
    await scope.mutate(null, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/rooms/ABCDEF23/start');
    assert.deepEqual(calls[0].body.options, { autoDiscardAfterHu: choice });
    assert.equal(calls[0].body.revision, 3);
    assert.equal(calls[0].body.action, undefined);
    assert.equal(scope.gameAutoDiscardAfterHu.value, choice);
    assert.doesNotMatch(await render(scope), /id="auto-discard-after-hu"/);
  }
});

test('persisted current game option is read-only for all seats and missing old option means automatic', async () => {
  for (const you of [0, 1, 2]) for (const choice of [false, true, undefined]) {
    const state = fixture({ schemaVersion: 3 }); state.you = you;
    state.game.rules = choice === undefined ? {} : { autoDiscardAfterHu: choice };
    const scope = setup(state); scope.autoDiscardAfterHu.value = choice === false;
    const html = await render(scope);
    assert.match(html, choice === false ? /已关闭，需点“过”继续/ : /已开启/);
    assert.doesNotMatch(html, /id="auto-discard-after-hu"/);
  }
});

test('manual post-hu no-hu no-kong state renders only pass and keeps every hand tile locked', async () => {
  const state = fixture({ schemaVersion: 3, postHu: true });
  state.game.rules = { autoDiscardAfterHu: false }; state.game.legalActions = [{ type: 'pass' }];
  const scope = setup(state); const html = await render(scope);
  assert.deepEqual(scope.primaryActions.value, [{ type: 'pass' }]);
  assert.match(html, /手牌已固定，点过继续/);
  assert.match(html, /原手牌不能换打；点“过”打出新牌/);
  assert.match(html, /过 · 打出新牌<\/button>/);
  assert.doesNotMatch(html, /选牌后打出|不胡 \/ 过|当前必须杠牌/);
  const hand = html.match(/<div class="my-hand">([\s\S]*?)<\/div><\/div>/)[1];
  const buttons = hand.match(/<button\b[^>]*>/g);
  assert.equal(buttons.length, state.game.players[0].hand.length);
  assert.ok(buttons.every(button => /\bdisabled\b/.test(button)));
});

test('checkbox and start are disabled while busy offline or syncing, and invalid callers cannot start', async () => {
  for (const flag of ['busy', 'offline', 'syncing']) {
    const scope = setup(startFixture()); scope[flag].value = true;
    assert.match(await render(scope), /id="auto-discard-after-hu"[^>]*disabled/);
    globalThis.fetch = () => { assert.fail('blocked start must not submit'); };
    await scope.mutate(null, true);
  }
  for (const change of [state => { state.you = 1; }, state => { state.seats[2] = null; }, state => { state.phase = 'playing'; }]) {
    const state = startFixture(); change(state); const scope = setup(state);
    globalThis.fetch = () => { assert.fail('invalid start must not submit'); };
    await scope.mutate(null, true);
  }
});

test('in-flight start snapshots choice, rejects repeated clicks and applies authoritative result', async () => {
  const scope = setup(startFixture()); scope.autoDiscardAfterHu.value = false;
  let release; const requests = [];
  globalThis.fetch = (url, options) => { requests.push(JSON.parse(options.body)); return new Promise(resolve => { release = resolve; }); };
  const pending = scope.mutate(null, true);
  assert.match(await render(scope), /id="auto-discard-after-hu"[^>]*disabled/);
  scope.autoDiscardAfterHu.value = true;
  await scope.mutate(null, true);
  assert.equal(requests.length, 1); assert.deepEqual(requests[0].options, { autoDiscardAfterHu: false });
  const next = fixture({ schemaVersion: 3 }); next.revision = 4; next.game.rules = { autoDiscardAfterHu: false };
  release(response({ state: next })); await pending;
  assert.equal(scope.gameAutoDiscardAfterHu.value, false);
  assert.match(await render(scope), /已关闭，需点“过”继续/);
});

test('stale start reads current rules without retrying or overwriting the server choice', async () => {
  const scope = setup(startFixture()); scope.autoDiscardAfterHu.value = false;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(options.method);
    if (options.method === 'POST') return response({ error: 'stale' }, 409);
    assert.equal(scope.syncing.value, true);
    await scope.mutate(null, true);
    const state = fixture({ schemaVersion: 3 }); state.revision = 5; state.game.rules = { autoDiscardAfterHu: true };
    return response({ state });
  };
  await scope.mutate(null, true);
  assert.deepEqual(calls, ['POST', 'GET']);
  assert.equal(scope.gameAutoDiscardAfterHu.value, true);
  assert.doesNotMatch(await render(scope), /id="auto-discard-after-hu"/);
});

test('new room resets the draft option and current rules explain both start choices', async () => {
  const scope = setup(startFixture()); scope.autoDiscardAfterHu.value = false;
  scope.resetRoomContext();
  assert.equal(scope.autoDiscardAfterHu.value, true);
  scope.showRules.value = true;
  const html = await render(scope);
  assert.match(html, /默认勾选/);
  assert.match(html, /不勾选则需点“过”才能过回合，局中不能更改/);
  assert.match(html, /有合法杠必须杠，不能跳过或打出新牌/);
});

test('explicit reload restores manual rule from server rather than the default checked draft', async () => {
  browser({ rooms: { ABCDEF23: credential() }, search: '?room=ABCDEF23' });
  const restored = fixture({ schemaVersion: 3 }); restored.game.rules = { autoDiscardAfterHu: false };
  globalThis.fetch = async url => response(url === '/api/profile' ? { playerToken: 'a'.repeat(64) } : { state: restored });
  const scope = lobby(); await scope.initialize();
  assert.equal(scope.autoDiscardAfterHu.value, true);
  assert.equal(scope.gameAutoDiscardAfterHu.value, false);
  const html = await render(scope);
  assert.match(html, /已关闭，需点“过”继续/);
  assert.doesNotMatch(html, /id="auto-discard-after-hu"/);
});

test('manual option cannot bypass server-mandated post-hu kong or change hu-plus-pass decisions', async () => {
  for (const winningDraw of [false, true]) {
    const engineGame = postHuKongGame({ winningDraw }); engineGame.rules.autoDiscardAfterHu = false;
    const state = fixture({ schemaVersion: 3, postHu: true }); state.game = getPlayerView(engineGame, 0);
    const scope = setup(state); const html = await render(scope);
    if (winningDraw) {
      assert.deepEqual(scope.primaryActions.value.map(action => action.type), ['hu', 'pass']);
      assert.match(html, /不胡 \/ 过 · 打出新牌/);
    } else {
      assert.deepEqual(scope.primaryActions.value, []);
      assert.deepEqual(scope.gangActions.value, [{ type: 'buGang', tile: 2 }]);
      assert.match(html, /当前必须杠牌/);
      assert.doesNotMatch(html, /过 · 打出新牌|选牌后打出/);
    }
  }
});

test('finished-room polling preserves the edited next-game option without changing last-game display', async () => {
  const state = startFixture('finished'); state.game.rules = { autoDiscardAfterHu: true };
  const scope = setup(state); scope.autoDiscardAfterHu.value = false;
  globalThis.fetch = async () => response({ state: { ...state, revision: 4 } });
  await scope.refresh();
  assert.equal(scope.autoDiscardAfterHu.value, false);
  assert.equal(scope.gameAutoDiscardAfterHu.value, true);
  const html = await render(scope);
  assert.match(html, /上一局胡后自动打出：<strong>已开启/);
  assert.doesNotMatch(html, /id="auto-discard-after-hu"[^>]*checked/);
});

test('late start result cannot revive an exited room or overwrite a new room draft', async () => {
  const scope = setup(startFixture()); scope.autoDiscardAfterHu.value = false;
  let release;
  globalThis.fetch = () => new Promise(resolve => { release = resolve; });
  const pending = scope.mutate(null, true);
  scope.resetRoomContext();
  const next = fixture({ schemaVersion: 3 }); next.game.rules = { autoDiscardAfterHu: false };
  release(response({ state: next })); await pending;
  assert.equal(scope.state.value, null);
  assert.equal(scope.session.value, null);
  assert.equal(scope.autoDiscardAfterHu.value, true);
});
