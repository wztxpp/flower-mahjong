// 音画分步只改变推进时机；完整排空后必须与即时引擎逐字段相同。
// Presentation stepping changes timing only; drained results must match the immediate engine field for field.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, applyPresentedAction, continuePresentedGame,
  getLegalActions, getPlayerView, assertGameInvariants } from '../shared/game.js';
import { postHuKongGame } from './fixtures/post-hu-kong.js';
const waiting = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
const winning = [...waiting, 17];
// 用每种八张的预算构造局面，所有暂停态同样接受实体守恒验证。
// Build scenarios from eight-copy budgets and validate conservation at every paused boundary.
function fixture({
  hands = [winning, waiting, waiting],
  melds = [[], [], []],
  radishes = [[], [], []],
  huCounts = [0, 0, 0],
  priorWins = [[], [], []],
  locks = [[], [], []],
  activeLocks = [false, false, false],
  currentSeat = 0,
  turnStep = "discard",
  drawTile = hands[currentSeat]?.at(-1),
  drawKind = "normal",
  head = [],
  tail = [],
  rules = {},
  wallCount,
  kongSeats = [],
  firstHuRadishesRevealed = huCounts.some((count) => count > 0),
} = {}) {
  const game = createGame({
    seed: "fixture",
    rules: {
      allowPungUpgrade: true,
      turnDirection: "clockwise",
      specialHuPatterns: false,
      bigSingleReadyPayment: false,
      ...rules,
    },
  });
  game.players.forEach((player, seat) => {
    player.hand = [...hands[seat]].sort((a, b) => a - b);
    player.melds = structuredClone(melds[seat]);
    player.radishes = [...radishes[seat]];
    player.winPile = priorWins[seat].map((tile) => ({
      tile,
      source: "selfDraw",
      virtual: false,
    }));
    player.huCount = huCounts[seat];
    player.lockedWaits = [...locks[seat]];
    player.huLockActive = activeLocks[seat];
    player.pendingKongDiscard = kongSeats.includes(seat);
    player.kongCount = melds[seat].filter(
      (item) => item.type !== "peng",
    ).length;
  });
  game.phase = "turn";
  game.currentSeat = currentSeat;
  game.turnStep = turnStep;
  game.drawKind = drawKind;
  game.lastDraw =
    turnStep === "discard" && drawTile !== null
      ? {
          seat: currentSeat,
          tile: drawTile,
          source: drawKind,
        }
      : null;
  game.firstHuRadishesRevealed = firstHuRadishesRevealed;
  game.discards = [];
  // 已胡的实物牌仍占一张物理配额；winPile 是展示/计分引用，不能当成新增的牌。
  // Physical winning tiles still occupy one copy; winPile is a display/scoring reference, not newly created tiles.
  game.retiredTiles = priorWins.flatMap((wins, seat) =>
    wins.map((tile) => ({
      seat,
      tile,
    })),
  );
  game.history = [];
  game.revision = 0;
  // 十八种牌，每种八张。先登记所有已分配牌，再把余量填入牌墙；不能凭空增加牌。
  // There are eighteen kinds with eight copies each. Debit allocated tiles, then place remaining copies in the wall.
  const counts = Array(18).fill(8);
  // 从每种牌八张的余量扣除一张；负数表示夹具凭空制造了第九张，立即失败。
  // Debit one of the eight copies of a tile; a negative remainder means the fixture invented a ninth copy and must fail.
  const use = (tile) => {
    assert.ok(--counts[tile] >= 0, `Fixture overused tile ${tile}`);
  };
  // 逐项覆盖 game.players；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in game.players with the same checks, preserving the listed order.
  for (const player of game.players)
    [
      ...player.hand,
      ...player.melds.flatMap((m) => m.tiles),
      ...player.radishes,
    ].forEach(use);
  game.retiredTiles.forEach((item) => use(item.tile));
  head.forEach(use);
  tail.forEach(use);
  let rest = counts.flatMap((count, tile) => Array(count).fill(tile));
  // 仅在明确指定墙牌数时裁剪；多出的实物牌必须移入退役区，不能消失。
  // Trim the wall only when explicitly requested; surplus physical tiles must be retired, not disappear.
  if (wallCount !== undefined) {
    const targetRest = wallCount - head.length - tail.length;
    assert.ok(targetRest >= 0);
    game.retiredTiles.push(
      ...rest.splice(targetRest).map((tile) => ({
        seat: 0,
        tile,
      })),
    );
  }
  game.wall = [...head, ...rest, ...tail];
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
  return game;
}

// 每次仅恢复一个展示段，并确认修订号不变、所有座位被锁住、隐私视图只带阶段。
// Resume one boundary per call; assert unchanged revision, locked seats, and stage-only public markers.
function drain(game) {
  let steps = 0;
  while (game.presentation) {
    assert.ok(steps++ < 300);
    assertGameInvariants(game);
    for (const seat of [0, 1, 2]) {
      assert.deepEqual(getLegalActions(game, seat), []);
      assert.deepEqual(getPlayerView(game, seat).presentation, { stage: game.presentation.stage });
    }
    const before = structuredClone(game);
    const input = game;
    const revision = game.revision;
    game = continuePresentedGame(input);
    assert.deepEqual(input, before);
    assert.equal(game.revision, revision);
    assertGameInvariants(game);
    assert.notStrictEqual(game, input);
  }
  return game;
}
// 两条路径共享同一输入，比较完整牌局与事件而非只比较分数。
// Run both paths from one input and compare complete state/history, not just scores.
function compare(game, seat, action) {
  const original = structuredClone(game);
  const immediate = applyAction(game, seat, action);
  const staged = applyPresentedAction(game, seat, action);
  assert.deepEqual(game, original);
  assert.deepEqual(drain(staged), immediate);
  return staged;
}

test('discard pauses before claim computation and rejects further actions', () => {
  const game = fixture();
  const staged = compare(game, 0, { type: 'discard', tile: 17 });
  assert.deepEqual(staged.presentation, { stage: 'discard', discardIndex: 0 });
  assert.equal(staged.claim, null);
  assert.equal(staged.wall.length, game.wall.length);
  assert.equal(staged.currentSeat, 0);
  assert.throws(() => applyPresentedAction(staged, 0, { type: 'discard', tile: 0 }));
  const resumed = continuePresentedGame(staged);
  assert.equal(resumed.phase, 'claim');
  assert.ok(resumed.claim.options[1].some(action => action.type === 'hu'));
});

test('peng and exposed kong wait before actions or replacement draw', () => {
  for (const type of ['peng', 'mingGang']) {
    const receiver = type === 'peng'
      ? [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 17, 17]
      : [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 17, 17, 17];
    let game = applyAction(fixture({ hands: [winning, receiver, waiting] }), 0, { type: 'discard', tile: 17 });
    game = applyAction(game, 2, { type: 'pass' });
    const staged = compare(game, 1, { type, tile: 17 });
    assert.equal(staged.presentation.stage, type === 'peng' ? 'peng' : 'kong');
    assert.equal(staged.wall.length, game.wall.length);
    assert.equal(staged.history.at(-1).type, type);
  }
});

test('own kong variants preserve replacement provenance and pause before draw', () => {
  for (const type of ['anGang', 'buGang', 'addGang']) {
    const game = postHuKongGame({ type });
    const action = getLegalActions(game, 0).find(action => action.type === type);
    const staged = compare(game, 0, action);
    assert.equal(staged.presentation.stage, 'kong');
    assert.equal(staged.lastDraw, null);
    assert.equal(staged.history.at(-1).type, type);
    const resumed = continuePresentedGame(staged);
    assert.equal(resumed.lastDraw.kongSource.type, type);
  }
});

test('self draw pauses before continuation and manual post-hu still requires a decision', () => {
  for (const autoDiscardAfterHu of [true, false]) {
    const game = fixture({ head: [6], rules: { autoDiscardAfterHu } });
    const staged = compare(game, 0, { type: 'hu' });
    assert.equal(staged.presentation.stage, 'hu');
    assert.equal(staged.history.at(-1).type, 'hu');
    const resumed = continuePresentedGame(staged);
    if (autoDiscardAfterHu) {
      assert.equal(resumed.presentation.stage, 'discard');
      assert.equal(resumed.history.at(-1).automatic, true);
      assert.equal(resumed.claim, null);
      assert.equal(resumed.currentSeat, 0);
    } else {
      assert.equal(resumed.presentation, undefined);
      assert.equal(resumed.lastDraw.tile, 6);
      assert.ok(getLegalActions(resumed, 0).some(action => action.type === 'pass'));
      compare(resumed, 0, { type: 'pass' });
    }
  }
});

test('simultaneous winners settle as one batch before finishing or continuing', () => {
  for (const final of [false, true]) {
    let game = fixture({ huCounts: final ? [1, 0, 0] : [0, 0, 0], kongSeats: final ? [0] : [] });
    game = applyAction(game, 0, { type: 'discard', tile: 17 });
    game = applyAction(game, 2, { type: 'hu' });
    const staged = compare(game, 1, { type: 'hu' });
    assert.equal(staged.presentation.stage, 'hu');
    assert.equal(staged.currentSeat, 1);
    assert.equal(staged.phase, 'turn');
    assert.equal(staged.history.filter(event => event.type === 'hu').length, 2);
    assert.equal(staged.history.some(event => event.type === 'finish'), false);
    if (final) assert.equal(continuePresentedGame(staged).phase, 'finished');
  }
});

test('seeded complete games drain to identical states with unchanged old snapshots', () => {
  for (const seed of ['present-1', 'present-2', 'present-3']) {
    let game = createGame({ seed });
    delete game.rules.turnDirection;
    delete game.rules.autoDiscardAfterHu;
    for (let count = 0; game.phase !== 'finished' && count < 700; count++) {
      const seat = game.phase === 'claim'
        ? game.claim.eligibleSeats.find(seat => !game.claim.responses[seat]) : game.currentSeat;
      const actions = getLegalActions(game, seat);
      const action = actions.find(action => action.type === 'hu')
        ?? actions.find(action => action.type.endsWith('Gang'))
        ?? actions.find(action => action.type === 'peng') ?? actions.at(-1);
      game = drain(compare(game, seat, action));
    }
    assert.equal(game.phase, 'finished');
    assert.equal(Object.hasOwn(game.rules, 'autoDiscardAfterHu'), false);
  }
});

test('invalid or missing continuation markers are rejected without mutation', () => {
  const game = createGame({ seed: 'marker' });
  assert.throws(() => continuePresentedGame(game));
  const staged = applyPresentedAction(game, 0, getLegalActions(game, 0)[0]);
  staged.presentation.stage = 'unknown';
  assert.throws(() => continuePresentedGame(staged));
});

// 连续自动出牌必须逐段停住，不能在一个确认中跨过第二家的音画。
// Consecutive automatic discards stop individually instead of crossing the next seat's presentation.
test('consecutive post-hu automatic discards have separate boundaries', () => {
  const game = fixture({ huCounts: [0, 1, 0], head: [6, 7, 8] });
  let staged = compare(game, 0, { type: 'hu' });
  staged = continuePresentedGame(staged);
  assert.equal(staged.presentation.stage, 'discard');
  assert.equal(staged.currentSeat, 0);
  assert.equal(staged.history.filter(event => event.type === 'discard').length, 1);
  staged = continuePresentedGame(staged);
  assert.equal(staged.presentation.stage, 'discard');
  assert.equal(staged.currentSeat, 1);
  assert.equal(staged.history.filter(event => event.type === 'discard').length, 2);
  assert.deepEqual(drain(staged), applyAction(game, 0, { type: 'hu' }));
});

// 抢杠仍先收齐玩家选择；只暂停已成立的杠或已结算的胡，不虚报杠成功。
// Rob-kong still collects choices first; pause only a committed kong or settled hu, never an attempted kong.
test('rob-kong pass and hu paths preserve staged settlement boundaries', () => {
  const waitingForTwo = [0, 1, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17, 17];
  for (const response of ['pass', 'hu']) {
    const game = fixture({
      hands: [[2, 3, 4, 5, 6, 7, 8, 10, 11, 17, 17], waitingForTwo, waitingForTwo],
      melds: [[{ type: 'anGang', tile: 2, tiles: [2, 2, 2, 2] }], [], []],
      drawTile: 2,
      head: [17],
    });
    let staged = compare(game, 0, { type: 'addGang', tile: 2 });
    assert.equal(staged.presentation, undefined);
    assert.equal(staged.claim.kind, 'robKong');
    staged = drain(compare(staged, 2, { type: response }));
    staged = compare(staged, 1, { type: response });
    assert.equal(staged.presentation.stage, response === 'pass' ? 'kong' : 'hu');
    assert.equal(staged.players[0].melds[0].tiles.length, response === 'pass' ? 5 : 4);
  }
});
