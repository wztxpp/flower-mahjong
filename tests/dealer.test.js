// 首位已提交胡牌者与下一局庄家的映射，不把房主当庄家。
// Map the first committed winner to the next dealer; the host is not necessarily the dealer.
// 阅读说明见 docs/TESTING-READING-GUIDE.md；固定种子与凭证仅为测试，不应移入真实用户数据。
// See docs/TESTING-READING-GUIDE.md; seeded data and test credentials must stay separate from real user data.
import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  dealerForNextGame,
  getLegalActions,
  getPlayerView,
  applyAction,
  assertGameInvariants,
} from "../shared/game.js";
// 逐项覆盖 [0,1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
// Exercise each entry in [0,1,2] with the same checks, preserving the listed order.
// Scenario: dealer seat ${dealerSeat} owns the opening tile and first action
for (const dealerSeat of [0, 1, 2]) // 场景：庄家座位 ${dealerSeat} 持有起手额外牌并拥有首次行动权
  test(`dealer seat ${dealerSeat} owns the opening tile and first action`, () => {
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    const game = createGame({
      seed: "dealer",
      dealerSeat,
    });
    // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
    // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
    assert.equal(game.dealerSeat, dealerSeat);
    assert.equal(game.currentSeat, dealerSeat);
    assert.equal(game.lastDraw.seat, dealerSeat);
    assert.deepEqual(
      game.players.map((p) => p.hand.length),
      [0, 1, 2].map((s) => (s === dealerSeat ? 14 : 13)),
    );
    // 逐项覆盖 [0,1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in [0,1,2] with the same checks, preserving the listed order.
    for (const seat of [0, 1, 2]) {
      assert.equal(getPlayerView(game, seat).dealerSeat, dealerSeat);
      assert.equal(getLegalActions(game, seat).length > 0, seat === dealerSeat);
    }
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    const action = getLegalActions(game, dealerSeat).find(
      (a) => a.type === "discard",
    );
    // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
    // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
    assertGameInvariants(applyAction(game, dealerSeat, action));
    assert.match(
      game.history[0].message,
      new RegExp(`${dealerSeat + 1}号位坐庄`),
    );
  });
// 场景：下一局庄家取首个已提交胡牌者，不取最后胡牌者或最快响应者
// Scenario: next dealer uses first committed hu, not latest win or response time
test("next dealer uses first committed hu, not latest win or response time", () => {
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  // 逐项覆盖 [0,1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [0,1,2] with the same checks, preserving the listed order.
  for (const seat of [0, 1, 2]) {
    const previous = {
      dealerSeat: (seat + 1) % 3,
      history: [
        {
          type: "draw",
          seat: 2,
        },
        {
          type: "hu",
          seat,
          revision: 5,
        },
        {
          type: "hu",
          seat: (seat + 2) % 3,
          revision: 5,
        },
        {
          type: "hu",
          seat: (seat + 1) % 3,
          revision: 9,
        },
      ],
    };
    const copy = structuredClone(previous);
    assert.equal(dealerForNextGame(previous), seat);
    assert.deepEqual(previous, copy);
  }
});
// 场景：无人胡牌的流局保留原零号座位行为，旧版胡牌历史仍可使用
// Scenario: no-hu draw retains original seat-zero behavior and old hu history still works
test("no-hu draw retains original seat-zero behavior and old hu history still works", () => {
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  // 逐项覆盖 [0,1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [0,1,2] with the same checks, preserving the listed order.
  for (const dealerSeat of [0, 1, 2])
    assert.equal(
      dealerForNextGame({
        dealerSeat,
        history: [
          {
            type: "finish",
            reason: "wallExhausted",
          },
        ],
      }),
      0,
    );
  // 逐项覆盖 [null,undefined,{},{dealerSeat:3},{dealerSeat:'1'},{history:{}}]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [null,undefined,{},{dealerSeat:3},{dealerSeat:'1'},{history:{}}] with the same checks, preserving the listed order.
  for (const value of [
    null,
    undefined,
    {},
    {
      dealerSeat: 3,
    },
    {
      dealerSeat: "1",
    },
    {
      history: {},
    },
  ])
    assert.equal(dealerForNextGame(value), 0);
  // 逐项覆盖 [undefined,1,2,3]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [undefined,1,2,3] with the same checks, preserving the listed order.
  for (const schemaVersion of [undefined, 1, 2, 3])
    assert.equal(
      dealerForNextGame({
        schemaVersion,
        history: [
          {
            type: "hu",
            seat: 2,
          },
        ],
      }),
      2,
    );
});
// 场景：非法的新庄家状态被拒绝，且不修改旧版牌局
// Scenario: invalid new dealer state is rejected without mutating legacy games
test("invalid new dealer state is rejected without mutating legacy games", () => {
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  // 逐项覆盖 [-1,3,null,'1',1.5]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [-1,3,null,'1',1.5] with the same checks, preserving the listed order.
  for (const dealerSeat of [-1, 3, null, "1", 1.5])
    assert.throws(
      () =>
        createGame({
          dealerSeat,
        }),
      /庄家/,
    );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const old = createGame({
    seed: "old",
  });
  delete old.dealerSeat;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assertGameInvariants(old);
  assert.equal(getPlayerView(old, 2).dealerSeat, 0);
  assert.equal(Object.hasOwn(old, "dealerSeat"), false);
});
