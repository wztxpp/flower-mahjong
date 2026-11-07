import * as ChengduEventTextModule from '../src/chengdu-event-text.js';
// 编译真实成都组件验证选牌、合法动作、隐私与终局；不复制规则，不用浏览器替代后台测试。
// Compile the real Chengdu component to verify selection, allowlists, privacy and finish views; never duplicate rules or replace backend tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Vue from 'vue';
import * as Renderer from 'vue/server-renderer';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import * as TilePresentation from '../src/mahjong-tile-presentation.js';

// 测试装载器只改编译产物的 import；被测 setup/template 均来自交付的 SFC。
// Substitute imports in compiled output only; tested setup/template come from the shipped SFC.
function compile(filename, dependencies = {}) {
  const { descriptor } = parse(readFileSync(new URL(`../src/${filename}`, import.meta.url), 'utf8'));
  const script = compileScript(descriptor, { id: filename });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: filename, ssr: true, ssrCssVars: [], compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  const modules = { vue: Vue, 'vue/server-renderer': Renderer, ...dependencies };
  const load = (code) => code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
    (_, names, module) => `const {${names.replace(/\s+as\s+/g, ':')}} = modules[${JSON.stringify(module)}];`)
    .replace(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g, (_, name, module) => `const ${name} = modules[${JSON.stringify(module)}];`);
  const component = new Function('modules', load(script.content).replace('export default', 'return'))(modules);
  component.ssrRender = new Function('modules', `${load(template.code).replace('export function ssrRender', 'function ssrRender')}\nreturn ssrRender;`)(modules);
  return component;
}
const Tile = compile('MahjongTile.vue', { './mahjong-tile-presentation.js': TilePresentation });
const Table = compile('ChengduTable.vue', { './chengdu-event-text.js': ChengduEventTextModule, './MahjongTile.vue': Tile, './mahjong-tile-presentation.js': TilePresentation });

// 合成“已裁剪视图”不是权威牌墙；各测试只改变显示/动作字段，不拿夹具作算分证据。
// This synthetic filtered view is not an authoritative wall; tests vary display/actions and never claim scoring evidence from it.
function fixture(phase = 'exchange') {
  return { viewerRole: 'player', you: 0, phase: 'playing', seats: Array.from({ length: 4 }, (_, seat) => ({ seat, name: `测试${seat}` })),
    tableScores: [{ id: 'fixture-player', name: '测试0', totalScore: 7 }],
    game: { id: 'fixture-game', gameMode: 'chengdu', schemaVersion: 2, revision: 0, mySeat: 0, dealerSeat: 0, currentSeat: null, phase, wallCount: 55,
      rules: { playerCount: 4, fanCap: 4, selfDraw: 'addBase', exchangeThree: true, endCondition: 'bloodBattle' },
      players: Array.from({ length: 4 }, (_, seat) => ({ seat, score: 0, handCount: 13, melds: [], won: null, dingqueSuit: null, dingqueSubmitted: false, ...(seat === 0 ? { hand: [0, 0, 1, 9, 10, 18, 19] } : {}) })),
      preparation: { exchangeDirection: 'clockwise', exchangeSubmittedSeats: [], myExchange: null },
      discards: [], history: [], legalActions: [{ type: 'exchangeThree', tiles: [0, 0, 1] }], waitTiles: [], claim: null,
    },
  };
}
function setup(state = fixture()) {
  const events = [];
  const props = Vue.reactive({ state, blocked: false, canStart: false, characterForPlayer: (seat) => ({ name: `角色${seat}`, portrait: '/test.png' }) });
  const scope = Table.setup(props, { expose() {}, emit: (...event) => events.push(event) });
  return { props, scope, events };
}
async function render(scope) {
  return Renderer.renderToString(Vue.createSSRApp({ ...Table, setup: () => scope }, scope.props));
}

test('exchange chooses three actual copies and emits only an exact server allowlist entry', () => {
  const { scope, events } = setup();
  scope.chooseTile(0); scope.chooseTile(1); scope.chooseTile(2); scope.chooseTile(3);
  assert.deepEqual(scope.selectedIndices.value, [0, 1, 2]);
  assert.deepEqual(scope.selectedAction.value, { type: 'exchangeThree', tiles: [0, 0, 1] });
  scope.submit(scope.selectedAction.value);
  assert.deepEqual(events, [['action', { type: 'exchangeThree', tiles: [0, 0, 1] }]]);
  scope.chooseTile(1); scope.chooseTile(3);
  assert.equal(scope.selectedAction.value, undefined);
  scope.submit({ type: 'exchangeThree', tiles: [0, 1, 9] });
  assert.equal(events.length, 1);
});

test('exchange selection survives other preparation replies but resets on changed hand or game', async () => {
  const { props, scope } = setup();
  scope.chooseTile(0); props.state.game.revision++;
  props.state.game.preparation.exchangeSubmittedSeats = [2];
  await Vue.nextTick(); assert.deepEqual(scope.selectedIndices.value, [0]);
  props.state.game.players[0].hand = [0, 1, 2];
  await Vue.nextTick(); assert.deepEqual(scope.selectedIndices.value, []);
  scope.chooseTile(0); props.state.game.id = 'next-game';
  await Vue.nextTick(); assert.deepEqual(scope.selectedIndices.value, []);
});

test('exchange submission disables further choices and reveals only private received tiles', async () => {
  const { props, scope, events } = setup();
  props.state.game.preparation.myExchange = [0, 0, 1];
  props.state.game.preparation.receivedExchange = { fromSeat: 1, tiles: [18, 19, 20] };
  props.state.game.legalActions = [];
  scope.chooseTile(0); scope.submit({ type: 'exchangeThree', tiles: [0, 0, 1] });
  assert.deepEqual(events, []);
  const html = await render(scope);
  assert.match(html, /换牌已提交，等待其他牌友/);
  assert.match(html, /收到的三张/);
  assert.doesNotMatch(html, /确认换三张/);
});

test('dingque choices come from server and never auto-select a suit', async () => {
  const state = fixture('dingque');
  state.game.legalActions = [{ type: 'dingque', suit: 'bamboo' }, { type: 'dingque', suit: 'characters' }];
  const { scope, events } = setup(state);
  const html = await render(scope);
  assert.match(html, /定缺条/); assert.match(html, /定缺万/); assert.doesNotMatch(html, />定缺筒</);
  assert.deepEqual(events, []);
  scope.submit({ type: 'dingque', suit: 'dots' });
  scope.submit({ type: 'dingque', suit: 'characters' });
  assert.deepEqual(events, [['action', { type: 'dingque', suit: 'characters' }]]);
});

test('discard selection honors dingque-filtered legal actions and needs explicit confirmation', async () => {
  const state = fixture('turn'); state.game.currentSeat = 0; state.game.players[0].dingqueSuit = 'bamboo';
  state.game.legalActions = [{ type: 'discard', tile: 0 }, { type: 'discard', tile: 1 }];
  const { scope, events } = setup(state);
  scope.chooseTile(3); assert.deepEqual(scope.selectedIndices.value, []);
  scope.chooseTile(1); assert.equal(events.length, 0);
  assert.deepEqual(scope.selectedAction.value, { type: 'discard', tile: 0 });
  scope.submit(scope.selectedAction.value); assert.equal(events.length, 1);
  const html = await render(scope); assert.match(html, /缺条/); assert.match(html, /确认出牌/);
});

test('claim responses include hu, peng, kong and pass exactly as offered without locally prioritizing', async () => {
  const state = fixture('claim'); state.game.claim = { tile: 18, fromSeat: 1, source: 'discard', hasResponded: false };
  state.game.legalActions = [{ type: 'hu' }, { type: 'peng', tile: 18 }, { type: 'mingGang', tile: 18 }, { type: 'pass' }];
  const { scope, props, events } = setup(state);
  const html = await render(scope);
  for (const label of ['胡牌', '碰 1万', '明杠 1万', '>过<']) assert.ok(html.includes(label), label);
  scope.submit(state.game.legalActions[3]); assert.deepEqual(events, [['action', { type: 'pass' }]]);
  props.state.game.legalActions = []; scope.submit({ type: 'hu' }); assert.equal(events.length, 1);
});

test('busy/offline barrier prevents even a valid action and renders disabled controls', async () => {
  const { props, scope, events } = setup(); props.blocked = true;
  scope.chooseTile(0); scope.submit(props.state.game.legalActions[0]);
  assert.deepEqual(events, []); assert.deepEqual(scope.selectedIndices.value, []);
  assert.match(await render(scope), /正在同步或处理操作/);
});

test('spectators and finished replacements get no private hand or action controls', async () => {
  for (const spectator of [true, false]) {
    const state = fixture(); state.viewerRole = spectator ? 'spectator' : 'player'; state.game.mySeat = null;
    delete state.game.players[0].hand; state.game.legalActions = [];
    const { scope, events } = setup(state); scope.submit({ type: 'dingque', suit: 'bamboo' });
    const html = await render(scope);
    assert.doesNotMatch(html, /id="chengdu-hand-title"|确认换三张|定缺条/);
    assert.deepEqual(events, []); assert.equal(scope.mySeat.value, null);
  }
});

test('retired winner shows exit and cannot reenter, while projected wins and concealed kongs preserve masks', async () => {
  const state = fixture('turn'); state.game.currentSeat = 3; state.game.legalActions = [];
  state.game.players[0].won = { source: 'selfDraw', tile: 18, points: 9 };
  state.game.players[1].won = { source: 'selfDraw', tile: null, hidden: true, points: 9 };
  state.game.players[2].melds = [{ type: 'anGang', tile: null, tiles: [null, null, null, null], hidden: true }];
  const { scope, events } = setup(state); scope.submit({ type: 'hu' });
  const html = await render(scope); assert.match(html, /你已胡牌，本局不再摸打或胡牌/); assert.match(html, /牌面未公开/);
  assert.equal((html.match(/aria-label="背面牌"/g) || []).length, 4); assert.deepEqual(events, []);
});

test('finished draw renders authoritative settlement and total ledger without Flower scoring', async () => {
  const state = fixture('finished'); state.phase = 'finished'; state.game.finishReason = 'wallExhausted'; state.game.legalActions = [];
  state.game.settlement = { status: 'settled', payments: [{ from: 0, to: 1, points: 8, reason: 'flowerPig' }, { from: 2, to: 3, points: 2, reason: 'notReady' }, { from: 0, to: 2, points: 1, reason: 'kongRefund' }] };
  const { scope, props } = setup(state); props.canStart = true;
  const html = await render(scope);
  for (const text of ['流局结算完成', '查花猪', '查叫', '退杠', '开始下一局', '+7']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /萝卜|神龙|大单吊|胡后自动打出/);
});

test('public events never invent hidden tile identities and ignore unknown payload text', () => {
  const { scope } = setup();
  assert.equal(scope.eventText({ type: 'draw', seat: 1, tile: null, hidden: true }), '测试1摸牌');
  assert.equal(scope.eventText({ type: 'anGang', seat: 1, tile: null, hidden: true, text: 'secret' }), '测试1暗杠');
  assert.doesNotMatch(scope.eventText({ type: 'hu', seat: 1, source: 'selfDraw', hidden: true, tile: 26, points: 8 }), /9万/);
});

test('seat map matches production clockwise exchange order and own hand keeps wan identity', async () => {
  const { scope } = setup();
  assert.deepEqual([0, 1, 2, 3].map(scope.positionFor), ['self', 'left', 'opposite', 'right']);
  const html = await render(scope); assert.match(html, /本局换牌：顺时针/); assert.match(html, /aria-label="1万"/);
  assert.match(html, /role="status" aria-live="polite"/); assert.match(html, /aria-label="成都合法动作"/);
});

// 历史文案只读旧局姓名及公开账，不使用当前房间名字，不恢复隐藏牌面。
// Archived prose uses old-round names/public payments, never current names or reconstructed hidden faces.
test('Chengdu history formatter preserves round names, payment reasons and hidden identities', () => {
  const names = ['原房主', '旧牌友', '换座前', '第四席'];
  const { chengduEventText } = ChengduEventTextModule;
  assert.equal(chengduEventText({ type: 'discard', seat: 1, tile: 26 }, names), '旧牌友打出 9万');
  assert.equal(chengduEventText({ type: 'hu', seat: 0, source: 'selfDraw', hidden: true, tile: 18, points: 9,
    payments: [{ from: 1, to: 0, points: 9, reason: 'hu' }] }, names), '原房主自摸 · 9分/付款方；旧牌友 → 原房主 9分（胡牌）');
  assert.equal(chengduEventText({ type: 'drawSettlement', payments: [{ from: 2, to: 3, points: 2, reason: 'notReady' }] }, names), '流局查花猪、查叫与退杠已结算；换座前 → 第四席 2分（查叫）');
  assert.equal(chengduEventText({ type: 'unknown', message: 'do not echo', tile: 18 }, names), '牌局动态');
});
