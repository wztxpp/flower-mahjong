// 五至八张扩杠、胡后必杠、番数与杠后补牌的付款来源。
// Five-to-eight-tile extensions, mandatory post-win kongs, fan and replacement-win payer provenance.
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
const waiting = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
const noZero = waiting.map((tile) => (tile === 0 ? 6 : tile));
// 按指定牌型、牌面与张数组装副露，不自动从任何手牌扣牌。
// Build a meld with the requested kind/tile/count; this alone does not debit a hand.
const meld = (tile, type, count) => ({
  type,
  tile,
  tiles: Array(count).fill(tile),
});
// 筛选当前场景中的合法动作或已提交事件，不修改原始历史。
// Select legal actions or committed events for the scenario without mutating source history.
const actions = (game) => getLegalActions(game, 0);
// 把测试中的动作类型和可选牌面转为引擎请求，返回新状态；省略牌面不发送该字段。
// Convert type/optional tile into an engine request and return the new state, omitting absent tile fields.
const doAction = (game, type, tile) =>
  applyAction(
    game,
    0,
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
const kongEvents = (game) =>
  game.history.filter((event) => event.type === "addGang");
// 筛选当前场景中的合法动作或已提交事件，不修改原始历史。
// Select legal actions or committed events for the scenario without mutating source history.
const huEvents = (game) => game.history.filter((event) => event.type === "hu");

/** Real, conserved schema-3 state, including each prior win's physical tile. */
// 按本文件的参数构造场景；规则版本、手牌与牌墙由各测试显式选择。不要把 UI 快照误当成完整引擎状态。
// Build the local scenario from its parameters; each test chooses rules, hands and wall. A UI snapshot is not a complete engine state.
function fixture({
  hand,
  melds = [],
  priorWins = [],
  head = [6],
  tail = [],
  opponents = [noZero, noZero],
  rules = {},
  currentSeat = 0,
  priorWinsBySeat = [priorWins, [], []],
  drawTile = currentSeat === 0
    ? hand.at(-1)
    : opponents[currentSeat - 1].at(-1),
  wallCount,
} = {}) {
  const game = createGame({
    seed: "extended-kong",
    rules: {
      allowPungUpgrade: true,
      specialHuPatterns: false,
      ...rules,
    },
  });
  game.players.forEach((player, seat) => {
    player.hand = [...(seat === 0 ? hand : opponents[seat - 1])].sort(
      (a, b) => a - b,
    );
    player.melds = seat === 0 ? structuredClone(melds) : [];
    player.winPile = priorWinsBySeat[seat].map((tile) => ({
      tile,
      source: "selfDraw",
      virtual: false,
    }));
    player.huCount = player.winPile.length;
    player.kongCount = player.melds.filter(
      (group) => group.type !== "peng",
    ).length;
  });
  game.history = [];
  game.discards = [];
  // 已胡的实物牌仍占一张物理配额；winPile 是展示/计分引用，不能当成新增的牌。
  // Physical winning tiles still occupy one copy; winPile is a display/scoring reference, not newly created tiles.
  game.retiredTiles = priorWinsBySeat.flatMap((wins, seat) =>
    wins.map((tile) => ({
      seat,
      tile,
    })),
  );
  game.firstHuRadishesRevealed = priorWinsBySeat.some(
    (wins) => wins.length > 0,
  );
  game.phase = "turn";
  game.turnStep = "discard";
  game.currentSeat = currentSeat;
  game.drawKind = "normal";
  game.lastDraw = {
    seat: currentSeat,
    tile: drawTile,
    source: "normal",
  };
  // 十八种牌，每种八张。先登记所有已分配牌，再把余量填入牌墙；不能凭空增加牌。
  // There are eighteen kinds with eight copies each. Debit allocated tiles, then place remaining copies in the wall.
  const counts = Array(18).fill(8);
  // 从每种牌八张的余量扣除一张；负数表示夹具凭空制造了第九张，立即失败。
  // Debit one of the eight copies of a tile; a negative remainder means the fixture invented a ninth copy and must fail.
  const use = (tile) =>
    assert.ok(--counts[tile] >= 0, `Fixture overused tile ${tile}`);
  // 逐项覆盖 game.players；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in game.players with the same checks, preserving the listed order.
  for (const player of game.players)
    [...player.hand, ...player.melds.flatMap((group) => group.tiles)].forEach(
      use,
    );
  game.retiredTiles.forEach((item) => use(item.tile));
  [...head, ...tail].forEach(use);
  const rest = counts.flatMap((count, tile) => Array(count).fill(tile));
  // 仅在明确指定墙牌数时裁剪；多出的实物牌必须移入退役区，不能消失。
  // Trim the wall only when explicitly requested; surplus physical tiles must be retired, not disappear.
  if (wallCount !== undefined) {
    assert.ok(wallCount >= head.length + tail.length);
    game.retiredTiles.push(
      ...rest.splice(wallCount - head.length - tail.length).map((tile) => ({
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
// 逐项覆盖 ['anGang','mingGang','buGang']；同一组检查用于每个样本，顺序以代码列出的集合为准。
// Exercise each entry in ['anGang','mingGang','buGang'] with the same checks, preserving the listed order.
for (const type of ["anGang", "mingGang", "buGang"]) {
  // 场景：${type} 从 5→6→7→8 扩杠时，每加一张只对应一次付款、待翻萝卜和补牌
  // Scenario: ${type} extends 5→6→7→8 with one payment, deferred radish and replacement per tile
  test(`${type} extends 5→6→7→8 with one payment, deferred radish and replacement per tile`, () => {
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    let game = fixture({
      hand: [0, 1, 2, 3, 9, 10, 11, 12, 13, 16, 17],
      melds: [meld(0, type, 5)],
      head: [0, 0, 6],
      tail: [7, 8, 15],
      drawTile: 0,
    });
    const oldLog = {
      revision: -1,
      type: "addGang",
      seat: 0,
      points: 1,
      message: "保存的旧记录",
    };
    game.history.push(oldLog);
    game.players[0].score = 10;
    game.players[1].score = -3;
    game.players[2].score = -7;
    const oldBreakdown = {
      fan: 1,
      copyFanBonus: 0,
      total: 1,
    };
    game.players[0].lastScoreBreakdown = oldBreakdown;
    const wallBefore = game.wall.length;
    // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
    // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
    // 逐项覆盖 [6,7,8]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in [6,7,8] with the same checks, preserving the listed order.
    for (const count of [6, 7, 8]) {
      const before = structuredClone(game);
      assert.ok(
        actions(game).some(
          (action) => action.type === "addGang" && action.tile === 0,
        ),
      );
      game = doAction(game, "addGang", 0);
      assert.deepEqual(before.history[0], oldLog);
      assert.equal(game.players[0].melds.length, 1);
      assert.equal(game.players[0].melds[0].type, type);
      assert.equal(game.players[0].melds[0].tiles.length, count);
      assert.equal(game.players[0].melds[0].extended, true);
      assert.equal(game.players[0].hand.length, 11);
      assert.equal(game.players[0].kongCount, count - 4);
      assert.equal(game.players[0].radishes.length, 0);
      assert.equal(game.pendingKongRadishes, count - 5);
      assert.equal(game.wall.length, wallBefore - (count - 5));
      assert.equal(game.lastDraw.tile, count < 8 ? 0 : 6);
      assert.equal(game.lastDraw.source, "replacement");
      assert.equal(game.players[0].pendingKongDiscard, true);
      assert.deepEqual(
        game.players.map((player) => player.score),
        [10 + 2 * (count - 5), -3 - (count - 5), -7 - (count - 5)],
      );
      const event = kongEvents(game).at(-1);
      assert.equal(event.points, 1);
      assert.deepEqual(event.payments, [
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
      assert.match(event.message, new RegExp(`加杠至${count}张`));
      assert.equal(event.tile, type === "anGang" ? undefined : 0);
      // 逐项覆盖 [1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
      // Exercise each entry in [1,2] with the same checks, preserving the listed order.
      for (const viewer of [1, 2]) {
        const publicMeld = getPlayerView(game, viewer).players[0].melds[0];
        assert.deepEqual(
          publicMeld.tiles,
          Array(count).fill(0),
        );
        assert.equal(publicMeld.tile, 0);
        assert.equal(getPlayerView(game, viewer).players[0].hand, undefined);
      }
      assert.deepEqual(
        getPlayerView(game, 0).players[0].melds[0].tiles,
        Array(count).fill(0),
      );
      assert.deepEqual(game.history[0], oldLog);
      assert.deepEqual(game.players[0].lastScoreBreakdown, oldBreakdown);
      // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
      // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
      assertGameInvariants(game);
    }
    assert.deepEqual(game.players[0].radishes, []);
    assert.deepEqual(game.wall.slice(-3), [7, 8, 15]);
    assert.equal(kongEvents(game).length, 4); // Three new entries plus the saved old entry.
    assert.equal(
      actions(game).some((action) => action.type === "addGang"),
      false,
    );
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    const before = structuredClone(game);
    // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
    // Verify rejection: invalid input must fail rather than execute silently.
    assert.throws(() => doAction(game, "addGang", 0));
    assert.deepEqual(game, before);
  });
}
// 场景：反馈的五张八筒杠允许加入第六张，同时保留其他牌组
// Scenario: reported five-eight-circles meld offers its sixth tile while preserving the other groups
test("reported five-eight-circles meld offers its sixth tile while preserving the other groups", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const game = fixture({
    hand: [1, 1, 3, 3, 16],
    drawTile: 16,
    melds: [
      meld(16, "buGang", 5),
      meld(12, "mingGang", 4),
      meld(15, "peng", 3),
    ],
    head: [6],
    tail: [8],
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.ok(
    actions(game).some(
      (action) => action.type === "addGang" && action.tile === 16,
    ),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const next = doAction(game, "addGang", 16);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(
    next.players[0].melds.map((group) => group.tiles.length),
    [6, 4, 3],
  );
  assert.deepEqual(next.players[0].hand, [1, 1, 3, 3, 6]);
  assert.deepEqual(
    next.players.map((player) => player.score),
    [2, -1, -1],
  );
  assert.deepEqual(next.players[0].radishes, []);
  assert.equal(next.pendingKongRadishes, 1);
  assert.equal(next.wall.at(-1), 8);
});
// 场景：胡后扩杠保留完整听口集合、仍须强制执行，并允许补牌胡
// Scenario: post-hu extensions preserve the complete wait set, stay mandatory, and permit a winning replacement
test("post-hu extensions preserve the complete wait set, stay mandatory, and permit a winning replacement", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const otherHands = waiting.map((tile) => (tile === 2 ? 6 : tile));
  let game = fixture({
    hand: [2, 3, 4, 5, 6, 7, 8, 10, 11, 17, 17],
    drawTile: 2,
    melds: [meld(2, "anGang", 5)],
    priorWins: [9],
    head: [2, 2, 9],
    tail: [8, 8, 8],
    opponents: [otherHands, otherHands],
  });
  const waitTiles = getPlayerView(game, 0).waitTiles;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(waitTiles, [9, 12]);
  // 逐项覆盖 [6,7,8]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [6,7,8] with the same checks, preserving the listed order.
  for (const count of [6, 7, 8]) {
    assert.deepEqual(actions(game), [
      {
        type: "addGang",
        tile: 2,
      },
    ]);
    const before = structuredClone(game);
    assert.throws(() => doAction(game, "pass"));
    assert.throws(() => doAction(game, "discard", 2));
    assert.deepEqual(game, before);
    game = doAction(game, "addGang", 2);
    assert.equal(game.players[0].melds[0].tiles.length, count);
    assert.deepEqual(getPlayerView(game, 0).waitTiles, waitTiles);
    assert.equal(game.players[0].huCount, 1);
    // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
    // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
    assertGameInvariants(game);
  }
  assert.equal(game.lastDraw.tile, 9);
  assert.ok(actions(game).some((action) => action.type === "hu"));
  assert.equal(
    actions(game).some((action) => action.type.endsWith("Gang")),
    false,
  );
  assert.deepEqual(
    game.players.map((player) => player.score),
    [6, -3, -3],
  );
});
// 场景：同种牌的碰与杠保持独立，并选择正确的加杠类型
// Scenario: same-tile peng and kong remain separate and select the correct upgrade type
test("same-tile peng and kong remain separate and select the correct upgrade type", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const game = fixture({
    hand: [0, 1, 2, 3, 9, 10, 11, 17],
    drawTile: 0,
    melds: [meld(0, "peng", 3), meld(0, "anGang", 4)],
    head: [6],
    tail: [8],
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.ok(
    actions(game).some(
      (action) => action.type === "buGang" && action.tile === 0,
    ),
  );
  assert.ok(
    actions(game).some(
      (action) => action.type === "addGang" && action.tile === 0,
    ),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const supplemented = doAction(game, "buGang", 0);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(
    supplemented.players[0].melds.map((group) => [
      group.type,
      group.tiles.length,
    ]),
    [
      ["buGang", 4],
      ["anGang", 4],
    ],
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const extended = doAction(game, "addGang", 0);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(
    extended.players[0].melds.map((group) => [group.type, group.tiles.length]),
    [
      ["peng", 3],
      ["anGang", 5],
    ],
  );
  assert.equal(kongEvents(extended).at(-1).tile, undefined);
  assert.deepEqual(
    getPlayerView(extended, 1).players[0].melds[0].tiles,
    [0, 0, 0],
  );
  assert.deepEqual(getPlayerView(extended, 1).players[0].melds[1].tiles, [
    0,
    0,
    0,
    0,
    0,
  ]);
});
// 场景：牌墙必须同时够翻萝卜与补牌，且每种实体牌总数仍为八张
// Scenario: wall must contain both a radish and replacement, and physical tile count is still eight
test("wall must contain both a radish and replacement, and physical tile count is still eight", () => {
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  // 逐项覆盖 [5,6,7]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [5,6,7] with the same checks, preserving the listed order.
  for (const count of [5, 6, 7]) {
    const game = fixture({
      hand: [0, 1, 2, 3, 9, 10, 11, 12, 13, 16, 17],
      melds: [meld(0, "buGang", count)],
      drawTile: 0,
      head: [6],
      wallCount: 1,
    });
    assert.equal(
      actions(game).some((action) => action.type === "addGang"),
      false,
    );
    const before = structuredClone(game);
    assert.throws(() => doAction(game, "addGang", 0));
    assert.deepEqual(game, before);
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const game = fixture({
    hand: [1, 2, 3, 9, 10, 11, 12, 13, 14, 16, 17],
    melds: [meld(0, "buGang", 8)],
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const forged = structuredClone(game);
  forged.players[0].hand.push(0);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(
    actions(forged).some((action) => action.type === "addGang"),
    false,
  );
  assert.throws(() => doAction(forged, "addGang", 0));
  assert.throws(() => assertGameInvariants(forged), /牌张守恒/);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const nineTileMeld = structuredClone(game);
  nineTileMeld.players[0].melds[0].tiles.push(0);
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  assert.throws(() => assertGameInvariants(nineTileMeld), /牌张守恒/);
});
// 场景：四至八张相同牌分别增加一至五番，包括载入的 schema-3 存档
// Scenario: four through eight copies add one through five fan, including loaded schema-3 saves
test("four through eight copies add one through five fan, including loaded schema-3 saves", () => {
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 [4,5,6,7,8]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [4,5,6,7,8] with the same checks, preserving the listed order.
  for (const count of [4, 5, 6, 7, 8]) {
    let game = fixture({
      hand: [1, 2, 3, 9, 10, 11, 12, 13, 14, 17, 17],
      melds: [meld(0, "buGang", count)],
      drawTile: 17,
      head: [17],
      tail: [7, 7, 8, 8, 15, 15],
    });
    game = JSON.parse(JSON.stringify(game));
    assert.equal(game.rules.sevenPlusCopyFan, 0); // Existing stored rules need no migration.
    game = doAction(game, "hu");
    const score = huEvents(game).at(-1).score;
    assert.equal(score.copyFanBonus, count - 3);
    assert.equal(score.fan, count - 2);
    assert.equal(score.dragonBonus, 0);
    // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
    // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
    assertGameInvariants(game);
  }
});
// 场景：七张和八张同牌的番数统计包含既往胡牌，同时保留已配置的六张奖励
// Scenario: seven and eight copy fan includes prior wins, while retaining a configured six-copy bonus
test("seven and eight copy fan includes prior wins, while retaining a configured six-copy bonus", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 0, 0, 0, 0, 0, 3, 4, 5, 9, 10, 11, 17, 17];
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 [6,7,8]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [6,7,8] with the same checks, preserving the listed order.
  for (const count of [6, 7, 8]) {
    const game = doAction(
      fixture({
        hand,
        priorWins: Array(count - 6).fill(0),
        drawTile: 17,
        rules: {
          sixCopyFan: 6,
          sevenPlusCopyFan: 19,
        },
        head: [17],
      }),
      "hu",
    );
    assert.equal(
      huEvents(game).at(-1).score.copyFanBonus,
      count === 6 ? 6 : count - 3,
    );
  }
});
// 场景：七对首次固定档位不因后续胡牌累计至七张或八张同牌而增长
// Scenario: seven-pairs fixed first tier does not grow when later wins reach seven and eight copies
test("seven-pairs fixed first tier does not grow when later wins reach seven and eight copies", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 0, 2, 2, 4, 4, 6, 6, 9, 9, 11, 11, 13, 13];
  const opponents = waiting.map((tile) => (tile === 13 ? 16 : tile));
  let game = fixture({
    hand,
    drawTile: 13,
    rules: {
      specialHuPatterns: true,
    },
    opponents: [opponents, opponents],
    head: [13, 13, 13, 13, 13, 13, 2],
    tail: [8, 8, 8, 15, 15, 15],
  });
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  for (let count = 2; count <= 8; count++) {
    game = doAction(game, "hu");
    const score = huEvents(game).at(-1).score;
    assert.equal(score.fan, 3);
    assert.equal(score.copyFanBonus, 0);
    assert.equal(score.sevenPairsFixed, true);
    assert.equal(game.players[0].firstHuPattern.fixedFan, 3);
    // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
    // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
    assertGameInvariants(game);
  }
  assert.equal(
    game.players[0].winPile.filter((win) => win.tile === 13).length,
    7,
  );
  assert.equal(getPlayerView(game, 0).waitTiles.includes(13), false);
});

/** Drive a real discard claim into its immediate exposed-kong replacement. */
// 通过真实动作形成明杠后的补牌局面，用于核对点杠者付款来源。
// Reach an exposed-kong replacement through real actions to verify original-discarder payment provenance.
function afterExposedKong({
  base = [1, 2, 3, 9, 10, 11, 12, 13, 14, 17],
  melds = [],
  head = [17, 17],
  rules = {},
} = {}) {
  let game = fixture({
    hand: [0, 0, 0, ...base],
    melds,
    currentSeat: 1,
    drawTile: 0,
    opponents: [[...noZero, 0], noZero],
    head,
    tail: [7, 7, 8, 8, 15, 15, 16],
    rules,
  });
  game = applyAction(game, 1, {
    type: "discard",
    tile: 0,
  });
  assert.ok(
    actions(game).some(
      (action) => action.type === "mingGang" && action.tile === 0,
    ),
  );
  game = doAction(game, "mingGang", 0);
  // 逐项覆盖 game.claim?.eligibleSeats||[]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in game.claim?.eligibleSeats||[] with the same checks, preserving the listed order.
  // Pass only responders who have not answered, avoiding duplicate submissions in one window.
  for (const seat of game.claim?.eligibleSeats || []) // 只给尚未回复的合法座位过牌，避免同一反应窗重复提交。
    if (!game.claim.responses[seat])
      game = applyAction(game, seat, {
        type: "pass",
      });
  assert.deepEqual(game.lastDraw.kongSource, {
    type: "mingGang",
    fromSeat: 1,
  });
  return game;
}
// 读取胡牌结算的负分付款条目，核对实际付款座位集合。
// Inspect negative hu-payment entries and compare the actual payer seat set.
function assertHuPayers(game, expectedSeats) {
  const event = huEvents(game).at(-1);
  assert.deepEqual(
    event.payments
      .filter((payment) => payment.delta < 0)
      .map((payment) => payment.seat),
    expectedSeats,
  );
  assert.ok(event.points > 0);
  assert.deepEqual(event.payments.at(-1), {
    seat: 0,
    delta: expectedSeats.length * event.points,
  });
  return event;
}
// 场景：明杠补牌胡仅由供杠弃牌者付款，继续行动后清除该归属
// Scenario: exposed-kong replacement hu charges only its discarder; continuation clears that attribution
test("exposed-kong replacement hu charges only its discarder; continuation clears that attribution", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = afterExposedKong();
  const before = game.players.map((player) => player.score);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, "hu");
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  const first = assertHuPayers(game, [1]);
  assert.equal(first.source, "selfDraw");
  assert.equal(first.fromSeat, null);
  assert.deepEqual(first.kongSource, {
    type: "mingGang",
    fromSeat: 1,
  });
  assert.match(first.message, /明杠后补摸胡（仅杠牌出牌者付款）/);
  assert.equal(game.players[2].score, before[2]);
  assert.equal(game.players[0].score - before[0], first.points);
  assert.deepEqual(game.lastDraw, {
    seat: 0,
    tile: 17,
    source: "continuation",
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, "hu");
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  const second = assertHuPayers(game, [1, 2]);
  assert.equal(second.kongSource, undefined);
  assert.doesNotMatch(second.message, /明杠后补摸胡/);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：明杠补牌付款归属在 JSON 重载和可恢复的较旧存档中保留
// Scenario: exposed-kong replacement attribution survives JSON reload and recoverable older saves
test("exposed-kong replacement attribution survives JSON reload and recoverable older saves", () => {
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  // 逐项覆盖 [false,true]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [false,true] with the same checks, preserving the listed order.
  for (const legacy of [false, true]) {
    let game = JSON.parse(JSON.stringify(afterExposedKong()));
    // 明确构造旧规则的兼容分支，不把新局默认行为默默带入旧存档。
    // Construct the saved-rule compatibility branch explicitly without importing new-game defaults.
    if (legacy) delete game.lastDraw.kongSource;
    const history = structuredClone(game.history);
    game = doAction(game, "hu");
    assertHuPayers(game, [1]);
    assert.deepEqual(game.history.slice(0, history.length), history);
    assert.deepEqual(huEvents(game).at(-1).kongSource, {
      type: "mingGang",
      fromSeat: 1,
    });
    // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
    // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
    assertGameInvariants(game);
  }
});
// 场景：旧版补牌来源含糊时保留旧行为，不猜测来源
// Scenario: ambiguous legacy replacement provenance preserves old behavior instead of guessing
test("ambiguous legacy replacement provenance preserves old behavior instead of guessing", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const changes = [
    (game) => {
      game.history = [];
    },
    (game) => {
      game.history.at(-2).seat = 2;
    },
    (game) => {
      game.history.at(-2).fromSeat = 0;
    },
    (game) => {
      game.history.at(-2).revision--;
    },
    (game) => {
      game.history.at(-1).source = "normal";
    },
    (game) => {
      game.history.splice(-1, 0, {
        type: "hu",
        seat: 2,
        revision: game.revision,
      });
    },
  ];
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 changes；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in changes with the same checks, preserving the listed order.
  for (const change of changes) {
    let game = afterExposedKong();
    delete game.lastDraw.kongSource;
    change(game);
    game = doAction(game, "hu");
    const event = assertHuPayers(game, [1, 2]);
    assert.equal(event.kongSource, undefined);
    assert.doesNotMatch(event.message, /明杠后补摸胡/);
  }
});
// 逐项覆盖 ['anGang','buGang','addGang']；同一组检查用于每个样本，顺序以代码列出的集合为准。
// Exercise each entry in ['anGang','buGang','addGang'] with the same checks, preserving the listed order.
for (const type of ["anGang", "buGang", "addGang"]) {
  // 场景：后续 ${type} 覆盖明杠来源，其补牌胡改由两名对手付款
  // Scenario: a later ${type} replaces exposed-kong provenance and its replacement hu charges both
  test(`a later ${type} replaces exposed-kong provenance and its replacement hu charges both`, () => {
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    let game;
    // 暗杠需要隐藏牌面，与公开的明杠/补杠使用不同可见性或手牌安排。
    // Concealed kongs use distinct visibility/hand setup from exposed and supplemental kongs.
    if (type === "anGang") {
      game = afterExposedKong({
        base: [2, 2, 2, 4, 5, 6, 9, 10, 11, 17],
        head: [2, 17, 17],
      });
    } else if (type === "buGang") {
      // 补杠从已有碰组升级；暗杠或真杠扩张需要不同的原始副露形态。
      // A supplemental kong upgrades a peng; concealed kongs/extensions require different original melds.
      game = afterExposedKong({
        base: [4, 5, 6, 9, 10, 11, 17],
        melds: [meld(3, "peng", 3)],
        head: [3, 17, 17],
      });
    } else {
      game = afterExposedKong({
        head: [0, 17, 17],
      });
    }
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    game = doAction(
      game,
      type,
      type === "anGang" ? 2 : type === "buGang" ? 3 : 0,
    );
    // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
    // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
    assert.deepEqual(game.lastDraw.kongSource, {
      type,
      fromSeat: null,
    });
    assert.equal(game.lastDraw.tile, 17);
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    game = doAction(game, "hu");
    // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
    // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
    const event = assertHuPayers(game, [1, 2]);
    assert.deepEqual(event.kongSource, {
      type,
      fromSeat: null,
    });
    assert.doesNotMatch(event.message, /明杠后补摸胡/);
  });
}
// 场景：明杠补牌在大单吊及最后一家首次胡牌时仍只由一人付款
// Scenario: exposed replacement retains single payer for big single and final first hu
test("exposed replacement retains single payer for big single and final first hu", () => {
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 [false,true]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [false,true] with the same checks, preserving the listed order.
  for (const finalWin of [false, true]) {
    let game = afterExposedKong({
      base: [17],
      melds: [meld(3, "peng", 3), meld(6, "peng", 3), meld(9, "peng", 3)],
      rules: {
        specialHuPatterns: true,
      },
    });
    // 最后一位首次胡的场景还要覆盖全员已胡收尾，不能漏掉最后批次结算。
    // The final first-win case also covers all-player completion and must not lose the final settlement batch.
    if (finalWin) {
      // Exercise the final-first-hu branch without rewriting any recorded score.
      // 逐项覆盖 [1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
      // Exercise each entry in [1,2] with the same checks, preserving the listed order.
      for (const seat of [1, 2]) {
        const tile = game.wall.shift();
        game.retiredTiles.push({
          seat,
          tile,
        });
        game.players[seat].winPile.push({
          tile,
          source: "selfDraw",
          virtual: false,
        });
        game.players[seat].huCount = 1;
      }
      // Model the already completed first hu's base and pending radish reveal.
      for (let n = 6 + game.pendingKongRadishes; n > 0 && game.wall.length; n--)
        game.players[1].radishes.push(game.wall.pop());
      game.pendingKongRadishes = 0;
      game.firstHuRadishesRevealed = true;
      // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
      // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
      assertGameInvariants(game);
    }
    game = doAction(game, "hu");
    const event = assertHuPayers(game, [1]);
    assert.equal(event.score.bigSingle, true);
    assert.match(event.message, /大单钓·明杠后补摸胡/);
    // 最后一位首次胡的场景还要覆盖全员已胡收尾，不能漏掉最后批次结算。
    // The final first-win case also covers all-player completion and must not lose the final settlement batch.
    if (finalWin) {
      assert.equal(game.phase, "finished");
      assert.equal(game.finishReason, "allPlayersHu");
    }
  }
});
// 场景：自己的杠后补牌胡即使胡牌者及一名对手已胡，仍由两名对手付款
// Scenario: own replacement still charges both when the winner and one opponent have already hu
test("own replacement still charges both when the winner and one opponent have already hu", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    hand: [0, 1, 2, 3, 9, 10, 11, 12, 13, 14, 17],
    drawTile: 0,
    melds: [meld(0, "buGang", 5)],
    head: [17, 17],
    tail: [8],
    priorWinsBySeat: [[17], [16], []],
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(actions(game), [
    {
      type: "addGang",
      tile: 0,
    },
  ]);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, "addGang", 0);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(game.lastDraw.kongSource, {
    type: "addGang",
    fromSeat: null,
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, "hu");
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assertHuPayers(game, [1, 2]);
  assert.equal(game.lastDraw.kongSource, undefined);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, "hu");
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assertHuPayers(game, [2]);
});
// 场景：补牌来源信息拒绝错误来源、非法付款方及过期的普通摸牌元数据
// Scenario: replacement provenance rejects wrong source, invalid payer and stale ordinary-draw metadata
test("replacement provenance rejects wrong source, invalid payer and stale ordinary-draw metadata", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const original = afterExposedKong();
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  // 逐项覆盖 [{type:'mingGang',fromSeat:0},{type:'mingGang',fromSeat:3},{type:'buGang',fromSeat:1},{type:'peng',fromSeat:1}]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [{type:'mingGang',fromSeat:0},{type:'mingGang',fromSeat:3},{type:'buGang',fromSeat:1},{type:'peng',fromSeat:1}] with the same checks, preserving the listed order.
  for (const source of [
    {
      type: "mingGang",
      fromSeat: 0,
    },
    {
      type: "mingGang",
      fromSeat: 3,
    },
    {
      type: "buGang",
      fromSeat: 1,
    },
    {
      type: "peng",
      fromSeat: 1,
    },
  ]) {
    const game = structuredClone(original);
    game.lastDraw.kongSource = source;
    assert.throws(() => assertGameInvariants(game), /杠后补摸来源/);
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const ordinary = structuredClone(original);
  ordinary.lastDraw.source = "normal";
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  assert.throws(() => assertGameInvariants(ordinary), /杠后补摸来源/);
});
// 逐项覆盖 ['anGang','mingGang']；同一组检查用于每个样本，顺序以代码列出的集合为准。
// Exercise each entry in ['anGang','mingGang'] with the same checks, preserving the listed order.
// Scenario: new no-peng-upgrade rule still permits ${type} 4→5→6→7→8
for (const type of ["anGang", "mingGang"]) // 场景：新的禁止碰牌加杠规则仍允许 ${type} 从 4→5→6→7→8 扩杠
  test(`new no-peng-upgrade rule still permits ${type} 4→5→6→7→8`, () => {
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    let game = fixture({
      hand: [0, 1, 2, 3, 9, 10, 11, 12, 13, 16, 17],
      melds: [meld(0, type, 4)],
      head: [0, 0, 0, 6],
      drawTile: 0,
      rules: {
        allowPungUpgrade: false,
      },
    });
    // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
    // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
    // 逐项覆盖 [5,6,7,8]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in [5,6,7,8] with the same checks, preserving the listed order.
    for (const count of [5, 6, 7, 8]) {
      assert.ok(
        actions(game).some(
          (action) => action.type === "addGang" && action.tile === 0,
        ),
      );
      assert.equal(
        actions(game).some((action) => action.type === "buGang"),
        false,
      );
      game = doAction(game, "addGang", 0);
      assert.equal(game.players[0].melds[0].tiles.length, count);
      assert.equal(game.players[0].melds[0].type, type);
      assert.deepEqual(
        game.players.map((player) => player.score),
        [2 * (count - 4), -(count - 4), -(count - 4)],
      );
      assert.equal(game.pendingKongRadishes, count - 4);
      // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
      // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
      assertGameInvariants(game);
    }
    assert.equal(
      actions(game).some(
        (action) => action.type === "addGang" && action.tile === 0,
      ),
      false,
    );
  });
