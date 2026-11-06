// 最早版本的手动摸牌与独立计分契约，保护旧桌继续游戏。
// Original manual-draw and scoring contract, preserving playable legacy tables.
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
} from "../shared/legacy-game.js";
const waiting = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
const winning = [...waiting, 17];
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

/** Deterministic test fixture with real eight-copy tile conservation. */
// 按本文件的参数构造场景；规则版本、手牌与牌墙由各测试显式选择。不要把 UI 快照误当成完整引擎状态。
// Build the local scenario from its parameters; each test chooses rules, hands and wall. A UI snapshot is not a complete engine state.
function fixture({
  hands = [winning, waiting, waiting],
  melds = [[], [], []],
  radishes = [[], [], []],
  huCounts = [0, 0, 0],
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
    player.huCount = huCounts[seat];
    player.lockedWaits = [...locks[seat]];
    player.huLockActive = activeLocks[seat];
    player.pendingKongDiscard = kongSeats.includes(seat);
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
          source: "normal",
        }
      : null;
  game.discards = [];
  // 已胡的实物牌仍占一张物理配额；winPile 是展示/计分引用，不能当成新增的牌。
  // Physical winning tiles still occupy one copy; winPile is a display/scoring reference, not newly created tiles.
  game.retiredTiles = [];
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
  head.forEach(use);
  tail.forEach(use);
  let rest = counts.flatMap((count, tile) => Array(count).fill(tile));
  // 仅在明确指定墙牌数时裁剪；多出的实物牌必须移入退役区，不能消失。
  // Trim the wall only when explicitly requested; surplus physical tiles must be retired, not disappear.
  if (wallCount !== undefined) {
    const targetRest = wallCount - head.length - tail.length;
    assert.ok(targetRest >= 0);
    const retired = rest.splice(targetRest);
    // 已胡的实物牌仍占一张物理配额；winPile 是展示/计分引用，不能当成新增的牌。
    // Physical winning tiles still occupy one copy; winPile is a display/scoring reference, not newly created tiles.
    game.retiredTiles = retired.map((tile) => ({
      seat: 0,
      tile,
    }));
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
  while (game.phase === "claim") {
    const seat = game.claim.eligibleSeats.find(
      (value) => !game.claim.responses[value],
    );
    game = doAction(game, seat, "pass");
  }
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
// 场景：共 144 张牌、每种八张、三个座位，庄家十四张
// Scenario: 144 tiles, eight of each, three seats, dealer has fourteen
test("144 tiles, eight of each, three seats, dealer has fourteen", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const game = createGame({
    seed: 42,
  });
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  assert.deepEqual(
    game.players.map((p) => p.hand.length),
    [14, 13, 13],
  );
  assert.equal(game.wall.length, 104);
  assert.equal(game.currentSeat, 0);
  assert.equal(game.turnStep, "discard");
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
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
// 场景：生产洗牌在不提供种子时也能工作
// Scenario: production shuffle works without a seed
test("production shuffle works without a seed", () => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assertGameInvariants(createGame());
});
// 场景：拒绝不支持或不安全的规则配置
// Scenario: rejects unsupported or unsafe rule configuration
test("rejects unsupported or unsafe rule configuration", () => {
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  // 逐项覆盖 下列集合；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in the following collection with the same checks, preserving the listed order.
  for (const rules of [
    {
      sevenPairs: "yes",
    },
    {
      baseHuPoints: -1,
    },
    {
      dragonPoints: {
        9: 50,
      },
    },
    {
      repeatHuLock: "never",
    },
    {
      arbitrary: true,
    },
    JSON.parse('{"__proto__":true}'),
  ]) {
    assert.throws(() =>
      createGame({
        seed: 1,
        rules,
      }),
    );
  }
});
// 场景：验证标准胡牌、非法牌型、花色边界及副露
// Scenario: standard win, invalid shape, suit boundaries and exposed melds
test("standard win, invalid shape, suit boundaries and exposed melds", () => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(isWinningHand(winning), true);
  assert.equal(isWinningHand(waiting), false);
  assert.equal(
    isWinningHand([6, 7, 8, 9, 10, 11, 12, 13, 14, 0, 1, 2, 17, 17]),
    true,
  );
  assert.equal(
    isWinningHand([7, 8, 9, 0, 1, 2, 3, 4, 5, 12, 13, 14, 17, 17]),
    false,
  );
  assert.equal(isWinningHand([0, 1, 2, 9, 10, 11, 17, 17], 2), true);
  assert.equal(isWinningHand([0, 1, 2, 9, 10, 11, 17, 17], 1), false);
  assert.equal(isWinningHand(Array(14).fill(0)), false);
});
// 场景：七对可配置，四张相同牌视为两对
// Scenario: seven pairs can be configured and four copies count as two pairs
test("seven pairs can be configured and four copies count as two pairs", () => {
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
});
// 场景：听口集合基于结构牌型，且不越过花色范围
// Scenario: wait sets are based on structural shape and stay inside suit ranges
test("wait sets are based on structural shape and stay inside suit ranges", () => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(getWaitTiles(waiting), [17]);
  assert.deepEqual(
    getWaitTiles([0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 16]),
    [16],
  );
  assert.deepEqual(getWaitTiles(winning), []);
});
// 场景：动作不修改原状态，并拒绝错误回合、未知类型和格式错误的牌
// Scenario: actions are immutable, reject wrong turn, unknown types and malformed tiles
test("actions are immutable, reject wrong turn, unknown types and malformed tiles", () => {
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
        type: "draw",
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
  ]) {
    assert.throws(() => applyAction(game, seat, action));
  }
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
});
// 场景：视图只包含观察者自己的手牌，不含牌墙、种子、隐藏摸牌或其他玩家的锁
// Scenario: views contain only the viewer’s hand, no wall, seed, hidden draws or other locks
test("views contain only the viewer’s hand, no wall, seed, hidden draws or other locks", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const game = createGame({
    seed: 44,
  });
  game.players[0].lockedWaits = [4, 7];
  const view = getPlayerView(game, 1);
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  assert.equal(view.players[0].hand, undefined);
  assert.equal(view.players[2].hand, undefined);
  assert.deepEqual(view.players[1].hand, game.players[1].hand);
  assert.equal(view.players[0].lockedWaits, undefined);
  assert.equal(view.wall, undefined);
  assert.equal(view.lastDraw, undefined);
  assert.equal(view.seed, undefined);
  assert.equal(view.drawnTile, null);
  assert.throws(() => getPlayerView(game, -1));
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  view.players[1].hand[0] = 99;
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  assert.notEqual(game.players[1].hand[0], 99);
});
// 场景：自然摸牌在历史中保持私密，只有本人视图显示摸到的牌
// Scenario: a natural draw is private in history and only own view exposes drawn tile
test("a natural draw is private in history and only own view exposes drawn tile", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = createGame({
    seed: 5,
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = passAll(doAction(game, 0, "discard", game.players[0].hand[0]));
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const seat = game.currentSeat;
  const tile = game.wall[0];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, seat, "draw");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.history.at(-1).tile, undefined);
  assert.equal(getPlayerView(game, seat).drawnTile, tile);
  assert.equal(getPlayerView(game, (seat + 1) % 3).drawnTile, null);
});
// 场景：首次自摸翻六张牌尾萝卜、胡牌实体只用一次，并由同一座位继续行动
// Scenario: first selfdraw flips six tail radishes, uses tile once, and same seat continues
test("first selfdraw flips six tail radishes, uses tile once, and same seat continues", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    tail: [1, 2, 3, 4, 5, 6],
  });
  const wallCount = game.wall.length;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.phase, "turn");
  assert.equal(game.currentSeat, 0);
  assert.equal(game.turnStep, "draw");
  assert.equal(game.drawKind, "continuation");
  assert.deepEqual(game.players[0].radishes, [6, 5, 4, 3, 2, 1]);
  assert.equal(game.players[0].hand.length, 13);
  assert.equal(game.players[0].huCount, 1);
  assert.equal(game.wall.length, wallCount - 6);
  assert.deepEqual(game.retiredTiles, [
    {
      seat: 0,
      tile: 17,
    },
  ]);
  assert.equal(has(game, 0, "hu"), false);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：立即续摸时，相同听口不能再次胡牌
// Scenario: same waits cannot repeat hu on immediate continuation draw
test("same waits cannot repeat hu on immediate continuation draw", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    head: [17],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  game = doAction(game, 0, "draw");
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  assert.equal(isWinningHand(game.players[0].hand), true);
  assert.equal(game.players[0].huLockActive, true);
  assert.equal(has(game, 0, "hu"), false);
  assert.throws(() => doAction(game, 0, "hu"));
});
// 场景：下一次自然摸牌后相同听口可再次胡牌，不会永久禁止
// Scenario: same wait can hu again after next natural draw; not permanently forbidden
test("same wait can hu again after next natural draw; not permanently forbidden", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    hands: [waiting, waiting, waiting],
    currentSeat: 0,
    turnStep: "draw",
    head: [17],
    huCounts: [1, 0, 0],
    locks: [[17], [], []],
    activeLocks: [true, false, false],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "draw");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[0].huLockActive, false);
  assert.equal(has(game, 0, "hu"), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[0].huCount, 2);
  assert.equal(game.players[0].radishes.length, 0, "only first win flips six");
});
// 场景：可选 untilWaitChange 规则即使自然摸牌后也继续禁止重叠听口胡牌
// Scenario: alternate untilWaitChange keeps overlap blocked even on natural draw
test("alternate untilWaitChange keeps overlap blocked even on natural draw", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    hands: [waiting, waiting, waiting],
    turnStep: "draw",
    head: [17],
    rules: {
      repeatHuLock: "untilWaitChange",
    },
    huCounts: [1, 0, 0],
    locks: [[17], [], []],
    activeLocks: [true, false, false],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "draw");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 0, "hu"), false);
});
// 场景：任一听口重叠都会禁止胡牌，完全不相交的听口则可允许
// Scenario: one overlapping wait blocks hu; fully disjoint waits can be allowed
test("one overlapping wait blocks hu; fully disjoint waits can be allowed", () => {
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
});
// 场景：萝卜分按实体张数相乘：手中两张乘两张萝卜等于四分
// Scenario: radish scores multiply physical counts: 2 in hand × 2 radishes = 4
test("radish scores multiply physical counts: 2 in hand × 2 radishes = 4", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    tail: [6, 7, 8, 15, 17, 17],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const entry = game.history.find((event) => event.type === "hu");
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(entry.score.radishBonus, 4);
  assert.equal(entry.score.base, 1);
  assert.equal(entry.score.total, 5);
  assert.deepEqual(
    game.players.map((p) => p.score),
    [10, -5, -5],
  );
  assert.equal(entry.score.handCounts, undefined);
});
// 场景：拥有的匹配牌达六、七、八张龙时支付 10、20、40 分，且可配置
// Scenario: dragon 6/7/8 matching owned tiles pays 10/20/40 and is configurable
test("dragon 6/7/8 matching owned tiles pays 10/20/40 and is configurable", () => {
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 [[6,10],[7,20],[8,40]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [[6,10],[7,20],[8,40]] with the same checks, preserving the listed order.
  for (const [count, expected] of [
    [6, 10],
    [7, 20],
    [8, 40],
  ]) {
    const hand = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17];
    const radicals = Array(count - 4).fill(0);
    let game = fixture({
      hands: [
        hand,
        waiting.map((tile) => (tile === 0 ? 6 : tile)),
        waiting.map((tile) => (tile === 0 ? 6 : tile)),
      ],
      huCounts: [1, 0, 0],
      radishes: [radicals, [], []],
    });
    game = doAction(game, 0, "hu");
    assert.equal(
      game.history.find((event) => event.type === "hu").score.dragonBonus,
      expected,
    );
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    hands: [
      [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17],
      waiting,
      waiting,
    ],
    huCounts: [1, 0, 0],
    radishes: [[0, 0], [], []],
    rules: {
      dragonPoints: {
        6: 13,
      },
    },
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(
    game.history.find((event) => event.type === "hu").score.dragonBonus,
    13,
  );
});
// 场景：龙与萝卜计分默认包含明面副露中的牌
// Scenario: dragon and radish scoring includes exposed meld tiles by default
test("dragon and radish scoring includes exposed meld tiles by default", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  const meld = {
    type: "peng",
    tile: 0,
    tiles: [0, 0, 0],
    fromSeat: 1,
  };
  let game = fixture({
    hands: [hand, waiting, waiting],
    melds: [[meld], [], []],
    huCounts: [1, 0, 0],
    radishes: [[0, 0, 0], [], []],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.deepEqual(game.history.at(-1).score, {
    base: 1,
    radishBonus: 9,
    dragonBonus: 10,
    total: 20,
  });
});
// 场景：普通荣胡只向弃牌者收费，并保留唯一的实体弃牌
// Scenario: ordinary discard hu charges only discarder and preserves one physical discard
test("ordinary discard hu charges only discarder and preserves one physical discard", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "discard", 17);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.phase, "claim");
  assert.equal(has(game, 1, "hu"), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 1, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.phase, "claim", "must wait for other eligible response");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 2, "pass");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.currentSeat, 1);
  assert.equal(game.players[1].hand.length, 13);
  assert.deepEqual(game.discards[0].huSeats, [1]);
  assert.equal(game.discards[0].claimedBy, undefined);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const entry = game.history.find((event) => event.type === "hu");
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.equal(entry.source, "discard");
  assert.equal(entry.payments.length, 2);
  assert.equal(game.players[2].score, 0);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：已胡玩家的普通弃牌不能被其他人胡
// Scenario: an ordinary discard after discarder has hu cannot be hu by others
test("an ordinary discard after discarder has hu cannot be hu by others", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    huCounts: [1, 0, 0],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "discard", 17);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 1, "hu"), false);
  assert.equal(has(game, 2, "hu"), false);
  assert.notEqual(game.phase, "claim");
});
// 场景：已胡玩家杠后的弃牌可被胡，并按自摸方式付款
// Scenario: post-kong discard can be hu after discarder hu and charges like selfdraw
test("post-kong discard can be hu after discarder hu and charges like selfdraw", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    huCounts: [1, 0, 0],
    kongSeats: [0],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "discard", 17);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 1, "hu"), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 1, "hu");
  game = doAction(game, 2, "pass");
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const event = game.history.find((event) => event.type === "hu");
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.equal(event.source, "kongDiscard");
  assert.equal(event.payments.length, 3);
  assert.ok(game.players[0].score < 0 && game.players[2].score < 0);
  assert.equal(game.players[0].pendingKongDiscard, false);
});
// 场景：响应裁决不受响应先后影响，支持配置一炮多响，且按顺时针处理
// Scenario: claims are response-order independent, multi-winner configurable and clockwise
test("claims are response-order independent, multi-winner configurable and clockwise", () => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  // 用给定回应顺序执行同一抢牌场景，返回结果供顺序无关性比较。
  // Run the same claim scenario in the supplied response order and return its result for order-independence comparisons.
  function result(reverse, multipleWinners) {
    let game = doAction(
      fixture({
        rules: {
          multipleWinners,
        },
      }),
      0,
      "discard",
      17,
    );
    // 逐项覆盖 reverse?[2,1]:[1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in reverse?[2,1]:[1,2] with the same checks, preserving the listed order.
    for (const seat of reverse ? [2, 1] : [1, 2])
      game = doAction(game, seat, "hu");
    return game;
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const forward = result(false, true);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(forward, result(true, true));
  assert.deepEqual(
    forward.players.map((p) => p.huCount),
    [0, 1, 1],
  );
  assert.equal(forward.currentSeat, 1);
  assert.deepEqual(forward.discards[0].huSeats, [1, 2]);
  assert.deepEqual(
    result(false, false).players.map((p) => p.huCount),
    [0, 1, 0],
  );
});
// 场景：响应视图隐藏待裁决选择，拒绝重复响应及无关过牌
// Scenario: claim views hide pending decisions; double response and unrelated pass rejected
test("claim views hide pending decisions; double response and unrelated pass rejected", () => {
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
  assert.throws(() => doAction(game, 2, "pass"));
  assert.throws(() => doAction(game, 0, "pass"));
});
// 场景：碰牌取两张手牌与弃牌组成副露，不摸牌也不立即胡牌
// Scenario: peng takes two hand tiles and the discard, no draw or immediate hu
test("peng takes two hand tiles and the discard, no draw or immediate hu", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand1 = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 17, 17];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let game = doAction(
    fixture({
      hands: [winning, hand1, waiting],
    }),
    0,
    "discard",
    17,
  );
  game = doAction(game, 1, "peng", 17);
  game = doAction(game, 2, "pass");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.currentSeat, 1);
  assert.equal(game.players[1].hand.length, 11);
  assert.deepEqual(game.players[1].melds[0].tiles, [17, 17, 17]);
  assert.equal(game.discards[0].claimedBy, 1);
  assert.equal(has(game, 1, "draw"), false);
  assert.equal(has(game, 1, "hu"), false);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：胡牌优先于碰牌，不受响应时机影响
// Scenario: hu has priority over peng independent of response timing
test("hu has priority over peng independent of response timing", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand1 = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 17, 17];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let game = doAction(
    fixture({
      hands: [winning, hand1, waiting],
    }),
    0,
    "discard",
    17,
  );
  game = doAction(game, 1, "peng", 17);
  game = doAction(game, 2, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.currentSeat, 2);
  assert.equal(game.players[1].melds.length, 0);
  assert.equal(game.players[2].huCount, 1);
});
// 场景：暗杠翻一张牌尾萝卜，再自动从牌墙头补一张牌
// Scenario: concealed kong flips one tail radish and auto-draws one head replacement
test("concealed kong flips one tail radish and auto-draws one head replacement", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17];
  let game = fixture({
    hands: [hand, waiting, waiting],
    head: [6],
    tail: [7],
    drawTile: 0,
  });
  const wall = game.wall.length;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "anGang", 0);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(game.players[0].radishes, [7]);
  assert.equal(game.lastDraw.tile, 6);
  assert.equal(game.players[0].hand.length, 11);
  assert.equal(game.wall.length, wall - 2);
  assert.equal(game.players[0].pendingKongDiscard, true);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const view = getPlayerView(game, 1);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(view.players[0].melds[0].tiles, [null, null, null, null]);
  assert.equal(view.players[0].melds[0].tile, null);
  assert.equal(
    game.history.find((event) => event.type === "anGang").tile,
    undefined,
  );
});
// 场景：明杠只消耗一次弃牌，并获得一张萝卜与一次补牌
// Scenario: exposed kong consumes the discard once and gives one radish plus replacement
test("exposed kong consumes the discard once and gives one radish plus replacement", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand1 = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 17, 17, 17];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let game = doAction(
    fixture({
      hands: [winning, hand1, waiting],
      head: [6],
      tail: [7],
    }),
    0,
    "discard",
    17,
  );
  game = doAction(game, 1, "mingGang", 17);
  game = doAction(game, 2, "pass");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[1].melds[0].type, "mingGang");
  assert.equal(game.players[1].hand.length, 11);
  assert.deepEqual(game.players[1].radishes, [7]);
  assert.equal(game.lastDraw.tile, 6);
  assert.equal(game.discards[0].claimedBy, 1);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：加杠升级已有碰牌，而非新增第五组副露
// Scenario: added kong upgrades existing peng instead of adding a fifth meld
test("added kong upgrades existing peng instead of adding a fifth meld", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 1, 2, 3, 9, 10, 11, 12, 13, 17, 17];
  let game = fixture({
    hands: [hand, waiting, waiting],
    melds: [
      [
        {
          type: "peng",
          tile: 0,
          tiles: [0, 0, 0],
          fromSeat: 1,
        },
      ],
      [],
      [],
    ],
    head: [6],
    tail: [7],
    drawTile: 0,
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "buGang", 0);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[0].melds.length, 1);
  assert.equal(game.players[0].melds[0].type, "buGang");
  assert.equal(game.players[0].melds[0].tiles.length, 4);
  assert.deepEqual(game.players[0].radishes, [7]);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：胡后杠必须保留全部听口，补牌不会解除胡牌锁
// Scenario: post-hu kong must preserve all waits; replacement does not expire hu lock
test("post-hu kong must preserve all waits; replacement does not expire hu lock", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 0, 0, 0, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
  let game = fixture({
    hands: [hand, waiting, waiting],
    drawTile: 0,
    huCounts: [1, 0, 0],
    locks: [[17], [], []],
    activeLocks: [true, false, false],
    head: [17],
    tail: [7],
  });
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  assert.deepEqual(getWaitTiles(hand.filter((_, index) => index !== 0)), [17]);
  assert.equal(has(game, 0, "anGang", 0), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "anGang", 0);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[0].huLockActive, true);
  assert.equal(isWinningHand(game.players[0].hand, 1), true);
  assert.equal(has(game, 0, "hu"), false);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const changingHand = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17];
  game = fixture({
    hands: [changingHand, waiting, waiting],
    drawTile: 0,
    huCounts: [1, 0, 0],
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 0, "anGang", 0), false);
});
// 场景：牌墙不足以同时提供萝卜和补牌时禁止杠
// Scenario: a kong is disallowed if wall cannot supply both radish and replacement
test("a kong is disallowed if wall cannot supply both radish and replacement", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 0, 0, 0, 1, 2, 9, 10, 11, 12, 13, 14, 17, 17];
  const game = fixture({
    hands: [hand, waiting, waiting],
    wallCount: 1,
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 0, "anGang", 0), false);
});
// 场景：首次胡牌时萝卜不足六张则取全部剩余牌，并一致地结束牌局
// Scenario: first hu takes all remaining radishes if fewer than six and ends consistently
test("first hu takes all remaining radishes if fewer than six and ends consistently", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    wallCount: 3,
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.phase, "finished");
  assert.equal(game.wall.length, 0);
  assert.equal(game.players[0].radishes.length, 3);
  assert.equal(game.players[0].huCount, 1);
  assert.equal(game.players[0].hand.length, 13);
  assert.deepEqual(getLegalActions(game, 0), []);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：牌墙最后一张仍可行动，最后弃牌的响应先完成再结束
// Scenario: last wall tile remains playable and last discard claims resolve before finish
test("last wall tile remains playable and last discard claims resolve before finish", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    hands: [waiting, waiting, waiting],
    turnStep: "draw",
    head: [17],
    wallCount: 1,
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "draw");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.phase, "turn");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "discard", 17);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.phase, "claim");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 1, "hu");
  game = doAction(game, 2, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.phase, "finished");
  assert.deepEqual(
    game.players.map((p) => p.huCount),
    [0, 1, 1],
  );
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：序列化状态支持重连，并保持后续动作完全一致
// Scenario: serialized state supports reconnect and identical subsequent actions
test("serialized state supports reconnect and identical subsequent actions", () => {
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
// 场景：100 局完整固定种子对局在每步动作后均保持所有牌守恒与积分零和
// Scenario: 100 complete seeded games conserve all tiles and zero-sum scores after every action
test("100 complete seeded games conserve all tiles and zero-sum scores after every action", () => {
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  for (let seed = 0; seed < 100; seed++) {
    const random = deterministicRandom(seed);
    let game = createGame({
      seed,
    });
    let actions = 0;
    // 持续推进场景直到 game.phase!=='finished' 不再成立；循环内的动作/断言负责保证进展。
    // Advance while game.phase!=='finished' holds; actions/assertions inside are responsible for progress.
    while (game.phase !== "finished") {
      assert.ok(++actions < 1200, `Seed ${seed} failed to finish`);
      const seat =
        game.phase === "claim"
          ? game.claim.eligibleSeats.find(
              (value) => !game.claim.responses[value],
            )
          : game.currentSeat;
      const legal = getLegalActions(game, seat);
      assert.ok(legal.length, `No legal actions, seed ${seed}`);
      const action =
        legal.find((item) => item.type === "hu") ||
        legal.find((item) => item.type.endsWith("Gang")) ||
        legal[Math.floor(random() * legal.length)];
      game = applyAction(game, seat, action);
      // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
      // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
      assertGameInvariants(game);
    }
    assert.equal(game.wall.length, 0);
  }
});
// 场景：胡后续摸被锁定后，完整自然座位轮转会解除相同听口的锁
// Scenario: full natural seat cycle unlocks the same wait after a hu continuation is blocked
test("full natural seat cycle unlocks the same wait after a hu continuation is blocked", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    head: [17, 6, 7, 17],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  game = doAction(game, 0, "draw");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 0, "hu"), false);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = passAll(doAction(game, 0, "discard", 17));
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.currentSeat, 1);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 1, "draw");
  game = passAll(doAction(game, 1, "discard", 6));
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.currentSeat, 2);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 2, "draw");
  game = passAll(doAction(game, 2, "discard", 7));
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.currentSeat, 0);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "draw");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 0, "hu"), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[0].huCount, 2);
  assert.equal(game.players[0].radishes.length, 6);
  assert.equal(game.retiredTiles.length, 2);
});
// 场景：胡牌次数没有写死的上限，新牌局重置积分
// Scenario: hu has no hardcoded win-count cap and a new game resets scores
test("hu has no hardcoded win-count cap and a new game resets scores", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    huCounts: [99, 0, 0],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[0].huCount, 100);
  assert.equal(game.phase, "turn");
  assert.deepEqual(
    createGame({
      seed: 1,
    }).players.map((p) => p.score),
    [0, 0, 0],
  );
});
// 场景：龙的归属与累加计分假设均可配置
// Scenario: dragon ownership and additive scoring assumptions are configurable
test("dragon ownership and additive scoring assumptions are configurable", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17];
  const meld = {
    type: "peng",
    tile: 0,
    tiles: [0, 0, 0],
    fromSeat: 1,
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  // 在相同牌面上代入不同规则，提取计分结果以比较可配置的重叠方式。
  // Evaluate the same tiles under different rules to compare configurable scoring overlap.
  function score(rules) {
    let game = fixture({
      hands: [hand, waiting, waiting],
      melds: [[meld], [], []],
      huCounts: [1, 0, 0],
      radishes: [[0, 0, 0], [], []],
      rules,
    });
    game = doAction(game, 0, "hu");
    return game.history.at(-1).score;
  }
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.deepEqual(score({}), {
    base: 1,
    radishBonus: 9,
    dragonBonus: 10,
    total: 20,
  });
  assert.deepEqual(
    score({
      dragonCountsMelds: false,
    }),
    {
      base: 1,
      radishBonus: 9,
      dragonBonus: 0,
      total: 10,
    },
  );
  assert.deepEqual(
    score({
      stackDragonBonus: false,
    }),
    {
      base: 1,
      radishBonus: 9,
      dragonBonus: 10,
      total: 10,
    },
  );
  assert.deepEqual(
    score({
      radishCountsMelds: false,
    }),
    {
      base: 1,
      radishBonus: 0,
      dragonBonus: 10,
      total: 11,
    },
  );
});
