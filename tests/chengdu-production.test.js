/**
 * 成都正式 schema 2 验收：合成完整牌墙和真实动作，独立于房间适配/部署。
 * Production schema-two acceptance uses synthetic full walls and real actions, separate from room adapters/deployment.
 * 覆盖正式/原型隔离、固定规则、换牌轮回、公开范围、归档重滤、重连和胡后退场。
 * Cover draft isolation, fixed policy, exchange cycle, disclosure, archive re-filtering, recovery and winner retirement.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../shared/chengdu-engine.js';
import * as draft from '../shared/chengdu-play.js';
import { chengduProductionPolicy } from '../shared/chengdu-production-contract.js';

const WAIT = [9, 10, 11, 12, 13, 14, 18, 19, 20, 21, 22, 23, 26];
const SOURCE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17, 26];
const OPTIONS = { endCondition: 'bloodBattle', exchangeThree: false };
const SCORING = { selfDraw: 'addBase', fanCap: 4 };

// 夹具从四张预算发真实108张牌；庄家第14张放在前四组13张后，其余为墙。
// Deal from exact four-copy budgets: dealer's extra tile follows four thirteen-tile hands; the rest is the wall.
function wallFor({ hands = {}, dealerSeat = 0, head = [] } = {}) {
  const counts = Array(27).fill(4);
  const players = Array.from({ length: 4 }, (_, seat) => [...(hands[seat] ?? [])]);
  const debit = (tile) => assert.ok(--counts[tile] >= 0, `Too many copies of ${tile}`);
  players.flat().forEach(debit);
  head.forEach(debit);
  for (let seat = 0; seat < 4; seat++) {
    const needed = seat === dealerSeat ? 14 : 13;
    if (hands[seat]) assert.equal(players[seat].length, needed);
    while (players[seat].length < needed) {
      const different = counts.findIndex((count, tile) => count > 0 && !players[seat].includes(tile));
      const tile = different >= 0 ? different : counts.findIndex((count) => count > 0);
      players[seat].push(tile);
      debit(tile);
    }
  }
  const extra = players[dealerSeat].pop();
  return [...players.flat(), extra, ...head, ...counts.flatMap((count, tile) => Array(count).fill(tile))];
}

// 调用正式入口及真实定缺动作，不能通过改版本号把开发中局直接当正式存档。
// Use the production constructor and real dingque actions, never promote a draft mid-game by changing version flags.
function start({ hands, dealerSeat = 0, head, suits = {}, options = OPTIONS, exchangeOrdinal = 0 } = {}) {
  let game = engine.createGame({ wall: wallFor({ hands, dealerSeat, head }), dealerSeat, options, scoring: SCORING, exchangeOrdinal });
  if (game.phase === 'exchange') {
    for (const seat of [2, 0, 3, 1]) game = engine.applyAction(game, seat, engine.getLegalActions(game, seat)[0]);
  }
  for (let seat = 0; seat < 4; seat++) {
    game = engine.applyAction(game, seat, { type: 'dingque', suit: suits[seat] ?? 'bamboo' });
  }
  return game;
}

// 所有可回应座位明确选择，测试不能跳过或代替尚未提交的玩家决定。
// Submit each eligible response explicitly, never skip a player's decision.
function respond(game, choices = {}) {
  let next = game;
  for (const seat of game.claim.eligibleSeats) {
    if (next.phase !== 'claim') break;
    next = engine.applyAction(next, seat, choices[seat] ?? { type: 'pass' });
  }
  return next;
}

// 为整局验收选择当前真实白名单动作；所有动作都经历权威复制和恢复校验。
// For full-game acceptance choose only current legal actions, each through authoritative cloning and recovery validation.
function finish(game) {
  let count = 0;
  let next = game;
  while (next.phase !== 'finished' && count++ < 500) {
    const choices = next.players.flatMap((player) => engine.getLegalActions(next, player.seat)
      .map((action) => ({ seat: player.seat, action })));
    const choice = choices.find(({ action }) => action.type === 'hu') ??
      choices.find(({ action }) => action.type === 'pass') ?? choices[0];
    assert.ok(choice, `Missing action in ${next.phase}`);
    next = engine.applyAction(next, choice.seat, choice.action);
    next = JSON.parse(JSON.stringify(next));
    engine.assertGameInvariants(next);
  }
  assert.equal(next.phase, 'finished');
  return next;
}

test('production constructor snapshots schema, confirmed policies, visibility and enabled-only cycle', () => {
  const wall = wallFor();
  const input = { wall, dealerSeat: 0, options: OPTIONS, scoring: SCORING, exchangeOrdinal: 7 };
  const before = structuredClone(input);
  const game = engine.createGame(input);
  assert.equal(game.schemaVersion, 2);
  assert.equal(game.rulesVersion, 'chengdu-1');
  assert.equal(game.runtimeKind, 'production');
  assert.equal(game.stage, 'preparation');
  assert.equal(Object.hasOwn(game, 'developmentOnly'), false);
  assert.equal(Object.hasOwn(game, 'developmentStage'), false);
  assert.equal(game.exchangeOrdinal, 7);
  assert.equal(game.nextExchangeOrdinal, 7);
  assert.equal(game.rules.turnDirection, 'counterclockwise');
  assert.equal(game.rules.publicConcealedKongs, true);
  assert.equal(game.rules.hideSelfDrawWins, true);
  assert.deepEqual(input, before);
  assert.deepEqual(game.playPolicy, chengduProductionPolicy());
  for (const [exchangeOrdinal, direction] of ['clockwise', 'opposite', 'counterclockwise', 'clockwise'].entries()) {
    const exchanged = engine.createGame({ ...input, options: { ...OPTIONS, exchangeThree: true }, exchangeOrdinal });
    assert.equal(exchanged.preparation.exchangePlan.direction, direction);
    assert.equal(exchanged.nextExchangeOrdinal, exchangeOrdinal + 1);
    assert.deepEqual(exchanged.preparation.exchangePlan.clockwiseSeats, [0, 1, 2, 3]);
    assert.deepEqual(engine.getSpectatorView(JSON.parse(JSON.stringify(exchanged))), engine.getSpectatorView(exchanged));
  }
});

test('production rejects caller overrides, invalid walls and absent explicit start inputs', () => {
  const valid = { wall: wallFor(), dealerSeat: 0, options: OPTIONS, scoring: SCORING, exchangeOrdinal: 0 };
  for (const key of ['force', 'approved', 'playPolicy', 'developmentOnly', 'schemaVersion']) {
    assert.throws(() => engine.createGame({ ...valid, [key]: true }));
  }
  for (const key of Object.keys(valid)) {
    const missing = structuredClone(valid);
    delete missing[key];
    assert.throws(() => engine.createGame(missing));
  }
  assert.throws(() => engine.createGame({ ...valid, wall: Array(108).fill(0) }));
});

test('production rejects draft saves, flipped markers, incomplete snapshots and alternate seat policies', () => {
  const input = { wall: wallFor(), dealerSeat: 0, options: OPTIONS, scoring: SCORING };
  const development = draft.createDevelopmentGame(input, chengduProductionPolicy());
  for (const saved of [development, { ...development, developmentOnly: false },
    { ...development, developmentOnly: false, schemaVersion: 2, runtimeKind: 'production', rulesVersion: 'chengdu-1' }]) {
    assert.throws(() => engine.assertGameInvariants(saved));
    assert.throws(() => engine.getPlayerView(saved, 0));
    assert.throws(() => engine.applyAction(saved, 0, { type: 'dingque', suit: 'bamboo' }));
  }
  const production = engine.createGame({ ...input, exchangeOrdinal: 0 });
  for (const mutate of [
    (game) => { delete game.rules.hideSelfDrawWins; },
    (game) => { game.playPolicy.turnDirection = 'clockwise'; },
    (game) => { game.playPolicy.clockwiseSeats = [0, 3, 2, 1]; },
    (game) => { game.nextExchangeOrdinal++; },
    (game) => { game.rulesVersion = 'unknown'; },
    (game) => { game.developmentOnly = false; },
  ]) {
    const corrupt = structuredClone(production);
    mutate(corrupt);
    assert.throws(() => engine.assertGameInvariants(corrupt));
  }
});

test('production preparation views omit draft flags and keep simultaneous choices seat-private', () => {
  let game = engine.createGame({ wall: wallFor(), dealerSeat: 0,
    options: { ...OPTIONS, exchangeThree: true }, scoring: SCORING, exchangeOrdinal: 0 });
  const action = engine.getLegalActions(game, 0)[0];
  game = engine.applyAction(game, 0, action);
  for (const view of [engine.getPlayerView(game, 1), engine.getSpectatorView(game), engine.getFormerParticipantView(game)]) {
    assert.equal(view.schemaVersion, 2);
    assert.equal(view.rulesVersion, 'chengdu-1');
    assert.equal(Object.hasOwn(view, 'rulesPending'), false);
    assert.equal(Object.hasOwn(view, 'developmentOnly'), false);
    assert.equal(Object.hasOwn(view.players[0], 'hand'), false);
    assert.equal(view.preparation.myExchange ?? null, null);
    assert.equal(Object.hasOwn(view, 'wall'), false);
  }
  assert.deepEqual(engine.getPlayerView(game, 0).preparation.myExchange, action.tiles);
  const restored = JSON.parse(JSON.stringify(game));
  assert.deepEqual(engine.getPlayerView(restored, 0), engine.getPlayerView(game, 0));
  assert.equal(restored.nextExchangeOrdinal, 1);
});

test('production single discard winner retires and next draw follows winner counterclockwise', () => {
  let game = start({ hands: { 0: SOURCE, 2: WAIT }, suits: { 0: 'characters', 2: 'bamboo' }, head: [25] });
  const wallCount = game.wall.length;
  game = engine.applyAction(game, 0, { type: 'discard', tile: 26 });
  game = respond(game, { 2: { type: 'hu' } });
  assert.equal(game.currentSeat, 1);
  assert.equal(game.lastDraw.tile, 25);
  assert.equal(game.wall.length, wallCount - 1);
  assert.deepEqual(engine.getLegalActions(game, 2), []);
  assert.throws(() => engine.applyAction(game, 2, { type: 'hu' }));
  assert.deepEqual(engine.getPlayerView(JSON.parse(JSON.stringify(game)), 2).legalActions, []);
});

test('production multiple winners retire as one batch and discarder draws next', () => {
  let game = start({ hands: { 0: SOURCE, 1: WAIT, 2: WAIT }, suits: { 0: 'characters', 1: 'bamboo', 2: 'bamboo' }, head: [25] });
  const wallCount = game.wall.length;
  game = engine.applyAction(game, 0, { type: 'discard', tile: 26 });
  game = respond(game, { 1: { type: 'hu' }, 2: { type: 'hu' } });
  assert.equal(game.currentSeat, 0);
  assert.equal(game.wall.length, wallCount - 1);
  assert.deepEqual(engine.getLegalActions(game, 1), []);
  assert.deepEqual(engine.getLegalActions(game, 2), []);
  const finished = finish(game);
  assert.equal(engine.dealerForNextGame(finished), 0);
});

test('production self-draw retires winner, advances counterclockwise and reveals only winning tile at finish', () => {
  let game = start({ hands: { 0: WAIT, 1: SOURCE }, dealerSeat: 1, head: [26], suits: { 0: 'bamboo', 1: 'bamboo' } });
  game = engine.applyAction(game, 1, { type: 'discard', tile: 0 });
  if (game.phase === 'claim') game = respond(game);
  assert.equal(game.currentSeat, 0);
  assert.equal(game.lastDraw.tile, 26);
  game = engine.applyAction(game, 0, { type: 'hu' });
  assert.equal(game.currentSeat, 3);
  assert.deepEqual(engine.getLegalActions(game, 0), []);
  assert.equal(engine.getPlayerView(game, 0).players[0].won.tile, 26);
  for (const view of [engine.getPlayerView(game, 1), engine.getSpectatorView(game), engine.getFormerParticipantView(game)]) {
    assert.equal(view.players[0].won.tile, null);
    assert.equal(view.history.find((event) => event.type === 'hu').tile, null);
    assert.equal(Object.hasOwn(view.players[0], 'hand'), false);
  }
  const finished = finish(game);
  const publicView = engine.getSpectatorView(finished);
  assert.equal(publicView.players[0].won.tile, 26);
  assert.equal(publicView.history.find((event) => event.type === 'hu').tile, 26);
  assert.ok(publicView.players.every((player) => !Object.hasOwn(player, 'hand')));
});

test('production established concealed kongs are public without exposing other concealed tiles', () => {
  const hand = [9, 9, 9, 9, 10, 12, 13, 15, 16, 18, 19, 21, 24, 26];
  let game = start({ hands: { 0: hand }, suits: { 0: 'bamboo' }, head: [25] });
  game = engine.applyAction(game, 0, { type: 'anGang', tile: 9 });
  const spectator = engine.getSpectatorView(game);
  assert.deepEqual(spectator.players[0].melds[0].tiles, [9, 9, 9, 9]);
  assert.equal(spectator.history.find((event) => event.type === 'anGang').tile, 9);
  assert.equal(spectator.history.find((event) => event.type === 'draw').tile, null);
  assert.equal(Object.hasOwn(spectator.players[0], 'hand'), false);
});

test('public history re-filtering is idempotent and never restores an already masked face', () => {
  const header = { gameMode: 'chengdu', schemaVersion: 2, rulesVersion: 'chengdu-1', runtimeKind: 'production', phase: 'finished' };
  const source = { ...header, history: [
    { type: 'hu', seat: 0, source: 'selfDraw', fromSeat: null, tile: 26, score: { points: 2, privateHand: [1, 2] }, payments: [{ from: 1, to: 0, points: 2, reason: 'hu' }] },
    { type: 'hu', seat: 1, source: 'selfDraw', fromSeat: null, tile: null, hidden: true, points: 3, payments: [] },
    { type: 'draw', seat: 2, source: 'normal', tile: null, hidden: true },
  ] };
  const events = engine.publicEvents(source);
  assert.equal(events[0].points, 2);
  assert.equal(events[0].tile, 26);
  assert.equal(events[1].tile, null);
  assert.equal(events[1].hidden, true);
  assert.equal(Object.hasOwn(events[0], 'score'), false);
  assert.deepEqual(engine.publicEvents({ ...header, history: events }), events);
  assert.equal(engine.publicEvents({ ...header, history: events }, 2)[2].tile, null);
});

for (const endCondition of ['firstWin', 'bloodBattle']) {
  for (const exchangeThree of [false, true]) {
    test(`production full replay ${endCondition}/exchange=${exchangeThree} preserves scores, saves and former-player privacy`, () => {
      const game = finish(start({ options: { endCondition, exchangeThree } }));
      assert.equal(game.players.reduce((total, player) => total + player.score, 0), 0);
      assert.ok(engine.dealerForNextGame(game) >= 0);
      assert.deepEqual(engine.getFormerParticipantView(game), engine.getSpectatorView(game));
      if (game.finishReason === 'wallExhausted') assert.deepEqual(engine.settleGame(game), game);
      assert.equal(game.nextExchangeOrdinal, exchangeThree ? 1 : 0);
      assert.ok(game.players.every((player) => player.won === null || engine.getLegalActions(game, player.seat).length === 0));
    });
  }
}
