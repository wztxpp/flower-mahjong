import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Vue from 'vue';
import * as Renderer from 'vue/server-renderer';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';

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
const App = compileComponent('App.vue', { './MahjongTile.vue': Tile, './Icon.vue': Icon });
const originals = Object.fromEntries(['window', 'document', 'sessionStorage', 'fetch', 'setTimeout', 'clearTimeout'].map(key => [key, globalThis[key]]));
let scheduled = [];
function browser() {
  scheduled = [];
  globalThis.window = { location: { search: '', href: 'https://example.test/play', origin: 'https://example.test', pathname: '/play' }, history: { replaceState() {} } };
  globalThis.document = { hidden: false, body: { style: {} } };
  globalThis.sessionStorage = { setItem() {}, removeItem() {} };
  globalThis.setTimeout = (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length; };
  globalThis.clearTimeout = () => {};
}
function fixture({ legacy = false, postHu = false } = {}) {
  const players = [0, 1, 2].map(seat => ({ seat, handCount: 13, huCount: 0, score: 0, hand: seat === 0 ? [0, 1, 2, 3] : undefined, melds: [], radishes: [], winPile: [] }));
  if (postHu) { players[0].huCount = 1; players[0].winPile = [{ tile: 3, source: 'discard', virtual: false }]; }
  return { id: 'ABCDEF', revision: 3, you: 0, hostSeat: 0, phase: 'playing', seats: players.map(player => ({ seat: player.seat, name: `牌友${player.seat + 1}`, connected: true })), game: { schemaVersion: legacy ? 1 : 2, players, phase: 'turn', turnStep: legacy ? 'draw' : 'discard', currentSeat: 0, drawnTile: legacy ? null : 3, wallCount: 70, discards: [], history: [], lockedWaits: [], legalActions: legacy ? [{ type: 'draw' }] : postHu ? [{ type: 'hu' }, { type: 'pass' }, { type: 'discard', tile: 3 }] : [{ type: 'discard', tile: 0 }], huDiagnostic: { canHu: postHu, code: postHu ? 'AVAILABLE' : 'SHAPE', message: postHu ? '当前可以胡牌。' : '当前牌型还不满足胡牌条件。' } } };
}
function setup(state) {
  browser();
  const scope = App.setup({}, { expose() {} });
  scope.session.value = { roomId: 'ABCDEF', token: 'test-token' };
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

test('legacy board keeps draw control and an isolated new-table link', async () => {
  const scope = setup(fixture({ legacy: true }));
  const html = await render(scope);
  assert.match(html, /本桌已开局，继续使用旧规则/);
  assert.match(html, /href="https:\/\/example.test\/play" target="_blank" rel="noopener"/);
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
  assert.equal(requested, '/api/rooms/ABCDEF?since=3');
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
