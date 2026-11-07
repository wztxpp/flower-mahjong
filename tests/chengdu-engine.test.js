/**
 * 成都未开放原型回归：只用合成108张牌墙，不访问房间、网络或真实玩家。
 * Disabled Chengdu prototype regressions use synthetic 108-tile walls, never rooms, networks or real players.
 * 完整可玩性不在本套覆盖内；每个正式开局/结算都必须失败关闭。
 * Full gameplay is outside this suite; every production start and settlement must fail closed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as chengdu from '../shared/chengdu-game.js';
import { CHENGDU_SUITS, inspectChengduHand, hasDingqueTiles, getChengduStructuralWaits, getChengduDiscardTiles } from '../shared/chengdu-hand.js';
import {
  CHENGDU_EXCHANGE_CYCLE, CHENGDU_RULE_GAPS, ChengduRulesPendingError,
  validateChengduScoringOptions, chengduCapPoints, chengduWinPoints,
  chengduExchangeDirection, chengduExchangeRecipient, planChengduExchangeRound,
} from '../shared/chengdu-contract.js';
import { engineFor, modeForRoom } from '../server/game-engines.js';
import { FileStore } from '../server/node.js';

// 固定种子仅在测试打乱合成牌墙，生产原型没有随机开局入口。
// Fixed seeds shuffle synthetic test walls only; no random production-launch entry exists.
function syntheticWall(seed = 1) {
  const wall = Array.from({ length: 108 }, (_, index) => index % 27);
  let state = seed >>> 0;
  for (let index = wall.length - 1; index > 0; index--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [wall[index], wall[swapIndex]] = [wall[swapIndex], wall[index]];
  }
  return wall;
}

// 未确认方向在每个测试中显式指定；这个夹具不是线上默认或用户规则声明。
// Every test explicitly supplies undecided direction details; this fixture is neither an online default nor a user-rule claim.
function preparation({ exchange = true, direction = 'clockwise', seed = 1, dealerSeat = 0, endCondition = 'bloodBattle' } = {}) {
  return chengdu.createPreparationGame({
    wall: syntheticWall(seed), dealerSeat,
    options: { endCondition, exchangeThree: exchange },
    scoring: { selfDraw: 'addBase', fanCap: 4 },
    ...(exchange ? { exchangePlan: { direction, clockwiseSeats: [0, 3, 2, 1], sameSuitRequired: true } } : {}),
  });
}

// 完成三张交换但保留定缺未提交状态，供隐私和重连场景复用。
// Complete exchanges while leaving dingque decisions pending for privacy and reconnect scenarios.
function finishExchange(game) {
  let next = game;
  for (const seat of [2, 0, 3, 1]) next = chengdu.applyAction(next, seat, chengdu.getLegalActions(next, seat)[0]);
  return next;
}

test('production start and settlement fail closed regardless of caller approval flags', () => {
  for (const operation of ['createGame', 'settleGame']) {
    const input = { approved: true, force: true, rules: {}, players: [{ score: 123 }] };
    const before = structuredClone(input);
    assert.throws(() => chengdu[operation](input), (error) => {
      assert.ok(error instanceof ChengduRulesPendingError);
      assert.equal(error.code, 'CHENGDU_RULES_PENDING');
      assert.deepEqual(error.gaps, CHENGDU_RULE_GAPS);
      return true;
    });
    assert.deepEqual(input, before);
  }
  assert.throws(() => engineFor({ gameMode: 'chengdu', schemaVersion: 1 }), { code: 'UNSUPPORTED_GAME_VERSION' });
  assert.throws(() => modeForRoom({ gameMode: 'chengdu' }).startRules({ approved: true }), { code: 'BAD_START_OPTIONS' });
});

test('confirmed scoring options require explicit exact types and preserve false-like invalid values', () => {
  for (const selfDraw of ['addBase', 'addFan']) {
    for (const fanCap of [4, 5, 6]) assert.deepEqual(validateChengduScoringOptions({ selfDraw, fanCap }), { selfDraw, fanCap });
  }
  for (const input of [null, [], {}, { selfDraw: 'addBase' }, { fanCap: 4 },
    { selfDraw: 'addBase', fanCap: '4' }, { selfDraw: 'addFan', fanCap: 7 },
    { selfDraw: 'addFan', fanCap: 4, approved: true }]) assert.throws(() => validateChengduScoringOptions(input), TypeError);
  assert.deepEqual([4, 5, 6].map(chengduCapPoints), [8, 16, 32]);
  for (const invalid of [0, 3, 7, '4', null]) assert.throws(() => chengduCapPoints(invalid), TypeError);
});

test('self-draw add-base is after the cap while add-fan is before the cap', () => {
  for (const fanCap of [4, 5, 6]) {
    const cap = chengduCapPoints(fanCap);
    assert.equal(chengduWinPoints(fanCap + 2, true, { selfDraw: 'addBase', fanCap }), cap + 1);
    assert.equal(chengduWinPoints(fanCap + 2, true, { selfDraw: 'addFan', fanCap }), cap);
    assert.equal(chengduWinPoints(1, true, { selfDraw: 'addBase', fanCap }), 2);
    assert.equal(chengduWinPoints(1, true, { selfDraw: 'addFan', fanCap }), 2);
    assert.equal(chengduWinPoints(2, true, { selfDraw: 'addBase', fanCap }), 3);
    assert.equal(chengduWinPoints(2, true, { selfDraw: 'addFan', fanCap }), 4);
    assert.equal(chengduWinPoints(fanCap, false, { selfDraw: 'addBase', fanCap }), cap);
  }
  for (const fan of [0, -1, 1.5, NaN, Infinity, '4']) {
    assert.throws(() => chengduWinPoints(fan, true, { selfDraw: 'addBase', fanCap: 4 }), TypeError);
  }
});

test('exchange cycle always starts clockwise with explicit ordinal and no hidden round counter', () => {
  for (let ordinal = 0; ordinal < 12; ordinal++) {
    assert.equal(chengduExchangeDirection('clockwise', ordinal), CHENGDU_EXCHANGE_CYCLE[ordinal % 3]);
  }
  for (const start of ['opposite', 'counterclockwise']) assert.throws(() => chengduExchangeDirection(start, 0), TypeError);
  for (const invalid of [-1, '0', 1.5, NaN]) assert.throws(() => chengduExchangeDirection('clockwise', invalid), TypeError);
  assert.throws(() => chengduExchangeDirection(undefined, 0), TypeError);
  assert.equal(chengduExchangeRecipient(0, 'clockwise', [0, 3, 2, 1]), 3);
  assert.equal(chengduExchangeRecipient(0, 'counterclockwise', [0, 3, 2, 1]), 1);
  for (const seats of [[0, 1, 2], [0, 1, 2, 2], [0, 1, 2, '3'], null]) {
    assert.throws(() => chengduExchangeRecipient(0, 'clockwise', seats), TypeError);
  }
});

for (const exchange of [false, true]) {
  for (const endCondition of ['firstWin', 'bloodBattle']) {
    test(`deal keeps 108/four-copy budgets for ${endCondition}, exchange ${exchange}`, () => {
      for (let dealerSeat = 0; dealerSeat < 4; dealerSeat++) {
        const game = preparation({ dealerSeat, endCondition, exchange });
        assert.equal(game.wall.length, 55);
        assert.equal(game.phase, exchange ? 'exchange' : 'dingque');
        assert.equal(game.players.length, 4);
        game.players.forEach((player, seat) => assert.equal(player.hand.length, seat === dealerSeat ? 14 : 13));
        assert.equal(chengdu.assertGameInvariants(game), true);
        assert.equal(game.rules.endCondition, endCondition);
        assert.deepEqual(game.players.map((player) => player.score), [0, 0, 0, 0]);
      }
    });
  }
}

test('invalid deals and unconfirmed policy omissions reject without mutating supplied walls', () => {
  const options = { endCondition: 'firstWin', exchangeThree: true };
  const scoring = { selfDraw: 'addBase', fanCap: 4 };
  const wall = syntheticWall();
  const before = [...wall];
  for (const exchangePlan of [undefined, {}, { direction: 'clockwise', clockwiseSeats: [0, 1, 2, 3] },
    { direction: 'clockwise', clockwiseSeats: [0, 1, 2, 3], sameSuitRequired: false }]) {
    assert.throws(() => chengdu.createPreparationGame({ wall, dealerSeat: 0, options, scoring, exchangePlan }));
  }
  assert.deepEqual(wall, before);
  for (const invalidWall of [wall.slice(1), [27, ...wall.slice(1)], Array(108).fill(0), null]) {
    assert.throws(() => chengdu.createPreparationGame({ wall: invalidWall, dealerSeat: 0, options, scoring }));
  }
});

for (const direction of CHENGDU_EXCHANGE_CYCLE) {
  test(`${direction} exchanges are simultaneous, conserve copies and do not depend on response order`, () => {
    const original = preparation({ direction });
    const snapshot = structuredClone(original);
    const actions = original.players.map((player) => chengdu.getLegalActions(original, player.seat)[0]);
    const outcomes = [];
    for (const order of [[0, 1, 2, 3], [3, 1, 0, 2], [2, 3, 1, 0]]) {
      let game = original;
      for (let index = 0; index < order.length; index++) {
        const seat = order[index];
        game = chengdu.applyAction(game, seat, actions[seat]);
        chengdu.assertGameInvariants(game);
        if (index < 3) {
          assert.equal(game.phase, 'exchange');
          assert.deepEqual(game.players, original.players);
          assert.deepEqual(chengdu.getLegalActions(game, seat), []);
        }
      }
      assert.equal(game.phase, 'dingque');
      for (let seat = 0; seat < 4; seat++) {
        const recipient = chengduExchangeRecipient(seat, direction, [0, 3, 2, 1]);
        assert.deepEqual(game.preparation.exchangeReceipts[recipient], { fromSeat: seat, tiles: actions[seat].tiles });
      }
      outcomes.push(game);
    }
    assert.deepEqual(outcomes[0], outcomes[1]);
    assert.deepEqual(outcomes[1], outcomes[2]);
    assert.deepEqual(original, snapshot);
  });
}

test('exchange rejects mixed suits, phantom duplicate copies, extra fields and repeat submissions', () => {
  const game = preparation();
  const before = structuredClone(game);
  const action = chengdu.getLegalActions(game, 0)[0];
  const allActions = chengdu.getLegalActions(game, 0);
  assert.equal(new Set(allActions.map((item) => item.tiles.join(','))).size, allActions.length);
  for (const item of allActions) assert.equal(new Set(item.tiles.map((tile) => Math.floor(tile / 9))).size, 1);
  const missing = Array.from({ length: 27 }, (_, tile) => tile).find((tile) => !game.players[0].hand.includes(tile));
  for (const invalid of [
    { type: 'exchangeThree', tiles: [0, 9, 18] },
    { type: 'exchangeThree', tiles: [missing, missing, missing] },
    { ...action, force: true }, { type: 'discard', tile: 0 }, { type: 'dingque', suit: 'bamboo' },
  ]) assert.throws(() => chengdu.applyAction(game, 0, invalid));
  const next = chengdu.applyAction(game, 0, action);
  assert.throws(() => chengdu.applyAction(next, 0, action));
  assert.deepEqual(game, before);
});

test('mandatory dingque waits for all four decisions then blocks gameplay and scoring', () => {
  for (const exchange of [false, true]) {
    let game = preparation({ exchange });
    if (exchange) game = finishExchange(game);
    for (const seat of [3, 0, 2, 1]) {
      const actions = chengdu.getLegalActions(game, seat);
      assert.deepEqual(actions.map((action) => action.suit), CHENGDU_SUITS);
      game = chengdu.applyAction(game, seat, { type: 'dingque', suit: CHENGDU_SUITS[seat % 3] });
      assert.deepEqual(chengdu.getLegalActions(game, seat), []);
    }
    assert.equal(game.phase, 'rulesPending');
    assert.equal(game.currentSeat, null);
    assert.ok(game.players.every((player) => player.score === 0));
    for (let seat = 0; seat < 4; seat++) assert.deepEqual(chengdu.getLegalActions(game, seat), []);
    assert.throws(() => chengdu.applyAction(game, 0, { type: 'discard', tile: 0 }));
    assert.throws(() => chengdu.settleGame(game), ChengduRulesPendingError);
  }
});

test('private choices and tile identities never leak through opponent, spectator or former-seat views', () => {
  let game = preparation();
  const action = chengdu.getLegalActions(game, 0)[0];
  game = chengdu.applyAction(game, 0, action);
  game.secretFutureField = { hand: [26], token: 'synthetic-secret' };
  game.history.push({ type: 'privateExchange', tiles: action.tiles, text: 'private tile identities' });
  for (const seat of [1, 2, 3]) {
    const view = chengdu.getPlayerView(game, seat);
    assert.equal(view.players[0].hand, undefined);
    assert.equal(view.preparation.myExchange, null);
    assert.equal(view.preparation.exchangeSelections, undefined);
    assert.deepEqual(view.preparation.exchangeSubmittedSeats, [0]);
    assert.equal(view.wall, undefined);
    assert.equal(view.secretFutureField, undefined);
    assert.deepEqual(view.history, []);
  }
  assert.deepEqual(chengdu.getPlayerView(game, 0).preparation.myExchange, action.tiles);
  for (const view of [chengdu.getSpectatorView(game), chengdu.getFormerParticipantView(game, 0)]) {
    assert.ok(view.players.every((player) => player.hand === undefined));
    assert.equal(view.preparation.myExchange, undefined);
    assert.equal(view.preparation.receivedExchange, undefined);
    assert.deepEqual(view.legalActions, []);
  }
  for (const seat of [null, '0', -1, 4, NaN]) assert.throws(() => chengdu.getPlayerView(game, seat), TypeError);
});

test('submitted dingque remains private until all players decide, and returned views are detached', () => {
  let game = preparation({ exchange: false });
  game = chengdu.applyAction(game, 0, { type: 'dingque', suit: 'characters' });
  assert.equal(chengdu.getPlayerView(game, 0).players[0].dingqueSuit, 'characters');
  assert.equal(chengdu.getPlayerView(game, 1).players[0].dingqueSuit, null);
  assert.equal(chengdu.getSpectatorView(game).players[0].dingqueSubmitted, true);
  assert.equal(chengdu.getSpectatorView(game).players[0].dingqueSuit, null);
  for (let seat = 1; seat < 4; seat++) game = chengdu.applyAction(game, seat, { type: 'dingque', suit: 'bamboo' });
  const before = structuredClone(game);
  const view = chengdu.getPlayerView(game, 0);
  assert.equal(view.players[1].dingqueSuit, 'bamboo');
  view.players[0].hand[0] = 100;
  view.rules.selfDraw = 'other';
  view.history.push({ type: 'fake' });
  assert.deepEqual(game, before);
});

// 每一步JSON往返后继续相同动作，保证重连不重发牌、不自动补决定、不重复换牌。
// Round-trip every state through JSON and continue identically, proving reconnect does not redeal, choose or re-exchange.
for (const direction of CHENGDU_EXCHANGE_CYCLE) {
  test(`${direction} JSON reconnect exactly resumes every preparation boundary`, () => {
    let game = preparation({ direction });
    let resumed = JSON.parse(JSON.stringify(game));
    for (const seat of [2, 0, 1, 3, 3, 1, 0, 2]) {
      const action = chengdu.getLegalActions(game, seat)[0];
      assert.deepEqual(chengdu.getPlayerView(resumed, seat), chengdu.getPlayerView(game, seat));
      game = chengdu.applyAction(game, seat, action);
      resumed = chengdu.applyAction(resumed, seat, action);
      resumed = JSON.parse(JSON.stringify(resumed));
      assert.deepEqual(resumed, game);
    }
    assert.equal(resumed.phase, 'rulesPending');
  });
}

test('FileStore restart preserves private preparation without requiring a second room lifecycle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chengdu-preparation-'));
  try {
    const firstStore = new FileStore(directory);
    let game = preparation();
    game = chengdu.applyAction(game, 2, chengdu.getLegalActions(game, 2)[0]);
    const room = { id: 'CDTEST01', revision: 1, gameMode: 'chengdu', game, seats: [] };
    await firstStore.insert(room);
    const restartedStore = new FileStore(directory);
    const restored = await restartedStore.get(room.id);
    assert.deepEqual(restored.game, game);
    assert.deepEqual(chengdu.getPlayerView(restored.game, 2), chengdu.getPlayerView(game, 2));
    assert.deepEqual(chengdu.getLegalActions(restored.game, 2), []);
    assert.throws(() => engineFor(restored.game), { code: 'UNSUPPORTED_GAME_VERSION' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('conservation rejects corrupt copies, phases, receipts, seats and nonzero prototype scores', () => {
  const game = preparation();
  const corruptions = [
    (copy) => copy.wall.pop(),
    (copy) => { copy.wall[0] = 27; },
    (copy) => { copy.wall[0] = copy.wall.find((tile) => tile !== copy.wall[0]); },
    (copy) => { copy.players[0].score = 1; },
    (copy) => { copy.players[0].seat = 1; },
    (copy) => { copy.phase = 'turn'; },
    (copy) => { copy.currentSeat = 0; },
    (copy) => { copy.phase = 'dingque'; },
    (copy) => { copy.players[0].dingqueSuit = 'dots'; },
    (copy) => { copy.preparation.exchangeReceipts[0] = { fromSeat: 1, tiles: [0, 0, 0] }; },
  ];
  for (const corrupt of corruptions) {
    const copy = structuredClone(game);
    corrupt(copy);
    assert.throws(() => chengdu.assertGameInvariants(copy));
  }
});

for (let seed = 0; seed < 24; seed++) {
  test(`synthetic seed ${seed} maintains four-copy conservation after every preparation action`, () => {
    let game = preparation({ seed, dealerSeat: seed % 4, direction: CHENGDU_EXCHANGE_CYCLE[seed % 3] });
    for (let actionIndex = 0; actionIndex < 8; actionIndex++) {
      const seat = actionIndex % 4;
      const legal = chengdu.getLegalActions(game, seat);
      game = chengdu.applyAction(game, seat, legal[(seed + actionIndex) % legal.length]);
      assert.equal(chengdu.assertGameInvariants(game), true);
      assert.equal(game.players.reduce((sum, player) => sum + player.score, 0), 0);
    }
    assert.equal(game.phase, 'rulesPending');
  });
}

// 牌型结构与结算资格严格分开：三门完整结构可以成立，但定缺未清不能成为有效胡牌。
// Structural shape is distinct from eligibility: a three-suit shape may complete but still violate dingque.
test('structural shapes support three suits without borrowing Flower copy or special-win rules', () => {
  const standard = [0, 1, 2, 9, 10, 11, 18, 19, 20, 24, 24, 24, 26, 26];
  assert.equal(inspectChengduHand(standard).standard, true);
  assert.equal(inspectChengduHand(standard).pureSuit, false);
  assert.equal(hasDingqueTiles(standard, [], 'bamboo'), true);
  const pure = [18, 19, 20, 18, 19, 20, 21, 22, 23, 24, 24, 24, 26, 26];
  assert.equal(inspectChengduHand(pure).standard, true);
  assert.equal(inspectChengduHand(pure).pureSuit, true);
  assert.equal(inspectChengduHand([0, 0, 0, 9, 9, 9, 10, 10, 10, 18, 18, 18, 26, 26]).allTriplets, true);
  assert.equal(inspectChengduHand([0, 0, 0, 0, 9, 9, 10, 10, 18, 18, 19, 19, 26, 26]).sevenPairs, true);
  assert.equal(inspectChengduHand([0, 0, 0, 0, 9, 9, 10, 10, 18, 18, 19, 19, 26, 26]).roots, 1);
});

test('structural checks reject cross-suit sequences, impossible copies, bad melds and wrong sizes', () => {
  assert.equal(inspectChengduHand([7, 8, 9, 0, 1, 2, 12, 13, 14, 21, 22, 23, 26, 26]).standard, false);
  for (const hand of [[0, 0, 0, 0, 0, 9, 9, 10, 10, 18, 18, 19, 19, 26], Array(14).fill(27), null, []]) {
    const shape = inspectChengduHand(hand);
    assert.equal(shape.standard, false);
    assert.equal(shape.sevenPairs, false);
  }
  const concealed = [9, 10, 11, 18, 19, 20, 24, 24, 24, 26, 26];
  assert.equal(inspectChengduHand(concealed, [{ type: 'anGang', tile: 0, tiles: [0, 0, 0, 0] }]).standard, true);
  assert.equal(inspectChengduHand(concealed, [{ type: 'chi', tile: 0, tiles: [0, 1, 2] }]).standard, false);
  assert.equal(inspectChengduHand(concealed, [{ type: 'peng', tile: 0, tiles: [0, 0, 1] }]).standard, false);
  assert.equal(inspectChengduHand(concealed, [{ type: 'anGang', tile: 24, tiles: [24, 24, 24, 24] }]).standard, false);
});

test('structural waits use only own tiles, reject dingque and do not promise draw-settlement values', () => {
  const hand = [9, 10, 11, 12, 13, 14, 18, 19, 20, 24, 24, 24, 26];
  const before = [...hand];
  assert.deepEqual(getChengduStructuralWaits(hand, [], { dingqueSuit: 'bamboo', allowSevenPairs: true }), [25, 26]);
  assert.deepEqual(getChengduStructuralWaits(hand, [], { dingqueSuit: 'dots', allowSevenPairs: true }), []);
  assert.throws(() => getChengduStructuralWaits(hand, [], { dingqueSuit: 'bamboo' }), TypeError);
  assert.deepEqual(hand, before);
  assert.equal(hasDingqueTiles([18], [{ type: 'peng', tile: 9, tiles: [9, 9, 9] }], 'dots'), true);
});

// 强制先打缺门不保证牌墙耗尽前清空；最后一个回合只能移除一张，不能凭规则删除剩余缺门。
// Forced missing-suit discards do not guarantee clearance before exhaustion; the final turn removes one tile, not every missing tile.
test('mandatory dingque discards still allow remaining missing-suit tiles at wall exhaustion', () => {
  const hand = [0, 1, 2, 3, 4, 5, 9, 10, 11, 18, 19, 20, 26];
  const lastWallTile = 25;
  const drawnHand = [...hand, lastWallTile];
  assert.deepEqual(getChengduDiscardTiles(drawnHand, 'bamboo'), [0, 1, 2, 3, 4, 5]);
  const chosen = getChengduDiscardTiles(drawnHand, 'bamboo')[0];
  drawnHand.splice(drawnHand.indexOf(chosen), 1);
  assert.equal(drawnHand.length, 13);
  assert.equal(hasDingqueTiles(drawnHand, [], 'bamboo'), true);
  assert.deepEqual(getChengduStructuralWaits(drawnHand, [], { dingqueSuit: 'bamboo', allowSevenPairs: true }), []);
  assert.deepEqual(getChengduDiscardTiles([9, 9, 18, 26], 'bamboo'), [9, 18, 26]);
});

// 已完成交换仍处准备阶段，篡改收件牌后即使全局牌数不变也要拒绝。
// After exchange, preparation still holds every received tile; reject a forged hand swap even if global counts remain intact.
test('completed exchange receipts must correspond to copies still held by the recipient', () => {
  const game = finishExchange(preparation());
  const copy = structuredClone(game);
  const tile = copy.preparation.exchangeReceipts[0].tiles[0];
  const alternateIndex = copy.wall.findIndex((item) => item !== tile);
  for (let handIndex = 0; handIndex < copy.players[0].hand.length; handIndex++) {
    if (copy.players[0].hand[handIndex] !== tile) continue;
    [copy.players[0].hand[handIndex], copy.wall[alternateIndex]] =
      [copy.wall[alternateIndex], copy.players[0].hand[handIndex]];
    break;
  }
  // 如果该牌在原手中仍有其他副本，移走所有副本直到确实少于收件引用需要的数量。
  // If original-hand duplicates remain, move them too until the receipt requires more copies than are held.
  const needed = copy.preparation.exchangeReceipts[0].tiles.filter((item) => item === tile).length;
  while (copy.players[0].hand.filter((item) => item === tile).length >= needed) {
    const handIndex = copy.players[0].hand.indexOf(tile);
    const wallIndex = copy.wall.findIndex((item) => item !== tile);
    [copy.players[0].hand[handIndex], copy.wall[wallIndex]] =
      [copy.wall[wallIndex], copy.players[0].hand[handIndex]];
  }
  assert.throws(() => chengdu.assertGameInvariants(copy), /换入牌不在收件者手中/);
  assert.equal(chengdu.assertGameInvariants(game), true);
});

// 关闭换牌的局不能消耗顺对逆轮回；相同输入用于重连或 CAS 重试时结果不变。
// Disabled rounds do not consume the cycle; identical inputs remain deterministic for reconnects and CAS retries.
test('exchange round planning advances only enabled games and never mutates reconnect inputs', () => {
  let exchangeOrdinal = 0;
  const directions = [];
  for (const exchangeThree of [false, true, false, true, true, false, true]) {
    const input = { exchangeThree, exchangeOrdinal, clockwiseSeats: [0, 3, 2, 1] };
    const before = structuredClone(input);
    const plan = planChengduExchangeRound(input);
    assert.deepEqual(planChengduExchangeRound(input), plan);
    assert.deepEqual(input, before);
    directions.push(plan.exchangePlan?.direction ?? null);
    exchangeOrdinal = plan.nextExchangeOrdinal;
  }
  assert.deepEqual(directions, [null, 'clockwise', null, 'opposite', 'counterclockwise', null, 'clockwise']);
  assert.equal(exchangeOrdinal, 4);
  for (const exchangeOrdinal of [-1, 0.5, '0', undefined, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => planChengduExchangeRound({ exchangeThree: true, exchangeOrdinal, clockwiseSeats: [0, 1, 2, 3] }), TypeError);
  }
  assert.throws(() => planChengduExchangeRound({ exchangeThree: 'false', exchangeOrdinal: 0 }), TypeError);
});
