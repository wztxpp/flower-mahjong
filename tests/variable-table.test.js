// 可变牌桌的18组配置、第四座位、同牌大数量、终局神龙与旧快照回归。
// Cover eighteen configurations, seat four, large copy counts, final dragons and unchanged saved policies.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, applyAction, applyPresentedAction, continuePresentedGame, getLegalActions,
  getPlayerView, getHuDiagnostic, assertGameInvariants, turnOrderAfter, dealerForNextGame,
  isWinningHand, getWaitTiles,
} from '../shared/game.js';
import { variableFixture, waiting, scattered, meld } from './fixtures/variable-table.js';

// 回应顺序故意反向，验证结算只依权威顺位；动作必须来自引擎白名单。
// Respond in reverse order to verify authority, not click order, determines settlement.
function respond(game, type = 'pass') {
  for (const seat of [...(game.claim?.eligibleSeats ?? [])].reverse()) {
    game = applyAction(game, seat, { type });
  }
  return game;
}

for (const playerCount of [3, 4]) {
  for (let deckCount = 1; deckCount <= 5; deckCount += 0.5) {
    test(`${playerCount} seats / ${deckCount} decks: deals, privacy, seeded replay and conservation`, () => {
      let game = createGame({ seed: `matrix-${playerCount}-${deckCount}`, dealerSeat: playerCount - 1,
        rules: { playerCount, deckCount } });
      assert.equal(game.players.length, playerCount);
      assert.equal(game.wall.length, deckCount * 72 - playerCount * 13 - 1);
      for (const player of game.players) {
        assert.equal(player.hand.length, player.seat === playerCount - 1 ? 14 : 13);
        const view = getPlayerView(game, player.seat);
        assert.ok(Array.isArray(view.players[player.seat].hand));
        for (const opponent of view.players.filter(item => item.seat !== player.seat)) {
          assert.equal(opponent.hand, undefined);
        }
      }
      let steps = 0;
      // 优先胡、杠、碰，其他情况轮换选牌；覆盖长墙自动步骤而不调用生产服务。
      // Prefer wins/kongs/pengs and rotate discard choices; exercise long walls without production access.
      while (game.phase !== 'finished' && steps++ < 2500) {
        const seat = game.phase === 'claim'
          ? [...game.claim.eligibleSeats].reverse().find(value => !game.claim.responses[value])
          : game.currentSeat;
        const actions = getLegalActions(game, seat);
        const action = actions.find(item => item.type === 'hu') ??
          actions.find(item => item.type.endsWith('Gang')) ??
          actions.find(item => item.type === 'peng') ?? actions[steps % actions.length];
        assert.ok(action, `No legal action at step ${steps}`);
        game = applyAction(game, seat, action);
        assertGameInvariants(game);
      }
      assert.equal(game.phase, 'finished');
      assert.ok(steps < 2500);
      assert.equal(game.players.reduce((sum, player) => sum + player.score, 0), 0);
    });
  }
}

test('four-player counterclockwise order, fourth dealer and invalid seats', () => {
  const game = createGame({ seed: 'four', rules: { playerCount: 4 }, dealerSeat: 3 });
  assert.deepEqual(turnOrderAfter(game, 0), [3, 2, 1]);
  assert.deepEqual(turnOrderAfter(game, 3), [2, 1, 0]);
  game.history.push({ type: 'hu', seat: 3 });
  assert.equal(dealerForNextGame(game), 3);
  assert.equal(getHuDiagnostic(game, 3).code !== 'WRONG_TURN', true);
  assert.deepEqual(getLegalActions(game, 4), []);
  assert.throws(() => getPlayerView(game, 4), /座位/);
  delete game.rules.turnDirection;
  assert.deepEqual(turnOrderAfter(game, 0), [1, 2, 3]);
});

test('triple discard winners settle in right/opposite/left order before final check', () => {
  const source = [...scattered, 17];
  let game = variableFixture({ hands: [source, waiting, waiting, waiting], drawTile: 17 });
  game = applyAction(game, 0, { type: 'discard', tile: 17 });
  assert.deepEqual(game.claim.eligibleSeats, [3, 2, 1]);
  game = respond(game, 'hu');
  const events = game.history.filter(event => event.type === 'hu');
  assert.deepEqual(events.map(event => event.seat), [3, 2, 1]);
  assert.ok(events.every(event => event.payments.length === 2 && event.payments[0].seat === 0 && event.payments[0].delta < 0));
  assert.equal(game.phase, 'turn');
  assert.equal(game.currentSeat, 3);
  assert.equal(game.players[1].winPile[0].virtual, true);
  assert.equal(game.players[3].winPile[0].virtual, false);
  assertGameInvariants(game);
});

test('a final triple post-kong batch charges only the source and finishes after all winners', () => {
  let game = variableFixture({ hands: [[...scattered, 17], waiting, waiting, waiting],
    drawTile: 17, huCounts: [1, 0, 0, 0], kongDiscard: true });
  game = applyAction(game, 0, { type: 'pass' });
  game = respond(game, 'hu');
  assert.equal(game.phase, 'finished');
  assert.equal(game.finishReason, 'allPlayersHu');
  const wins = game.history.filter(event => event.type === 'hu');
  assert.deepEqual(wins.map(event => event.seat), [3, 2, 1]);
  assert.ok(wins.every(event => event.payments.length === 2 && event.payments[0].seat === 0 && event.payments[0].delta < 0));
  assertGameInvariants(game);
});

test('last first-time self-draw at seat four charges all three previous winners', () => {
  const game = variableFixture({ currentSeat: 3, hands: [scattered, scattered, scattered, [...waiting, 17]],
    drawTile: 17, huCounts: [1, 1, 1, 0] });
  const next = applyAction(game, 3, { type: 'hu' });
  assert.equal(next.phase, 'finished');
  assert.deepEqual(next.history.find(event => event.type === 'hu').payments.filter(item => item.delta < 0).map(item => item.seat), [0, 1, 2]);
  assert.equal(getPlayerView(next, 0).players[3].winPile[0].tile, 17);
  assertGameInvariants(next);
});

test('normal self-draw charges only unwon opponents and hides seat-four winning faces', () => {
  const game = variableFixture({ currentSeat: 3, hands: [scattered, scattered, scattered, [...waiting, 17]],
    drawTile: 17, huCounts: [1, 0, 0, 0] });
  const next = applyAction(game, 3, { type: 'hu' });
  assert.deepEqual(next.history.find(event => event.type === 'hu').payments.filter(item => item.delta < 0).map(item => item.seat), [1, 2]);
  assert.equal(getPlayerView(next, 0).players[3].winPile[0].tile, null);
  assert.equal(getPlayerView(next, 3).players[3].winPile[0].tile, 17);
});

test('one kong grows from four to twenty, pays three opponents and stays one structural meld', () => {
  let game = variableFixture({ melds: [[meld(0)]],
    hands: [[0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 17], scattered, scattered, scattered],
    drawTile: 0, head: Array(15).fill(0) });
  for (let size = 5; size <= 20; size++) {
    game = applyAction(game, 0, { type: 'addGang', tile: 0 });
    if (game.phase === 'claim') game = respond(game);
    assert.equal(game.players[0].melds.length, 1);
    assert.equal(game.players[0].melds[0].tiles.length, size);
    const event = game.history.findLast(item => item.type === 'addGang');
    assert.equal(event.payments.length, 4);
    assert.ok(event.payments.filter(payment => payment.delta < 0).every(payment => payment.delta === -1));
    assertGameInvariants(game);
  }
  assert.equal(game.pendingKongRadishes, 16);
  assert.equal(getLegalActions(game, 0).some(action => action.type === 'addGang' && action.tile === 0), false);
  assert.throws(() => applyAction(game, 0, { type: 'addGang', tile: 0 }), /合法|不能|不允许/);
});

test('rob a ninth kong tile: triple winners leave the eight-tile group and do not charge kong fees', () => {
  const waitOnZero = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 0];
  let game = variableFixture({ melds: [[meld(0, 8)]],
    hands: [[0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 17], waitOnZero, waitOnZero, waitOnZero], drawTile: 0 });
  game = applyAction(game, 0, { type: 'addGang', tile: 0 });
  assert.equal(game.claim.kind, 'robKong');
  assert.deepEqual(game.claim.eligibleSeats, [3, 2, 1]);
  game = respond(game, 'hu');
  assert.equal(game.players[0].melds[0].tiles.length, 8);
  assert.equal(game.history.some(event => event.type === 'addGang'), false);
  assert.ok(game.history.filter(event => event.type === 'hu').every(event =>
    event.source === 'robKong' && event.payments.length === 2 && event.payments[0].seat === 0 && event.payments[0].delta < 0));
  assertGameInvariants(game);
});

for (let count = 9; count <= 20; count++) {
  test(`${count} matching tiles adds ${count - 3} ordinary fan`, () => {
    const game = variableFixture({ melds: [[meld(0, count)]],
      hands: [[1, 2, 3, 4, 5, 6, 9, 10, 11, 17, 17], scattered, scattered, scattered], drawTile: 17 });
    const next = applyAction(game, 0, { type: 'hu' });
    assert.equal(next.history.find(event => event.type === 'hu').score.copyFanBonus, count - 3);
  });
}

test('ten-copy seven pairs uses the original fixed formula and later wins do not raise its tier', () => {
  let game = variableFixture({ hands: [[...Array(10).fill(0), ...Array(4).fill(9)], scattered, scattered, scattered],
    drawTile: 9, head: [9] });
  game = applyAction(game, 0, { type: 'hu' });
  assert.equal(game.players[0].firstHuPattern.fixedFan, 11);
  game = applyAction(game, 0, { type: 'hu' });
  const wins = game.history.filter(event => event.type === 'hu');
  assert.deepEqual(wins.map(event => event.score.fan), [11, 11]);
  assert.ok(wins.every(event => event.score.copyFanBonus === 0));
});

for (const [start, count, points] of [[6, 6, 10], [6, 7, 20], [6, 8, 40], [6, 9, 80], [1, 20, 5242880], [20, 20, 10]]) {
  test(`dragon threshold ${start}, ${count} copies: ${points} per opponent once`, () => {
    const game = variableFixture({ rules: { dragonStartCount: start }, melds: [[meld(0, count)]],
      hands: [[1, 2, 3, 4, 5, 6, 9, 10, 11, 17, 17], scattered, scattered, scattered],
      drawTile: 17, wallCount: 0 });
    const next = applyAction(game, 0, { type: 'discard', tile: 17 });
    const ended = next.phase === 'claim' ? respond(next) : next;
    assert.equal(ended.phase, 'finished');
    const dragon = ended.dragonSettlement.entries.find(entry => entry.seat === 0).dragons.find(item => item.tile === 0);
    assert.equal(dragon.points, points);
    assert.equal(ended.dragonSettlement.entries.find(entry => entry.seat === 0).payments.filter(item => item.delta < 0).length, 3);
    const snapshot = structuredClone(ended);
    assert.deepEqual(getLegalActions(ended, 0), []);
    getPlayerView(ended, 3);
    assert.deepEqual(ended, snapshot);
    assertGameInvariants(ended);
  });
}

test('legacy missing snapshots keep three seats, eight copies and the original dragon cap', () => {
  const game = variableFixture({ playerCount: 3, deckCount: 2, rules: { dragonStartCount: 1 },
    hands: [[...scattered, 17], scattered, scattered], drawTile: 17, wallCount: 0 });
  for (const key of ['playerCount', 'deckCount', 'dragonStartCount', 'exponentialDragon', 'extendedCopyFan']) delete game.rules[key];
  const original = structuredClone(game);
  assertGameInvariants(game);
  getPlayerView(game, 2);
  assert.deepEqual(game, original);
  const ended = respond(applyAction(game, 0, { type: 'discard', tile: 17 }));
  assert.equal(ended.dragonSettlement.entries.length, 0);
  assert.equal(Object.hasOwn(ended.rules, 'exponentialDragon'), false);
});

test('physical budget controls structural waits; one-deck fifth copy is impossible', () => {
  assert.equal(isWinningHand([...Array(10).fill(0), ...Array(4).fill(9)], 0, { sevenPairs: true, deckCount: 5 }), true);
  assert.equal(isWinningHand([...Array(10).fill(0), ...Array(4).fill(9)], 0, { sevenPairs: true, deckCount: 2 }), false);
  const melds = [meld(0, 4), meld(3, 3, 'peng'), meld(6, 3, 'peng'), meld(9, 3, 'peng')];
  assert.deepEqual(getWaitTiles([0], melds, { deckCount: 1, sevenPairs: true }), []);
  assert.deepEqual(getWaitTiles([0], melds, { deckCount: 1.5, sevenPairs: true }), [0]);
});

test('presentation-paused seat-four turns resume without changing rules or leaking the drawn tile', () => {
  const game = createGame({ seed: 'presentation-four', rules: { playerCount: 4, deckCount: 1 }, dealerSeat: 3 });
  const action = getLegalActions(game, 3).find(item => item.type === 'discard');
  const paused = applyPresentedAction(game, 3, action);
  assert.equal(paused.presentation.stage, 'discard');
  assert.deepEqual(getLegalActions(paused, 3), []);
  const next = continuePresentedGame(paused);
  assertGameInvariants(next);
  assert.deepEqual(next.rules, game.rules);
  assert.equal(getPlayerView(next, 0).players[3].hand, undefined);
});

for (const points of [0, 50]) {
  test(`four-player ready bonus ${points} is once-only and per opponent`, () => {
    const game = variableFixture({ rules: { bigSingleReadyPayment: true, bigSingleReadyPoints: points },
      melds: [[meld(0), meld(3), meld(6), meld(9)]],
      hands: [[17, 16], scattered, scattered, scattered], drawTile: 16 });
    const next = applyAction(game, 0, { type: 'discard', tile: 16 });
    const event = next.history.find(item => item.type === 'bigSingleReady');
    assert.equal(next.players[0].bigSingleReadyPaid, true);
    assert.equal(event.points, points);
    assert.equal(event.payments.filter(item => item.delta < 0).length, points ? 3 : 0);
    assert.equal(next.history.filter(item => item.type === 'bigSingleReady').length, 1);
    assert.equal(next.players[0].score, points * 3);
  });
}

test('ordinary big-single discard retains all-opponent payment while ordinary wins charge only the discarder', () => {
  let game = variableFixture({ melds: [[], [meld(0), meld(3), meld(6), meld(9)], [], []],
    hands: [[...scattered, 17], [17], scattered, scattered], drawTile: 17 });
  game = applyAction(game, 0, { type: 'discard', tile: 17 });
  for (const seat of [...game.claim.eligibleSeats].reverse()) {
    game = applyAction(game, seat, { type: seat === 1 ? 'hu' : 'pass' });
  }
  const event = game.history.find(item => item.type === 'hu' && item.seat === 1);
  assert.deepEqual(event.payments.filter(item => item.delta < 0).map(item => item.seat), [0, 2, 3]);
});

test('fourth-seat exposed-kong provenance is a valid sole replacement payer', () => {
  const game = variableFixture({ hands: [[...waiting, 17], scattered, scattered, scattered], drawTile: 17 });
  game.lastDraw.source = 'replacement';
  game.lastDraw.kongSource = { type: 'mingGang', fromSeat: 3 };
  const next = applyAction(game, 0, { type: 'hu' });
  assert.deepEqual(next.history.find(item => item.type === 'hu').payments.filter(item => item.delta < 0).map(item => item.seat), [3]);
  assertGameInvariants(next);
});

test('old scoring flags retain the above-eight fallback and dragon cap even with wider dimensions', () => {
  const config = { rules: { exponentialDragon: false, extendedCopyFan: false },
    melds: [[meld(0, 9)]], hands: [[1, 2, 3, 4, 5, 6, 9, 10, 11, 17, 17], scattered, scattered, scattered],
    drawTile: 17, wallCount: 0 };
  const ended = applyAction(variableFixture(config), 0, { type: 'hu' });
  assert.equal(ended.history.find(item => item.type === 'hu').score.copyFanBonus, 0);
  assert.equal(ended.dragonSettlement.entries.find(item => item.seat === 0).dragons.find(item => item.tile === 0).points, 40);
});

test('invalid room dimensions and damaged saved budgets are rejected without modifying originals', () => {
  for (const rules of [{ playerCount: 2 }, { playerCount: '4' }, { deckCount: 0.5 }, { deckCount: 1.25 },
    { deckCount: 5.5 }, { deckCount: null }, { dragonStartCount: 0 }, { dragonStartCount: 21 },
    { dragonStartCount: 6.5 }, { exponentialDragon: 1 }, { extendedCopyFan: 1 }]) {
    assert.throws(() => createGame({ seed: 'invalid', rules }));
  }
  const game = createGame({ seed: 'tampered', rules: { playerCount: 4, deckCount: 1 } });
  const original = structuredClone(game);
  game.rules.deckCount = 2;
  assert.throws(() => assertGameInvariants(game), /守恒/);
  assert.deepEqual(original.players, game.players);
});

for (const type of ['anGang', 'buGang', 'addGang']) {
  test(`fourth seat can commit ${type} and pay every other seat exactly once`, () => {
    const concealed = type === 'anGang';
    const group = type === 'buGang' ? meld(0, 3, 'peng') : meld(0, 8);
    const game = variableFixture({ currentSeat: 3, drawTile: 0,
      melds: [[], [], [], concealed ? [] : [group]],
      hands: [scattered, scattered, scattered, concealed
        ? [0, 0, 0, 0, 1, 2, 4, 5, 7, 8, 10, 11, 13, 14]
        : [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 17]],
    });
    const next = respond(applyAction(game, 3, { type, tile: 0 }));
    const event = next.history.find(item => item.type === type);
    assert.equal(event.seat, 3);
    assert.deepEqual(event.payments.filter(item => item.delta < 0).map(item => item.seat), [0, 1, 2]);
    assert.equal(next.currentSeat, 3);
    assertGameInvariants(next);
  });
}

for (const type of ['peng', 'mingGang']) {
  test(`fourth seat claims ${type} in the same authority path as earlier seats`, () => {
    const claimHand = type === 'peng'
      ? [0, 1, 3, 4, 6, 7, 9, 10, 12, 13, 15, 17, 17]
      : [0, 1, 3, 4, 6, 7, 9, 10, 12, 13, 17, 17, 17];
    let game = variableFixture({ drawTile: 17, hands: [[...scattered, 17], scattered, scattered, claimHand] });
    game = applyAction(game, 0, { type: 'discard', tile: 17 });
    for (const seat of [...game.claim.eligibleSeats].reverse()) {
      game = applyAction(game, seat, seat === 3 ? { type, tile: 17 } : { type: 'pass' });
    }
    assert.equal(game.currentSeat, 3);
    assert.equal(game.players[3].melds[0].type, type);
    if (type === 'mingGang') {
      assert.deepEqual(game.history.find(item => item.type === type).payments,
        [{ seat: 0, delta: -2 }, { seat: 3, delta: 2 }]);
    }
    assertGameInvariants(game);
  });
}

test('shared radishes contribute to the configurable dragon threshold without duplicating physical tiles', () => {
  const game = variableFixture({ rules: { dragonStartCount: 6 }, melds: [[meld(0)]],
    hands: [[1, 2, 3, 4, 5, 6, 9, 10, 11, 17, 17], scattered, scattered, scattered],
    radishes: [[], [], [], [0, 0]], drawTile: 17, wallCount: 0 });
  const ended = respond(applyAction(game, 0, { type: 'discard', tile: 17 }));
  const dragon = ended.dragonSettlement.entries.find(entry => entry.seat === 0).dragons.find(item => item.tile === 0);
  assert.deepEqual(dragon, { tile: 0, count: 6, points: 10 });
  assertGameInvariants(ended);
});
