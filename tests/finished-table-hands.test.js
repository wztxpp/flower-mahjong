// 牌桌终局摊牌只测试公开摘要消费边界，不推算暗手、重算积分或改动服务端投影。
// Verify table consumption of public terminal summaries, without inferring hands, rescoring or modifying server projections.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileStyle } from '@vue/compiler-sfc';
import { roundSummaryHandsBySeat } from '../src/round-summary.js';
import { stableTableSnapshot } from './helpers/stable-table-fixtures.js';
import { terminalSummaryFixture } from './helpers/round-summary-fixtures.js';

// 夹具只代表已过滤的合成展示快照；长手牌用于视窗压力，不代表可执行的规则状态。
// Fixtures are filtered synthetic views; long hands stress viewports, never executable rule states.
function fixture(caseId = 'flower-3', variant = 'normal') {
  const { state } = stableTableSnapshot(caseId, 'finished');
  state.game.roundSummary = terminalSummaryFixture(state, variant);
  return state;
}

for (const caseId of ['flower-3', 'flower-4', 'flower-legacy-1', 'flower-legacy-2', 'flower-spectator', 'chengdu-4', 'chengdu-spectator']) {
  test(`${caseId}: table maps complete copied final hands by absolute seat, independent of viewer`, () => {
    const state = fixture(caseId, 'long');
    const before = structuredClone(state);
    const hands = roundSummaryHandsBySeat(state);
    assert.equal(hands.size, state.game.players.length);
    for (const player of state.game.roundSummary.players) {
      assert.deepEqual(hands.get(player.seat), player.finalHand);
      assert.equal(hands.get(player.seat).length, state.gameMode === 'chengdu' ? 14 : 20);
      hands.get(player.seat).reverse();
    }
    assert.deepEqual(state, before, 'reveal copies never mutate received authority');
    const restored = JSON.parse(JSON.stringify(state));
    assert.deepEqual(roundSummaryHandsBySeat(restored), roundSummaryHandsBySeat(state), 'reconnect is a pure read');
  });
}

test('both phase gates reject stale summaries in live turns, claims, preparation and retired blood battles', () => {
  for (const caseId of ['flower-3', 'chengdu-4']) {
    for (const phase of ['turn', 'claim', 'exchange', 'dingque']) {
      const state = fixture(caseId);
      state.game.phase = phase;
      state.game.players[1].won = { source: 'selfDraw', tile: 18 };
      assert.equal(roundSummaryHandsBySeat(state).size, 0);
      state.game.phase = 'finished';
      state.phase = 'playing';
      assert.equal(roundSummaryHandsBySeat(state).size, 0);
    }
    const state = fixture(caseId);
    state.game.id = 'next-round';
    state.game.phase = 'turn';
    state.phase = 'playing';
    assert.equal(roundSummaryHandsBySeat(state).size, 0, 'an old summary cannot reveal a new game');
  }
});

test('mode, strict seat and record guards fail closed without reading ordinary hands or win references', () => {
  for (const change of [
    state => { state.gameMode = 'chengdu'; },
    state => { state.game.gameMode = 'unknown'; },
    state => { state.game.roundSummary.gameMode = 'chengdu'; },
    state => { state.game.players[1].seat = 0; },
    state => { state.game.players[1].seat = '1'; },
    state => { state.game.players[1].seat = 4; },
    state => { delete state.game.roundSummary; },
  ]) {
    const state = fixture();
    change(state);
    assert.equal(roundSummaryHandsBySeat(state).size, 0);
  }
  for (const finalHand of [null, undefined, [0, null, 2], [0, '1'], [0, 27], [0, 18]]) {
    const state = fixture();
    state.game.roundSummary.players[1].finalHand = finalHand;
    state.game.players[1].hand = [1, 2, 3];
    state.game.roundSummary.players[1].wins = [{ tile: 4, inHand: false }];
    assert.equal(roundSummaryHandsBySeat(state).has(1), false);
  }
  const state = fixture();
  state.game.roundSummary.players.push({ ...state.game.roundSummary.players[1], finalHand: [17] });
  assert.equal(roundSummaryHandsBySeat(state).has(1), false, 'duplicate seats are ambiguous, never first-row wins');
  state.game.roundSummary.players = [{ seat: 0, finalHand: [] }, { seat: 99, finalHand: [0] }, { seat: '1', finalHand: [0] }];
  assert.deepEqual([...roundSummaryHandsBySeat(state)], [[0, []]], 'known empty differs from missing or invalid seats');
});

test('legacy missing modes preserve Flower while summary row order never becomes seat order', () => {
  const state = fixture('flower-legacy-1');
  delete state.gameMode;
  delete state.game.gameMode;
  state.game.roundSummary.players.reverse();
  for (const player of state.game.roundSummary.players) assert.deepEqual(roundSummaryHandsBySeat(state).get(player.seat), player.finalHand);
});

test('finished table tile rows retain fixed portrait dimensions and native complete-list scrolling', () => {
  const source = readFileSync(new URL('../src/tabletop.css', import.meta.url), 'utf8');
  const result = compileStyle({ source, filename: 'finished-table.css', id: 'finished-table' });
  assert.deepEqual(result.errors, []);
  const rules = new Map();
  result.rawResult.root.walkRules(rule => rules.set(rule.selector, Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]))));
  const tile = rules.get('.finished-table-hand .mahjong-tile.tile-small');
  assert.equal(tile.flex, '0 0 30px');
  assert.equal(tile.width, '30px');
  assert.equal(tile.height, '40px');
  assert.equal(tile['min-width'], tile.width);
  assert.equal(tile['max-height'], tile.height);
  const row = [...rules].find(([selector]) => selector.includes('.opponent-hand.finished-table-hand'))?.[1];
  assert.equal(row.overflow, 'auto');
  assert.equal(row.height, '76px');
  assert.equal(row['min-height'], row.height);
  const [paddingTop, , paddingBottom] = row.padding.split(' ').map(Number.parseFloat);
  // 非覆盖式滚动条占真实高度；宽度溢出时仍须给40px牌保留内容高，底部内边距覆盖原5px阴影。
  // Classic scrollbars consume layout height; horizontal overflow must still leave40px content plus padding for the5px shadow.
  const classicScrollbarAllowance = 20;
  assert.ok(Number.parseFloat(row.height) - classicScrollbarAllowance - paddingTop - paddingBottom >= Number.parseFloat(tile.height));
  assert.ok(paddingBottom >= 5);
  assert.equal(row['overflow-y'], undefined, 'do not hide clipped faces with a vertical overflow override');
  for (const filename of ['App.vue', 'ChengduTable.vue']) {
    const { descriptor } = parse(readFileSync(new URL(`../src/${filename}`, import.meta.url), 'utf8'));
    assert.match(descriptor.template.content, /v-for="\(tile, tileIndex\) in finishedTableHands.get\(player.seat\)"/);
    assert.doesNotMatch(descriptor.template.content, /finishedTableHands.get\(player.seat\)\.(?:slice|filter)/);
    assert.match(descriptor.template.content, /本局：{{ finishedTableNames.get\(player.seat\) }} · 结束时手牌/);
  }
});
