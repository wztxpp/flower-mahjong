// 冻结的第二版规则；不能把第三版的新行为写回这些旧局期望。
// Frozen version-two rules: do not replace these saved-game expectations with version-three behavior.
// 阅读说明见 docs/TESTING-READING-GUIDE.md；固定种子与凭证仅为测试，不应移入真实用户数据。
// See docs/TESTING-READING-GUIDE.md; seeded data and test credentials must stay separate from real user data.
import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  applyAction,
  getPlayerView,
  getLegalActions,
  isWinningHand,
  getWaitTiles,
  assertGameInvariants,
  getHuDiagnostic,
  fanToPoints,
} from "../shared/v2-game.js";
const waiting = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
const winning = [...waiting, 17];
const nonWinningKong = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 16, 17];
const pengHand = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 17, 17];
const kongHand = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 17, 17, 17];
// 按指定牌型、牌面与张数组装副露，不自动从任何手牌扣牌。
// Build a meld with the requested kind/tile/count; this alone does not debit a hand.
const meld = (tile, type = "peng", count = type === "peng" ? 3 : 4) => ({
  type,
  tile,
  tiles: Array(count).fill(tile),
});
// 查询真实引擎给出的合法动作，匹配当前辅助函数接收的类型与可选牌面。
// Query actual engine legal actions using the helper’s type and optional tile criteria.
const has = (game, seat, type, tile) =>
  getLegalActions(game, seat).some(
    (action) =>
      action.type === type && (tile === undefined || action.tile === tile),
  );
// 把测试中的动作类型和可选牌面转为引擎请求，返回新状态；省略牌面不发送该字段。
// Convert type/optional tile into an engine request and return the new state, omitting absent tile fields.
const doAction = (game, seat, type, tile) =>
  applyAction(
    game,
    seat,
    tile === undefined
      ? {
          type,
        }
      : {
          type,
          tile,
        },
  );
// 筛选当前场景中的合法动作或已提交事件，不修改原始历史。
// Select legal actions or committed events for the scenario without mutating source history.
const huEvent = (game, seat = 0) =>
  game.history.find((event) => event.type === "hu" && event.seat === seat);
const noZero = waiting.map((tile) => (tile === 0 ? 6 : tile));

/** Eight-copy physical fixture. Prior logical wins reference retired physical tiles. */
// 按本文件的参数构造场景；规则版本、手牌与牌墙由各测试显式选择。不要把 UI 快照误当成完整引擎状态。
// Build the local scenario from its parameters; each test chooses rules, hands and wall. A UI snapshot is not a complete engine state.
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
} = {}) {
  const game = createGame({
    seed: "fixture",
    rules,
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
// 让尚未回应的合法座位依次过牌，直到反应窗关闭；每一步使用返回的新状态。
// Pass each remaining eligible responder until the claim window closes, carrying forward each returned state.
function passAll(game) {
  // 持续推进场景直到 game.phase==='claim' 不再成立；循环内的动作/断言负责保证进展。
  // Advance while game.phase==='claim' holds; actions/assertions inside are responsible for progress.
  while (game.phase === "claim")
    game = doAction(
      game,
      game.claim.eligibleSeats.find((seat) => !game.claim.responses[seat]),
      "pass",
    );
  return game;
}
// 使用固定种子的线性同余序列重放测试动作；仅用于可重复测试，不能替代生产洗牌随机源。
// Use a seeded linear congruential sequence to replay test actions, never as a production shuffle source.
function deterministicRandom(seed) {
  let state = seed + 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
// 场景：v2 固定种子发牌共有 144 张、每种八张，三家手牌数为 14/13/13
// Scenario: v2 deterministic deal has 144 tiles, eight copies, 14/13/13 hands
test("v2 deterministic deal has 144 tiles, eight copies, 14/13/13 hands", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const game = createGame({
    seed: 42,
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.schemaVersion, 2);
  assert.deepEqual(
    game.players.map((player) => player.hand.length),
    [14, 13, 13],
  );
  assert.deepEqual(
    game.players.map((player) => player.winPile),
    [[], [], []],
  );
  assert.equal(game.wall.length, 104);
  assert.equal(game.turnStep, "discard");
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
  assertGameInvariants(createGame());
  assert.deepEqual(
    game,
    createGame({
      seed: 42,
    }),
  );
  assert.notDeepEqual(
    game.wall,
    createGame({
      seed: 43,
    }).wall,
  );
});
// 场景：拒绝格式错误或未知规则，包括不安全的可选叠加配置
// Scenario: rejects malformed and unknown rules, including unsafe optional overlaps
test("rejects malformed and unknown rules, including unsafe optional overlaps", () => {
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  // 逐项覆盖 下列集合；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in the following collection with the same checks, preserving the listed order.
  for (const rules of [
    {
      sevenPairs: "yes",
    },
    {
      baseFan: 0,
    },
    {
      baseFan: 1.5,
    },
    {
      sixPlusCopyFan: -1,
    },
    {
      dragonPoints: {
        9: 50,
      },
    },
    {
      dragonPoints: null,
    },
    {
      repeatHuLock: "never",
    },
    {
      radishScope: "unknown",
    },
    {
      bigSingleOverlap: "both",
    },
    {
      arbitrary: true,
    },
    JSON.parse('{"__proto__":true}'),
  ])
    assert.throws(() =>
      createGame({
        seed: 1,
        rules,
      }),
    );
});
// 场景：验证成胡牌型、七对、副露及花色边界
// Scenario: winning shape, seven pairs, exposed melds and suit boundaries
test("winning shape, seven pairs, exposed melds and suit boundaries", () => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(isWinningHand(winning), true);
  assert.equal(isWinningHand(waiting), false);
  assert.equal(
    isWinningHand([7, 8, 9, 0, 1, 2, 3, 4, 5, 12, 13, 14, 17, 17]),
    false,
  );
  assert.equal(isWinningHand([0, 1, 2, 9, 10, 11, 17, 17], 2), true);
  assert.equal(isWinningHand([0, 1, 2, 9, 10, 11, 17, 17], 1), false);
  assert.equal(isWinningHand(Array(14).fill(0)), false);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const pairs = [0, 0, 0, 0, 2, 2, 4, 4, 6, 6, 9, 9, 11, 11];
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(isWinningHand(pairs), true);
  assert.equal(
    isWinningHand(pairs, 0, {
      sevenPairs: false,
    }),
    false,
  );
  assert.deepEqual(getWaitTiles(waiting), [17]);
  assert.deepEqual(getWaitTiles(winning), []);
});
// 场景：动作不可变且经过验证，拒绝错误回合、手动摸牌、伪造或重复输入
// Scenario: immutable validated actions reject wrong turn, manual draw, forged or duplicate inputs
test("immutable validated actions reject wrong turn, manual draw, forged or duplicate inputs", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const game = createGame({
    seed: 3,
  });
  const before = structuredClone(game);
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  // 逐项覆盖 下列集合；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in the following collection with the same checks, preserving the listed order.
  for (const [seat, action] of [
    [
      1,
      {
        type: "discard",
        tile: 0,
      },
    ],
    [
      0,
      {
        type: "draw",
      },
    ],
    [
      0,
      {
        type: "discard",
        tile: 18,
      },
    ],
    [
      0,
      {
        type: "discard",
        tile: "0",
      },
    ],
    [
      0,
      {
        type: "explode",
      },
    ],
    [
      0,
      {
        type: "discard",
        tile: game.players[0].hand[0],
        cheat: true,
      },
    ],
    [
      3,
      {
        type: "hu",
      },
    ],
    [0, null],
  ])
    assert.throws(() => applyAction(game, seat, action));
  assert.deepEqual(game, before);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const next = doAction(game, 0, "discard", game.players[0].hand[0]);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.notEqual(game, next);
  assert.deepEqual(game, before);
  assert.equal(next.revision, 1);
  assertGameInvariants(next);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const legacy = {
    ...game,
  };
  delete legacy.schemaVersion;
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  assert.throws(
    () => doAction(legacy, 0, "discard", game.players[0].hand[0]),
    /旧牌局/,
  );
});
// 场景：只有全部有资格的响应者过牌后，才原子执行下一次自然摸牌
// Scenario: next natural draw happens atomically only after all eligible claims pass
test("next natural draw happens atomically only after all eligible claims pass", () => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let game = doAction(
    fixture({
      head: [6],
    }),
    0,
    "discard",
    17,
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const wall = game.wall.length;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 2, "pass");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.phase, "claim");
  assert.equal(game.wall.length, wall);
  assert.equal(game.lastDraw, null);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 1, "pass");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.phase, "turn");
  assert.equal(game.currentSeat, 1);
  assert.equal(game.turnStep, "discard");
  assert.equal(game.lastDraw.tile, 6);
  assert.equal(game.wall.length, wall - 1);
  assert.equal(has(game, 1, "draw"), false);
  assert.equal(game.history.at(-1).tile, undefined);
  assert.equal(getPlayerView(game, 1).drawnTile, 6);
  assert.equal(getPlayerView(game, 2).drawnTile, null);
});
// 场景：首次自摸增加六张牌尾萝卜、记录一张实体胡牌，并对锁定的续摸自动出牌
// Scenario: first selfdraw adds six tail radishes, records one physical win and auto-discards locked continuation
test("first selfdraw adds six tail radishes, records one physical win and auto-discards locked continuation", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    head: [17, 6],
    tail: [1, 2, 3, 4, 5, 6],
  });
  const wall = game.wall.length;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(game.players[0].radishes, [6, 5, 4, 3, 2, 1]);
  assert.equal(game.players[0].hand.length, 13);
  assert.equal(game.players[0].huCount, 1);
  assert.deepEqual(game.players[0].winPile, [
    {
      tile: 17,
      source: "selfDraw",
      virtual: false,
    },
  ]);
  assert.deepEqual(game.retiredTiles, [
    {
      seat: 0,
      tile: 17,
    },
  ]);
  assert.equal(game.wall.length, wall - 8);
  assert.equal(game.currentSeat, 1);
  assert.equal(game.players[0].huLockActive, true);
  assert.equal(game.discards[0].tile, 17);
  assert.equal(
    game.history.find((event) => event.type === "discard").automatic,
    true,
  );
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：胡后手牌锁定：只能打出刚摸到的牌，或通过过牌跳过该牌
// Scenario: post-hu hand is locked: only just-drawn tile may be discarded, or pass skips it
test("post-hu hand is locked: only just-drawn tile may be discarded, or pass skips it", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    huCounts: [1, 0, 0],
    head: [6],
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(
    getLegalActions(game, 0).filter((action) => action.type === "discard"),
    [
      {
        type: "discard",
        tile: 17,
      },
    ],
  );
  assert.ok(has(game, 0, "hu") && has(game, 0, "pass"));
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const before = structuredClone(game);
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  assert.throws(() => doAction(game, 0, "discard", 0));
  assert.deepEqual(game, before);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "pass");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.discards[0].tile, 17);
  assert.equal(game.currentSeat, 1);
  assert.equal(game.lastDraw.tile, 6);
});
// 场景：立即续摸仍被锁定后，完整自然座位轮转会解除相同听口的锁
// Scenario: full natural seat cycle unlocks same wait after immediate continuation remains locked
test("full natural seat cycle unlocks same wait after immediate continuation remains locked", () => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let game = doAction(
    fixture({
      head: [17, 6, 7, 17],
    }),
    0,
    "hu",
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.currentSeat, 1);
  assert.equal(game.players[0].huLockActive, true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = passAll(doAction(game, 1, "discard", 6));
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.currentSeat, 2);
  assert.equal(game.lastDraw.tile, 7);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = passAll(doAction(game, 2, "discard", 7));
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.currentSeat, 0);
  assert.equal(game.lastDraw.tile, 17);
  assert.equal(game.players[0].huLockActive, false);
  assert.equal(has(game, 0, "hu"), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[0].huCount, 2);
  assert.equal(game.players[0].winPile.length, 2);
  assert.equal(game.players[0].radishes.length, 6);
  assert.equal(game.retiredTiles.length, 2);
});
// 场景：重叠听口锁定胡牌，不相交听口及替代锁定规则均显式处理
// Scenario: overlapping waits lock hu; disjoint waits and alternative lock rule are explicit
test("overlapping waits lock hu; disjoint waits and alternative lock rule are explicit", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    huCounts: [1, 0, 0],
    locks: [[16, 17], [], []],
    activeLocks: [true, false, false],
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 0, "hu"), false);
  assert.equal(getHuDiagnostic(game, 0).code, "WAIT_LOCK");
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  game = fixture({
    huCounts: [1, 0, 0],
    locks: [[16], [], []],
    activeLocks: [true, false, false],
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 0, "hu"), true);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  game = fixture({
    huCounts: [1, 0, 0],
    locks: [[16], [], []],
    activeLocks: [true, false, false],
    rules: {
      allowChangedWaitDuringLock: false,
    },
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 0, "hu"), false);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(
    fixture({
      head: [17, 6, 7, 17],
      rules: {
        repeatHuLock: "untilWaitChange",
      },
    }),
    0,
    "hu",
  );
  game = passAll(doAction(game, 1, "discard", 6));
  game = passAll(doAction(game, 2, "discard", 7));
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[0].huLockActive, true);
  assert.equal(game.players[0].huCount, 1);
});
// 场景：已胡玩家不能碰牌，其弃牌也不能被碰
// Scenario: already-hu players cannot peng and their discards cannot be penged
test("already-hu players cannot peng and their discards cannot be penged", () => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let game = doAction(
    fixture({
      hands: [winning, pengHand, waiting],
      huCounts: [0, 1, 0],
    }),
    0,
    "discard",
    17,
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 1, "peng"), false);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(
    fixture({
      hands: [winning, pengHand, waiting],
      huCounts: [1, 0, 0],
    }),
    0,
    "discard",
    17,
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 1, "peng"), false);
  assert.equal(has(game, 2, "hu"), false);
  assert.notEqual(game.phase, "claim");
});
// 场景：普通胡后弃牌受保护，但杠后弃牌允许被胡并按自摸方式付款
// Scenario: ordinary post-hu discard is protected but post-kong discard allows hu and selfdraw-style payment
test("ordinary post-hu discard is protected but post-kong discard allows hu and selfdraw-style payment", () => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let game = doAction(
    fixture({
      huCounts: [1, 0, 0],
      kongSeats: [0],
    }),
    0,
    "discard",
    17,
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 1, "hu"), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 1, "hu");
  game = doAction(game, 2, "pass");
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const event = huEvent(game, 1);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.equal(event.source, "kongDiscard");
  assert.equal(event.payments.length, 3);
  assert.ok(game.players[0].score < 0 && game.players[2].score < 0);
  assert.equal(game.players[0].pendingKongDiscard, false);
});
// 场景：同时胡牌不受响应顺序影响，并区分实体与虚拟胡牌引用
// Scenario: simultaneous hu is response-order independent with physical and virtual win references
test("simultaneous hu is response-order independent with physical and virtual win references", () => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  // 用给定回应顺序执行同一抢牌场景，返回结果供顺序无关性比较。
  // Run the same claim scenario in the supplied response order and return its result for order-independence comparisons.
  function result(order) {
    let game = doAction(
      fixture({
        head: [6, 7],
      }),
      0,
      "discard",
      17,
    );
    // 逐项覆盖 order；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in order with the same checks, preserving the listed order.
    for (const seat of order) game = doAction(game, seat, "hu");
    return game;
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const game = result([1, 2]);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(game, result([2, 1]));
  assert.deepEqual(
    game.players.map((player) => player.huCount),
    [0, 1, 1],
  );
  assert.deepEqual(game.discards[0].huSeats, [1, 2]);
  assert.equal(game.discards[0].claimedBy, undefined);
  assert.deepEqual(game.players[1].winPile, [
    {
      tile: 17,
      source: "discard",
      virtual: false,
      discardIndex: 0,
    },
  ]);
  assert.deepEqual(game.players[2].winPile, [
    {
      tile: 17,
      source: "discard",
      virtual: true,
      discardIndex: 0,
    },
  ]);
  assert.equal(huEvent(game, 1).payments.length, 2);
  assert.equal(huEvent(game, 2).payments.length, 2);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：第三家胡牌须待整批同时响应结算后才结束，不额外摸牌
// Scenario: third winner ends only after entire simultaneous batch; no extra draw
test("third winner ends only after entire simultaneous batch; no extra draw", () => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let game = doAction(
    fixture({
      huCounts: [1, 0, 0],
      kongSeats: [0],
      head: [6],
    }),
    0,
    "discard",
    17,
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const wall = game.wall.length;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 2, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.phase, "claim");
  assert.deepEqual(
    game.players.map((player) => player.huCount),
    [1, 0, 0],
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 1, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.phase, "finished");
  assert.equal(game.finishReason, "allPlayersHu");
  assert.deepEqual(
    game.players.map((player) => player.huCount),
    [1, 1, 1],
  );
  assert.equal(game.wall.length, wall - 12);
  assert.equal(
    game.history.some((event) => event.type === "draw"),
    false,
  );
  assert.equal(game.history.filter((event) => event.type === "hu").length, 2);
  assert.equal(game.players[2].winPile[0].virtual, true);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：第三家自摸胡牌立即结束，保留剩余牌墙并完成积分结算
// Scenario: third selfdraw winner ends immediately with wall remaining and settled score
test("third selfdraw winner ends immediately with wall remaining and settled score", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    huCounts: [0, 1, 1],
    head: [6],
  });
  const wall = game.wall.length;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.finishReason, "allPlayersHu");
  assert.equal(game.wall.length, wall - 6);
  assert.equal(
    game.history.some((event) => event.type === "draw"),
    false,
  );
  assert.equal(game.players[0].hand.length, 13);
  assert.equal(game.players[0].winPile.length, 1);
  assert.ok(game.players[0].score > 0);
  assert.deepEqual(getLegalActions(game, 0), []);
});
// 场景：可关闭一炮多响，被拒绝的胡牌者不会获得虚拟胡牌引用
// Scenario: multiple winners can be disabled without adding a virtual win for rejected winner
test("multiple winners can be disabled without adding a virtual win for rejected winner", () => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let game = doAction(
    fixture({
      rules: {
        multipleWinners: false,
      },
    }),
    0,
    "discard",
    17,
  );
  game = doAction(game, 2, "hu");
  game = doAction(game, 1, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(
    game.players.map((player) => player.huCount),
    [0, 1, 0],
  );
  assert.equal(game.players[2].winPile.length, 0);
});
// 场景：待裁决选择保持私密，重复或无关响应被拒绝
// Scenario: pending choices remain private and duplicate/unrelated claims are rejected
test("pending choices remain private and duplicate/unrelated claims are rejected", () => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let game = doAction(fixture(), 0, "discard", 17);
  game = doAction(game, 2, "hu");
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const view = getPlayerView(game, 1);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(view.claim.respondedSeats, [2]);
  assert.equal(view.claim.responses, undefined);
  assert.equal(view.claim.options, undefined);
  assert.equal(getHuDiagnostic(game, 2).code, "ALREADY_RESPONDED");
  assert.throws(() => doAction(game, 2, "pass"));
  assert.throws(() => doAction(game, 0, "pass"));
});
// 场景：双方都碰时等待两人响应，再由顺时针最近者获得牌，不受响应先后影响
// Scenario: equal peng claims wait for both players then nearest clockwise wins in either order
test("equal peng claims wait for both players then nearest clockwise wins in either order", () => {
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  // 逐项覆盖 [[1,2],[2,1]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [[1,2],[2,1]] with the same checks, preserving the listed order.
  for (const order of [
    [1, 2],
    [2, 1],
  ]) {
    let game = doAction(
      fixture({
        hands: [winning, pengHand, pengHand],
      }),
      0,
      "discard",
      17,
    );
    const wall = game.wall.length;
    game = doAction(game, order[0], "peng", 17);
    assert.equal(game.phase, "claim");
    assert.equal(game.players[1].melds.length, 0);
    assert.equal(game.wall.length, wall);
    game = doAction(game, order[1], "peng", 17);
    assert.equal(game.currentSeat, 1);
    assert.equal(game.discards[0].claimedBy, 1);
    assert.equal(game.players[1].hand.length, 11);
    assert.equal(game.players[2].melds.length, 0);
    assert.equal(game.lastDraw, null);
    assert.equal(has(game, 1, "hu"), false);
    // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
    // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
    assertGameInvariants(game);
  }
});
// 场景：双方响应后较远的杠胜过较近的碰，不受响应先后影响
// Scenario: farther kong beats nearer peng after both reply, independent of response order
test("farther kong beats nearer peng after both reply, independent of response order", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const results = [];
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 [[1,2],[2,1]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [[1,2],[2,1]] with the same checks, preserving the listed order.
  for (const order of [
    [1, 2],
    [2, 1],
  ]) {
    let game = doAction(
      fixture({
        hands: [winning, pengHand, kongHand],
        head: [6],
        tail: [7],
      }),
      0,
      "discard",
      17,
    );
    const wall = game.wall.length;
    game = doAction(game, order[0], order[0] === 1 ? "peng" : "mingGang", 17);
    assert.equal(game.phase, "claim");
    assert.equal(game.wall.length, wall);
    assert.deepEqual(
      game.players.map((player) => player.score),
      [0, 0, 0],
    );
    game = doAction(game, order[1], order[1] === 1 ? "peng" : "mingGang", 17);
    assert.equal(game.currentSeat, 2);
    assert.equal(game.players[1].melds.length, 0);
    assert.equal(game.players[2].melds[0].type, "mingGang");
    assert.equal(game.discards[0].claimedBy, 2);
    assert.deepEqual(
      game.players.map((player) => player.score),
      [-2, 0, 2],
    );
    results.push(game);
  }
  assert.deepEqual(results[0], results[1]);
});
// 场景：同优先级杠按顺时针裁决，胡优先于杠和碰
// Scenario: equal kong claims use clockwise order; hu outranks kong and peng
test("equal kong claims use clockwise order; hu outranks kong and peng", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const dealer = [...waiting, 16];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let game = doAction(
    fixture({
      hands: [dealer, kongHand, kongHand],
      head: [6],
    }),
    0,
    "discard",
    17,
  );
  game = doAction(game, 2, "mingGang", 17);
  game = doAction(game, 1, "mingGang", 17);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.discards[0].claimedBy, 1);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(
    fixture({
      hands: [winning, kongHand, waiting],
    }),
    0,
    "discard",
    17,
  );
  game = doAction(game, 1, "mingGang", 17);
  game = doAction(game, 2, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[1].melds.length, 0);
  assert.equal(game.players[2].huCount, 1);
  assert.equal(
    game.history.some((event) => event.type === "mingGang"),
    false,
  );
});
// 场景：手中及他人弃牌同时允许胡与杠时，只保留胡牌选择
// Scenario: hu suppresses a simultaneous kong choice in hand and on another player discard
test("hu suppresses a simultaneous kong choice in hand and on another player discard", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17];
  let game = fixture({
    hands: [hand, waiting, waiting],
    drawTile: 0,
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 0, "hu"), true);
  assert.equal(has(game, 0, "anGang", 0), false);
  assert.throws(() => doAction(game, 0, "anGang", 0));
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const base = [...hand];
  base.splice(base.indexOf(0), 1);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(
    fixture({
      hands: [winning, base, waiting],
    }),
    0,
    "discard",
    0,
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 1, "hu"), true);
  assert.equal(has(game, 1, "mingGang", 0), false);
});
// 场景：暗杠向每名对手支付 2 分，先翻牌尾萝卜再从牌墙头补牌，杠牌牌值保持私密
// Scenario: concealed kong pays each opponent 2, tail radish then head replacement; identity stays private
test("concealed kong pays each opponent 2, tail radish then head replacement; identity stays private", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    hands: [nonWinningKong, waiting, waiting],
    head: [6],
    tail: [7],
    drawTile: 0,
  });
  const wall = game.wall.length;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "anGang", 0);
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.deepEqual(
    game.players.map((player) => player.score),
    [4, -2, -2],
  );
  assert.deepEqual(game.players[0].radishes, [7]);
  assert.equal(game.lastDraw.tile, 6);
  assert.equal(game.players[0].hand.length, 11);
  assert.equal(game.wall.length, wall - 2);
  assert.equal(game.players[0].pendingKongDiscard, true);
  assert.equal(game.players[0].kongCount, 1);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const view = getPlayerView(game, 1);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(view.players[0].melds[0].tiles, [null, null, null, null]);
  assert.equal(
    game.history.find((event) => event.type === "anGang").tile,
    undefined,
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const before = structuredClone(game);
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  assert.throws(() => doAction(game, 0, "anGang", 0));
  assert.deepEqual(game, before);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：碰牌加杠向每名对手支付 1 分，保持副露组数并获得一张萝卜
// Scenario: peng upgrade pays each opponent 1, preserves meld count and grants one radish
test("peng upgrade pays each opponent 1, preserves meld count and grants one radish", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 1, 2, 3, 9, 10, 11, 12, 13, 16, 17];
  let game = fixture({
    hands: [hand, waiting, waiting],
    melds: [[meld(0)], [], []],
    head: [6],
    tail: [7],
    drawTile: 0,
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "buGang", 0);
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.deepEqual(
    game.players.map((player) => player.score),
    [2, -1, -1],
  );
  assert.equal(game.players[0].melds.length, 1);
  assert.equal(game.players[0].melds[0].tiles.length, 4);
  assert.deepEqual(game.players[0].radishes, [7]);
  assert.equal(game.lastDraw.tile, 6);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：已有杠仅可加入第五张，另向双方各付 1 分、增加萝卜并补牌
// Scenario: existing kong can add exactly a fifth tile, with another 1 each, radish and replacement
test("existing kong can add exactly a fifth tile, with another 1 each, radish and replacement", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    hands: [nonWinningKong, waiting, waiting],
    head: [0, 6],
    tail: [7, 8],
    drawTile: 0,
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "anGang", 0);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 0, "addGang", 0), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "addGang", 0);
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.deepEqual(
    game.players.map((player) => player.score),
    [6, -3, -3],
  );
  assert.equal(game.players[0].melds[0].tiles.length, 5);
  assert.equal(game.players[0].melds.length, 1);
  assert.deepEqual(game.players[0].radishes, [8, 7]);
  assert.equal(game.lastDraw.tile, 6);
  assert.equal(game.players[0].kongCount, 2);
  assert.equal(getPlayerView(game, 1).players[0].melds[0].tiles.length, 5);
  assert.equal(
    game.history.find((event) => event.type === "addGang").tile,
    undefined,
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 1, 2, 3, 9, 10, 11, 12, 13, 16, 17];
  game = fixture({
    hands: [hand, waiting, waiting],
    melds: [[meld(0, "anGang", 5)], [], []],
    drawTile: 0,
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 0, "addGang", 0), false);
  assert.throws(() => doAction(game, 0, "addGang", 0));
});
// 场景：胡后暗杠保留完整听口集合，补牌绝不解除再次胡牌的锁
// Scenario: post-hu concealed kong preserves whole wait set; replacement never unlocks repeat hu
test("post-hu concealed kong preserves whole wait set; replacement never unlocks repeat hu", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 0, 0, 0, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
  let game = fixture({
    hands: [hand, waiting, waiting],
    drawTile: 0,
    huCounts: [1, 0, 0],
    locks: [[17], [], []],
    activeLocks: [true, false, false],
    head: [17, 6],
    tail: [7],
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 0, "anGang", 0), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "anGang", 0);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[0].huLockActive, true);
  assert.equal(game.players[0].huCount, 1);
  assert.equal(game.discards[0].tile, 17);
  assert.equal(game.discards[0].afterKong, true);
  assert.equal(
    game.history.some((event) => event.type === "hu"),
    false,
  );
  assert.equal(game.phase, "claim");
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const changing = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17];
  game = fixture({
    hands: [changing, waiting, waiting],
    drawTile: 0,
    huCounts: [1, 0, 0],
    activeLocks: [true, false, false],
    locks: [[17], [], []],
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 0, "anGang", 0), false);
});
// 场景：杠必须同时有牌尾萝卜和牌墙头补牌可用，拒绝时不转移积分
// Scenario: a kong requires both a tail radish and head replacement; rejection never transfers points
test("a kong requires both a tail radish and head replacement; rejection never transfers points", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const game = fixture({
    hands: [nonWinningKong, waiting, waiting],
    wallCount: 1,
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 0, "anGang", 0), false);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const before = structuredClone(game);
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  assert.throws(() => doAction(game, 0, "anGang", 0));
  assert.deepEqual(game, before);
});
// 场景：首次胡牌在既有杠萝卜基础上增加六张，不重置或写死为八张
// Scenario: first hu adds six to earlier kong radishes rather than resetting or hardcoding eight
test("first hu adds six to earlier kong radishes rather than resetting or hardcoding eight", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    radishes: [[6, 7, 8], [], []],
    tail: [1, 2, 3, 4, 5, 15],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(game.players[0].radishes, [6, 7, 8, 15, 5, 4, 3, 2, 1]);
  assert.equal(huEvent(game).newRadishes.length, 6);
});
// 场景：番数换分使用 1、2、4、8、10、12、14、16，之后每番加 2 分
// Scenario: fan mapping uses 1,2,4,8,10,12,14,16 and +2 thereafter
test("fan mapping uses 1,2,4,8,10,12,14,16 and +2 thereafter", () => {
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.deepEqual(
    Array.from(
      {
        length: 10,
      },
      (_, i) => fanToPoints(i + 1),
    ),
    [1, 2, 4, 8, 10, 12, 14, 16, 18, 20],
  );
  // 逐项覆盖 [0,-1,1.2,Infinity,'2']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [0,-1,1.2,Infinity,'2'] with the same checks, preserving the listed order.
  for (const value of [0, -1, 1.2, Infinity, "2"])
    assert.throws(() => fanToPoints(value));
});
// 场景：同牌番统计手牌、副露及既往胡牌区，恰好四张加一番、五张加两番
// Scenario: copy fan counts hand, meld and previous win pile, exactly four +1 and five +2
test("copy fan counts hand, meld and previous win pile, exactly four +1 and five +2", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 [[[0],1,2],[[0,0],2,4]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [[[0],1,2],[[0,0],2,4]] with the same checks, preserving the listed order.
  for (const [previous, bonus, points] of [
    [[0], 1, 2],
    [[0, 0], 2, 4],
  ]) {
    let game = fixture({
      hands: [hand, waiting, waiting],
      melds: [[meld(0)], [], []],
      priorWins: [previous, [], []],
      huCounts: [1, 0, 0],
    });
    game = doAction(game, 0, "hu");
    const score = huEvent(game).score;
    assert.equal(score.copyFanBonus, bonus);
    assert.equal(score.fan, 1 + bonus);
    assert.equal(score.fanPoints, points);
    assert.equal(score.total, points);
    assert.equal(score.handCounts, undefined);
  }
});
// 场景：本次胡牌仅计数一次，不在手牌和 winPile 中重复统计
// Scenario: current winning tile is counted once, not once in hand and again in winPile
test("current winning tile is counted once, not once in hand and again in winPile", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 0, 0, 1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 [[],[0]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [[],[0]] with the same checks, preserving the listed order.
  for (const previous of [[], [0]]) {
    let game = fixture({
      hands: [hand, waiting, waiting],
      priorWins: [previous, [], []],
      huCounts: [1, 0, 0],
      drawTile: 0,
    });
    game = doAction(game, 0, "hu");
    assert.equal(huEvent(game).score.copyFanBonus, previous.length);
  }
});
// 场景：被胡弃牌与原牌河引用不会在计分时重复统计
// Scenario: claimed winning tile and original river reference do not double count in scoring
test("claimed winning tile and original river reference do not double count in scoring", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 0, 1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let game = doAction(
    fixture({
      hands: [winning, hand, waiting],
      priorWins: [[], [0], []],
      huCounts: [0, 1, 0],
    }),
    0,
    "discard",
    0,
  );
  game = doAction(game, 1, "hu");
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(huEvent(game, 1).score.copyFanBonus, 1);
  assert.equal(huEvent(game, 1).score.fan, 2);
  assert.equal(game.players[1].winPile.length, 2);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：五张杠贡献两番，六张及以上同牌不凭空增加额外番
// Scenario: five-tile kong contributes two fan, but six-plus copies do not invent extra fan
test("five-tile kong contributes two fan, but six-plus copies do not invent extra fan", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let game = doAction(
    fixture({
      hands: [hand, waiting, waiting],
      melds: [[meld(0, "anGang", 5)], [], []],
      huCounts: [1, 0, 0],
    }),
    0,
    "hu",
  );
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(huEvent(game).score.copyFanBonus, 2);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const six = [0, 0, 0, 0, 0, 0, 3, 4, 5, 9, 10, 11, 17, 17];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(
    fixture({
      hands: [six, noZero, noZero],
      huCounts: [1, 0, 0],
    }),
    0,
    "hu",
  );
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(huEvent(game).score.copyFanBonus, 0);
  assert.equal(huEvent(game).score.dragonBonus, 10);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(
    fixture({
      hands: [six, noZero, noZero],
      huCounts: [1, 0, 0],
      rules: {
        sixPlusCopyFan: 3,
      },
    }),
    0,
    "hu",
  );
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(huEvent(game).score.copyFanBonus, 3);
  assert.equal(huEvent(game).score.fanPoints, 8);
});
// 场景：每次胡牌都根据累计胡牌重新计算同牌番
// Scenario: every hu recalculates copy fan using accumulated winning tiles
test("every hu recalculates copy fan using accumulated winning tiles", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 [[[0],2],[[0,0],3]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [[[0],2],[[0,0],3]] with the same checks, preserving the listed order.
  for (const [past, fan] of [
    [[0], 2],
    [[0, 0], 3],
  ]) {
    let game = doAction(
      fixture({
        hands: [hand, waiting, waiting],
        melds: [[meld(0)], [], []],
        priorWins: [past, [], []],
        huCounts: [past.length, 0, 0],
      }),
      0,
      "hu",
    );
    assert.equal(huEvent(game).score.fan, fan);
    assert.equal(game.players[0].lastScoreBreakdown.fan, fan);
  }
});
// 场景：普通牌型与七对均为一底番，不凭空增加对子牌型奖励
// Scenario: ordinary and seven-pair shapes have one base fan without invented pair-hand bonus
test("ordinary and seven-pair shapes have one base fan without invented pair-hand bonus", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const pairs = [0, 0, 2, 2, 4, 4, 6, 6, 9, 9, 11, 11, 13, 13];
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 [winning,pairs]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [winning,pairs] with the same checks, preserving the listed order.
  for (const hand of [winning, pairs]) {
    const game = doAction(
      fixture({
        hands: [hand, waiting, waiting],
        huCounts: [1, 0, 0],
      }),
      0,
      "hu",
    );
    assert.equal(huEvent(game).score.fan, 1);
    assert.equal(huEvent(game).score.total, 1);
  }
});
// 场景：萝卜只计本次胡牌一次，再加到番数换算后的分值上
// Scenario: radishes count current win once and are added to mapped fan points
test("radishes count current win once and are added to mapped fan points", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    tail: [6, 7, 8, 15, 17, 17],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(huEvent(game).score.radishBonus, 4);
  assert.equal(huEvent(game).score.fanPoints, 1);
  assert.equal(huEvent(game).score.total, 5);
  assert.deepEqual(
    game.players.map((player) => player.score),
    [10, -5, -5],
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(
    fixture({
      hands: [hand, waiting, waiting],
      melds: [[meld(0)], [], []],
      priorWins: [[0], [], []],
      huCounts: [1, 0, 0],
      radishes: [[0], [], []],
    }),
    0,
    "hu",
  );
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(huEvent(game).score.fanPoints, 2);
  assert.equal(huEvent(game).score.radishBonus, 3);
  assert.equal(huEvent(game).score.total, 5);
});
// 场景：萝卜默认使用本人牌池，共享范围及副露是否参与均可配置
// Scenario: radishes default to own pile; shared scope and meld participation are configurable
test("radishes default to own pile; shared scope and meld participation are configurable", () => {
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 [[{},0],[{radishScope:'all'},2]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [[{},0],[{radishScope:'all'},2]] with the same checks, preserving the listed order.
  for (const [rules, expected] of [
    [{}, 0],
    [
      {
        radishScope: "all",
      },
      2,
    ],
  ]) {
    const game = doAction(
      fixture({
        huCounts: [1, 0, 0],
        radishes: [[], [17], []],
        rules,
      }),
      0,
      "hu",
    );
    assert.equal(huEvent(game).score.radishBonus, expected);
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const game = doAction(
    fixture({
      hands: [hand, waiting, waiting],
      melds: [[meld(0)], [], []],
      huCounts: [1, 0, 0],
      radishes: [[0], [], []],
      rules: {
        radishCountsMelds: false,
      },
    }),
    0,
    "hu",
  );
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(huEvent(game).score.radishBonus, 0);
});
// 场景：六、七、八张龙保留独立于番数的 10、20、40 分，叠加或取最大值须显式配置
// Scenario: dragon 6/7/8 retains 10/20/40 separate from fan with explicit additive/max overlap
test("dragon 6/7/8 retains 10/20/40 separate from fan with explicit additive/max overlap", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17];
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 [[6,10],[7,20],[8,40]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [[6,10],[7,20],[8,40]] with the same checks, preserving the listed order.
  for (const [count, expected] of [
    [6, 10],
    [7, 20],
    [8, 40],
  ]) {
    const game = doAction(
      fixture({
        hands: [hand, noZero, noZero],
        huCounts: [1, 0, 0],
        radishes: [Array(count - 4).fill(0), [], []],
      }),
      0,
      "hu",
    );
    assert.equal(huEvent(game).score.dragonBonus, expected);
    assert.equal(huEvent(game).score.fan, 2);
    assert.equal(huEvent(game).score.total, 2 + 4 * (count - 4) + expected);
  }
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const game = doAction(
    fixture({
      hands: [hand, noZero, noZero],
      huCounts: [1, 0, 0],
      radishes: [[0, 0], [], []],
      rules: {
        stackDragonBonus: false,
        dragonPoints: {
          6: 13,
        },
      },
    }),
    0,
    "hu",
  );
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(huEvent(game).score.total, 13);
});
// 场景：大单吊默认向每名对手恰好收取 50 分，即使是荣胡
// Scenario: big single wait charges each opponent exactly 50 by default, even on a discard
test("big single wait charges each opponent exactly 50 by default, even on a discard", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const melds = [meld(0), meld(3), meld(9), meld(12)];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let game = doAction(
    fixture({
      hands: [winning, [17], waiting],
      melds: [[], melds, []],
      head: [6],
    }),
    0,
    "discard",
    17,
  );
  game = doAction(game, 1, "hu");
  game = doAction(game, 2, "pass");
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const event = huEvent(game, 1);
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(event.score.bigSingle, true);
  assert.equal(event.score.bigSinglePoints, 50);
  assert.equal(event.score.total, 50);
  assert.equal(event.score.overlapPolicy, "exclusive");
  assert.deepEqual(
    game.players.map((player) => player.score),
    [-50, 100, -50],
  );
  assert.equal(event.payments.length, 3);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：大单吊自摸与暂定的累加叠加规则均显式且可配置
// Scenario: big single selfdraw and provisional additive overlap are explicit and configurable
test("big single selfdraw and provisional additive overlap are explicit and configurable", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const melds = [meld(0), meld(3), meld(9), meld(12)];
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 [[{},50],[{bigSingleOverlap:'additive'},51]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [[{},50],[{bigSingleOverlap:'additive'},51]] with the same checks, preserving the listed order.
  for (const [rules, expected] of [
    [{}, 50],
    [
      {
        bigSingleOverlap: "additive",
      },
      51,
    ],
  ]) {
    const game = doAction(
      fixture({
        hands: [[17, 17], waiting, waiting],
        melds: [melds, [], []],
        huCounts: [1, 0, 0],
        rules,
      }),
      0,
      "hu",
    );
    assert.equal(huEvent(game).score.total, expected);
    assert.deepEqual(
      game.players.map((player) => player.score),
      [2 * expected, -expected, -expected],
    );
  }
});
// 场景：诊断能明确识别实际自摸及荣胡
// Scenario: diagnostic positively identifies both actual selfdraw and discard wins
test("diagnostic positively identifies both actual selfdraw and discard wins", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(getHuDiagnostic(game, 0), {
    canHu: true,
    code: "AVAILABLE",
    message: "这张牌可以自摸胡牌。",
    tile: 17,
    waitTiles: [17],
  });
  assert.equal(has(game, 0, "hu"), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "discard", 17);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(getHuDiagnostic(game, 1).canHu, true);
  assert.equal(has(game, 1, "hu"), true);
  assert.equal(getHuDiagnostic(game, 0).code, "WRONG_TURN");
});
// 场景：诊断私密地解释牌型、听口锁、受保护弃牌、错误回合及待响应状态
// Scenario: diagnostics explain shape, wait lock, protected discard, wrong turn and pending response privately
test("diagnostics explain shape, wait lock, protected discard, wrong turn and pending response privately", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    hands: [[...waiting, 16], waiting, waiting],
    drawTile: 16,
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(getHuDiagnostic(game, 0).code, "SHAPE");
  assert.deepEqual(getHuDiagnostic(game, 0).waitTiles, [17]);
  assert.equal(getHuDiagnostic(game, 1).code, "WRONG_TURN");
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  game = fixture({
    huCounts: [1, 0, 0],
    locks: [[17], [], []],
    activeLocks: [true, false, false],
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(getHuDiagnostic(game, 0).code, "WAIT_LOCK");
  // A protected discard can still have a legal kong claimant; diagnostic never reads others' hands.
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(
    fixture({
      hands: [winning, kongHand, waiting],
      huCounts: [1, 0, 0],
    }),
    0,
    "discard",
    17,
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.phase, "claim");
  assert.equal(getHuDiagnostic(game, 2).code, "PROTECTED_DISCARD");
  assert.equal(has(game, 2, "hu"), false);
  assert.ok(
    game.history.every((event) => !Object.hasOwn(event, "huDiagnostic")),
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const view = getPlayerView(game, 2);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(view.huDiagnostic.code, "PROTECTED_DISCARD");
  assert.equal(view.players[0].huDiagnostic, undefined);
});
// 场景：私有视图隐藏牌墙、对手手牌、摸牌与锁定信息，诊断不依赖这些隐藏数据
// Scenario: private view hides wall, opposing hands/draws/locks and diagnostic is independent of them
test("private view hides wall, opposing hands/draws/locks and diagnostic is independent of them", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const game = createGame({
    seed: 44,
  });
  game.players[1].lockedWaits = [4, 7];
  const view = getPlayerView(game, 0);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(view.schemaVersion, 2);
  assert.equal(view.players[1].hand, undefined);
  assert.equal(view.players[2].hand, undefined);
  assert.equal(view.players[1].lockedWaits, undefined);
  assert.equal(view.wall, undefined);
  assert.equal(view.seed, undefined);
  assert.equal(view.lastDraw, undefined);
  assert.equal(getPlayerView(game, 1).drawnTile, null);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const changed = structuredClone(game);
  [changed.players[1].hand, changed.players[2].hand] = [
    changed.players[2].hand,
    changed.players[1].hand,
  ];
  changed.players[1].lockedWaits = [0, 17];
  changed.players[2].huLockActive = true;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(getHuDiagnostic(game, 0), getHuDiagnostic(changed, 0));
  assert.deepEqual(getPlayerView(game, 0), getPlayerView(changed, 0));
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  view.players[0].hand[0] = 99;
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  assert.notEqual(game.players[0].hand[0], 99);
  assert.throws(() => getPlayerView(game, -1));
  assert.throws(() => getHuDiagnostic(game, 4));
});
// 场景：短牌墙首次胡牌消耗剩余萝卜，并一致地结束牌局
// Scenario: short wall first hu consumes remaining radishes and terminates consistently
test("short wall first hu consumes remaining radishes and terminates consistently", () => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const game = doAction(
    fixture({
      wallCount: 3,
    }),
    0,
    "hu",
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.phase, "finished");
  assert.equal(game.finishReason, "wallExhausted");
  assert.equal(game.wall.length, 0);
  assert.equal(game.players[0].radishes.length, 3);
  assert.equal(game.players[0].hand.length, 13);
  assert.equal(getHuDiagnostic(game, 0).code, "FINISHED");
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：最后摸到的牌仍可行动，其最终响应先结算再因牌墙耗尽结束
// Scenario: last drawn tile remains playable and its final claims settle before wall ends
test("last drawn tile remains playable and its final claims settle before wall ends", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    hands: [[...waiting, 6], waiting, waiting],
    drawTile: 6,
    head: [17],
    wallCount: 1,
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = passAll(doAction(game, 0, "discard", 6));
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  assert.equal(game.wall.length, 0);
  assert.equal(game.currentSeat, 1);
  assert.equal(game.phase, "turn");
  assert.equal(has(game, 1, "hu"), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 1, "discard", 17);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.phase, "claim");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  // 逐项覆盖 [2,0]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [2,0] with the same checks, preserving the listed order.
  for (const seat of [2, 0]) game = doAction(game, seat, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.phase, "finished");
  assert.deepEqual(
    game.players.map((player) => player.huCount),
    [1, 0, 1],
  );
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：序列化保留私有视图及确定性的后续动作
// Scenario: serialization preserves private views and deterministic subsequent actions
test("serialization preserves private views and deterministic subsequent actions", () => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const original = doAction(fixture(), 0, "discard", 17);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const resumed = JSON.parse(JSON.stringify(original));
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  assert.deepEqual(getPlayerView(original, 2), getPlayerView(resumed, 2));
  assert.deepEqual(doAction(original, 2, "pass"), doAction(resumed, 2, "pass"));
});
// 场景：胡牌次数没有人为上限，新牌局重置状态
// Scenario: hu count has no artificial cap and new games reset state
test("hu count has no artificial cap and new games reset state", () => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const game = doAction(
    fixture({
      huCounts: [99, 0, 0],
    }),
    0,
    "hu",
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[0].huCount, 100);
  assert.equal(game.phase, "turn");
  assert.deepEqual(
    createGame({
      seed: 1,
    }).players.map((player) => player.score),
    [0, 0, 0],
  );
});
// 场景：100 局完整固定种子对局在每步动作后均保持实体牌守恒与积分零和
// Scenario: 100 complete seeded games conserve physical tiles and zero-sum scores after every action
test("100 complete seeded games conserve physical tiles and zero-sum scores after every action", () => {
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  for (let seed = 0; seed < 100; seed++) {
    const random = deterministicRandom(seed);
    let game = createGame({
      seed,
    });
    let actions = 0;
    // 持续推进场景直到 game.phase!=='finished' 不再成立；循环内的动作/断言负责保证进展。
    // Advance while game.phase!=='finished' holds; actions/assertions inside are responsible for progress.
    while (game.phase !== "finished") {
      assert.ok(++actions < 1000, `Seed ${seed} did not finish`);
      const seat =
        game.phase === "claim"
          ? game.claim.eligibleSeats.find(
              (value) => !game.claim.responses[value],
            )
          : game.currentSeat;
      const legal = getLegalActions(game, seat);
      assert.ok(legal.length, `No legal actions at seed ${seed}`);
      assert.equal(
        legal.some((action) => action.type === "draw"),
        false,
      );
      const action =
        legal.find((item) => item.type === "hu") ||
        legal.find((item) => item.type.endsWith("Gang")) ||
        legal[Math.floor(random() * legal.length)];
      game = applyAction(game, seat, action);
      // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
      // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
      assertGameInvariants(game);
      assert.equal(
        game.players.reduce((sum, player) => sum + player.score, 0),
        0,
      );
    }
    assert.ok(
      game.wall.length === 0 ||
        game.players.every((player) => player.huCount > 0),
    );
  }
});
// 场景：此前胡牌始终增加同牌番，但萝卜与龙的叠加需要显式开关
// Scenario: prior winning tiles always add copy fan but radish and dragon overlap require explicit flags
test("prior winning tiles always add copy fan but radish and dragon overlap require explicit flags", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 下列集合；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in the following collection with the same checks, preserving the listed order.
  for (const [rules, radishBonus, dragonBonus] of [
    [{}, 6, 0],
    [
      {
        radishCountsWinPile: true,
      },
      8,
      0,
    ],
    [
      {
        dragonCountsWinPile: true,
      },
      6,
      10,
    ],
    [
      {
        radishCountsWinPile: true,
        dragonCountsWinPile: true,
      },
      8,
      10,
    ],
  ]) {
    const game = doAction(
      fixture({
        hands: [hand, noZero, noZero],
        melds: [[meld(0)], [], []],
        priorWins: [[0], [], []],
        huCounts: [1, 0, 0],
        radishes: [[0, 0], [], []],
        rules,
      }),
      0,
      "hu",
    );
    const score = huEvent(game).score;
    assert.equal(score.fan, 2);
    assert.equal(score.radishBonus, radishBonus);
    assert.equal(score.dragonBonus, dragonBonus);
    assert.equal(score.total, 2 + radishBonus + dragonBonus);
  }
});
// 场景：同时首胡导致三家均胡时，不会取消同批已胡玩家的再次胡牌
// Scenario: a first simultaneous winner completing the table does not cancel an already-hu repeat winner
test("a first simultaneous winner completing the table does not cancel an already-hu repeat winner", () => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let game = doAction(
    fixture({
      huCounts: [1, 0, 1],
      kongSeats: [0],
      head: [6],
    }),
    0,
    "discard",
    17,
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const wall = game.wall.length;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 2, "hu");
  game = doAction(game, 1, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.finishReason, "allPlayersHu");
  assert.deepEqual(
    game.players.map((player) => player.huCount),
    [1, 1, 2],
  );
  assert.equal(game.history.filter((event) => event.type === "hu").length, 2);
  assert.equal(game.wall.length, wall - 6);
  assert.equal(
    game.history.some((event) => event.type === "draw"),
    false,
  );
  assert.equal(game.players[1].winPile[0].virtual, false);
  assert.equal(game.players[2].winPile[0].virtual, true);
  assert.ok(huEvent(game, 2).payments.length);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：合法胡后杠保留多个听口，丢失任一听口即拒绝
// Scenario: post-hu legal kong preserves multiple waits, while losing any single wait rejects it
test("post-hu legal kong preserves multiple waits, while losing any single wait rejects it", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const before = [0, 0, 0, 3, 4, 5, 9, 10, 11, 12, 13, 17, 17];
  const game = fixture({
    hands: [[...before, 0], waiting, waiting],
    drawTile: 0,
    huCounts: [1, 0, 0],
    locks: [[11, 14], [], []],
    activeLocks: [true, false, false],
  });
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  assert.deepEqual(getWaitTiles(before), [11, 14]);
  assert.equal(has(game, 0, "anGang", 0), true);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const changed = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17];
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(getWaitTiles(changed.slice(1)), [0, 3, 17]);
  assert.deepEqual(getWaitTiles(changed.slice(4), [meld(0, "anGang")]), [0, 3]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const rejected = fixture({
    hands: [changed, waiting, waiting],
    drawTile: 0,
    huCounts: [1, 0, 0],
    locks: [[0, 3, 17], [], []],
    activeLocks: [true, false, false],
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(rejected, 0, "anGang", 0), false);
});
// 场景：各个不同牌值的同牌番奖励分别累加
// Scenario: copy fan bonuses accumulate separately for every matching tile identity
test("copy fan bonuses accumulate separately for every matching tile identity", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 0, 0, 0, 2, 2, 2, 2, 4, 4, 4, 4, 6, 6];
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 [[[],4,8],[[0,2,4],7,14]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [[[],4,8],[[0,2,4],7,14]] with the same checks, preserving the listed order.
  for (const [previous, fan, points] of [
    [[], 4, 8],
    [[0, 2, 4], 7, 14],
  ]) {
    const game = doAction(
      fixture({
        hands: [hand, waiting, waiting],
        priorWins: [previous, [], []],
        huCounts: [3, 0, 0],
      }),
      0,
      "hu",
    );
    assert.equal(huEvent(game).score.fan, fan);
    assert.equal(huEvent(game).score.fanPoints, points);
    assert.equal(huEvent(game).score.total, points);
  }
});
// 场景：胡后无须决策的回合自动推进，连续跳过锁定玩家且不暴露摸牌牌值
// Scenario: post-hu uninteresting turns auto-advance through consecutive locked players without exposing draw tiles
test("post-hu uninteresting turns auto-advance through consecutive locked players without exposing draw tiles", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    huCounts: [1, 1, 0],
    head: [6, 7, 8],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "pass");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.currentSeat, 2);
  assert.equal(game.lastDraw.tile, 7);
  assert.equal(game.players[1].hand.length, 13);
  assert.equal(game.discards[1].tile, 6);
  assert.ok(
    game.history
      .filter((event) => event.type === "draw")
      .every((event) => event.tile === undefined),
  );
  assert.equal(getPlayerView(game, 0).drawnTile, null);
  assert.equal(getPlayerView(game, 1).drawnTile, null);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
