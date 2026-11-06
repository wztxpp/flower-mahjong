// 当前第三版引擎的动作、计分、牌数守恒和旧规则快照。
// Current version-three engine actions, scoring, physical conservation and saved-rule contracts.
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
} from "../shared/game.js";
import { postHuKongGame } from "./fixtures/post-hu-kong.js";
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
// 出牌来源不能自己正在可胡；拆掉一组顺子，保留刚摸的 17 来测试出牌结算。
// Break one sequence so the source can legally discard its drawn 17 rather than skip a mandatory hu.
const nonWinningSource = winning.map(tile => tile === 0 ? 8 : tile);

/** Existing clockwise games remain regression fixtures; new direction is covered separately.
 * Eight-copy physical fixture. Prior logical wins reference retired physical tiles. */
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
// 场景：v3 固定种子发牌共有 144 张、每种八张，三家手牌数为 14/13/13
// Scenario: v3 deterministic deal has 144 tiles, eight copies, 14/13/13 hands
test("v3 deterministic deal has 144 tiles, eight copies, 14/13/13 hands", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const game = createGame({
    seed: 42,
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.schemaVersion, 3);
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
      sixCopyFan: -1,
    },
    {
      sevenPlusCopyFan: -1,
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
// 场景：首次自摸增加六张共享牌尾萝卜，并保留可继续行动的胡后状态
// Scenario: first selfdraw adds six shared tail radishes and leaves a winning continuation playable
test("first selfdraw adds six shared tail radishes and leaves a winning continuation playable", () => {
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
  assert.deepEqual(getPlayerView(game, 2).sharedRadishes, [6, 5, 4, 3, 2, 1]);
  assert.equal(game.firstHuRadishesRevealed, true);
  assert.equal(game.players[0].hand.length, 14);
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
  assert.equal(game.wall.length, wall - 7);
  assert.equal(game.currentSeat, 0);
  assert.equal(game.players[0].huLockActive, true);
  assert.equal(has(game, 0, "hu"), true);
  assert.equal(getHuDiagnostic(game, 0).code, "AVAILABLE");
  assert.deepEqual(game.discards, []);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[0].huCount, 2);
  assert.equal(game.players[0].winPile.length, 2);
  assert.equal(getPlayerView(game, 1).sharedRadishes.length, 6);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：胡后非胡摸牌保持锁手，手动过牌只打出刚摸的牌
// Scenario: manual post-hu hand stays locked and pass discards only a nonwinning drawn tile
test("manual post-hu hand stays locked and pass discards only a nonwinning drawn tile", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    hands: [nonWinningSource, waiting, waiting],
    huCounts: [1, 0, 0],
    head: [6],
    rules: { autoDiscardAfterHu: false },
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 自动模式的直接出牌也只能选择刚摸的牌，不能换出旧手牌。
  // A direct discard in automatic mode must still use the draw, never an older locked tile.
  const automatic = structuredClone(game);
  automatic.rules.autoDiscardAfterHu = true;
  assert.deepEqual(getLegalActions(automatic, 0), [{ type: "discard", tile: 17 }]);
  assert.throws(() => doAction(automatic, 0, "discard", 1));
  assert.equal(doAction(automatic, 0, "discard", 17).discards[0].tile, 17);
  assert.deepEqual(getLegalActions(game, 0), [{ type: "pass" }]);
  assert.equal(has(game, 0, "hu"), false);
  assert.equal(has(game, 0, "pass"), true);
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
// 场景：普通摸牌清除暂定的弃牌锁，续摸自摸则绕过该锁
// Scenario: normal draw clears the provisional discard lock while continuation selfdraw bypasses it
test("normal draw clears the provisional discard lock while continuation selfdraw bypasses it", () => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let game = doAction(
    fixture({
      head: [6, 7, 8, 17],
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
  game = passAll(doAction(game, 1, "discard", 7));
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.currentSeat, 2);
  assert.equal(game.lastDraw.tile, 8);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = passAll(doAction(game, 2, "discard", 8));
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
  assert.equal(getPlayerView(game, 0).sharedRadishes.length, 6);
  assert.equal(game.retiredTiles.length, 2);
});
// 场景：自摸与普通弃牌胡忽略此前临时听口锁配置
// Scenario: selfdraw and ordinary discard wins ignore prior temporary wait-lock settings
test("selfdraw and ordinary discard wins ignore prior temporary wait-lock settings", () => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 逐项覆盖 [{},{allowChangedWaitDuringLock:false},{repeatHuLock:'untilWaitChange'}]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [{},{allowChangedWaitDuringLock:false},{repeatHuLock:'untilWaitChange'}] with the same checks, preserving the listed order.
  for (const rules of [
    {},
    {
      allowChangedWaitDuringLock: false,
    },
    {
      repeatHuLock: "untilWaitChange",
    },
  ]) {
    const game = fixture({
      huCounts: [1, 0, 0],
      locks: [[16, 17], [], []],
      activeLocks: [true, false, false],
      rules,
    });
    assert.equal(has(game, 0, "hu"), true);
    assert.equal(getHuDiagnostic(game, 0).code, "AVAILABLE");
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const source = fixture({
    huCounts: [0, 1, 0],
    locks: [[], [17], []],
    activeLocks: [false, true, false],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const game = doAction(source, 0, "discard", 17);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 1, "hu"), true);
  assert.equal(getHuDiagnostic(game, 1).code, "AVAILABLE");
  assert.equal(has(game, 2, "hu"), true);
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
      hands: [nonWinningSource, pengHand, waiting],
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
// 场景：普通胡后弃牌受保护，但杠后弃牌允许被胡且仅由来源玩家付款
// Scenario: ordinary post-hu discard is protected but post-kong discard allows hu paid only by its source
test("ordinary post-hu discard is protected but post-kong discard allows hu paid only by its source", () => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let game = doAction(
    fixture({
      hands: [nonWinningSource, waiting, waiting],
      huCounts: [1, 0, 0],
      kongSeats: [0],
    }),
    0,
    "discard",
    17,
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const discardEvent = game.history.find((event) => event.type === "discard");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.match(discardEvent.message, /杠后出牌，接胡仅出牌者付款/);
  assert.doesNotMatch(discardEvent.message, /按自摸/);
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
  assert.equal(event.payments.length, 2);
  assert.ok(game.players[0].score < 0);
  assert.equal(game.players[2].score, 0);
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
      hands: [nonWinningSource, waiting, waiting],
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
  assert.equal(game.wall.length, wall);
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
  assert.equal(game.wall.length, wall);
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
// 场景：暗杠向每名对手支付 2 分，萝卜延后至首胡翻开，并从牌墙头补牌
// Scenario: concealed kong pays each opponent 2, defers its radish until first hu and draws head replacement
test("concealed kong pays each opponent 2, defers its radish until first hu and draws head replacement", () => {
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
  assert.deepEqual(game.players[0].radishes, []);
  assert.equal(game.pendingKongRadishes, 1);
  assert.equal(game.wall.at(-1), 7);
  assert.equal(game.lastDraw.tile, 6);
  assert.equal(game.players[0].hand.length, 11);
  assert.equal(game.wall.length, wall - 1);
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
// 场景：碰牌加杠向每名对手支付 1 分，保持副露组数并累计一张待翻萝卜
// Scenario: peng upgrade pays each opponent 1, preserves meld count and accrues one pending radish
test("peng upgrade pays each opponent 1, preserves meld count and accrues one pending radish", () => {
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
  assert.deepEqual(game.players[0].radishes, []);
  assert.equal(game.pendingKongRadishes, 1);
  assert.equal(game.wall.at(-1), 7);
  assert.equal(game.lastDraw.tile, 6);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：已有杠可加入第五张和第六张，每次另向双方各付 1 分、增加萝卜并补牌
// Scenario: existing kong can add a fifth and sixth tile, with another 1 each, radish and replacement
test("existing kong can add a fifth and sixth tile, with another 1 each, radish and replacement", () => {
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
  assert.deepEqual(game.players[0].radishes, []);
  assert.equal(game.pendingKongRadishes, 2);
  assert.deepEqual(game.wall.slice(-2), [7, 8]);
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
  assert.equal(has(game, 0, "addGang", 0), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "addGang", 0);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[0].melds[0].tiles.length, 6);
});
// 场景：胡后暗杠保留完整听口集合，补牌可立即胡牌
// Scenario: post-hu concealed kong preserves whole wait set and replacement can hu immediately
test("post-hu concealed kong preserves whole wait set and replacement can hu immediately", () => {
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
  assert.equal(game.currentSeat, 0);
  assert.equal(game.lastDraw.tile, 17);
  assert.equal(has(game, 0, "hu"), true);
  assert.equal(game.players[0].pendingKongDiscard, true);
  assert.deepEqual(game.discards, []);
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
// 场景：杠仍要求牌墙至少两张，拒绝时不转移积分
// Scenario: a kong retains the two-wall-tile minimum; rejection never transfers points
test("a kong retains the two-wall-tile minimum; rejection never transfers points", () => {
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
// 场景：四至八张相同牌遵循已确认的累加番数表
// Scenario: four-to-eight identical copies follow the confirmed additive fan schedule
test("four-to-eight identical copies follow the confirmed additive fan schedule", () => {
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
  assert.equal(huEvent(game).score.copyFanBonus, 3);
  assert.equal(huEvent(game).score.fan, 4);
  assert.equal(huEvent(game).score.fanPoints, 8);
  assert.equal(huEvent(game).score.dragonBonus, 0);
  // 逐项覆盖 [1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [1,2] with the same checks, preserving the listed order.
  for (const count of [1, 2]) {
    game = doAction(
      fixture({
        hands: [six, noZero, noZero],
        priorWins: [Array(count).fill(0), [], []],
        huCounts: [1, 0, 0],
      }),
      0,
      "hu",
    );
    assert.equal(huEvent(game).score.copyFanBonus, count + 3);
    game = doAction(
      fixture({
        hands: [six, noZero, noZero],
        priorWins: [Array(count).fill(0), [], []],
        huCounts: [1, 0, 0],
        rules: {
          sevenPlusCopyFan: 4,
        },
      }),
      0,
      "hu",
    );
    assert.equal(huEvent(game).score.copyFanBonus, count + 3);
  }
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
  assert.equal(huEvent(game).score.radishBonus, 4);
  assert.equal(huEvent(game).score.total, 6);
});
// 场景：所有座位共享一个萝卜池，副露是否参与统计仍须显式配置
// Scenario: all seats share one radish pool; optional meld participation stays explicit
test("all seats share one radish pool; optional meld participation stays explicit", () => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const game = doAction(
    fixture({
      huCounts: [1, 0, 0],
      radishes: [[], [17], []],
    }),
    0,
    "hu",
  );
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(huEvent(game).score.radishBonus, 2);
  assert.deepEqual(getPlayerView(game, 0).sharedRadishes, [17]);
  assert.throws(() =>
    createGame({
      rules: {
        radishScope: "own",
      },
    }),
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const excluded = doAction(
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
  assert.equal(huEvent(excluded).score.radishBonus, 0);
});
// 场景：六、七、八张龙仅在牌局结束时向每名对手支付 10、20、40 分
// Scenario: dragon 6/7/8 pays each opponent 10/20/40 only at game end
test("dragon 6/7/8 pays each opponent 10/20/40 only at game end", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17];
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  // 逐项覆盖 [[6,10],[7,20],[8,40]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [[6,10],[7,20],[8,40]] with the same checks, preserving the listed order.
  for (const [count, expected] of [
    [6, 10],
    [7, 20],
    [8, 40],
  ]) {
    const initial = fixture({
      hands: [hand, noZero, noZero],
      huCounts: [1, 0, 0],
      radishes: [Array(count - 4).fill(0), [], []],
      wallCount: 0,
    });
    const game = doAction(initial, 0, "hu");
    assert.equal(huEvent(game).score.dragonBonus, 0);
    assert.equal(huEvent(game).score.fan, 2);
    assert.equal(huEvent(game).score.total, 2 + 4 * (count - 4));
    assert.equal(game.phase, "finished");
    assert.equal(game.dragonSettlement.settled, true);
    const event = game.history.find(
      (event) => event.type === "dragonSettlement" && event.seat === 0,
    );
    assert.equal(event.points, expected);
    assert.deepEqual(event.dragons, [
      {
        tile: 0,
        count,
        points: expected,
      },
    ]);
    assert.deepEqual(event.payments, [
      {
        seat: 1,
        delta: -expected,
      },
      {
        seat: 2,
        delta: -expected,
      },
      {
        seat: 0,
        delta: expected * 2,
      },
    ]);
    const restored = JSON.parse(JSON.stringify(game));
    const before = structuredClone(restored);
    assert.throws(() => doAction(restored, 0, "hu"));
    assert.deepEqual(restored, before);
    assert.equal(
      game.history.filter(
        (event) => event.type === "dragonSettlement" && event.seat === 0,
      ).length,
      1,
    );
    // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
    // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
    assertGameInvariants(game);
  }
});
// 场景：旧版大单吊向每名对手恰好收取 50 分，即使是荣胡
// Scenario: legacy big single wait charges each opponent exactly 50, even on a discard
test("legacy big single wait charges each opponent exactly 50, even on a discard", () => {
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
// 场景：诊断私密地解释牌型及再次荣胡是否可用
// Scenario: diagnostics explain shape and repeat discard availability privately
test("diagnostics explain shape and repeat discard availability privately", () => {
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
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(
    fixture({
      huCounts: [0, 1, 0],
      locks: [[], [17], []],
      activeLocks: [false, true, false],
    }),
    0,
    "discard",
    17,
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(getHuDiagnostic(game, 1).code, "AVAILABLE");
  assert.match(getHuDiagnostic(game, 1).message, /能胡就必须胡/);
  assert.ok(
    game.history.every((event) => !Object.hasOwn(event, "huDiagnostic")),
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const view = getPlayerView(game, 1);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(view.huDiagnostic.code, "AVAILABLE");
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
  assert.equal(view.schemaVersion, 3);
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
// 场景：默认将此前胡牌计入萝卜，已保存的旧规则保留排除行为
// Scenario: prior wins count for radishes by default; saved old rules preserve exclusion
test("prior wins count for radishes by default; saved old rules preserve exclusion", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 [[{},8,10],[{radishCountsWinPile:false},6,10],[{dragonCountsWinPile:false},8,0],[{dragonCountsSharedRadishes:false},8,0]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [[{},8,10],[{radishCountsWinPile:false},6,10],[{dragonCountsWinPile:false},8,0],[{dragonCountsSharedRadishes:false},8,0]] with the same checks, preserving the listed order.
  for (const [rules, radishBonus, dragonBonus] of [
    [{}, 8, 10],
    [
      {
        radishCountsWinPile: false,
      },
      6,
      10,
    ],
    [
      {
        dragonCountsWinPile: false,
      },
      8,
      0,
    ],
    [
      {
        dragonCountsSharedRadishes: false,
      },
      8,
      0,
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
        wallCount: 0,
      }),
      0,
      "hu",
    );
    const score = huEvent(game).score;
    assert.equal(score.fan, 2);
    assert.equal(score.radishBonus, radishBonus);
    assert.equal(score.dragonBonus, 0);
    assert.equal(score.total, 2 + radishBonus);
    assert.equal(
      game.dragonSettlement.entries.find((entry) => entry.seat === 0)?.points ||
        0,
      dragonBonus,
    );
  }
});
// 场景：同时首胡导致三家均胡时，不会取消同批已胡玩家的再次胡牌
// Scenario: a first simultaneous winner completing the table does not cancel an already-hu repeat winner
test("a first simultaneous winner completing the table does not cancel an already-hu repeat winner", () => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let game = doAction(
    fixture({
      hands: [nonWinningSource, waiting, waiting],
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
  assert.equal(game.wall.length, wall);
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
    hands: [nonWinningSource, waiting, waiting],
    huCounts: [1, 1, 0],
    head: [6, 7, 8],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "discard", 17);
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
// 场景：第三家胡牌从全部四个牌区结算龙，且不给萝卜另计番
// Scenario: third player win settles dragons from all four zones without charging fan for radishes
test("third player win settles dragons from all four zones without charging fan for radishes", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17];
  const initial = fixture({
    hands: [hand, noZero, [...noZero, 17]],
    melds: [[meld(0)], [], []],
    priorWins: [[0], [], []],
    huCounts: [1, 1, 0],
    radishes: [[], [0, 0], []],
    currentSeat: 2,
  });
  const wall = initial.wall.length;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const game = doAction(initial, 2, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.finishReason, "allPlayersHu");
  assert.equal(game.wall.length, wall);
  assert.equal(huEvent(game, 2).score.fan, 1);
  assert.equal(huEvent(game, 2).score.dragonBonus, 0);
  assert.equal(
    game.dragonSettlement.entries.find((entry) => entry.seat === 0).points,
    10,
  );
  assert.equal(game.history.at(-1).type, "finish");
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：自摸排除已胡付款方的规则同样用于大单吊，但不改变其 50 分单价
// Scenario: selfdraw payer exclusion also applies to big-single without changing its 50-point rate
test("selfdraw payer exclusion also applies to big-single without changing its 50-point rate", () => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const ordinary = doAction(
    fixture({
      huCounts: [1, 1, 0],
      head: [6],
    }),
    0,
    "hu",
  );
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.deepEqual(
    huEvent(ordinary).payments.map((p) => p.seat),
    [2, 0],
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const big = doAction(
    fixture({
      hands: [[17, 17], waiting, waiting],
      melds: [[meld(0), meld(3), meld(9), meld(12)], [], []],
      huCounts: [1, 1, 0],
      head: [6],
    }),
    0,
    "hu",
  );
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(huEvent(big).score.total, 50);
  assert.deepEqual(huEvent(big).payments, [
    {
      seat: 2,
      delta: -50,
    },
    {
      seat: 0,
      delta: 50,
    },
  ]);
});
// 场景：萝卜示例中个人牌区两张七筒与一张四筒合计四分，不改变番数
// Scenario: radish example sums two 7-dots and one 4-dot from personal zones to four, without changing fan
test("radish example sums two 7-dots and one 4-dot from personal zones to four, without changing fan", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const exactHand = [0, 1, 2, 3, 4, 5, 9, 10, 11, 15, 16, 17, 6, 6];
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  // 逐项覆盖 [false,true]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [false,true] with the same checks, preserving the listed order.
  for (const virtual of [false, true]) {
    const initial = fixture({
      hands: [exactHand, waiting, waiting],
      priorWins: [[15, 12], [], []],
      huCounts: [2, 0, 0],
      radishes: [[], [15, 12, 12], []],
      drawTile: 6,
      head: [8],
    });
    // 仅虚拟胡牌引用走此分支；不能额外占用第二张实物弃牌。
    // Apply this branch only to a virtual win reference, without consuming another physical discard.
    if (virtual) {
      initial.retiredTiles.splice(
        initial.retiredTiles.findIndex((x) => x.tile === 15),
        1,
      );
      initial.discards.push({
        seat: 1,
        tile: 15,
        claimable: false,
        huSeats: [0, 2],
      });
      initial.players[0].winPile[0] = {
        tile: 15,
        source: "discard",
        virtual: true,
        discardIndex: 0,
      };
    }
    const game = doAction(initial, 0, "hu");
    const score = huEvent(game).score;
    assert.equal(score.radishBonus, 4);
    assert.equal(score.fan, 1);
    assert.equal(score.total, 5);
    assert.equal(getPlayerView(game, 0).scoreBreakdown.radishBonus, 4);
    const legacy = structuredClone(initial);
    legacy.rules.radishCountsWinPile = false;
    const old = doAction(legacy, 0, "hu");
    assert.equal(huEvent(old).score.radishBonus, 1);
    assert.equal(huEvent(old).score.fan, score.fan);
    // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
    // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
    assertGameInvariants(game);
  }
});
// 场景：每次自摸无论首胡还是再次胡牌，只向此前未胡的对手收费，账本保持零和
// Scenario: every selfdraw charges only previously-unwon opponents, first or repeat, with zero-sum ledger
test("every selfdraw charges only previously-unwon opponents, first or repeat, with zero-sum ledger", () => {
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 [[0,0,0],[0,1,0],[1,1,0],[0,1,1]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [[0,0,0],[0,1,0],[1,1,0],[0,1,1]] with the same checks, preserving the listed order.
  for (const counts of [
    [0, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 1, 1],
  ]) {
    const game = doAction(
      fixture({
        huCounts: counts,
        head: [6],
      }),
      0,
      "hu",
    );
    const event = huEvent(game);
    const payers =
      counts[0] === 0 && counts[1] && counts[2]
        ? [1, 2]
        : [1, 2].filter((i) => !counts[i]);
    assert.deepEqual(
      event.payments.filter((p) => p.delta < 0).map((p) => p.seat),
      payers,
    );
    assert.equal(
      event.payments.find((p) => p.seat === 0).delta,
      event.points * payers.length,
    );
    // 逐项覆盖 [1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in [1,2] with the same checks, preserving the listed order.
    // A previously won opponent outside the payer list must retain their score.
    for (const i of [1, 2]) // 已胡且不在付款名单的对手应保留原分数，不能被当前胡牌错误扣费。
      if (counts[i] && !payers.includes(i))
        assert.equal(game.players[i].score, 0);
    assert.equal(
      game.players.reduce((sum, p) => sum + p.score, 0),
      0,
    );
    // 没有合法付款方时不制造负分条目，检验旧付款规则下的零付款情况。
    // Do not fabricate debit entries when no payer qualifies; cover saved zero-payer behavior.
    if (!payers.length) assert.match(event.message, /无未胡付款方/);
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const old = fixture({
    huCounts: [0, 1, 0],
    head: [6],
  });
  delete old.rules.selfDrawOnlyUnwon;
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.deepEqual(
    huEvent(doAction(old, 0, "hu"))
      .payments.filter((p) => p.delta < 0)
      .map((p) => p.seat),
    [1, 2],
  );
});
// 场景：杠后补牌自摸保留原付款行为，不受普通摸牌规则影响
// Scenario: kong replacement selfdraw retains preexisting payment behavior independently of ordinary draws
test("kong replacement selfdraw retains preexisting payment behavior independently of ordinary draws", () => {
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  // 逐项覆盖 [[0,1,0],[1,1,0],[0,1,1]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [[0,1,0],[1,1,0],[0,1,1]] with the same checks, preserving the listed order.
  for (const counts of [
    [0, 1, 0],
    [1, 1, 0],
    [0, 1, 1],
  ]) {
    const initial = fixture({
      huCounts: counts,
      drawKind: "replacement",
      head: [6],
    });
    const previous = structuredClone(initial);
    delete previous.rules.selfDrawOnlyUnwon;
    const latest = doAction(initial, 0, "hu");
    const old = doAction(previous, 0, "hu");
    assert.deepEqual(huEvent(latest).payments, huEvent(old).payments);
    assert.deepEqual(
      latest.players.map((p) => p.score),
      old.players.map((p) => p.score),
    );
  }
});
// 场景：最后一家自摸向两名对手收款，而例外规则引入前保存的牌局仍无付款方
// Scenario: final selfdraw collects both opponents while saved pre-exception game keeps zero payers
test("final selfdraw collects both opponents while saved pre-exception game keeps zero payers", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const initial = fixture({
    huCounts: [0, 1, 1],
    head: [6],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const game = doAction(initial, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.finishReason, "allPlayersHu");
  assert.deepEqual(huEvent(game).payments, [
    {
      seat: 1,
      delta: -1,
    },
    {
      seat: 2,
      delta: -1,
    },
    {
      seat: 0,
      delta: 2,
    },
  ]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const old = structuredClone(initial);
  delete old.rules.finalHuPaymentExceptions;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const before = doAction(old, 0, "hu");
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  assert.deepEqual(huEvent(before).payments, [
    {
      seat: 0,
      delta: 0,
    },
  ]);
  assert.deepEqual(
    before.players.map((p) => p.score),
    [0, 0, 0],
  );
});
// 场景：最后一批首胡与再次胡的共同赢家分别仅向杠后弃牌者收费
// Scenario: final first and repeat co-winners each charge only the kong discarder
test("final first and repeat co-winners each charge only the kong discarder", () => {
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
        hands: [nonWinningSource, waiting, waiting],
        huCounts: [1, 0, 1],
        kongSeats: [0],
        head: [6],
      }),
      0,
      "discard",
      17,
    );
    const wall = game.wall.length;
    // 逐项覆盖 order；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in order with the same checks, preserving the listed order.
    for (const seat of order) game = doAction(game, seat, "hu");
    assert.equal(game.finishReason, "allPlayersHu");
    assert.equal(game.wall.length, wall);
    const first = huEvent(game, 1),
      repeat = huEvent(game, 2);
    assert.equal(first.source, "kongDiscard");
    assert.match(first.message, /仅出牌者付款/);
    assert.doesNotMatch(first.message, /按自摸/);
    assert.deepEqual(
      first.payments.filter((p) => p.delta < 0).map((p) => p.seat),
      [0],
    );
    assert.deepEqual(
      repeat.payments.filter((p) => p.delta < 0).map((p) => p.seat),
      [0],
    );
    assert.equal(
      game.players.reduce((n, p) => n + p.score, 0),
      0,
    );
    // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
    // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
    assertGameInvariants(game);
  }
});
// 场景：最后一批及非最后一批杠后弃牌胡均只由来源玩家付款，即使缺少最终胡牌开关
// Scenario: final and nonfinal kong-discard wins charge only the source even without the final-hu flag
test("final and nonfinal kong-discard wins charge only the source even without the final-hu flag", () => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let initial = doAction(
    fixture({
      hands: [nonWinningSource, waiting, waiting],
      huCounts: [1, 0, 0],
      kongSeats: [0],
      head: [6],
    }),
    0,
    "discard",
    17,
  );
  let game = doAction(doAction(initial, 1, "hu"), 2, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.finishReason, "allPlayersHu");
  // 逐项覆盖 [1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [1,2] with the same checks, preserving the listed order.
  for (const seat of [1, 2])
    assert.deepEqual(
      huEvent(game, seat)
        .payments.filter((p) => p.delta < 0)
        .map((p) => p.seat),
      [0],
    );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(doAction(initial, 1, "hu"), 2, "pass");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.notEqual(game.phase, "finished");
  assert.deepEqual(
    huEvent(game, 1)
      .payments.filter((p) => p.delta < 0)
      .map((p) => p.seat),
    [0],
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const old = structuredClone(initial);
  delete old.rules.finalHuPaymentExceptions;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(doAction(old, 1, "hu"), 2, "hu");
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.deepEqual(
    huEvent(game, 1)
      .payments.filter((p) => p.delta < 0)
      .map((p) => p.seat),
    [0],
  );
});
// 场景：反馈的二、五、八筒听牌可在下一次自然摸牌前再次胡杠后弃牌
// Scenario: reported 2/5/8 circles hand can repeat-hu a kong discard before its next natural draw
test("reported 2/5/8 circles hand can repeat-hu a kong discard before its next natural draw", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const receiver = [4, 5, 6, 6, 7, 7, 7, 8, 11, 12, 13, 14, 15];
  // 补不在听口内的一筒以测试杠后弃牌；二筒会触发不可跳过的抢杠胡。
  // Upgrade outside the receiver's waits; tile 10 would require a rob-kong hu before the discard.
  const source = [2, 3, 5, 6, 7, 8, 8, 8, 9, 14, 14];
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(getWaitTiles(receiver), [10, 13, 16]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    hands: [source, receiver, waiting],
    melds: [[meld(9)], [], []],
    huCounts: [0, 5, 0],
    priorWins: [[], [16, 10, 16, 13, 16], []],
    locks: [[], [10, 13, 16], []],
    activeLocks: [false, true, false],
    drawTile: 9,
    head: [13, 0],
    tail: [16],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "buGang", 9);
  // 未胡对手仍可过牌；已胡接牌者此时不具备抢杠听口。
  // Only unwon opponents may pass here; the previous winner cannot rob this tile.
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  game = passAll(game);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[1].huLockActive, true);
  assert.equal(game.lastDraw.tile, 13);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "discard", 13);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(
    game.discards.find((discard) => discard.seat === 0 && discard.tile === 13)
      .afterKong,
    true,
  );
  assert.equal(game.phase, "claim");
  assert.equal(game.claim.tile, 13);
  assert.equal(has(game, 1, "hu"), true);
  assert.equal(getHuDiagnostic(game, 1).code, "AVAILABLE");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 1, "hu");
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  game = passAll(game);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[1].huCount, 6);
  assert.equal(game.players[1].winPile.at(-1).source, "kongDiscard");
  assert.equal(game.players[1].winPile.at(-1).tile, 13);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：杠后弃牌胡和普通再次荣胡忽略锁，但已胡玩家的普通弃牌仍受保护
// Scenario: kong-discard and ordinary repeat hu ignore locks but won ordinary sources remain protected
test("kong-discard and ordinary repeat hu ignore locks but won ordinary sources remain protected", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const receiver = [4, 5, 6, 6, 7, 7, 7, 8, 11, 12, 13, 14, 15];
  const source = [0, 0, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 13, 17];
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  // 逐项覆盖 [0,1]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [0,1] with the same checks, preserving the listed order.
  // Exercise each entry in ['untilNaturalDraw','untilWaitChange'] with the same checks, preserving the listed order.
  // Exercise each entry in [true,false] with the same checks, preserving the listed order.
  for (const sourceHu of [0, 1]) // 逐项覆盖 ['untilNaturalDraw','untilWaitChange']；同一组检查用于每个样本，顺序以代码列出的集合为准。
    for (const repeatHuLock of ["untilNaturalDraw", "untilWaitChange"]) // 逐项覆盖 [true,false]；同一组检查用于每个样本，顺序以代码列出的集合为准。
      for (const allowChangedWaitDuringLock of [true, false]) {
        const make = (afterKong) =>
          fixture({
            hands: [source, receiver, waiting],
            drawTile: 13,
            huCounts: [sourceHu, 1, 0],
            locks: [[], [10, 13, 16], []],
            activeLocks: [false, true, false],
            kongSeats: afterKong ? [0] : [],
            rules: {
              repeatHuLock,
              allowChangedWaitDuringLock,
            },
            head: [0, 1],
          });
        let game = doAction(make(true), 0, "discard", 13);
        assert.equal(game.phase, "claim");
        assert.equal(has(game, 1, "hu"), true);
        assert.equal(getHuDiagnostic(game, 1).code, "AVAILABLE");
        assert.equal(game.players[0].pendingKongDiscard, false);
        game = passAll(doAction(game, 1, "hu"));
        assert.equal(game.players[1].huCount, 2);
        assert.equal(game.players[1].winPile.at(-1).source, "kongDiscard");
        // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
        // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
        assertGameInvariants(game);
        game = doAction(make(false), 0, "discard", 13);
        assert.equal(game.discards[0].afterKong, false);
        assert.equal(game.discards[0].huSeats, undefined);
        assert.equal(game.players[1].huCount, 1);
        assert.equal(
          game.phase === "claim" &&
            game.claim.tile === 13 &&
            has(game, 1, "hu"),
          sourceHu === 0,
        );
        // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
        // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
        assertGameInvariants(game);
      }
});
// 场景：两名听口锁定的已胡玩家均可胡同一张杠后弃牌，不受响应顺序影响
// Scenario: two locked winners can both claim the same kong discard in either response order
test("two locked winners can both claim the same kong discard in either response order", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const source = [0, 0, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 13, 17];
  const receiver = [4, 5, 6, 6, 7, 7, 7, 8, 11, 12, 13, 14, 15];
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  // 逐项覆盖 [[1,2],[2,1]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [[1,2],[2,1]] with the same checks, preserving the listed order.
  for (const order of [
    [1, 2],
    [2, 1],
  ]) {
    let game = fixture({
      hands: [source, receiver, receiver],
      huCounts: [0, 1, 1],
      locks: [[], [10, 13, 16], [10, 13, 16]],
      activeLocks: [false, true, true],
      kongSeats: [0],
      drawTile: 13,
      head: [0, 1],
    });
    game = doAction(game, 0, "discard", 13);
    assert.deepEqual(game.claim.eligibleSeats, [1, 2]);
    game = doAction(game, order[0], "hu");
    assert.equal(game.history.filter((event) => event.type === "hu").length, 0);
    game = doAction(game, order[1], "hu");
    assert.deepEqual(
      game.players.map((player) => player.huCount),
      [0, 2, 2],
    );
    assert.equal(
      game.history.filter(
        (event) => event.type === "hu" && event.source === "kongDiscard",
      ).length,
      2,
    );
    assert.equal(game.players[1].winPile.at(-1).virtual, false);
    assert.equal(game.players[2].winPile.at(-1).virtual, true);
    // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
    // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
    assertGameInvariants(game);
  }
});
// 核对杠后弃牌胡只向真实出牌座位收费，并检查获胜者收入和零和。
// Verify kong-discard hu charges only its actual source and check winner receipts and zero-sum accounting.
function assertKongDiscardPayment(game, winner, fromSeat) {
  const event = huEvent(game, winner);
  assert.equal(event.source, "kongDiscard");
  assert.equal(event.fromSeat, fromSeat);
  assert.equal(event.points, event.score.total);
  assert.deepEqual(event.payments, [
    {
      seat: fromSeat,
      delta: -event.points,
    },
    {
      seat: winner,
      delta: event.points,
    },
  ]);
  assert.match(event.message, /仅出牌者付款/);
  assert.doesNotMatch(event.message, /按自摸|另外两家/);
  assert.equal(
    game.players.reduce((sum, player) => sum + player.score, 0),
    0,
  );
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
  return event;
}
// 原地改变夹具的两项已有付款开关，覆盖不同旧规则组合；调用者需要自行传入独立状态。
// Mutate the fixture’s two existing payment flags to cover saved-rule combinations; callers must supply independent state.
function savedPaymentFlags(game, selfDrawOnlyUnwon, finalHuPaymentExceptions) {
  // 逐项覆盖 Object.entries({selfDrawOnlyUnwon,finalHuPaymentExceptions})；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in Object.entries({selfDrawOnlyUnwon,finalHuPaymentExceptions}) with the same checks, preserving the listed order.
  for (const [key, value] of Object.entries({
    selfDrawOnlyUnwon,
    finalHuPaymentExceptions,
  })) {
    // undefined 表示模拟字段缺失，不能写成一个看似存在的默认开关。
    // undefined models a missing saved field rather than an explicit default flag.
    if (value === undefined) delete game.rules[key];
    else game.rules[key] = value;
  }
  return game;
}
// 场景：反馈的第三家杠后弃牌胡八分只收八分而非十六分，第二家不付款
// Scenario: reported seat-three eight-point kong-discard win receives eight, not sixteen, and seat two pays nothing
test("reported seat-three eight-point kong-discard win receives eight, not sixteen, and seat two pays nothing", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    hands: [nonWinningSource, waiting, waiting],
    huCounts: [1, 0, 0],
    kongSeats: [0],
    firstHuRadishesRevealed: true,
    rules: {
      baseFan: 4,
    },
    head: [6],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "discard", 17);
  game = passAll(doAction(game, 2, "hu"));
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  const event = assertKongDiscardPayment(game, 2, 0);
  assert.equal(event.tile, 17); // Nine circles, as in the reported result.
  assert.equal(event.points, 8);
  assert.deepEqual(event.payments, [
    {
      seat: 0,
      delta: -8,
    },
    {
      seat: 2,
      delta: 8,
    },
  ]);
  assert.deepEqual(
    game.players.map((player) => player.score),
    [-8, 0, 8],
  );
});
// 场景：各种座位排列下，杠后弃牌付款方均依据真实来源与胡牌者确定
// Scenario: kong-discard payer follows the actual source and winner in every seat arrangement
test("kong-discard payer follows the actual source and winner in every seat arrangement", () => {
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 [0,1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [0,1,2] with the same checks, preserving the listed order.
  // Exercise each entry in [0,1,2].filter(seat=>seat!==fromSeat) with the same checks, preserving the listed order.
  for (const fromSeat of [0, 1, 2]) // 逐项覆盖 [0,1,2].filter(seat=>seat!==fromSeat)；同一组检查用于每个样本，顺序以代码列出的集合为准。
    for (const winner of [0, 1, 2].filter((seat) => seat !== fromSeat)) {
      const hands = [waiting, waiting, waiting].map((hand, seat) =>
        seat === fromSeat ? winning : hand,
      );
      let game = fixture({
        hands,
        currentSeat: fromSeat,
        kongSeats: [fromSeat],
        firstHuRadishesRevealed: true,
        head: [6],
      });
      game = passAll(
        doAction(doAction(game, fromSeat, "discard", 17), winner, "hu"),
      );
      const event = assertKongDiscardPayment(game, winner, fromSeat);
      assert.deepEqual(
        game.players.map((player) => player.score),
        [0, 1, 2].map((seat) =>
          seat === fromSeat
            ? -event.points
            : seat === winner
              ? event.points
              : 0,
        ),
      );
    }
});
// 场景：首次、再次、最后一批及大单吊杠后弃牌胡均忽略两项自摸付款开关
// Scenario: first, repeat, final and big-single kong-discard payments ignore both selfdraw payment flags
test("first, repeat, final and big-single kong-discard payments ignore both selfdraw payment flags", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const groups = [meld(0), meld(3), meld(9), meld(12)];
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  // 逐项覆盖 [true,false,undefined]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [true,false,undefined] with the same checks, preserving the listed order.
  // Exercise each entry in [true,false,undefined] with the same checks, preserving the listed order.
  for (const selfDrawOnlyUnwon of [true, false, undefined]) // 逐项覆盖 [true,false,undefined]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    for (const finalHuPaymentExceptions of [true, false, undefined]) {
      // 逐项覆盖 [[0,0,0],[0,1,0],[1,0,0],[1,0,1],[0,1,1],[1,1,0]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
      // Exercise each entry in [[0,0,0],[0,1,0],[1,0,0],[1,0,1],[0,1,1],[1,1,0]] with the same checks, preserving the listed order.
      for (const huCounts of [
        [0, 0, 0],
        [0, 1, 0],
        [1, 0, 0],
        [1, 0, 1],
        [0, 1, 1],
        [1, 1, 0],
      ]) {
        // 逐项覆盖 ['standard','legacyBigSingle','specialBigSingle']；同一组检查用于每个样本，顺序以代码列出的集合为准。
        // Exercise each entry in ['standard','legacyBigSingle','specialBigSingle'] with the same checks, preserving the listed order.
        for (const shape of [
          "standard",
          "legacyBigSingle",
          "specialBigSingle",
        ]) {
          const bigSingle = shape !== "standard";
          const initial = fixture({
            // 无关的第三家不听 17，避免已胡时必须同批胡而改变单赢家付款场景。
            // Keep the unrelated player off the 17 wait so mandatory co-hu cannot alter this single-winner case.
            hands: [
              nonWinningSource,
              bigSingle ? [17] : waiting,
              waiting.map((tile) => tile === 0 ? 8 : tile),
            ],
            melds: [[], bigSingle ? groups : [], []],
            huCounts,
            kongSeats: [0],
            firstHuRadishesRevealed: true,
            head: [6],
            rules: {
              specialHuPatterns: shape === "specialBigSingle",
            },
          });
          savedPaymentFlags(
            initial,
            selfDrawOnlyUnwon,
            finalHuPaymentExceptions,
          );
          const game = passAll(
            doAction(doAction(initial, 0, "discard", 17), 1, "hu"),
          );
          const event = assertKongDiscardPayment(game, 1, 0);
          // 大单钓场景单独检查其固定/特殊付款约定，不能套普通牌型期望。
          // Check the big-single case under its specific payment contract rather than ordinary-shape expectations.
          if (bigSingle) {
            assert.equal(event.score.bigSingle, true);
            assert.equal(event.points, shape === "legacyBigSingle" ? 50 : 4);
          }
          assert.deepEqual(
            game.players.map((player) => player.score),
            [-event.points, event.points, 0],
          );
          assert.equal(game.players[1].huCount, huCounts[1] + 1);
          // 专门检查零、二席已胡而一席未胡的组合，验证付款排除不受座位排列影响。
          // Check the specific won/unwon seat combination to validate payer exclusion across arrangements.
          if (huCounts[0] && !huCounts[1] && huCounts[2])
            assert.equal(game.finishReason, "allPlayersHu");
        }
      }
    }
});
// 场景：同时首胡与再次胡的杠后弃牌赢家绝不互相付款，不受响应顺序或开关影响
// Scenario: simultaneous first and repeat kong-discard winners never pay each other, regardless of response order or flags
test("simultaneous first and repeat kong-discard winners never pay each other, regardless of response order or flags", () => {
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  // 逐项覆盖 [true,false,undefined]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [true,false,undefined] with the same checks, preserving the listed order.
  // Exercise each entry in [true,false,undefined] with the same checks, preserving the listed order.
  for (const selfDrawOnlyUnwon of [true, false, undefined]) // 逐项覆盖 [true,false,undefined]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    for (const finalHuPaymentExceptions of [true, false, undefined]) {
      // 逐项覆盖 [[0,0,0],[1,0,0],[0,1,0],[0,1,1],[1,0,1]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
      // Exercise each entry in [[0,0,0],[1,0,0],[0,1,0],[0,1,1],[1,0,1]] with the same checks, preserving the listed order.
      for (const huCounts of [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 1, 1],
        [1, 0, 1],
      ]) {
        const initial = savedPaymentFlags(
          fixture({
            hands: [nonWinningSource, waiting, waiting],
            huCounts,
            kongSeats: [0],
            firstHuRadishesRevealed: true,
            head: [6],
          }),
          selfDrawOnlyUnwon,
          finalHuPaymentExceptions,
        );
        const results = [
          [1, 2],
          [2, 1],
        ].map((order) => {
          let game = doAction(initial, 0, "discard", 17);
          game = doAction(game, order[0], "hu");
          assert.equal(
            game.history.filter((event) => event.type === "hu").length,
            0,
          );
          game = doAction(game, order[1], "hu");
          const first = assertKongDiscardPayment(game, 1, 0);
          const second = assertKongDiscardPayment(game, 2, 0);
          assert.deepEqual(
            game.players.map((player) => player.score),
            [-first.points - second.points, first.points, second.points],
          );
          assert.equal(game.players[1].winPile.at(-1).virtual, false);
          assert.equal(game.players[2].winPile.at(-1).virtual, true);
          assert.deepEqual(game.discards[0].huSeats, [1, 2]);
          // 座位零已有胡牌时补齐相应历史状态，避免只改计数而遗漏后续规则依据。
          // When seat zero already won, supply corresponding state rather than changing only its count.
          if (huCounts[0]) assert.equal(game.finishReason, "allPlayersHu");
          return game;
        });
        assert.deepEqual(results[0], results[1]);
      }
    }
});
// 场景：实际杠后补牌自摸仍由两名对手付款，且不改变杠费
// Scenario: actual kong replacement selfdraw still charges both opponents and leaves kong fees intact
test("actual kong replacement selfdraw still charges both opponents and leaves kong fees intact", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 0, 0, 0, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
  let game = fixture({
    hands: [hand, waiting, waiting],
    drawTile: 0,
    huCounts: [0, 1, 0],
    head: [17, 6],
    tail: [7],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "anGang", 0);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.equal(game.lastDraw.source, "replacement");
  assert.equal(game.players[0].pendingKongDiscard, true);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const before = game.players.map((player) => player.score);
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  assert.deepEqual(before, [4, -2, -2]);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const event = huEvent(game);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.equal(event.source, "selfDraw");
  assert.equal(event.fromSeat, null);
  assert.deepEqual(event.payments, [
    {
      seat: 1,
      delta: -event.points,
    },
    {
      seat: 2,
      delta: -event.points,
    },
    {
      seat: 0,
      delta: 2 * event.points,
    },
  ]);
  assert.deepEqual(
    game.players.map((player, seat) => player.score - before[seat]),
    [2 * event.points, -event.points, -event.points],
  );
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：无论哪一家弃牌，双胡均优先弃牌者的下家，而非先响应者
// Scenario: double hu always prioritizes the discarder’s next seat, not response order, for all three discarders
test("double hu always prioritizes the discarder’s next seat, not response order, for all three discarders", () => {
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 [0,1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [0,1,2] with the same checks, preserving the listed order.
  // Exercise each entry in [false,true] with the same checks, preserving the listed order.
  for (const fromSeat of [0, 1, 2]) // 逐项覆盖 [false,true]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    for (const afterKong of [false, true]) {
      const nextSeat = (fromSeat + 1) % 3;
      const otherSeat = (fromSeat + 2) % 3;
      const priority = [nextSeat, otherSeat];
      const hands = [waiting, waiting, waiting].map((hand, seat) =>
        seat === fromSeat ? winning : hand,
      );
      const initial = fixture({
        hands,
        currentSeat: fromSeat,
        kongSeats: afterKong ? [fromSeat] : [],
        firstHuRadishesRevealed: true,
        head: [17, 6],
      });
      const results = [priority, [...priority].reverse()].map(
        (responseOrder) => {
          let game = doAction(initial, fromSeat, "discard", 17);
          assert.deepEqual(
            [...game.claim.eligibleSeats].sort(),
            [...priority].sort(),
          );
          const wallCount = game.wall.length;
          game = doAction(game, responseOrder[0], "hu");
          assert.equal(game.phase, "claim");
          assert.deepEqual(
            game.players.map((player) => player.huCount),
            [0, 0, 0],
          );
          assert.equal(
            game.history.some((event) => event.type === "hu"),
            false,
          );
          assert.equal(game.wall.length, wallCount);
          game = doAction(game, responseOrder[1], "hu");
          const wins = game.history.filter((event) => event.type === "hu");
          assert.deepEqual(
            wins.map((event) => event.seat),
            priority,
          );
          assert.deepEqual(game.discards[0].huSeats, priority);
          assert.equal(game.discards[0].claimedBy, undefined);
          assert.equal(game.discards.length, 1);
          // 逐项覆盖 priority.entries()；同一组检查用于每个样本，顺序以代码列出的集合为准。
          // Exercise each entry in priority.entries() with the same checks, preserving the listed order.
          for (const [index, seat] of priority.entries()) {
            assert.equal(game.players[seat].huCount, 1);
            assert.deepEqual(game.players[seat].winPile, [
              {
                tile: 17,
                source: afterKong ? "kongDiscard" : "discard",
                virtual: index > 0,
                discardIndex: 0,
              },
            ]);
            assert.deepEqual(wins[index].payments, [
              {
                seat: fromSeat,
                delta: -wins[index].points,
              },
              {
                seat,
                delta: wins[index].points,
              },
            ]);
          }
          assert.equal(game.phase, "turn");
          assert.equal(game.currentSeat, nextSeat);
          assert.deepEqual(game.lastDraw, {
            seat: nextSeat,
            tile: 17,
            source: "continuation",
          });
          assert.equal(game.players[nextSeat].hand.length, 14);
          assert.equal(game.players[otherSeat].hand.length, 13);
          assert.equal(game.wall.length, wallCount - 1);
          assert.deepEqual(
            game.history
              .filter((event) => event.type === "draw")
              .map((event) => event.seat),
            [nextSeat],
          );
          // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
          // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
          assertGameInvariants(game);
          return game;
        },
      );
      assert.deepEqual(results[0], results[1]);
    }
});
// 场景：下家优先的双胡结算在每次三家均胡结束前完成首胡和再次胡的全部付款
// Scenario: next-seat double-hu priority settles both first and repeat winners before every all-player-hu finish
test("next-seat double-hu priority settles both first and repeat winners before every all-player-hu finish", () => {
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 [0,1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [0,1,2] with the same checks, preserving the listed order.
  // Exercise each entry in [[0,0],[0,1],[1,0]] with the same checks, preserving the listed order.
  for (const fromSeat of [0, 1, 2]) // 逐项覆盖 [[0,0],[0,1],[1,0]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    for (const winnerCounts of [
      [0, 0],
      [0, 1],
      [1, 0],
    ]) {
      const priority = [(fromSeat + 1) % 3, (fromSeat + 2) % 3];
      const huCounts = [0, 0, 0];
      huCounts[fromSeat] = 1;
      priority.forEach((seat, index) => {
        huCounts[seat] = winnerCounts[index];
      });
      const hands = [waiting, waiting, waiting].map((hand, seat) =>
        seat === fromSeat ? nonWinningSource : hand,
      );
      const initial = fixture({
        hands,
        huCounts,
        currentSeat: fromSeat,
        kongSeats: [fromSeat],
        head: [17],
      });
      const results = [priority, [...priority].reverse()].map(
        (responseOrder) => {
          let game = doAction(initial, fromSeat, "discard", 17);
          const wallCount = game.wall.length;
          game = doAction(game, responseOrder[0], "hu");
          assert.equal(game.phase, "claim");
          assert.deepEqual(
            game.players.map((player) => player.huCount),
            huCounts,
          );
          assert.equal(
            game.history.some(
              (event) => event.type === "hu" || event.type === "finish",
            ),
            false,
          );
          game = doAction(game, responseOrder[1], "hu");
          const wins = game.history.filter((event) => event.type === "hu");
          assert.deepEqual(
            wins.map((event) => event.seat),
            priority,
          );
          assert.deepEqual(game.discards[0].huSeats, priority);
          priority.forEach((seat, index) => {
            assertKongDiscardPayment(game, seat, fromSeat);
            assert.equal(game.players[seat].huCount, winnerCounts[index] + 1);
            assert.equal(game.players[seat].winPile.at(-1).virtual, index > 0);
          });
          assert.equal(game.phase, "finished");
          assert.equal(game.finishReason, "allPlayersHu");
          assert.equal(game.wall.length, wallCount);
          assert.equal(game.lastDraw, null);
          assert.equal(
            game.history.some((event) => event.type === "draw"),
            false,
          );
          assert.equal(game.history.at(-1).type, "finish");
          assert.equal(
            game.history.filter((event) => event.type === "finish").length,
            1,
          );
          // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
          // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
          assertGameInvariants(game);
          return game;
        },
      );
      assert.deepEqual(results[0], results[1]);
    }
});
// 场景：最后一张弃牌双胡保留下家优先，并先完成两家胡牌再因牌墙耗尽结束
// Scenario: double hu on the last discard keeps next-seat priority and both wins before wall exhaustion
test("double hu on the last discard keeps next-seat priority and both wins before wall exhaustion", () => {
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  // 逐项覆盖 [0,1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [0,1,2] with the same checks, preserving the listed order.
  // Exercise each entry in [false,true] with the same checks, preserving the listed order.
  for (const fromSeat of [0, 1, 2]) // 逐项覆盖 [false,true]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    for (const afterKong of [false, true]) {
      const priority = [(fromSeat + 1) % 3, (fromSeat + 2) % 3];
      const hands = [waiting, waiting, waiting].map((hand, seat) =>
        seat === fromSeat ? winning : hand,
      );
      const initial = fixture({
        hands,
        currentSeat: fromSeat,
        kongSeats: afterKong ? [fromSeat] : [],
        wallCount: 0,
        firstHuRadishesRevealed: true,
      });
      const results = [priority, [...priority].reverse()].map(
        (responseOrder) => {
          let game = doAction(initial, fromSeat, "discard", 17);
          game = doAction(game, responseOrder[0], "hu");
          assert.equal(game.phase, "claim");
          game = doAction(game, responseOrder[1], "hu");
          assert.deepEqual(
            game.history
              .filter((event) => event.type === "hu")
              .map((event) => event.seat),
            priority,
          );
          assert.deepEqual(game.discards[0].huSeats, priority);
          assert.equal(game.players[priority[0]].winPile[0].virtual, false);
          assert.equal(game.players[priority[1]].winPile[0].virtual, true);
          assert.equal(game.phase, "finished");
          assert.equal(game.finishReason, "wallExhausted");
          assert.equal(game.wall.length, 0);
          assert.equal(
            game.history.some((event) => event.type === "draw"),
            false,
          );
          assert.equal(game.history.at(-1).type, "finish");
          // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
          // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
          assertGameInvariants(game);
          return game;
        },
      );
      assert.deepEqual(results[0], results[1]);
    }
});
// 场景：胡后暗杠、补杠和第五张加杠均为强制，旧客户端跳过请求失败且不改变状态
// Scenario: post-hu concealed, supplement and fifth-tile kongs are mandatory and old-client skips are immutable failures
test("post-hu concealed, supplement and fifth-tile kongs are mandatory and old-client skips are immutable failures", () => {
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  // 逐项覆盖 ['anGang','buGang','addGang']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['anGang','buGang','addGang'] with the same checks, preserving the listed order.
  for (const type of ["anGang", "buGang", "addGang"]) {
    const game = postHuKongGame({
      type,
    });
    const tile = game.lastDraw.tile;
    assert.deepEqual(getLegalActions(game, 0), [
      {
        type,
        tile,
      },
    ]);
    assert.deepEqual(getPlayerView(game, 0).legalActions, [
      {
        type,
        tile,
      },
    ]);
    const before = structuredClone(game);
    // 逐项覆盖 [{type:'pass'},{type:'discard',tile},{type:'discard',tile:game.players[0].hand.find(value=>value!==tile)}]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in [{type:'pass'},{type:'discard',tile},{type:'discard',tile:game.players[0].hand.find(value=>value!==tile)}] with the same checks, preserving the listed order.
    for (const action of [
      {
        type: "pass",
      },
      {
        type: "discard",
        tile,
      },
      {
        type: "discard",
        tile: game.players[0].hand.find((value) => value !== tile),
      },
    ]) {
      assert.throws(() => applyAction(game, 0, action), /当前不能执行/);
      assert.deepEqual(game, before);
    }
    const restored = JSON.parse(JSON.stringify(game));
    assert.deepEqual(getPlayerView(restored, 0), getPlayerView(game, 0));
    const next = doAction(restored, 0, type, tile);
    assert.equal(next.history.filter((event) => event.type === type).length, 1);
    assert.equal(next.lastDraw.source, "replacement");
    assert.equal(next.players[0].huCount, 1);
    assert.equal(has(next, 0, "hu"), true);
    assertGameInvariants(next);
  }
});
// 场景：未胡玩家可放弃自己的杠而出牌，已胡玩家可胡时仅能确认胡
// Scenario: unwon players may discard instead of any own kong, while a real post-hu win requires hu
test("unwon players may discard instead of any own kong, while a real post-hu win requires hu", () => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 逐项覆盖 ['anGang','buGang','addGang']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['anGang','buGang','addGang'] with the same checks, preserving the listed order.
  for (const type of ["anGang", "buGang", "addGang"]) {
    const game = postHuKongGame({
      type,
      huCount: 0,
    });
    const tile = game.lastDraw.tile;
    assert.equal(has(game, 0, type, tile), true);
    assert.equal(has(game, 0, "discard", tile), true);
    assertGameInvariants(doAction(game, 0, "discard", tile));
    const winningGame = postHuKongGame({
      type,
      winningDraw: true,
    });
    assert.deepEqual(getLegalActions(winningGame, 0), [{ type: "hu" }]);
    // 已胡可胡必须确认胡，过牌不能跳过此次结算。
    // A previous winner must confirm hu; passing cannot skip this settlement.
    const before = structuredClone(winningGame);
    assert.throws(() => doAction(winningGame, 0, "pass"));
    assert.throws(() => doAction(winningGame, 0, "discard", winningGame.lastDraw.tile));
    assert.deepEqual(winningGame, before);
    assertGameInvariants(doAction(winningGame, 0, "hu"));
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17];
  const huBeforeKong = fixture({
    hands: [hand, waiting, waiting],
    huCounts: [1, 0, 0],
    drawTile: 0,
  });
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  assert.deepEqual(getLegalActions(huBeforeKong, 0), [{ type: "hu" }]);
});
// 场景：牌墙不足以供杠或杠会丢失听口时，胡后自动出牌仍执行
// Scenario: post-hu auto-discard still runs when the wall cannot fund a kong or the kong would lose waits
test("post-hu auto-discard still runs when the wall cannot fund a kong or the kong would lose waits", () => {
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  // 逐项覆盖 ['anGang','buGang','addGang']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['anGang','buGang','addGang'] with the same checks, preserving the listed order.
  for (const type of ["anGang", "buGang", "addGang"]) {
    const source = postHuKongGame({
      type,
    });
    const tile = source.lastDraw.tile;
    const baseHand = [...source.players[0].hand];
    baseHand.splice(baseHand.indexOf(tile), 1);
    const initial = fixture({
      hands: [baseHand, waiting, [...waiting, 6]],
      melds: [source.players[0].melds, [], []],
      huCounts: [1, 0, 0],
      currentSeat: 2,
      drawTile: 6,
      head: [tile, 6],
      wallCount: 2,
    });
    const game = doAction(initial, 2, "discard", 6);
    assert.ok(
      game.history.some(
        (event) =>
          event.type === "discard" &&
          event.seat === 0 &&
          event.tile === tile &&
          event.automatic,
      ),
    );
    assert.equal(
      game.history.some((event) => event.type.endsWith("Gang")),
      false,
    );
    assert.equal(game.currentSeat, 1);
    assert.deepEqual(
      game.players[0].hand,
      [...baseHand].sort((a, b) => a - b),
    );
    // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
    // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
    assertGameInvariants(game);
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const beforeDraw = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17];
  const initial = fixture({
    hands: [beforeDraw, waiting, [...waiting, 8]],
    huCounts: [1, 0, 0],
    currentSeat: 2,
    drawTile: 8,
    head: [6, 7],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const game = doAction(initial, 2, "discard", 8);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.ok(
    game.history.some(
      (event) =>
        event.type === "discard" &&
        event.seat === 0 &&
        event.tile === 6 &&
        event.automatic,
    ),
  );
  assert.equal(
    game.history.some((event) => event.type === "anGang"),
    false,
  );
  assert.equal(game.currentSeat, 1);
  assert.deepEqual(game.players[0].hand, beforeDraw);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：反馈的自动七筒杠后弃牌支付 34 而非 68 分，且不向无关玩家收费
// Scenario: reported automatic seven-circles kong discard pays 34 not 68 and never charges the unrelated player
test("reported automatic seven-circles kong discard pays 34 not 68 and never charges the unrelated player", () => {
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  // 逐项覆盖 [0,1]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [0,1] with the same checks, preserving the listed order.
  for (const unrelatedHuCount of [0, 1]) {
    const sourceHand = [2, 3, 4, 5, 6, 7, 8, 10, 11, 17, 17];
    const winnerHand = waiting.map((tile) => (tile === 17 ? 15 : tile));
    const sharedRadishes = [0, 3, 9, 12, 15].flatMap((tile) => [
      tile,
      tile,
      tile,
    ]);
    let game = fixture({
      hands: [waiting, sourceHand, winnerHand],
      melds: [[], [meld(2)], []],
      huCounts: [unrelatedHuCount, 1, 0],
      currentSeat: 1,
      drawTile: 2,
      head: [15, 6],
      tail: [16],
      radishes: [sharedRadishes, [], []],
      rules: {
        baseFan: 8,
      },
    });
    assert.deepEqual(getLegalActions(game, 1), [
      {
        type: "buGang",
        tile: 2,
      },
    ]);
    game = doAction(game, 1, "buGang", 2);
    assert.equal(game.phase, "claim");
    assert.ok(
      game.history.some(
        (event) =>
          event.type === "discard" &&
          event.seat === 1 &&
          event.tile === 15 &&
          event.afterKong &&
          event.automatic,
      ),
    );
    const beforeHuScores = game.players.map((player) => player.score);
    assert.deepEqual(beforeHuScores, [-1, 2, -1]); // The separate supplement-kong fee remains valid.
    game = passAll(doAction(game, 2, "hu"));
    const event = assertKongDiscardPayment(game, 2, 1);
    assert.equal(event.tile, 15);
    assert.equal(event.score.fan, 8);
    assert.equal(event.score.fanPoints, 16);
    assert.equal(event.score.radishBonus, 18);
    assert.equal(event.points, 34);
    assert.deepEqual(event.payments, [
      {
        seat: 1,
        delta: -34,
      },
      {
        seat: 2,
        delta: 34,
      },
    ]);
    assert.deepEqual(
      game.players.map((player, seat) => player.score - beforeHuScores[seat]),
      [0, -34, 34],
    );
    assert.equal(game.players[0].huCount, unrelatedHuCount);
    // 另一玩家已胡时，本次双胡会使全员已胡，因此应触发该结束原因。
    // If the other player already won, this double win completes all players and should use that finish reason.
    if (unrelatedHuCount) assert.equal(game.finishReason, "allPlayersHu");
    // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
    // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
    assertGameInvariants(game);
  }
});
// 场景：反馈的四筒事件顺序允许下一次自然摸牌前再次胡一筒和四筒
// Scenario: reported four-dot chronology allows repeat one-dot and four-dot claims before the next natural draw
test("reported four-dot chronology allows repeat one-dot and four-dot claims before the next natural draw", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [1, 2, 3, 10, 11, 12, 12];
  const groups = [meld(13, "mingGang"), meld(5)];
  let game = fixture({
    hands: [waiting, hand, [...waiting, 12]],
    melds: [[], groups, []],
    currentSeat: 2,
    drawTile: 12,
    head: [10, 9, 12, 10, 9],
    rules: {
      specialHuPatterns: true,
    },
  });
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  assert.deepEqual(getWaitTiles(hand, groups), [9, 12]);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 2, "discard", 12);
  game = passAll(doAction(game, 1, "hu"));
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[1].huCount, 1);
  assert.equal(game.players[1].huLockActive, true);
  assert.equal(game.currentSeat, 2);
  assert.equal(game.lastDraw.tile, 9);
  // The only draw by seat two since its first hu was continuation, not natural.
  assert.deepEqual(
    game.history
      .filter((e) => e.type === "draw" && e.seat === 1)
      .map((e) => e.source),
    ["continuation"],
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  // 从同一首胡后状态分别接一筒和四筒，不能先跳过已胡玩家的一筒胡。
  // Branch from the same post-win state: mandatory one-dot hu cannot be skipped to reach four dots.
  const afterFirstHu = game;
  for (const tile of [9, 12]) {
    game = doAction(afterFirstHu, 2, "discard", tile);
    assert.deepEqual(getLegalActions(game, 1), [{ type: "hu" }]);
    assert.equal(getHuDiagnostic(game, 1).code, "AVAILABLE");
    const before = structuredClone(game);
    assert.throws(() => doAction(game, 1, "pass"));
    assert.deepEqual(game, before);
    const reconnected = JSON.parse(JSON.stringify(game));
    assert.deepEqual(getLegalActions(reconnected, 1), [{ type: "hu" }]);
    game = passAll(doAction(reconnected, 1, "hu"));
    const wins = game.history.filter(event => event.type === "hu" && event.seat === 1);
    assert.deepEqual(wins.map(event => event.tile), [12, tile]);
    assert.equal(wins[1].source, "discard");
    assert.equal(wins[1].fromSeat, 2);
    assert.deepEqual(wins[1].payments.filter(payment => payment.delta < 0).map(payment => payment.seat), [2]);
    assert.equal(game.history.some(event => event.type === "draw" && event.seat === 1 && event.source === "normal"), false);
    assertGameInvariants(game);
  }
});

// 场景：两名此前已胡玩家均可原子地胡普通弃牌，并按稳定顺时针顺序结算
// Scenario: both prior winners can claim an ordinary discard atomically in stable clockwise order
test("both prior winners can claim an ordinary discard atomically in stable clockwise order", () => {
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  // 逐项覆盖 [[1,2],[2,1]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [[1,2],[2,1]] with the same checks, preserving the listed order.
  for (const order of [
    [1, 2],
    [2, 1],
  ]) {
    let game = fixture({
      huCounts: [0, 1, 1],
      priorWins: [[], [17], [17]],
      locks: [[], [17], [17]],
      activeLocks: [false, true, true],
      head: [6],
    });
    game = doAction(game, 0, "discard", 17);
    assert.deepEqual(game.claim.eligibleSeats, [1, 2]);
    game = doAction(game, order[0], "hu");
    assert.equal(
      game.history.some((e) => e.type === "hu"),
      false,
    );
    game = doAction(game, order[1], "hu");
    const wins = game.history.filter((e) => e.type === "hu");
    assert.deepEqual(
      wins.map((e) => e.seat),
      [1, 2],
    );
    assert.ok(wins.every((e) => e.source === "discard" && e.fromSeat === 0));
    assert.deepEqual(
      game.players.map((p) => p.huCount),
      [0, 2, 2],
    );
    // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
    // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
    assertGameInvariants(game);
  }
});
// 场景：胡后自动出牌是经过验证的每局规则，默认值兼容旧局
// Scenario: post-hu auto-discard is a validated per-game rule with backward-compatible default
test("post-hu auto-discard is a validated per-game rule with backward-compatible default", () => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(
    createGame({
      seed: 1,
    }).rules.autoDiscardAfterHu,
    true,
  );
  // 逐项覆盖 [true,false]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [true,false] with the same checks, preserving the listed order.
  for (const value of [true, false])
    assert.equal(
      createGame({
        seed: 1,
        rules: {
          autoDiscardAfterHu: value,
        },
      }).rules.autoDiscardAfterHu,
      value,
    );
  // 逐项覆盖 [null,0,1,'','false',[],{}]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [null,0,1,'','false',[],{}] with the same checks, preserving the listed order.
  for (const value of [null, 0, 1, "", "false", [], {}])
    assert.throws(
      () =>
        createGame({
          rules: {
            autoDiscardAfterHu: value,
          },
        }),
      /必须为布尔值/,
    );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const automatic = fixture({
    hands: [nonWinningSource, waiting, waiting],
    huCounts: [1, 1, 0],
    head: [6, 7],
  });
  const legacy = structuredClone(automatic);
  delete legacy.rules.autoDiscardAfterHu;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const expected = doAction(automatic, 0, "discard", 17);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  delete expected.rules.autoDiscardAfterHu;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(doAction(legacy, 0, "discard", 17), expected);
  assert.equal(
    legacy.rules.autoDiscardAfterHu,
    undefined,
    "saved rules are not migrated",
  );
});
// 场景：未勾选自动选项时，首次胡牌续摸后暂停，直到玩家点击过牌
// Scenario: unchecked option stops after a first hu continuation until the player presses pass
test("unchecked option stops after a first hu continuation until the player presses pass", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const initial = fixture({
    head: [6, 7],
    tail: [1, 2, 3, 4, 5, 6],
    rules: {
      autoDiscardAfterHu: false,
    },
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const won = doAction(initial, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(won.currentSeat, 0);
  assert.equal(won.lastDraw.source, "continuation");
  assert.equal(won.lastDraw.tile, 6);
  assert.equal(won.players[0].huCount, 1);
  assert.deepEqual(won.discards, []);
  assert.deepEqual(getLegalActions(won, 0), [
    {
      type: "pass",
    },
  ]);
  assert.deepEqual(
    won.players[0].hand,
    [...waiting, 6].sort((a, b) => a - b),
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const before = structuredClone(won);
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  // 逐项覆盖 [[0,{type:'discard',tile:6}],[0,{type:'discard',tile:0}],[1,{type:'pass'}],[0,{type:'pass',tile:6}]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [[0,{type:'discard',tile:6}],[0,{type:'discard',tile:0}],[1,{type:'pass'}],[0,{type:'pass',tile:6}]] with the same checks, preserving the listed order.
  for (const [seat, action] of [
    [
      0,
      {
        type: "discard",
        tile: 6,
      },
    ],
    [
      0,
      {
        type: "discard",
        tile: 0,
      },
    ],
    [
      1,
      {
        type: "pass",
      },
    ],
    [
      0,
      {
        type: "pass",
        tile: 6,
      },
    ],
  ]) {
    assert.throws(() => applyAction(won, seat, action), /当前不能执行/);
    assert.deepEqual(won, before);
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const restored = JSON.parse(JSON.stringify(won));
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  for (let seat = 0; seat < 3; seat++) {
    const view = getPlayerView(restored, seat);
    assert.equal(view.rules.autoDiscardAfterHu, false);
    assert.equal(view.drawnTile, seat === 0 ? 6 : null);
    assert.deepEqual(
      view.legalActions,
      seat === 0
        ? [
            {
              type: "pass",
            },
          ]
        : [],
    );
    // 逐项覆盖 view.players；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in view.players with the same checks, preserving the listed order.
    for (const player of view.players)
      assert.equal("hand" in player, player.seat === seat);
  }
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const next = doAction(restored, 0, "pass");
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  assert.deepEqual(next.players[0].hand, waiting);
  assert.equal(next.discards.length, 1);
  assert.equal(next.discards[0].tile, 6);
  assert.equal(
    next.history.find((event) => event.type === "discard").automatic,
    false,
  );
  assert.equal(next.currentSeat, 1);
  assert.equal(next.lastDraw.tile, 7);
  assert.deepEqual(
    next.players.map((player) => player.score),
    won.players.map((player) => player.score),
  );
  assert.equal(next.players.flatMap((player) => player.radishes).length, 6);
  assertGameInvariants(next);
});
// 场景：手动胡后模式在每次自然摸牌后暂停，不跳过连续已胡玩家
// Scenario: manual post-hu mode stops for every natural draw instead of skipping consecutive won players
test("manual post-hu mode stops for every natural draw instead of skipping consecutive won players", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    hands: [nonWinningSource, waiting, waiting],
    huCounts: [1, 1, 0],
    head: [6, 7],
    rules: {
      autoDiscardAfterHu: false,
    },
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(getLegalActions(game, 0), [
    {
      type: "pass",
    },
  ]);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "pass");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.currentSeat, 1);
  assert.equal(game.lastDraw.source, "normal");
  assert.equal(game.lastDraw.tile, 6);
  assert.equal(game.discards.length, 1);
  assert.deepEqual(getLegalActions(game, 1), [
    {
      type: "pass",
    },
  ]);
  assert.equal(game.players[1].hand.length, 14);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 1, "pass");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.currentSeat, 2);
  assert.equal(game.discards.length, 2);
  assert.equal(game.lastDraw.tile, 7);
  assert.equal(game.players[1].hand.length, 13);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：手动模式保留再次胡牌选择及强制合法自杠，不能通过出牌绕过杠
// Scenario: manual mode retains repeated hu choices and mandatory legal own kongs without a discard bypass
test("manual mode retains repeated hu choices and mandatory legal own kongs without a discard bypass", () => {
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  // 逐项覆盖 ['anGang','buGang','addGang']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['anGang','buGang','addGang'] with the same checks, preserving the listed order.
  for (const type of ["anGang", "buGang", "addGang"]) {
    const game = postHuKongGame({
      type,
    });
    game.rules.autoDiscardAfterHu = false;
    assert.deepEqual(getLegalActions(game, 0), [
      {
        type,
        tile: game.lastDraw.tile,
      },
    ]);
    // 逐项覆盖 [{type:'pass'},{type:'discard',tile:game.lastDraw.tile}]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in [{type:'pass'},{type:'discard',tile:game.lastDraw.tile}] with the same checks, preserving the listed order.
    for (const action of [
      {
        type: "pass",
      },
      {
        type: "discard",
        tile: game.lastDraw.tile,
      },
    ])
      assert.throws(() => applyAction(game, 0, action));
    const replacement = doAction(game, 0, type, game.lastDraw.tile);
    assert.deepEqual(getLegalActions(replacement, 0), [{ type: "hu" }]);
    assertGameInvariants(doAction(replacement, 0, "hu"));
    const winningGame = postHuKongGame({
      type,
      winningDraw: true,
    });
    winningGame.rules.autoDiscardAfterHu = false;
    assert.deepEqual(getLegalActions(winningGame, 0), [{ type: "hu" }]);
    // 已胡可胡必须确认胡，过牌不能跳过此次结算。
    // A previous winner must confirm hu; passing cannot skip this settlement.
    const before = structuredClone(winningGame);
    assert.throws(() => doAction(winningGame, 0, "pass"));
    assert.throws(() => doAction(winningGame, 0, "discard", winningGame.lastDraw.tile));
    assert.deepEqual(winningGame, before);
    assertGameInvariants(doAction(winningGame, 0, "hu"));
    const unwon = postHuKongGame({
      type,
      huCount: 0,
    });
    unwon.rules.autoDiscardAfterHu = false;
    assert.ok(has(unwon, 0, type));
    assert.ok(has(unwon, 0, "discard"));
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let repeated = fixture({
    head: [17, 6],
    rules: {
      autoDiscardAfterHu: false,
    },
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  repeated = doAction(repeated, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(getLegalActions(repeated, 0), [{ type: "hu" }]);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  repeated = doAction(repeated, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(repeated.players[0].huCount, 2);
  assert.equal(repeated.currentSeat, 0);
  assert.deepEqual(getLegalActions(repeated, 0), [
    {
      type: "pass",
    },
  ]);
  assert.equal(repeated.discards.length, 0);
  assertGameInvariants(repeated);
});
// 场景：手动模式杠后补牌等待过牌，并保留杠后响应及仅来源玩家付款的规则
// Scenario: manual kong replacement waits for pass and preserves after-kong claims and source-only payment
test("manual kong replacement waits for pass and preserves after-kong claims and source-only payment", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = postHuKongGame();
  game.rules.autoDiscardAfterHu = false;
  const index = game.wall.indexOf(17);
  [game.wall[0], game.wall[index]] = [game.wall[index], game.wall[0]];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "buGang", 2);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.currentSeat, 0);
  assert.equal(game.lastDraw.tile, 17);
  assert.equal(game.lastDraw.source, "replacement");
  assert.equal(game.players[0].pendingKongDiscard, true);
  assert.deepEqual(getLegalActions(game, 0), [
    {
      type: "pass",
    },
  ]);
  assert.equal(game.discards.length, 0);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "pass");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.phase, "claim");
  assert.equal(game.discards[0].afterKong, true);
  assert.equal(game.players[0].pendingKongDiscard, false);
  assert.equal(
    game.history.find((event) => event.type === "discard").automatic,
    false,
  );
  assert.equal(has(game, 1, "hu"), true);
  assert.equal(has(game, 1, "peng"), false);
  assert.equal(has(game, 1, "mingGang"), false);
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
  assert.deepEqual(
    event.payments.map((item) => item.seat),
    [0, 1],
  );
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：手动模式在不能杠时仍等待，牌墙耗尽及第三家胡牌均只结算一次
// Scenario: manual mode still waits when kong is illegal, and final wall/third-player hu settle exactly once
test("manual mode still waits when kong is illegal, and final wall/third-player hu settle exactly once", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const source = postHuKongGame();
  const baseHand = [...source.players[0].hand];
  baseHand.splice(baseHand.indexOf(2), 1);
  let game = fixture({
    hands: [baseHand, waiting, [...waiting, 6]],
    melds: [source.players[0].melds, [], []],
    huCounts: [1, 0, 0],
    currentSeat: 2,
    drawTile: 6,
    head: [2],
    wallCount: 1,
    rules: {
      autoDiscardAfterHu: false,
    },
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 2, "discard", 6);
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  assert.equal(game.wall.length, 0);
  assert.equal(game.phase, "turn");
  assert.equal(game.currentSeat, 0);
  assert.deepEqual(getLegalActions(game, 0), [
    {
      type: "pass",
    },
  ]);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "pass");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.phase, "finished");
  assert.equal(game.finishReason, "wallExhausted");
  assert.equal(game.dragonSettlement.settled, true);
  assert.equal(
    game.history.filter((event) => event.type === "finish").length,
    1,
  );
  assert.throws(() => doAction(game, 0, "pass"));
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const final = fixture({
    hands: [waiting, waiting, winning],
    huCounts: [1, 1, 0],
    currentSeat: 2,
    rules: {
      autoDiscardAfterHu: false,
    },
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const result = doAction(final, 2, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(result.phase, "finished");
  assert.equal(result.finishReason, "allPlayersHu");
  assert.equal(result.wall.length, final.wall.length);
  assert.equal(
    result.history.some((event) => event.type === "draw"),
    false,
  );
  assertGameInvariants(result);
});
// 场景：100 对完整对局中，自动与手动胡后出牌模式保持相同牌张及积分
// Scenario: 100 paired full games keep identical tiles and scores with automatic versus manual post-hu discard
test("100 paired full games keep identical tiles and scores with automatic versus manual post-hu discard", () => {
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  const play = (seed, autoDiscardAfterHu) => {
    let game = createGame({
      seed,
      rules: {
        autoDiscardAfterHu,
      },
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
      const action =
        legal.find((item) => item.type === "hu") ||
        legal.find((item) => item.type.endsWith("Gang")) ||
        legal[0];
      assert.ok(action, `No legal action at seed ${seed}`);
      game = applyAction(game, seat, action);
      // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
      // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
      assertGameInvariants(game);
      assert.equal(
        game.players.reduce((sum, player) => sum + player.score, 0),
        0,
      );
    }
    return game;
  };
  for (let seed = 0; seed < 100; seed++) {
    const automatic = play(seed, true),
      manual = play(seed, false);
    // 逐项覆盖 ['players','wall','discards','retiredTiles','finishReason','dragonSettlement']；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in ['players','wall','discards','retiredTiles','finishReason','dragonSettlement'] with the same checks, preserving the listed order.
    for (const key of [
      "players",
      "wall",
      "discards",
      "retiredTiles",
      "finishReason",
      "dragonSettlement",
    ]) {
      assert.deepEqual(
        manual[key],
        automatic[key],
        `Seed ${seed}: ${key} changed with pacing`,
      );
    }
  }
});
