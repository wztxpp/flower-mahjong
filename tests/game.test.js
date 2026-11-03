import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, getPlayerView, getLegalActions, isWinningHand, getWaitTiles, assertGameInvariants } from '../shared/game.js';

const waiting = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
const winning = [...waiting, 17];
const has = (game, seat, type, tile) => getLegalActions(game, seat).some(action => action.type === type && (tile === undefined || action.tile === tile));
const doAction = (game, seat, type, tile) => applyAction(game, seat, tile === undefined ? { type } : { type, tile });

/** Deterministic test fixture with real eight-copy tile conservation. */
function fixture({ hands = [winning, waiting, waiting], melds = [[], [], []], radishes = [[], [], []],
  huCounts = [0, 0, 0], locks = [[], [], []], activeLocks = [false, false, false],
  currentSeat = 0, turnStep = 'discard', drawTile = hands[currentSeat]?.at(-1),
  drawKind = 'normal', head = [], tail = [], rules = {}, wallCount, kongSeats = [] } = {}) {
  const game = createGame({ seed: 'fixture', rules });
  game.players.forEach((player, seat) => {
    player.hand = [...hands[seat]].sort((a, b) => a - b);
    player.melds = structuredClone(melds[seat]);
    player.radishes = [...radishes[seat]];
    player.huCount = huCounts[seat];
    player.lockedWaits = [...locks[seat]];
    player.huLockActive = activeLocks[seat];
    player.pendingKongDiscard = kongSeats.includes(seat);
  });
  game.phase = 'turn'; game.currentSeat = currentSeat; game.turnStep = turnStep; game.drawKind = drawKind;
  game.lastDraw = turnStep === 'discard' && drawTile !== null ? { seat: currentSeat, tile: drawTile, source: 'normal' } : null;
  game.discards = []; game.retiredTiles = []; game.history = []; game.revision = 0;
  const counts = Array(18).fill(8);
  const use = tile => { assert.ok(--counts[tile] >= 0, `Fixture overused tile ${tile}`); };
  for (const player of game.players) [...player.hand, ...player.melds.flatMap(m => m.tiles), ...player.radishes].forEach(use);
  head.forEach(use); tail.forEach(use);
  let rest = counts.flatMap((count, tile) => Array(count).fill(tile));
  if (wallCount !== undefined) {
    const targetRest = wallCount - head.length - tail.length;
    assert.ok(targetRest >= 0);
    const retired = rest.splice(targetRest);
    game.retiredTiles = retired.map(tile => ({ seat: 0, tile }));
  }
  game.wall = [...head, ...rest, ...tail];
  assertGameInvariants(game);
  return game;
}

function passAll(game) {
  while (game.phase === 'claim') {
    const seat = game.claim.eligibleSeats.find(value => !game.claim.responses[value]);
    game = doAction(game, seat, 'pass');
  }
  return game;
}

function deterministicRandom(seed) {
  let state = seed + 1;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

test('144 tiles, eight of each, three seats, dealer has fourteen', () => {
  const game = createGame({ seed: 42 });
  assert.deepEqual(game.players.map(p => p.hand.length), [14, 13, 13]);
  assert.equal(game.wall.length, 104);
  assert.equal(game.currentSeat, 0);
  assert.equal(game.turnStep, 'discard');
  assertGameInvariants(game);
  assert.deepEqual(game, createGame({ seed: 42 }));
  assert.notDeepEqual(game.wall, createGame({ seed: 43 }).wall);
});

test('production shuffle works without a seed', () => {
  assertGameInvariants(createGame());
});

test('rejects unsupported or unsafe rule configuration', () => {
  for (const rules of [{ sevenPairs: 'yes' }, { baseHuPoints: -1 }, { dragonPoints: { 9: 50 } }, { repeatHuLock: 'never' }, { arbitrary: true }, JSON.parse('{"__proto__":true}')]) {
    assert.throws(() => createGame({ seed: 1, rules }));
  }
});

test('standard win, invalid shape, suit boundaries and exposed melds', () => {
  assert.equal(isWinningHand(winning), true);
  assert.equal(isWinningHand(waiting), false);
  assert.equal(isWinningHand([6, 7, 8, 9, 10, 11, 12, 13, 14, 0, 1, 2, 17, 17]), true);
  assert.equal(isWinningHand([7, 8, 9, 0, 1, 2, 3, 4, 5, 12, 13, 14, 17, 17]), false);
  assert.equal(isWinningHand([0, 1, 2, 9, 10, 11, 17, 17], 2), true);
  assert.equal(isWinningHand([0, 1, 2, 9, 10, 11, 17, 17], 1), false);
  assert.equal(isWinningHand(Array(14).fill(0)), false);
});

test('seven pairs can be configured and four copies count as two pairs', () => {
  const pairs = [0, 0, 0, 0, 2, 2, 4, 4, 6, 6, 9, 9, 11, 11];
  assert.equal(isWinningHand(pairs), true);
  assert.equal(isWinningHand(pairs, 0, { sevenPairs: false }), false);
});

test('wait sets are based on structural shape and stay inside suit ranges', () => {
  assert.deepEqual(getWaitTiles(waiting), [17]);
  assert.deepEqual(getWaitTiles([0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 16]), [16]);
  assert.deepEqual(getWaitTiles(winning), []);
});

test('actions are immutable, reject wrong turn, unknown types and malformed tiles', () => {
  const game = createGame({ seed: 3 });
  const before = structuredClone(game);
  for (const [seat, action] of [[1, { type: 'draw' }], [0, { type: 'draw' }], [0, { type: 'discard', tile: 18 }], [0, { type: 'discard', tile: '0' }], [0, { type: 'explode' }], [0, { type: 'discard', tile: game.players[0].hand[0], cheat: true }], [3, { type: 'hu' }], [0, null]]) {
    assert.throws(() => applyAction(game, seat, action));
  }
  assert.deepEqual(game, before);
  const next = doAction(game, 0, 'discard', game.players[0].hand[0]);
  assert.notEqual(game, next);
  assert.deepEqual(game, before);
  assert.equal(next.revision, 1);
  assertGameInvariants(next);
});

test('views contain only the viewer’s hand, no wall, seed, hidden draws or other locks', () => {
  const game = createGame({ seed: 44 });
  game.players[0].lockedWaits = [4, 7];
  const view = getPlayerView(game, 1);
  assert.equal(view.players[0].hand, undefined);
  assert.equal(view.players[2].hand, undefined);
  assert.deepEqual(view.players[1].hand, game.players[1].hand);
  assert.equal(view.players[0].lockedWaits, undefined);
  assert.equal(view.wall, undefined);
  assert.equal(view.lastDraw, undefined);
  assert.equal(view.seed, undefined);
  assert.equal(view.drawnTile, null);
  assert.throws(() => getPlayerView(game, -1));
  view.players[1].hand[0] = 99;
  assert.notEqual(game.players[1].hand[0], 99);
});

test('a natural draw is private in history and only own view exposes drawn tile', () => {
  let game = createGame({ seed: 5 });
  game = passAll(doAction(game, 0, 'discard', game.players[0].hand[0]));
  const seat = game.currentSeat;
  const tile = game.wall[0];
  game = doAction(game, seat, 'draw');
  assert.equal(game.history.at(-1).tile, undefined);
  assert.equal(getPlayerView(game, seat).drawnTile, tile);
  assert.equal(getPlayerView(game, (seat + 1) % 3).drawnTile, null);
});

test('first selfdraw flips six tail radishes, uses tile once, and same seat continues', () => {
  let game = fixture({ tail: [1, 2, 3, 4, 5, 6] });
  const wallCount = game.wall.length;
  game = doAction(game, 0, 'hu');
  assert.equal(game.phase, 'turn');
  assert.equal(game.currentSeat, 0);
  assert.equal(game.turnStep, 'draw');
  assert.equal(game.drawKind, 'continuation');
  assert.deepEqual(game.players[0].radishes, [6, 5, 4, 3, 2, 1]);
  assert.equal(game.players[0].hand.length, 13);
  assert.equal(game.players[0].huCount, 1);
  assert.equal(game.wall.length, wallCount - 6);
  assert.deepEqual(game.retiredTiles, [{ seat: 0, tile: 17 }]);
  assert.equal(has(game, 0, 'hu'), false);
  assertGameInvariants(game);
});

test('same waits cannot repeat hu on immediate continuation draw', () => {
  let game = fixture({ head: [17] });
  game = doAction(game, 0, 'hu');
  game = doAction(game, 0, 'draw');
  assert.equal(isWinningHand(game.players[0].hand), true);
  assert.equal(game.players[0].huLockActive, true);
  assert.equal(has(game, 0, 'hu'), false);
  assert.throws(() => doAction(game, 0, 'hu'));
});

test('same wait can hu again after next natural draw; not permanently forbidden', () => {
  let game = fixture({ hands: [waiting, waiting, waiting], currentSeat: 0, turnStep: 'draw', head: [17],
    huCounts: [1, 0, 0], locks: [[17], [], []], activeLocks: [true, false, false] });
  game = doAction(game, 0, 'draw');
  assert.equal(game.players[0].huLockActive, false);
  assert.equal(has(game, 0, 'hu'), true);
  game = doAction(game, 0, 'hu');
  assert.equal(game.players[0].huCount, 2);
  assert.equal(game.players[0].radishes.length, 0, 'only first win flips six');
});

test('alternate untilWaitChange keeps overlap blocked even on natural draw', () => {
  let game = fixture({ hands: [waiting, waiting, waiting], turnStep: 'draw', head: [17], rules: { repeatHuLock: 'untilWaitChange' },
    huCounts: [1, 0, 0], locks: [[17], [], []], activeLocks: [true, false, false] });
  game = doAction(game, 0, 'draw');
  assert.equal(has(game, 0, 'hu'), false);
});

test('one overlapping wait blocks hu; fully disjoint waits can be allowed', () => {
  let game = fixture({ huCounts: [1, 0, 0], locks: [[16, 17], [], []], activeLocks: [true, false, false] });
  assert.equal(has(game, 0, 'hu'), false);
  game = fixture({ huCounts: [1, 0, 0], locks: [[16], [], []], activeLocks: [true, false, false] });
  assert.equal(has(game, 0, 'hu'), true);
  game = fixture({ huCounts: [1, 0, 0], locks: [[16], [], []], activeLocks: [true, false, false], rules: { allowChangedWaitDuringLock: false } });
  assert.equal(has(game, 0, 'hu'), false);
});

test('radish scores multiply physical counts: 2 in hand × 2 radishes = 4', () => {
  let game = fixture({ tail: [6, 7, 8, 15, 17, 17] });
  game = doAction(game, 0, 'hu');
  const entry = game.history.find(event => event.type === 'hu');
  assert.equal(entry.score.radishBonus, 4);
  assert.equal(entry.score.base, 1);
  assert.equal(entry.score.total, 5);
  assert.deepEqual(game.players.map(p => p.score), [10, -5, -5]);
  assert.equal(entry.score.handCounts, undefined);
});

test('dragon 6/7/8 matching owned tiles pays 10/20/40 and is configurable', () => {
  for (const [count, expected] of [[6, 10], [7, 20], [8, 40]]) {
    const hand = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17];
    const radicals = Array(count - 4).fill(0);
    let game = fixture({ hands: [hand, waiting.map(tile => tile === 0 ? 6 : tile), waiting.map(tile => tile === 0 ? 6 : tile)], huCounts: [1, 0, 0], radishes: [radicals, [], []] });
    game = doAction(game, 0, 'hu');
    assert.equal(game.history.find(event => event.type === 'hu').score.dragonBonus, expected);
  }
  let game = fixture({ hands: [[0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17], waiting, waiting], huCounts: [1, 0, 0], radishes: [[0, 0], [], []], rules: { dragonPoints: { 6: 13 } } });
  game = doAction(game, 0, 'hu');
  assert.equal(game.history.find(event => event.type === 'hu').score.dragonBonus, 13);
});

test('dragon and radish scoring includes exposed meld tiles by default', () => {
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  const meld = { type: 'peng', tile: 0, tiles: [0, 0, 0], fromSeat: 1 };
  let game = fixture({ hands: [hand, waiting, waiting], melds: [[meld], [], []], huCounts: [1, 0, 0], radishes: [[0, 0, 0], [], []] });
  game = doAction(game, 0, 'hu');
  assert.deepEqual(game.history.at(-1).score, { base: 1, radishBonus: 9, dragonBonus: 10, total: 20 });
});

test('ordinary discard hu charges only discarder and preserves one physical discard', () => {
  let game = fixture();
  game = doAction(game, 0, 'discard', 17);
  assert.equal(game.phase, 'claim');
  assert.equal(has(game, 1, 'hu'), true);
  game = doAction(game, 1, 'hu');
  assert.equal(game.phase, 'claim', 'must wait for other eligible response');
  game = doAction(game, 2, 'pass');
  assert.equal(game.currentSeat, 1);
  assert.equal(game.players[1].hand.length, 13);
  assert.deepEqual(game.discards[0].huSeats, [1]);
  assert.equal(game.discards[0].claimedBy, undefined);
  const entry = game.history.find(event => event.type === 'hu');
  assert.equal(entry.source, 'discard');
  assert.equal(entry.payments.length, 2);
  assert.equal(game.players[2].score, 0);
  assertGameInvariants(game);
});

test('an ordinary discard after discarder has hu cannot be hu by others', () => {
  let game = fixture({ huCounts: [1, 0, 0] });
  game = doAction(game, 0, 'discard', 17);
  assert.equal(has(game, 1, 'hu'), false);
  assert.equal(has(game, 2, 'hu'), false);
  assert.notEqual(game.phase, 'claim');
});

test('post-kong discard can be hu after discarder hu and charges like selfdraw', () => {
  let game = fixture({ huCounts: [1, 0, 0], kongSeats: [0] });
  game = doAction(game, 0, 'discard', 17);
  assert.equal(has(game, 1, 'hu'), true);
  game = doAction(game, 1, 'hu'); game = doAction(game, 2, 'pass');
  const event = game.history.find(event => event.type === 'hu');
  assert.equal(event.source, 'kongDiscard');
  assert.equal(event.payments.length, 3);
  assert.ok(game.players[0].score < 0 && game.players[2].score < 0);
  assert.equal(game.players[0].pendingKongDiscard, false);
});

test('claims are response-order independent, multi-winner configurable and clockwise', () => {
  function result(reverse, multipleWinners) {
    let game = doAction(fixture({ rules: { multipleWinners } }), 0, 'discard', 17);
    for (const seat of reverse ? [2, 1] : [1, 2]) game = doAction(game, seat, 'hu');
    return game;
  }
  const forward = result(false, true);
  assert.deepEqual(forward, result(true, true));
  assert.deepEqual(forward.players.map(p => p.huCount), [0, 1, 1]);
  assert.equal(forward.currentSeat, 1);
  assert.deepEqual(forward.discards[0].huSeats, [1, 2]);
  assert.deepEqual(result(false, false).players.map(p => p.huCount), [0, 1, 0]);
});

test('claim views hide pending decisions; double response and unrelated pass rejected', () => {
  let game = doAction(fixture(), 0, 'discard', 17);
  game = doAction(game, 2, 'hu');
  const view = getPlayerView(game, 1);
  assert.deepEqual(view.claim.respondedSeats, [2]);
  assert.equal(view.claim.responses, undefined);
  assert.equal(view.claim.options, undefined);
  assert.throws(() => doAction(game, 2, 'pass'));
  assert.throws(() => doAction(game, 0, 'pass'));
});

test('peng takes two hand tiles and the discard, no draw or immediate hu', () => {
  const hand1 = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 17, 17];
  let game = doAction(fixture({ hands: [winning, hand1, waiting] }), 0, 'discard', 17);
  game = doAction(game, 1, 'peng', 17); game = doAction(game, 2, 'pass');
  assert.equal(game.currentSeat, 1);
  assert.equal(game.players[1].hand.length, 11);
  assert.deepEqual(game.players[1].melds[0].tiles, [17, 17, 17]);
  assert.equal(game.discards[0].claimedBy, 1);
  assert.equal(has(game, 1, 'draw'), false);
  assert.equal(has(game, 1, 'hu'), false);
  assertGameInvariants(game);
});

test('hu has priority over peng independent of response timing', () => {
  const hand1 = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 17, 17];
  let game = doAction(fixture({ hands: [winning, hand1, waiting] }), 0, 'discard', 17);
  game = doAction(game, 1, 'peng', 17); game = doAction(game, 2, 'hu');
  assert.equal(game.currentSeat, 2);
  assert.equal(game.players[1].melds.length, 0);
  assert.equal(game.players[2].huCount, 1);
});

test('concealed kong flips one tail radish and auto-draws one head replacement', () => {
  const hand = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17];
  let game = fixture({ hands: [hand, waiting, waiting], head: [6], tail: [7], drawTile: 0 });
  const wall = game.wall.length;
  game = doAction(game, 0, 'anGang', 0);
  assert.deepEqual(game.players[0].radishes, [7]);
  assert.equal(game.lastDraw.tile, 6);
  assert.equal(game.players[0].hand.length, 11);
  assert.equal(game.wall.length, wall - 2);
  assert.equal(game.players[0].pendingKongDiscard, true);
  assertGameInvariants(game);
  const view = getPlayerView(game, 1);
  assert.deepEqual(view.players[0].melds[0].tiles, [null, null, null, null]);
  assert.equal(view.players[0].melds[0].tile, null);
  assert.equal(game.history.find(event => event.type === 'anGang').tile, undefined);
});

test('exposed kong consumes the discard once and gives one radish plus replacement', () => {
  const hand1 = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 17, 17, 17];
  let game = doAction(fixture({ hands: [winning, hand1, waiting], head: [6], tail: [7] }), 0, 'discard', 17);
  game = doAction(game, 1, 'mingGang', 17); game = doAction(game, 2, 'pass');
  assert.equal(game.players[1].melds[0].type, 'mingGang');
  assert.equal(game.players[1].hand.length, 11);
  assert.deepEqual(game.players[1].radishes, [7]);
  assert.equal(game.lastDraw.tile, 6);
  assert.equal(game.discards[0].claimedBy, 1);
  assertGameInvariants(game);
});

test('added kong upgrades existing peng instead of adding a fifth meld', () => {
  const hand = [0, 1, 2, 3, 9, 10, 11, 12, 13, 17, 17];
  let game = fixture({ hands: [hand, waiting, waiting], melds: [[{ type: 'peng', tile: 0, tiles: [0, 0, 0], fromSeat: 1 }], [], []], head: [6], tail: [7], drawTile: 0 });
  game = doAction(game, 0, 'buGang', 0);
  assert.equal(game.players[0].melds.length, 1);
  assert.equal(game.players[0].melds[0].type, 'buGang');
  assert.equal(game.players[0].melds[0].tiles.length, 4);
  assert.deepEqual(game.players[0].radishes, [7]);
  assertGameInvariants(game);
});

test('post-hu kong must preserve all waits; replacement does not expire hu lock', () => {
  const hand = [0, 0, 0, 0, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
  let game = fixture({ hands: [hand, waiting, waiting], drawTile: 0, huCounts: [1, 0, 0], locks: [[17], [], []], activeLocks: [true, false, false], head: [17], tail: [7] });
  assert.deepEqual(getWaitTiles(hand.filter((_, index) => index !== 0)), [17]);
  assert.equal(has(game, 0, 'anGang', 0), true);
  game = doAction(game, 0, 'anGang', 0);
  assert.equal(game.players[0].huLockActive, true);
  assert.equal(isWinningHand(game.players[0].hand, 1), true);
  assert.equal(has(game, 0, 'hu'), false);
  const changingHand = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17];
  game = fixture({ hands: [changingHand, waiting, waiting], drawTile: 0, huCounts: [1, 0, 0] });
  assert.equal(has(game, 0, 'anGang', 0), false);
});

test('a kong is disallowed if wall cannot supply both radish and replacement', () => {
  const hand = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17];
  const game = fixture({ hands: [hand, waiting, waiting], wallCount: 1 });
  assert.equal(has(game, 0, 'anGang', 0), false);
});

test('first hu takes all remaining radishes if fewer than six and ends consistently', () => {
  let game = fixture({ wallCount: 3 });
  game = doAction(game, 0, 'hu');
  assert.equal(game.phase, 'finished');
  assert.equal(game.wall.length, 0);
  assert.equal(game.players[0].radishes.length, 3);
  assert.equal(game.players[0].huCount, 1);
  assert.equal(game.players[0].hand.length, 13);
  assert.deepEqual(getLegalActions(game, 0), []);
  assertGameInvariants(game);
});

test('last wall tile remains playable and last discard claims resolve before finish', () => {
  let game = fixture({ hands: [waiting, waiting, waiting], turnStep: 'draw', head: [17], wallCount: 1 });
  game = doAction(game, 0, 'draw');
  assert.equal(game.phase, 'turn');
  game = doAction(game, 0, 'discard', 17);
  assert.equal(game.phase, 'claim');
  game = doAction(game, 1, 'hu'); game = doAction(game, 2, 'hu');
  assert.equal(game.phase, 'finished');
  assert.deepEqual(game.players.map(p => p.huCount), [0, 1, 1]);
  assertGameInvariants(game);
});

test('serialized state supports reconnect and identical subsequent actions', () => {
  const original = doAction(fixture(), 0, 'discard', 17);
  const resumed = JSON.parse(JSON.stringify(original));
  assert.deepEqual(getPlayerView(original, 2), getPlayerView(resumed, 2));
  assert.deepEqual(doAction(original, 2, 'pass'), doAction(resumed, 2, 'pass'));
});

test('100 complete seeded games conserve all tiles and zero-sum scores after every action', () => {
  for (let seed = 0; seed < 100; seed++) {
    const random = deterministicRandom(seed);
    let game = createGame({ seed });
    let actions = 0;
    while (game.phase !== 'finished') {
      assert.ok(++actions < 1200, `Seed ${seed} failed to finish`);
      const seat = game.phase === 'claim' ? game.claim.eligibleSeats.find(value => !game.claim.responses[value]) : game.currentSeat;
      const legal = getLegalActions(game, seat);
      assert.ok(legal.length, `No legal actions, seed ${seed}`);
      const action = legal.find(item => item.type === 'hu') || legal.find(item => item.type.endsWith('Gang')) || legal[Math.floor(random() * legal.length)];
      game = applyAction(game, seat, action);
      assertGameInvariants(game);
    }
    assert.equal(game.wall.length, 0);
  }
});

test('full natural seat cycle unlocks the same wait after a hu continuation is blocked', () => {
  let game = fixture({ head: [17, 6, 7, 17] });
  game = doAction(game, 0, 'hu');
  game = doAction(game, 0, 'draw');
  assert.equal(has(game, 0, 'hu'), false);
  game = passAll(doAction(game, 0, 'discard', 17));
  assert.equal(game.currentSeat, 1);
  game = doAction(game, 1, 'draw');
  game = passAll(doAction(game, 1, 'discard', 6));
  assert.equal(game.currentSeat, 2);
  game = doAction(game, 2, 'draw');
  game = passAll(doAction(game, 2, 'discard', 7));
  assert.equal(game.currentSeat, 0);
  game = doAction(game, 0, 'draw');
  assert.equal(has(game, 0, 'hu'), true);
  game = doAction(game, 0, 'hu');
  assert.equal(game.players[0].huCount, 2);
  assert.equal(game.players[0].radishes.length, 6);
  assert.equal(game.retiredTiles.length, 2);
});

test('hu has no hardcoded win-count cap and a new game resets scores', () => {
  let game = fixture({ huCounts: [99, 0, 0] });
  game = doAction(game, 0, 'hu');
  assert.equal(game.players[0].huCount, 100);
  assert.equal(game.phase, 'turn');
  assert.deepEqual(createGame({ seed: 1 }).players.map(p => p.score), [0, 0, 0]);
});

test('dragon ownership and additive scoring assumptions are configurable', () => {
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  const meld = { type: 'peng', tile: 0, tiles: [0, 0, 0], fromSeat: 1 };
  function score(rules) {
    let game = fixture({ hands: [hand, waiting, waiting], melds: [[meld], [], []], huCounts: [1, 0, 0], radishes: [[0, 0, 0], [], []], rules });
    game = doAction(game, 0, 'hu');
    return game.history.at(-1).score;
  }
  assert.deepEqual(score({}), { base: 1, radishBonus: 9, dragonBonus: 10, total: 20 });
  assert.deepEqual(score({ dragonCountsMelds: false }), { base: 1, radishBonus: 9, dragonBonus: 0, total: 10 });
  assert.deepEqual(score({ stackDragonBonus: false }), { base: 1, radishBonus: 9, dragonBonus: 10, total: 10 });
  assert.deepEqual(score({ radishCountsMelds: false }), { base: 1, radishBonus: 0, dragonBonus: 10, total: 11 });
});
