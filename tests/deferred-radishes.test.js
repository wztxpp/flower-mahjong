// 首次胡牌前延迟翻杠萝卜的累计、短墙与旧存档兼容。
// Deferred pre-first-win kong radishes, short walls and saved-state compatibility.
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
const own = [0, 1, 2, 3, 9, 10, 11, 12, 13, 14, 17];
const wait = [1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17, 17];
const move = (g, s, type, tile) =>
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
// 让尚未回应的合法座位依次过牌，直到反应窗关闭；每一步使用返回的新状态。
// Pass each remaining eligible responder until the claim window closes, carrying forward each returned state.
const passAll = (g) => {
  // 持续推进场景直到 g.phase==='claim' 不再成立；循环内的动作/断言负责保证进展。
  // Advance while g.phase==='claim' holds; actions/assertions inside are responsible for progress.
  while (g.phase === "claim")
    g = move(
      g,
      g.claim.eligibleSeats.find((s) => !g.claim.responses[s]),
      "pass",
    );
  return g;
};
// 按本文件的参数构造场景；规则版本、手牌与牌墙由各测试显式选择。不要把 UI 快照误当成完整引擎状态。
// Build the local scenario from its parameters; each test chooses rules, hands and wall. A UI snapshot is not a complete engine state.
function fixture({
  head = [0, 0, 0, 0, 17, 6],
  first = false,
  oldRadishes = [],
  pending = 0,
  wallLimit = null,
} = {}) {
  const g = createGame({
    seed: "deferred-radishes",
    rules: {
      allowPungUpgrade: true,
    },
  });
  g.players.forEach((p, s) => {
    p.hand = [...(s === 0 ? own : wait)];
    p.melds =
      s === 0
        ? [
            {
              type: "peng",
              tile: 0,
              tiles: [0, 0, 0],
            },
          ]
        : [];
  });
  g.players[0].radishes = [...oldRadishes];
  g.players[0].kongCount = oldRadishes.length + pending;
  g.pendingKongRadishes = pending;
  g.firstHuRadishesRevealed = first;
  g.lastDraw = {
    seat: 0,
    tile: 0,
    source: "normal",
  };
  g.history = [];
  // 十八种牌，每种八张。先登记所有已分配牌，再把余量填入牌墙；不能凭空增加牌。
  // There are eighteen kinds with eight copies each. Debit allocated tiles, then place remaining copies in the wall.
  const counts = Array(18).fill(8);
  // 逐项覆盖 [...head,...g.players.flatMap(p=>[...p.hand,...p.melds.flatMap(m=>m.tiles),...p.radishes])]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [...head,...g.players.flatMap(p=>[...p.hand,...p.melds.flatMap(m=>m.tiles),...p.radishes])] with the same checks, preserving the listed order.
  for (const t of [
    ...head,
    ...g.players.flatMap((p) => [
      ...p.hand,
      ...p.melds.flatMap((m) => m.tiles),
      ...p.radishes,
    ]),
  ])
    assert.ok(--counts[t] >= 0);
  g.wall = [...head, ...counts.flatMap((n, t) => Array(n).fill(t))];
  // 只在明确要求短墙时截取牌墙并记录移出的牌，保留实物牌守恒。
  // Limit the wall only when explicitly requested and account for removed tiles to preserve conservation.
  if (wallLimit !== null) {
    const retired = g.wall.splice(wallLimit);
    g.retiredTiles.push(
      ...retired.map((tile) => ({
        seat: 0,
        tile,
      })),
    );
  }
  assertGameInvariants(g);
  return g;
}
// 场景：五次成功杠将五张牌尾萝卜延后到首胡，再一次翻开十一张
// Scenario: five successful kongs defer five tail tiles until first hu then reveal eleven exactly once
test("five successful kongs defer five tail tiles until first hu then reveal eleven exactly once", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let g = fixture();
  const original = g.wall.slice();
  const tail = original.slice(-11).reverse();
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  for (let n = 1; n <= 5; n++) {
    g = passAll(move(g, 0, n === 1 ? "buGang" : "addGang", 0));
    assert.equal(g.pendingKongRadishes, n);
    assert.equal(g.wall.length, original.length - n);
    assert.deepEqual(g.wall.slice(-11), original.slice(-11));
    assert.deepEqual(
      g.players.flatMap((p) => p.radishes),
      [],
    );
    assert.equal(g.history.filter((e) => e.radishDeferred).length, n);
    assert.ok(
      g.history
        .filter((e) => e.type.endsWith("Gang"))
        .every((e) => e.radish === undefined),
    );
    for (let seat = 0; seat < 3; seat++) {
      const view = getPlayerView(g, seat);
      assert.equal(view.pendingKongRadishes, n);
      assert.deepEqual(view.sharedRadishes, []);
    }
    g = JSON.parse(JSON.stringify(g));
    assertGameInvariants(g);
  }
  assert.equal(g.lastDraw.tile, 17);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  g = move(g, 0, "hu");
  const event = g.history.find((e) => e.type === "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(event.newRadishes, tail);
  assert.equal(g.pendingKongRadishes, 0);
  assert.equal(g.firstHuRadishesRevealed, true);
  assert.deepEqual(
    g.players.flatMap((p) => p.radishes),
    tail,
  );
  assertGameInvariants(g);
});
// 场景：首个加杠被抢时不计杠萝卜，同时首次胡牌只翻六张一次
// Scenario: robbed first upgrade counts no kong radish; simultaneous first hu flips six only once
test("robbed first upgrade counts no kong radish; simultaneous first hu flips six only once", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let g = fixture({
    head: [6],
  });
  const wall = g.wall.slice();
  g = move(g, 0, "buGang", 0);
  g = move(g, 2, "hu");
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.equal(g.pendingKongRadishes, 0);
  assert.deepEqual(g.wall, wall);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  g = move(g, 1, "hu");
  const events = g.history.filter((e) => e.type === "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((e) => e.newRadishes.length),
    [6, 0],
  );
  assert.equal(g.pendingKongRadishes, 0);
  assert.equal(g.players[0].kongCount, 0);
  assert.deepEqual(g.players[0].melds[0].tiles, [0, 0, 0]);
  assertGameInvariants(g);
});
// 场景：首胡后的杠仍立即翻一张萝卜，并保持从牌墙头补牌的顺序
// Scenario: post-first-hu kong still flips one immediately and preserves wall head replacement order
test("post-first-hu kong still flips one immediately and preserves wall head replacement order", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let g = fixture({
    head: [6],
    first: true,
  });
  const tail = g.wall.at(-1),
    length = g.wall.length;
  g = passAll(move(g, 0, "buGang", 0));
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(g.players[0].radishes, [tail]);
  assert.equal(g.lastDraw.tile, 6);
  assert.equal(g.wall.length, length - 2);
  assert.equal(g.pendingKongRadishes, 0);
});
// 场景：旧 schema-3 状态中已经公开的杠萝卜保持公开，绝不重复翻开
// Scenario: legacy schema-3 already exposed kong radishes remain exposed and are never flipped again
test("legacy schema-3 already exposed kong radishes remain exposed and are never flipped again", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let g = fixture({
    head: [17, 6],
    oldRadishes: [8, 8],
  });
  delete g.pendingKongRadishes;
  const old = [...g.players[0].radishes];
  g = passAll(move(g, 0, "buGang", 0));
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(g.players[0].radishes, old);
  assert.equal(g.pendingKongRadishes, 1);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  g = move(g, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(g.history.find((e) => e.type === "hu").newRadishes.length, 7);
  assert.deepEqual(g.players[0].radishes.slice(0, 2), old);
  assert.equal(g.players.flatMap((p) => p.radishes).length, 9);
  assertGameInvariants(g);
});
// 场景：短牌墙首次胡牌只翻剩余可用牌，并清空累计待翻数量
// Scenario: short wall first win reveals only available tiles and clears accrued count
test("short wall first win reveals only available tiles and clears accrued count", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let g = fixture({
    head: [17, 6],
    pending: 5,
    wallLimit: 4,
  });
  g = passAll(move(g, 0, "buGang", 0));
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.equal(g.pendingKongRadishes, 6);
  assert.equal(g.wall.length, 3);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  g = move(g, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(g.history.find((e) => e.type === "hu").newRadishes.length, 3);
  assert.equal(g.pendingKongRadishes, 0);
  assert.equal(g.phase, "finished");
  assertGameInvariants(g);
});
// 场景：待翻萝卜数量拒绝负数、非整数、不可能值及已翻开后的残留值
// Scenario: pending radish count rejects negative, noninteger, impossible and post-reveal values
test("pending radish count rejects negative, noninteger, impossible and post-reveal values", () => {
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  // 逐项覆盖 [-1,0.5,99]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [-1,0.5,99] with the same checks, preserving the listed order.
  for (const pending of [-1, 0.5, 99]) {
    const g = fixture();
    g.pendingKongRadishes = pending;
    assert.throws(() => assertGameInvariants(g), /待翻萝卜/);
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const g = fixture({
    pending: 1,
  });
  g.firstHuRadishesRevealed = true;
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  assert.throws(() => assertGameInvariants(g), /待翻萝卜/);
});
// 场景：无人胡牌而牌墙耗尽时不翻开累计待翻萝卜
// Scenario: wall exhaustion without any hu never reveals accrued radishes
test("wall exhaustion without any hu never reveals accrued radishes", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let g = fixture({
    head: [6, 7],
    wallLimit: 2,
  });
  g = passAll(move(g, 0, "buGang", 0));
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.equal(g.pendingKongRadishes, 1);
  // 持续推进场景直到 g.phase!=='finished' 不再成立；循环内的动作/断言负责保证进展。
  // Advance while g.phase!=='finished' holds; actions/assertions inside are responsible for progress.
  while (g.phase !== "finished") {
    // 反应阶段先完成回应，再继续后续回合，避免跳过抢牌优先级。
    // Complete claim responses before advancing turns so priority is not skipped.
    if (g.phase === "claim") g = passAll(g);
    else {
      const a = getLegalActions(g, g.currentSeat).find(
        (a) => a.type === "discard",
      );
      assert.ok(a);
      g = applyAction(g, g.currentSeat, a);
    }
  }
  assert.equal(g.firstHuRadishesRevealed, false);
  assert.equal(g.pendingKongRadishes, 1);
  assert.deepEqual(
    g.players.flatMap((p) => p.radishes),
    [],
  );
  assert.equal(g.history.filter((e) => e.type === "hu").length, 0);
  assertGameInvariants(g);
});
