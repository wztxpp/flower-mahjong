import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, assertGameInvariants, getPlayerView, turnOrderAfter, dealerForNextGame } from '../shared/game.js';

const waiting = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
const peng = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 17, 17];
const gang = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 17, 17, 17];
const move = (game, seat, type, tile) => applyAction(game, seat, tile === undefined ? { type } : { type, tile });
function fixture(source, receivers = [waiting, waiting], { rules = {}, upgrade = false, head = [6, 7] } = {}) {
  const game = createGame({ seed: 'counterclockwise', dealerSeat: source, rules: { allowPungUpgrade: true, specialHuPatterns: false, autoDiscardAfterHu: false, ...rules } });
  const order = turnOrderAfter(game, source);
  for (const player of game.players) {
    player.hand = [...(player.seat === source ? upgrade ? [0, 1, 2, 3, 4, 5, 9, 10, 11, 15, 17] : [...waiting, 16] : receivers[order.indexOf(player.seat)])].sort((a, b) => a - b);
    player.melds = player.seat === source && upgrade ? [{ type: 'peng', tile: 17, tiles: [17, 17, 17] }] : [];
  }
  game.lastDraw = { seat: source, tile: upgrade ? 17 : 16, source: 'normal' };
  game.history = [];
  const counts = Array(18).fill(8);
  for (const tile of [...head, ...game.players.flatMap(player => [...player.hand, ...player.melds.flatMap(meld => meld.tiles)])]) assert.ok(--counts[tile] >= 0);
  game.wall = [...head, ...counts.flatMap((count, tile) => Array(count).fill(tile))];
  assertGameInvariants(game);
  return game;
}
function passAll(game) {
  while (game.phase === 'claim') game = move(game, game.claim.eligibleSeats.find(seat => !game.claim.responses[seat]), 'pass');
  return game;
}

test('new games save counterclockwise direction; missing/clockwise old values remain clockwise', () => {
  for (const source of [0, 1, 2]) {
    const game = createGame({ seed: 'direction', dealerSeat: source });
    assert.equal(game.rules.turnDirection, 'counterclockwise');
    assert.deepEqual(turnOrderAfter(game, source), [(source + 2) % 3, (source + 1) % 3]);
    assert.equal(getPlayerView(game, source).rules.turnDirection, 'counterclockwise');
    for (const direction of [undefined, 'clockwise']) {
      const old = fixture(source);
      if (direction) old.rules.turnDirection = direction; else delete old.rules.turnDirection;
      const saved = structuredClone(old);
      const next = passAll(move(old, source, 'discard', 17));
      assert.equal(next.currentSeat, (source + 1) % 3);
      assert.deepEqual(old, saved);
      assert.equal(next.rules.turnDirection, direction);
    }
  }
  for (const value of [null, true, 2, 'right', []]) assert.throws(() => createGame({ rules: { turnDirection: value } }), /行牌方向/);
});

for (const source of [0, 1, 2]) {
  const priority = [(source + 2) % 3, (source + 1) % 3];
  test(`seat ${source} advances right then left when no one claims or all pass`, () => {
    for (const tile of [16, 17]) {
      const game = passAll(move(fixture(source), source, 'discard', tile));
      assert.equal(game.currentSeat, priority[0]);
      assert.equal(game.lastDraw.tile, 6);
      assertGameInvariants(game);
    }
  });
  for (const reverse of [false, true]) {
    const replies = reverse ? [...priority].reverse() : priority;
    for (const type of ['peng', 'mingGang']) test(`seat ${source} equal ${type}, reversed replies ${reverse}, uses counterclockwise priority`, () => {
      let game = move(fixture(source, type === 'peng' ? [peng, peng] : [gang, gang]), source, 'discard', 17);
      assert.deepEqual(game.claim.eligibleSeats, priority);
      const wall = game.wall.length;
      game = move(game, replies[0], type, 17);
      assert.equal(game.phase, 'claim'); assert.equal(game.wall.length, wall);
      assert.equal(game.players.some(player => player.melds.length), false);
      game = move(game, replies[1], type, 17);
      assert.equal(game.discards[0].claimedBy, priority[0]);
      assert.equal(game.currentSeat, priority[0]);
      assert.equal(game.players[priority[1]].melds.length, 0);
      assertGameInvariants(game);
    });
    for (const gangIsNearest of [false, true]) test(`seat ${source} kong outranks peng even when ${gangIsNearest ? 'near' : 'far'}, reversed ${reverse}`, () => {
      const gangSeat = priority[gangIsNearest ? 0 : 1];
      let game = move(fixture(source, gangIsNearest ? [gang, peng] : [peng, gang]), source, 'discard', 17);
      for (const seat of replies) game = move(game, seat, seat === gangSeat ? 'mingGang' : 'peng', 17);
      assert.equal(game.discards[0].claimedBy, gangSeat);
      assertGameInvariants(game);
    });
    for (const kind of ['discard', 'robKong']) test(`seat ${source} double ${kind} hu and next dealer use counterclockwise order, reversed ${reverse}`, () => {
      const upgrade = kind === 'robKong';
      let game = move(fixture(source, [waiting, waiting], { upgrade }), source, upgrade ? 'buGang' : 'discard', 17);
      game = JSON.parse(JSON.stringify(game)); // Saved pending window has the same priority after reload.
      for (const seat of replies) game = move(game, seat, 'hu');
      const events = game.history.filter(event => event.type === 'hu');
      assert.deepEqual(events.map(event => event.seat), priority);
      assert.equal(game.currentSeat, priority[0]);
      assert.equal(dealerForNextGame(game), priority[0]);
      assert.deepEqual(game.discards[0].huSeats, priority);
      assert.equal(game.players[priority[0]].winPile[0].virtual, false);
      assert.equal(game.players[priority[1]].winPile[0].virtual, true);
      assert.equal(game.players.reduce((sum, player) => sum + player.score, 0), 0);
      assertGameInvariants(game);
    });
    test(`seat ${source} hu beats nearer kong, reversed ${reverse}`, () => {
      let game = move(fixture(source, [gang, waiting]), source, 'discard', 17);
      for (const seat of replies) game = move(game, seat, seat === priority[0] ? 'mingGang' : 'hu', seat === priority[0] ? 17 : undefined);
      assert.equal(game.players[priority[1]].huCount, 1);
      assert.equal(game.players[priority[0]].melds.length, 0);
      assertGameInvariants(game);
    });
  }
}

test('saved clockwise simultaneous claims remain stable without a direction flag', () => {
  for (const type of ['peng', 'mingGang', 'hu']) for (const reverse of [false, true]) {
    const hands = type === 'peng' ? [peng, peng] : type === 'mingGang' ? [gang, gang] : [waiting, waiting];
    let game = fixture(0, hands); delete game.rules.turnDirection;
    game = move(game, 0, 'discard', 17);
    for (const seat of reverse ? [2, 1] : [1, 2]) game = move(game, seat, type, type === 'hu' ? undefined : 17);
    assert.equal(type === 'hu' ? game.discards[0].huSeats[0] : game.discards[0].claimedBy, 1);
    assert.equal(game.rules.turnDirection, undefined);
    assertGameInvariants(game);
  }
});
