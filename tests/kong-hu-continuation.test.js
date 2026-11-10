// 胡牌消费杠后接胡机会；覆盖新动作、旧保存态、音画分段和真实新杠，不重算旧账。
// Hu consumes post-kong claim eligibility across new actions, saved states and presentation, without rescoring old ledgers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, applyPresentedAction, continuePresentedGame, getLegalActions,
  getHuDiagnostic, getPlayerView, assertGameInvariants } from '../shared/game.js';
import { variableFixture } from './fixtures/variable-table.js';
import { kongContinuationFixture, oldContinuationDiscard, oldContinuationClaim, waitsFourDots } from './fixtures/kong-hu-continuation.js';

// 每个展示段都往返JSON并验证不变量，再继续；返回值是下一个真实决策窗口。
// Round-trip and validate every presentation segment before advancing to the next actual decision window.
function drain(game) {
  while (game.presentation) {
    assertGameInvariants(game);
    game = continuePresentedGame(JSON.parse(JSON.stringify(game)));
  }
  assertGameInvariants(game);
  return game;
}

// 所有合法杠种、首胡/再次胡、自动/手动与分段入口都必须消费旧杠标记。
// Every self-kong kind, first/repeat hu, manual/automatic mode and presentation entry must consume the old marker.
for (const type of ['anGang', 'buGang', 'addGang']) {
  for (const alreadyWon of [false, true]) {
    for (const automatic of [false, true]) {
      for (const presented of [false, true]) {
        test(`${type}: ${alreadyWon ? 'repeat' : 'first'} kong hu protects ${automatic ? 'automatic' : 'manual'} continuation (${presented ? 'paced' : 'immediate'})`, () => {
          const act = presented ? applyPresentedAction : applyAction;
          let game = kongContinuationFixture({ type, alreadyWon, autoDiscardAfterHu: automatic });
          game = drain(act(game, 0, { type, tile: 0 }));
          assert.equal(game.lastDraw.source, 'replacement');
          assert.equal(game.players[0].pendingKongDiscard, true);
          const before = structuredClone(game);
          game = drain(act(JSON.parse(JSON.stringify(game)), 0, { type: 'hu' }));
          assert.equal(game.players[0].pendingKongDiscard, false);
          assert.equal(game.history.find(event => event.type === 'hu').score.kongReplacementBonus, 1);
          if (!automatic) {
            assert.equal(game.lastDraw.source, 'continuation');
            assert.equal(game.lastDraw.tile, 12);
            game = drain(act(JSON.parse(JSON.stringify(game)), 0, { type: 'pass' }));
          }
          assert.equal(game.discards[0].tile, 12);
          assert.equal(game.discards[0].afterKong, false);
          assert.equal(game.discards[0].huSeats, undefined);
          assert.equal(game.history.filter(event => event.type === 'hu').length, 1);
          assert.notEqual(game.phase, 'claim');
          assert.deepEqual(game.rules, before.rules);
          assert.deepEqual(game.history.slice(0, before.history.length), before.history);
          assertGameInvariants(game);
        });
      }
    }
  }
}

// 真明杠仍从实际出牌者收费，但补摸胡后不再延续弃牌资格。
// A real exposed-kong replacement charges its actual source, then expires discard eligibility upon hu.
test('exposed-kong hu keeps its source-only payer and protects its continuation discard', () => {
  let game = variableFixture({ playerCount: 3, deckCount: 2, currentSeat: 1, drawTile: 0,
    hands: [[0, 0, 0, 1, 2, 3, 6, 7, 8, 9, 10, 11, 4], [...waitsFourDots, 0], waitsFourDots],
    head: [4, 12, 6], rules: { specialHuPatterns: false, autoDiscardAfterHu: true } });
  game = applyAction(game, 1, { type: 'discard', tile: 0 });
  game = applyAction(game, 0, { type: 'mingGang', tile: 0 });
  game = applyAction(game, 0, { type: 'hu' });
  const event = game.history.find(item => item.type === 'hu');
  assert.deepEqual(event.payments.filter(payment => payment.delta < 0).map(payment => payment.seat), [1]);
  assert.equal(event.score.kongReplacementBonus, 1);
  assert.equal(game.discards.at(-1).afterKong, false);
  assert.equal(game.discards.at(-1).tile, 12);
  assertGameInvariants(game);
});

// 原杠不胡直接弃牌仍可接胡；已胡者也保留这条例外，但不能碰或明杠。
// Direct replacement discards remain claimable even from prior winners, without allowing peng or exposed kong.
for (const alreadyWon of [false, true]) {
  test(`genuine replacement discard remains claimable from ${alreadyWon ? 'won' : 'unwon'} source`, () => {
    let game = kongContinuationFixture({ alreadyWon, autoDiscardAfterHu: false, head: [12, 6] });
    game = applyAction(game, 0, { type: 'anGang', tile: 0 });
    game = applyAction(game, 0, alreadyWon ? { type: 'pass' } : { type: 'discard', tile: 12 });
    assert.equal(game.discards[0].afterKong, true);
    assert.ok(getLegalActions(game, 1).some(action => action.type === 'hu'));
    assert.ok(getLegalActions(game, 1).every(action => ['hu', 'pass'].includes(action.type)));
    game = applyAction(game, 1, { type: 'hu' });
    const event = game.history.find(item => item.type === 'hu');
    assert.equal(event.source, 'kongDiscard');
    assert.equal(event.score.kongDiscardBonus, 1);
    assert.deepEqual(event.payments.filter(payment => payment.delta < 0).map(payment => payment.seat), [0]);
    assertGameInvariants(game);
  });
}

test('a fresh kong after a kong hu creates a new claimable replacement discard', () => {
  let game = kongContinuationFixture({ autoDiscardAfterHu: false, head: [4, 0, 12, 6] });
  game = applyAction(game, 0, { type: 'anGang', tile: 0 });
  game = applyAction(game, 0, { type: 'hu' });
  assert.equal(game.players[0].pendingKongDiscard, false);
  assert.equal(game.lastDraw.source, 'continuation');
  game = applyAction(game, 0, { type: 'addGang', tile: 0 });
  assert.equal(game.players[0].pendingKongDiscard, true);
  assert.equal(game.lastDraw.source, 'replacement');
  game = applyAction(game, 0, { type: 'pass' });
  assert.equal(game.discards[0].afterKong, true);
  assert.ok(getLegalActions(game, 1).some(action => action.type === 'hu'));
  assertGameInvariants(game);
});

// 连续自摸不是连续杠；第二次自摸不加杠上花，最后续摸弃牌仍受保护。
// Consecutive wins are not consecutive kongs: only the replacement win gains event fan and later discards remain protected.
test('consecutive self draws do not revive a consumed kong opportunity', () => {
  let game = kongContinuationFixture({ head: [4, 4, 12, 6] });
  game = applyAction(game, 0, { type: 'anGang', tile: 0 });
  game = applyAction(game, 0, { type: 'hu' });
  assert.equal(game.lastDraw.source, 'continuation');
  assert.equal(game.players[0].pendingKongDiscard, false);
  game = applyAction(game, 0, { type: 'hu' });
  const wins = game.history.filter(event => event.type === 'hu');
  assert.equal(wins.length, 2);
  assert.equal(wins[0].score.kongReplacementBonus, 1);
  assert.equal(wins[1].score.kongReplacementBonus, undefined);
  assert.equal(game.discards[0].afterKong, false);
  assertGameInvariants(game);
});

// 胡牌展示或已经续摸时保存的旧true不能漏到下一张弃牌；已结束路径同样清掉。
// Stale true markers saved during hu presentation or after continuation draws cannot leak into the next discard, including terminal paths.
for (const boundary of ['hu', 'continuation', 'wallExhausted', 'allPlayersHu']) {
  test(`restored stale kong marker expires at ${boundary}`, () => {
    let game = kongContinuationFixture({ autoDiscardAfterHu: false });
    game = applyAction(game, 0, { type: 'anGang', tile: 0 });
    if (boundary === 'allPlayersHu') {
      game.players[1].huCount = 1;
      game.players[2].huCount = 1;
    }
    if (boundary === 'wallExhausted') {
      game.retiredTiles.push(...game.wall.splice(0).map(tile => ({ tile, seat: 0 })));
    }
    game = applyPresentedAction(game, 0, { type: 'hu' });
    if (boundary === 'continuation') game = drain(game);
    game.players[0].pendingKongDiscard = true;
    const before = structuredClone(game);
    game = boundary === 'continuation'
      ? applyAction(JSON.parse(JSON.stringify(game)), 0, { type: 'pass' })
      : drain(JSON.parse(JSON.stringify(game)));
    if (boundary === 'hu') game = applyAction(game, 0, { type: 'pass' });
    assert.equal(game.players[0].pendingKongDiscard, false);
    if (boundary === 'allPlayersHu' || boundary === 'wallExhausted') {
      assert.equal(game.phase, 'finished');
      assert.equal(game.finishReason, boundary);
    } else assert.equal(game.discards[0].afterKong, false);
    assert.deepEqual(game.history.slice(0, before.history.length), before.history);
    assert.deepEqual(game.rules, before.rules);
    assertGameInvariants(game);
  });
}

test('an old pending discard presentation cannot open a continuation hu window', () => {
  const saved = oldContinuationDiscard();
  const before = structuredClone(saved);
  const next = drain(saved);
  assert.notEqual(next.phase, 'claim');
  assert.equal(next.history.filter(event => event.type === 'hu').length, 1);
  assert.deepEqual(saved, before);
  assert.deepEqual(next.discards[0], before.discards[0]);
  assert.deepEqual(next.history.slice(0, before.history.length), before.history);
});

test('old unanswered continuation claims permit only pass, including a prior winner', () => {
  let game = oldContinuationClaim({ repeatedResponder: true });
  const before = structuredClone(game);
  for (const seat of [1, 2]) {
    assert.deepEqual(getLegalActions(game, seat), [{ type: 'pass' }]);
    assert.equal(getHuDiagnostic(game, seat).code, 'PROTECTED_DISCARD');
    assert.deepEqual(getPlayerView(game, seat).legalActions, [{ type: 'pass' }]);
    assert.throws(() => applyAction(game, seat, { type: 'hu' }));
  }
  assert.deepEqual(game, before);
  game = applyAction(game, 1, { type: 'pass' });
  game = applyAction(game, 2, { type: 'pass' });
  assert.notEqual(game.phase, 'claim');
  assert.equal(game.history.filter(event => event.type === 'hu').length, 1);
  assert.deepEqual(game.history.slice(0, before.history.length), before.history);
  assertGameInvariants(game);
});

test('an already accepted old hu remains committed while later responders can only pass', () => {
  const game = oldContinuationClaim({ acceptedSeat: 1 });
  const before = structuredClone(game);
  assert.deepEqual(getLegalActions(game, 1), []);
  assert.deepEqual(getLegalActions(game, 2), [{ type: 'pass' }]);
  const next = applyAction(game, 2, { type: 'pass' });
  assert.deepEqual(game, before);
  const event = next.history.filter(item => item.type === 'hu').at(-1);
  assert.equal(event.seat, 1);
  assert.equal(event.source, 'kongDiscard');
  assert.equal(event.score.kongDiscardBonus, 1);
  assert.deepEqual(next.history.slice(0, before.history.length), before.history);
  assert.deepEqual(next.rules, before.rules);
  assertGameInvariants(next);
});

// 无完整对应证据时保留已提交来源，不扫描穿越新杠来推断旧错误。
// Preserve committed provenance without complete matching evidence; never infer stale state across a fresh kong.
for (const evidence of ['missing', 'mismatchedTile', 'mismatchedCount', 'newKong']) {
  test(`legacy claim provenance is not guessed with ${evidence} evidence`, () => {
    const game = oldContinuationClaim();
    if (evidence === 'missing') game.history = [];
    if (evidence === 'mismatchedTile') game.history.at(-1).tile = 13;
    if (evidence === 'mismatchedCount') game.history.unshift({ type: 'discard', seat: 1, tile: 0 });
    if (evidence === 'newKong') game.history.splice(-1, 0, { type: 'addGang', seat: 0, fromSeat: null });
    const before = structuredClone(game);
    assert.ok(getLegalActions(game, 1).some(action => action.type === 'hu'));
    assert.equal(getHuDiagnostic(game, 1).code, 'AVAILABLE');
    assert.deepEqual(game, before);
  });
}
