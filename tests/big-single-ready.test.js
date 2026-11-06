// 稳定大单钓听牌时的一次性付款，区分碰后待打牌与已经听牌。
// One-time stable big-single-ready payments, distinguishing pending post-peng discards from readiness.
// 阅读说明见 docs/TESTING-READING-GUIDE.md；固定种子与凭证仅为测试，不应移入真实用户数据。
// See docs/TESTING-READING-GUIDE.md; seeded data and test credentials must stay separate from real user data.
import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  applyAction,
  getPlayerView,
  getLegalActions,
  assertGameInvariants,
} from "../shared/game.js";
const waiting = [1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 14, 15, 17];
// 按指定牌型、牌面与张数组装副露，不自动从任何手牌扣牌。
// Build a meld with the requested kind/tile/count; this alone does not debit a hand.
const meld = (tile, type = "peng", count = type === "peng" ? 3 : 4) => ({
  type,
  tile,
  tiles: Array(count).fill(tile),
});
// 按本文件的参数构造场景；规则版本、手牌与牌墙由各测试显式选择。不要把 UI 快照误当成完整引擎状态。
// Build the local scenario from its parameters; each test chooses rules, hands and wall. A UI snapshot is not a complete engine state.
function fixture({
  seat = 0,
  hand = [16, 17],
  melds = [meld(0), meld(3), meld(6), meld(9)],
  head = [8, 8],
  rules = {},
  waitingTurn = false,
} = {}) {
  const game = createGame({
    seed: "ready-fee",
    rules: {
      allowPungUpgrade: true,
      ...rules,
    },
  });
  game.players.forEach((player, i) => {
    player.hand = [...(i === seat ? hand : waiting)];
    player.melds = i === seat ? structuredClone(melds) : [];
    player.kongCount = player.melds.filter((m) => m.type !== "peng").length;
  });
  game.currentSeat = seat;
  game.lastDraw = {
    seat,
    tile: hand.at(-1),
    source: "normal",
  };
  // 把局面设置为尚待摸牌并清除 lastDraw，避免凭上一张摸牌提前发放听牌奖励。
  // Set a waiting-to-draw state and clear lastDraw so stale draw data cannot trigger ready payment.
  if (waitingTurn) {
    game.turnStep = "draw";
    game.lastDraw = null;
  }
  game.history = [];
  game.discards = [];
  // 已胡的实物牌仍占一张物理配额；winPile 是展示/计分引用，不能当成新增的牌。
  // Physical winning tiles still occupy one copy; winPile is a display/scoring reference, not newly created tiles.
  game.retiredTiles = [];
  // 十八种牌，每种八张。先登记所有已分配牌，再把余量填入牌墙；不能凭空增加牌。
  // There are eighteen kinds with eight copies each. Debit allocated tiles, then place remaining copies in the wall.
  const counts = Array(18).fill(8);
  // 逐项覆盖 game.players；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in game.players with the same checks, preserving the listed order.
  // Exercise each entry in [...player.hand,...player.melds.flatMap(m=>m.tiles)] with the same checks, preserving the listed order.
  // 逐项覆盖 [...player.hand,...player.melds.flatMap(m=>m.tiles)]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  for (const player of game.players)
    for (const tile of [
      ...player.hand,
      ...player.melds.flatMap((m) => m.tiles),
    ])
      assert.ok(--counts[tile] >= 0);
  // 逐项覆盖 head；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in head with the same checks, preserving the listed order.
  for (const tile of head) assert.ok(--counts[tile] >= 0);
  game.wall = [...head, ...counts.flatMap((n, tile) => Array(n).fill(tile))];
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
  return game;
}
const act = (g, s, type, tile) =>
  applyAction(
    g,
    s,
    tile === undefined
      ? {
          type,
        }
      : {
          type,
          tile,
        },
  );
const fees = (g) => g.history.filter((e) => e.type === "bigSingleReady");
// 让尚未回应的合法座位依次过牌，直到反应窗关闭；每一步使用返回的新状态。
// Pass each remaining eligible responder until the claim window closes, carrying forward each returned state.
function passAll(g) {
  // 持续推进场景直到 g.phase==='claim' 不再成立；循环内的动作/断言负责保证进展。
  // Advance while g.phase==='claim' holds; actions/assertions inside are responsible for progress.
  while (g.phase === "claim")
    g = act(
      g,
      g.claim.eligibleSeats.find((s) => !g.claim.responses[s]),
      "pass",
    );
  return g;
}
// 场景：新牌局显式保存听牌付款规则，并验证配置
// Scenario: ready payment is explicit for new games and validates configuration
test("ready payment is explicit for new games and validates configuration", () => {
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(
    createGame({
      seed: 1,
    }).rules.bigSingleReadyPayment,
    true,
  );
  assert.throws(() =>
    createGame({
      rules: {
        bigSingleReadyPayment: 1,
      },
    }),
  );
});
// 逐项覆盖 [0,1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
// Exercise each entry in [0,1,2] with the same checks, preserving the listed order.

// Scenario: seat ${seat} collects two independent 50 payments only on stable ready discard
for (const seat of [0, 1, 2]) // 场景：座位 ${seat} 仅在稳定听牌的出牌时分别收取两笔 50 分付款
  test(`seat ${seat} collects two independent 50 payments only on stable ready discard`, () => {
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    const original = fixture({
      seat,
    });
    const untouched = structuredClone(original);
    getPlayerView(original, seat);
    // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
    // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
    assert.deepEqual(original, untouched);
    assert.equal(fees(original).length, 0);
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    const game = act(original, seat, "discard", 17);
    // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
    // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
    assert.equal(fees(game).length, 1);
    assert.equal(game.players[seat].bigSingleReadyPaid, true);
    assert.deepEqual(
      game.players.map((p) => p.score),
      [0, 1, 2].map((s) => (s === seat ? 100 : -50)),
    );
    assert.deepEqual(fees(game)[0].payments, [
      ...[0, 1, 2]
        .filter((s) => s !== seat)
        .map((s) => ({
          seat: s,
          delta: -50,
        })),
      {
        seat,
        delta: 100,
      },
    ]);
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    const restored = JSON.parse(JSON.stringify(game));
    getPlayerView(restored, seat);
    getLegalActions(restored, seat);
    // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
    // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
    assert.deepEqual(restored, game);
    assert.deepEqual(original, untouched);
    assert.throws(() => act(game, seat, "discard", 17));
    // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
    // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
    assertGameInvariants(game);
  });
// 场景：第四次碰牌后，完成必须的出牌前不收取听牌付款
// Scenario: fourth peng does not charge until the required discard
test("fourth peng does not charge until the required discard", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    seat: 1,
    waitingTurn: true,
    hand: [9, 9, 16, 17],
    melds: [meld(0), meld(3), meld(6)],
  });
  // Move one wall nine into the other player as their just-drawn discard.
  game.wall.splice(game.wall.indexOf(9), 1);
  game.players[0].hand.push(9);
  game.currentSeat = 0;
  game.turnStep = "discard";
  game.lastDraw = {
    seat: 0,
    tile: 9,
    source: "normal",
  };
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  game = act(game, 0, "discard", 9);
  game = act(game, 1, "peng", 9);
  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  game = passAll(game);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[1].melds.length, 4);
  assert.equal(game.players[1].hand.length, 2);
  assert.equal(fees(game).length, 0);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  game = act(game, 1, "discard", 17);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(fees(game).length, 1);
  assert.equal(fees(game)[0].seat, 1);
});
// 场景：第四次暗杠在补牌前收取听牌费，并保留杠来源信息
// Scenario: fourth concealed kong pays ready fee before replacement and preserves kong provenance
test("fourth concealed kong pays ready fee before replacement and preserves kong provenance", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    hand: [9, 9, 9, 9, 16],
    melds: [meld(0), meld(3), meld(6)],
    head: [16],
  });
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  game = act(game, 0, "anGang", 9);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(fees(game).length, 1);
  assert.equal(game.lastDraw.source, "replacement");
  assert.deepEqual(game.lastDraw.kongSource, {
    type: "anGang",
    fromSeat: null,
  });
  assert.deepEqual(
    game.history.map((e) => e.type),
    ["bigSingleReady", "anGang", "draw"],
  );
  assert.deepEqual(
    game.players.map((p) => p.score),
    [104, -52, -52],
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const after = act(game, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(fees(after).length, 1);
  assert.ok(after.history.find((e) => e.type === "hu").points < 50);
  assertGameInvariants(after);
});
// 场景：第四次明杠保留供杠付款方，听牌付款单独结算
// Scenario: fourth exposed kong preserves source payer and ready payment is separate
test("fourth exposed kong preserves source payer and ready payment is separate", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    seat: 1,
    waitingTurn: true,
    hand: [9, 9, 9, 16],
    melds: [meld(0), meld(3), meld(6)],
    head: [16],
  });
  game.wall.splice(game.wall.indexOf(9), 1);
  game.players[0].hand.push(9);
  game.currentSeat = 0;
  game.turnStep = "discard";
  game.lastDraw = {
    seat: 0,
    tile: 9,
    source: "normal",
  };
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  game = act(game, 0, "discard", 9);
  game = act(game, 1, "mingGang", 9);
  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  game = passAll(game);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(fees(game).length, 1);
  assert.deepEqual(game.lastDraw.kongSource, {
    type: "mingGang",
    fromSeat: 0,
  });
  assert.deepEqual(
    game.players.map((p) => p.score),
    [-52, 102, -50],
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  game = act(game, 1, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(fees(game).length, 1);
  assert.deepEqual(
    game.history.find((e) => e.type === "hu").payments.map((p) => p.seat),
    [0, 1],
  );
});
// 场景：序列化后的已付款标记可防止后续稳定听牌出牌再次收费
// Scenario: serialized paid marker prevents charge on a later stable-ready discard
test("serialized paid marker prevents charge on a later stable-ready discard", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture();
  game.players[0].bigSingleReadyPaid = true;
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  game = act(JSON.parse(JSON.stringify(game)), 0, "discard", 17);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(fees(game).length, 0);
  assert.deepEqual(
    game.players.map((p) => p.score),
    [0, 0, 0],
  );
});
// 场景：旧局缺失开关或显式关闭规则时，绝不补收听牌付款
// Scenario: legacy missing flag or explicitly disabled rule never backfills a ready payment
test("legacy missing flag or explicitly disabled rule never backfills a ready payment", () => {
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 [true,false]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [true,false] with the same checks, preserving the listed order.
  for (const missing of [true, false]) {
    let game = fixture({
      rules: {
        bigSingleReadyPayment: false,
      },
    });
    // 删除被测配置字段以模拟旧存档缺字段，而非显式关闭或开启。
    // Remove the tested configuration field to model an older save, not explicit true/false.
    if (missing) {
      delete game.rules.bigSingleReadyPayment;
      delete game.players[0].bigSingleReadyPaid;
    }
    game = act(game, 0, "discard", 17);
    assert.equal(fees(game).length, 0);
    assert.deepEqual(
      game.players.map((p) => p.score),
      [0, 0, 0],
    );
  }
});
// 场景：四组副露若只能听已耗尽的第九张同牌，不构成有效听牌
// Scenario: four groups with an exhausted ninth-copy wait do not qualify as ready
test("four groups with an exhausted ninth-copy wait do not qualify as ready", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    hand: [0, 17],
    melds: [meld(0, "anGang", 7), meld(3), meld(6), meld(9)],
  });
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  game = act(game, 0, "discard", 17);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(fees(game).length, 0);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：待响应或被抢的加杠绝不产生推测性的听牌付款
// Scenario: a pending or robbed upgrade never creates a speculative ready payment
test("a pending or robbed upgrade never creates a speculative ready payment", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    hand: [9, 16],
  });
  game.players[1].hand.splice(game.players[1].hand.indexOf(17), 1, 9);
  game.wall.splice(game.wall.indexOf(9), 1, 17);
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  game = act(game, 0, "buGang", 9);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.claim.kind, "robKong");
  assert.equal(fees(game).length, 0);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const before = JSON.stringify(game);
  getPlayerView(game, 0);
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  assert.equal(JSON.stringify(game), before);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  game = act(game, 1, "hu");
  // 只有真实反应窗还开着才处理过牌；关闭后应返回正常回合流程。
  // Process responses only while the claim window remains open.
  if (game.phase === "claim") game = passAll(game);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(fees(game).length, 0);
  assert.equal(game.players[0].melds[3].tiles.length, 3);
});
// 场景：显式旧版计分不会将原有胡牌 50 分与新听牌付款叠加
// Scenario: explicit legacy scoring does not combine the old 50 hu with a new ready payment
test("explicit legacy scoring does not combine the old 50 hu with a new ready payment", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    rules: {
      specialHuPatterns: false,
    },
  });
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  game = act(game, 0, "discard", 17);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(fees(game).length, 0);
});
// Scenario: ready bonus ${points} is per opponent, once, and independent of later hu
for (const points of [0, 1, 75, 100000]) // 场景：喜钱 ${points} 分由每个对手各付一次，且独立于之后胡牌结算
  test(`ready bonus ${points} is per opponent, once, and independent of later hu`, () => {
    // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
    // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
    let game = fixture({
      rules: {
        bigSingleReadyPoints: points,
      },
      hand: [9, 9, 9, 9, 16],
      melds: [meld(0), meld(3), meld(6)],
      head: [16],
    });
    // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
    // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
    game = act(game, 0, "anGang", 9);
    // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
    // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.

    assert.equal(fees(game).length, 1);
    assert.equal(fees(game)[0].points, points);
    assert.equal(game.players[0].bigSingleReadyPaid, true);
    assert.deepEqual(
      game.players.map((p) => p.score),
      [points * 2 + 4, -points - 2, -points - 2],
    );
    assert.equal(
      fees(game)[0].payments.reduce((sum, p) => sum + p.delta, 0),
      0,
    );
    assert.match(fees(game)[0].message, new RegExp(`${points}分`));
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    const restored = JSON.parse(JSON.stringify(game));
    for (const seat of [0, 1, 2])
      assert.equal(
        getPlayerView(restored, seat).rules.bigSingleReadyPoints,
        points,
      );
    // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
    // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
    game = act(restored, 0, "hu");
    // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
    // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
    assert.equal(fees(game).length, 1);
    // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
    // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
    assertGameInvariants(game);
  });
// 场景：引擎拒绝格式错误、负数、小数及超上限喜钱配置
// Scenario: ready bonus rejects malformed, negative, fractional and excessive engine configuration
test("ready bonus rejects malformed, negative, fractional and excessive engine configuration", () => {
  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  for (const points of [
    -1,
    0.5,
    100001,
    Number.MAX_SAFE_INTEGER,
    Infinity,
    NaN,
    "50",
    "",
    null,
    true,
    {},
    [],
    undefined,
  ]) {
    assert.throws(
      () =>
        createGame({
          rules: {
            bigSingleReadyPoints: points,
          },
        }),
      /喜钱分值无效/,
    );
  }
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.equal(createGame().rules.bigSingleReadyPoints, 50);
});
// 场景：旧存档缺少喜钱金额时仍付 50 分，不改旧规则对象或已有历史
// Scenario: old saved ready rule missing amount still pays 50 without changing its rules or existing history
test("old saved ready rule missing amount still pays 50 without changing its rules or existing history", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture();
  delete game.rules.bigSingleReadyPoints;
  game.history = [
    {
      type: "old",
      points: 50,
      message: "旧记录不改",
    },
  ];
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  game = act(JSON.parse(JSON.stringify(game)), 0, "discard", 17);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.equal(fees(game)[0].points, 50);
  assert.deepEqual(
    game.players.map((p) => p.score),
    [100, -50, -50],
  );
  assert.equal(Object.hasOwn(game.rules, "bigSingleReadyPoints"), false);
  assert.deepEqual(game.history[0], {
    type: "old",
    points: 50,
    message: "旧记录不改",
  });
});
