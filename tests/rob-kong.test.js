import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, getLegalActions, getPlayerView, assertGameInvariants } from '../shared/game.js';

const sourceHand = [0, 1, 2, 3, 9, 10, 11, 12, 13, 14, 17];
const waitZero = [1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17, 17];
const move = (game, seat, type, tile) => applyAction(game, seat, tile === undefined ? { type } : { type, tile });
const huEvents = game => game.history.filter(event => event.type === 'hu');
const gangEvents = game => game.history.filter(event => ['buGang', 'addGang', 'anGang', 'mingGang'].includes(event.type));
function fixture({ count = 3, meldType = count === 3 ? 'peng' : 'buGang', seat = 0,
  sourceWon = false, receiverWon = false, replacement = false, head = [6], receivers = [waitZero, waitZero],
  rules = {}, firstHuRadishesRevealed = true, receiverMelds = [[], []], ownHand = sourceHand, drawTile = 0 } = {}) {
  const game = createGame({ seed: 'rob-kong', rules });
  const others = [1, 2].map(offset => (seat + offset) % 3);
  game.players.forEach((p, index) => {
    p.hand = [...(index === seat ? ownHand : receivers[others.indexOf(index)])].sort((a, b) => a - b);
    p.melds = index === seat ? [{ type: meldType, tile: 0, tiles: Array(count).fill(0) }] : structuredClone(receiverMelds[others.indexOf(index)]);
    p.huCount = (index === seat ? sourceWon : receiverWon) ? 1 : 0;
    p.winPile = p.huCount ? [{ tile: 6, source: 'selfDraw', virtual: false }] : [];
    p.huLockActive = p.huCount > 0; p.lockedWaits = p.huCount ? [0] : [];
  });
  game.retiredTiles = game.players.flatMap(p => p.winPile.map(win => ({ seat: p.seat, tile: win.tile })));
  game.currentSeat = seat; game.phase = 'turn'; game.turnStep = 'discard'; game.history = [];
  game.lastDraw = { seat, tile: drawTile, source: replacement ? 'replacement' : 'normal',
    ...(replacement ? { kongSource: { type: 'buGang', fromSeat: null } } : {}) };
  game.firstHuRadishesRevealed = firstHuRadishesRevealed;
  const counts = Array(18).fill(8);
  for (const tile of [...head, ...game.retiredTiles.map(x => x.tile), ...game.players.flatMap(p => [...p.hand, ...p.melds.flatMap(m => m.tiles)])]) assert.ok(--counts[tile] >= 0);
  game.wall = [...head, ...counts.flatMap((count, tile) => Array(count).fill(tile))];
  assertGameInvariants(game);
  return game;
}
function passAll(game) {
  while (game.phase === 'claim') game = move(game, game.claim.eligibleSeats.find(seat => !game.claim.responses[seat]), 'pass');
  return game;
}

for (const count of [3, 4, 5, 6, 7]) for (const meldType of count === 3 ? ['peng'] : ['buGang', 'mingGang', 'anGang']) {
  test(`${meldType} ${count}→${count + 1} waits for hu/pass before any kong effect`, () => {
    const initial = fixture({ count, meldType });
    let game = move(initial, 0, count === 3 ? 'buGang' : 'addGang', 0);
    assert.equal(game.claim.kind, 'robKong');
    assert.equal(game.wall.length, initial.wall.length);
    assert.deepEqual(game.players.map(p => p.score), [0, 0, 0]);
    assert.deepEqual(game.players[0].melds, initial.players[0].melds);
    assert.deepEqual(game.players[0].radishes, []);
    assert.equal(game.players[0].kongCount, 0);
    assert.equal(game.players[0].hand.length, initial.players[0].hand.length - 1);
    assert.equal(gangEvents(game).length, 0);
    assert.equal(game.history.at(-1).type, 'robKongAttempt');
    for (const seat of [1, 2]) {
      assert.deepEqual(getLegalActions(game, seat), [{ type: 'hu' }, { type: 'pass' }]);
      assert.equal(getPlayerView(game, seat).claim.kind, 'robKong');
      assert.equal(getPlayerView(game, seat).huDiagnostic.code, 'AVAILABLE');
      assert.throws(() => move(game, seat, 'peng', 0));
      assert.throws(() => move(game, seat, 'mingGang', 0));
    }
    assert.deepEqual(getLegalActions(game, 0), []);
    game = move(game, 2, 'pass');
    assert.equal(game.phase, 'claim');
    assert.equal(game.wall.length, initial.wall.length);
    assert.throws(() => move(game, 2, 'pass'));
    game = move(JSON.parse(JSON.stringify(game)), 1, 'pass');
    assert.equal(game.players[0].melds[0].tiles.length, count + 1);
    assert.equal(game.players[0].radishes.length, 1);
    assert.equal(game.players[0].kongCount, 1);
    assert.equal(game.wall.length, initial.wall.length - 2);
    assert.deepEqual(game.players.map(p => p.score), [2, -1, -1]);
    assert.equal(gangEvents(game).length, 1);
    assert.equal(game.lastDraw.source, 'replacement');
    assert.equal(game.lastDraw.kongSource.type, count === 3 ? 'buGang' : 'addGang');
    assertGameInvariants(game);
  });
}

for (const seat of [0, 1, 2]) for (const reverse of [false, true]) {
  test(`rob double win payer ${seat}, response reversal ${reverse}: fixed priority and atomic settlement`, () => {
    const initial = fixture({ seat });
    let game = move(initial, seat, 'buGang', 0);
    const winners = [1, 2].map(offset => (seat + offset) % 3);
    const responses = reverse ? [...winners].reverse() : winners;
    game = move(game, responses[0], 'hu');
    assert.equal(huEvents(game).length, 0);
    assert.deepEqual(game.players.map(p => p.score), [0, 0, 0]);
    game = move(game, responses[1], 'hu');
    assert.deepEqual(huEvents(game).map(event => event.seat), winners);
    for (const event of huEvents(game)) {
      assert.equal(event.source, 'robKong');
      assert.equal(event.score.robKongBonus, 1);
      assert.equal(event.score.fan, 2);
      assert.equal(event.points, 2);
      assert.deepEqual(event.payments.filter(payment => payment.delta < 0).map(payment => payment.seat), [seat]);
      assert.match(event.message, /抢杠胡/);
    }
    assert.equal(game.players[seat].score, -4);
    assert.equal(game.players[seat].melds[0].type, 'peng');
    assert.equal(game.players[seat].melds[0].tiles.length, 3);
    assert.equal(game.players[seat].kongCount, 0);
    assert.deepEqual(game.players[seat].radishes, []);
    assert.equal(gangEvents(game).length, 0);
    assert.equal(game.wall.length, initial.wall.length - 1); // Winner continuation draw only.
    assert.equal(game.currentSeat, winners[0]);
    assert.equal(game.players[winners[1]].winPile.at(-1).virtual, true);
    assertGameInvariants(game);
  });
}

test('already-won ordinary first upgrade is protected; its replacement upgrade can be robbed by won and unwon players', () => {
  let game = fixture({ sourceWon: true, head: [0, 6] });
  const wall = game.wall.length;
  game = move(game, 0, 'buGang', 0);
  assert.equal(game.phase, 'turn');
  assert.equal(game.players[0].melds[0].tiles.length, 4);
  assert.equal(game.lastDraw.source, 'replacement');
  assert.equal(game.lastDraw.tile, 0);
  const scores = game.players.map(p => p.score);
  game = move(game, 0, 'addGang', 0);
  assert.equal(game.claim.kind, 'robKong');
  assert.deepEqual(game.claim.eligibleSeats, [1, 2]);
  game = move(move(game, 2, 'hu'), 1, 'hu');
  assert.equal(game.phase, 'finished');
  assert.equal(game.finishReason, 'allPlayersHu');
  assert.equal(game.players[0].melds[0].tiles.length, 4);
  assert.equal(game.players[0].kongCount, 1);
  assert.equal(game.players[0].radishes.length, 1);
  assert.equal(game.wall.length, wall - 2);
  assert.equal(gangEvents(game).length, 1);
  assert.ok(game.players[0].score < scores[0]);
  assertGameInvariants(game);
  const repeated = move(fixture({ sourceWon: true, receiverWon: true, replacement: true }), 0, 'buGang', 0);
  assert.deepEqual(repeated.claim.eligibleSeats, [1, 2]);
});

test('unwon first upgrade can be robbed by previously won locked player', () => {
  const initial = fixture({ receiverWon: true, rules: { allowChangedWaitDuringLock: false } });
  let game = move(initial, 0, 'buGang', 0);
  assert.deepEqual(game.claim.eligibleSeats, [1, 2]);
  game = move(move(game, 1, 'hu'), 2, 'pass');
  assert.equal(game.players[1].huCount, 2);
  assert.equal(huEvents(game)[0].source, 'robKong');
  assert.equal(huEvents(game)[0].score.robKongBonus, 1);
  assertGameInvariants(game);
});

test('first hu radishes still flip once for a robbed tile; there is no kong radish or replacement', () => {
  const initial = fixture({ firstHuRadishesRevealed: false });
  let game = move(initial, 0, 'buGang', 0);
  game = move(move(game, 1, 'hu'), 2, 'hu');
  assert.equal(game.players[0].radishes.length, 0);
  assert.equal(game.players[1].radishes.length, 6);
  assert.equal(game.players[2].radishes.length, 0);
  assert.equal(game.wall.length, initial.wall.length - 7);
  assert.equal(gangEvents(game).length, 0);
  assertGameInvariants(game);
});

test('pending rob state rejects invalid claim options or missing original meld', () => {
  const game = move(fixture(), 0, 'buGang', 0);
  const bad = structuredClone(game); bad.claim.options[1].push({ type: 'peng', tile: 0 });
  assert.throws(() => assertGameInvariants(bad), /抢杠状态/);
  const badMeld = structuredClone(game); badMeld.claim.kongType = 'addGang';
  assert.throws(() => assertGameInvariants(badMeld), /抢杠状态/);
});

for (const repeated of [false, true]) for (const pure of [false, true]) {
  test(`seven pairs rob-kong has no event bonus: repeat=${repeated}, pure=${pure}`, () => {
    const hand = pure ? [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6] : [0, 1, 1, 2, 2, 9, 9, 10, 10, 11, 11, 12, 12];
    let game = fixture({ receivers: [hand, waitZero], receiverWon: repeated });
    if (repeated) {
      game.players[1].firstHuPattern = { kind: 'sevenPairs', pureSuit: pure, allTriplets: false,
        waitTiles: [...new Set(hand)], sevenPairsFan: 3, fixedFan: pure ? 5 : 3 };
    }
    assertGameInvariants(game);
    game = move(game, 0, 'buGang', 0);
    game = move(move(game, 1, 'hu'), 2, 'pass');
    const event = huEvents(game)[0];
    assert.equal(event.source, 'robKong');
    assert.equal(event.score.fan, pure ? 5 : 3);
    assert.equal(event.score.fanPoints, pure ? 10 : 4);
    assert.equal(event.score.sevenPairsFixed, true);
    assert.equal(event.score.robKongBonus, undefined);
    assert.equal(event.score.patternBonuses.some(bonus => bonus.type === 'robKong'), false);
    assert.equal(game.players[1].firstHuPattern.fixedFan, pure ? 5 : 3);
    assertGameInvariants(game);
  });
}

test('big single rob-kong adds one fan but charges only upgrader, including final first win', () => {
  const melds = [1, 4, 9, 12].map(tile => ({ tile, type: 'peng', tiles: Array(3).fill(tile) }));
  let game = fixture({ sourceWon: true, replacement: true, receivers: [[0], waitZero], receiverMelds: [melds, []] });
  game.players[2].huCount = 1; // Prior hu without an additional physical record is supported by older saved fixtures.
  game = move(game, 0, 'buGang', 0);
  game = move(move(game, 1, 'hu'), 2, 'pass');
  const event = huEvents(game)[0];
  assert.equal(game.finishReason, 'allPlayersHu');
  assert.equal(event.score.bigSingle, true);
  assert.equal(event.score.fan, 4); // base + big single two + rob one.
  assert.equal(event.score.robKongBonus, 1);
  assert.deepEqual(event.payments.filter(payment => payment.delta < 0).map(payment => payment.seat), [0]);
  assertGameInvariants(game);
});

test('initial concealed kong is not an upgrade and cannot be robbed', () => {
  const waitOne = [0, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17, 17];
  let game = fixture({ ownHand: [1, 1, 1, 1, 2, 3, 9, 10, 11, 12, 13], drawTile: 1, receivers: [waitOne, waitOne] });
  game = move(game, 0, 'anGang', 1);
  assert.equal(game.claim, null);
  assert.equal(game.players[0].melds[1].type, 'anGang');
  assert.equal(game.players[0].kongCount, 1);
  assert.equal(game.history.some(event => event.type === 'robKongAttempt'), false);
  assertGameInvariants(game);
});

test('saved single-winner rule still resolves rob-kong clockwise independent of response order', () => {
  for (const reverse of [false, true]) {
    let game = move(fixture({ rules: { multipleWinners: false } }), 0, 'buGang', 0);
    game = reverse ? move(move(game, 2, 'hu'), 1, 'hu') : move(move(game, 1, 'hu'), 2, 'hu');
    assert.deepEqual(huEvents(game).map(event => event.seat), [1]);
    assert.equal(game.players[2].huCount, 0);
    assert.equal(game.players[0].melds[0].tiles.length, 3);
    assertGameInvariants(game);
  }
});

test('no eligible robber commits an upgrade immediately, without an empty reaction window', () => {
  const waitSeventeen = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
  const initial = fixture({ receivers: [waitSeventeen, waitSeventeen] });
  const game = move(initial, 0, 'buGang', 0);
  assert.equal(game.claim, null);
  assert.equal(game.players[0].melds[0].tiles.length, 4);
  assert.equal(game.players[0].kongCount, 1);
  assert.equal(game.wall.length, initial.wall.length - 2);
  assert.equal(game.history.some(event => event.type === 'robKongAttempt'), false);
  assertGameInvariants(game);
});
