/**
 * 终局原画背景回归：真实引擎/HTTP历史角色来源、固定素材白名单、实际Vue编译/SSR与加载失败。
 * Terminal original-art regressions cover real engine/HTTP provenance, the fixed catalog, actual Vue compilation/SSR and load failures.
 * 所有身份/局均为合成数据；不请求生产或图片、不修改输入，也不把SSR/自定义渲染器当浏览器像素验收。
 * Every identity/game is synthetic; no production/image requests or input writes, and SSR/custom hosts do not establish browser pixels.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as Vue from 'vue';
import { renderToString } from 'vue/server-renderer';
import { parse, compileScript, compileStyle } from '@vue/compiler-sfc';
import * as legacy from '../shared/legacy-game.js';
import * as v2 from '../shared/v2-game.js';
import * as flower from '../shared/game.js';
import * as chengdu from '../shared/chengdu-engine.js';
import { CHARACTER_IDS } from '../shared/character-assignment.js';
import { roundSummaryForRoom } from '../server/history.js';
import { MemoryStore } from '../server/store.js';
import { createApi } from '../server/api.js';
import { CHARACTER_PORTRAITS } from '../src/character-portraits.js';
import * as SummaryModule from '../src/round-summary.js';
import * as TilePresentation from '../src/mahjong-tile-presentation.js';
import { terminalSummaryFixture } from './helpers/round-summary-fixtures.js';
import { stableTableSnapshot } from './helpers/stable-table-fixtures.js';

// 只选择已有合法动作完成真实牌局，逐步检验守恒；返回结束局而非手工改phase的假状态。
// Finish real games using existing legal actions and invariant checks, never by fabricating a finished phase.
function finish(engine, initial) {
  let game = initial;
  for (let step = 0; game.phase !== 'finished' && step < 1500; step++) {
    const choices = game.players.flatMap((_, seat) => engine.getLegalActions(game, seat).map((action) => ({ seat, action })));
    const choice = choices.find(({ action }) => action.type === 'hu')
      ?? choices.find(({ action }) => action.type === 'pass')
      ?? choices.find(({ action }) => action.type === 'discard') ?? choices[0];
    assert.ok(choice, game.phase);
    game = engine.applyAction(game, choice.seat, choice.action);
    engine.assertGameInvariants(game);
  }
  assert.equal(game.phase, 'finished');
  return game;
}

// 元数据保存原参与者及原角色，当前同名座位故意给不同角色，防止按昵称或当前占座补历史。
// Metadata records originals while same-named current occupants intentionally have different roles, exposing occupant/name fallback mistakes.
function roomFor(game, characters) {
  return {
    id: 'synthetic-portrait-room', createdAt: 1, updatedAt: 2, revision: 0, game,
    ...(game.gameMode ? { gameMode: game.gameMode } : {}),
    seats: game.players.map((_, seat) => ({ name: `原参与者${seat}`, tokenHash: `replacement-${seat}`, characterId: 'star' })),
    gameMeta: {
      id: 'synthetic-portrait-round', characters,
      participants: game.players.map((_, seat) => ({ seat, name: `原参与者${seat}`, tokenHash: `original-${seat}` })),
    },
    archivedGames: [],
  };
}

for (const [label, engine, create] of [
  ['Flower v1', legacy, () => legacy.createGame({ seed: 45 })],
  ['Flower v2', v2, () => v2.createGame({ seed: 45 })],
  ['Flower v3/3', flower, () => flower.createGame({ seed: 45 })],
  ['Flower v3/4', flower, () => flower.createGame({ seed: 45, rules: { playerCount: 4 } })],
  ['Chengdu', chengdu, () => chengdu.createGame({ wall: Array.from({ length: 108 }, (_, index) => index % 27), dealerSeat: 0,
    options: { exchangeThree: false, endCondition: 'firstWin' }, scoring: { selfDraw: 'addBase', fanCap: 4 }, exchangeOrdinal: 0 })],
]) {
  test(`${label}: original complete character snapshots survive replacement, restoration and estimated timestamps`, () => {
    const initial = create();
    const game = finish(engine, initial);
    const characters = CHARACTER_IDS.slice(3, 3 + game.players.length);
    const room = roomFor(game, characters);
    const before = structuredClone(room);
    const summary = roundSummaryForRoom(room);
    assert.deepEqual(summary.players.map((player) => player.characterId), characters);
    assert.deepEqual(summary.players.map((player) => player.finalHand), game.players.map((player) => player.hand));
    assert.deepEqual(roundSummaryForRoom(JSON.parse(JSON.stringify(room))), summary);
    assert.deepEqual(room, before);
    room.gameMeta.startedAtEstimated = true;
    assert.deepEqual(roundSummaryForRoom(room).players.map((player) => player.characterId), characters,
      'An estimated timestamp does not invalidate an explicitly retained original character snapshot');
    assert.ok(roundSummaryForRoom(room).players.every((player) => player.tableScore === null));
    room.game = initial;
    assert.equal(roundSummaryForRoom(room), null, 'No terminal field appears before actual finish');
  });
}

test('missing, partial, sparse, duplicate or unknown historical maps never use current occupants or default characters', () => {
  const game = finish(flower, flower.createGame({ seed: 45 }));
  const invalidMappings = [undefined, null, [], ['sweet'], ['sweet', 'elegant', 'sunny', 'star'],
    ['sweet', 'sweet', 'sunny'], ['sweet', 'future-role', 'sunny'], ['sweet', null, 'sunny'],
    ['sweet', , 'sunny'], { 0: 'sweet', 1: 'elegant', 2: 'sunny', length: 3 }];
  for (const characters of invalidMappings) {
    const room = roomFor(game, characters);
    const before = structuredClone(room);
    const summary = roundSummaryForRoom(room);
    assert.deepEqual(summary.players.map((player) => player.characterId), [null, null, null]);
    assert.deepEqual(room, before);
    assert.doesNotMatch(JSON.stringify(summary), /tokenHash|playerHash|characters|replacement-/);
  }
  const room = roomFor(game, ['sweet', 'elegant', 'sunny']);
  delete room.gameMeta;
  assert.ok(roundSummaryForRoom(room).players.every((player) => player.characterId === null));
});

// 请求直接进入隔离MemoryStore的真实处理器，不发网络；真实/start负责原角色快照，测试只安装合法完成局。
// Requests call the real handler over isolated MemoryStore, not the network; real start captures roles before a legally completed game is installed.
test('actual HTTP summary keeps original roles for spectators, same-name replacements and reconnects, then withdraws on next start', async () => {
  const store = new MemoryStore();
  const api = createApi(store);
  const request = async (path, body, token) => {
    const response = await api(new Request(`https://summary-portraits.test/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    return { status: response.status, ...await response.json() };
  };
  const created = await request('/rooms', { name: '原参与者0', preferredCharacter: 'sweet' });
  assert.equal(created.status, 201);
  const path = `/rooms/${created.roomId}`;
  const second = await request(`${path}/join`, { name: '原参与者1', preferredCharacter: 'elegant' });
  const third = await request(`${path}/join`, { name: '原参与者2', preferredCharacter: 'sunny' });
  const spectator = await request(`${path}/spectate`, {});
  const started = await request(`${path}/start`, { revision: third.state.revision }, created.token);
  assert.equal(started.status, 200);
  assert.equal(started.state.game.roundSummary, undefined);
  const room = await store.get(created.roomId);
  assert.deepEqual(room.gameMeta.characters, ['sweet', 'elegant', 'sunny']);
  room.game = finish(flower, room.game);
  assert.equal(await store.compareAndSwap(room, room.revision), true);
  for (const token of [created.token, second.token, third.token, spectator.token]) {
    const response = await request(`${path}/resume`, {}, token);
    assert.equal(response.status, 200);
    assert.deepEqual(response.state.game.roundSummary.players.map((player) => player.characterId), ['sweet', 'elegant', 'sunny']);
    assert.doesNotMatch(JSON.stringify(response.state.game.roundSummary), /tokenHash|playerHash|gameMeta/);
  }
  const legacyRoom = await store.get(created.roomId);
  delete legacyRoom.gameMeta.characters;
  assert.equal(await store.compareAndSwap(legacyRoom, legacyRoom.revision), true);
  const legacyView = (await request(path, undefined, spectator.token)).state;
  assert.deepEqual(legacyView.game.characters, ['sweet', 'elegant', 'sunny'], 'Ordinary public roles retain their existing compatibility default');
  assert.ok(legacyView.game.roundSummary.players.every((player) => player.characterId === null), 'The new historical field does not mislabel that default as a saved original');
  legacyRoom.gameMeta.characters = [...room.gameMeta.characters];
  assert.equal(await store.compareAndSwap(legacyRoom, legacyRoom.revision), true);
  assert.equal((await request(`${path}/leave`, {}, second.token)).status, 200);
  const replacement = await request(`${path}/join`, { name: '原参与者1', preferredCharacter: 'star' });
  assert.equal(replacement.status, 201);
  assert.equal(replacement.state.seats[1].characterId, 'star');
  assert.equal(replacement.state.game.roundSummary.players[1].characterId, 'elegant');
  const next = await request(`${path}/start`, { revision: replacement.state.revision }, created.token);
  assert.equal(next.status, 200);
  assert.equal(next.state.game.roundSummary, undefined);
  assert.equal((await request(`${path}/resume`, {}, spectator.token)).state.game.roundSummary, undefined);
  assert.equal((await store.get(created.roomId)).game.roundSummary, undefined, 'Projection never becomes stored game data');
});

// 纯显示夹具显式赋历史角色；放入相反的现角色和任意URL，检查适配只读摘要ID。
// View fixtures explicitly assign historic roles alongside contrary current roles and arbitrary URLs; only the summary ID may select art.
function viewFixture(caseId = 'flower-3', variant = 'normal') {
  const { state } = stableTableSnapshot(caseId, 'finished');
  state.game.roundSummary = terminalSummaryFixture(state, variant);
  return state;
}

// 与已有组件测试一致，只解析编译产物中的import；实际模板、逻辑和麻将牌均不替换。
// As in existing component suites, resolve generated imports while preserving actual templates, logic and tile rendering.
function component(filename, dependencies) {
  const { descriptor, errors } = parse(readFileSync(new URL(`../src/${filename}`, import.meta.url), 'utf8'));
  assert.deepEqual(errors, []);
  const compiled = compileScript(descriptor, { id: filename, inlineTemplate: true });
  const code = compiled.content
    .replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
      (_, names, module) => `const {${names.replace(/\s+as\s+/g, ':')}} = modules[${JSON.stringify(module)}];`)
    .replace(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g,
      (_, name, module) => `const ${name} = modules[${JSON.stringify(module)}];`);
  return new Function('modules', code.replace('export default', 'return'))({ vue: Vue, ...dependencies });
}
const Tile = component('MahjongTile.vue', { './mahjong-tile-presentation.js': TilePresentation });
const Summary = component('RoundSummary.vue', { './round-summary.js': SummaryModule, './MahjongTile.vue': Tile });

// 使用生产适配的双终局门进入实际组件；无摘要时不挂载，和App的原调用合同一致。
// Enter the actual component through the production adapter's two phase gates, matching App's existing no-summary/no-mount contract.
function summaryRoot(state) {
  return { setup() { return () => {
    const summary = SummaryModule.roundSummaryView(state.value);
    return summary ? Vue.h(Summary, { summary }) : null;
  }; } };
}

test('actual Vue SSR renders all seven catalog originals only, retaining original names, tiles and scores without input mutation', async () => {
  for (const characterId of CHARACTER_IDS) {
    for (const caseId of ['flower-3', 'flower-4', 'flower-legacy-1', 'flower-legacy-2', 'flower-spectator', 'chengdu-4', 'chengdu-spectator']) {
      const state = viewFixture(caseId);
      const player = state.game.roundSummary.players[0];
      player.characterId = characterId;
      player.name = '历史原玩家';
      player.portrait = 'https://untrusted.test/portrait.png';
      state.seats[0].name = '现任替补';
      state.seats[0].characterId = 'star';
      state.game.characters[0] = 'star';
      const before = structuredClone(state);
      const html = await renderToString(Vue.createSSRApp(summaryRoot(Vue.ref(state))));
      assert.ok(html.includes(`src="${CHARACTER_PORTRAITS[characterId].base}"`));
      assert.ok(existsSync(new URL(`../public${CHARACTER_PORTRAITS[characterId].base}`, import.meta.url)));
      assert.match(html, /data-round-summary-art aria-hidden|aria-hidden="true" data-round-summary-art/);
      assert.match(html, /alt(?:="")? draggable="false"/);
      assert.match(html, /历史原玩家/);
      assert.match(html, /本局净分/);
      assert.match(html, /本桌累计/);
      const expectedTiles = state.game.roundSummary.players.reduce((count, row) => count + row.finalHand.length
        + row.melds.reduce((total, meld) => total + meld.tiles.length, 0) + row.wins.length, 0);
      assert.equal((html.match(/class="mahjong-tile /g) || []).length, expectedTiles);
      assert.doesNotMatch(html, /untrusted|现任替补|portrait-motion|canvas/);
      assert.deepEqual(state, before);
    }
  }
});

test('unknown, absent and adversarial IDs stay neutral despite current roles; ongoing and next-game views expose no summary art or tiles', async () => {
  for (const characterId of [undefined, null, '', 'future-role', '__proto__', 'constructor', 'https://bad.test/a.png', '../sweet', { id: 'sweet' }]) {
    const state = viewFixture();
    for (const player of state.game.roundSummary.players) player.characterId = characterId;
    const before = structuredClone(state);
    const html = await renderToString(Vue.createSSRApp(summaryRoot(Vue.ref(state))));
    assert.doesNotMatch(html, /data-round-summary-art|data-round-summary-portrait|round-player-illustrated/);
    assert.match(html, /结束时手牌/);
    assert.deepEqual(state, before);
  }
  for (const [roomPhase, gamePhase] of [['playing', 'finished'], ['finished', 'turn'], ['playing', 'claim'], ['playing', 'exchange'], ['playing', 'dingque']]) {
    const state = viewFixture('chengdu-4');
    state.phase = roomPhase;
    state.game.phase = gamePhase;
    assert.equal(await renderToString(Vue.createSSRApp(summaryRoot(Vue.ref(state)))), '<!---->');
  }
  for (const variant of ['missing', 'absent']) {
    const html = await renderToString(Vue.createSSRApp(summaryRoot(Vue.ref(viewFixture('flower-3', variant)))));
    assert.doesNotMatch(html, /data-round-summary-art|data-round-summary-portrait/);
  }
});

// 最小Vue host只代替DOM落点；保留真实响应式调度和组件事件，从实际img触发error而非复制失败逻辑。
// A minimal host replaces DOM storage only; real Vue scheduling/component events handle errors fired from the actual image vnode.
function mount(state) {
  const host = {
    insert(node, parent, anchor = null) {
      if (node.parent) host.remove(node);
      node.parent = parent;
      const index = parent.children.indexOf(anchor);
      if (index < 0) parent.children.push(node);
      else parent.children.splice(index, 0, node);
    },
    remove(node) {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = null;
    },
    createElement(type) { return Vue.markRaw({ type, props: {}, children: [], parent: null }); },
    createText(text) { return Vue.markRaw({ type: '#text', text, children: [] }); },
    createComment(text) { return Vue.markRaw({ type: '#comment', text, children: [] }); },
    setText(node, text) { node.text = text; },
    setElementText(node, text) { node.text = text; node.children = []; },
    parentNode(node) { return node.parent; },
    nextSibling(node) { return node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null; },
    patchProp(node, key, previous, value) { node.props[key] = value; },
  };
  const root = Vue.markRaw({ children: [] });
  const app = Vue.createRenderer(host).createApp(summaryRoot(state));
  app.mount(root);
  return { root, app };
}
function elements(node, predicate) {
  return [...(predicate(node) ? [node] : []), ...(node.children ?? []).flatMap((child) => elements(child, predicate))];
}
const images = (root) => elements(root, (node) => node.type === 'img');
const tiles = (root) => elements(root, (node) => node.props?.class?.split(' ').includes('mahjong-tile'));

test('actual mounted summary removes failed art only, accepts another character, and withdraws the entire view when phases change', async () => {
  const original = viewFixture();
  original.game.roundSummary.players[0].characterId = 'sweet';
  const before = structuredClone(original);
  const state = Vue.ref(original);
  const { root, app } = mount(state);
  try {
    const tileCount = tiles(root).length;
    const failed = images(root).find((node) => node.props.src === CHARACTER_PORTRAITS.sweet.base);
    assert.ok(failed);
    const originalImageCount = images(root).length;
    failed.props.onError();
    await Vue.nextTick();
    assert.equal(images(root).length, originalImageCount - 1);
    assert.equal(tiles(root).length, tileCount);
    assert.deepEqual(original, before);
    state.value = structuredClone(before);
    await Vue.nextTick();
    assert.equal(images(root).length, originalImageCount - 1, 'Ordinary polling does not repeatedly request failed art');
    state.value.game.roundSummary.players[0].characterId = 'star';
    await Vue.nextTick();
    assert.ok(images(root).some((node) => node.props.src === CHARACTER_PORTRAITS.star.base));
    failed.props.onError();
    await Vue.nextTick();
    assert.ok(images(root).some((node) => node.props.src === CHARACTER_PORTRAITS.star.base), 'Old failure never removes another character');
    state.value.phase = 'playing';
    await Vue.nextTick();
    assert.equal(images(root).length, 0);
    assert.equal(tiles(root).length, 0);
    state.value = viewFixture();
    await Vue.nextTick();
    assert.ok(images(root).length > 0, 'A newly mounted summary can try its original art again');
    delete state.value.game.roundSummary;
    await Vue.nextTick();
    assert.equal(images(root).length, 0);
  } finally {
    app.unmount();
  }
});

// 读取实际编译CSS的遮罩端点和变量，按最坏黑色底像素计算对比；这不替代真实手机/浏览器视觉测试。
// Read actual compiled CSS stops/variables and calculate contrast over worst-case black pixels, not a substitute for phone/browser visual QA.
test('background layers are noninteractive and out of flow; actual overlay palettes meet AA without changing tile dimensions', () => {
  const source = readFileSync(new URL('../src/RoundSummary.vue', import.meta.url), 'utf8');
  const { descriptor } = parse(source);
  const style = compileStyle({ source: descriptor.styles[0].content, filename: 'RoundSummary.vue', id: 'portraits', scoped: true });
  assert.deepEqual(style.errors, []);
  const rules = [];
  style.rawResult.root.walkRules((rule) => rules.push(rule));
  const declarations = (rule) => Object.fromEntries(rule.nodes.filter((node) => node.type === 'decl').map(({ prop, value }) => [prop, value]));
  const art = declarations(rules.find((rule) => rule.selector === '.round-player-art[data-v-portraits]'));
  assert.equal(art.position, 'absolute');
  assert.equal(art.inset, '0');
  assert.equal(art['pointer-events'], 'none');
  assert.equal(art['z-index'], '-1');
  const player = declarations(rules.find((rule) => rule.selector === '.round-player[data-v-portraits]'));
  assert.equal(player.isolation, 'isolate');
  assert.equal(player.padding, '15px 0');
  const palette = Object.values(declarations(rules.find((rule) => rule.selector === '.round-player-illustrated[data-v-portraits]')));
  palette.push('#294b3b');
  const luminance = (channels) => channels.map((channel) => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  }).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
  for (const overlay of rules.filter((rule) => rule.selector === '.round-player-art[data-v-portraits]::after')) {
    const gradient = declarations(overlay).background;
    const stops = [...gradient.matchAll(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/g)];
    assert.ok(stops.length >= 2);
    for (const [, red, green, blue, alpha] of stops) {
      const background = luminance([red, green, blue].map((value) => Number(value) * Number(alpha)));
      for (const color of palette) {
        const foreground = luminance(color.slice(1).match(/../g).map((value) => parseInt(value, 16)));
        assert.ok((background + .05) / (foreground + .05) >= 4.5, `${color}/${alpha}`);
      }
    }
  }
  const tileRules = rules.filter((rule) => rule.selector === '.round-tile-run[data-v-portraits] .mahjong-tile').map(declarations);
  assert.equal(tileRules[0].flex, 'none');
  assert.deepEqual(tileRules.map(({ width, height }) => [width, height]), [['26px', '36px'], ['24px', '33px']]);
  assert.doesNotMatch(source, /url\(|setInterval|requestAnimationFrame|CharacterArtwork|background-image/);
});
