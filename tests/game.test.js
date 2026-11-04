import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, getPlayerView, getLegalActions, isWinningHand, getWaitTiles, assertGameInvariants, getHuDiagnostic, fanToPoints } from '../shared/game.js';
import { postHuKongGame } from './fixtures/post-hu-kong.js';

const waiting = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
const winning = [...waiting, 17];
const nonWinningKong = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 16, 17];
const pengHand = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 17, 17];
const kongHand = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 17, 17, 17];
const meld = (tile, type = 'peng', count = type === 'peng' ? 3 : 4) => ({ type, tile, tiles: Array(count).fill(tile) });
const has = (game, seat, type, tile) => getLegalActions(game, seat).some(action => action.type === type && (tile === undefined || action.tile === tile));
const doAction = (game, seat, type, tile) => applyAction(game, seat, tile === undefined ? { type } : { type, tile });
const huEvent = (game, seat = 0) => game.history.find(event => event.type === 'hu' && event.seat === seat);
const noZero = waiting.map(tile => tile === 0 ? 6 : tile);

/** Eight-copy physical fixture. Prior logical wins reference retired physical tiles. */
function fixture({ hands = [winning, waiting, waiting], melds = [[], [], []], radishes = [[], [], []],
  huCounts = [0, 0, 0], priorWins = [[], [], []], locks = [[], [], []], activeLocks = [false, false, false],
  currentSeat = 0, turnStep = 'discard', drawTile = hands[currentSeat]?.at(-1), drawKind = 'normal',
  head = [], tail = [], rules = {}, wallCount, kongSeats = [], firstHuRadishesRevealed = huCounts.some(count => count > 0) } = {}) {
  const game = createGame({ seed: 'fixture', rules: { specialHuPatterns: false, bigSingleReadyPayment: false, ...rules } });
  game.players.forEach((player, seat) => {
    player.hand = [...hands[seat]].sort((a, b) => a - b);
    player.melds = structuredClone(melds[seat]); player.radishes = [...radishes[seat]];
    player.winPile = priorWins[seat].map(tile => ({ tile, source: 'selfDraw', virtual: false }));
    player.huCount = huCounts[seat]; player.lockedWaits = [...locks[seat]];
    player.huLockActive = activeLocks[seat]; player.pendingKongDiscard = kongSeats.includes(seat);
    player.kongCount = melds[seat].filter(item => item.type !== 'peng').length;
  });
  game.phase = 'turn'; game.currentSeat = currentSeat; game.turnStep = turnStep; game.drawKind = drawKind;
  game.lastDraw = turnStep === 'discard' && drawTile !== null ? { seat: currentSeat, tile: drawTile, source: drawKind } : null;
  game.firstHuRadishesRevealed = firstHuRadishesRevealed;
  game.discards = []; game.retiredTiles = priorWins.flatMap((wins, seat) => wins.map(tile => ({ seat, tile })));
  game.history = []; game.revision = 0;
  const counts = Array(18).fill(8);
  const use = tile => { assert.ok(--counts[tile] >= 0, `Fixture overused tile ${tile}`); };
  for (const player of game.players) [...player.hand, ...player.melds.flatMap(m => m.tiles), ...player.radishes].forEach(use);
  game.retiredTiles.forEach(item => use(item.tile)); head.forEach(use); tail.forEach(use);
  let rest = counts.flatMap((count, tile) => Array(count).fill(tile));
  if (wallCount !== undefined) {
    const targetRest = wallCount - head.length - tail.length;
    assert.ok(targetRest >= 0);
    game.retiredTiles.push(...rest.splice(targetRest).map(tile => ({ seat: 0, tile })));
  }
  game.wall = [...head, ...rest, ...tail];
  assertGameInvariants(game);
  return game;
}
function passAll(game) {
  while (game.phase === 'claim') game = doAction(game, game.claim.eligibleSeats.find(seat => !game.claim.responses[seat]), 'pass');
  return game;
}
function deterministicRandom(seed) {
  let state = seed + 1;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

test('v3 deterministic deal has 144 tiles, eight copies, 14/13/13 hands', () => {
  const game = createGame({ seed: 42 });
  assert.equal(game.schemaVersion, 3);
  assert.deepEqual(game.players.map(player => player.hand.length), [14, 13, 13]);
  assert.deepEqual(game.players.map(player => player.winPile), [[], [], []]);
  assert.equal(game.wall.length, 104); assert.equal(game.turnStep, 'discard');
  assertGameInvariants(game); assertGameInvariants(createGame());
  assert.deepEqual(game, createGame({ seed: 42 }));
  assert.notDeepEqual(game.wall, createGame({ seed: 43 }).wall);
});

test('rejects malformed and unknown rules, including unsafe optional overlaps', () => {
  for (const rules of [{ sevenPairs: 'yes' }, { baseFan: 0 }, { baseFan: 1.5 }, { sixCopyFan: -1 }, { sevenPlusCopyFan: -1 }, { dragonPoints: { 9: 50 } }, { dragonPoints: null }, { repeatHuLock: 'never' }, { radishScope: 'unknown' }, { bigSingleOverlap: 'both' }, { arbitrary: true }, JSON.parse('{"__proto__":true}')]) assert.throws(() => createGame({ seed: 1, rules }));
});

test('winning shape, seven pairs, exposed melds and suit boundaries', () => {
  assert.equal(isWinningHand(winning), true); assert.equal(isWinningHand(waiting), false);
  assert.equal(isWinningHand([7, 8, 9, 0, 1, 2, 3, 4, 5, 12, 13, 14, 17, 17]), false);
  assert.equal(isWinningHand([0, 1, 2, 9, 10, 11, 17, 17], 2), true);
  assert.equal(isWinningHand([0, 1, 2, 9, 10, 11, 17, 17], 1), false);
  assert.equal(isWinningHand(Array(14).fill(0)), false);
  const pairs = [0, 0, 0, 0, 2, 2, 4, 4, 6, 6, 9, 9, 11, 11];
  assert.equal(isWinningHand(pairs), true); assert.equal(isWinningHand(pairs, 0, { sevenPairs: false }), false);
  assert.deepEqual(getWaitTiles(waiting), [17]); assert.deepEqual(getWaitTiles(winning), []);
});

test('immutable validated actions reject wrong turn, manual draw, forged or duplicate inputs', () => {
  const game = createGame({ seed: 3 }); const before = structuredClone(game);
  for (const [seat, action] of [[1, { type: 'discard', tile: 0 }], [0, { type: 'draw' }], [0, { type: 'discard', tile: 18 }], [0, { type: 'discard', tile: '0' }], [0, { type: 'explode' }], [0, { type: 'discard', tile: game.players[0].hand[0], cheat: true }], [3, { type: 'hu' }], [0, null]]) assert.throws(() => applyAction(game, seat, action));
  assert.deepEqual(game, before);
  const next = doAction(game, 0, 'discard', game.players[0].hand[0]);
  assert.notEqual(game, next); assert.deepEqual(game, before); assert.equal(next.revision, 1);
  assertGameInvariants(next);
  const legacy = { ...game }; delete legacy.schemaVersion;
  assert.throws(() => doAction(legacy, 0, 'discard', game.players[0].hand[0]), /旧牌局/);
});

test('next natural draw happens atomically only after all eligible claims pass', () => {
  let game = doAction(fixture({ head: [6] }), 0, 'discard', 17);
  const wall = game.wall.length;
  game = doAction(game, 2, 'pass');
  assert.equal(game.phase, 'claim'); assert.equal(game.wall.length, wall); assert.equal(game.lastDraw, null);
  game = doAction(game, 1, 'pass');
  assert.equal(game.phase, 'turn'); assert.equal(game.currentSeat, 1); assert.equal(game.turnStep, 'discard');
  assert.equal(game.lastDraw.tile, 6); assert.equal(game.wall.length, wall - 1);
  assert.equal(has(game, 1, 'draw'), false);
  assert.equal(game.history.at(-1).tile, undefined);
  assert.equal(getPlayerView(game, 1).drawnTile, 6); assert.equal(getPlayerView(game, 2).drawnTile, null);
});

test('first selfdraw adds six shared tail radishes and leaves a winning continuation playable', () => {
  let game = fixture({ head: [17, 6], tail: [1, 2, 3, 4, 5, 6] });
  const wall = game.wall.length;
  game = doAction(game, 0, 'hu');
  assert.deepEqual(getPlayerView(game, 2).sharedRadishes, [6, 5, 4, 3, 2, 1]);
  assert.equal(game.firstHuRadishesRevealed, true);
  assert.equal(game.players[0].hand.length, 14); assert.equal(game.players[0].huCount, 1);
  assert.deepEqual(game.players[0].winPile, [{ tile: 17, source: 'selfDraw', virtual: false }]);
  assert.deepEqual(game.retiredTiles, [{ seat: 0, tile: 17 }]);
  assert.equal(game.wall.length, wall - 7); assert.equal(game.currentSeat, 0);
  assert.equal(game.players[0].huLockActive, true); assert.equal(has(game, 0, 'hu'), true);
  assert.equal(getHuDiagnostic(game, 0).code, 'AVAILABLE'); assert.deepEqual(game.discards, []);
  game = doAction(game, 0, 'hu');
  assert.equal(game.players[0].huCount, 2); assert.equal(game.players[0].winPile.length, 2);
  assert.equal(getPlayerView(game, 1).sharedRadishes.length, 6);
  assertGameInvariants(game);
});

test('post-hu hand is locked: only just-drawn tile may be discarded, or pass skips it', () => {
  let game = fixture({ huCounts: [1, 0, 0], head: [6] });
  assert.deepEqual(getLegalActions(game, 0).filter(action => action.type === 'discard'), [{ type: 'discard', tile: 17 }]);
  assert.ok(has(game, 0, 'hu') && has(game, 0, 'pass'));
  const before = structuredClone(game);
  assert.throws(() => doAction(game, 0, 'discard', 0)); assert.deepEqual(game, before);
  game = doAction(game, 0, 'pass');
  assert.equal(game.discards[0].tile, 17); assert.equal(game.currentSeat, 1); assert.equal(game.lastDraw.tile, 6);
});

test('normal draw clears the provisional discard lock while continuation selfdraw bypasses it', () => {
  let game = doAction(fixture({ head: [6, 7, 8, 17] }), 0, 'hu');
  assert.equal(game.currentSeat, 1); assert.equal(game.players[0].huLockActive, true);
  game = passAll(doAction(game, 1, 'discard', 7));
  assert.equal(game.currentSeat, 2); assert.equal(game.lastDraw.tile, 8);
  game = passAll(doAction(game, 2, 'discard', 8));
  assert.equal(game.currentSeat, 0); assert.equal(game.lastDraw.tile, 17);
  assert.equal(game.players[0].huLockActive, false); assert.equal(has(game, 0, 'hu'), true);
  game = doAction(game, 0, 'hu');
  assert.equal(game.players[0].huCount, 2); assert.equal(game.players[0].winPile.length, 2);
  assert.equal(getPlayerView(game, 0).sharedRadishes.length, 6); assert.equal(game.retiredTiles.length, 2);
});

test('selfdraw and ordinary discard wins ignore prior temporary wait-lock settings', () => {
  for (const rules of [{}, { allowChangedWaitDuringLock: false }, { repeatHuLock: 'untilWaitChange' }]) {
    const game = fixture({ huCounts: [1, 0, 0], locks: [[16, 17], [], []], activeLocks: [true, false, false], rules });
    assert.equal(has(game, 0, 'hu'), true); assert.equal(getHuDiagnostic(game, 0).code, 'AVAILABLE');
  }
  const source = fixture({ huCounts: [0, 1, 0], locks: [[], [17], []], activeLocks: [false, true, false] });
  const game = doAction(source, 0, 'discard', 17);
  assert.equal(has(game, 1, 'hu'), true); assert.equal(getHuDiagnostic(game, 1).code, 'AVAILABLE');
  assert.equal(has(game, 2, 'hu'), true);
});

test('already-hu players cannot peng and their discards cannot be penged', () => {
  let game = doAction(fixture({ hands: [winning, pengHand, waiting], huCounts: [0, 1, 0] }), 0, 'discard', 17);
  assert.equal(has(game, 1, 'peng'), false);
  game = doAction(fixture({ hands: [winning, pengHand, waiting], huCounts: [1, 0, 0] }), 0, 'discard', 17);
  assert.equal(has(game, 1, 'peng'), false); assert.equal(has(game, 2, 'hu'), false);
  assert.notEqual(game.phase, 'claim');
});

test('ordinary post-hu discard is protected but post-kong discard allows hu paid only by its source', () => {
  let game = doAction(fixture({ huCounts: [1, 0, 0], kongSeats: [0] }), 0, 'discard', 17);
  const discardEvent = game.history.find(event => event.type === 'discard');
  assert.match(discardEvent.message, /杠后出牌，接胡仅出牌者付款/);
  assert.doesNotMatch(discardEvent.message, /按自摸/);
  assert.equal(has(game, 1, 'hu'), true);
  game = doAction(game, 1, 'hu'); game = doAction(game, 2, 'pass');
  const event = huEvent(game, 1);
  assert.equal(event.source, 'kongDiscard'); assert.equal(event.payments.length, 2);
  assert.ok(game.players[0].score < 0); assert.equal(game.players[2].score, 0);
  assert.equal(game.players[0].pendingKongDiscard, false);
});

test('simultaneous hu is response-order independent with physical and virtual win references', () => {
  function result(order) {
    let game = doAction(fixture({ head: [6, 7] }), 0, 'discard', 17);
    for (const seat of order) game = doAction(game, seat, 'hu');
    return game;
  }
  const game = result([1, 2]); assert.deepEqual(game, result([2, 1]));
  assert.deepEqual(game.players.map(player => player.huCount), [0, 1, 1]);
  assert.deepEqual(game.discards[0].huSeats, [1, 2]); assert.equal(game.discards[0].claimedBy, undefined);
  assert.deepEqual(game.players[1].winPile, [{ tile: 17, source: 'discard', virtual: false, discardIndex: 0 }]);
  assert.deepEqual(game.players[2].winPile, [{ tile: 17, source: 'discard', virtual: true, discardIndex: 0 }]);
  assert.equal(huEvent(game, 1).payments.length, 2); assert.equal(huEvent(game, 2).payments.length, 2);
  assertGameInvariants(game);
});

test('third winner ends only after entire simultaneous batch; no extra draw', () => {
  let game = doAction(fixture({ huCounts: [1, 0, 0], kongSeats: [0], head: [6] }), 0, 'discard', 17);
  const wall = game.wall.length;
  game = doAction(game, 2, 'hu');
  assert.equal(game.phase, 'claim'); assert.deepEqual(game.players.map(player => player.huCount), [1, 0, 0]);
  game = doAction(game, 1, 'hu');
  assert.equal(game.phase, 'finished'); assert.equal(game.finishReason, 'allPlayersHu');
  assert.deepEqual(game.players.map(player => player.huCount), [1, 1, 1]);
  assert.equal(game.wall.length, wall); assert.equal(game.history.some(event => event.type === 'draw'), false);
  assert.equal(game.history.filter(event => event.type === 'hu').length, 2);
  assert.equal(game.players[2].winPile[0].virtual, true);
  assertGameInvariants(game);
});

test('third selfdraw winner ends immediately with wall remaining and settled score', () => {
  let game = fixture({ huCounts: [0, 1, 1], head: [6] }); const wall = game.wall.length;
  game = doAction(game, 0, 'hu');
  assert.equal(game.finishReason, 'allPlayersHu'); assert.equal(game.wall.length, wall);
  assert.equal(game.history.some(event => event.type === 'draw'), false);
  assert.equal(game.players[0].hand.length, 13); assert.equal(game.players[0].winPile.length, 1);
  assert.ok(game.players[0].score > 0); assert.deepEqual(getLegalActions(game, 0), []);
});

test('multiple winners can be disabled without adding a virtual win for rejected winner', () => {
  let game = doAction(fixture({ rules: { multipleWinners: false } }), 0, 'discard', 17);
  game = doAction(game, 2, 'hu'); game = doAction(game, 1, 'hu');
  assert.deepEqual(game.players.map(player => player.huCount), [0, 1, 0]);
  assert.equal(game.players[2].winPile.length, 0);
});

test('pending choices remain private and duplicate/unrelated claims are rejected', () => {
  let game = doAction(fixture(), 0, 'discard', 17);
  game = doAction(game, 2, 'hu');
  const view = getPlayerView(game, 1);
  assert.deepEqual(view.claim.respondedSeats, [2]); assert.equal(view.claim.responses, undefined); assert.equal(view.claim.options, undefined);
  assert.equal(getHuDiagnostic(game, 2).code, 'ALREADY_RESPONDED');
  assert.throws(() => doAction(game, 2, 'pass')); assert.throws(() => doAction(game, 0, 'pass'));
});

test('equal peng claims wait for both players then nearest clockwise wins in either order', () => {
  for (const order of [[1, 2], [2, 1]]) {
    let game = doAction(fixture({ hands: [winning, pengHand, pengHand] }), 0, 'discard', 17);
    const wall = game.wall.length;
    game = doAction(game, order[0], 'peng', 17);
    assert.equal(game.phase, 'claim'); assert.equal(game.players[1].melds.length, 0); assert.equal(game.wall.length, wall);
    game = doAction(game, order[1], 'peng', 17);
    assert.equal(game.currentSeat, 1); assert.equal(game.discards[0].claimedBy, 1);
    assert.equal(game.players[1].hand.length, 11); assert.equal(game.players[2].melds.length, 0);
    assert.equal(game.lastDraw, null); assert.equal(has(game, 1, 'hu'), false);
    assertGameInvariants(game);
  }
});

test('farther kong beats nearer peng after both reply, independent of response order', () => {
  const results = [];
  for (const order of [[1, 2], [2, 1]]) {
    let game = doAction(fixture({ hands: [winning, pengHand, kongHand], head: [6], tail: [7] }), 0, 'discard', 17);
    const wall = game.wall.length;
    game = doAction(game, order[0], order[0] === 1 ? 'peng' : 'mingGang', 17);
    assert.equal(game.phase, 'claim'); assert.equal(game.wall.length, wall); assert.deepEqual(game.players.map(player => player.score), [0, 0, 0]);
    game = doAction(game, order[1], order[1] === 1 ? 'peng' : 'mingGang', 17);
    assert.equal(game.currentSeat, 2); assert.equal(game.players[1].melds.length, 0);
    assert.equal(game.players[2].melds[0].type, 'mingGang'); assert.equal(game.discards[0].claimedBy, 2);
    assert.deepEqual(game.players.map(player => player.score), [-2, 0, 2]); results.push(game);
  }
  assert.deepEqual(results[0], results[1]);
});

test('equal kong claims use clockwise order; hu outranks kong and peng', () => {
  const dealer = [...waiting, 16];
  let game = doAction(fixture({ hands: [dealer, kongHand, kongHand], head: [6] }), 0, 'discard', 17);
  game = doAction(game, 2, 'mingGang', 17); game = doAction(game, 1, 'mingGang', 17);
  assert.equal(game.discards[0].claimedBy, 1);
  game = doAction(fixture({ hands: [winning, kongHand, waiting] }), 0, 'discard', 17);
  game = doAction(game, 1, 'mingGang', 17); game = doAction(game, 2, 'hu');
  assert.equal(game.players[1].melds.length, 0); assert.equal(game.players[2].huCount, 1);
  assert.equal(game.history.some(event => event.type === 'mingGang'), false);
});

test('hu suppresses a simultaneous kong choice in hand and on another player discard', () => {
  const hand = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17];
  let game = fixture({ hands: [hand, waiting, waiting], drawTile: 0 });
  assert.equal(has(game, 0, 'hu'), true); assert.equal(has(game, 0, 'anGang', 0), false);
  assert.throws(() => doAction(game, 0, 'anGang', 0));
  const base = [...hand]; base.splice(base.indexOf(0), 1);
  game = doAction(fixture({ hands: [winning, base, waiting] }), 0, 'discard', 0);
  assert.equal(has(game, 1, 'hu'), true); assert.equal(has(game, 1, 'mingGang', 0), false);
});

test('concealed kong pays each opponent 2, defers its radish until first hu and draws head replacement', () => {
  let game = fixture({ hands: [nonWinningKong, waiting, waiting], head: [6], tail: [7], drawTile: 0 });
  const wall = game.wall.length;
  game = doAction(game, 0, 'anGang', 0);
  assert.deepEqual(game.players.map(player => player.score), [4, -2, -2]);
  assert.deepEqual(game.players[0].radishes, []); assert.equal(game.pendingKongRadishes, 1); assert.equal(game.wall.at(-1), 7); assert.equal(game.lastDraw.tile, 6);
  assert.equal(game.players[0].hand.length, 11); assert.equal(game.wall.length, wall - 1);
  assert.equal(game.players[0].pendingKongDiscard, true); assert.equal(game.players[0].kongCount, 1);
  const view = getPlayerView(game, 1);
  assert.deepEqual(view.players[0].melds[0].tiles, [null, null, null, null]);
  assert.equal(game.history.find(event => event.type === 'anGang').tile, undefined);
  const before = structuredClone(game); assert.throws(() => doAction(game, 0, 'anGang', 0)); assert.deepEqual(game, before);
  assertGameInvariants(game);
});

test('peng upgrade pays each opponent 1, preserves meld count and accrues one pending radish', () => {
  const hand = [0, 1, 2, 3, 9, 10, 11, 12, 13, 16, 17];
  let game = fixture({ hands: [hand, waiting, waiting], melds: [[meld(0)], [], []], head: [6], tail: [7], drawTile: 0 });
  game = doAction(game, 0, 'buGang', 0);
  assert.deepEqual(game.players.map(player => player.score), [2, -1, -1]);
  assert.equal(game.players[0].melds.length, 1); assert.equal(game.players[0].melds[0].tiles.length, 4);
  assert.deepEqual(game.players[0].radishes, []); assert.equal(game.pendingKongRadishes, 1); assert.equal(game.wall.at(-1), 7); assert.equal(game.lastDraw.tile, 6);
  assertGameInvariants(game);
});

test('existing kong can add a fifth and sixth tile, with another 1 each, radish and replacement', () => {
  let game = fixture({ hands: [nonWinningKong, waiting, waiting], head: [0, 6], tail: [7, 8], drawTile: 0 });
  game = doAction(game, 0, 'anGang', 0); assert.equal(has(game, 0, 'addGang', 0), true);
  game = doAction(game, 0, 'addGang', 0);
  assert.deepEqual(game.players.map(player => player.score), [6, -3, -3]);
  assert.equal(game.players[0].melds[0].tiles.length, 5); assert.equal(game.players[0].melds.length, 1);
  assert.deepEqual(game.players[0].radishes, []); assert.equal(game.pendingKongRadishes, 2); assert.deepEqual(game.wall.slice(-2), [7, 8]); assert.equal(game.lastDraw.tile, 6); assert.equal(game.players[0].kongCount, 2);
  assert.equal(getPlayerView(game, 1).players[0].melds[0].tiles.length, 5);
  assert.equal(game.history.find(event => event.type === 'addGang').tile, undefined);
  const hand = [0, 1, 2, 3, 9, 10, 11, 12, 13, 16, 17];
  game = fixture({ hands: [hand, waiting, waiting], melds: [[meld(0, 'anGang', 5)], [], []], drawTile: 0 });
  assert.equal(has(game, 0, 'addGang', 0), true);
  game = doAction(game, 0, 'addGang', 0); assert.equal(game.players[0].melds[0].tiles.length, 6);
});

test('post-hu concealed kong preserves whole wait set and replacement can hu immediately', () => {
  const hand = [0, 0, 0, 0, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
  let game = fixture({ hands: [hand, waiting, waiting], drawTile: 0, huCounts: [1, 0, 0], locks: [[17], [], []], activeLocks: [true, false, false], head: [17, 6], tail: [7] });
  assert.equal(has(game, 0, 'anGang', 0), true);
  game = doAction(game, 0, 'anGang', 0);
  assert.equal(game.players[0].huLockActive, true); assert.equal(game.players[0].huCount, 1);
  assert.equal(game.currentSeat, 0); assert.equal(game.lastDraw.tile, 17); assert.equal(has(game, 0, 'hu'), true);
  assert.equal(game.players[0].pendingKongDiscard, true); assert.deepEqual(game.discards, []);
  assertGameInvariants(game);
  const changing = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17];
  game = fixture({ hands: [changing, waiting, waiting], drawTile: 0, huCounts: [1, 0, 0], activeLocks: [true, false, false], locks: [[17], [], []] });
  assert.equal(has(game, 0, 'anGang', 0), false);
});

test('a kong retains the two-wall-tile minimum; rejection never transfers points', () => {
  const game = fixture({ hands: [nonWinningKong, waiting, waiting], wallCount: 1 });
  assert.equal(has(game, 0, 'anGang', 0), false);
  const before = structuredClone(game); assert.throws(() => doAction(game, 0, 'anGang', 0)); assert.deepEqual(game, before);
});

test('first hu adds six to earlier kong radishes rather than resetting or hardcoding eight', () => {
  let game = fixture({ radishes: [[6, 7, 8], [], []], tail: [1, 2, 3, 4, 5, 15] });
  game = doAction(game, 0, 'hu');
  assert.deepEqual(game.players[0].radishes, [6, 7, 8, 15, 5, 4, 3, 2, 1]);
  assert.equal(huEvent(game).newRadishes.length, 6);
});

test('fan mapping uses 1,2,4,8,10,12,14,16 and +2 thereafter', () => {
  assert.deepEqual(Array.from({ length: 10 }, (_, i) => fanToPoints(i + 1)), [1, 2, 4, 8, 10, 12, 14, 16, 18, 20]);
  for (const value of [0, -1, 1.2, Infinity, '2']) assert.throws(() => fanToPoints(value));
});

test('copy fan counts hand, meld and previous win pile, exactly four +1 and five +2', () => {
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  for (const [previous, bonus, points] of [[[0], 1, 2], [[0, 0], 2, 4]]) {
    let game = fixture({ hands: [hand, waiting, waiting], melds: [[meld(0)], [], []], priorWins: [previous, [], []], huCounts: [1, 0, 0] });
    game = doAction(game, 0, 'hu');
    const score = huEvent(game).score;
    assert.equal(score.copyFanBonus, bonus); assert.equal(score.fan, 1 + bonus); assert.equal(score.fanPoints, points);
    assert.equal(score.total, points); assert.equal(score.handCounts, undefined);
  }
});

test('current winning tile is counted once, not once in hand and again in winPile', () => {
  const hand = [0, 0, 0, 1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  for (const previous of [[], [0]]) {
    let game = fixture({ hands: [hand, waiting, waiting], priorWins: [previous, [], []], huCounts: [1, 0, 0], drawTile: 0 });
    game = doAction(game, 0, 'hu');
    assert.equal(huEvent(game).score.copyFanBonus, previous.length);
  }
});

test('claimed winning tile and original river reference do not double count in scoring', () => {
  const hand = [0, 0, 1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  let game = doAction(fixture({ hands: [winning, hand, waiting], priorWins: [[], [0], []], huCounts: [0, 1, 0] }), 0, 'discard', 0);
  game = doAction(game, 1, 'hu');
  assert.equal(huEvent(game, 1).score.copyFanBonus, 1); assert.equal(huEvent(game, 1).score.fan, 2);
  assert.equal(game.players[1].winPile.length, 2); assertGameInvariants(game);
});

test('four-to-eight identical copies follow the confirmed additive fan schedule', () => {
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  let game = doAction(fixture({ hands: [hand, waiting, waiting], melds: [[meld(0, 'anGang', 5)], [], []], huCounts: [1, 0, 0] }), 0, 'hu');
  assert.equal(huEvent(game).score.copyFanBonus, 2);
  const six = [0, 0, 0, 0, 0, 0, 3, 4, 5, 9, 10, 11, 17, 17];
  game = doAction(fixture({ hands: [six, noZero, noZero], huCounts: [1, 0, 0] }), 0, 'hu');
  assert.equal(huEvent(game).score.copyFanBonus, 3); assert.equal(huEvent(game).score.fan, 4);
  assert.equal(huEvent(game).score.fanPoints, 8); assert.equal(huEvent(game).score.dragonBonus, 0);
  for (const count of [1, 2]) {
    game = doAction(fixture({ hands: [six, noZero, noZero], priorWins: [Array(count).fill(0), [], []], huCounts: [1, 0, 0] }), 0, 'hu');
    assert.equal(huEvent(game).score.copyFanBonus, count + 3);
    game = doAction(fixture({ hands: [six, noZero, noZero], priorWins: [Array(count).fill(0), [], []], huCounts: [1, 0, 0], rules: { sevenPlusCopyFan: 4 } }), 0, 'hu');
    assert.equal(huEvent(game).score.copyFanBonus, count + 3);
  }
});

test('every hu recalculates copy fan using accumulated winning tiles', () => {
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  for (const [past, fan] of [[[0], 2], [[0, 0], 3]]) {
    let game = doAction(fixture({ hands: [hand, waiting, waiting], melds: [[meld(0)], [], []], priorWins: [past, [], []], huCounts: [past.length, 0, 0] }), 0, 'hu');
    assert.equal(huEvent(game).score.fan, fan); assert.equal(game.players[0].lastScoreBreakdown.fan, fan);
  }
});

test('ordinary and seven-pair shapes have one base fan without invented pair-hand bonus', () => {
  const pairs = [0, 0, 2, 2, 4, 4, 6, 6, 9, 9, 11, 11, 13, 13];
  for (const hand of [winning, pairs]) {
    const game = doAction(fixture({ hands: [hand, waiting, waiting], huCounts: [1, 0, 0] }), 0, 'hu');
    assert.equal(huEvent(game).score.fan, 1); assert.equal(huEvent(game).score.total, 1);
  }
});

test('radishes count current win once and are added to mapped fan points', () => {
  let game = fixture({ tail: [6, 7, 8, 15, 17, 17] });
  game = doAction(game, 0, 'hu');
  assert.equal(huEvent(game).score.radishBonus, 4); assert.equal(huEvent(game).score.fanPoints, 1);
  assert.equal(huEvent(game).score.total, 5); assert.deepEqual(game.players.map(player => player.score), [10, -5, -5]);
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  game = doAction(fixture({ hands: [hand, waiting, waiting], melds: [[meld(0)], [], []], priorWins: [[0], [], []], huCounts: [1, 0, 0], radishes: [[0], [], []] }), 0, 'hu');
  assert.equal(huEvent(game).score.fanPoints, 2); assert.equal(huEvent(game).score.radishBonus, 4); assert.equal(huEvent(game).score.total, 6);
});

test('all seats share one radish pool; optional meld participation stays explicit', () => {
  const game = doAction(fixture({ huCounts: [1, 0, 0], radishes: [[], [17], []] }), 0, 'hu');
  assert.equal(huEvent(game).score.radishBonus, 2);
  assert.deepEqual(getPlayerView(game, 0).sharedRadishes, [17]);
  assert.throws(() => createGame({ rules: { radishScope: 'own' } }));
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  const excluded = doAction(fixture({ hands: [hand, waiting, waiting], melds: [[meld(0)], [], []], huCounts: [1, 0, 0], radishes: [[0], [], []], rules: { radishCountsMelds: false } }), 0, 'hu');
  assert.equal(huEvent(excluded).score.radishBonus, 0);
});

test('dragon 6/7/8 pays each opponent 10/20/40 only at game end', () => {
  const hand = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17];
  for (const [count, expected] of [[6, 10], [7, 20], [8, 40]]) {
    const initial = fixture({ hands: [hand, noZero, noZero], huCounts: [1, 0, 0], radishes: [Array(count - 4).fill(0), [], []], wallCount: 0 });
    const game = doAction(initial, 0, 'hu');
    assert.equal(huEvent(game).score.dragonBonus, 0); assert.equal(huEvent(game).score.fan, 2);
    assert.equal(huEvent(game).score.total, 2 + 4 * (count - 4));
    assert.equal(game.phase, 'finished'); assert.equal(game.dragonSettlement.settled, true);
    const event = game.history.find(event => event.type === 'dragonSettlement' && event.seat === 0);
    assert.equal(event.points, expected); assert.deepEqual(event.dragons, [{ tile: 0, count, points: expected }]);
    assert.deepEqual(event.payments, [{ seat: 1, delta: -expected }, { seat: 2, delta: -expected }, { seat: 0, delta: expected * 2 }]);
    const restored = JSON.parse(JSON.stringify(game)); const before = structuredClone(restored);
    assert.throws(() => doAction(restored, 0, 'hu')); assert.deepEqual(restored, before);
    assert.equal(game.history.filter(event => event.type === 'dragonSettlement' && event.seat === 0).length, 1);
    assertGameInvariants(game);
  }
});

test('legacy big single wait charges each opponent exactly 50, even on a discard', () => {
  const melds = [meld(0), meld(3), meld(9), meld(12)];
  let game = doAction(fixture({ hands: [winning, [17], waiting], melds: [[], melds, []], head: [6] }), 0, 'discard', 17);
  game = doAction(game, 1, 'hu'); game = doAction(game, 2, 'pass');
  const event = huEvent(game, 1);
  assert.equal(event.score.bigSingle, true); assert.equal(event.score.bigSinglePoints, 50);
  assert.equal(event.score.total, 50); assert.equal(event.score.overlapPolicy, 'exclusive');
  assert.deepEqual(game.players.map(player => player.score), [-50, 100, -50]);
  assert.equal(event.payments.length, 3); assertGameInvariants(game);
});

test('big single selfdraw and provisional additive overlap are explicit and configurable', () => {
  const melds = [meld(0), meld(3), meld(9), meld(12)];
  for (const [rules, expected] of [[{}, 50], [{ bigSingleOverlap: 'additive' }, 51]]) {
    const game = doAction(fixture({ hands: [[17, 17], waiting, waiting], melds: [melds, [], []], huCounts: [1, 0, 0], rules }), 0, 'hu');
    assert.equal(huEvent(game).score.total, expected);
    assert.deepEqual(game.players.map(player => player.score), [2 * expected, -expected, -expected]);
  }
});

test('diagnostic positively identifies both actual selfdraw and discard wins', () => {
  let game = fixture();
  assert.deepEqual(getHuDiagnostic(game, 0), { canHu: true, code: 'AVAILABLE', message: '这张牌可以自摸胡牌。', tile: 17, waitTiles: [17] });
  assert.equal(has(game, 0, 'hu'), true);
  game = doAction(game, 0, 'discard', 17);
  assert.equal(getHuDiagnostic(game, 1).canHu, true); assert.equal(has(game, 1, 'hu'), true);
  assert.equal(getHuDiagnostic(game, 0).code, 'WRONG_TURN');
});

test('diagnostics explain shape and repeat discard availability privately', () => {
  let game = fixture({ hands: [[...waiting, 16], waiting, waiting], drawTile: 16 });
  assert.equal(getHuDiagnostic(game, 0).code, 'SHAPE'); assert.deepEqual(getHuDiagnostic(game, 0).waitTiles, [17]);
  assert.equal(getHuDiagnostic(game, 1).code, 'WRONG_TURN');
  game = doAction(fixture({ huCounts: [0, 1, 0], locks: [[], [17], []], activeLocks: [false, true, false] }), 0, 'discard', 17);
  assert.equal(getHuDiagnostic(game, 1).code, 'AVAILABLE');
  assert.match(getHuDiagnostic(game, 1).message, /弃牌可以接胡/);
  assert.ok(game.history.every(event => !Object.hasOwn(event, 'huDiagnostic')));
  const view = getPlayerView(game, 1);
  assert.equal(view.huDiagnostic.code, 'AVAILABLE'); assert.equal(view.players[0].huDiagnostic, undefined);
});

test('private view hides wall, opposing hands/draws/locks and diagnostic is independent of them', () => {
  const game = createGame({ seed: 44 }); game.players[1].lockedWaits = [4, 7];
  const view = getPlayerView(game, 0);
  assert.equal(view.schemaVersion, 3); assert.equal(view.players[1].hand, undefined); assert.equal(view.players[2].hand, undefined);
  assert.equal(view.players[1].lockedWaits, undefined); assert.equal(view.wall, undefined); assert.equal(view.seed, undefined); assert.equal(view.lastDraw, undefined);
  assert.equal(getPlayerView(game, 1).drawnTile, null);
  const changed = structuredClone(game); [changed.players[1].hand, changed.players[2].hand] = [changed.players[2].hand, changed.players[1].hand];
  changed.players[1].lockedWaits = [0, 17]; changed.players[2].huLockActive = true;
  assert.deepEqual(getHuDiagnostic(game, 0), getHuDiagnostic(changed, 0));
  assert.deepEqual(getPlayerView(game, 0), getPlayerView(changed, 0));
  view.players[0].hand[0] = 99; assert.notEqual(game.players[0].hand[0], 99);
  assert.throws(() => getPlayerView(game, -1)); assert.throws(() => getHuDiagnostic(game, 4));
});

test('short wall first hu consumes remaining radishes and terminates consistently', () => {
  const game = doAction(fixture({ wallCount: 3 }), 0, 'hu');
  assert.equal(game.phase, 'finished'); assert.equal(game.finishReason, 'wallExhausted');
  assert.equal(game.wall.length, 0); assert.equal(game.players[0].radishes.length, 3); assert.equal(game.players[0].hand.length, 13);
  assert.equal(getHuDiagnostic(game, 0).code, 'FINISHED'); assertGameInvariants(game);
});

test('last drawn tile remains playable and its final claims settle before wall ends', () => {
  let game = fixture({ hands: [[...waiting, 6], waiting, waiting], drawTile: 6, head: [17], wallCount: 1 });
  game = passAll(doAction(game, 0, 'discard', 6));
  assert.equal(game.wall.length, 0); assert.equal(game.currentSeat, 1); assert.equal(game.phase, 'turn'); assert.equal(has(game, 1, 'hu'), true);
  game = doAction(game, 1, 'discard', 17);
  assert.equal(game.phase, 'claim');
  for (const seat of [2, 0]) game = doAction(game, seat, 'hu');
  assert.equal(game.phase, 'finished'); assert.deepEqual(game.players.map(player => player.huCount), [1, 0, 1]);
  assertGameInvariants(game);
});

test('serialization preserves private views and deterministic subsequent actions', () => {
  const original = doAction(fixture(), 0, 'discard', 17); const resumed = JSON.parse(JSON.stringify(original));
  assert.deepEqual(getPlayerView(original, 2), getPlayerView(resumed, 2));
  assert.deepEqual(doAction(original, 2, 'pass'), doAction(resumed, 2, 'pass'));
});

test('hu count has no artificial cap and new games reset state', () => {
  const game = doAction(fixture({ huCounts: [99, 0, 0] }), 0, 'hu');
  assert.equal(game.players[0].huCount, 100); assert.equal(game.phase, 'turn');
  assert.deepEqual(createGame({ seed: 1 }).players.map(player => player.score), [0, 0, 0]);
});

test('100 complete seeded games conserve physical tiles and zero-sum scores after every action', () => {
  for (let seed = 0; seed < 100; seed++) {
    const random = deterministicRandom(seed); let game = createGame({ seed }); let actions = 0;
    while (game.phase !== 'finished') {
      assert.ok(++actions < 1000, `Seed ${seed} did not finish`);
      const seat = game.phase === 'claim' ? game.claim.eligibleSeats.find(value => !game.claim.responses[value]) : game.currentSeat;
      const legal = getLegalActions(game, seat); assert.ok(legal.length, `No legal actions at seed ${seed}`);
      assert.equal(legal.some(action => action.type === 'draw'), false);
      const action = legal.find(item => item.type === 'hu') || legal.find(item => item.type.endsWith('Gang')) || legal[Math.floor(random() * legal.length)];
      game = applyAction(game, seat, action); assertGameInvariants(game);
      assert.equal(game.players.reduce((sum, player) => sum + player.score, 0), 0);
    }
    assert.ok(game.wall.length === 0 || game.players.every(player => player.huCount > 0));
  }
});


test('prior wins count for radishes by default; saved old rules preserve exclusion', () => {
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  for (const [rules, radishBonus, dragonBonus] of [[{}, 8, 10], [{ radishCountsWinPile: false }, 6, 10], [{ dragonCountsWinPile: false }, 8, 0], [{ dragonCountsSharedRadishes: false }, 8, 0]]) {
    const game = doAction(fixture({ hands: [hand, noZero, noZero], melds: [[meld(0)], [], []], priorWins: [[0], [], []], huCounts: [1, 0, 0], radishes: [[0, 0], [], []], rules, wallCount: 0 }), 0, 'hu');
    const score = huEvent(game).score;
    assert.equal(score.fan, 2); assert.equal(score.radishBonus, radishBonus); assert.equal(score.dragonBonus, 0);
    assert.equal(score.total, 2 + radishBonus);
    assert.equal(game.dragonSettlement.entries.find(entry => entry.seat === 0)?.points || 0, dragonBonus);
  }
});

test('a first simultaneous winner completing the table does not cancel an already-hu repeat winner', () => {
  let game = doAction(fixture({ huCounts: [1, 0, 1], kongSeats: [0], head: [6] }), 0, 'discard', 17);
  const wall = game.wall.length;
  game = doAction(game, 2, 'hu'); game = doAction(game, 1, 'hu');
  assert.equal(game.finishReason, 'allPlayersHu');
  assert.deepEqual(game.players.map(player => player.huCount), [1, 1, 2]);
  assert.equal(game.history.filter(event => event.type === 'hu').length, 2);
  assert.equal(game.wall.length, wall); assert.equal(game.history.some(event => event.type === 'draw'), false);
  assert.equal(game.players[1].winPile[0].virtual, false); assert.equal(game.players[2].winPile[0].virtual, true);
  assert.ok(huEvent(game, 2).payments.length); assertGameInvariants(game);
});

test('post-hu legal kong preserves multiple waits, while losing any single wait rejects it', () => {
  const before = [0, 0, 0, 3, 4, 5, 9, 10, 11, 12, 13, 17, 17];
  const game = fixture({ hands: [[...before, 0], waiting, waiting], drawTile: 0, huCounts: [1, 0, 0], locks: [[11, 14], [], []], activeLocks: [true, false, false] });
  assert.deepEqual(getWaitTiles(before), [11, 14]); assert.equal(has(game, 0, 'anGang', 0), true);
  const changed = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17];
  assert.deepEqual(getWaitTiles(changed.slice(1)), [0, 3, 17]);
  assert.deepEqual(getWaitTiles(changed.slice(4), [meld(0, 'anGang')]), [0, 3]);
  const rejected = fixture({ hands: [changed, waiting, waiting], drawTile: 0, huCounts: [1, 0, 0], locks: [[0, 3, 17], [], []], activeLocks: [true, false, false] });
  assert.equal(has(rejected, 0, 'anGang', 0), false);
});

test('copy fan bonuses accumulate separately for every matching tile identity', () => {
  const hand = [0, 0, 0, 0, 2, 2, 2, 2, 4, 4, 4, 4, 6, 6];
  for (const [previous, fan, points] of [[[], 4, 8], [[0, 2, 4], 7, 14]]) {
    const game = doAction(fixture({ hands: [hand, waiting, waiting], priorWins: [previous, [], []], huCounts: [3, 0, 0] }), 0, 'hu');
    assert.equal(huEvent(game).score.fan, fan); assert.equal(huEvent(game).score.fanPoints, points);
    assert.equal(huEvent(game).score.total, points);
  }
});

test('post-hu uninteresting turns auto-advance through consecutive locked players without exposing draw tiles', () => {
  let game = fixture({ huCounts: [1, 1, 0], head: [6, 7, 8] });
  game = doAction(game, 0, 'pass');
  assert.equal(game.currentSeat, 2); assert.equal(game.lastDraw.tile, 7);
  assert.equal(game.players[1].hand.length, 13); assert.equal(game.discards[1].tile, 6);
  assert.ok(game.history.filter(event => event.type === 'draw').every(event => event.tile === undefined));
  assert.equal(getPlayerView(game, 0).drawnTile, null); assert.equal(getPlayerView(game, 1).drawnTile, null);
  assertGameInvariants(game);
});


test('third player win settles dragons from all four zones without charging fan for radishes', () => {
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17];
  const initial = fixture({ hands: [hand, noZero, [...noZero, 17]], melds: [[meld(0)], [], []], priorWins: [[0], [], []], huCounts: [1, 1, 0], radishes: [[], [0, 0], []], currentSeat: 2 });
  const wall = initial.wall.length;
  const game = doAction(initial, 2, 'hu');
  assert.equal(game.finishReason, 'allPlayersHu'); assert.equal(game.wall.length, wall);
  assert.equal(huEvent(game, 2).score.fan, 1); assert.equal(huEvent(game, 2).score.dragonBonus, 0);
  assert.equal(game.dragonSettlement.entries.find(entry => entry.seat === 0).points, 10);
  assert.equal(game.history.at(-1).type, 'finish'); assertGameInvariants(game);
});

test('selfdraw payer exclusion also applies to big-single without changing its 50-point rate', () => {
  const ordinary = doAction(fixture({ huCounts: [1, 1, 0], head: [6] }), 0, 'hu');
  assert.deepEqual(huEvent(ordinary).payments.map(p => p.seat), [2, 0]);
  const big = doAction(fixture({ hands: [[17, 17], waiting, waiting], melds: [[meld(0), meld(3), meld(9), meld(12)], [], []], huCounts: [1, 1, 0], head: [6] }), 0, 'hu');
  assert.equal(huEvent(big).score.total, 50);
  assert.deepEqual(huEvent(big).payments, [{ seat: 2, delta: -50 }, { seat: 0, delta: 50 }]);
});

test('radish example sums two 7-dots and one 4-dot from personal zones to four, without changing fan', () => {
  const exactHand = [0, 1, 2, 3, 4, 5, 9, 10, 11, 15, 16, 17, 6, 6];
  for (const virtual of [false, true]) {
    const initial = fixture({ hands: [exactHand, waiting, waiting], priorWins: [[15, 12], [], []], huCounts: [2, 0, 0], radishes: [[], [15, 12, 12], []], drawTile: 6, head: [8] });
    if (virtual) {
      initial.retiredTiles.splice(initial.retiredTiles.findIndex(x => x.tile === 15), 1);
      initial.discards.push({ seat: 1, tile: 15, claimable: false, huSeats: [0, 2] });
      initial.players[0].winPile[0] = { tile: 15, source: 'discard', virtual: true, discardIndex: 0 };
    }
    const game = doAction(initial, 0, 'hu');
    const score = huEvent(game).score;
    assert.equal(score.radishBonus, 4); assert.equal(score.fan, 1); assert.equal(score.total, 5);
    assert.equal(getPlayerView(game, 0).scoreBreakdown.radishBonus, 4);
    const legacy = structuredClone(initial); legacy.rules.radishCountsWinPile = false;
    const old = doAction(legacy, 0, 'hu');
    assert.equal(huEvent(old).score.radishBonus, 1); assert.equal(huEvent(old).score.fan, score.fan);
    assertGameInvariants(game);
  }
});

test('every selfdraw charges only previously-unwon opponents, first or repeat, with zero-sum ledger', () => {
  for (const counts of [[0,0,0], [0,1,0], [1,1,0], [0,1,1]]) {
    const game = doAction(fixture({ huCounts: counts, head: [6] }), 0, 'hu');
    const event = huEvent(game); const payers = counts[0] === 0 && counts[1] && counts[2] ? [1,2] : [1,2].filter(i => !counts[i]);
    assert.deepEqual(event.payments.filter(p => p.delta < 0).map(p => p.seat), payers);
    assert.equal(event.payments.find(p => p.seat === 0).delta, event.points * payers.length);
    for (const i of [1,2]) if (counts[i] && !payers.includes(i)) assert.equal(game.players[i].score, 0);
    assert.equal(game.players.reduce((sum,p) => sum+p.score,0),0);
    if (!payers.length) assert.match(event.message, /无未胡付款方/);
  }
  const old = fixture({ huCounts: [0,1,0], head: [6] }); delete old.rules.selfDrawOnlyUnwon;
  assert.deepEqual(huEvent(doAction(old,0,'hu')).payments.filter(p=>p.delta<0).map(p=>p.seat),[1,2]);
});

test('kong replacement selfdraw retains preexisting payment behavior independently of ordinary draws', () => {
  for (const counts of [[0,1,0],[1,1,0],[0,1,1]]) {
    const initial = fixture({ huCounts: counts, drawKind: 'replacement', head: [6] });
    const previous = structuredClone(initial); delete previous.rules.selfDrawOnlyUnwon;
    const latest = doAction(initial,0,'hu'); const old = doAction(previous,0,'hu');
    assert.deepEqual(huEvent(latest).payments,huEvent(old).payments);
    assert.deepEqual(latest.players.map(p=>p.score),old.players.map(p=>p.score));
  }
});

test('final selfdraw collects both opponents while saved pre-exception game keeps zero payers', () => {
  const initial = fixture({ huCounts: [0,1,1], head: [6] });
  const game = doAction(initial,0,'hu');
  assert.equal(game.finishReason,'allPlayersHu');
  assert.deepEqual(huEvent(game).payments,[{seat:1,delta:-1},{seat:2,delta:-1},{seat:0,delta:2}]);
  const old = structuredClone(initial); delete old.rules.finalHuPaymentExceptions;
  const before = doAction(old,0,'hu'); assert.deepEqual(huEvent(before).payments,[{seat:0,delta:0}]);
  assert.deepEqual(before.players.map(p=>p.score),[0,0,0]);
});

test('final first and repeat co-winners each charge only the kong discarder', () => {
  for (const order of [[1,2],[2,1]]) {
    let game = doAction(fixture({ huCounts:[1,0,1], kongSeats:[0], head:[6] }),0,'discard',17);
    const wall = game.wall.length;
    for (const seat of order) game = doAction(game,seat,'hu');
    assert.equal(game.finishReason,'allPlayersHu'); assert.equal(game.wall.length,wall);
    const first = huEvent(game,1), repeat = huEvent(game,2);
    assert.equal(first.source,'kongDiscard'); assert.match(first.message,/仅出牌者付款/); assert.doesNotMatch(first.message,/按自摸/);
    assert.deepEqual(first.payments.filter(p=>p.delta<0).map(p=>p.seat),[0]);
    assert.deepEqual(repeat.payments.filter(p=>p.delta<0).map(p=>p.seat),[0]);
    assert.equal(game.players.reduce((n,p)=>n+p.score,0),0); assertGameInvariants(game);
  }
});

test('final and nonfinal kong-discard wins charge only the source even without the final-hu flag', () => {
  let initial = doAction(fixture({huCounts:[1,0,0],kongSeats:[0],head:[6]}),0,'discard',17);
  let game = doAction(doAction(initial,1,'hu'),2,'hu');
  assert.equal(game.finishReason,'allPlayersHu');
  for (const seat of [1,2]) assert.deepEqual(huEvent(game,seat).payments.filter(p=>p.delta<0).map(p=>p.seat),[0]);
  game = doAction(doAction(initial,1,'hu'),2,'pass');
  assert.notEqual(game.phase,'finished');
  assert.deepEqual(huEvent(game,1).payments.filter(p=>p.delta<0).map(p=>p.seat),[0]);
  const old = structuredClone(initial); delete old.rules.finalHuPaymentExceptions;
  game = doAction(doAction(old,1,'hu'),2,'hu');
  assert.deepEqual(huEvent(game,1).payments.filter(p=>p.delta<0).map(p=>p.seat),[0]);
});

test('reported 2/5/8 circles hand can repeat-hu a kong discard before its next natural draw', () => {
  const receiver = [4, 5, 6, 6, 7, 7, 7, 8, 11, 12, 13, 14, 15];
  const source = [2, 3, 5, 6, 7, 8, 8, 8, 10, 14, 14];
  assert.deepEqual(getWaitTiles(receiver), [10, 13, 16]);
  let game = fixture({ hands: [source, receiver, waiting], melds: [[meld(10)], [], []],
    huCounts: [0, 5, 0], priorWins: [[], [16, 10, 16, 13, 16], []],
    locks: [[], [10, 13, 16], []], activeLocks: [false, true, false],
    drawTile: 10, head: [13, 0], tail: [16] });
  game = doAction(game, 0, 'buGang', 10);
  // Decline the newly supported rob-kong window before exercising the later discard.
  game = passAll(game);
  assert.equal(game.players[1].huLockActive, true);
  assert.equal(game.lastDraw.tile, 13);
  game = doAction(game, 0, 'discard', 13);
  assert.equal(game.discards.find(discard => discard.seat === 0 && discard.tile === 13).afterKong, true);
  assert.equal(game.phase, 'claim');
  assert.equal(game.claim.tile, 13);
  assert.equal(has(game, 1, 'hu'), true);
  assert.equal(getHuDiagnostic(game, 1).code, 'AVAILABLE');
  game = doAction(game, 1, 'hu');
  game = passAll(game);
  assert.equal(game.players[1].huCount, 6);
  assert.equal(game.players[1].winPile.at(-1).source, 'kongDiscard');
  assert.equal(game.players[1].winPile.at(-1).tile, 13);
  assertGameInvariants(game);
});

test('kong-discard and ordinary repeat hu ignore locks but won ordinary sources remain protected', () => {
  const receiver = [4, 5, 6, 6, 7, 7, 7, 8, 11, 12, 13, 14, 15];
  const source = [0, 0, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 13, 17];
  for (const sourceHu of [0, 1]) for (const repeatHuLock of ['untilNaturalDraw', 'untilWaitChange']) for (const allowChangedWaitDuringLock of [true, false]) {
    const make = afterKong => fixture({ hands: [source, receiver, waiting], drawTile: 13,
      huCounts: [sourceHu, 1, 0], locks: [[], [10, 13, 16], []], activeLocks: [false, true, false],
      kongSeats: afterKong ? [0] : [], rules: {repeatHuLock, allowChangedWaitDuringLock}, head: [0, 1] });
    let game = doAction(make(true), 0, 'discard', 13);
    assert.equal(game.phase, 'claim');
    assert.equal(has(game, 1, 'hu'), true);
    assert.equal(getHuDiagnostic(game, 1).code, 'AVAILABLE');
    assert.equal(game.players[0].pendingKongDiscard, false);
    game = passAll(doAction(game, 1, 'hu'));
    assert.equal(game.players[1].huCount, 2);
    assert.equal(game.players[1].winPile.at(-1).source, 'kongDiscard');
    assertGameInvariants(game);
    game = doAction(make(false), 0, 'discard', 13);
    assert.equal(game.discards[0].afterKong, false);
    assert.equal(game.discards[0].huSeats, undefined);
    assert.equal(game.players[1].huCount, 1);
    assert.equal(game.phase === 'claim' && game.claim.tile === 13 && has(game, 1, 'hu'), sourceHu === 0);
    assertGameInvariants(game);
  }
});

test('two locked winners can both claim the same kong discard in either response order', () => {
  const source = [0, 0, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 13, 17];
  const receiver = [4, 5, 6, 6, 7, 7, 7, 8, 11, 12, 13, 14, 15];
  for(const order of [[1,2],[2,1]]) {
    let game = fixture({hands:[source,receiver,receiver],huCounts:[0,1,1],
      locks:[[],[10,13,16],[10,13,16]],activeLocks:[false,true,true],
      kongSeats:[0],drawTile:13,head:[0,1]});
    game=doAction(game,0,'discard',13);
    assert.deepEqual(game.claim.eligibleSeats,[1,2]);
    game=doAction(game,order[0],'hu');
    assert.equal(game.history.filter(event=>event.type==='hu').length,0);
    game=doAction(game,order[1],'hu');
    assert.deepEqual(game.players.map(player=>player.huCount),[0,2,2]);
    assert.equal(game.history.filter(event=>event.type==='hu' && event.source==='kongDiscard').length,2);
    assert.equal(game.players[1].winPile.at(-1).virtual,false);
    assert.equal(game.players[2].winPile.at(-1).virtual,true);
    assertGameInvariants(game);
  }
});

function assertKongDiscardPayment(game, winner, fromSeat) {
  const event = huEvent(game, winner);
  assert.equal(event.source, 'kongDiscard');
  assert.equal(event.fromSeat, fromSeat);
  assert.equal(event.points, event.score.total);
  assert.deepEqual(event.payments, [{ seat: fromSeat, delta: -event.points }, { seat: winner, delta: event.points }]);
  assert.match(event.message, /仅出牌者付款/);
  assert.doesNotMatch(event.message, /按自摸|另外两家/);
  assert.equal(game.players.reduce((sum, player) => sum + player.score, 0), 0);
  assertGameInvariants(game);
  return event;
}

function savedPaymentFlags(game, selfDrawOnlyUnwon, finalHuPaymentExceptions) {
  for (const [key, value] of Object.entries({ selfDrawOnlyUnwon, finalHuPaymentExceptions })) {
    if (value === undefined) delete game.rules[key];
    else game.rules[key] = value;
  }
  return game;
}

test('reported seat-three eight-point kong-discard win receives eight, not sixteen, and seat two pays nothing', () => {
  let game = fixture({ huCounts: [1, 0, 0], kongSeats: [0], firstHuRadishesRevealed: true, rules: { baseFan: 4 }, head: [6] });
  game = doAction(game, 0, 'discard', 17);
  game = passAll(doAction(game, 2, 'hu'));
  const event = assertKongDiscardPayment(game, 2, 0);
  assert.equal(event.tile, 17); // Nine circles, as in the reported result.
  assert.equal(event.points, 8);
  assert.deepEqual(event.payments, [{ seat: 0, delta: -8 }, { seat: 2, delta: 8 }]);
  assert.deepEqual(game.players.map(player => player.score), [-8, 0, 8]);
});

test('kong-discard payer follows the actual source and winner in every seat arrangement', () => {
  for (const fromSeat of [0, 1, 2]) for (const winner of [0, 1, 2].filter(seat => seat !== fromSeat)) {
    const hands = [waiting, waiting, waiting].map((hand, seat) => seat === fromSeat ? winning : hand);
    let game = fixture({ hands, currentSeat: fromSeat, kongSeats: [fromSeat], firstHuRadishesRevealed: true, head: [6] });
    game = passAll(doAction(doAction(game, fromSeat, 'discard', 17), winner, 'hu'));
    const event = assertKongDiscardPayment(game, winner, fromSeat);
    assert.deepEqual(game.players.map(player => player.score), [0, 1, 2].map(seat => seat === fromSeat ? -event.points : seat === winner ? event.points : 0));
  }
});

test('first, repeat, final and big-single kong-discard payments ignore both selfdraw payment flags', () => {
  const groups = [meld(0), meld(3), meld(9), meld(12)];
  for (const selfDrawOnlyUnwon of [true, false, undefined]) for (const finalHuPaymentExceptions of [true, false, undefined]) {
    for (const huCounts of [[0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 0, 1], [0, 1, 1], [1, 1, 0]]) {
      for (const shape of ['standard', 'legacyBigSingle', 'specialBigSingle']) {
        const bigSingle = shape !== 'standard';
        const initial = fixture({ hands: [winning, bigSingle ? [17] : waiting, waiting], melds: [[], bigSingle ? groups : [], []],
          huCounts, kongSeats: [0], firstHuRadishesRevealed: true, head: [6], rules: { specialHuPatterns: shape === 'specialBigSingle' } });
        savedPaymentFlags(initial, selfDrawOnlyUnwon, finalHuPaymentExceptions);
        const game = passAll(doAction(doAction(initial, 0, 'discard', 17), 1, 'hu'));
        const event = assertKongDiscardPayment(game, 1, 0);
        if (bigSingle) {
          assert.equal(event.score.bigSingle, true);
          assert.equal(event.points, shape === 'legacyBigSingle' ? 50 : 4);
        }
        assert.deepEqual(game.players.map(player => player.score), [-event.points, event.points, 0]);
        assert.equal(game.players[1].huCount, huCounts[1] + 1);
        if (huCounts[0] && !huCounts[1] && huCounts[2]) assert.equal(game.finishReason, 'allPlayersHu');
      }
    }
  }
});

test('simultaneous first and repeat kong-discard winners never pay each other, regardless of response order or flags', () => {
  for (const selfDrawOnlyUnwon of [true, false, undefined]) for (const finalHuPaymentExceptions of [true, false, undefined]) {
    for (const huCounts of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 1, 1], [1, 0, 1]]) {
      const initial = savedPaymentFlags(fixture({ huCounts, kongSeats: [0], firstHuRadishesRevealed: true, head: [6] }), selfDrawOnlyUnwon, finalHuPaymentExceptions);
      const results = [[1, 2], [2, 1]].map(order => {
        let game = doAction(initial, 0, 'discard', 17);
        game = doAction(game, order[0], 'hu');
        assert.equal(game.history.filter(event => event.type === 'hu').length, 0);
        game = doAction(game, order[1], 'hu');
        const first = assertKongDiscardPayment(game, 1, 0);
        const second = assertKongDiscardPayment(game, 2, 0);
        assert.deepEqual(game.players.map(player => player.score), [-first.points - second.points, first.points, second.points]);
        assert.equal(game.players[1].winPile.at(-1).virtual, false);
        assert.equal(game.players[2].winPile.at(-1).virtual, true);
        assert.deepEqual(game.discards[0].huSeats, [1, 2]);
        if (huCounts[0]) assert.equal(game.finishReason, 'allPlayersHu');
        return game;
      });
      assert.deepEqual(results[0], results[1]);
    }
  }
});

test('actual kong replacement selfdraw still charges both opponents and leaves kong fees intact', () => {
  const hand = [0, 0, 0, 0, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
  let game = fixture({ hands: [hand, waiting, waiting], drawTile: 0, huCounts: [0, 1, 0], head: [17, 6], tail: [7] });
  game = doAction(game, 0, 'anGang', 0);
  assert.equal(game.lastDraw.source, 'replacement');
  assert.equal(game.players[0].pendingKongDiscard, true);
  const before = game.players.map(player => player.score);
  assert.deepEqual(before, [4, -2, -2]);
  game = doAction(game, 0, 'hu');
  const event = huEvent(game);
  assert.equal(event.source, 'selfDraw');
  assert.equal(event.fromSeat, null);
  assert.deepEqual(event.payments, [{ seat: 1, delta: -event.points }, { seat: 2, delta: -event.points }, { seat: 0, delta: 2 * event.points }]);
  assert.deepEqual(game.players.map((player, seat) => player.score - before[seat]), [2 * event.points, -event.points, -event.points]);
  assertGameInvariants(game);
});

test('double hu always prioritizes the discarder’s next seat, not response order, for all three discarders', () => {
  for (const fromSeat of [0, 1, 2]) for (const afterKong of [false, true]) {
    const nextSeat = (fromSeat + 1) % 3;
    const otherSeat = (fromSeat + 2) % 3;
    const priority = [nextSeat, otherSeat];
    const hands = [waiting, waiting, waiting].map((hand, seat) => seat === fromSeat ? winning : hand);
    const initial = fixture({ hands, currentSeat: fromSeat, kongSeats: afterKong ? [fromSeat] : [],
      firstHuRadishesRevealed: true, head: [17, 6] });
    const results = [priority, [...priority].reverse()].map(responseOrder => {
      let game = doAction(initial, fromSeat, 'discard', 17);
      assert.deepEqual([...game.claim.eligibleSeats].sort(), [...priority].sort());
      const wallCount = game.wall.length;
      game = doAction(game, responseOrder[0], 'hu');
      assert.equal(game.phase, 'claim');
      assert.deepEqual(game.players.map(player => player.huCount), [0, 0, 0]);
      assert.equal(game.history.some(event => event.type === 'hu'), false);
      assert.equal(game.wall.length, wallCount);
      game = doAction(game, responseOrder[1], 'hu');
      const wins = game.history.filter(event => event.type === 'hu');
      assert.deepEqual(wins.map(event => event.seat), priority);
      assert.deepEqual(game.discards[0].huSeats, priority);
      assert.equal(game.discards[0].claimedBy, undefined);
      assert.equal(game.discards.length, 1);
      for (const [index, seat] of priority.entries()) {
        assert.equal(game.players[seat].huCount, 1);
        assert.deepEqual(game.players[seat].winPile, [{ tile: 17, source: afterKong ? 'kongDiscard' : 'discard', virtual: index > 0, discardIndex: 0 }]);
        assert.deepEqual(wins[index].payments, [{ seat: fromSeat, delta: -wins[index].points }, { seat, delta: wins[index].points }]);
      }
      assert.equal(game.phase, 'turn');
      assert.equal(game.currentSeat, nextSeat);
      assert.deepEqual(game.lastDraw, { seat: nextSeat, tile: 17, source: 'continuation' });
      assert.equal(game.players[nextSeat].hand.length, 14);
      assert.equal(game.players[otherSeat].hand.length, 13);
      assert.equal(game.wall.length, wallCount - 1);
      assert.deepEqual(game.history.filter(event => event.type === 'draw').map(event => event.seat), [nextSeat]);
      assertGameInvariants(game);
      return game;
    });
    assert.deepEqual(results[0], results[1]);
  }
});

test('next-seat double-hu priority settles both first and repeat winners before every all-player-hu finish', () => {
  for (const fromSeat of [0, 1, 2]) for (const winnerCounts of [[0, 0], [0, 1], [1, 0]]) {
    const priority = [(fromSeat + 1) % 3, (fromSeat + 2) % 3];
    const huCounts = [0, 0, 0];
    huCounts[fromSeat] = 1;
    priority.forEach((seat, index) => { huCounts[seat] = winnerCounts[index]; });
    const hands = [waiting, waiting, waiting].map((hand, seat) => seat === fromSeat ? winning : hand);
    const initial = fixture({ hands, huCounts, currentSeat: fromSeat, kongSeats: [fromSeat], head: [17] });
    const results = [priority, [...priority].reverse()].map(responseOrder => {
      let game = doAction(initial, fromSeat, 'discard', 17);
      const wallCount = game.wall.length;
      game = doAction(game, responseOrder[0], 'hu');
      assert.equal(game.phase, 'claim');
      assert.deepEqual(game.players.map(player => player.huCount), huCounts);
      assert.equal(game.history.some(event => event.type === 'hu' || event.type === 'finish'), false);
      game = doAction(game, responseOrder[1], 'hu');
      const wins = game.history.filter(event => event.type === 'hu');
      assert.deepEqual(wins.map(event => event.seat), priority);
      assert.deepEqual(game.discards[0].huSeats, priority);
      priority.forEach((seat, index) => {
        assertKongDiscardPayment(game, seat, fromSeat);
        assert.equal(game.players[seat].huCount, winnerCounts[index] + 1);
        assert.equal(game.players[seat].winPile.at(-1).virtual, index > 0);
      });
      assert.equal(game.phase, 'finished');
      assert.equal(game.finishReason, 'allPlayersHu');
      assert.equal(game.wall.length, wallCount);
      assert.equal(game.lastDraw, null);
      assert.equal(game.history.some(event => event.type === 'draw'), false);
      assert.equal(game.history.at(-1).type, 'finish');
      assert.equal(game.history.filter(event => event.type === 'finish').length, 1);
      assertGameInvariants(game);
      return game;
    });
    assert.deepEqual(results[0], results[1]);
  }
});

test('double hu on the last discard keeps next-seat priority and both wins before wall exhaustion', () => {
  for (const fromSeat of [0, 1, 2]) for (const afterKong of [false, true]) {
    const priority = [(fromSeat + 1) % 3, (fromSeat + 2) % 3];
    const hands = [waiting, waiting, waiting].map((hand, seat) => seat === fromSeat ? winning : hand);
    const initial = fixture({ hands, currentSeat: fromSeat, kongSeats: afterKong ? [fromSeat] : [], wallCount: 0, firstHuRadishesRevealed: true });
    const results = [priority, [...priority].reverse()].map(responseOrder => {
      let game = doAction(initial, fromSeat, 'discard', 17);
      game = doAction(game, responseOrder[0], 'hu');
      assert.equal(game.phase, 'claim');
      game = doAction(game, responseOrder[1], 'hu');
      assert.deepEqual(game.history.filter(event => event.type === 'hu').map(event => event.seat), priority);
      assert.deepEqual(game.discards[0].huSeats, priority);
      assert.equal(game.players[priority[0]].winPile[0].virtual, false);
      assert.equal(game.players[priority[1]].winPile[0].virtual, true);
      assert.equal(game.phase, 'finished');
      assert.equal(game.finishReason, 'wallExhausted');
      assert.equal(game.wall.length, 0);
      assert.equal(game.history.some(event => event.type === 'draw'), false);
      assert.equal(game.history.at(-1).type, 'finish');
      assertGameInvariants(game);
      return game;
    });
    assert.deepEqual(results[0], results[1]);
  }
});

test('post-hu concealed, supplement and fifth-tile kongs are mandatory and old-client skips are immutable failures', () => {
  for (const type of ['anGang', 'buGang', 'addGang']) {
    const game = postHuKongGame({ type });
    const tile = game.lastDraw.tile;
    assert.deepEqual(getLegalActions(game, 0), [{ type, tile }]);
    assert.deepEqual(getPlayerView(game, 0).legalActions, [{ type, tile }]);
    const before = structuredClone(game);
    for (const action of [{ type: 'pass' }, { type: 'discard', tile }, { type: 'discard', tile: game.players[0].hand.find(value => value !== tile) }]) {
      assert.throws(() => applyAction(game, 0, action), /当前不能执行/);
      assert.deepEqual(game, before);
    }
    const restored = JSON.parse(JSON.stringify(game));
    assert.deepEqual(getPlayerView(restored, 0), getPlayerView(game, 0));
    const next = doAction(restored, 0, type, tile);
    assert.equal(next.history.filter(event => event.type === type).length, 1);
    assert.equal(next.lastDraw.source, 'replacement');
    assert.equal(next.players[0].huCount, 1);
    assert.equal(has(next, 0, 'hu'), true);
    assertGameInvariants(next);
  }
});

test('unwon players may discard instead of any own kong, while a real post-hu win retains hu and pass', () => {
  for (const type of ['anGang', 'buGang', 'addGang']) {
    const game = postHuKongGame({ type, huCount: 0 });
    const tile = game.lastDraw.tile;
    assert.equal(has(game, 0, type, tile), true);
    assert.equal(has(game, 0, 'discard', tile), true);
    assertGameInvariants(doAction(game, 0, 'discard', tile));
    const winningGame = postHuKongGame({ type, winningDraw: true });
    assert.deepEqual(getLegalActions(winningGame, 0), [{ type: 'discard', tile: winningGame.lastDraw.tile }, { type: 'hu' }, { type: 'pass' }]);
    assertGameInvariants(doAction(winningGame, 0, 'hu'));
    assertGameInvariants(doAction(winningGame, 0, 'pass'));
  }
  const hand = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17];
  const huBeforeKong = fixture({ hands: [hand, waiting, waiting], huCounts: [1, 0, 0], drawTile: 0 });
  assert.deepEqual(getLegalActions(huBeforeKong, 0), [{ type: 'discard', tile: 0 }, { type: 'hu' }, { type: 'pass' }]);
});

test('post-hu auto-discard still runs when the wall cannot fund a kong or the kong would lose waits', () => {
  for (const type of ['anGang', 'buGang', 'addGang']) {
    const source = postHuKongGame({ type });
    const tile = source.lastDraw.tile;
    const baseHand = [...source.players[0].hand]; baseHand.splice(baseHand.indexOf(tile), 1);
    const initial = fixture({ hands: [baseHand, waiting, [...waiting, 6]], melds: [source.players[0].melds, [], []],
      huCounts: [1, 0, 0], currentSeat: 2, drawTile: 6, head: [tile, 6], wallCount: 2 });
    const game = doAction(initial, 2, 'discard', 6);
    assert.ok(game.history.some(event => event.type === 'discard' && event.seat === 0 && event.tile === tile && event.automatic));
    assert.equal(game.history.some(event => event.type.endsWith('Gang')), false);
    assert.equal(game.currentSeat, 1);
    assert.deepEqual(game.players[0].hand, [...baseHand].sort((a, b) => a - b));
    assertGameInvariants(game);
  }
  const beforeDraw = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17];
  const initial = fixture({ hands: [beforeDraw, waiting, [...waiting, 8]], huCounts: [1, 0, 0], currentSeat: 2, drawTile: 8, head: [6, 7] });
  const game = doAction(initial, 2, 'discard', 8);
  assert.ok(game.history.some(event => event.type === 'discard' && event.seat === 0 && event.tile === 6 && event.automatic));
  assert.equal(game.history.some(event => event.type === 'anGang'), false);
  assert.equal(game.currentSeat, 1);
  assert.deepEqual(game.players[0].hand, beforeDraw);
  assertGameInvariants(game);
});

test('reported automatic seven-circles kong discard pays 34 not 68 and never charges the unrelated player', () => {
  for (const unrelatedHuCount of [0, 1]) {
    const sourceHand = [2, 3, 4, 5, 6, 7, 8, 10, 11, 17, 17];
    const winnerHand = waiting.map(tile => tile === 17 ? 15 : tile);
    const sharedRadishes = [0, 3, 9, 12, 15].flatMap(tile => [tile, tile, tile]);
    let game = fixture({ hands: [waiting, sourceHand, winnerHand], melds: [[], [meld(2)], []],
      huCounts: [unrelatedHuCount, 1, 0], currentSeat: 1, drawTile: 2, head: [15, 6], tail: [16],
      radishes: [sharedRadishes, [], []], rules: { baseFan: 8 } });
    assert.deepEqual(getLegalActions(game, 1), [{ type: 'buGang', tile: 2 }]);
    game = doAction(game, 1, 'buGang', 2);
    assert.equal(game.phase, 'claim');
    assert.ok(game.history.some(event => event.type === 'discard' && event.seat === 1 && event.tile === 15 && event.afterKong && event.automatic));
    const beforeHuScores = game.players.map(player => player.score);
    assert.deepEqual(beforeHuScores, [-1, 2, -1]); // The separate supplement-kong fee remains valid.
    game = passAll(doAction(game, 2, 'hu'));
    const event = assertKongDiscardPayment(game, 2, 1);
    assert.equal(event.tile, 15);
    assert.equal(event.score.fan, 8);
    assert.equal(event.score.fanPoints, 16);
    assert.equal(event.score.radishBonus, 18);
    assert.equal(event.points, 34);
    assert.deepEqual(event.payments, [{ seat: 1, delta: -34 }, { seat: 2, delta: 34 }]);
    assert.deepEqual(game.players.map((player, seat) => player.score - beforeHuScores[seat]), [0, -34, 34]);
    assert.equal(game.players[0].huCount, unrelatedHuCount);
    if (unrelatedHuCount) assert.equal(game.finishReason, 'allPlayersHu');
    assertGameInvariants(game);
  }
});

test('reported four-dot chronology allows repeat one-dot and four-dot claims before the next natural draw', () => {
  const hand = [1, 2, 3, 10, 11, 12, 12];
  const groups = [meld(13, 'mingGang'), meld(5)];
  let game = fixture({hands:[waiting,hand,[...waiting,12]],melds:[[],groups,[]],currentSeat:2,drawTile:12,head:[10,9,12,10,9],rules:{specialHuPatterns:true}});
  assert.deepEqual(getWaitTiles(hand,groups),[9,12]);
  game=doAction(game,2,'discard',12);
  game=passAll(doAction(game,1,'hu'));
  assert.equal(game.players[1].huCount,1);
  assert.equal(game.players[1].huLockActive,true);
  assert.equal(game.currentSeat,2);
  assert.equal(game.lastDraw.tile,9);
  // The only draw by seat two since its first hu was continuation, not natural.
  assert.deepEqual(game.history.filter(e=>e.type==='draw'&&e.seat===1).map(e=>e.source),['continuation']);
  game=doAction(game,2,'discard',9);
  assert.equal(has(game,1,'hu'),true);
  assert.equal(getHuDiagnostic(game,1).code,'AVAILABLE');
  // Declining this tile does not erase the next eligible ordinary discard.
  game=passAll(game);
  assert.equal(game.currentSeat,0);
  assert.equal(game.lastDraw.tile,12);
  game=doAction(game,0,'discard',12);
  assert.equal(has(game,1,'hu'),true);
  assert.equal(getHuDiagnostic(game,1).code,'AVAILABLE');
  const reconnected=JSON.parse(JSON.stringify(game));
  assert.equal(has(reconnected,1,'hu'),true);
  game=passAll(doAction(reconnected,1,'hu'));
  const wins=game.history.filter(e=>e.type==='hu'&&e.seat===1);
  assert.deepEqual(wins.map(e=>e.tile),[12,12]);
  assert.equal(wins[1].source,'discard');
  assert.equal(wins[1].fromSeat,0);
  assert.deepEqual(wins[1].payments.filter(p=>p.delta<0).map(p=>p.seat),[0]);
  assertGameInvariants(game);
});

test('both prior winners can claim an ordinary discard atomically in stable clockwise order', () => {
  for (const order of [[1,2],[2,1]]) {
    let game=fixture({huCounts:[0,1,1],priorWins:[[],[17],[17]],locks:[[],[17],[17]],activeLocks:[false,true,true],head:[6]});
    game=doAction(game,0,'discard',17);
    assert.deepEqual(game.claim.eligibleSeats,[1,2]);
    game=doAction(game,order[0],'hu');
    assert.equal(game.history.some(e=>e.type==='hu'),false);
    game=doAction(game,order[1],'hu');
    const wins=game.history.filter(e=>e.type==='hu');
    assert.deepEqual(wins.map(e=>e.seat),[1,2]);
    assert.ok(wins.every(e=>e.source==='discard'&&e.fromSeat===0));
    assert.deepEqual(game.players.map(p=>p.huCount),[0,2,2]);
    assertGameInvariants(game);
  }
});
