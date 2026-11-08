// 自弃同牌禁胡至下一次本人实际摸牌：覆盖真实回合、旧待决窗、来源、恢复与隐私。
// A self-discard lock lasts until the next actual own draw: real turns, saved claims, sources, restoration and privacy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, applyPresentedAction, continuePresentedGame, getLegalActions, getPlayerView,
  getHuDiagnostic, getWaitTiles, assertGameInvariants } from '../shared/game.js';
import { variableFixture } from './fixtures/variable-table.js';
import { postHuWinClaim } from './fixtures/post-hu-win.js';
import { postHuKongGame } from './fixtures/post-hu-kong.js';

const hand = [0, 1, 2, 3, 4, 5, 9, 10, 11, 13, 14, 15, 17, 17];
const otherHand = [0, 0, 1, 2, 3, 4, 6, 8, 9, 11, 12, 14, 16];

// 使用真实出牌和自动摸牌形成回合，不直接伪造可胡选项。
// Form the turn with actual discards and automatic draws, not fabricated hu allowlists.
function round({ head = [15], huCount = 0, automatic = false, draw = 15, waitOnEight = false } = {}) {
  const own = [...hand]; own[own.lastIndexOf(15)] = draw;
  return variableFixture({ playerCount: 4, deckCount: 3,
    hands: [own, waitOnEight ? [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 8] : otherHand,
      otherHand, otherHand], huCounts: [huCount], drawTile: draw, head,
    rules: { specialHuPatterns: false, autoDiscardAfterHu: automatic },
  });
}

// 已保存的旧反应窗包含已知的先前本人弃牌。实体牌从墙里取出、插入牌河并更新引用。
// An old saved claim includes a known earlier self-discard; allocate its physical copy and adjust all river references.
function savedClaim({ kind = 'discard', huCount = 1, multiple = false, differentTile = false } = {}) {
  const game = postHuWinClaim({ kind, huCount, multiple });
  const tile = differentTile ? 12 : game.claim.tile;
  const index = game.wall.indexOf(tile);
  assert.notEqual(index, -1);
  game.wall.splice(index, 1);
  game.discards.unshift({ seat: 0, tile, claimable: false, afterKong: false });
  game.claim.discardIndex++;
  for (const player of game.players) for (const win of player.winPile)
    if (win.discardIndex != null) win.discardIndex++;
  game.history.unshift({ type: 'discard', seat: 0, tile, revision: 0, automatic: false });
  assertGameInvariants(game);
  return game;
}

test('a real seven-dot discard blocks the same tile returned before the next own draw, but not another wait', () => {
  for (const nextTile of [15, 12]) {
    let game = round({ head: [nextTile] });
    game = applyAction(game, 0, { type: 'discard', tile: 15 });
    assert.equal(game.currentSeat, 3);
    game = applyPresentedAction(game, 3, { type: 'discard', tile: nextTile });
    assert.equal(game.presentation.stage, 'discard');
    game = continuePresentedGame(game);
    const canHu = getLegalActions(game, 0).some(action => action.type === 'hu');
    assert.equal(canHu, nextTile === 12);
    assert.deepEqual(getWaitTiles(game.players[0].hand, [], game.rules), [12, 15]);
    if (canHu) assert.equal(applyPresentedAction(game, 0, { type: 'hu' }).players[0].huCount, 1);
    else assert.throws(() => applyAction(game, 0, { type: 'hu' }), /当前不能执行/);
    assertGameInvariants(game);
  }
});

test('peng and a second discard do not clear any earlier self-discard before drawing', () => {
  // 此手的两张一条可真实碰牌，打出四筒后仍听四/七筒。
  // Two held one-bamboos permit a real peng; discarding four dots retains the four/seven-dot waits.
  const own = [0, 0, 1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17, 15];
  let game = variableFixture({ playerCount: 4, deckCount: 3, hands: [own, otherHand, otherHand, otherHand],
    drawTile: 15, head: [0, 15], rules: { specialHuPatterns: false, autoDiscardAfterHu: false } });
  game = applyAction(game, 0, { type: 'discard', tile: 15 });
  game = applyAction(game, 3, { type: 'discard', tile: 0 });
  // 其他有资格座位先过，防止依赖回应速度或漏等同级碰。
  // Other eligible seats pass first rather than relying on response order or skipping competing claims.
  for (const seat of game.claim.eligibleSeats.filter(seat => seat !== 0)) game = applyAction(game, seat, { type: 'pass' });
  game = applyAction(game, 0, { type: 'peng', tile: 0 });
  game = applyAction(game, 0, { type: 'discard', tile: 12 });
  for (const seat of [...(game.claim?.eligibleSeats || [])]) game = applyAction(game, seat, { type: 'pass' });
  assert.equal(game.currentSeat, 3);
  game = applyPresentedAction(game, 3, { type: 'discard', tile: 15 });
  game = continuePresentedGame(game);
  assert.deepEqual(getWaitTiles(game.players[0].hand, game.players[0].melds, game.rules), [12, 15]);
  assert.ok(!getLegalActions(game, 0).some(action => action.type === 'hu'));
  assert.deepEqual(game.history.filter(event => event.seat === 0 && ['discard', 'draw'].includes(event.type))
    .map(event => [event.type, event.tile]), [['discard', 15], ['discard', 12]]);
  assertGameInvariants(game);
});

for (const kind of ['discard', 'kongDiscard', 'robKong']) for (const huCount of [0, 1]) {
  test(`saved ${kind} filters self-discard hu before mandatory-win priority, prior hu count ${huCount}`, () => {
    const game = JSON.parse(JSON.stringify(savedClaim({ kind, huCount })));
    const before = structuredClone(game);
    assert.deepEqual(getLegalActions(game, 0), [{ type: 'pass' }]);
    assert.equal(getHuDiagnostic(game, 0).code, 'SELF_DISCARD_LOCK');
    assert.match(getHuDiagnostic(game, 0).message, /下次自己摸牌前/);
    assert.deepEqual(getPlayerView(game, 0).legalActions, [{ type: 'pass' }]);
    for (const apply of [applyAction, applyPresentedAction]) assert.throws(() => apply(game, 0, { type: 'hu' }), /当前不能执行/);
    assert.deepEqual(game, before);
    const next = applyPresentedAction(game, 0, { type: 'pass' });
    assert.equal(next.players[0].huCount, huCount);
    assert.ok(!next.history.some(event => event.type === 'hu' && event.seat === 0));
    assertGameInvariants(next);
  });
}

test('another previously discarded identity does not suppress an available mandatory post-hu win', () => {
  const game = savedClaim({ differentTile: true });
  assert.deepEqual(getLegalActions(game, 0), [{ type: 'hu' }]);
  assert.equal(getHuDiagnostic(game, 0).code, 'AVAILABLE');
});

for (const source of ['normal', 'continuation', 'replacement']) {
  test(`an actual own ${source} draw releases the self-discard restriction`, () => {
    const game = savedClaim();
    game.history.splice(1, 0, { type: 'draw', seat: 0, source, revision: 0 });
    assert.deepEqual(getLegalActions(game, 0), [{ type: 'hu' }]);
    const next = applyPresentedAction(game, 0, { type: 'hu' });
    assert.equal(next.players[0].huCount, 2);
    assertGameInvariants(next);
  });
}

test('a real replacement draw unlocks even when the kong presentation alone did not draw', () => {
  let game = postHuKongGame();
  const oldDiscard = 9;
  game.wall.splice(game.wall.lastIndexOf(oldDiscard), 1);
  game.discards.push({ seat: 0, tile: oldDiscard, claimable: false, afterKong: false });
  game.history.push({ type: 'discard', seat: 0, tile: oldDiscard, revision: 0 });
  [game.wall[0], game.wall[1]] = [game.wall[1], game.wall[0]];
  game.rules.autoDiscardAfterHu = false;
  game = applyPresentedAction(game, 0, { type: 'buGang', tile: 2 });
  assert.ok(!game.history.some(event => event.type === 'draw'));
  assert.equal(game.lastDraw, null);
  game = continuePresentedGame(game);
  assert.equal(game.lastDraw.tile, 6);
  assert.equal(game.lastDraw.source, 'replacement');
  game = applyAction(game, 0, { type: 'pass' });
  assert.equal(game.currentSeat, 2);
  game = applyPresentedAction(game, 2, { type: 'discard', tile: oldDiscard });
  game = continuePresentedGame(game);
  assert.deepEqual(getLegalActions(game, 0), [{ type: 'hu' }]);
  assertGameInvariants(game);
});

test('a real normal draw clears the old identity while the next discarded identity gets its own lock', () => {
  let game = round({ head: [6, 7, 8, 8, 15] });
  game = applyAction(game, 0, { type: 'discard', tile: 15 });
  for (const seat of [3, 2, 1, 0]) {
    assert.equal(game.currentSeat, seat);
    game = applyAction(game, seat, { type: 'discard', tile: game.lastDraw.tile });
    for (const caller of [...(game.claim?.eligibleSeats || [])]) game = applyAction(game, caller, { type: 'pass' });
  }
  assert.equal(game.currentSeat, 3);
  game = applyPresentedAction(game, 3, { type: 'discard', tile: 15 });
  game = continuePresentedGame(game);
  assert.ok(getLegalActions(game, 0).some(action => action.type === 'hu'));
  assert.equal(getHuDiagnostic(game, 0).code, 'AVAILABLE');
  assertGameInvariants(game);
});

test('a real continuation draw clears an old self-discard for the next external win', () => {
  let game = postHuKongGame({ winningDraw: true });
  game.rules.autoDiscardAfterHu = false;
  game.wall.splice(game.wall.lastIndexOf(12), 1);
  game.discards.push({ seat: 0, tile: 12, claimable: false, afterKong: false });
  game.history.push({ type: 'discard', seat: 0, tile: 12, revision: 0 });
  for (const tile of [12, 6]) {
    const index = game.wall.indexOf(tile); assert.notEqual(index, -1);
    game.wall.splice(index, 1); game.wall.unshift(tile);
  }
  game = applyPresentedAction(game, 0, { type: 'hu' });
  game = continuePresentedGame(game);
  assert.equal(game.lastDraw.source, 'continuation');
  assert.equal(game.lastDraw.tile, 6);
  game = applyAction(game, 0, { type: 'pass' });
  game = applyPresentedAction(game, 2, { type: 'discard', tile: 12 });
  game = continuePresentedGame(game);
  assert.deepEqual(getLegalActions(game, 0), [{ type: 'hu' }]);
  assertGameInvariants(game);
});

for (const marker of ['peng', 'hu', 'robKongAttempt']) {
  test(`${marker} alone never releases a self-discard lock`, () => {
    const game = savedClaim();
    game.history.splice(1, 0, { type: marker, seat: 0, tile: game.claim.tile, revision: 0 });
    assert.deepEqual(getLegalActions(game, 0), [{ type: 'pass' }]);
  });
}

test('manual post-hu pass and automatic discard both establish the same restriction', () => {
  for (const automatic of [true, false]) {
    let game = round({ huCount: 1, automatic, draw: 8, head: [8], waitOnEight: true });
    if (automatic) {
      // 合法展示续行把0号带到自动无用摸牌，使用同一真实自动打出路径。
      // A legal presentation resumes into the same automatic uninteresting-draw discard path.
      const held = game.players[0].hand;
      held.splice(held.lastIndexOf(8), 1); game.wall.unshift(8);
      game.lastDraw = null; game.turnStep = 'draw'; game.presentation = { stage: 'kong', seat: 0 };
      game = continuePresentedGame(game);
      assert.equal(game.history.at(-1).type, 'discard');
      assert.equal(game.history.at(-1).automatic, true);
      game = continuePresentedGame(game);
    } else game = applyAction(game, 0, { type: 'pass' });
    assert.ok(game.history.some(event => event.type === 'discard' && event.seat === 0 && event.tile === 8));
    for (const seat of [...(game.claim?.eligibleSeats || [])]) game = applyAction(game, seat, { type: 'pass' });
    game = applyPresentedAction(game, 3, { type: 'discard', tile: 8 });
    game = continuePresentedGame(game);
    // 另一位真实可胡者保持窗口开放；专用诊断证明不是靠“牌型本来不能胡”假通过。
    // A genuinely eligible other winner keeps the claim open; the diagnostic distinguishes this lock from a nonwinning shape.
    assert.equal(game.phase, 'claim');
    assert.equal(getHuDiagnostic(game, 0).code, 'SELF_DISCARD_LOCK');
    assert.ok(!getLegalActions(game, 0).some(action => action.type === 'hu'));
    assertGameInvariants(game);
  }
});

for (const kind of ['discard', 'kongDiscard', 'robKong']) {
  test(`already accepted old ${kind} hu remains committed while a different responder finishes the window`, () => {
    let game = savedClaim({ kind, multiple: true });
    game.claim.responses[0] = { type: 'hu' };
    const before = structuredClone(game);
    assert.deepEqual(getLegalActions(game, 0), []);
    assert.equal(getHuDiagnostic(game, 0).code, 'ALREADY_RESPONDED');
    assert.deepEqual(game, before);
    game = applyPresentedAction(JSON.parse(JSON.stringify(game)), 2, { type: 'hu' });
    assert.deepEqual(game.players.map(player => player.huCount), [2, 0, 2]);
    assert.equal(game.history.filter(event => event.type === 'hu').length, 2);
    assertGameInvariants(game);
  });
}

test('missing historical evidence is not reconstructed from the river, hands, old huLock or opponents', () => {
  const game = savedClaim();
  game.history = [];
  game.players[0].huLockActive = true;
  assert.ok(game.discards.some(discard => discard.seat === 0 && discard.tile === game.claim.tile));
  assert.deepEqual(getLegalActions(game, 0), [{ type: 'hu' }]);
  const otherView = getPlayerView(game, 1);
  assert.equal(otherView.players[0].hand, undefined);
  assert.equal(otherView.claim.options, undefined);
  assert.equal(otherView.claim.responses, undefined);
});

test('automatic self-discard evidence is as binding as manual evidence in a restored winning claim', () => {
  const game = savedClaim(); game.history[0].automatic = true;
  assert.deepEqual(getLegalActions(game, 0), [{ type: 'pass' }]);
  assert.equal(getHuDiagnostic(game, 0).code, 'SELF_DISCARD_LOCK');
});

test('an accepted old hu still needs a valid hand and cannot bypass shape checks', () => {
  const game = savedClaim({ multiple: true });
  game.claim.responses[0] = { type: 'hu' };
  // 等量交换牌墙中的五筒与手中的二筒，使该手不再听一筒，仍保持全部实体配额。
  // Swap a wall five-dot for a held two-dot to break the one-dot wait while conserving every copy.
  const wallIndex = game.wall.indexOf(13); assert.notEqual(wallIndex, -1);
  const handIndex = game.players[0].hand.indexOf(10); assert.notEqual(handIndex, -1);
  game.wall[wallIndex] = 10; game.players[0].hand[handIndex] = 13;
  game.players[0].hand.sort((left, right) => left - right);
  assert.ok(!getWaitTiles(game.players[0].hand, game.players[0].melds, game.rules).includes(game.claim.tile));
  assertGameInvariants(game);
  const before = structuredClone(game);
  assert.throws(() => applyAction(game, 2, { type: 'hu' }), /当前不能胡牌/);
  assert.deepEqual(game, before);
});

test('a new upgrade creates no rob-kong window when its only former winner is self-discard locked', () => {
  const game = savedClaim({ kind: 'robKong' });
  // 从已守恒的旧窗口恢复到其申请前，保留先前自弃证据，再走真实补/加杠入口。
  // Rewind the conserved offered tile to its pre-offer state, retain the self-discard, then use the real upgrade path.
  const offered = game.discards.pop();
  game.players[1].hand.push(offered.tile); game.players[1].hand.sort((left, right) => left - right);
  game.history.pop(); game.claim = null;
  game.phase = 'turn'; game.turnStep = 'discard'; game.currentSeat = 1;
  game.lastDraw = { seat: 1, tile: offered.tile, source: 'normal' };
  assertGameInvariants(game);
  const next = applyPresentedAction(game, 1, { type: 'addGang', tile: offered.tile });
  assert.equal(next.claim, null);
  assert.equal(next.presentation.stage, 'kong');
  assert.equal(next.history.at(-1).type, 'addGang');
  assert.ok(!next.history.some(event => event.type === 'robKongAttempt'));
  assertGameInvariants(next);
});
