// 只验证终局显示适配，不运行浏览器、网络或另造客户端计分；服务端真实摘要与展示夹具分别验证。
// Test only terminal display adaptation, with no browser/network/client scoring; cover actual server summaries and view fixtures separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as flower from '../shared/game.js';
import { engineFor } from '../server/game-engines.js';
import { roundSummaryView, roundScoreText, roundScoreTone, roundMeldLabel, roundWinLabel } from '../src/round-summary.js';
import { terminalSummaryFixture } from './helpers/round-summary-fixtures.js';
import { stableTableSnapshot } from './helpers/stable-table-fixtures.js';

// 标准输入总是新的合成视图；null/0/负数保持各自含义，不受其他测试更改。
// Each standard input is a new view-only fixture; null, zero and negative values retain distinct semantics.
function stateFixture(caseId = 'flower-3', variant = 'normal') {
  const { state } = stableTableSnapshot(caseId, 'finished');
  state.game.roundSummary = terminalSummaryFixture(state, variant);
  return state;
}

test('terminal display requires both finished gates and a matching explicit server summary', () => {
  const state = stateFixture();
  assert.equal(roundSummaryView(null), null);
  for (const path of ['room', 'game', 'summary', 'mode']) {
    const changed = structuredClone(state);
    if (path === 'room') changed.phase = 'playing';
    if (path === 'game') changed.game.phase = 'turn';
    if (path === 'summary') delete changed.game.roundSummary;
    if (path === 'mode') changed.game.roundSummary.gameMode = 'chengdu';
    assert.equal(roundSummaryView(changed), null);
  }
  state.game.roundSummary.players = [];
  assert.equal(roundSummaryView(state), null);
});

test('display preserves authoritative zero, negative scores, tile zero, and copied terminal zones', () => {
  const state = stateFixture();
  const before = structuredClone(state);
  const view = roundSummaryView(state);
  assert.equal(view.players[0].finalHand[0], 0);
  assert.equal(view.players[0].roundScore, 24);
  assert.equal(view.players[0].tableScore, 48);
  assert.equal(view.players[2].huCount, 0);
  assert.equal(view.players[2].dragons.count, 0);
  assert.equal(view.players[1].roundScore, -12);
  assert.equal(view.players[0].dragons.details[0].pointsPerOpponent, 10);
  view.players[0].finalHand.reverse();
  view.players[1].melds[0].tiles[0] = 17;
  view.players[0].wins[0].tile = 17;
  assert.deepEqual(state, before);
  for (const [number, label] of [[null, '未记录'], [undefined, '未记录'], [NaN, '未记录'], [Infinity, '未记录'], ['0', '未记录'], [0, '0'], [-12, '-12'], [24, '+24']]) {
    assert.equal(roundScoreText(number), label);
  }
  assert.equal(roundScoreTone(null), 'neutral');
  assert.equal(roundScoreTone(0), 'neutral');
  assert.equal(roundScoreTone(-12), 'negative');
  assert.equal(roundScoreTone(24), 'positive');
});

test('missing records never fall back to player zones, current occupants, history length or table scores', () => {
  const state = stateFixture('flower-3', 'missing');
  state.game.players[0].huCount = 999;
  state.game.players[0].score = 999;
  state.tableScores[0].totalScore = 999;
  state.game.history = [{ type: 'hu', seat: 0, tile: 0 }];
  const view = roundSummaryView(state);
  for (const player of view.players) {
    assert.equal(player.huCount, null);
    assert.equal(player.roundScore, null);
    assert.equal(player.tableScore, null);
    assert.equal(player.finalHand, null);
    assert.equal(player.melds, null);
    assert.equal(player.wins, null);
    assert.equal(player.dragons.count, null);
  }
  assert.equal(roundSummaryView(stateFixture('flower-3', 'absent')), null);
  assert.equal(roundSummaryView(stateFixture('flower-legacy-1')).players[0].dragons.status, 'unavailable');
  assert.equal(roundSummaryView(stateFixture('flower-legacy-2')).players[0].dragons.status, 'unavailable');
});

test('Chengdu marks dragons inapplicable and preserves winning references without growing the hand', () => {
  const state = stateFixture('chengdu-4');
  const view = roundSummaryView(state);
  assert.equal(view.players[0].dragons.status, 'notApplicable');
  assert.equal(view.players[0].dragons.count, null);
  assert.deepEqual(view.players[0].finalHand, state.game.roundSummary.players[0].finalHand);
  assert.match(roundWinLabel(view.players[0].wins[0]), /自摸 · 已含在手牌/);
  assert.equal(roundWinLabel(view.players[1].wins[0]), '接炮');
  assert.equal(roundWinLabel({ source: 'robKong', virtual: true }), '抢杠 · 共胡');
  assert.equal(roundWinLabel({ source: 'kongDiscard' }), '杠后接炮');
  assert.equal(roundMeldLabel('anGang'), '暗杠');
  assert.equal(roundMeldLabel('unknown'), '副露');
});

test('invalid tile zones and duplicate seats fail closed rather than inventing a smaller valid hand', () => {
  const state = stateFixture();
  const first = state.game.roundSummary.players[0];
  first.finalHand = [0, null, 3];
  first.huCount = -1;
  first.roundScore = Infinity;
  state.game.roundSummary.players.push(structuredClone(first), { seat: -1 });
  const view = roundSummaryView(state);
  assert.equal(view.players.length, 3);
  assert.equal(view.players[0].finalHand, null);
  assert.equal(view.players[0].huCount, null);
  assert.equal(view.players[0].roundScore, null);
});

test('actual completed engine summary preserves pointsPerOpponent and exact terminal hands through display normalization', () => {
  let game = flower.createGame({ seed: 45, rules: { dragonStartCount: 1 } });
  // 只执行服务器已有合法动作，直到真实终局；神龙细节不是用显示夹具编造的预期字段。
  // Execute existing allowlisted actions to a real finish; dragon fields come from actual server settlement rather than a display fixture.
  for (let step = 0; game.phase !== 'finished' && step < 1000; step++) {
    const choices = game.players.flatMap((_, seat) => flower.getLegalActions(game, seat).map((action) => ({ seat, action })));
    const choice = choices.find(({ action }) => action.type === 'hu') ?? choices.find(({ action }) => action.type === 'pass') ?? choices.find(({ action }) => action.type === 'discard') ?? choices[0];
    assert.ok(choice);
    game = flower.applyAction(game, choice.seat, choice.action);
    flower.assertGameInvariants(game);
  }
  assert.equal(game.phase, 'finished');
  const summary = engineFor(game).roundSummary(game);
  const view = roundSummaryView({ phase: 'finished', game: { ...game, roundSummary: summary } });
  assert.ok(summary.players.some((player) => player.dragons.details.length));
  for (const [seat, player] of view.players.entries()) {
    assert.deepEqual(player.finalHand, game.players[seat].hand);
    assert.equal(player.huCount, game.players[seat].huCount);
    assert.deepEqual(player.dragons.details, summary.players[seat].dragons.details);
    assert.ok(player.dragons.details.every((detail) => typeof detail.pointsPerOpponent === 'number'));
    assert.equal(player.tableScore, null, 'Engine-only summary has no room identity total to guess');
  }
});

test('overview keeps one vertical viewport, wrapped zones and keyboard-reachable native details', () => {
  const component = readFileSync(new URL('../src/RoundSummary.vue', import.meta.url), 'utf8');
  assert.match(component, /data-round-summary-scroll/);
  assert.match(component, /\.round-summary \{[^}]*overflow-y: auto;[^}]*overflow-x: hidden;/);
  assert.match(component, /\.round-tile-run \{[^}]*flex-wrap: wrap;/);
  assert.doesNotMatch(component, /overflow-x: auto|round-tile-scroll/);
  assert.match(component, /<summary tabindex="0">/);
  assert.match(component, /结束时手牌/);
  assert.match(component, /每家付 \{\{ dragon.pointsPerOpponent \}\} 分/);
  assert.match(component, /本局净分/);
  assert.match(component, /本桌累计/);
});

// 以渐变最暗端测普通小字号对比度；这只是数值检查，实际浏览器外观由独立验收覆盖。
// Check small-text contrast against the darkest gradient endpoint; actual browser appearance is verified separately.
test('summary text palette meets AA normal-text contrast on the darkest modal background', () => {
  const luminance = (hex) => {
    const channels = hex.match(/[a-f\d]{2}/g).map((value) => parseInt(value, 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  for (const color of ['6d624d', '775f32', '276548', 'a34237', '665f4d']) {
    assert.ok((luminance('eee2c5') + 0.05) / (luminance(color) + 0.05) >= 4.5, color);
  }
});
