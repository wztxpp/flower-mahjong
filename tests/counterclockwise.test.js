// 逆时针轮转和抢牌优先级；明确保留旧顺时针规则。
// Counterclockwise turns and claim priority while preserving saved clockwise rules.
// 阅读说明见 docs/TESTING-READING-GUIDE.md；固定种子与凭证仅为测试，不应移入真实用户数据。
// See docs/TESTING-READING-GUIDE.md; seeded data and test credentials must stay separate from real user data.
import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  applyAction,
  assertGameInvariants,
  getPlayerView,
  turnOrderAfter,
  dealerForNextGame,
} from "../shared/game.js";
const waiting = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
const peng = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 17, 17];
const gang = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 17, 17, 17];
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
// 按本文件的参数构造场景；规则版本、手牌与牌墙由各测试显式选择。不要把 UI 快照误当成完整引擎状态。
// Build the local scenario from its parameters; each test chooses rules, hands and wall. A UI snapshot is not a complete engine state.
function fixture(
  source,
  receivers = [waiting, waiting],
  { rules = {}, upgrade = false, head = [6, 7] } = {},
) {
  const game = createGame({
    seed: "counterclockwise",
    dealerSeat: source,
    rules: {
      allowPungUpgrade: true,
      specialHuPatterns: false,
      autoDiscardAfterHu: false,
      ...rules,
    },
  });
  const order = turnOrderAfter(game, source);
  // 逐项覆盖 game.players；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in game.players with the same checks, preserving the listed order.
  for (const player of game.players) {
    player.hand = [
      ...(player.seat === source
        ? upgrade
          ? [0, 1, 2, 3, 4, 5, 9, 10, 11, 15, 17]
          : [...waiting, 16]
        : receivers[order.indexOf(player.seat)]),
    ].sort((a, b) => a - b);
    player.melds =
      player.seat === source && upgrade
        ? [
            {
              type: "peng",
              tile: 17,
              tiles: [17, 17, 17],
            },
          ]
        : [];
  }
  game.lastDraw = {
    seat: source,
    tile: upgrade ? 17 : 16,
    source: "normal",
  };
  game.history = [];
  // 十八种牌，每种八张。先登记所有已分配牌，再把余量填入牌墙；不能凭空增加牌。
  // There are eighteen kinds with eight copies each. Debit allocated tiles, then place remaining copies in the wall.
  const counts = Array(18).fill(8);
  // 逐项覆盖 [...head,...game.players.flatMap(player=>[...player.hand,...player.melds.flatMap(meld=>meld.tiles)])]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [...head,...game.players.flatMap(player=>[...player.hand,...player.melds.flatMap(meld=>meld.tiles)])] with the same checks, preserving the listed order.
  for (const tile of [
    ...head,
    ...game.players.flatMap((player) => [
      ...player.hand,
      ...player.melds.flatMap((meld) => meld.tiles),
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
// 场景：新牌局保存逆时针方向，旧局缺失方向或设为顺时针时仍按顺时针进行
// Scenario: new games save counterclockwise direction; missing/clockwise old values remain clockwise
test("new games save counterclockwise direction; missing/clockwise old values remain clockwise", () => {
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  // 逐项覆盖 [0,1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [0,1,2] with the same checks, preserving the listed order.
  for (const source of [0, 1, 2]) {
    const game = createGame({
      seed: "direction",
      dealerSeat: source,
    });
    assert.equal(game.rules.turnDirection, "counterclockwise");
    assert.deepEqual(turnOrderAfter(game, source), [
      (source + 2) % 3,
      (source + 1) % 3,
    ]);
    assert.equal(
      getPlayerView(game, source).rules.turnDirection,
      "counterclockwise",
    );
    // 逐项覆盖 [undefined,'clockwise']；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in [undefined,'clockwise'] with the same checks, preserving the listed order.
    for (const direction of [undefined, "clockwise"]) {
      const old = fixture(source);
      // 仅显式方向才写规则字段；未提供的旧存档保留原兼容方向。
      // Write direction only when explicitly supplied; omitted saved rules keep their compatibility direction.
      if (direction) old.rules.turnDirection = direction;
      else delete old.rules.turnDirection;
      const saved = structuredClone(old);
      const next = passAll(move(old, source, "discard", 17));
      assert.equal(next.currentSeat, (source + 1) % 3);
      assert.deepEqual(old, saved);
      assert.equal(next.rules.turnDirection, direction);
    }
  }
  // 逐项覆盖 [null,true,2,'right',[]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [null,true,2,'right',[]] with the same checks, preserving the listed order.
  for (const value of [null, true, 2, "right", []])
    assert.throws(
      () =>
        createGame({
          rules: {
            turnDirection: value,
          },
        }),
      /行牌方向/,
    );
});
// 逐项覆盖 [0,1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
// Exercise each entry in [0,1,2] with the same checks, preserving the listed order.
for (const source of [0, 1, 2]) {
  const priority = [(source + 2) % 3, (source + 1) % 3];
  // 场景：座位 ${source} 的弃牌无人响应或全部过牌后，依次轮到右侧再左侧
  // Scenario: seat ${source} advances right then left when no one claims or all pass
  test(`seat ${source} advances right then left when no one claims or all pass`, () => {
    // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
    // Check rendered output or source structure; regex/string matches are not real browser interactions.
    // 逐项覆盖 [16,17]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in [16,17] with the same checks, preserving the listed order.
    for (const tile of [16, 17]) {
      const game = passAll(move(fixture(source), source, "discard", tile));
      assert.equal(game.currentSeat, priority[0]);
      assert.equal(game.lastDraw.tile, 6);
      // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
      // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
      assertGameInvariants(game);
    }
  });
  // 逐项覆盖 [false,true]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [false,true] with the same checks, preserving the listed order.
  for (const reverse of [false, true]) {
    const replies = reverse ? [...priority].reverse() : priority;
    // 逐项覆盖 ['peng','mingGang']；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in ['peng','mingGang'] with the same checks, preserving the listed order.
    // Scenario: seat ${source} equal ${type}, reversed replies ${reverse}, uses counterclockwise priority
    for (const type of ["peng", "mingGang"]) // 场景：座位 ${source} 同优先级 ${type} 响应在反转响应顺序 ${reverse} 时仍按逆时针裁决
      test(`seat ${source} equal ${type}, reversed replies ${reverse}, uses counterclockwise priority`, () => {
        // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
        // Arrange: prepare this step’s input or reference data within the synthetic scenario.
        let game = move(
          fixture(source, type === "peng" ? [peng, peng] : [gang, gang]),
          source,
          "discard",
          17,
        );
        // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
        // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
        assert.deepEqual(game.claim.eligibleSeats, priority);
        // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
        // Arrange: prepare this step’s input or reference data within the synthetic scenario.
        const wall = game.wall.length;
        game = move(game, replies[0], type, 17);
        // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
        // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
        assert.equal(game.phase, "claim");
        assert.equal(game.wall.length, wall);
        assert.equal(
          game.players.some((player) => player.melds.length),
          false,
        );
        // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
        // Arrange: prepare this step’s input or reference data within the synthetic scenario.
        game = move(game, replies[1], type, 17);
        // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
        // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
        assert.equal(game.discards[0].claimedBy, priority[0]);
        assert.equal(game.currentSeat, priority[0]);
        assert.equal(game.players[priority[1]].melds.length, 0);
        // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
        // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
        assertGameInvariants(game);
      });
    // 逐项覆盖 [false,true]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in [false,true] with the same checks, preserving the listed order.
    // Scenario: seat ${source} kong outranks peng even when ${gangIsNearest ? 'near' : 'far'}, reversed ${reverse}
    for (const gangIsNearest of [false, true]) // 场景：座位 ${source} 的杠优先于碰，不论杠者为 ${gangIsNearest ? 'near' : 'far'}，响应顺序反转为 ${reverse}
      test(`seat ${source} kong outranks peng even when ${gangIsNearest ? "near" : "far"}, reversed ${reverse}`, () => {
        // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
        // Arrange: prepare this step’s input or reference data within the synthetic scenario.
        const gangSeat = priority[gangIsNearest ? 0 : 1];
        let game = move(
          fixture(source, gangIsNearest ? [gang, peng] : [peng, gang]),
          source,
          "discard",
          17,
        );
        // 逐项覆盖 replies；同一组检查用于每个样本，顺序以代码列出的集合为准。
        // Exercise each entry in replies with the same checks, preserving the listed order.
        for (const seat of replies)
          game = move(game, seat, seat === gangSeat ? "mingGang" : "peng", 17);
        // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
        // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
        assert.equal(game.discards[0].claimedBy, gangSeat);
        // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
        // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
        assertGameInvariants(game);
      });
    // 逐项覆盖 ['discard','robKong']；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in ['discard','robKong'] with the same checks, preserving the listed order.
    // Scenario: seat ${source} double ${kind} hu and next dealer use counterclockwise order, reversed ${reverse}
    for (const kind of ["discard", "robKong"]) // 场景：座位 ${source} 的双 ${kind} 胡与下一局庄家均按逆时针顺序，响应顺序反转为 ${reverse}
      test(`seat ${source} double ${kind} hu and next dealer use counterclockwise order, reversed ${reverse}`, () => {
        // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
        // Arrange: prepare this step’s input or reference data within the synthetic scenario.
        const upgrade = kind === "robKong";
        let game = move(
          fixture(source, [waiting, waiting], {
            upgrade,
          }),
          source,
          upgrade ? "buGang" : "discard",
          17,
        );
        game = JSON.parse(JSON.stringify(game)); // Saved pending window has the same priority after reload.
        // 逐项覆盖 replies；同一组检查用于每个样本，顺序以代码列出的集合为准。
        // Exercise each entry in replies with the same checks, preserving the listed order.
        for (const seat of replies) game = move(game, seat, "hu");
        const events = game.history.filter((event) => event.type === "hu");
        // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
        // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
        assert.deepEqual(
          events.map((event) => event.seat),
          priority,
        );
        assert.equal(game.currentSeat, priority[0]);
        assert.equal(dealerForNextGame(game), priority[0]);
        assert.deepEqual(game.discards[0].huSeats, priority);
        assert.equal(game.players[priority[0]].winPile[0].virtual, false);
        assert.equal(game.players[priority[1]].winPile[0].virtual, true);
        assert.equal(
          game.players.reduce((sum, player) => sum + player.score, 0),
          0,
        );
        // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
        // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
        assertGameInvariants(game);
      });
    // 场景：座位 ${source} 的胡优先于更近座位的杠，响应顺序反转为 ${reverse}
    // Scenario: seat ${source} hu beats nearer kong, reversed ${reverse}
    test(`seat ${source} hu beats nearer kong, reversed ${reverse}`, () => {
      // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
      // Arrange: prepare this step’s input or reference data within the synthetic scenario.
      let game = move(fixture(source, [gang, waiting]), source, "discard", 17);
      // 逐项覆盖 replies；同一组检查用于每个样本，顺序以代码列出的集合为准。
      // Exercise each entry in replies with the same checks, preserving the listed order.
      for (const seat of replies)
        game = move(
          game,
          seat,
          seat === priority[0] ? "mingGang" : "hu",
          seat === priority[0] ? 17 : undefined,
        );
      // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
      // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
      assert.equal(game.players[priority[1]].huCount, 1);
      assert.equal(game.players[priority[0]].melds.length, 0);
      // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
      // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
      assertGameInvariants(game);
    });
  }
}
// 场景：已保存的顺时针同时响应在缺少方向开关时仍保持原有顺序
// Scenario: saved clockwise simultaneous claims remain stable without a direction flag
test("saved clockwise simultaneous claims remain stable without a direction flag", () => {
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  // 逐项覆盖 ['peng','mingGang','hu']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['peng','mingGang','hu'] with the same checks, preserving the listed order.
  // Exercise each entry in [false,true] with the same checks, preserving the listed order.
  for (const type of ["peng", "mingGang", "hu"]) // 逐项覆盖 [false,true]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    for (const reverse of [false, true]) {
      const hands =
        type === "peng"
          ? [peng, peng]
          : type === "mingGang"
            ? [gang, gang]
            : [waiting, waiting];
      let game = fixture(0, hands);
      delete game.rules.turnDirection;
      game = move(game, 0, "discard", 17);
      // 逐项覆盖 reverse?[2,1]:[1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
      // Exercise each entry in reverse?[2,1]:[1,2] with the same checks, preserving the listed order.
      for (const seat of reverse ? [2, 1] : [1, 2])
        game = move(game, seat, type, type === "hu" ? undefined : 17);
      assert.equal(
        type === "hu"
          ? game.discards[0].huSeats[0]
          : game.discards[0].claimedBy,
        1,
      );
      assert.equal(game.rules.turnDirection, undefined);
      // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
      // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
      assertGameInvariants(game);
    }
});
