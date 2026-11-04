import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, getPlayerView, getLegalActions, getWaitTiles, assertGameInvariants, getHuDiagnostic, fanToPoints } from '../shared/game.js';

const waiting = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
const winning = [...waiting, 17];
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

const seven = [0, 0, 2, 2, 4, 4, 6, 6, 9, 9, 11, 11, 13, 13];
const sevenBase = seven.slice(0, -1);
const quietTail = [8, 8, 8, 15, 15, 15];
const huEvents = (game, seat = 0) => game.history.filter(event => event.type === 'hu' && event.seat === seat);
const baseHand = (game, seat = 0) => {
  const hand = [...game.players[seat].hand];
  if (game.lastDraw?.seat === seat) hand.splice(hand.indexOf(game.lastDraw.tile), 1);
  return hand;
};
function sevenPattern() {
  return doAction(fixture({ hands: [seven, waiting, waiting], drawTile: 13, head: [2], tail: quietTail }), 0, 'hu').players[0].firstHuPattern;
}
function setPattern(game, seat, pattern) {
  game.players[seat].firstHuPattern = structuredClone(pattern);
  assertGameInvariants(game);
  return game;
}

test('new special rules are explicit; stored rooms without the flag keep legacy scoring and no metadata', () => {
  assert.equal(createGame({ seed: 1 }).rules.specialHuPatterns, true);
  assert.throws(() => createGame({ rules: { specialHuPatterns: 'yes' } }));
  for (const absent of [false, true]) {
    const source = fixture({ hands: [[17, 17], waiting, waiting], melds: [[meld(0), meld(3), meld(9), meld(12)], [], []], drawTile: 17, head: [17], tail: quietTail, rules: { specialHuPatterns: false } });
    if (absent) delete source.rules.specialHuPatterns;
    const original = structuredClone(source);
    const game = doAction(source, 0, 'hu');
    assert.deepEqual(source, original);
    assert.equal(huEvent(game).score.total, 50);
    assert.equal(huEvent(game).score.overlapPolicy, 'exclusive');
    assert.equal(huEvent(game).score.patternBonuses, undefined);
    assert.equal(game.players[0].firstHuPattern, null);
    assert.equal(getPlayerView(game, 0).specialHuPattern, undefined);
  }
});

test('seven pairs expands all seven original tile types only after first hu and retains the frozen hand', () => {
  assert.deepEqual(getWaitTiles(sevenBase), [13]);
  const before = fixture({ hands: [[...sevenBase, 2], waiting, waiting], drawTile: 2 });
  assert.equal(has(before, 0, 'hu'), false);
  assert.equal(getHuDiagnostic(before, 0).code, 'SHAPE');
  for (const tile of [0, 2, 4, 6, 9, 11, 13]) {
    let game = fixture({ hands: [seven, waiting, waiting], drawTile: 13, head: [tile, 7], tail: quietTail });
    game = doAction(game, 0, 'hu');
    assert.equal(game.lastDraw.tile, tile);
    assert.equal(has(game, 0, 'hu'), true);
    assert.equal(getHuDiagnostic(game, 0).code, 'AVAILABLE');
    assert.deepEqual(getPlayerView(game, 0).waitTiles, [0, 2, 4, 6, 9, 11, 13]);
    assert.deepEqual(baseHand(game), sevenBase);
    game = doAction(game, 0, 'hu');
    const score = huEvents(game).at(-1).score;
    assert.equal(score.fan, 3); assert.equal(score.fanPoints, 4);
    assert.equal(score.sevenPairsFixed, true); assert.equal(score.copyFanBonus, 0);
    assert.deepEqual(score.patternBonuses, [{ type: 'sevenPairs', fan: 3 }]);
    assert.deepEqual(baseHand(game), sevenBase);
    assert.equal(game.players[0].winPile.at(-1).tile, tile);
    assert.equal(game.players[0].huCount, 2);
    assertGameInvariants(game);
  }
});

test('seven-pairs outsiders are not newly accepted and are automatically discarded after hu', () => {
  const game = doAction(fixture({ hands: [seven, waiting, waiting], drawTile: 13, head: [7, 8], tail: quietTail }), 0, 'hu');
  assert.equal(game.players[0].huCount, 1);
  assert.ok(game.history.some(event => event.type === 'discard' && event.seat === 0 && event.tile === 7 && event.automatic));
  assert.deepEqual(game.players[0].firstHuPattern.waitTiles, [0, 2, 4, 6, 9, 11, 13]);
});

test('seven-pairs fixed tiers use the full initial 14 tiles for quads, two quads, six and eight copies', () => {
  const cases = [
    { hand: [0, 0, 0, 0, 2, 2, 4, 4, 6, 6, 9, 9, 11, 11], fan: 4, first: 0 },
    { hand: [0, 0, 0, 0, 2, 2, 4, 4, 6, 6, 9, 9, 11, 11], fan: 4, first: 11 },
    { hand: [0, 0, 0, 0, 2, 2, 2, 2, 4, 4, 9, 9, 11, 11], fan: 5, first: 0 },
    { hand: [0, 0, 0, 0, 0, 0, 2, 2, 4, 4, 9, 9, 11, 11], fan: 6, first: 0 },
    { hand: [0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 9, 9, 11, 11], fan: 8, first: 0 },
  ];
  for (const { hand, fan, first } of cases) {
    let game = doAction(fixture({ hands: [hand, noZero, noZero], drawTile: first, head: [2, 7], tail: quietTail }), 0, 'hu');
    const metadata = structuredClone(game.players[0].firstHuPattern);
    assert.equal(metadata.fixedFan, fan);
    assert.deepEqual(metadata.waitTiles, [...new Set(hand)]);
    assert.equal(has(game, 0, 'hu'), true);
    game = doAction(game, 0, 'hu');
    assert.equal(huEvents(game).at(-1).score.fan, fan);
    assert.equal(huEvents(game).at(-1).score.fanPoints, fanToPoints(fan));
    assert.equal(huEvents(game).at(-1).score.copyFanBonus, 0);
    assert.deepEqual(game.players[0].firstHuPattern, metadata);
    assertGameInvariants(game);
  }
});

test('repeat seven-pairs score remains fixed while accumulated wins and shared radishes still count', () => {
  let game = fixture({ hands: [seven, waiting, waiting], drawTile: 13, head: [13, 13, 13, 13], tail: [0, 8, 8, 15, 15, 15] });
  for (let index = 0; index < 5; index++) game = doAction(game, 0, 'hu');
  const later = huEvents(game).slice(1);
  for (const event of later) {
    assert.equal(event.score.fan, 3); assert.equal(event.score.fanPoints, 4);
    assert.equal(event.score.copyFanBonus, 0); assert.equal(event.score.radishBonus, 2);
    assert.equal(event.score.total, 6);
  }
  assert.equal(game.players[0].winPile.filter(win => win.tile === 13).length, 5);
  assert.equal(game.players[0].firstHuPattern.fixedFan, 3);
  assertGameInvariants(game);
});

test('expanded waits survive serialization and private views do not expose another player’s first shape', () => {
  let game = doAction(fixture({ hands: [seven, waiting, waiting], drawTile: 13, head: [2, 7], tail: quietTail }), 0, 'hu');
  game = JSON.parse(JSON.stringify(game));
  assert.equal(has(game, 0, 'hu'), true);
  const ownView = getPlayerView(game, 0);
  assert.deepEqual(ownView.specialHuPattern, game.players[0].firstHuPattern);
  for (const seat of [1, 2]) {
    const otherView = getPlayerView(game, seat);
    assert.equal(otherView.specialHuPattern, null);
    assert.equal(otherView.players[0].firstHuPattern, undefined);
    assert.equal(otherView.players[0].specialHuPattern, undefined);
    assert.equal(otherView.players[0].hand, undefined);
  }
  ownView.specialHuPattern.waitTiles.push(17);
  assert.equal(game.players[0].firstHuPattern.waitTiles.includes(17), false);
  game = doAction(game, 0, 'hu');
  assert.equal(huEvents(game).at(-1).score.sevenPairsFixed, true);
  assertGameInvariants(game);
});

test('expanded discard hu ignores stale locks but preserves protected sources and the kong-discard exception', () => {
  const pattern = sevenPattern();
  const pengTwo = waiting.map((tile, index) => index === 0 ? 2 : tile);
  for (const scenario of [
    { locked: false, sourceHu: false, afterKong: false, allowed: true },
    { locked: true, sourceHu: false, afterKong: false, allowed: true },
    { locked: true, sourceHu: true, afterKong: true, allowed: true },
    { locked: false, sourceHu: true, afterKong: false, allowed: false },
  ]) {
    let game = fixture({ hands: [[...waiting, 2], sevenBase, pengTwo], drawTile: 2, head: [7],
      huCounts: [Number(scenario.sourceHu), 1, 0], priorWins: [scenario.sourceHu ? [17] : [], [13], []],
      locks: [[], pattern.waitTiles, []], activeLocks: [false, scenario.locked, false], kongSeats: scenario.afterKong ? [0] : [] });
    setPattern(game, 1, pattern);
    game = doAction(game, 0, 'discard', 2);
    const claimHu = game.phase === 'claim' && getLegalActions(game, 1).some(action => action.type === 'hu');
    assert.equal(claimHu, scenario.allowed);
    if (scenario.allowed) assert.equal(getHuDiagnostic(game, 1).code, 'AVAILABLE');
    if (scenario.allowed) {
      game = doAction(game, 1, 'hu'); game = passAll(game);
      const event = huEvent(game, 1);
      assert.equal(event.source, scenario.afterKong ? 'kongDiscard' : 'discard');
      assert.equal(event.score.fan, 3);
    }
    assertGameInvariants(game);
  }
});

test('two simultaneous expanded seven-pairs wins share one physical discard and keep fixed scores', () => {
  const pattern = sevenPattern();
  let game = fixture({ hands: [[...waiting, 2], sevenBase, sevenBase], drawTile: 2, head: [7], huCounts: [0, 1, 1], priorWins: [[], [13], [13]] });
  setPattern(game, 1, pattern); setPattern(game, 2, pattern);
  game = doAction(game, 0, 'discard', 2);
  assert.equal(has(game, 1, 'hu'), true); assert.equal(has(game, 2, 'hu'), true);
  game = doAction(game, 2, 'hu'); game = doAction(game, 1, 'hu');
  assert.deepEqual(game.discards[0].huSeats, [1, 2]);
  assert.equal(game.players[1].winPile.at(-1).virtual, false);
  assert.equal(game.players[2].winPile.at(-1).virtual, true);
  assert.equal(huEvent(game, 1).score.fan, 3); assert.equal(huEvent(game, 2).score.fan, 3);
  assertGameInvariants(game);
});

test('big single expands the concealed wait plus all meld types without creating or merging melds', () => {
  for (const type of ['peng', 'anGang', 'mingGang', 'buGang']) {
    const groups = [meld(0, type), meld(3), meld(9), meld(12)];
    let game = fixture({ hands: [[17, 17], waiting, waiting], melds: [groups, [], []], drawTile: 17, head: [0, 7], tail: quietTail });
    game = doAction(game, 0, 'hu');
    assert.deepEqual(getPlayerView(game, 0).waitTiles, [0, 3, 9, 12, 17]);
    assert.equal(has(game, 0, 'hu'), true);
    assert.equal(has(game, 0, 'buGang'), false); // A valid hu keeps the existing hu/pass priority.
    assert.equal(getHuDiagnostic(game, 0).code, 'AVAILABLE');
    game = doAction(game, 0, 'hu');
    const score = huEvents(game).at(-1).score;
    assert.equal(score.bigSingle, true); assert.equal(score.bigSinglePoints, 0);
    assert.equal(score.overlapPolicy, 'fan');
    assert.deepEqual(score.patternBonuses, [{ type: 'bigSingle', fan: 2 }]);
    assert.equal(score.copyFanBonus, type === 'peng' ? 1 : 2);
    assert.equal(score.fan, type === 'peng' ? 4 : 5);
    assert.deepEqual(game.players[0].melds, groups);
    assert.equal(game.players[0].melds.length, 4);
    assert.deepEqual(baseHand(game), [17]);
    assertGameInvariants(game);
  }
});

test('big single plus pure suit stacks but big single and all triplets are mutually exclusive', () => {
  const groups = [meld(0), meld(2), meld(4), meld(6)];
  let game = doAction(fixture({ hands: [[8, 8], waiting, waiting], melds: [groups, [], []], drawTile: 8, head: [0, 7], tail: [15, 15, 15, 16, 16, 16] }), 0, 'hu');
  let score = huEvents(game).at(-1).score;
  assert.equal(score.fan, 5); assert.equal(score.total, 10);
  assert.deepEqual(score.patternBonuses, [{ type: 'bigSingle', fan: 2 }, { type: 'pureSuit', fan: 2 }]);
  game = doAction(game, 0, 'hu');
  score = huEvents(game).at(-1).score;
  assert.equal(score.fan, 6); assert.equal(score.total, 12);
  assert.equal(score.copyFanBonus, 1);
  assert.deepEqual(score.patternBonuses, [{ type: 'bigSingle', fan: 2 }, { type: 'pureSuit', fan: 2 }]);
});

test('pure suit and all triplets each add two fan and can stack outside big single', () => {
  const cases = [
    { hand: [0, 1, 2, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8], patterns: [{ type: 'pureSuit', fan: 2 }], fan: 3 },
    { hand: [0, 0, 0, 2, 2, 2, 9, 9, 9, 11, 11, 11, 17, 17], patterns: [{ type: 'allTriplets', fan: 2 }], fan: 3 },
    { hand: [0, 0, 0, 2, 2, 2, 4, 4, 4, 6, 6, 6, 8, 8], patterns: [{ type: 'allTriplets', fan: 2 }, { type: 'pureSuit', fan: 2 }], fan: 5 },
    { hand: winning, patterns: [], fan: 1 },
  ];
  for (const { hand, patterns, fan } of cases) {
    const game = doAction(fixture({ hands: [hand, waiting, waiting], drawTile: hand.at(-1), head: [7], tail: [15, 15, 15, 16, 16, 16] }), 0, 'hu');
    const score = huEvent(game).score;
    assert.equal(score.fan, fan); assert.equal(score.fanPoints, fanToPoints(fan));
    assert.deepEqual(score.patternBonuses, patterns);
    assertGameInvariants(game);
  }
});

test('the same tile can be penged twice through real actions and remains two independent melds', () => {
  let game = fixture({ hands: [[0, ...waiting], [0, 0, 0, 0, 1, 2, 3, 5, 6, 9, 10, 13, 15], waiting], drawTile: 0, head: [7, 0] });
  game = doAction(game, 0, 'discard', 0); game = doAction(game, 1, 'peng', 0); game = passAll(game);
  game = passAll(doAction(game, 1, 'discard', 15));
  game = passAll(doAction(game, 2, 'discard', 7));
  game = doAction(game, 0, 'discard', 0); game = doAction(game, 1, 'peng', 0); game = passAll(game);
  assert.equal(game.players[1].melds.length, 2);
  assert.ok(game.players[1].melds.every(group => group.type === 'peng' && group.tile === 0 && group.tiles.length === 3));
  assert.equal(game.history.filter(event => event.type === 'peng' && event.seat === 1).length, 2);
  assertGameInvariants(game);
});

test('duplicate pengs count six physical tiles but only one expanded wait type', () => {
  const groups = [meld(0), meld(0), meld(9), meld(12)];
  let game = doAction(fixture({ hands: [[17, 17], noZero, noZero], melds: [groups, [], []], drawTile: 17, head: [0, 7], tail: quietTail }), 0, 'hu');
  assert.equal(huEvent(game).score.copyFanBonus, 3);
  assert.equal(huEvent(game).score.fan, 6);
  assert.deepEqual(getPlayerView(game, 0).waitTiles, [0, 9, 12, 17]);
  assert.equal(has(game, 0, 'hu'), true);
  game = doAction(game, 0, 'hu');
  assert.deepEqual(game.players[0].melds, groups);
  assert.equal(game.players[0].winPile.at(-1).tile, 0);
  assert.equal(huEvents(game).at(-1).score.copyFanBonus, 4); // Seven logical copies now add the confirmed four fan.
  assertGameInvariants(game);
});

test('repeated seven-pairs winning tiles add radish matches without changing the fixed fan', () => {
  let game = fixture({ hands: [seven, waiting, waiting], drawTile: 13, head: [2, 2, 7], tail: [2, 8, 8, 15, 15, 15] });
  game = doAction(game, 0, 'hu');
  game = doAction(game, 0, 'hu');
  assert.equal(huEvents(game).at(-1).score.radishBonus, 3);
  assert.equal(huEvents(game).at(-1).score.total, 7);
  game = doAction(game, 0, 'hu');
  assert.equal(huEvents(game).at(-1).score.radishBonus, 4);
  assert.equal(huEvents(game).at(-1).score.total, 8);
  assert.equal(huEvents(game).at(-1).score.fan, 3);
  assert.equal(huEvents(game).at(-1).score.copyFanBonus, 0);
  assertGameInvariants(game);
});

test('expanded waits exclude a ninth physical copy already fully accounted in own zones', () => {
  const hand = [0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 9, 9, 11, 11];
  const game = doAction(fixture({ hands: [hand, noZero, noZero], drawTile: 0, head: [2], tail: quietTail }), 0, 'hu');
  assert.deepEqual(game.players[0].firstHuPattern.waitTiles, [0, 2, 9, 11]);
  assert.deepEqual(getPlayerView(game, 0).waitTiles, [2, 9, 11]);
  assert.equal(game.players[0].firstHuPattern.fixedFan, 8);
  assertGameInvariants(game);
});

test('a standard first win can later activate big-single repeats after a legal fourth kong', () => {
  let game = fixture({ hands: [[0, 0, 0, 17, 17], waiting, waiting], melds: [[meld(3), meld(9), meld(12)], [], []], drawTile: 17, head: [0, 17, 9, 7], tail: quietTail });
  game = doAction(game, 0, 'hu');
  assert.equal(game.players[0].firstHuPattern.kind, 'standard');
  assert.equal(has(game, 0, 'anGang', 0), true);
  game = doAction(game, 0, 'anGang', 0);
  assert.equal(game.lastDraw.tile, 17);
  assert.equal(has(game, 0, 'hu'), true);
  game = doAction(game, 0, 'hu');
  assert.equal(game.players[0].firstHuPattern.kind, 'bigSingle');
  assert.deepEqual(getPlayerView(game, 0).waitTiles, [0, 3, 9, 12, 17]);
  assert.equal(game.lastDraw.tile, 9);
  assert.equal(has(game, 0, 'hu'), true);
  game = doAction(game, 0, 'hu');
  assert.equal(game.players[0].huCount, 3);
  assert.equal(game.players[0].melds.length, 4);
  assert.deepEqual(baseHand(game), [17]);
  assert.equal(huEvents(game).at(-1).score.specialHuPattern, 'bigSingle');
  assertGameInvariants(game);
});

test('a first seven-pairs win can activate after an earlier standard win with overlapping structural waits', () => {
  const base = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6];
  let game = fixture({ hands: [[...base, 0], waiting, waiting], drawTile: 0, head: [6, 1, 7], tail: quietTail });
  game = doAction(game, 0, 'hu');
  assert.equal(game.players[0].firstHuPattern.kind, 'standard');
  assert.equal(game.lastDraw.tile, 6);
  game = doAction(game, 0, 'hu');
  assert.equal(game.players[0].firstHuPattern.kind, 'sevenPairs');
  assert.equal(game.players[0].firstHuPattern.sevenPairsFan, 3);
  assert.equal(game.players[0].firstHuPattern.fixedFan, 5);
  assert.equal(huEvents(game).at(-1).score.fan, 5);
  assert.equal(huEvents(game).at(-1).score.sevenPairsFixed, true);
  assert.deepEqual(getPlayerView(game, 0).waitTiles, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(game.lastDraw.tile, 1);
  assert.equal(has(game, 0, 'hu'), true);
  game = doAction(game, 0, 'hu');
  assert.equal(huEvents(game).at(-1).score.sevenPairsFixed, true);
  assert.deepEqual(baseHand(game), base);
  assertGameInvariants(game);
});

test('big-single meld-type discard wins retain the existing payer policy and count the tile once', () => {
  const groups = [meld(0), meld(3), meld(9), meld(12)];
  const first = doAction(fixture({ hands: [[17, 17], waiting, waiting], melds: [groups, [], []], drawTile: 17, head: [17], tail: quietTail }), 0, 'hu');
  let game = fixture({ hands: [[...waiting, 0], [17], waiting], melds: [[], groups, []], drawTile: 0, huCounts: [0, 1, 0], priorWins: [[], [17], []], head: [7] });
  setPattern(game, 1, first.players[0].firstHuPattern);
  game = doAction(game, 0, 'discard', 0);
  assert.equal(has(game, 1, 'hu'), true);
  game = doAction(game, 1, 'hu');
  const event = huEvent(game, 1);
  assert.equal(event.source, 'discard'); assert.equal(event.score.copyFanBonus, 1);
  assert.equal(event.score.fan, 4); assert.equal(event.score.total, 8);
  assert.deepEqual(event.payments, [{ seat: 0, delta: -8 }, { seat: 2, delta: -8 }, { seat: 1, delta: 16 }]);
  assert.deepEqual(game.players[1].melds, groups);
  assert.equal(game.players[1].winPile.at(-1).discardIndex, 0);
  assertGameInvariants(game);
});

test('all-triplets detection supports repeated identical triplets without mistaking a sequence for a triplet', () => {
  const hand = [0, 0, 0, 0, 0, 0, 9, 9, 9, 11, 11, 11, 17, 17];
  const game = doAction(fixture({ hands: [hand, noZero, noZero], drawTile: 17, head: [7], tail: quietTail }), 0, 'hu');
  const score = huEvent(game).score;
  assert.equal(score.specialHuPattern, null);
  assert.deepEqual(score.patternBonuses, [{ type: 'allTriplets', fan: 2 }]);
  assert.equal(score.copyFanBonus, 3); assert.equal(score.fan, 6);
  assertGameInvariants(game);
});

test('disabling seven pairs does not activate its metadata on a shape that can also win as all triplets', () => {
  const hand = [0, 0, 0, 0, 0, 0, 9, 9, 9, 9, 9, 9, 17, 17];
  const game = doAction(fixture({ hands: [hand, noZero, noZero], drawTile: 17, head: [7], tail: quietTail, rules: { sevenPairs: false } }), 0, 'hu');
  const score = huEvent(game).score;
  assert.equal(game.players[0].firstHuPattern.kind, 'standard');
  assert.equal(score.sevenPairsFixed, false);
  assert.deepEqual(score.patternBonuses, [{ type: 'allTriplets', fan: 2 }]);
  assert.equal(score.copyFanBonus, 6); assert.equal(score.fan, 9);
  assertGameInvariants(game);
});

test('seven-pairs first win and repeats freeze the confirmed tier plus the initial pure-suit bonus', () => {
  const cases = [
    { hand: seven, first: 13, tier: 3, fan: 3, points: 4, pure: false },
    { hand: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6], first: 6, tier: 3, fan: 5, points: 10, pure: true },
    { hand: [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5], first: 0, tier: 4, fan: 6, points: 12, pure: true },
    { hand: [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 4], first: 0, tier: 5, fan: 7, points: 14, pure: true },
    { hand: [0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4], first: 0, tier: 6, fan: 8, points: 16, pure: true },
    { hand: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3], first: 0, tier: 8, fan: 10, points: 20, pure: true },
    // This also has an all-triplets decomposition; the fixed seven-pairs mode does not add it.
    { hand: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2], first: 0, tier: 9, fan: 11, points: 22, pure: true },
  ];
  for (const { hand, first, tier, fan, points, pure } of cases) {
    const repeat = hand.at(-1);
    let game = fixture({ hands: [hand, noZero, noZero], drawTile: first, head: [repeat, repeat, 7], tail: [15, 15, 15, 16, 16, 16] });
    const expectedBase = [...hand]; expectedBase.splice(expectedBase.indexOf(first), 1);
    let savedPattern;
    for (let index = 0; index < 3; index++) {
      game = doAction(game, 0, 'hu');
      const score = huEvents(game).at(-1).score;
      assert.equal(score.sevenPairsFixed, true);
      assert.equal(score.fan, fan); assert.equal(score.fanPoints, points); assert.equal(score.total, points);
      assert.equal(score.copyFanBonus, 0);
      assert.deepEqual(score.patternBonuses, [{ type: 'sevenPairs', fan: tier }, ...(pure ? [{ type: 'pureSuit', fan: 2 }] : [])]);
      assert.equal(game.players[0].firstHuPattern.sevenPairsFan, tier);
      assert.equal(game.players[0].firstHuPattern.fixedFan, fan);
      assert.equal(game.players[0].firstHuPattern.pureSuit, pure);
      assert.deepEqual(baseHand(game), expectedBase);
      if (savedPattern) assert.deepEqual(game.players[0].firstHuPattern, savedPattern);
      else savedPattern = structuredClone(game.players[0].firstHuPattern);
      game = JSON.parse(JSON.stringify(game));
      assertGameInvariants(game);
    }
  }
});

test('pure seven pairs keeps five fan while repeat winning tiles increase shared-radish points', () => {
  const hand = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6];
  let game = fixture({ hands: [hand, waiting, waiting], drawTile: 6, head: [2, 2, 7], tail: [2, 8, 8, 15, 15, 15] });
  for (const expectedRadish of [2, 3, 4]) {
    game = doAction(game, 0, 'hu');
    const score = huEvents(game).at(-1).score;
    assert.equal(score.fan, 5); assert.equal(score.fanPoints, 10); assert.equal(score.copyFanBonus, 0);
    assert.equal(score.radishBonus, expectedRadish); assert.equal(score.total, 10 + expectedRadish);
    assert.deepEqual(score.patternBonuses, [{ type: 'sevenPairs', fan: 3 }, { type: 'pureSuit', fan: 2 }]);
    assertGameInvariants(game);
  }
});

test('simultaneous first pure-seven-pairs discard wins each freeze five fan without duplicating the tile', () => {
  const base = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6];
  let game = fixture({ hands: [[...waiting, 6], base, base], drawTile: 6, head: [7], tail: [15, 15, 15, 16, 16, 16] });
  game = doAction(game, 0, 'discard', 6);
  game = doAction(game, 2, 'hu'); game = doAction(game, 1, 'hu');
  for (const seat of [1, 2]) {
    const score = huEvent(game, seat).score;
    assert.equal(score.fan, 5); assert.equal(score.total, 10); assert.equal(score.sevenPairsFixed, true);
    assert.equal(game.players[seat].firstHuPattern.sevenPairsFan, 3);
    assert.equal(game.players[seat].firstHuPattern.fixedFan, 5);
  }
  assert.equal(game.players[1].winPile[0].virtual, false);
  assert.equal(game.players[2].winPile[0].virtual, true);
  assert.deepEqual(game.discards[0].huSeats, [1, 2]);
  assertGameInvariants(game);
});

test('stored pre-pattern rooms do not gain the new first-win or pure-seven-pairs scoring', () => {
  const hand = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6];
  const source = fixture({ hands: [hand, waiting, waiting], drawTile: 6, head: [7], tail: [15, 15, 15, 16, 16, 16], rules: { specialHuPatterns: false } });
  delete source.rules.specialHuPatterns;
  const before = structuredClone(source);
  const game = doAction(source, 0, 'hu');
  assert.deepEqual(source, before);
  assert.equal(huEvent(game).score.fan, 1); assert.equal(huEvent(game).score.total, 1);
  assert.equal(huEvent(game).score.sevenPairsFixed, undefined);
  assert.equal(game.players[0].firstHuPattern, null);
  assertGameInvariants(game);
});
