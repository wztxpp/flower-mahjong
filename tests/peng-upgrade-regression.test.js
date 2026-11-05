import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, getLegalActions, getPlayerView, assertGameInvariants } from '../shared/game.js';
import { postHuKongGame } from './fixtures/post-hu-kong.js';

const waiting = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
const pengHand = [0, 0, 3, 4, 5, 6, 7, 8, 10, 11, 16, 17, 17];
const move = (game, seat, type, tile) => applyAction(game, seat, tile === undefined ? { type } : { type, tile });
const has = (game, seat, type) => getLegalActions(game, seat).some(action => action.type === type);
function passAll(game) {
  while (game.phase === 'claim') {
    const seat = game.claim.eligibleSeats.find(other => !game.claim.responses[other]);
    game = move(game, seat, 'pass');
  }
  return game;
}

/** Real conserved hands and wall; all peng/kong transitions below use applyAction. */
function fixture({ heldFourth = false, head = [15, 15, 0, 9] } = {}) {
  const game = createGame({ seed: 'peng-upgrade-regression' });
  game.players[0].hand = [...waiting, 0].sort((a, b) => a - b);
  game.players[1].hand = [...pengHand];
  if (heldFourth) game.players[1].hand[game.players[1].hand.indexOf(16)] = 0;
  game.players[1].hand.sort((a, b) => a - b);
  game.players[2].hand = [...waiting];
  game.lastDraw = { seat: 0, tile: 0, source: 'normal' };
  game.history = [];
  const counts = Array(18).fill(8);
  for (const tile of [...game.players.flatMap(player => player.hand), ...head]) {
    assert.ok(--counts[tile] >= 0, `Fixture overused tile ${tile}`);
  }
  game.wall = [...head, ...counts.flatMap((count, tile) => Array(count).fill(tile))];
  assertGameInvariants(game);
  return game;
}
function takePeng(game) {
  game = move(game, 0, 'discard', 0);
  assert.ok(has(game, 1, 'peng'));
  game = passAll(move(game, 1, 'peng', 0));
  assert.equal(game.currentSeat, 1);
  assert.equal(game.players[1].melds[0].type, 'peng');
  assert.equal(game.lastDraw, null);
  return game;
}
function assertUpgrade(game, seat, tile) {
  assert.ok(getPlayerView(game, seat).legalActions.some(action => action.type === 'buGang' && action.tile === tile));
  const upgraded = passAll(move(game, seat, 'buGang', tile));
  assert.equal(upgraded.players[seat].melds[0].type, 'buGang');
  assert.deepEqual(upgraded.players[seat].melds[0].tiles, Array(4).fill(tile));
  assert.equal(upgraded.players[seat].kongCount, 1);
  assert.equal(upgraded.history.filter(event => event.type === 'buGang').length, 1);
  assertGameInvariants(upgraded);
  return upgraded;
}

function afterMatchingDraw(game) {
  game = takePeng(game);
  assert.equal(has(game, 1, 'buGang'), false); // No fourth tile yet.
  game = passAll(move(game, 1, 'discard', 16));
  for (let turn = 0; turn < 2; turn++) {
    assert.notEqual(game.currentSeat, 1);
    assert.equal(game.lastDraw.tile, 15);
    game = passAll(move(game, game.currentSeat, 'discard', 15));
  }
  assert.equal(game.currentSeat, 1);
  assert.equal(game.lastDraw.source, 'normal');
  assert.equal(game.lastDraw.tile, 0);
  return game;
}
function assertNoUpgrade(game, seat, tile) {
  const before = structuredClone(game);
  assert.equal(has(game, seat, 'buGang'), false);
  assert.equal(getPlayerView(game, seat).legalActions.some(action => action.type === 'buGang'), false);
  assert.throws(() => move(game, seat, 'buGang', tile));
  assert.deepEqual(game, before); // A forged old-client action has no side effects.
  assert.equal(game.players[seat].melds[0].type, 'peng');
  assert.equal(game.players[seat].melds[0].tiles.length, 3);
  assertGameInvariants(game);
}

test('new games prohibit upgrading a real peng immediately with an already-held fourth tile', () => {
  const initial = fixture({ heldFourth: true });
  assert.equal(initial.rules.allowPungUpgrade, false);
  const game = takePeng(initial);
  assert.equal(game.lastDraw, null);
  assert.ok(game.players[1].hand.includes(0));
  assertNoUpgrade(game, 1, 0);
  assert.ok(has(game, 1, 'discard'));
});

test('new games prohibit upgrading a real peng after a later natural matching draw', () => {
  const game = afterMatchingDraw(fixture());
  assertNoUpgrade(game, 1, 0);
  assert.ok(has(game, 1, 'discard'));
});

for (const policy of ['missing', true]) {
  const setPolicy = game => {
    if (policy === 'missing') delete game.rules.allowPungUpgrade;
    else game.rules.allowPungUpgrade = true;
    return JSON.parse(JSON.stringify(game));
  };
  test(`saved allowPungUpgrade=${policy} preserves immediate and later peng upgrades`, () => {
    assertUpgrade(takePeng(setPolicy(fixture({ heldFourth: true }))), 1, 0);
    assertUpgrade(afterMatchingDraw(setPolicy(fixture())), 1, 0);
  });
  test(`saved allowPungUpgrade=${policy} preserves mandatory post-hu upgrade in both discard modes`, () => {
    for (const autoDiscardAfterHu of [true, false]) {
      const game = setPolicy(postHuKongGame());
      game.rules.autoDiscardAfterHu = autoDiscardAfterHu;
      assert.deepEqual(getLegalActions(game, 0), [{ type: 'buGang', tile: 2 }]);
      assertUpgrade(game, 0, 2);
    }
  });
}

test('the new no-peng-upgrade rule also applies after hu in both discard modes', () => {
  for (const autoDiscardAfterHu of [true, false]) {
    const game = postHuKongGame();
    game.rules.allowPungUpgrade = false;
    game.rules.autoDiscardAfterHu = autoDiscardAfterHu;
    assertNoUpgrade(game, 0, 2);
    assert.deepEqual(getLegalActions(game, 0), autoDiscardAfterHu ? [{ type: 'discard', tile: 2 }] : [{ type: 'pass' }]);
  }
});

test('the new rule preserves extending an existing true kong from four tiles to five', () => {
  for (const huCount of [0, 1]) {
    const game = postHuKongGame({ type: 'addGang', huCount });
    game.rules.allowPungUpgrade = false;
    assert.ok(has(game, 0, 'addGang'));
    const next = passAll(move(game, 0, 'addGang', 2));
    assert.equal(next.players[0].melds[0].tiles.length, 5);
    assert.equal(next.players[0].melds[0].extended, true);
    assertGameInvariants(next);
  }
});

test('legacy allowed peng upgrade still yields to simultaneous self-hu', () => {
  const game = postHuKongGame({ huCount: 0 });
  game.rules.allowPungUpgrade = true;
  // Rebuild the concealed hand while preserving all physical tile counts.
  // The drawn 2 completes 2/3/4, 5/6/7, 9/10/11 and a pair of 17s.
  const replacementHand = [2, 3, 4, 5, 6, 7, 9, 10, 11, 17, 17];
  game.wall.push(...game.players[0].hand);
  for (const tile of replacementHand) game.wall.splice(game.wall.indexOf(tile), 1);
  game.players[0].hand = replacementHand;
  assertGameInvariants(game);
  assert.ok(has(game, 0, 'hu'));
  assertNoUpgrade(game, 0, 2);
});

test('legacy allowed peng upgrade still requires at least two wall tiles', () => {
  const initial = fixture({ heldFourth: true });
  initial.rules.allowPungUpgrade = true;
  const game = takePeng(initial);
  game.retiredTiles.push(...game.wall.splice(1).map(tile => ({ seat: 0, tile })));
  assertNoUpgrade(game, 1, 0);
});
