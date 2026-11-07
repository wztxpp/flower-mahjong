// 首胡前动作并列、胡后必胡，以及碰后当前回合禁暗杠的规则回归。
// Regress pre-win action choice, mandatory post-win hu, and no concealed kong before the peng discard.
// 全部夹具遵守每种八张及144张守恒；动作从真实 applyAction 入口验证。
// Every fixture conserves eight copies of each tile and 144 total; actions use real applyAction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, getLegalActions, getPlayerView, assertGameInvariants } from '../shared/game.js';
import { pungUpgradeGame, takePeng } from './fixtures/pung-upgrade.js';

const waiting = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
const kongWinningHand = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17];
const move = (game, seat, type, tile) => applyAction(game, seat, tile === undefined ? { type } : { type, tile });
const types = (game, seat) => [...new Set(getLegalActions(game, seat).map(action => action.type))];

// 使用公开测试牌型重建完整牌墙；可指定副露和一次历史胡牌，永不使用真实玩家数据。
// Rebuild a complete wall from synthetic hands, optional melds and one historical win; never use live data.
function fixture({ hands = [kongWinningHand, waiting, waiting], melds = [[], [], []], huCounts = [0, 0, 0], drawTile = 0, rules = {} } = {}) {
  const game = createGame({ seed: 'pre-hu-action-choice', rules: { specialHuPatterns: false, bigSingleReadyPayment: false, ...rules } });
  game.players.forEach((player, seat) => {
    player.hand = [...hands[seat]].sort((a, b) => a - b);
    player.melds = structuredClone(melds[seat]);
    player.huCount = huCounts[seat];
    player.winPile = huCounts[seat] ? [{ tile: 16, source: 'selfDraw', virtual: false }] : [];
    player.kongCount = melds[seat].filter(meld => meld.type !== 'peng').length;
  });
  game.retiredTiles = huCounts.flatMap((count, seat) => count ? [{ seat, tile: 16 }] : []);
  game.history = [];
  game.discards = [];
  game.firstHuRadishesRevealed = huCounts.some(Boolean);
  game.currentSeat = 0;
  game.phase = 'turn';
  game.turnStep = 'discard';
  game.drawKind = 'normal';
  game.lastDraw = { seat: 0, tile: drawTile, source: 'normal' };
  const counts = Array(18).fill(8);
  // 先扣手牌、副露、已退休实物，再把所有剩余牌放入墙；负数代表夹具错误。
  // Debit hands, melds and retired physical tiles before rebuilding the wall; negatives are fixture errors.
  for (const tile of [...game.players.flatMap(player => [...player.hand, ...player.melds.flatMap(meld => meld.tiles)]), ...game.retiredTiles.map(record => record.tile)]) {
    assert.ok(--counts[tile] >= 0, `overused tile ${tile}`);
  }
  game.wall = counts.flatMap((count, tile) => Array(count).fill(tile));
  assertGameInvariants(game);
  return game;
}

// 等待其他未胡回应位合法过牌，让本次选择完整结算；已胡必胡测试不使用本助手。
// Resolve optional unwon responses by passing; mandatory-hu cases do not use this helper.
function passRest(game) {
  while (game.phase === 'claim') {
    const seat = game.claim.eligibleSeats.find(other => !game.claim.responses[other]);
    game = move(game, seat, 'pass');
  }
  return game;
}

for (const choice of ['hu', 'anGang', 'discard']) {
  test(`before first hu a winning draw permits independent ${choice}`, () => {
    const game = fixture();
    assert.deepEqual(types(game, 0), ['discard', 'hu', 'anGang']);
    const next = move(game, 0, choice, choice === 'hu' ? undefined : 0);
    assertGameInvariants(next);
    assert.equal(game.players[0].huCount, 0);
    if (choice === 'anGang') assert.equal(next.players[0].melds[0].type, 'anGang');
  });
}

for (const meldType of ['peng', 'anGang']) {
  const action = meldType === 'peng' ? 'buGang' : 'addGang';
  test(`before first hu a winning draw also permits ${action}`, () => {
    const game = fixture({ hands: [[2, 3, 4, 5, 6, 7, 9, 10, 11, 17, 17], waiting, waiting], melds: [[{ type: meldType, tile: 2, tiles: Array(meldType === 'peng' ? 3 : 4).fill(2) }], [], []], drawTile: 2 });
    assert.ok(types(game, 0).includes('hu'));
    assert.ok(types(game, 0).includes(action));
    assertGameInvariants(passRest(move(game, 0, action, 2)));
  });
}

for (const choice of ['hu', 'peng', 'mingGang', 'pass']) {
  test(`before first hu a shared discard permits ${choice} alongside other legal choices`, () => {
    const base = [...kongWinningHand];
    base.splice(base.indexOf(0), 1);
    let game = fixture({ hands: [[...waiting, 0], base, waiting], drawTile: 0 });
    game = move(game, 0, 'discard', 0);
    assert.deepEqual(types(game, 1), ['hu', 'mingGang', 'peng', 'pass']);
    const before = JSON.stringify(game);
    const next = passRest(move(game, 1, choice, ['peng', 'mingGang'].includes(choice) ? 0 : undefined));
    assert.equal(JSON.stringify(game), before);
    assertGameInvariants(next);
    if (choice === 'hu') assert.equal(next.players[1].huCount, 1);
    if (choice === 'peng') assert.equal(next.players[1].melds[0].type, 'peng');
    if (choice === 'mingGang') assert.equal(next.players[1].melds[0].type, 'mingGang');
  });
}

for (const value of [false, undefined]) {
  test(`saved preHuActionChoice=${value} retains historical hu-over-kong policy without mutation`, () => {
    const game = fixture();
    if (value === undefined) delete game.rules.preHuActionChoice;
    else game.rules.preHuActionChoice = value;
    const saved = JSON.stringify(game);
    assert.deepEqual(types(game, 0), ['discard', 'hu']);
    assert.throws(() => move(game, 0, 'anGang', 0));
    assert.equal(JSON.stringify(game), saved);
  });
}

for (const source of ['normal', 'replacement', 'continuation']) {
  test(`a prior winner must hu on ${source} even with a legal kong`, () => {
    const game = fixture({ huCounts: [1, 0, 0] });
    game.lastDraw.source = source;
    game.drawKind = source;
    assert.deepEqual(getLegalActions(game, 0), [{ type: 'hu' }]);
    assert.throws(() => move(game, 0, 'anGang', 0));
    assert.throws(() => move(game, 0, 'discard', 0));
    assert.throws(() => move(game, 0, 'pass'));
  });
}

test('a prior winner with a discard hu gets no peng, kong or pass options', () => {
  const base = [...kongWinningHand];
  base.splice(base.indexOf(0), 1);
  let game = fixture({ hands: [[...waiting, 0], base, waiting], huCounts: [0, 1, 0], drawTile: 0 });
  game = move(game, 0, 'discard', 0);
  assert.deepEqual(getLegalActions(game, 1), [{ type: 'hu' }]);
  assert.throws(() => move(game, 1, 'pass'));
  assert.throws(() => move(game, 1, 'mingGang', 0));
});

// 用真实碰牌动作建立本回合，再交换墙牌形成四张暗牌；不伪造额外摸牌。
// Reach the post-peng turn with actual actions, then exchange wall tiles for a concealed four without inventing a draw.
function afterPengWithConcealedKong() {
  const game = takePeng(pungUpgradeGame({ heldFourth: true }));
  const player = game.players[1];
  const removed = player.hand.splice(1, 4);
  game.wall.push(...removed);
  for (let i = 0; i < 4; i++) {
    const index = game.wall.indexOf(12);
    assert.ok(index >= 0);
    game.wall.splice(index, 1);
    player.hand.push(12);
  }
  assertGameInvariants(game);
  return game;
}

for (const savedMarker of [true, false]) {
  test(`post-peng concealed kong is blocked with ${savedMarker ? 'saved marker' : 'history-inferred obligation'}`, () => {
    const game = afterPengWithConcealedKong();
    if (!savedMarker) delete game.players[1].pendingPungDiscard;
    const before = JSON.stringify(game);
    assert.equal(types(game, 1).includes('anGang'), false);
    assert.equal(getPlayerView(game, 1).legalActions.some(action => action.type === 'anGang'), false);
    assert.throws(() => move(game, 1, 'anGang', 12));
    assert.equal(JSON.stringify(game), before);
    // 完成本次实际出牌后推进两家，轮到本人时暗杠再次合法。
    // After the actual discard and two opponents' turns, the concealed kong is legal again.
    let next = passRest(move(game, 1, 'discard', 0));
    while (next.currentSeat !== 1) next = passRest(move(next, next.currentSeat, 'discard', next.lastDraw.tile));
    assert.ok(types(next, 1).includes('anGang'));
    assertGameInvariants(move(next, 1, 'anGang', 12));
  });
}

for (const value of [false, undefined]) {
  test(`saved concealedKongAfterPungDiscard=${value} preserves prior timing`, () => {
    const game = afterPengWithConcealedKong();
    if (value === undefined) delete game.rules.concealedKongAfterPungDiscard;
    else game.rules.concealedKongAfterPungDiscard = value;
    assert.ok(types(game, 1).includes('anGang'));
    assertGameInvariants(move(game, 1, 'anGang', 12));
  });
}

test('new action rules are explicit booleans and never accepted as strings', () => {
  for (const key of ['preHuActionChoice', 'concealedKongAfterPungDiscard']) {
    assert.equal(createGame({ seed: key }).rules[key], true);
    assert.throws(() => createGame({ seed: key, rules: { [key]: 'true' } }));
  }
});
