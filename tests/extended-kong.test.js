import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, getLegalActions, getPlayerView, assertGameInvariants } from '../shared/game.js';

const waiting = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
const noZero = waiting.map(tile => tile === 0 ? 6 : tile);
const meld = (tile, type, count) => ({ type, tile, tiles: Array(count).fill(tile) });
const actions = game => getLegalActions(game, 0);
const doAction = (game, type, tile) => applyAction(game, 0, tile === undefined ? { type } : { type, tile });
const kongEvents = game => game.history.filter(event => event.type === 'addGang');
const huEvents = game => game.history.filter(event => event.type === 'hu');

/** Real, conserved schema-3 state, including each prior win's physical tile. */
function fixture({ hand, melds = [], priorWins = [], head = [6], tail = [],
  opponents = [noZero, noZero], rules = {}, currentSeat = 0,
  priorWinsBySeat = [priorWins, [], []],
  drawTile = currentSeat === 0 ? hand.at(-1) : opponents[currentSeat - 1].at(-1), wallCount } = {}) {
  const game = createGame({ seed: 'extended-kong', rules: { specialHuPatterns: false, ...rules } });
  game.players.forEach((player, seat) => {
    player.hand = [...(seat === 0 ? hand : opponents[seat - 1])].sort((a, b) => a - b);
    player.melds = seat === 0 ? structuredClone(melds) : [];
    player.winPile = priorWinsBySeat[seat].map(tile => ({ tile, source: 'selfDraw', virtual: false }));
    player.huCount = player.winPile.length;
    player.kongCount = player.melds.filter(group => group.type !== 'peng').length;
  });
  game.history = []; game.discards = [];
  game.retiredTiles = priorWinsBySeat.flatMap((wins, seat) => wins.map(tile => ({ seat, tile })));
  game.firstHuRadishesRevealed = priorWinsBySeat.some(wins => wins.length > 0);
  game.phase = 'turn'; game.turnStep = 'discard'; game.currentSeat = currentSeat; game.drawKind = 'normal';
  game.lastDraw = { seat: currentSeat, tile: drawTile, source: 'normal' };
  const counts = Array(18).fill(8);
  const use = tile => assert.ok(--counts[tile] >= 0, `Fixture overused tile ${tile}`);
  for (const player of game.players) [...player.hand, ...player.melds.flatMap(group => group.tiles)].forEach(use);
  game.retiredTiles.forEach(item => use(item.tile));
  [...head, ...tail].forEach(use);
  const rest = counts.flatMap((count, tile) => Array(count).fill(tile));
  if (wallCount !== undefined) {
    assert.ok(wallCount >= head.length + tail.length);
    game.retiredTiles.push(...rest.splice(wallCount - head.length - tail.length).map(tile => ({ seat: 0, tile })));
  }
  game.wall = [...head, ...rest, ...tail];
  assertGameInvariants(game);
  return game;
}

for (const type of ['anGang', 'mingGang', 'buGang']) {
  test(`${type} extends 5→6→7→8 with one payment, deferred radish and replacement per tile`, () => {
    let game = fixture({ hand: [0, 1, 2, 3, 9, 10, 11, 12, 13, 16, 17],
      melds: [meld(0, type, 5)], head: [0, 0, 6], tail: [7, 8, 15], drawTile: 0 });
    const oldLog = { revision: -1, type: 'addGang', seat: 0, points: 1, message: '保存的旧记录' };
    game.history.push(oldLog);
    game.players[0].score = 10; game.players[1].score = -3; game.players[2].score = -7;
    const oldBreakdown = { fan: 1, copyFanBonus: 0, total: 1 };
    game.players[0].lastScoreBreakdown = oldBreakdown;
    const wallBefore = game.wall.length;
    for (const count of [6, 7, 8]) {
      const before = structuredClone(game);
      assert.ok(actions(game).some(action => action.type === 'addGang' && action.tile === 0));
      game = doAction(game, 'addGang', 0);
      assert.deepEqual(before.history[0], oldLog);
      assert.equal(game.players[0].melds.length, 1);
      assert.equal(game.players[0].melds[0].type, type);
      assert.equal(game.players[0].melds[0].tiles.length, count);
      assert.equal(game.players[0].melds[0].extended, true);
      assert.equal(game.players[0].hand.length, 11);
      assert.equal(game.players[0].kongCount, count - 4);
      assert.equal(game.players[0].radishes.length, 0);
      assert.equal(game.pendingKongRadishes, count - 5);
      assert.equal(game.wall.length, wallBefore - (count - 5));
      assert.equal(game.lastDraw.tile, count < 8 ? 0 : 6);
      assert.equal(game.lastDraw.source, 'replacement');
      assert.equal(game.players[0].pendingKongDiscard, true);
      assert.deepEqual(game.players.map(player => player.score), [10 + 2 * (count - 5), -3 - (count - 5), -7 - (count - 5)]);
      const event = kongEvents(game).at(-1);
      assert.equal(event.points, 1);
      assert.deepEqual(event.payments, [{ seat: 1, delta: -1 }, { seat: 2, delta: -1 }, { seat: 0, delta: 2 }]);
      assert.match(event.message, new RegExp(`加杠至${count}张`));
      assert.equal(event.tile, type === 'anGang' ? undefined : 0);
      for (const viewer of [1, 2]) {
        const publicMeld = getPlayerView(game, viewer).players[0].melds[0];
        assert.deepEqual(publicMeld.tiles, Array(count).fill(type === 'anGang' ? null : 0));
        assert.equal(publicMeld.tile, type === 'anGang' ? null : 0);
        assert.equal(getPlayerView(game, viewer).players[0].hand, undefined);
      }
      assert.deepEqual(getPlayerView(game, 0).players[0].melds[0].tiles, Array(count).fill(0));
      assert.deepEqual(game.history[0], oldLog);
      assert.deepEqual(game.players[0].lastScoreBreakdown, oldBreakdown);
      assertGameInvariants(game);
    }
    assert.deepEqual(game.players[0].radishes, []);
    assert.deepEqual(game.wall.slice(-3), [7, 8, 15]);
    assert.equal(kongEvents(game).length, 4); // Three new entries plus the saved old entry.
    assert.equal(actions(game).some(action => action.type === 'addGang'), false);
    const before = structuredClone(game);
    assert.throws(() => doAction(game, 'addGang', 0));
    assert.deepEqual(game, before);
  });
}

test('reported five-eight-circles meld offers its sixth tile while preserving the other groups', () => {
  const game = fixture({ hand: [1, 1, 3, 3, 16], drawTile: 16,
    melds: [meld(16, 'buGang', 5), meld(12, 'mingGang', 4), meld(15, 'peng', 3)], head: [6], tail: [8] });
  assert.ok(actions(game).some(action => action.type === 'addGang' && action.tile === 16));
  const next = doAction(game, 'addGang', 16);
  assert.deepEqual(next.players[0].melds.map(group => group.tiles.length), [6, 4, 3]);
  assert.deepEqual(next.players[0].hand, [1, 1, 3, 3, 6]);
  assert.deepEqual(next.players.map(player => player.score), [2, -1, -1]);
  assert.deepEqual(next.players[0].radishes, []);
  assert.equal(next.pendingKongRadishes, 1);
  assert.equal(next.wall.at(-1), 8);
});

test('post-hu extensions preserve the complete wait set, stay mandatory, and permit a winning replacement', () => {
  const otherHands = waiting.map(tile => tile === 2 ? 6 : tile);
  let game = fixture({ hand: [2, 3, 4, 5, 6, 7, 8, 10, 11, 17, 17], drawTile: 2,
    melds: [meld(2, 'anGang', 5)], priorWins: [9], head: [2, 2, 9], tail: [8, 8, 8],
    opponents: [otherHands, otherHands] });
  const waitTiles = getPlayerView(game, 0).waitTiles;
  assert.deepEqual(waitTiles, [9, 12]);
  for (const count of [6, 7, 8]) {
    assert.deepEqual(actions(game), [{ type: 'addGang', tile: 2 }]);
    const before = structuredClone(game);
    assert.throws(() => doAction(game, 'pass'));
    assert.throws(() => doAction(game, 'discard', 2));
    assert.deepEqual(game, before);
    game = doAction(game, 'addGang', 2);
    assert.equal(game.players[0].melds[0].tiles.length, count);
    assert.deepEqual(getPlayerView(game, 0).waitTiles, waitTiles);
    assert.equal(game.players[0].huCount, 1);
    assertGameInvariants(game);
  }
  assert.equal(game.lastDraw.tile, 9);
  assert.ok(actions(game).some(action => action.type === 'hu'));
  assert.equal(actions(game).some(action => action.type.endsWith('Gang')), false);
  assert.deepEqual(game.players.map(player => player.score), [6, -3, -3]);
});

test('same-tile peng and kong remain separate and select the correct upgrade type', () => {
  const game = fixture({ hand: [0, 1, 2, 3, 9, 10, 11, 17], drawTile: 0,
    melds: [meld(0, 'peng', 3), meld(0, 'anGang', 4)], head: [6], tail: [8] });
  assert.ok(actions(game).some(action => action.type === 'buGang' && action.tile === 0));
  assert.ok(actions(game).some(action => action.type === 'addGang' && action.tile === 0));
  const supplemented = doAction(game, 'buGang', 0);
  assert.deepEqual(supplemented.players[0].melds.map(group => [group.type, group.tiles.length]), [['buGang', 4], ['anGang', 4]]);
  const extended = doAction(game, 'addGang', 0);
  assert.deepEqual(extended.players[0].melds.map(group => [group.type, group.tiles.length]), [['peng', 3], ['anGang', 5]]);
  assert.equal(kongEvents(extended).at(-1).tile, undefined);
  assert.deepEqual(getPlayerView(extended, 1).players[0].melds[0].tiles, [0, 0, 0]);
  assert.deepEqual(getPlayerView(extended, 1).players[0].melds[1].tiles, [null, null, null, null, null]);
});

test('wall must contain both a radish and replacement, and physical tile count is still eight', () => {
  for (const count of [5, 6, 7]) {
    const game = fixture({ hand: [0, 1, 2, 3, 9, 10, 11, 12, 13, 16, 17],
      melds: [meld(0, 'buGang', count)], drawTile: 0, head: [6], wallCount: 1 });
    assert.equal(actions(game).some(action => action.type === 'addGang'), false);
    const before = structuredClone(game);
    assert.throws(() => doAction(game, 'addGang', 0));
    assert.deepEqual(game, before);
  }
  const game = fixture({ hand: [1, 2, 3, 9, 10, 11, 12, 13, 14, 16, 17], melds: [meld(0, 'buGang', 8)] });
  assertGameInvariants(game);
  const forged = structuredClone(game);
  forged.players[0].hand.push(0);
  assert.equal(actions(forged).some(action => action.type === 'addGang'), false);
  assert.throws(() => doAction(forged, 'addGang', 0));
  assert.throws(() => assertGameInvariants(forged), /牌张守恒/);
  const nineTileMeld = structuredClone(game);
  nineTileMeld.players[0].melds[0].tiles.push(0);
  assert.throws(() => assertGameInvariants(nineTileMeld), /牌张守恒/);
});

test('four through eight copies add one through five fan, including loaded schema-3 saves', () => {
  for (const count of [4, 5, 6, 7, 8]) {
    let game = fixture({ hand: [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17],
      melds: [meld(0, 'buGang', count)], drawTile: 17, head: [17], tail: [7, 7, 8, 8, 15, 15] });
    game = JSON.parse(JSON.stringify(game));
    assert.equal(game.rules.sevenPlusCopyFan, 0); // Existing stored rules need no migration.
    game = doAction(game, 'hu');
    const score = huEvents(game).at(-1).score;
    assert.equal(score.copyFanBonus, count - 3);
    assert.equal(score.fan, count - 2);
    assert.equal(score.dragonBonus, 0);
    assertGameInvariants(game);
  }
});

test('seven and eight copy fan includes prior wins, while retaining a configured six-copy bonus', () => {
  const hand = [0, 0, 0, 0, 0, 0, 3, 4, 5, 9, 10, 11, 17, 17];
  for (const count of [6, 7, 8]) {
    const game = doAction(fixture({ hand, priorWins: Array(count - 6).fill(0), drawTile: 17,
      rules: { sixCopyFan: 6, sevenPlusCopyFan: 19 }, head: [17] }), 'hu');
    assert.equal(huEvents(game).at(-1).score.copyFanBonus, count === 6 ? 6 : count - 3);
  }
});

test('seven-pairs fixed first tier does not grow when later wins reach seven and eight copies', () => {
  const hand = [0, 0, 2, 2, 4, 4, 6, 6, 9, 9, 11, 11, 13, 13];
  const opponents = waiting.map(tile => tile === 13 ? 16 : tile);
  let game = fixture({ hand, drawTile: 13, rules: { specialHuPatterns: true },
    opponents: [opponents, opponents], head: [13, 13, 13, 13, 13, 13, 2], tail: [8, 8, 8, 15, 15, 15] });
  for (let count = 2; count <= 8; count++) {
    game = doAction(game, 'hu');
    const score = huEvents(game).at(-1).score;
    assert.equal(score.fan, 3);
    assert.equal(score.copyFanBonus, 0);
    assert.equal(score.sevenPairsFixed, true);
    assert.equal(game.players[0].firstHuPattern.fixedFan, 3);
    assertGameInvariants(game);
  }
  assert.equal(game.players[0].winPile.filter(win => win.tile === 13).length, 7);
  assert.equal(getPlayerView(game, 0).waitTiles.includes(13), false);
});

/** Drive a real discard claim into its immediate exposed-kong replacement. */
function afterExposedKong({ base = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17], melds = [], head = [17, 17], rules = {} } = {}) {
  let game = fixture({ hand: [0, 0, 0, ...base], melds, currentSeat: 1, drawTile: 0,
    opponents: [[...noZero, 0], noZero], head, tail: [7, 7, 8, 8, 15, 15, 16], rules });
  game = applyAction(game, 1, { type: 'discard', tile: 0 });
  assert.ok(actions(game).some(action => action.type === 'mingGang' && action.tile === 0));
  game = doAction(game, 'mingGang', 0);
  for (const seat of game.claim?.eligibleSeats || []) if (!game.claim.responses[seat]) game = applyAction(game, seat, { type: 'pass' });
  assert.deepEqual(game.lastDraw.kongSource, { type: 'mingGang', fromSeat: 1 });
  return game;
}

function assertHuPayers(game, expectedSeats) {
  const event = huEvents(game).at(-1);
  assert.deepEqual(event.payments.filter(payment => payment.delta < 0).map(payment => payment.seat), expectedSeats);
  assert.ok(event.points > 0);
  assert.deepEqual(event.payments.at(-1), { seat: 0, delta: expectedSeats.length * event.points });
  return event;
}

test('exposed-kong replacement hu charges only its discarder; continuation clears that attribution', () => {
  let game = afterExposedKong();
  const before = game.players.map(player => player.score);
  game = doAction(game, 'hu');
  const first = assertHuPayers(game, [1]);
  assert.equal(first.source, 'selfDraw');
  assert.equal(first.fromSeat, null);
  assert.deepEqual(first.kongSource, { type: 'mingGang', fromSeat: 1 });
  assert.match(first.message, /明杠后补摸胡（仅杠牌出牌者付款）/);
  assert.equal(game.players[2].score, before[2]);
  assert.equal(game.players[0].score - before[0], first.points);
  assert.deepEqual(game.lastDraw, { seat: 0, tile: 17, source: 'continuation' });
  game = doAction(game, 'hu');
  const second = assertHuPayers(game, [1, 2]);
  assert.equal(second.kongSource, undefined);
  assert.doesNotMatch(second.message, /明杠后补摸胡/);
  assertGameInvariants(game);
});

test('exposed-kong replacement attribution survives JSON reload and recoverable older saves', () => {
  for (const legacy of [false, true]) {
    let game = JSON.parse(JSON.stringify(afterExposedKong()));
    if (legacy) delete game.lastDraw.kongSource;
    const history = structuredClone(game.history);
    game = doAction(game, 'hu');
    assertHuPayers(game, [1]);
    assert.deepEqual(game.history.slice(0, history.length), history);
    assert.deepEqual(huEvents(game).at(-1).kongSource, { type: 'mingGang', fromSeat: 1 });
    assertGameInvariants(game);
  }
});

test('ambiguous legacy replacement provenance preserves old behavior instead of guessing', () => {
  const changes = [
    game => { game.history = []; },
    game => { game.history.at(-2).seat = 2; },
    game => { game.history.at(-2).fromSeat = 0; },
    game => { game.history.at(-2).revision--; },
    game => { game.history.at(-1).source = 'normal'; },
    game => { game.history.splice(-1, 0, { type: 'hu', seat: 2, revision: game.revision }); },
  ];
  for (const change of changes) {
    let game = afterExposedKong();
    delete game.lastDraw.kongSource;
    change(game);
    game = doAction(game, 'hu');
    const event = assertHuPayers(game, [1, 2]);
    assert.equal(event.kongSource, undefined);
    assert.doesNotMatch(event.message, /明杠后补摸胡/);
  }
});

for (const type of ['anGang', 'buGang', 'addGang']) {
  test(`a later ${type} replaces exposed-kong provenance and its replacement hu charges both`, () => {
    let game;
    if (type === 'anGang') {
      game = afterExposedKong({ base: [2, 2, 2, 4, 5, 6, 9, 10, 11, 17], head: [2, 17, 17] });
    } else if (type === 'buGang') {
      game = afterExposedKong({ base: [4, 5, 6, 9, 10, 11, 17], melds: [meld(3, 'peng', 3)], head: [3, 17, 17] });
    } else {
      game = afterExposedKong({ head: [0, 17, 17] });
    }
    game = doAction(game, type, type === 'anGang' ? 2 : type === 'buGang' ? 3 : 0);
    assert.deepEqual(game.lastDraw.kongSource, { type, fromSeat: null });
    assert.equal(game.lastDraw.tile, 17);
    game = doAction(game, 'hu');
    const event = assertHuPayers(game, [1, 2]);
    assert.deepEqual(event.kongSource, { type, fromSeat: null });
    assert.doesNotMatch(event.message, /明杠后补摸胡/);
  });
}

test('exposed replacement retains single payer for big single and final first hu', () => {
  for (const finalWin of [false, true]) {
    let game = afterExposedKong({ base: [17], melds: [meld(3, 'peng', 3), meld(6, 'peng', 3), meld(9, 'peng', 3)], rules: { specialHuPatterns: true } });
    if (finalWin) {
      // Exercise the final-first-hu branch without rewriting any recorded score.
      for (const seat of [1, 2]) {
        const tile = game.wall.shift();
        game.retiredTiles.push({ seat, tile });
        game.players[seat].winPile.push({ tile, source: 'selfDraw', virtual: false });
        game.players[seat].huCount = 1;
      }
      // Model the already completed first hu's base and pending radish reveal.
      for (let n = 6 + game.pendingKongRadishes; n > 0 && game.wall.length; n--) game.players[1].radishes.push(game.wall.pop());
      game.pendingKongRadishes = 0;
      game.firstHuRadishesRevealed = true;
      assertGameInvariants(game);
    }
    game = doAction(game, 'hu');
    const event = assertHuPayers(game, [1]);
    assert.equal(event.score.bigSingle, true);
    assert.match(event.message, /大单钓·明杠后补摸胡/);
    if (finalWin) {
      assert.equal(game.phase, 'finished');
      assert.equal(game.finishReason, 'allPlayersHu');
    }
  }
});

test('own replacement still charges both when the winner and one opponent have already hu', () => {
  let game = fixture({ hand: [0, 1, 2, 3, 9, 10, 11, 12, 13, 14, 17], drawTile: 0,
    melds: [meld(0, 'buGang', 5)], head: [17, 17], tail: [8],
    priorWinsBySeat: [[17], [16], []] });
  assert.deepEqual(actions(game), [{ type: 'addGang', tile: 0 }]);
  game = doAction(game, 'addGang', 0);
  assert.deepEqual(game.lastDraw.kongSource, { type: 'addGang', fromSeat: null });
  game = doAction(game, 'hu');
  assertHuPayers(game, [1, 2]);
  assert.equal(game.lastDraw.kongSource, undefined);
  game = doAction(game, 'hu');
  assertHuPayers(game, [2]);
});

test('replacement provenance rejects wrong source, invalid payer and stale ordinary-draw metadata', () => {
  const original = afterExposedKong();
  for (const source of [{ type: 'mingGang', fromSeat: 0 }, { type: 'mingGang', fromSeat: 3 }, { type: 'buGang', fromSeat: 1 }, { type: 'peng', fromSeat: 1 }]) {
    const game = structuredClone(original);
    game.lastDraw.kongSource = source;
    assert.throws(() => assertGameInvariants(game), /杠后补摸来源/);
  }
  const ordinary = structuredClone(original);
  ordinary.lastDraw.source = 'normal';
  assert.throws(() => assertGameInvariants(ordinary), /杠后补摸来源/);
});
