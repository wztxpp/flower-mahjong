/**
 * 成都回合开发引擎验收：全部合成牌与显式实验策略，不把夹具值当作用户已确认规则。
 * Chengdu turn-prototype acceptance uses synthetic tiles and explicit experimental policies, not presumed user-approved defaults.
 * 生产注册不变；这些测试不访问真实房间、数据库服务或发布端点。
 * Production registration is unchanged; no real rooms, hosted databases or deployment endpoints are accessed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as engine from '../shared/chengdu-play.js';
import { validateChengduPlayPolicy } from '../shared/chengdu-play-policy.js';
import { buildChengduDrawSettlement, classifyChengduDrawPlayers } from '../shared/chengdu-settlement.js';
import { calculateChengduScore } from '../shared/chengdu-scoring.js';
import { CHENGDU_SUITS } from '../shared/chengdu-hand.js';
import { FileStore } from '../server/node.js';
import { MemoryStore } from '../server/store.js';
import { engineFor } from '../server/game-engines.js';

// 这里每一项仅是明确的测试策略；上线仍须用户确认，模块本身没有这组默认值。
// Every value here is an explicit test policy; production still requires confirmation and the module has no such defaults.
const POLICY = {
  clockwiseSeats: [0, 1, 2, 3], turnDirection: 'clockwise', simultaneousWins: 'all',
  afterDiscardWin: 'singleWinnerNextMultipleDiscarder', passedWins: 'untilOwnDraw', pureSuitStacking: 'addTwo',
  claimsRequireClearDingque: false, kongsAfterPeng: 'afterDiscard',
  kongPoints: { anGang: 2, mingGang: 2, buGang: 1 },
  drawReadyCheck: 'notReadyPaysReady', flowerPigPaysReadyCheck: false,
  kongRefund: 'notReadyOrFlowerPig', firstWinDrawSettlement: 'sameAsBloodBattle',
};
const WAIT = [9, 10, 11, 12, 13, 14, 18, 19, 20, 21, 22, 23, 26];
const SOURCE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17, 26];

// 固定洗牌只用于测试；构造器仍要求调用方明确提供108张真实预算的牌墙。
// Seeded shuffling is test-only; constructors still require an explicit 108-tile physical budget.
function wall(seed = 1) {
  const tiles = Array.from({ length: 108 }, (_, index) => index % 27);
  let state = seed >>> 0;
  for (let index = 107; index > 0; index--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const other = state % (index + 1);
    [tiles[index], tiles[other]] = [tiles[other], tiles[index]];
  }
  return tiles;
}

// 从真实准备动作进入回合，覆盖最后定缺不会重新发牌或增加额外版本。
// Enter turns through real preparation actions, ensuring final dingque neither redeals nor adds a second revision.
function start({ seed = 1, exchange = false, endCondition = 'bloodBattle', fanCap = 4, policy = {} } = {}) {
  let game = engine.createDevelopmentGame({
    wall: wall(seed), dealerSeat: 0, options: { endCondition, exchangeThree: exchange },
    scoring: { selfDraw: 'addBase', fanCap },
    ...(exchange ? { exchangePlan: { direction: 'clockwise', clockwiseSeats: [0, 1, 2, 3], sameSuitRequired: true } } : {}),
  }, { ...POLICY, ...policy });
  if (exchange) for (const seat of [3, 1, 0, 2]) game = engine.applyAction(game, seat, engine.getLegalActions(game, seat)[0]);
  for (let seat = 0; seat < 4; seat++) game = engine.applyAction(game, seat, { type: 'dingque', suit: CHENGDU_SUITS[seat % 3] });
  return game;
}

// 中局夹具逐区扣除4张配额；缩短牌墙的牌放入公开弃牌区，不删掉实体牌来凑场景。
// Debit every physical zone from four-copy quotas; shortened-wall tiles enter public discards rather than disappearing.
function fixture({ hands = {}, melds = {}, suits = {}, currentSeat = 0, head = [], wallCount,
  discards = [], wins = {}, scores = {}, policy = {}, endCondition = 'bloodBattle', fanCap = 4 } = {}) {
  const game = start({ policy, endCondition, fanCap });
  const counts = Array(27).fill(4);
  const debit = (tile) => assert.ok(Number.isInteger(tile) && --counts[tile] >= 0, `Exceeded tile ${tile}`);
  game.currentSeat = currentSeat;
  game.history = [];
  game.discards = structuredClone(discards);
  for (const discard of game.discards) if (!discard.claimed) debit(discard.tile);
  for (let seat = 0; seat < 4; seat++) {
    const player = game.players[seat];
    player.melds = structuredClone(melds[seat] ?? []);
    player.hand = hands[seat] ? [...hands[seat]] : [];
    player.dingqueSuit = suits[seat] ?? 'bamboo';
    player.won = wins[seat] ? structuredClone(wins[seat]) : null;
    player.score = scores[seat] ?? 0;
    [...player.hand, ...player.melds.flatMap((meld) => meld.tiles)].forEach(debit);
  }
  head.forEach(debit);
  for (let seat = 0; seat < 4; seat++) {
    const player = game.players[seat];
    const needed = 13 - player.melds.length * 3 + (seat === currentSeat || player.won?.source === 'selfDraw' ? 1 : 0);
    if (!hands[seat]) {
      // 优先分散牌，避免默认补牌制造一手四张刻子；剩余每张仍从同一预算扣除。
      // Prefer scattered identities instead of accidentally filling default hands with triplets, still debiting the same budget.
      while (player.hand.length < needed) {
        const available = counts.findIndex((count, tile) => count > 0 && !player.hand.includes(tile));
        const tile = available >= 0 ? available : counts.findIndex((count) => count > 0);
        player.hand.push(tile);
        debit(tile);
      }
      player.dingqueSuit = CHENGDU_SUITS[Math.floor(player.hand[0] / 9)];
    }
    player.hand.sort((left, right) => left - right);
  }
  const remaining = counts.flatMap((count, tile) => Array(count).fill(tile));
  if (wallCount !== undefined) {
    assert.ok(wallCount >= head.length);
    const extra = remaining.splice(wallCount - head.length);
    game.discards.push(...extra.map((tile) => ({ seat: 0, tile, claimed: false, winning: false, source: 'discard' })));
  }
  game.wall = [...head, ...remaining];
  game.lastDraw = { seat: currentSeat, tile: game.players[currentSeat].hand.at(-1), source: 'normal' };
  engine.assertGameInvariants(game);
  return game;
}

// 为未指定的响应者明确选过，只有真正收齐窗口才会推进。
// Explicitly pass for unspecified responders, allowing advancement only once the real window is complete.
function respond(game, actions = {}) {
  let next = game;
  const seats = [...game.claim.eligibleSeats];
  for (const seat of seats) next = engine.applyAction(next, seat, actions[seat] ?? { type: 'pass' });
  return next;
}

// 已知规则变更不等于放开模式，开发策略遗漏或未知键都必须拒绝。
// Confirmed rules do not enable the mode; missing policy choices and unknown keys still reject.
test('development policies require explicit values and Chengdu remains unregistered', () => {
  assert.throws(() => validateChengduPlayPolicy({}), TypeError);
  assert.throws(() => validateChengduPlayPolicy({ ...POLICY, approved: true }), TypeError);
  assert.throws(() => validateChengduPlayPolicy({ ...POLICY, kongPoints: { anGang: -1, mingGang: 2, buGang: 1 } }), TypeError);
  const game = start({ exchange: true });
  assert.equal(game.phase, 'turn');
  assert.equal(game.revision, 8);
  assert.equal(game.wall.length, 55);
  assert.throws(() => engineFor(game), { code: 'UNSUPPORTED_GAME_VERSION' });
});

test('forced missing-suit discard denies off-suit play, win, claims and same-seat invalid actions', () => {
  const game = fixture({ hands: { 0: SOURCE }, suits: { 0: 'characters' } });
  assert.deepEqual(engine.getLegalActions(game, 0), [{ type: 'discard', tile: 26 }]);
  const before = structuredClone(game);
  for (const action of [{ type: 'discard', tile: 0 }, { type: 'hu' }, { type: 'chi', tile: 26 },
    { type: 'discard', tile: 26, score: 100 }, { type: 'addGang', tile: 26 }]) assert.throws(() => engine.applyAction(game, 0, action));
  assert.throws(() => engine.applyAction(game, 1, { type: 'discard', tile: 26 }));
  assert.deepEqual(game, before);
});

test('self-draw posts one zero-sum batch and first-win mode ends without drawing another tile', () => {
  const game = fixture({ hands: { 0: [...WAIT, 26] }, suits: { 0: 'bamboo' }, endCondition: 'firstWin' });
  const next = engine.applyAction(game, 0, { type: 'hu' });
  assert.equal(next.phase, 'finished');
  assert.equal(next.finishReason, 'firstWin');
  assert.equal(engine.dealerForNextGame(next), 0);
  assert.deepEqual(next.players.map((player) => player.score), [6, -2, -2, -2]);
  assert.equal(next.wall.length, game.wall.length);
  assert.equal(next.players[0].won.source, 'selfDraw');
  assert.throws(() => engine.applyAction(next, 0, { type: 'hu' }));
  assert.equal(engine.assertGameInvariants(next), true);
});

test('multi-win discard waits for every response and keeps one physical discard without order dependence', () => {
  const initial = fixture({ hands: { 0: SOURCE, 1: WAIT, 2: WAIT }, suits: { 0: 'characters', 1: 'bamboo', 2: 'bamboo' },
    endCondition: 'firstWin' });
  const claimed = engine.applyAction(initial, 0, { type: 'discard', tile: 26 });
  assert.ok(claimed.claim.eligibleSeats.includes(1) && claimed.claim.eligibleSeats.includes(2));
  const first = engine.applyAction(claimed, 2, { type: 'hu' });
  assert.equal(first.phase, 'claim');
  assert.ok(first.players.every((player) => player.score === 0));
  const outputs = [];
  for (const order of [[1, 2], [2, 1]]) {
    let game = claimed;
    for (const seat of order) game = engine.applyAction(game, seat, { type: 'hu' });
    if (game.phase === 'claim') game = respond(game);
    outputs.push(game);
  }
  assert.deepEqual(outputs[0], outputs[1]);
  assert.deepEqual(outputs[0].players.map((player) => player.score), [-2, 1, 1, 0]);
  assert.equal(engine.dealerForNextGame(outputs[0]), 0);
  assert.equal(outputs[0].discards.at(-1).winning, true);
  assert.equal(outputs[0].discards.at(-1).claimed, false);
  assert.equal(engine.assertGameInvariants(outputs[0]), true);
});

test('confirmed multi-win and passed-win rules reject contradictory draft policies', () => {
  assert.throws(() => validateChengduPlayPolicy({ ...POLICY, simultaneousWins: 'nearest' }), TypeError);
  assert.throws(() => validateChengduPlayPolicy({ ...POLICY, passedWins: 'none' }), TypeError);
});

test('peng does not draw and required post-peng discard prevents immediate supplemental kong', () => {
  const target = [9, 10, 11, 12, 13, 14, 18, 19, 20, 21, 26, 26, 26];
  let game = fixture({ hands: { 0: SOURCE, 1: target }, suits: { 0: 'characters', 1: 'bamboo' } });
  game = engine.applyAction(game, 0, { type: 'discard', tile: 26 });
  const wallCount = game.wall.length;
  game = respond(game, { 1: { type: 'peng', tile: 26 } });
  assert.equal(game.currentSeat, 1);
  assert.equal(game.wall.length, wallCount);
  assert.equal(game.players[1].mustDiscardAfterPeng, true);
  assert.ok(engine.getLegalActions(game, 1).every((action) => action.type === 'discard'));
  assert.throws(() => engine.applyAction(game, 1, { type: 'buGang', tile: 26 }));
  assert.equal(game.players[1].hand.length, 11);
});

test('exposed kong charges only the discarder and draws one replacement tile', () => {
  const target = [9, 10, 11, 12, 13, 14, 18, 19, 20, 21, 26, 26, 26];
  let game = fixture({ hands: { 0: SOURCE, 1: target }, suits: { 0: 'characters', 1: 'bamboo' }, head: [25] });
  game = engine.applyAction(game, 0, { type: 'discard', tile: 26 });
  const wallCount = game.wall.length;
  game = respond(game, { 1: { type: 'mingGang', tile: 26 } });
  assert.deepEqual(game.players.map((player) => player.score), [-2, 2, 0, 0]);
  assert.equal(game.wall.length, wallCount - 1);
  assert.equal(game.lastDraw.source, 'replacement');
  assert.equal(game.lastDraw.tile, 25);
  assert.equal(game.players[1].melds[0].tiles.length, 4);
  assert.equal(game.discards.at(-1).claimed, true);
});

test('concealed kong keeps its tile private, records a refundable ledger and conserves copies', () => {
  const hand = [9, 9, 9, 9, 10, 11, 12, 18, 19, 20, 21, 22, 23, 26];
  const initial = fixture({ hands: { 0: hand }, suits: { 0: 'bamboo' }, head: [25] });
  const game = engine.applyAction(initial, 0, { type: 'anGang', tile: 9 });
  assert.deepEqual(game.players.map((player) => player.score), [6, -2, -2, -2]);
  assert.equal(game.kongLedger.length, 1);
  assert.equal(game.players[0].melds[0].type, 'anGang');
  assert.equal(engine.getPlayerView(game, 0).players[0].melds[0].tile, 9);
  assert.equal(engine.getPlayerView(game, 1).players[0].melds[0].tile, null);
  assert.equal(engine.publicEvents(game).find((event) => event.type === 'anGang').tile, null);
  assert.equal(engine.publicEvents(game, 0).find((event) => event.type === 'anGang').tile, 9);
  assert.equal(engine.assertGameInvariants(game), true);
});

// 抢杠阶段第四张仍在提杠者手里，只有判定成功后才移动，不提前收杠分。
// During rob-kong the fourth tile remains held; transfer it only after resolution, never charging a kong early.
function robFixture(endCondition = 'firstWin') {
  return fixture({
    hands: { 0: [9, 10, 11, 12, 13, 14, 18, 19, 20, 21, 26],
      1: [9, 10, 11, 12, 13, 14, 18, 19, 20, 21, 21, 24, 25] },
    melds: { 0: [{ type: 'peng', tile: 26, tiles: [26, 26, 26], fromSeat: 2 }] },
    suits: { 0: 'bamboo', 1: 'bamboo' }, endCondition, head: [22],
  });
}

test('robbed supplemental kong retains original peng, moves only one tile and charges no kong', () => {
  const initial = robFixture();
  const offered = engine.applyAction(initial, 0, { type: 'buGang', tile: 26 });
  assert.equal(offered.phase, 'claim');
  assert.equal(offered.players[0].melds[0].type, 'peng');
  assert.ok(offered.players[0].hand.includes(26));
  assert.equal(offered.kongLedger.length, 0);
  assert.ok(offered.players.every((player) => player.score === 0));
  const game = respond(offered, { 1: { type: 'hu' } });
  assert.equal(game.phase, 'finished');
  assert.equal(game.players[0].melds[0].type, 'peng');
  assert.equal(game.players[0].hand.includes(26), false);
  assert.equal(game.discards.at(-1).source, 'robKong');
  assert.equal(game.kongLedger.length, 0);
  assert.deepEqual(game.players.map((player) => player.score), [-1, 1, 0, 0]);
  assert.equal(game.wall.length, initial.wall.length);
});

test('passed rob-kong commits the upgrade once, charges active opponents and replaces one tile', () => {
  const initial = robFixture('bloodBattle');
  let game = engine.applyAction(initial, 0, { type: 'buGang', tile: 26 });
  game = respond(game);
  assert.equal(game.phase, 'turn');
  assert.equal(game.players[0].melds[0].type, 'buGang');
  assert.equal(game.kongLedger.length, 1);
  assert.deepEqual(game.players.map((player) => player.score), [3, -1, -1, -1]);
  assert.equal(game.wall.length, initial.wall.length - 1);
  assert.equal(game.lastDraw.tile, 22);
  assert.equal(game.players[1].passedWin, true);
  assert.throws(() => engine.applyAction(game, 0, { type: 'buGang', tile: 26 }));
});

test('third blood-battle winner ends immediately and previously retired winners pay nothing', () => {
  const score = calculateChengduScore([...WAIT, 26], [], 'bamboo', { selfDraw: 'addBase', fanCap: 4 });
  const won = { source: 'discard', tile: 26, fromSeat: 3, score };
  const hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 18, 19, 20, 25, 25];
  const initial = fixture({ currentSeat: 2, hands: { 0: WAIT, 1: WAIT, 2: hand },
    suits: { 0: 'bamboo', 1: 'bamboo', 2: 'dots' }, wins: { 0: won, 1: won },
    scores: { 0: 1, 1: 1, 3: -2 }, discards: [{ seat: 3, tile: 26, claimed: false, winning: true, source: 'discard' }] });
  const game = engine.applyAction(initial, 2, { type: 'hu' });
  assert.equal(game.finishReason, 'threeWinners');
  assert.equal(game.wall.length, initial.wall.length);
  assert.deepEqual(game.players.map((player) => player.score), [1, 1, 2, -4]);
  for (let seat = 0; seat < 4; seat++) assert.deepEqual(engine.getLegalActions(game, seat), []);
});

test('pending responses, concealed hands, wall and passed-win locks stay out of other audiences', () => {
  const initial = fixture({ hands: { 0: SOURCE, 1: WAIT, 2: WAIT }, suits: { 0: 'characters', 1: 'bamboo', 2: 'bamboo' } });
  let game = engine.applyAction(initial, 0, { type: 'discard', tile: 26 });
  game = engine.applyAction(game, 1, { type: 'pass' });
  game.secretFutureField = { private: 'synthetic' };
  game.history.push({ type: 'privateDiagnostic', tiles: WAIT, text: 'hidden' });
  const spectator = engine.getSpectatorView(game);
  assert.equal(spectator.wall, undefined);
  assert.equal(spectator.secretFutureField, undefined);
  assert.equal(spectator.claim.responses, undefined);
  assert.equal(spectator.claim.options, undefined);
  assert.equal(spectator.claim.eligibleSeats, undefined);
  assert.ok(spectator.players.every((player) => player.hand === undefined && player.passedWin === undefined));
  assert.deepEqual(spectator.legalActions, []);
  assert.deepEqual(spectator.waitTiles, []);
  assert.deepEqual(engine.getFormerParticipantView(game, 1), spectator);
  const own = engine.getPlayerView(game, 1);
  assert.deepEqual(own.players[1].hand, WAIT);
  assert.equal(own.claim.hasResponded, true);
  own.players[1].hand[0] = 100;
  assert.deepEqual(game.players[1].hand, WAIT);
});

test('FileStore restart preserves a partly answered rob/claim window and CAS commits it only once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chengdu-play-'));
  try {
    let game = fixture({ hands: { 0: SOURCE, 1: WAIT, 2: WAIT }, suits: { 0: 'characters', 1: 'bamboo', 2: 'bamboo' }, endCondition: 'firstWin' });
    game = engine.applyAction(game, 0, { type: 'discard', tile: 26 });
    game = engine.applyAction(game, 2, { type: 'hu' });
    const first = new FileStore(directory);
    await first.insert({ id: 'CDPLAY01', revision: 10, game });
    const restarted = new FileStore(directory);
    const restored = await restarted.get('CDPLAY01');
    assert.deepEqual(restored.game, game);
    assert.deepEqual(engine.getLegalActions(restored.game, 2), []);
    assert.throws(() => engine.applyAction(restored.game, 2, { type: 'hu' }));
    const finished = engine.applyAction(restored.game, 1, { type: 'hu' });
    const store = new MemoryStore([restored]);
    const updates = await Promise.all([
      store.compareAndSwap({ ...restored, game: finished, revision: 11 }, 10),
      store.compareAndSwap({ ...restored, game: finished, revision: 11 }, 10),
    ]);
    assert.deepEqual(updates.sort(), [false, true]);
    assert.deepEqual((await store.get(restored.id)).game.players.map((player) => player.score), [-2, 1, 1, 0]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// 花猪按最新修正固定赔分，收款人不需听牌且可以已经胡；花猪之间不赔。
// Latest fixed missing-suit penalties pay non-ready and already-won recipients too, excluding other missing-suit players.
for (const fanCap of [4, 5, 6]) {
  test(`flower-pig penalty is min(16, cap) to every non-pig at cap ${fanCap}`, () => {
    const game = fixture({ hands: { 0: SOURCE, 1: WAIT }, suits: { 0: 'characters', 1: 'bamboo' }, fanCap });
    // 准备流局计划的手数应是13，先在测试副本移出当前位多的一张并放入弃牌区。
    // Draw plans expect thirteen structural tiles; move the current extra into discards in this synthetic snapshot.
    const tile = game.players[0].hand.pop();
    game.discards.push({ seat: 0, tile, claimed: false, winning: false, source: 'discard' });
    game.players[0].dingqueSuit = 'bamboo';
    const plan = buildChengduDrawSettlement(game);
    const classified = classifyChengduDrawPlayers(game);
    const pigs = classified.filter((player) => player.flowerPig).map((player) => player.seat);
    const recipients = classified.filter((player) => !player.flowerPig).map((player) => player.seat);
    assert.ok(pigs.length > 1);
    assert.ok(recipients.includes(1));
    const transfers = plan.payments.filter((payment) => payment.reason === 'flowerPig');
    assert.equal(transfers.length, pigs.length * recipients.length);
    for (const transfer of transfers) {
      assert.ok(pigs.includes(transfer.from));
      assert.ok(recipients.includes(transfer.to));
      assert.equal(transfer.points, fanCap === 4 ? 8 : 16);
    }
  });
}

for (let seed = 0; seed < 24; seed++) {
  test(`seed ${seed} plays to a terminal boundary with immutable JSON replay and conserved tiles/scores`, () => {
    let game = start({ seed, exchange: seed % 2 === 0, policy: { turnDirection: seed % 3 === 0 ? 'counterclockwise' : 'clockwise' } });
    let replay = JSON.parse(JSON.stringify(game));
    let count = 0;
    while (!['finished', 'settlementPending'].includes(game.phase) && count < 600) {
      const choices = [];
      for (let seat = 0; seat < 4; seat++) for (const action of engine.getLegalActions(game, seat)) choices.push({ seat, action });
      const selected = choices.find(({ action }) => action.type === 'hu') ??
        choices.find(({ action }) => action.type.endsWith('Gang')) ??
        choices.find(({ action }) => action.type === 'peng') ?? choices[(seed + count) % choices.length];
      assert.ok(selected, `No action at ${count}/${game.phase}`);
      const before = structuredClone(game);
      const original = game;
      game = engine.applyAction(game, selected.seat, selected.action);
      replay = engine.applyAction(replay, selected.seat, selected.action);
      replay = JSON.parse(JSON.stringify(replay));
      assert.deepEqual(original, before);
      assert.deepEqual(replay, game);
      engine.assertGameInvariants(game);
      assert.equal(game.players.reduce((sum, player) => sum + player.score, 0), 0);
      count++;
    }
    assert.equal(game.phase, 'finished');
    assert.ok(count > 10 && count < 600);
    if (game.finishReason === 'wallExhausted') assert.deepEqual(engine.settleDevelopmentDraw(game), game);
  });
}

const NOT_READY = [9, 10, 12, 13, 15, 16, 18, 19, 21, 22, 24, 25, 26];

// 只剩一次缺门出牌，墙已经耗尽；其余实体在弃牌区，下一次自动摸牌触发真实流局路径。
// One forced discard remains with an exhausted wall; all other copies are in discards and the next draw triggers real settlement.
function exhaustedFixture(policy = {}, endCondition = 'bloodBattle') {
  return fixture({ hands: { 0: [...NOT_READY, 0], 1: WAIT, 2: NOT_READY },
    suits: { 0: 'bamboo', 1: 'bamboo', 2: 'bamboo' }, wallCount: 0, policy, endCondition });
}

test('actual exhausted-wall transition applies flower-pig and highest-ready payments once', () => {
  const initial = exhaustedFixture();
  const game = engine.applyAction(initial, 0, { type: 'discard', tile: 0 });
  assert.equal(game.phase, 'finished');
  assert.equal(game.finishReason, 'wallExhausted');
  assert.equal(game.drawSettlement.status, 'settled');
  assert.deepEqual(game.players.map((player) => player.score), [7, 10, 7, -24]);
  assert.equal(game.drawSettlement.payments.filter((payment) => payment.reason === 'notReady').length, 2);
  assert.deepEqual(engine.settleDevelopmentDraw(game), game);
  assert.equal(engine.dealerForNextGame(game), initial.dealerSeat);
});

test('confirmed first-win exhausted draws use the same flower-pig and highest-ready settlement', () => {
  const initial = exhaustedFixture({}, 'firstWin');
  const game = engine.applyAction(initial, 0, { type: 'discard', tile: 0 });
  const bloodBattle = engine.applyAction(exhaustedFixture(), 0, { type: 'discard', tile: 0 });
  assert.equal(game.phase, 'finished');
  assert.equal(game.finishReason, 'wallExhausted');
  assert.deepEqual(game.drawSettlement, bloodBattle.drawSettlement);
  assert.deepEqual(game.players.map((player) => player.score), [7, 10, 7, -24]);
  assert.equal(game.history.filter((event) => event.type === 'drawSettlement').length, 1);
  for (let seat = 0; seat < 4; seat++) assert.deepEqual(engine.getLegalActions(game, seat), []);
  assert.deepEqual(engine.settleDevelopmentDraw(game), game);
  assert.equal(engine.dealerForNextGame(game), initial.dealerSeat);
});

// 此合成账本代表之前真实收到的一次暗杠；牌组和分数同时存在，不能只伪造待退金额。
// This synthetic ledger represents a previously received concealed kong, including its actual meld and balances.
function refundableFixture(kongRefund, firstWinDrawSettlement = 'sameAsBloodBattle', endCondition = 'bloodBattle') {
  const remaining = [9, 10, 12, 13, 15, 16, 18, 19, 21, 26];
  const game = fixture({ hands: { 0: [...remaining, 0], 1: WAIT, 2: NOT_READY },
    melds: { 0: [{ type: 'anGang', tile: 17, tiles: [17, 17, 17, 17], fromSeat: null }] },
    suits: { 0: 'bamboo', 1: 'bamboo', 2: 'bamboo' }, scores: { 0: 6, 1: -2, 2: -2, 3: -2 },
    wallCount: 0, policy: { kongRefund, firstWinDrawSettlement }, endCondition });
  game.kongLedger.push({ id: 0, seat: 0, type: 'anGang', tile: 17, refunded: false,
    payments: [1, 2, 3].map((from) => ({ from, to: 0, points: 2, reason: 'anGang' })) });
  game.history.push({ type: 'anGang', seat: 0, tile: 17, kongId: 0, payments: structuredClone(game.kongLedger[0].payments) });
  engine.assertGameInvariants(game);
  return game;
}

test('explicit refund policy returns each original kong payment once, separately from flower-pig penalties', () => {
  const initial = refundableFixture('notReadyOrFlowerPig');
  const game = engine.applyAction(initial, 0, { type: 'discard', tile: 0 });
  assert.equal(game.phase, 'finished');
  assert.equal(game.kongLedger[0].refunded, true);
  assert.deepEqual(game.drawSettlement.refundIds, [0]);
  const refunds = game.drawSettlement.payments.filter((payment) => payment.reason === 'kongRefund');
  assert.deepEqual(refunds, [1, 2, 3].map((to) => ({ from: 0, to, points: 2, reason: 'kongRefund', kongId: 0 })));
  assert.equal(game.drawSettlement.payments.filter((payment) => payment.reason === 'flowerPig').length, 3);
  assert.deepEqual(engine.settleDevelopmentDraw(game), game);
});

test('confirmed first-win exhausted draws refund all original kong payers exactly once', () => {
  const initial = refundableFixture('notReadyOrFlowerPig', 'sameAsBloodBattle', 'firstWin');
  const game = engine.applyAction(initial, 0, { type: 'discard', tile: 0 });
  const bloodBattle = engine.applyAction(refundableFixture('notReadyOrFlowerPig'), 0, { type: 'discard', tile: 0 });
  assert.equal(game.phase, 'finished');
  assert.deepEqual(game.drawSettlement, bloodBattle.drawSettlement);
  assert.deepEqual(game.players.map((player) => player.score), bloodBattle.players.map((player) => player.score));
  assert.equal(game.kongLedger[0].refunded, true);
  assert.equal(game.drawSettlement.payments.filter((payment) => payment.reason === 'kongRefund').length, 3);
  assert.deepEqual(engine.settleDevelopmentDraw(JSON.parse(JSON.stringify(game))), game);
});

test('passed-win lock persists over other seats and clears only when the player draws', () => {
  let game = fixture({ hands: { 0: SOURCE, 1: WAIT, 2: WAIT }, suits: { 0: 'characters', 1: 'bamboo', 2: 'bamboo' } });
  game = engine.applyAction(game, 0, { type: 'discard', tile: 26 });
  game = engine.applyAction(game, 1, { type: 'pass' });
  assert.equal(game.players[1].passedWin, true);
  game = engine.applyAction(game, 2, { type: 'hu' });
  assert.equal(game.currentSeat, 3);
  assert.equal(game.players[1].passedWin, true);
  // 沿真实回合推进3号和0号，所有回应明确选过；1号没摸到牌前始终保留锁。
  // Advance real seats three and zero, explicitly passing claims; seat one's lock persists until its actual draw.
  let steps = 0;
  while (!(game.phase === 'turn' && game.currentSeat === 1) && steps++ < 8) {
    assert.equal(game.players[1].passedWin, true);
    if (game.phase === 'claim') game = respond(game);
    else {
      const seat = game.currentSeat;
      const action = engine.getLegalActions(game, seat).find((item) => item.type === 'discard');
      game = engine.applyAction(game, seat, action);
    }
  }
  assert.equal(game.currentSeat, 1);
  assert.equal(game.lastDraw.seat, 1);
  assert.equal(game.players[1].passedWin, false);
});

test('flower-pig fixed penalty pays an already-won non-pig without reading that win value', () => {
  const score = calculateChengduScore([...WAIT, 26], [], 'bamboo', { selfDraw: 'addBase', fanCap: 4 });
  const game = fixture({ hands: { 0: [...NOT_READY, 0], 1: WAIT, 2: NOT_READY },
    suits: { 0: 'bamboo', 1: 'bamboo', 2: 'bamboo' },
    wins: { 1: { source: 'discard', tile: 26, fromSeat: 2, score, batchId: 1 } },
    scores: { 1: 1, 2: -1 }, wallCount: 0,
    discards: [{ seat: 2, tile: 26, claimed: false, winning: true, source: 'discard' }] });
  const next = engine.applyAction(game, 0, { type: 'discard', tile: 0 });
  assert.equal(next.phase, 'finished');
  const payment = next.drawSettlement.payments.find((item) => item.reason === 'flowerPig' && item.to === 1);
  assert.deepEqual(payment, { from: 3, to: 1, points: 8, reason: 'flowerPig' });
  assert.equal(next.players[1].score, 9);
});

// 三种杠金额均已确认，不再允许开发策略改成相反规则。
// All three kong prices are now confirmed and cannot be contradicted by development policies.
test('confirmed concealed, supplemental and exposed kong prices cannot be changed by policy', () => {
  assert.throws(() => validateChengduPlayPolicy({ ...POLICY, kongPoints: { anGang: 1, mingGang: 2, buGang: 1 } }), TypeError);
  assert.throws(() => validateChengduPlayPolicy({ ...POLICY, kongPoints: { anGang: 2, mingGang: 2, buGang: 2 } }), TypeError);
  assert.throws(() => validateChengduPlayPolicy({ ...POLICY, kongPoints: { anGang: 2, mingGang: 1, buGang: 1 } }), TypeError);
});

test('corrupt runtime snapshots reject wrong budgets, forged claims, rules and duplicate ledger entries', () => {
  const turn = fixture({ hands: { 0: SOURCE, 1: WAIT, 2: WAIT }, suits: { 0: 'characters', 1: 'bamboo', 2: 'bamboo' } });
  const claimed = engine.applyAction(turn, 0, { type: 'discard', tile: 26 });
  const mutations = [
    (game) => { game.wall.pop(); },
    (game) => { game.players[1].score = 1; },
    (game) => { game.rules.dingque = false; },
    (game) => { game.rules.fanCap = 10; },
    (game) => { game.rules.playerCount = 3; },
    (game) => { game.claim.options[1] = [{ type: 'peng', tile: 26 }, { type: 'pass' }]; },
    (game) => { game.claim.responses[0] = { type: 'pass' }; },
    (game) => { game.claim.tile = 25; },
    (game) => { game.claim.discardIndex = -1; },
  ];
  for (const mutate of mutations) {
    const game = structuredClone(claimed);
    mutate(game);
    assert.throws(() => engine.assertGameInvariants(game));
  }
  const kong = refundableFixture('notReadyOrFlowerPig');
  kong.kongLedger.push({ ...structuredClone(kong.kongLedger[0]), id: 1 });
  assert.throws(() => engine.assertGameInvariants(kong), /杠账无效/);
});

test('initial dealer draw and self-draw event identity remain private even at finished boundary', () => {
  const game = fixture({ hands: { 0: [...WAIT, 26] }, suits: { 0: 'bamboo' }, endCondition: 'firstWin' });
  const next = engine.applyAction(game, 0, { type: 'hu' });
  const own = engine.getPlayerView(next, 0);
  const other = engine.getPlayerView(next, 1);
  assert.equal(own.players[0].won.tile, 26);
  assert.equal(other.players[0].won.tile, null);
  assert.equal(other.players[0].hand, undefined);
  assert.equal(other.history.find((event) => event.type === 'hu').tile, null);
  assert.equal(own.history.find((event) => event.type === 'hu').tile, 26);
});

// 换走起手多发牌后，不应继续把那张已离手的牌作为 drawnTile 或起手胡引用。
// After exchanging the initially extra tile, never expose it as a still-held draw or an initial winning-tile reference.
test('exchange preparation never retains a stale initial drawn-tile identity', () => {
  const game = start({ seed: 6, exchange: true });
  assert.equal(game.lastDraw.source, 'initial');
  assert.equal(game.lastDraw.tile, null);
  assert.equal(engine.getPlayerView(game, 0).drawnTile, null);
});

test('choosing supplemental kong over self-draw locks wins until an actual replacement or later draw', () => {
  const game = fixture({ hands: {
    0: [9, 10, 11, 18, 19, 20, 21, 21, 24, 25, 26],
    1: [9, 10, 11, 12, 13, 14, 18, 19, 20, 21, 21, 24, 25],
  }, melds: { 0: [{ type: 'peng', tile: 26, tiles: [26, 26, 26], fromSeat: 2 }] },
  suits: { 0: 'bamboo', 1: 'bamboo' }, head: [22] });
  assert.ok(engine.getLegalActions(game, 0).some((action) => action.type === 'hu'));
  const offered = engine.applyAction(game, 0, { type: 'buGang', tile: 26 });
  assert.equal(offered.players[0].passedWin, true);
  const robbed = respond(offered, { 1: { type: 'hu' } });
  assert.notEqual(robbed.currentSeat, 0);
  assert.equal(robbed.players[0].passedWin, true);
  const accepted = respond(offered);
  assert.equal(accepted.currentSeat, 0);
  assert.equal(accepted.lastDraw.source, 'replacement');
  assert.equal(accepted.players[0].passedWin, false);
});

test('saved claim validation rejects omitted eligible winners and forged unanswered passed-win locks', () => {
  const initial = fixture({ hands: { 0: SOURCE, 1: WAIT, 2: WAIT }, suits: { 0: 'characters', 1: 'bamboo', 2: 'bamboo' } });
  const game = engine.applyAction(initial, 0, { type: 'discard', tile: 26 });
  const omitted = structuredClone(game);
  omitted.claim.eligibleSeats = omitted.claim.eligibleSeats.filter((seat) => seat !== 2);
  delete omitted.claim.options[2];
  assert.throws(() => engine.assertGameInvariants(omitted), /完整回应资格/);
  const locked = structuredClone(game);
  locked.players[1].passedWin = true;
  assert.throws(() => engine.assertGameInvariants(locked), /回应过胡锁/);
});

test('corrupt pending markers cannot reopen and repost a completed draw settlement', () => {
  const finished = engine.applyAction(exhaustedFixture(), 0, { type: 'discard', tile: 0 });
  const corrupted = structuredClone(finished);
  corrupted.phase = 'settlementPending';
  corrupted.drawSettlement.status = 'pending';
  corrupted.drawSettlement.gaps = ['firstWinDrawSettlement'];
  assert.throws(() => engine.assertGameInvariants(corrupted), /回合状态无效/);
  assert.throws(() => engine.settleDevelopmentDraw(corrupted), /回合状态无效/);
  assert.deepEqual(engine.settleDevelopmentDraw(finished), finished);
});

// 原事件保留完整付款名单，单删杠账中的一笔必须拒绝，防止流局少退某一位。
// The committed event retains all payers; deleting one ledger entry must reject before a draw can under-refund anyone.
test('saved kong ledger cannot omit an original payment and silently under-refund', () => {
  const initial = fixture({ hands: { 0: [9, 9, 9, 9, 10, 12, 13, 15, 16, 18, 19, 21, 24, 26] },
    suits: { 0: 'bamboo' }, head: [25], wallCount: 1 });
  const game = engine.applyAction(initial, 0, { type: 'anGang', tile: 9 });
  const corrupted = structuredClone(game);
  corrupted.kongLedger[0].payments.pop();
  assert.throws(() => engine.assertGameInvariants(corrupted), /原付款事件不一致/);
  assert.throws(() => engine.applyAction(corrupted, 0, { type: 'discard', tile: 26 }), /原付款事件不一致/);
  const finished = engine.applyAction(game, 0, { type: 'discard', tile: 26 });
  assert.equal(finished.phase, 'finished');
  assert.equal(finished.drawSettlement.payments.filter((payment) => payment.reason === 'kongRefund').length, 3);
});

// 新确认项是规则，不再接受相反实验值；首胡流局也固定采用三项结算。
// Newly confirmed choices are fixed rules, rejecting contradictory experiments; first-win draws use the same confirmed settlement.
test('confirmed claim eligibility and draw settlement choices cannot be overridden', () => {
  for (const policy of [
    { claimsRequireClearDingque: true }, { kongsAfterPeng: 'allowed' }, { drawReadyCheck: 'pending' },
    { flowerPigPaysReadyCheck: true }, { kongRefund: 'none' }, { kongRefund: 'notReady' },
    { kongRefund: 'pending' }, { firstWinDrawSettlement: 'none' }, { firstWinDrawSettlement: 'pending' }, { afterDiscardWin: 'afterDiscarder' }, { afterDiscardWin: 'discarder' },
  ]) assert.throws(() => validateChengduPlayPolicy({ ...POLICY, ...policy }), TypeError);
});

test('uncleared dingque permits a concealed kong of another suit but still forces missing-suit discards', () => {
  const hand = [0, 9, 9, 9, 9, 10, 11, 12, 18, 19, 20, 21, 22, 23];
  const initial = fixture({ hands: { 0: hand }, suits: { 0: 'bamboo' }, head: [25] });
  const actions = engine.getLegalActions(initial, 0);
  assert.deepEqual(actions.filter((action) => action.type === 'discard'), [{ type: 'discard', tile: 0 }]);
  assert.ok(actions.some((action) => action.type === 'anGang' && action.tile === 9));
  assert.equal(actions.some((action) => action.type === 'hu'), false);
  const game = engine.applyAction(initial, 0, { type: 'anGang', tile: 9 });
  assert.ok(game.players[0].hand.includes(0));
  assert.deepEqual(engine.getLegalActions(game, 0).filter((action) => action.type === 'discard'), [{ type: 'discard', tile: 0 }]);
});

test('uncleared dingque permits peng of another suit, then still requires a discard before any kong', () => {
  const target = [0, 9, 10, 11, 12, 13, 14, 18, 19, 20, 26, 26, 26];
  let game = fixture({ hands: { 0: SOURCE, 1: target }, suits: { 0: 'characters', 1: 'bamboo' } });
  game = engine.applyAction(game, 0, { type: 'discard', tile: 26 });
  const actions = engine.getLegalActions(game, 1);
  assert.ok(actions.some((action) => action.type === 'peng'));
  assert.ok(actions.some((action) => action.type === 'mingGang'));
  assert.equal(actions.some((action) => action.type === 'hu'), false);
  game = respond(game, { 1: { type: 'peng', tile: 26 } });
  assert.deepEqual(engine.getLegalActions(game, 1), [{ type: 'discard', tile: 0 }]);
});

test('single discard win draws after the winner rather than after the discarder', () => {
  let game = fixture({ hands: { 0: SOURCE, 2: WAIT }, suits: { 0: 'characters', 2: 'bamboo' }, head: [25] });
  const beforeWallCount = game.wall.length;
  game = engine.applyAction(game, 0, { type: 'discard', tile: 26 });
  game = respond(game, { 2: { type: 'hu' } });
  assert.equal(game.phase, 'turn');
  assert.equal(game.currentSeat, 3);
  assert.equal(game.lastDraw.seat, 3);
  assert.equal(game.lastDraw.tile, 25);
  assert.equal(game.wall.length, beforeWallCount - 1);
  assert.deepEqual(engine.getLegalActions(game, 2), []);
  assert.throws(() => engine.applyAction(game, 2, { type: 'hu' }));
});

test('multiple discard winners retire together and the discarder draws next', () => {
  let game = fixture({ hands: { 0: SOURCE, 1: WAIT, 2: WAIT }, suits: { 0: 'characters', 1: 'bamboo', 2: 'bamboo' }, head: [25] });
  const beforeWallCount = game.wall.length;
  game = engine.applyAction(game, 0, { type: 'discard', tile: 26 });
  game = respond(game, { 1: { type: 'hu' }, 2: { type: 'hu' } });
  assert.equal(game.currentSeat, 0);
  assert.equal(game.lastDraw.seat, 0);
  assert.equal(game.lastDraw.tile, 25);
  assert.equal(game.wall.length, beforeWallCount - 1);
  assert.deepEqual(engine.getLegalActions(game, 1), []);
  assert.deepEqual(engine.getLegalActions(game, 2), []);
});

test('self-draw winner retires and the next unwon player receives exactly one draw', () => {
  const initial = fixture({ hands: { 0: [...WAIT, 26] }, suits: { 0: 'bamboo' }, head: [25] });
  const game = engine.applyAction(initial, 0, { type: 'hu' });
  assert.equal(game.currentSeat, 1);
  assert.equal(game.lastDraw.seat, 1);
  assert.equal(game.wall.length, initial.wall.length - 1);
  assert.deepEqual(game.players[0].hand, initial.players[0].hand);
  assert.deepEqual(engine.getLegalActions(game, 0), []);
  assert.throws(() => engine.applyAction(game, 0, { type: 'discard', tile: 26 }));
  assert.throws(() => engine.applyAction(game, 0, { type: 'hu' }));
});

test('single-winner continuation skips a previously retired next seat', () => {
  const score = calculateChengduScore([...WAIT, 26], [], 'bamboo', { selfDraw: 'addBase', fanCap: 4 });
  let game = fixture({ hands: { 0: SOURCE, 2: WAIT, 3: WAIT }, suits: { 0: 'characters', 2: 'bamboo', 3: 'bamboo' },
    wins: { 3: { source: 'discard', tile: 26, fromSeat: 1, score, batchId: 1 } }, scores: { 1: -1, 3: 1 },
    discards: [{ seat: 1, tile: 26, claimed: false, winning: true, source: 'discard' }], head: [25] });
  game = engine.applyAction(game, 0, { type: 'discard', tile: 26 });
  game = respond(game, { 2: { type: 'hu' } });
  assert.equal(game.currentSeat, 0);
  assert.equal(game.lastDraw.seat, 0);
  assert.equal(game.players[3].score, 1);
});

test('flower-pig kong receipts are refunded to every original payer without a second ready-check charge', () => {
  const initial = refundableFixture('notReadyOrFlowerPig');
  // 从弃牌区换回一张真实缺门牌，令最后一次出牌后仍有缺门；全局实体牌预算不变。
  // Swap a real missing-suit tile from discards so one remains after the final discard, preserving every physical copy.
  const discarded = initial.discards.find((discard) => !discard.claimed && discard.tile === 0);
  assert.ok(discarded);
  const handIndex = initial.players[0].hand.findIndex((tile) => tile !== 0);
  [initial.players[0].hand[handIndex], discarded.tile] = [discarded.tile, initial.players[0].hand[handIndex]];
  engine.assertGameInvariants(initial);
  const game = engine.applyAction(initial, 0, { type: 'discard', tile: 0 });
  assert.equal(game.phase, 'finished');
  assert.equal(game.kongLedger[0].refunded, true);
  const payments = game.drawSettlement.payments;
  assert.equal(payments.filter((payment) => payment.reason === 'kongRefund' && payment.from === 0).length, 3);
  assert.equal(payments.some((payment) => payment.reason === 'notReady' && payment.from === 0), false);
  assert.ok(payments.some((payment) => payment.reason === 'flowerPig' && payment.from === 0));
});
