// 胡后杠必须保留固定手牌/牌型，不能仅复用特殊听口；权威入口同时保护保存局。
// Post-hu kongs preserve the fixed hand/pattern rather than trusting expanded waits; authoritative entries protect restored games too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, applyPresentedAction, continuePresentedGame, getLegalActions,
  getPlayerView, getWaitTiles, assertGameInvariants } from '../shared/game.js';
import { variableFixture, meld, scattered } from './fixtures/variable-table.js';
import { sevenPairShapes, sevenPairsAfterHu } from './fixtures/post-hu-pattern.js';

// 先真实七对胡，再给非听口牌；覆盖普通/四张/双四张/六张/清七对及三种摸牌来源。
// Win seven pairs before drawing a nonwait; cover ordinary/quad/double-quad/sextuple/pure forms and all draw sources.
for (const shape of Object.keys(sevenPairShapes)) for (const source of ['normal', 'continuation', 'replacement']) {
  test(`${shape} seven pairs never offers a post-hu kong after a ${source} nonwinning draw`, () => {
    const game = sevenPairsAfterHu({ shape });
    game.lastDraw.source = source;
    const before = structuredClone(game);
    assert.equal(game.players[0].firstHuPattern.kind, 'sevenPairs');
    assert.deepEqual(getLegalActions(game, 0), [{ type: 'pass' }]);
    assert.deepEqual(getPlayerView(game, 0).legalActions, [{ type: 'pass' }]);
    for (const apply of [applyAction, applyPresentedAction]) {
      assert.throws(() => apply(game, 0, { type: 'anGang', tile: 0 }), /当前不能执行/);
      assert.deepEqual(game, before);
    }
    const next = applyPresentedAction(JSON.parse(JSON.stringify(game)), 0, { type: 'pass' });
    assert.deepEqual(next.players[0].hand, sevenPairShapes[shape].slice(0, -1));
    assert.deepEqual(next.players[0].melds, []);
    assert.deepEqual(next.players[0].firstHuPattern, before.players[0].firstHuPattern);
    assert.deepEqual(next.players.map(player => player.score), before.players.map(player => player.score));
    assertGameInvariants(next);
  });
}

for (const automatic of [true, false]) for (const preserveWaits of [true, false, undefined]) {
  test(`seven-pairs guard survives saved wait flag ${preserveWaits} and automatic ${automatic}`, () => {
    const game = sevenPairsAfterHu({ boundary: true });
    game.rules.autoDiscardAfterHu = automatic;
    if (preserveWaits === undefined) delete game.rules.preserveWaitsOnPostHuKong;
    else game.rules.preserveWaitsOnPostHuKong = preserveWaits;
    const before = structuredClone(game);
    const next = continuePresentedGame(JSON.parse(JSON.stringify(game)));
    assert.deepEqual(next.players[0].melds, []);
    assert.deepEqual(next.players[0].firstHuPattern, before.players[0].firstHuPattern);
    assert.deepEqual(next.rules, before.rules);
    if (automatic) {
      assert.equal(next.discards.at(-1).tile, 17);
      assert.deepEqual(next.players[0].hand, sevenPairShapes.quadruple.slice(0, -1));
    } else assert.deepEqual(getLegalActions(next, 0), [{ type: 'pass' }]);
    assert.deepEqual(game, before);
    assertGameInvariants(next);
  });
}

// 完整胡型同样能拆成普通形时，首胡认作七对后也不能改认普通胡来放行杠。
// A dual-decomposition hand remains seven pairs after that classification; it cannot switch to a standard decomposition to authorize a kong.
test('a seven-pairs hand with a standard decomposition remains fixed and keeps repeat-win fan', () => {
  const hand = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5];
  let game = variableFixture({ playerCount: 3, deckCount: 2, hands: [hand], drawTile: 5,
    head: [17, 0, 17], rules: { autoDiscardAfterHu: false } });
  game = applyPresentedAction(game, 0, { type: 'hu' });
  const first = game.history.find(event => event.type === 'hu');
  game = continuePresentedGame(game);
  assert.deepEqual(getLegalActions(game, 0), [{ type: 'pass' }]);
  // 用真实墙中同牌替换本次非听口摸牌，保存实体配额；模拟后续摸到原特殊听口。
  // Exchange with a real wall copy to preserve the physical budget while simulating the next matching special wait.
  game.players[0].hand[game.players[0].hand.indexOf(17)] = 0;
  game.players[0].hand.sort((a, b) => a - b);
  game.wall[game.wall.indexOf(0)] = 17;
  game.lastDraw.tile = 0;
  assert.deepEqual(getLegalActions(game, 0), [{ type: 'hu' }]);
  game = applyPresentedAction(game, 0, { type: 'hu' });
  const repeat = game.history.filter(event => event.type === 'hu').at(-1);
  assert.equal(repeat.score.fan, first.score.fan);
  assert.deepEqual(game.players[0].melds, []);
  assertGameInvariants(game);
});

// false/缺字段旧局也不能拆掉原听口；当前同牌摸入只是必要条件，并非足够条件。
// False/missing old flags cannot permit lost waits: a matching current draw is necessary, not sufficient.
for (const preserveWaits of [true, false, undefined]) {
  test(`ordinary post-hu kong cannot remove a wait with saved flag ${preserveWaits}`, () => {
    const base = [5, 5, 5, 7];
    const melds = [meld(9), meld(10), meld(11)];
    const game = variableFixture({ playerCount: 3, deckCount: 2, hands: [[...base, 5]], drawTile: 5,
      melds: [melds], huCounts: [1],
      rules: { specialHuPatterns: false, preserveWaitsOnPostHuKong: preserveWaits ?? true } });
    if (preserveWaits === undefined) delete game.rules.preserveWaitsOnPostHuKong;
    assert.deepEqual(getWaitTiles(base, melds, game.rules), [6, 7]);
    assert.deepEqual(getWaitTiles([7], [...melds, meld(5)], game.rules), [7]);
    assert.deepEqual(getLegalActions(game, 0), [{ type: 'pass' }]);
    const before = structuredClone(game);
    assert.throws(() => applyAction(game, 0, { type: 'anGang', tile: 5 }), /当前不能执行/);
    assert.deepEqual(game, before);
  });
}

// 即使听口相同，也不能将原有四张拿走、把不同的新牌留在锁定手牌中。
// Equal waits do not authorize removing four held tiles while retaining a different newly drawn tile.
test('an unrelated draw cannot replace a held quadruple after hu even when structural waits match', () => {
  const base = [0, 0, 0, 0, 1, 2, 3, 4, 5, 9, 10, 11, 17];
  const game = variableFixture({ playerCount: 3, deckCount: 2, hands: [[...base, 3]], drawTile: 3,
    huCounts: [1], rules: { specialHuPatterns: false } });
  assert.deepEqual(getWaitTiles(base, [], game.rules), [17]);
  assert.deepEqual(getWaitTiles([...base.filter(tile => tile !== 0), 3], [meld(0)], game.rules), [17]);
  assert.deepEqual(getLegalActions(game, 0), [{ type: 'pass' }]);
  assert.throws(() => applyAction(game, 0, { type: 'anGang', tile: 0 }), /当前不能执行/);
});

// 保存旧窗口时只过滤未回应明杠，保留过牌收束；已接受回应仍属于原提交，不回滚旧账。
// Filter only unanswered saved exposed kongs and retain pass to close the window; accepted responses remain committed.
test('saved seven-pairs exposed-kong options are filtered without mutating the snapshot', () => {
  const game = sevenPairsAfterHu();
  game.players[0].hand.splice(game.players[0].hand.indexOf(17), 1);
  game.wall.push(17);
  game.wall.splice(game.wall.indexOf(0), 1);
  game.discards.push({ seat: 1, tile: 0, claimable: true, afterKong: false });
  game.lastDraw = null;
  game.phase = 'claim';
  game.turnStep = null;
  game.currentSeat = 1;
  game.claim = { tile: 0, discardSeat: 1, discardIndex: 0, eligibleSeats: [0, 2],
    options: { 0: [{ type: 'mingGang', tile: 0 }], 2: [] }, responses: {} };
  assertGameInvariants(game);
  const before = structuredClone(game);
  assert.deepEqual(getPlayerView(game, 0).legalActions, [{ type: 'pass' }]);
  assert.throws(() => applyAction(game, 0, { type: 'mingGang', tile: 0 }), /当前不能执行/);
  assert.deepEqual(game, before);
  let next = applyAction(JSON.parse(JSON.stringify(game)), 0, { type: 'pass' });
  next = applyAction(next, 2, { type: 'pass' });
  assert.deepEqual(next.players[0].melds, []);
  assertGameInvariants(next);
  game.claim.responses[0] = { type: 'mingGang', tile: 0 };
  assert.deepEqual(getLegalActions(game, 0), []);
  next = applyPresentedAction(game, 2, { type: 'pass' });
  assert.equal(next.players[0].melds[0].type, 'mingGang');
  assertGameInvariants(next);
});

// 没有胡过的四张仍可暗杠，不能把“七对胡后锁定”误变成“手里可能七对就不能杠”。
// Unwon players may still kong four held tiles; a possible seven-pairs hand is not yet a fixed seven-pairs win.
test('unwon players keep concealed kongs from held quadruples after an unrelated draw', () => {
  const game = variableFixture({ playerCount: 3, deckCount: 2,
    hands: [[...sevenPairShapes.quadruple.slice(0, -1), 17], scattered, scattered], drawTile: 17 });
  assert.ok(getLegalActions(game, 0).some(action => action.type === 'anGang' && action.tile === 0));
  assertGameInvariants(applyPresentedAction(game, 0, { type: 'anGang', tile: 0 }));
});

// 原刻子移到杠区不改顺子/对子和花色；普通、对对胡、清对对仍可真实暗杠。
// Moving an existing triplet to a kong preserves sequences/pairs/suit; standard, all-triplets and pure all-triplets stay legal.
for (const [name, base] of Object.entries({
  standard: [0, 0, 0, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17],
  allTriplets: [0, 0, 0, 3, 3, 3, 9, 9, 9, 12, 12, 12, 17],
  pureAllTriplets: [0, 0, 0, 2, 2, 2, 4, 4, 4, 6, 6, 6, 8],
})) {
  test(`${name} retains a legal matching-draw concealed kong and its winning pattern`, () => {
    const winningTile = base.at(-1);
    let game = variableFixture({ playerCount: 3, deckCount: 2, hands: [[...base, winningTile]],
      drawTile: winningTile, head: [0, winningTile], rules: { autoDiscardAfterHu: false } });
    game = applyAction(game, 0, { type: 'hu' });
    const pattern = structuredClone(game.players[0].firstHuPattern);
    assert.equal(pattern.kind, 'standard');
    assert.deepEqual(getLegalActions(game, 0), [{ type: 'anGang', tile: 0 }]);
    game = applyAction(game, 0, { type: 'anGang', tile: 0 });
    assert.deepEqual(getLegalActions(game, 0), [{ type: 'hu' }]);
    game = applyPresentedAction(game, 0, { type: 'hu' });
    assert.deepEqual(game.players[0].firstHuPattern, pattern);
    assertGameInvariants(game);
  });
}

test('a prior standard winner may still expose a structural triplet from an unwon source discard', () => {
  let game = variableFixture({ playerCount: 3, deckCount: 2, currentSeat: 1, drawTile: 0,
    hands: [[0, 0, 0, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17], [...scattered, 0], scattered],
    huCounts: [1], head: [17], rules: { specialHuPatterns: false } });
  game = applyAction(game, 1, { type: 'discard', tile: 0 });
  assert.ok(getLegalActions(game, 0).some(action => action.type === 'mingGang' && action.tile === 0));
  game = applyPresentedAction(game, 0, { type: 'mingGang', tile: 0 });
  assert.equal(game.players[0].melds[0].type, 'mingGang');
  assertGameInvariants(game);
});
