import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, getPlayerView, getLegalActions, isWinningHand, getWaitTiles, assertGameInvariants, getHuDiagnostic, fanToPoints } from '../shared/game.js';

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
  head = [], tail = [], rules = {}, wallCount, kongSeats = [] } = {}) {
  const game = createGame({ seed: 'fixture', rules });
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

test('v2 deterministic deal has 144 tiles, eight copies, 14/13/13 hands', () => {
  const game = createGame({ seed: 42 });
  assert.equal(game.schemaVersion, 2);
  assert.deepEqual(game.players.map(player => player.hand.length), [14, 13, 13]);
  assert.deepEqual(game.players.map(player => player.winPile), [[], [], []]);
  assert.equal(game.wall.length, 104); assert.equal(game.turnStep, 'discard');
  assertGameInvariants(game); assertGameInvariants(createGame());
  assert.deepEqual(game, createGame({ seed: 42 }));
  assert.notDeepEqual(game.wall, createGame({ seed: 43 }).wall);
});

test('rejects malformed and unknown rules, including unsafe optional overlaps', () => {
  for (const rules of [{ sevenPairs: 'yes' }, { baseFan: 0 }, { baseFan: 1.5 }, { sixPlusCopyFan: -1 }, { dragonPoints: { 9: 50 } }, { dragonPoints: null }, { repeatHuLock: 'never' }, { radishScope: 'unknown' }, { bigSingleOverlap: 'both' }, { arbitrary: true }, JSON.parse('{"__proto__":true}')]) assert.throws(() => createGame({ seed: 1, rules }));
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

test('first selfdraw adds six tail radishes, records one physical win and auto-discards locked continuation', () => {
  let game = fixture({ head: [17, 6], tail: [1, 2, 3, 4, 5, 6] });
  const wall = game.wall.length;
  game = doAction(game, 0, 'hu');
  assert.deepEqual(game.players[0].radishes, [6, 5, 4, 3, 2, 1]);
  assert.equal(game.players[0].hand.length, 13); assert.equal(game.players[0].huCount, 1);
  assert.deepEqual(game.players[0].winPile, [{ tile: 17, source: 'selfDraw', virtual: false }]);
  assert.deepEqual(game.retiredTiles, [{ seat: 0, tile: 17 }]);
  assert.equal(game.wall.length, wall - 8); assert.equal(game.currentSeat, 1);
  assert.equal(game.players[0].huLockActive, true);
  assert.equal(game.discards[0].tile, 17); assert.equal(game.history.find(event => event.type === 'discard').automatic, true);
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

test('full natural seat cycle unlocks same wait after immediate continuation remains locked', () => {
  let game = doAction(fixture({ head: [17, 6, 7, 17] }), 0, 'hu');
  assert.equal(game.currentSeat, 1); assert.equal(game.players[0].huLockActive, true);
  game = passAll(doAction(game, 1, 'discard', 6));
  assert.equal(game.currentSeat, 2); assert.equal(game.lastDraw.tile, 7);
  game = passAll(doAction(game, 2, 'discard', 7));
  assert.equal(game.currentSeat, 0); assert.equal(game.lastDraw.tile, 17);
  assert.equal(game.players[0].huLockActive, false); assert.equal(has(game, 0, 'hu'), true);
  game = doAction(game, 0, 'hu');
  assert.equal(game.players[0].huCount, 2); assert.equal(game.players[0].winPile.length, 2);
  assert.equal(game.players[0].radishes.length, 6); assert.equal(game.retiredTiles.length, 2);
});

test('overlapping waits lock hu; disjoint waits and alternative lock rule are explicit', () => {
  let game = fixture({ huCounts: [1, 0, 0], locks: [[16, 17], [], []], activeLocks: [true, false, false] });
  assert.equal(has(game, 0, 'hu'), false); assert.equal(getHuDiagnostic(game, 0).code, 'WAIT_LOCK');
  game = fixture({ huCounts: [1, 0, 0], locks: [[16], [], []], activeLocks: [true, false, false] });
  assert.equal(has(game, 0, 'hu'), true);
  game = fixture({ huCounts: [1, 0, 0], locks: [[16], [], []], activeLocks: [true, false, false], rules: { allowChangedWaitDuringLock: false } });
  assert.equal(has(game, 0, 'hu'), false);
  game = doAction(fixture({ head: [17, 6, 7, 17], rules: { repeatHuLock: 'untilWaitChange' } }), 0, 'hu');
  game = passAll(doAction(game, 1, 'discard', 6)); game = passAll(doAction(game, 2, 'discard', 7));
  assert.equal(game.players[0].huLockActive, true); assert.equal(game.players[0].huCount, 1);
});

test('already-hu players cannot peng and their discards cannot be penged', () => {
  let game = doAction(fixture({ hands: [winning, pengHand, waiting], huCounts: [0, 1, 0] }), 0, 'discard', 17);
  assert.equal(has(game, 1, 'peng'), false);
  game = doAction(fixture({ hands: [winning, pengHand, waiting], huCounts: [1, 0, 0] }), 0, 'discard', 17);
  assert.equal(has(game, 1, 'peng'), false); assert.equal(has(game, 2, 'hu'), false);
  assert.notEqual(game.phase, 'claim');
});

test('ordinary post-hu discard is protected but post-kong discard allows hu and selfdraw-style payment', () => {
  let game = doAction(fixture({ huCounts: [1, 0, 0], kongSeats: [0] }), 0, 'discard', 17);
  assert.equal(has(game, 1, 'hu'), true);
  game = doAction(game, 1, 'hu'); game = doAction(game, 2, 'pass');
  const event = huEvent(game, 1);
  assert.equal(event.source, 'kongDiscard'); assert.equal(event.payments.length, 3);
  assert.ok(game.players[0].score < 0 && game.players[2].score < 0);
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
  assert.equal(game.wall.length, wall - 12); assert.equal(game.history.some(event => event.type === 'draw'), false);
  assert.equal(game.history.filter(event => event.type === 'hu').length, 2);
  assert.equal(game.players[2].winPile[0].virtual, true);
  assertGameInvariants(game);
});

test('third selfdraw winner ends immediately with wall remaining and settled score', () => {
  let game = fixture({ huCounts: [0, 1, 1], head: [6] }); const wall = game.wall.length;
  game = doAction(game, 0, 'hu');
  assert.equal(game.finishReason, 'allPlayersHu'); assert.equal(game.wall.length, wall - 6);
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

test('concealed kong pays each opponent 2, tail radish then head replacement; identity stays private', () => {
  let game = fixture({ hands: [nonWinningKong, waiting, waiting], head: [6], tail: [7], drawTile: 0 });
  const wall = game.wall.length;
  game = doAction(game, 0, 'anGang', 0);
  assert.deepEqual(game.players.map(player => player.score), [4, -2, -2]);
  assert.deepEqual(game.players[0].radishes, [7]); assert.equal(game.lastDraw.tile, 6);
  assert.equal(game.players[0].hand.length, 11); assert.equal(game.wall.length, wall - 2);
  assert.equal(game.players[0].pendingKongDiscard, true); assert.equal(game.players[0].kongCount, 1);
  const view = getPlayerView(game, 1);
  assert.deepEqual(view.players[0].melds[0].tiles, [null, null, null, null]);
  assert.equal(game.history.find(event => event.type === 'anGang').tile, undefined);
  const before = structuredClone(game); assert.throws(() => doAction(game, 0, 'anGang', 0)); assert.deepEqual(game, before);
  assertGameInvariants(game);
});

test('peng upgrade pays each opponent 1, preserves meld count and grants one radish', () => {
  const hand = [0, 1, 2, 3, 9, 10, 11, 12, 13, 16, 17];
  let game = fixture({ hands: [hand, waiting, waiting], melds: [[meld(0)], [], []], head: [6], tail: [7], drawTile: 0 });
  game = doAction(game, 0, 'buGang', 0);
  assert.deepEqual(game.players.map(player => player.score), [2, -1, -1]);
  assert.equal(game.players[0].melds.length, 1); assert.equal(game.players[0].melds[0].tiles.length, 4);
  assert.deepEqual(game.players[0].radishes, [7]); assert.equal(game.lastDraw.tile, 6);
  assertGameInvariants(game);
});

test('existing kong can add exactly a fifth tile, with another 1 each, radish and replacement', () => {
  let game = fixture({ hands: [nonWinningKong, waiting, waiting], head: [0, 6], tail: [7, 8], drawTile: 0 });
  game = doAction(game, 0, 'anGang', 0); assert.equal(has(game, 0, 'addGang', 0), true);
  game = doAction(game, 0, 'addGang', 0);
  assert.deepEqual(game.players.map(player => player.score), [6, -3, -3]);
  assert.equal(game.players[0].melds[0].tiles.length, 5); assert.equal(game.players[0].melds.length, 1);
  assert.deepEqual(game.players[0].radishes, [8, 7]); assert.equal(game.lastDraw.tile, 6); assert.equal(game.players[0].kongCount, 2);
  assert.equal(getPlayerView(game, 1).players[0].melds[0].tiles.length, 5);
  assert.equal(game.history.find(event => event.type === 'addGang').tile, undefined);
  const hand = [0, 1, 2, 3, 9, 10, 11, 12, 13, 16, 17];
  game = fixture({ hands: [hand, waiting, waiting], melds: [[meld(0, 'anGang', 5)], [], []], drawTile: 0 });
  assert.equal(has(game, 0, 'addGang', 0), false); assert.throws(() => doAction(game, 0, 'addGang', 0));
});

test('post-hu concealed kong preserves whole wait set; replacement never unlocks repeat hu', () => {
  const hand = [0, 0, 0, 0, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
  let game = fixture({ hands: [hand, waiting, waiting], drawTile: 0, huCounts: [1, 0, 0], locks: [[17], [], []], activeLocks: [true, false, false], head: [17, 6], tail: [7] });
  assert.equal(has(game, 0, 'anGang', 0), true);
  game = doAction(game, 0, 'anGang', 0);
  assert.equal(game.players[0].huLockActive, true); assert.equal(game.players[0].huCount, 1);
  assert.equal(game.discards[0].tile, 17); assert.equal(game.discards[0].afterKong, true);
  assert.equal(game.history.some(event => event.type === 'hu'), false); assert.equal(game.phase, 'claim');
  assertGameInvariants(game);
  const changing = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17];
  game = fixture({ hands: [changing, waiting, waiting], drawTile: 0, huCounts: [1, 0, 0], activeLocks: [true, false, false], locks: [[17], [], []] });
  assert.equal(has(game, 0, 'anGang', 0), false);
});

test('a kong requires both a tail radish and head replacement; rejection never transfers points', () => {
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

test('five-tile kong contributes two fan, but six-plus copies do not invent extra fan', () => {
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  let game = doAction(fixture({ hands: [hand, waiting, waiting], melds: [[meld(0, 'anGang', 5)], [], []], huCounts: [1, 0, 0] }), 0, 'hu');
  assert.equal(huEvent(game).score.copyFanBonus, 2);
  const six = [0, 0, 0, 0, 0, 0, 3, 4, 5, 9, 10, 11, 17, 17];
  game = doAction(fixture({ hands: [six, noZero, noZero], huCounts: [1, 0, 0] }), 0, 'hu');
  assert.equal(huEvent(game).score.copyFanBonus, 0); assert.equal(huEvent(game).score.dragonBonus, 10);
  game = doAction(fixture({ hands: [six, noZero, noZero], huCounts: [1, 0, 0], rules: { sixPlusCopyFan: 3 } }), 0, 'hu');
  assert.equal(huEvent(game).score.copyFanBonus, 3); assert.equal(huEvent(game).score.fanPoints, 8);
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
  assert.equal(huEvent(game).score.fanPoints, 2); assert.equal(huEvent(game).score.radishBonus, 3); assert.equal(huEvent(game).score.total, 5);
});

test('radishes default to own pile; shared scope and meld participation are configurable', () => {
  for (const [rules, expected] of [[{}, 0], [{ radishScope: 'all' }, 2]]) {
    const game = doAction(fixture({ huCounts: [1, 0, 0], radishes: [[], [17], []], rules }), 0, 'hu');
    assert.equal(huEvent(game).score.radishBonus, expected);
  }
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  const game = doAction(fixture({ hands: [hand, waiting, waiting], melds: [[meld(0)], [], []], huCounts: [1, 0, 0], radishes: [[0], [], []], rules: { radishCountsMelds: false } }), 0, 'hu');
  assert.equal(huEvent(game).score.radishBonus, 0);
});

test('dragon 6/7/8 retains 10/20/40 separate from fan with explicit additive/max overlap', () => {
  const hand = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17];
  for (const [count, expected] of [[6, 10], [7, 20], [8, 40]]) {
    const game = doAction(fixture({ hands: [hand, noZero, noZero], huCounts: [1, 0, 0], radishes: [Array(count - 4).fill(0), [], []] }), 0, 'hu');
    assert.equal(huEvent(game).score.dragonBonus, expected); assert.equal(huEvent(game).score.fan, 2);
    assert.equal(huEvent(game).score.total, 2 + 4 * (count - 4) + expected);
  }
  const game = doAction(fixture({ hands: [hand, noZero, noZero], huCounts: [1, 0, 0], radishes: [[0, 0], [], []], rules: { stackDragonBonus: false, dragonPoints: { 6: 13 } } }), 0, 'hu');
  assert.equal(huEvent(game).score.total, 13);
});

test('big single wait charges each opponent exactly 50 by default, even on a discard', () => {
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

test('diagnostics explain shape, wait lock, protected discard, wrong turn and pending response privately', () => {
  let game = fixture({ hands: [[...waiting, 16], waiting, waiting], drawTile: 16 });
  assert.equal(getHuDiagnostic(game, 0).code, 'SHAPE'); assert.deepEqual(getHuDiagnostic(game, 0).waitTiles, [17]);
  assert.equal(getHuDiagnostic(game, 1).code, 'WRONG_TURN');
  game = fixture({ huCounts: [1, 0, 0], locks: [[17], [], []], activeLocks: [true, false, false] });
  assert.equal(getHuDiagnostic(game, 0).code, 'WAIT_LOCK');
  // A protected discard can still have a legal kong claimant; diagnostic never reads others' hands.
  game = doAction(fixture({ hands: [winning, kongHand, waiting], huCounts: [1, 0, 0] }), 0, 'discard', 17);
  assert.equal(game.phase, 'claim'); assert.equal(getHuDiagnostic(game, 2).code, 'PROTECTED_DISCARD');
  assert.equal(has(game, 2, 'hu'), false);
  assert.ok(game.history.every(event => !Object.hasOwn(event, 'huDiagnostic')));
  const view = getPlayerView(game, 2);
  assert.equal(view.huDiagnostic.code, 'PROTECTED_DISCARD'); assert.equal(view.players[0].huDiagnostic, undefined);
});

test('private view hides wall, opposing hands/draws/locks and diagnostic is independent of them', () => {
  const game = createGame({ seed: 44 }); game.players[1].lockedWaits = [4, 7];
  const view = getPlayerView(game, 0);
  assert.equal(view.schemaVersion, 2); assert.equal(view.players[1].hand, undefined); assert.equal(view.players[2].hand, undefined);
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


test('prior winning tiles always add copy fan but radish and dragon overlap require explicit flags', () => {
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  for (const [rules, radishBonus, dragonBonus] of [[{}, 6, 0], [{ radishCountsWinPile: true }, 8, 0], [{ dragonCountsWinPile: true }, 6, 10], [{ radishCountsWinPile: true, dragonCountsWinPile: true }, 8, 10]]) {
    const game = doAction(fixture({ hands: [hand, noZero, noZero], melds: [[meld(0)], [], []], priorWins: [[0], [], []], huCounts: [1, 0, 0], radishes: [[0, 0], [], []], rules }), 0, 'hu');
    const score = huEvent(game).score;
    assert.equal(score.fan, 2); assert.equal(score.radishBonus, radishBonus); assert.equal(score.dragonBonus, dragonBonus);
    assert.equal(score.total, 2 + radishBonus + dragonBonus);
  }
});

test('a first simultaneous winner completing the table does not cancel an already-hu repeat winner', () => {
  let game = doAction(fixture({ huCounts: [1, 0, 1], kongSeats: [0], head: [6] }), 0, 'discard', 17);
  const wall = game.wall.length;
  game = doAction(game, 2, 'hu'); game = doAction(game, 1, 'hu');
  assert.equal(game.finishReason, 'allPlayersHu');
  assert.deepEqual(game.players.map(player => player.huCount), [1, 1, 2]);
  assert.equal(game.history.filter(event => event.type === 'hu').length, 2);
  assert.equal(game.wall.length, wall - 6); assert.equal(game.history.some(event => event.type === 'draw'), false);
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
