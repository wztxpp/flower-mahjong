// 抢杠反应窗、原子结算、付款方和不得提前提交的杠副作用。
// Rob-kong reaction windows, atomic settlement, payer selection and uncommitted kong effects.
// 阅读说明见 docs/TESTING-READING-GUIDE.md；固定种子与凭证仅为测试，不应移入真实用户数据。
// See docs/TESTING-READING-GUIDE.md; seeded data and test credentials must stay separate from real user data.
import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  applyAction,
  getLegalActions,
  getPlayerView,
  assertGameInvariants,
} from "../shared/game.js";
const sourceHand = [0, 1, 2, 3, 9, 10, 11, 12, 13, 14, 17];
const waitZero = [1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17, 17];
const move = (game, seat, type, tile) =>
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
const huEvents = (game) => game.history.filter((event) => event.type === "hu");
const gangEvents = (game) =>
  game.history.filter((event) =>
    ["buGang", "addGang", "anGang", "mingGang"].includes(event.type),
  );
// 按本文件的参数构造场景；规则版本、手牌与牌墙由各测试显式选择。不要把 UI 快照误当成完整引擎状态。
// Build the local scenario from its parameters; each test chooses rules, hands and wall. A UI snapshot is not a complete engine state.
function fixture({
  count = 3,
  meldType = count === 3 ? "peng" : "buGang",
  seat = 0,
  sourceWon = false,
  receiverWon = false,
  replacement = false,
  head = [6],
  receivers = [waitZero, waitZero],
  rules = {},
  firstHuRadishesRevealed = true,
  receiverMelds = [[], []],
  ownHand = sourceHand,
  drawTile = 0,
} = {}) {
  const game = createGame({
    seed: "rob-kong",
    rules: {
      allowPungUpgrade: true,
      turnDirection: "clockwise",
      ...rules,
    },
  });
  const others = [1, 2].map((offset) => (seat + offset) % 3);
  game.players.forEach((p, index) => {
    p.hand = [
      ...(index === seat ? ownHand : receivers[others.indexOf(index)]),
    ].sort((a, b) => a - b);
    p.melds =
      index === seat
        ? [
            {
              type: meldType,
              tile: 0,
              tiles: Array(count).fill(0),
            },
          ]
        : structuredClone(receiverMelds[others.indexOf(index)]);
    p.huCount = (index === seat ? sourceWon : receiverWon) ? 1 : 0;
    p.winPile = p.huCount
      ? [
          {
            tile: 6,
            source: "selfDraw",
            virtual: false,
          },
        ]
      : [];
    p.huLockActive = p.huCount > 0;
    p.lockedWaits = p.huCount ? [0] : [];
  });
  // 已胡的实物牌仍占一张物理配额；winPile 是展示/计分引用，不能当成新增的牌。
  // Physical winning tiles still occupy one copy; winPile is a display/scoring reference, not newly created tiles.
  game.retiredTiles = game.players.flatMap((p) =>
    p.winPile.map((win) => ({
      seat: p.seat,
      tile: win.tile,
    })),
  );
  game.currentSeat = seat;
  game.phase = "turn";
  game.turnStep = "discard";
  game.history = [];
  game.lastDraw = {
    seat,
    tile: drawTile,
    source: replacement ? "replacement" : "normal",
    ...(replacement
      ? {
          kongSource: {
            type: "buGang",
            fromSeat: null,
          },
        }
      : {}),
  };
  game.firstHuRadishesRevealed = firstHuRadishesRevealed;
  // 十八种牌，每种八张。先登记所有已分配牌，再把余量填入牌墙；不能凭空增加牌。
  // There are eighteen kinds with eight copies each. Debit allocated tiles, then place remaining copies in the wall.
  const counts = Array(18).fill(8);
  // 逐项覆盖 [...head,...game.retiredTiles.map(x=>x.tile),...game.players.flatMap(p=>[...p.hand,...p.melds.flatMap(m=>m.tiles)])]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [...head,...game.retiredTiles.map(x=>x.tile),...game.players.flatMap(p=>[...p.hand,...p.melds.flatMap(m=>m.tiles)])] with the same checks, preserving the listed order.
  for (const tile of [
    ...head,
    ...game.retiredTiles.map((x) => x.tile),
    ...game.players.flatMap((p) => [
      ...p.hand,
      ...p.melds.flatMap((m) => m.tiles),
    ]),
  ])
    assert.ok(--counts[tile] >= 0);
  game.wall = [
    ...head,
    ...counts.flatMap((count, tile) => Array(count).fill(tile)),
  ];
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
    game = move(
      game,
      game.claim.eligibleSeats.find((seat) => !game.claim.responses[seat]),
      "pass",
    );
  return game;
}
// 逐项覆盖 [3,4,5,6,7]；同一组检查用于每个样本，顺序以代码列出的集合为准。
// Exercise each entry in [3,4,5,6,7] with the same checks, preserving the listed order.
// Exercise each entry in count===3?['peng']:['buGang','mingGang','anGang'] with the same checks, preserving the listed order.
for (const count of [3, 4, 5, 6, 7]) // 逐项覆盖 count===3?['peng']:['buGang','mingGang','anGang']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  for (const meldType of count === 3
    ? ["peng"]
    : ["buGang", "mingGang", "anGang"]) {
    // 场景：${meldType} ${count}→${count + 1} 在产生任何杠效果前，先等待胡或过牌响应
    // Scenario: ${meldType} ${count}→${count + 1} waits for hu/pass before any kong effect
    test(`${meldType} ${count}→${count + 1} waits for hu/pass before any kong effect`, () => {
      // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
      // Arrange: prepare this step’s input or reference data within the synthetic scenario.
      const initial = fixture({
        count,
        meldType,
      });
      let game = move(initial, 0, count === 3 ? "buGang" : "addGang", 0);
      // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
      // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
      assert.equal(game.claim.kind, "robKong");
      assert.equal(game.wall.length, initial.wall.length);
      assert.deepEqual(
        game.players.map((p) => p.score),
        [0, 0, 0],
      );
      assert.deepEqual(game.players[0].melds, initial.players[0].melds);
      assert.deepEqual(game.players[0].radishes, []);
      assert.equal(game.players[0].kongCount, 0);
      assert.equal(
        game.players[0].hand.length,
        initial.players[0].hand.length - 1,
      );
      assert.equal(gangEvents(game).length, 0);
      assert.equal(game.history.at(-1).type, "robKongAttempt");
      // 逐项覆盖 [1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
      // Exercise each entry in [1,2] with the same checks, preserving the listed order.
      for (const seat of [1, 2]) {
        assert.deepEqual(getLegalActions(game, seat), [
          {
            type: "hu",
          },
          {
            type: "pass",
          },
        ]);
        assert.equal(getPlayerView(game, seat).claim.kind, "robKong");
        assert.equal(getPlayerView(game, seat).huDiagnostic.code, "AVAILABLE");
        assert.throws(() => move(game, seat, "peng", 0));
        assert.throws(() => move(game, seat, "mingGang", 0));
      }
      assert.deepEqual(getLegalActions(game, 0), []);
      // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
      // Arrange: prepare this step’s input or reference data within the synthetic scenario.
      game = move(game, 2, "pass");
      // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
      // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
      assert.equal(game.phase, "claim");
      assert.equal(game.wall.length, initial.wall.length);
      assert.throws(() => move(game, 2, "pass"));
      // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
      // Arrange: prepare this step’s input or reference data within the synthetic scenario.
      game = move(JSON.parse(JSON.stringify(game)), 1, "pass");
      // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
      // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
      assert.equal(game.players[0].melds[0].tiles.length, count + 1);
      assert.equal(game.players[0].radishes.length, 1);
      assert.equal(game.players[0].kongCount, 1);
      assert.equal(game.wall.length, initial.wall.length - 2);
      assert.deepEqual(
        game.players.map((p) => p.score),
        [2, -1, -1],
      );
      assert.equal(gangEvents(game).length, 1);
      assert.equal(game.lastDraw.source, "replacement");
      assert.equal(
        game.lastDraw.kongSource.type,
        count === 3 ? "buGang" : "addGang",
      );
      // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
      // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
      assertGameInvariants(game);
    });
  }
// 逐项覆盖 [0,1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
// Exercise each entry in [0,1,2] with the same checks, preserving the listed order.
// Exercise each entry in [false,true] with the same checks, preserving the listed order.
for (const seat of [0, 1, 2]) // 逐项覆盖 [false,true]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  for (const reverse of [false, true]) {
    // 场景：抢杠双胡付款方为 ${seat}、响应顺序反转为 ${reverse}：优先级固定且原子结算
    // Scenario: rob double win payer ${seat}, response reversal ${reverse}: fixed priority and atomic settlement
    test(`rob double win payer ${seat}, response reversal ${reverse}: fixed priority and atomic settlement`, () => {
      // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
      // Arrange: prepare this step’s input or reference data within the synthetic scenario.
      const initial = fixture({
        seat,
      });
      let game = move(initial, seat, "buGang", 0);
      const winners = [1, 2].map((offset) => (seat + offset) % 3);
      const responses = reverse ? [...winners].reverse() : winners;
      game = move(game, responses[0], "hu");
      // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
      // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
      assert.equal(huEvents(game).length, 0);
      assert.deepEqual(
        game.players.map((p) => p.score),
        [0, 0, 0],
      );
      // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
      // Arrange: prepare this step’s input or reference data within the synthetic scenario.
      game = move(game, responses[1], "hu");
      // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
      // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
      assert.deepEqual(
        huEvents(game).map((event) => event.seat),
        winners,
      );
      // 逐项覆盖 huEvents(game)；同一组检查用于每个样本，顺序以代码列出的集合为准。
      // Exercise each entry in huEvents(game) with the same checks, preserving the listed order.
      for (const event of huEvents(game)) {
        assert.equal(event.source, "robKong");
        assert.equal(event.score.robKongBonus, 1);
        assert.equal(event.score.fan, 2);
        assert.equal(event.points, 2);
        assert.deepEqual(
          event.payments
            .filter((payment) => payment.delta < 0)
            .map((payment) => payment.seat),
          [seat],
        );
        assert.match(event.message, /抢杠胡/);
      }
      assert.equal(game.players[seat].score, -4);
      assert.equal(game.players[seat].melds[0].type, "peng");
      assert.equal(game.players[seat].melds[0].tiles.length, 3);
      assert.equal(game.players[seat].kongCount, 0);
      assert.deepEqual(game.players[seat].radishes, []);
      assert.equal(gangEvents(game).length, 0);
      assert.equal(game.wall.length, initial.wall.length - 1); // Winner continuation draw only.
      assert.equal(game.currentSeat, winners[0]);
      assert.equal(game.players[winners[1]].winPile.at(-1).virtual, true);
      // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
      // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
      assertGameInvariants(game);
    });
  }
// 场景：已胡玩家普通摸牌后的首次加杠受保护，其补牌后的加杠可被已胡或未胡玩家抢胡
// Scenario: already-won ordinary first upgrade is protected; its replacement upgrade can be robbed by won and unwon players
test("already-won ordinary first upgrade is protected; its replacement upgrade can be robbed by won and unwon players", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    sourceWon: true,
    head: [0, 6],
  });
  const wall = game.wall.length;
  game = move(game, 0, "buGang", 0);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.phase, "turn");
  assert.equal(game.players[0].melds[0].tiles.length, 4);
  assert.equal(game.lastDraw.source, "replacement");
  assert.equal(game.lastDraw.tile, 0);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scores = game.players.map((p) => p.score);
  game = move(game, 0, "addGang", 0);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.claim.kind, "robKong");
  assert.deepEqual(game.claim.eligibleSeats, [1, 2]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  game = move(move(game, 2, "hu"), 1, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.phase, "finished");
  assert.equal(game.finishReason, "allPlayersHu");
  assert.equal(game.players[0].melds[0].tiles.length, 4);
  assert.equal(game.players[0].kongCount, 1);
  assert.equal(game.players[0].radishes.length, 1);
  assert.equal(game.wall.length, wall - 2);
  assert.equal(gangEvents(game).length, 1);
  assert.ok(game.players[0].score < scores[0]);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const repeated = move(
    fixture({
      sourceWon: true,
      receiverWon: true,
      replacement: true,
    }),
    0,
    "buGang",
    0,
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(repeated.claim.eligibleSeats, [1, 2]);
});
// 场景：未胡玩家的首次加杠可被此前已胡且听口锁定的玩家抢胡
// Scenario: unwon first upgrade can be robbed by previously won locked player
test("unwon first upgrade can be robbed by previously won locked player", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const initial = fixture({
    receiverWon: true,
    rules: {
      allowChangedWaitDuringLock: false,
    },
  });
  let game = move(initial, 0, "buGang", 0);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(game.claim.eligibleSeats, [1, 2]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  // 两位已胡接牌者均必须胡，不能用过牌结束窗口。
  // Both previously won claimants must win rather than pass to close the window.
  const before = structuredClone(game);
  for (const seat of [1, 2]) {
    assert.deepEqual(getLegalActions(game, seat), [{ type: "hu" }]);
    assert.throws(() => move(game, seat, "pass"), /当前不能/);
    assert.deepEqual(game, before);
  }
  game = move(move(game, 1, "hu"), 2, "hu");
  assert.equal(game.players[2].huCount, 2);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[1].huCount, 2);
  assert.equal(huEvents(game)[0].source, "robKong");
  assert.equal(huEvents(game)[0].score.robKongBonus, 1);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：被抢牌触发首次胡牌时仍只翻一次萝卜，不产生杠萝卜或补牌
// Scenario: first hu radishes still flip once for a robbed tile; there is no kong radish or replacement
test("first hu radishes still flip once for a robbed tile; there is no kong radish or replacement", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const initial = fixture({
    firstHuRadishesRevealed: false,
  });
  let game = move(initial, 0, "buGang", 0);
  game = move(move(game, 1, "hu"), 2, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[0].radishes.length, 0);
  assert.equal(game.players[1].radishes.length, 6);
  assert.equal(game.players[2].radishes.length, 0);
  assert.equal(game.wall.length, initial.wall.length - 7);
  assert.equal(gangEvents(game).length, 0);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：待抢杠状态拒绝非法响应选项及缺失的原副露
// Scenario: pending rob state rejects invalid claim options or missing original meld
test("pending rob state rejects invalid claim options or missing original meld", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const game = move(fixture(), 0, "buGang", 0);
  const bad = structuredClone(game);
  bad.claim.options[1].push({
    type: "peng",
    tile: 0,
  });
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  assert.throws(() => assertGameInvariants(bad), /抢杠状态/);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const badMeld = structuredClone(game);
  badMeld.claim.kongType = "addGang";
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  assert.throws(() => assertGameInvariants(badMeld), /抢杠状态/);
});
// 逐项覆盖 [false,true]；同一组检查用于每个样本，顺序以代码列出的集合为准。
// Exercise each entry in [false,true] with the same checks, preserving the listed order.
// Exercise each entry in [false,true] with the same checks, preserving the listed order.
for (const repeated of [false, true]) // 逐项覆盖 [false,true]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  for (const pure of [false, true]) {
    // 场景：七对抢杠不增加事件额外番：再次胡牌为 ${repeated}，清一色为 ${pure}
    // Scenario: seven pairs rob-kong has no event bonus: repeat=${repeated}, pure=${pure}
    test(`seven pairs rob-kong has no event bonus: repeat=${repeated}, pure=${pure}`, () => {
      // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
      // Arrange: prepare this step’s input or reference data within the synthetic scenario.
      const hand = pure
        ? [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]
        : [0, 1, 1, 2, 2, 9, 9, 10, 10, 11, 11, 12, 12];
      let game = fixture({
        // 旁观者听十七而非零，避免让已胡旁观者非法过掉抢杠胡。
        // The bystander waits on seventeen, not zero, so no mandatory rob-kong hu is skipped.
        receivers: [hand, [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17]],
        receiverWon: repeated,
      });
      // 此分支代表重复胡，必须保留前次胡牌影响而非当作新玩家首次胡。
      // This branch represents a repeat win and must retain the prior win’s effects.
      if (repeated) {
        game.players[1].firstHuPattern = {
          kind: "sevenPairs",
          pureSuit: pure,
          allTriplets: false,
          waitTiles: [...new Set(hand)],
          sevenPairsFan: 3,
          fixedFan: pure ? 5 : 3,
        };
      }
      // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
      // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
      // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
      // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
      assertGameInvariants(game);
      // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
      // Arrange: prepare this step’s input or reference data within the synthetic scenario.
      game = move(game, 0, "buGang", 0);
      game = move(game, 1, "hu");
      const event = huEvents(game)[0];
      // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
      // Check rendered output or source structure; regex/string matches are not real browser interactions.
      assert.equal(event.source, "robKong");
      assert.equal(event.score.fan, pure ? 5 : 3);
      assert.equal(event.score.fanPoints, pure ? 10 : 4);
      assert.equal(event.score.sevenPairsFixed, true);
      assert.equal(event.score.robKongBonus, undefined);
      assert.equal(
        event.score.patternBonuses.some((bonus) => bonus.type === "robKong"),
        false,
      );
      assert.equal(game.players[1].firstHuPattern.fixedFan, pure ? 5 : 3);
      // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
      // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
      assertGameInvariants(game);
    });
  }
// 场景：大单吊抢杠增加一番，但只向加杠者收费，包括最后一家首次胡牌
// Scenario: big single rob-kong adds one fan but charges only upgrader, including final first win
test("big single rob-kong adds one fan but charges only upgrader, including final first win", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const melds = [1, 4, 9, 12].map((tile) => ({
    tile,
    type: "peng",
    tiles: Array(3).fill(tile),
  }));
  let game = fixture({
    sourceWon: true,
    replacement: true,
    // 旁观者没有抢零的听口，保留单一赢家的终局付款断言。
    // A non-zero bystander wait preserves the single-winner final-payment assertion.
    receivers: [[0], [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17]],
    receiverMelds: [melds, []],
  });
  game.players[2].huCount = 1; // Prior hu without an additional physical record is supported by older saved fixtures.
  game = move(game, 0, "buGang", 0);
  game = move(game, 1, "hu");
  const event = huEvents(game)[0];
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.finishReason, "allPlayersHu");
  assert.equal(event.score.bigSingle, true);
  assert.equal(event.score.fan, 4); // base + big single two + rob one.
  assert.equal(event.score.robKongBonus, 1);
  assert.deepEqual(
    event.payments
      .filter((payment) => payment.delta < 0)
      .map((payment) => payment.seat),
    [0],
  );
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：首次暗杠不属于加杠，不能被抢杠
// Scenario: initial concealed kong is not an upgrade and cannot be robbed
test("initial concealed kong is not an upgrade and cannot be robbed", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const waitOne = [0, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17, 17];
  let game = fixture({
    ownHand: [1, 1, 1, 1, 2, 3, 9, 10, 11, 12, 13],
    drawTile: 1,
    receivers: [waitOne, waitOne],
  });
  game = move(game, 0, "anGang", 1);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.claim, null);
  assert.equal(game.players[0].melds[1].type, "anGang");
  assert.equal(game.players[0].kongCount, 1);
  assert.equal(
    game.history.some((event) => event.type === "robKongAttempt"),
    false,
  );
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：已保存的单赢家规则仍按顺时针裁决抢杠，不受响应顺序影响
// Scenario: saved single-winner rule still resolves rob-kong clockwise independent of response order
test("saved single-winner rule still resolves rob-kong clockwise independent of response order", () => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 逐项覆盖 [false,true]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [false,true] with the same checks, preserving the listed order.
  for (const reverse of [false, true]) {
    let game = move(
      fixture({
        rules: {
          multipleWinners: false,
        },
      }),
      0,
      "buGang",
      0,
    );
    game = reverse
      ? move(move(game, 2, "hu"), 1, "hu")
      : move(move(game, 1, "hu"), 2, "hu");
    assert.deepEqual(
      huEvents(game).map((event) => event.seat),
      [1],
    );
    assert.equal(game.players[2].huCount, 0);
    assert.equal(game.players[0].melds[0].tiles.length, 3);
    // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
    // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
    assertGameInvariants(game);
  }
});
// 场景：无人有资格抢胡时立即提交加杠，不开启空响应窗口
// Scenario: no eligible robber commits an upgrade immediately, without an empty reaction window
test("no eligible robber commits an upgrade immediately, without an empty reaction window", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const waitSeventeen = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
  const initial = fixture({
    receivers: [waitSeventeen, waitSeventeen],
  });
  const game = move(initial, 0, "buGang", 0);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.claim, null);
  assert.equal(game.players[0].melds[0].tiles.length, 4);
  assert.equal(game.players[0].kongCount, 1);
  assert.equal(game.wall.length, initial.wall.length - 2);
  assert.equal(
    game.history.some((event) => event.type === "robKongAttempt"),
    false,
  );
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
