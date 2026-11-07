// 七对、大单钓、清一色、碰碰胡及首胡冻结元数据。
// Seven pairs, big single, pure suit, all triplets and first-win frozen metadata.
// 阅读说明见 docs/TESTING-READING-GUIDE.md；固定种子与凭证仅为测试，不应移入真实用户数据。
// See docs/TESTING-READING-GUIDE.md; seeded data and test credentials must stay separate from real user data.
import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  applyAction,
  getPlayerView,
  getLegalActions,
  getWaitTiles,
  assertGameInvariants,
  getHuDiagnostic,
  fanToPoints,
} from "../shared/game.js";
const waiting = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
const winning = [...waiting, 17];
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
  firstHuRadishesRevealed = huCounts.some((count) => count > 0),
} = {}) {
  const game = createGame({
    seed: "fixture",
    rules: {
      allowPungUpgrade: true,
      turnDirection: "clockwise",
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
const seven = [0, 0, 2, 2, 4, 4, 6, 6, 9, 9, 11, 11, 13, 13];
const sevenBase = seven.slice(0, -1);
const quietTail = [8, 8, 8, 15, 15, 15];
// 筛选当前场景中的合法动作或已提交事件，不修改原始历史。
// Select legal actions or committed events for the scenario without mutating source history.
const huEvents = (game, seat = 0) =>
  game.history.filter((event) => event.type === "hu" && event.seat === seat);
const baseHand = (game, seat = 0) => {
  const hand = [...game.players[seat].hand];
  // 计算固定底手时剔除该座位本次摸入的一张，避免把新牌误算进冻结手牌。
  // Remove this seat’s newly drawn tile when deriving its fixed base hand, rather than counting it as frozen.
  if (game.lastDraw?.seat === seat)
    hand.splice(hand.indexOf(game.lastDraw.tile), 1);
  return hand;
};
// 通过真实七对胡牌动作取得首胡元数据，供后续重复胡场景复用。
// Obtain first-win metadata through a real seven-pairs hu action for later repeat-win scenarios.
function sevenPattern() {
  return doAction(
    fixture({
      hands: [seven, waiting, waiting],
      drawTile: 13,
      head: [2],
      tail: quietTail,
    }),
    0,
    "hu",
  ).players[0].firstHuPattern;
}
// 复制首胡牌型元数据到指定夹具座位并检查不变量；这是原地修改测试状态。
// Copy first-win pattern metadata onto a fixture seat and validate invariants; this mutates test state in place.
function setPattern(game, seat, pattern) {
  game.players[seat].firstHuPattern = structuredClone(pattern);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
  return game;
}
// 场景：新特殊规则必须显式启用，缺少开关的已存房间保留旧计分且无新增元数据
// Scenario: new special rules are explicit; stored rooms without the flag keep legacy scoring and no metadata
test("new special rules are explicit; stored rooms without the flag keep legacy scoring and no metadata", () => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(
    createGame({
      seed: 1,
    }).rules.specialHuPatterns,
    true,
  );
  assert.throws(() =>
    createGame({
      rules: {
        specialHuPatterns: "yes",
      },
    }),
  );
  // 逐项覆盖 [false,true]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [false,true] with the same checks, preserving the listed order.
  for (const absent of [false, true]) {
    const source = fixture({
      hands: [[17, 17], waiting, waiting],
      melds: [[meld(0), meld(3), meld(9), meld(12)], [], []],
      drawTile: 17,
      head: [17],
      tail: quietTail,
      rules: {
        specialHuPatterns: false,
      },
    });
    // 缺失字段场景删除字段，验证旧存档兼容默认值而不是新局创建默认值。
    // Delete the field in the absence case to exercise saved-game compatibility defaults.
    if (absent) delete source.rules.specialHuPatterns;
    const original = structuredClone(source);
    const game = doAction(source, 0, "hu");
    assert.deepEqual(source, original);
    assert.equal(huEvent(game).score.total, 50);
    assert.equal(huEvent(game).score.overlapPolicy, "exclusive");
    assert.equal(huEvent(game).score.patternBonuses, undefined);
    assert.equal(game.players[0].firstHuPattern, null);
    assert.equal(getPlayerView(game, 0).specialHuPattern, undefined);
  }
});
// 场景：七对仅在首胡后将原有七种牌全部扩为听口，并保持冻结手牌
// Scenario: seven pairs expands all seven original tile types only after first hu and retains the frozen hand
test("seven pairs expands all seven original tile types only after first hu and retains the frozen hand", () => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(getWaitTiles(sevenBase), [13]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const before = fixture({
    hands: [[...sevenBase, 2], waiting, waiting],
    drawTile: 2,
  });
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  assert.equal(has(before, 0, "hu"), false);
  assert.equal(getHuDiagnostic(before, 0).code, "SHAPE");
  // 逐项覆盖 [0,2,4,6,9,11,13]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [0,2,4,6,9,11,13] with the same checks, preserving the listed order.
  for (const tile of [0, 2, 4, 6, 9, 11, 13]) {
    let game = fixture({
      hands: [seven, waiting, waiting],
      drawTile: 13,
      head: [tile, 7],
      tail: quietTail,
    });
    game = doAction(game, 0, "hu");
    assert.equal(game.lastDraw.tile, tile);
    assert.equal(has(game, 0, "hu"), true);
    assert.equal(getHuDiagnostic(game, 0).code, "AVAILABLE");
    assert.deepEqual(getPlayerView(game, 0).waitTiles, [0, 2, 4, 6, 9, 11, 13]);
    assert.deepEqual(baseHand(game), sevenBase);
    game = doAction(game, 0, "hu");
    const score = huEvents(game).at(-1).score;
    assert.equal(score.fan, 3);
    assert.equal(score.fanPoints, 4);
    assert.equal(score.sevenPairsFixed, true);
    assert.equal(score.copyFanBonus, 0);
    assert.deepEqual(score.patternBonuses, [
      {
        type: "sevenPairs",
        fan: 3,
      },
    ]);
    assert.deepEqual(baseHand(game), sevenBase);
    assert.equal(game.players[0].winPile.at(-1).tile, tile);
    assert.equal(game.players[0].huCount, 2);
    // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
    // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
    assertGameInvariants(game);
  }
});
// 场景：七对之外的牌不会成为新听口，胡后会自动打出
// Scenario: seven-pairs outsiders are not newly accepted and are automatically discarded after hu
test("seven-pairs outsiders are not newly accepted and are automatically discarded after hu", () => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const game = doAction(
    fixture({
      hands: [seven, waiting, waiting],
      drawTile: 13,
      head: [7, 8],
      tail: quietTail,
    }),
    0,
    "hu",
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[0].huCount, 1);
  assert.ok(
    game.history.some(
      (event) =>
        event.type === "discard" &&
        event.seat === 0 &&
        event.tile === 7 &&
        event.automatic,
    ),
  );
  assert.deepEqual(
    game.players[0].firstHuPattern.waitTiles,
    [0, 2, 4, 6, 9, 11, 13],
  );
});
// 场景：七对固定档位依据首次完整十四张牌，识别四张、两组四张、六张及八张同牌
// Scenario: seven-pairs fixed tiers use the full initial 14 tiles for quads, two quads, six and eight copies
test("seven-pairs fixed tiers use the full initial 14 tiles for quads, two quads, six and eight copies", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const cases = [
    {
      hand: [0, 0, 0, 0, 2, 2, 4, 4, 6, 6, 9, 9, 11, 11],
      fan: 4,
      first: 0,
    },
    {
      hand: [0, 0, 0, 0, 2, 2, 4, 4, 6, 6, 9, 9, 11, 11],
      fan: 4,
      first: 11,
    },
    {
      hand: [0, 0, 0, 0, 2, 2, 2, 2, 4, 4, 9, 9, 11, 11],
      fan: 5,
      first: 0,
    },
    {
      hand: [0, 0, 0, 0, 0, 0, 2, 2, 4, 4, 9, 9, 11, 11],
      fan: 6,
      first: 0,
    },
    {
      hand: [0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 9, 9, 11, 11],
      fan: 8,
      first: 0,
    },
  ];
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  // 逐项覆盖 cases；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in cases with the same checks, preserving the listed order.
  for (const { hand, fan, first } of cases) {
    let game = doAction(
      fixture({
        hands: [hand, noZero, noZero],
        drawTile: first,
        head: [2, 7],
        tail: quietTail,
      }),
      0,
      "hu",
    );
    const metadata = structuredClone(game.players[0].firstHuPattern);
    assert.equal(metadata.fixedFan, fan);
    assert.deepEqual(metadata.waitTiles, [...new Set(hand)]);
    assert.equal(has(game, 0, "hu"), true);
    game = doAction(game, 0, "hu");
    assert.equal(huEvents(game).at(-1).score.fan, fan);
    assert.equal(huEvents(game).at(-1).score.fanPoints, fanToPoints(fan));
    assert.equal(huEvents(game).at(-1).score.copyFanBonus, 0);
    assert.deepEqual(game.players[0].firstHuPattern, metadata);
    // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
    // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
    assertGameInvariants(game);
  }
});
// 场景：再次七对的分档保持固定，同时累计胡牌及共享萝卜继续计分
// Scenario: repeat seven-pairs score remains fixed while accumulated wins and shared radishes still count
test("repeat seven-pairs score remains fixed while accumulated wins and shared radishes still count", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    hands: [seven, waiting, waiting],
    drawTile: 13,
    head: [13, 13, 13, 13],
    tail: [0, 8, 8, 15, 15, 15],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  for (let index = 0; index < 5; index++) game = doAction(game, 0, "hu");
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const later = huEvents(game).slice(1);
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 later；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in later with the same checks, preserving the listed order.
  for (const event of later) {
    assert.equal(event.score.fan, 3);
    assert.equal(event.score.fanPoints, 4);
    assert.equal(event.score.copyFanBonus, 0);
    assert.equal(event.score.radishBonus, 2);
    assert.equal(event.score.total, 6);
  }
  assert.equal(
    game.players[0].winPile.filter((win) => win.tile === 13).length,
    5,
  );
  assert.equal(game.players[0].firstHuPattern.fixedFan, 3);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：扩展听口在序列化后保留，私有视图不暴露他人首次胡牌牌型
// Scenario: expanded waits survive serialization and private views do not expose another player’s first shape
test("expanded waits survive serialization and private views do not expose another player’s first shape", () => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let game = doAction(
    fixture({
      hands: [seven, waiting, waiting],
      drawTile: 13,
      head: [2, 7],
      tail: quietTail,
    }),
    0,
    "hu",
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  game = JSON.parse(JSON.stringify(game));
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 0, "hu"), true);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const ownView = getPlayerView(game, 0);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(ownView.specialHuPattern, game.players[0].firstHuPattern);
  // 逐项覆盖 [1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [1,2] with the same checks, preserving the listed order.
  for (const seat of [1, 2]) {
    const otherView = getPlayerView(game, seat);
    assert.equal(otherView.specialHuPattern, null);
    assert.equal(otherView.players[0].firstHuPattern, undefined);
    assert.equal(otherView.players[0].specialHuPattern, undefined);
    assert.equal(otherView.players[0].hand, undefined);
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  ownView.specialHuPattern.waitTiles.push(17);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[0].firstHuPattern.waitTiles.includes(17), false);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(huEvents(game).at(-1).score.sevenPairsFixed, true);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：扩展听口荣胡忽略过期锁，同时保留来源保护及杠后弃牌例外
// Scenario: expanded discard hu ignores stale locks but preserves protected sources and the kong-discard exception
test("expanded discard hu ignores stale locks but preserves protected sources and the kong-discard exception", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const pattern = sevenPattern();
  const pengTwo = waiting.map((tile, index) => (index === 0 ? 2 : tile));
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 下列集合；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in the following collection with the same checks, preserving the listed order.
  for (const scenario of [
    {
      locked: false,
      sourceHu: false,
      afterKong: false,
      allowed: true,
    },
    {
      locked: true,
      sourceHu: false,
      afterKong: false,
      allowed: true,
    },
    {
      locked: true,
      sourceHu: true,
      afterKong: true,
      allowed: true,
    },
    {
      locked: false,
      sourceHu: true,
      afterKong: false,
      allowed: false,
    },
  ]) {
    let game = fixture({
      hands: [[...waiting, 2], sevenBase, pengTwo],
      drawTile: 2,
      head: [7],
      huCounts: [Number(scenario.sourceHu), 1, 0],
      priorWins: [scenario.sourceHu ? [17] : [], [13], []],
      locks: [[], pattern.waitTiles, []],
      activeLocks: [false, scenario.locked, false],
      kongSeats: scenario.afterKong ? [0] : [],
    });
    setPattern(game, 1, pattern);
    game = doAction(game, 0, "discard", 2);
    const claimHu =
      game.phase === "claim" &&
      getLegalActions(game, 1).some((action) => action.type === "hu");
    assert.equal(claimHu, scenario.allowed);
    // 允许的变体检查可执行动作；不允许的变体检查拒绝，不能共用同一预期。
    // Allowed variants check execution; disallowed variants check rejection rather than sharing one expectation.
    if (scenario.allowed)
      assert.equal(getHuDiagnostic(game, 1).code, "AVAILABLE");
    // 允许的变体检查可执行动作；不允许的变体检查拒绝，不能共用同一预期。
    // Allowed variants check execution; disallowed variants check rejection rather than sharing one expectation.
    if (scenario.allowed) {
      game = doAction(game, 1, "hu");
      game = passAll(game);
      const event = huEvent(game, 1);
      assert.equal(
        event.source,
        scenario.afterKong ? "kongDiscard" : "discard",
      );
      assert.equal(event.score.fan, 3);
    }
    // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
    // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
    assertGameInvariants(game);
  }
});
// 场景：同时两个扩展七对胡共享唯一实体弃牌，且保持各自固定分值
// Scenario: two simultaneous expanded seven-pairs wins share one physical discard and keep fixed scores
test("two simultaneous expanded seven-pairs wins share one physical discard and keep fixed scores", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const pattern = sevenPattern();
  let game = fixture({
    hands: [[...waiting, 2], sevenBase, sevenBase],
    drawTile: 2,
    head: [7],
    huCounts: [0, 1, 1],
    priorWins: [[], [13], [13]],
  });
  setPattern(game, 1, pattern);
  setPattern(game, 2, pattern);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "discard", 2);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 1, "hu"), true);
  assert.equal(has(game, 2, "hu"), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 2, "hu");
  game = doAction(game, 1, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(game.discards[0].huSeats, [1, 2]);
  assert.equal(game.players[1].winPile.at(-1).virtual, false);
  assert.equal(game.players[2].winPile.at(-1).virtual, true);
  assert.equal(huEvent(game, 1).score.fan, 3);
  assert.equal(huEvent(game, 2).score.fan, 3);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：大单吊将暗手听口及全部副露牌值扩为听口，不新增或合并副露
// Scenario: big single expands the concealed wait plus all meld types without creating or merging melds
test("big single expands the concealed wait plus all meld types without creating or merging melds", () => {
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 ['peng','anGang','mingGang','buGang']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['peng','anGang','mingGang','buGang'] with the same checks, preserving the listed order.
  for (const type of ["peng", "anGang", "mingGang", "buGang"]) {
    const groups = [meld(0, type), meld(3), meld(9), meld(12)];
    let game = fixture({
      hands: [[17, 17], waiting, waiting],
      melds: [groups, [], []],
      drawTile: 17,
      head: [0, 7],
      tail: quietTail,
    });
    game = doAction(game, 0, "hu");
    assert.deepEqual(getPlayerView(game, 0).waitTiles, [0, 3, 9, 12, 17]);
    assert.equal(has(game, 0, "hu"), true);
    assert.equal(has(game, 0, "buGang"), false); // A valid hu keeps the existing hu/pass priority.
    assert.equal(getHuDiagnostic(game, 0).code, "AVAILABLE");
    game = doAction(game, 0, "hu");
    const score = huEvents(game).at(-1).score;
    assert.equal(score.bigSingle, true);
    assert.equal(score.bigSinglePoints, 0);
    assert.equal(score.overlapPolicy, "fan");
    assert.deepEqual(score.patternBonuses, [
      {
        type: "bigSingle",
        fan: 2,
      },
    ]);
    assert.equal(score.copyFanBonus, type === "peng" ? 1 : 2);
    assert.equal(score.fan, type === "peng" ? 4 : 5);
    assert.deepEqual(game.players[0].melds, groups);
    assert.equal(game.players[0].melds.length, 4);
    assert.deepEqual(baseHand(game), [17]);
    // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
    // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
    assertGameInvariants(game);
  }
});
// 场景：大单吊与清一色可叠加，但大单吊与碰碰胡互斥
// Scenario: big single plus pure suit stacks but big single and all triplets are mutually exclusive
test("big single plus pure suit stacks but big single and all triplets are mutually exclusive", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const groups = [meld(0), meld(2), meld(4), meld(6)];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let game = doAction(
    fixture({
      hands: [[8, 8], waiting, waiting],
      melds: [groups, [], []],
      drawTile: 8,
      head: [0, 7],
      tail: [15, 15, 15, 16, 16, 16],
    }),
    0,
    "hu",
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let score = huEvents(game).at(-1).score;
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(score.fan, 5);
  assert.equal(score.total, 10);
  assert.deepEqual(score.patternBonuses, [
    {
      type: "bigSingle",
      fan: 2,
    },
    {
      type: "pureSuit",
      fan: 2,
    },
  ]);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  score = huEvents(game).at(-1).score;
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(score.fan, 6);
  assert.equal(score.total, 12);
  assert.equal(score.copyFanBonus, 1);
  assert.deepEqual(score.patternBonuses, [
    {
      type: "bigSingle",
      fan: 2,
    },
    {
      type: "pureSuit",
      fan: 2,
    },
  ]);
});
// 场景：清一色与碰碰胡各加两番，除大单吊外可互相叠加
// Scenario: pure suit and all triplets each add two fan and can stack outside big single
test("pure suit and all triplets each add two fan and can stack outside big single", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const cases = [
    {
      hand: [0, 1, 2, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8],
      patterns: [
        {
          type: "pureSuit",
          fan: 2,
        },
      ],
      fan: 3,
    },
    {
      hand: [0, 0, 0, 2, 2, 2, 9, 9, 9, 11, 11, 11, 17, 17],
      patterns: [
        {
          type: "allTriplets",
          fan: 2,
        },
      ],
      fan: 3,
    },
    {
      hand: [0, 0, 0, 2, 2, 2, 4, 4, 4, 6, 6, 6, 8, 8],
      patterns: [
        {
          type: "allTriplets",
          fan: 2,
        },
        {
          type: "pureSuit",
          fan: 2,
        },
      ],
      fan: 5,
    },
    {
      hand: winning,
      patterns: [],
      fan: 1,
    },
  ];
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 cases；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in cases with the same checks, preserving the listed order.
  for (const { hand, patterns, fan } of cases) {
    const game = doAction(
      fixture({
        hands: [hand, waiting, waiting],
        drawTile: hand.at(-1),
        head: [7],
        tail: [15, 15, 15, 16, 16, 16],
      }),
      0,
      "hu",
    );
    const score = huEvent(game).score;
    assert.equal(score.fan, fan);
    assert.equal(score.fanPoints, fanToPoints(fan));
    assert.deepEqual(score.patternBonuses, patterns);
    // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
    // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
    assertGameInvariants(game);
  }
});
// 场景：同种牌可通过真实动作碰两次，且保持两组独立副露
// Scenario: the same tile can be penged twice through real actions and remains two independent melds
test("the same tile can be penged twice through real actions and remains two independent melds", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    hands: [
      [0, ...waiting],
      [0, 0, 0, 0, 1, 2, 3, 5, 6, 9, 10, 13, 15],
      waiting,
    ],
    drawTile: 0,
    head: [7, 0],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "discard", 0);
  game = doAction(game, 1, "peng", 0);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  game = passAll(game);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = passAll(doAction(game, 1, "discard", 15));
  game = passAll(doAction(game, 2, "discard", 7));
  game = doAction(game, 0, "discard", 0);
  game = doAction(game, 1, "peng", 0);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  game = passAll(game);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[1].melds.length, 2);
  assert.ok(
    game.players[1].melds.every(
      (group) =>
        group.type === "peng" && group.tile === 0 && group.tiles.length === 3,
    ),
  );
  assert.equal(
    game.history.filter((event) => event.type === "peng" && event.seat === 1)
      .length,
    2,
  );
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：重复碰牌计为六张实体牌，但仅增加一种扩展听口
// Scenario: duplicate pengs count six physical tiles but only one expanded wait type
test("duplicate pengs count six physical tiles but only one expanded wait type", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const groups = [meld(0), meld(0), meld(9), meld(12)];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let game = doAction(
    fixture({
      hands: [[17, 17], noZero, noZero],
      melds: [groups, [], []],
      drawTile: 17,
      head: [0, 7],
      tail: quietTail,
    }),
    0,
    "hu",
  );
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(huEvent(game).score.copyFanBonus, 3);
  assert.equal(huEvent(game).score.fan, 6);
  assert.deepEqual(getPlayerView(game, 0).waitTiles, [0, 9, 12, 17]);
  assert.equal(has(game, 0, "hu"), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(game.players[0].melds, groups);
  assert.equal(game.players[0].winPile.at(-1).tile, 0);
  assert.equal(huEvents(game).at(-1).score.copyFanBonus, 4); // Seven logical copies now add the confirmed four fan.
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：再次七对的胡牌增加萝卜匹配数，不改变固定番数
// Scenario: repeated seven-pairs winning tiles add radish matches without changing the fixed fan
test("repeated seven-pairs winning tiles add radish matches without changing the fixed fan", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    hands: [seven, waiting, waiting],
    drawTile: 13,
    head: [2, 2, 7],
    tail: [2, 8, 8, 15, 15, 15],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  game = doAction(game, 0, "hu");
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(huEvents(game).at(-1).score.radishBonus, 3);
  assert.equal(huEvents(game).at(-1).score.total, 7);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(huEvents(game).at(-1).score.radishBonus, 4);
  assert.equal(huEvents(game).at(-1).score.total, 8);
  assert.equal(huEvents(game).at(-1).score.fan, 3);
  assert.equal(huEvents(game).at(-1).score.copyFanBonus, 0);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：扩展听口排除本人各牌区已占满八张的第九张实体同牌
// Scenario: expanded waits exclude a ninth physical copy already fully accounted in own zones
test("expanded waits exclude a ninth physical copy already fully accounted in own zones", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 9, 9, 11, 11];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const game = doAction(
    fixture({
      hands: [hand, noZero, noZero],
      drawTile: 0,
      head: [2],
      tail: quietTail,
    }),
    0,
    "hu",
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(game.players[0].firstHuPattern.waitTiles, [0, 2, 9, 11]);
  assert.deepEqual(getPlayerView(game, 0).waitTiles, [2, 9, 11]);
  assert.equal(game.players[0].firstHuPattern.fixedFan, 8);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：普通首胡后可在合法第四杠后激活大单吊再次胡牌
// Scenario: a standard first win can later activate big-single repeats after a legal fourth kong
test("a standard first win can later activate big-single repeats after a legal fourth kong", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    hands: [[0, 0, 0, 17, 17], waiting, waiting],
    melds: [[meld(3), meld(9), meld(12)], [], []],
    drawTile: 17,
    head: [0, 17, 9, 7],
    tail: quietTail,
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[0].firstHuPattern.kind, "standard");
  assert.equal(has(game, 0, "anGang", 0), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "anGang", 0);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.lastDraw.tile, 17);
  assert.equal(has(game, 0, "hu"), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[0].firstHuPattern.kind, "bigSingle");
  assert.deepEqual(getPlayerView(game, 0).waitTiles, [0, 3, 9, 12, 17]);
  assert.equal(game.lastDraw.tile, 9);
  assert.equal(has(game, 0, "hu"), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[0].huCount, 3);
  assert.equal(game.players[0].melds.length, 4);
  assert.deepEqual(baseHand(game), [17]);
  assert.equal(huEvents(game).at(-1).score.specialHuPattern, "bigSingle");
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：先前普通胡牌后，即使结构听口重叠，仍可激活首次七对胡牌
// Scenario: a first seven-pairs win can activate after an earlier standard win with overlapping structural waits
test("a first seven-pairs win can activate after an earlier standard win with overlapping structural waits", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const base = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6];
  let game = fixture({
    hands: [[...base, 0], waiting, waiting],
    drawTile: 0,
    head: [6, 1, 7],
    tail: quietTail,
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[0].firstHuPattern.kind, "standard");
  assert.equal(game.lastDraw.tile, 6);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[0].firstHuPattern.kind, "sevenPairs");
  assert.equal(game.players[0].firstHuPattern.sevenPairsFan, 3);
  assert.equal(game.players[0].firstHuPattern.fixedFan, 5);
  assert.equal(huEvents(game).at(-1).score.fan, 5);
  assert.equal(huEvents(game).at(-1).score.sevenPairsFixed, true);
  assert.deepEqual(getPlayerView(game, 0).waitTiles, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(game.lastDraw.tile, 1);
  assert.equal(has(game, 0, "hu"), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "hu");
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(huEvents(game).at(-1).score.sevenPairsFixed, true);
  assert.deepEqual(baseHand(game), base);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：以大单吊副露牌值荣胡时保留原付款策略，且胡牌仅计一次
// Scenario: big-single meld-type discard wins retain the existing payer policy and count the tile once
test("big-single meld-type discard wins retain the existing payer policy and count the tile once", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const groups = [meld(0), meld(3), meld(9), meld(12)];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const first = doAction(
    fixture({
      hands: [[17, 17], waiting, waiting],
      melds: [groups, [], []],
      drawTile: 17,
      head: [17],
      tail: quietTail,
    }),
    0,
    "hu",
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let game = fixture({
    hands: [[...waiting, 0], [17], waiting],
    melds: [[], groups, []],
    drawTile: 0,
    huCounts: [0, 1, 0],
    priorWins: [[], [17], []],
    head: [7],
  });
  setPattern(game, 1, first.players[0].firstHuPattern);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "discard", 0);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(has(game, 1, "hu"), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 1, "hu");
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const event = huEvent(game, 1);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.equal(event.source, "discard");
  assert.equal(event.score.copyFanBonus, 1);
  assert.equal(event.score.fan, 4);
  assert.equal(event.score.total, 8);
  assert.deepEqual(event.payments, [
    {
      seat: 0,
      delta: -8,
    },
    {
      seat: 2,
      delta: -8,
    },
    {
      seat: 1,
      delta: 16,
    },
  ]);
  assert.deepEqual(game.players[1].melds, groups);
  assert.equal(game.players[1].winPile.at(-1).discardIndex, 0);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：碰碰胡识别支持重复同值刻子，不将顺子误判为刻子
// Scenario: all-triplets detection supports repeated identical triplets without mistaking a sequence for a triplet
test("all-triplets detection supports repeated identical triplets without mistaking a sequence for a triplet", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 0, 0, 0, 0, 0, 9, 9, 9, 11, 11, 11, 17, 17];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const game = doAction(
    fixture({
      hands: [hand, noZero, noZero],
      drawTile: 17,
      head: [7],
      tail: quietTail,
    }),
    0,
    "hu",
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const score = huEvent(game).score;
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(score.specialHuPattern, null);
  assert.deepEqual(score.patternBonuses, [
    {
      type: "allTriplets",
      fan: 2,
    },
  ]);
  assert.equal(score.copyFanBonus, 3);
  assert.equal(score.fan, 6);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：关闭七对后，即使牌型也能以碰碰胡成胡，也不激活七对元数据
// Scenario: disabling seven pairs does not activate its metadata on a shape that can also win as all triplets
test("disabling seven pairs does not activate its metadata on a shape that can also win as all triplets", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 0, 0, 0, 0, 0, 9, 9, 9, 9, 9, 9, 17, 17];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const game = doAction(
    fixture({
      hands: [hand, noZero, noZero],
      drawTile: 17,
      head: [7],
      tail: quietTail,
      rules: {
        sevenPairs: false,
      },
    }),
    0,
    "hu",
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const score = huEvent(game).score;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.players[0].firstHuPattern.kind, "standard");
  assert.equal(score.sevenPairsFixed, false);
  assert.deepEqual(score.patternBonuses, [
    {
      type: "allTriplets",
      fan: 2,
    },
  ]);
  assert.equal(score.copyFanBonus, 6);
  assert.equal(score.fan, 9);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：七对首胡与后续再次胡牌冻结已确认的档位及首次清一色奖励
// Scenario: seven-pairs first win and repeats freeze the confirmed tier plus the initial pure-suit bonus
test("seven-pairs first win and repeats freeze the confirmed tier plus the initial pure-suit bonus", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const cases = [
    {
      hand: seven,
      first: 13,
      tier: 3,
      fan: 3,
      points: 4,
      pure: false,
    },
    {
      hand: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6],
      first: 6,
      tier: 3,
      fan: 5,
      points: 10,
      pure: true,
    },
    {
      hand: [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5],
      first: 0,
      tier: 4,
      fan: 6,
      points: 12,
      pure: true,
    },
    {
      hand: [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 4],
      first: 0,
      tier: 5,
      fan: 7,
      points: 14,
      pure: true,
    },
    {
      hand: [0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4],
      first: 0,
      tier: 6,
      fan: 8,
      points: 16,
      pure: true,
    },
    {
      hand: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3],
      first: 0,
      tier: 8,
      fan: 10,
      points: 20,
      pure: true,
    },
    // This also has an all-triplets decomposition; the fixed seven-pairs mode does not add it.
    {
      hand: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2],
      first: 0,
      tier: 9,
      fan: 11,
      points: 22,
      pure: true,
    },
  ];
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  // 逐项覆盖 cases；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in cases with the same checks, preserving the listed order.
  for (const { hand, first, tier, fan, points, pure } of cases) {
    const repeat = hand.at(-1);
    let game = fixture({
      hands: [hand, noZero, noZero],
      drawTile: first,
      head: [repeat, repeat, 7],
      tail: [15, 15, 15, 16, 16, 16],
    });
    const expectedBase = [...hand];
    expectedBase.splice(expectedBase.indexOf(first), 1);
    let savedPattern;
    for (let index = 0; index < 3; index++) {
      game = doAction(game, 0, "hu");
      const score = huEvents(game).at(-1).score;
      assert.equal(score.sevenPairsFixed, true);
      assert.equal(score.fan, fan);
      assert.equal(score.fanPoints, points);
      assert.equal(score.total, points);
      assert.equal(score.copyFanBonus, 0);
      assert.deepEqual(score.patternBonuses, [
        {
          type: "sevenPairs",
          fan: tier,
        },
        ...(pure
          ? [
              {
                type: "pureSuit",
                fan: 2,
              },
            ]
          : []),
      ]);
      assert.equal(game.players[0].firstHuPattern.sevenPairsFan, tier);
      assert.equal(game.players[0].firstHuPattern.fixedFan, fan);
      assert.equal(game.players[0].firstHuPattern.pureSuit, pure);
      assert.deepEqual(baseHand(game), expectedBase);
      // 仅在场景提供旧牌型元数据时注入，区分首次建立与已有冻结结果。
      // Inject saved pattern metadata only when supplied, distinguishing first capture from frozen state.
      if (savedPattern)
        assert.deepEqual(game.players[0].firstHuPattern, savedPattern);
      else savedPattern = structuredClone(game.players[0].firstHuPattern);
      game = JSON.parse(JSON.stringify(game));
      // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
      // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
      assertGameInvariants(game);
    }
  }
});
// 场景：清一色七对保持五番，后续胡牌仅增加共享萝卜分
// Scenario: pure seven pairs keeps five fan while repeat winning tiles increase shared-radish points
test("pure seven pairs keeps five fan while repeat winning tiles increase shared-radish points", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6];
  let game = fixture({
    hands: [hand, waiting, waiting],
    drawTile: 6,
    head: [2, 2, 7],
    tail: [2, 8, 8, 15, 15, 15],
  });
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 [2,3,4]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [2,3,4] with the same checks, preserving the listed order.
  for (const expectedRadish of [2, 3, 4]) {
    game = doAction(game, 0, "hu");
    const score = huEvents(game).at(-1).score;
    assert.equal(score.fan, 5);
    assert.equal(score.fanPoints, 10);
    assert.equal(score.copyFanBonus, 0);
    assert.equal(score.radishBonus, expectedRadish);
    assert.equal(score.total, 10 + expectedRadish);
    assert.deepEqual(score.patternBonuses, [
      {
        type: "sevenPairs",
        fan: 3,
      },
      {
        type: "pureSuit",
        fan: 2,
      },
    ]);
    // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
    // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
    assertGameInvariants(game);
  }
});
// 场景：同时首次清一色七对荣胡各自冻结五番，不重复实体牌
// Scenario: simultaneous first pure-seven-pairs discard wins each freeze five fan without duplicating the tile
test("simultaneous first pure-seven-pairs discard wins each freeze five fan without duplicating the tile", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const base = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6];
  let game = fixture({
    hands: [[...waiting, 6], base, base],
    drawTile: 6,
    head: [7],
    tail: [15, 15, 15, 16, 16, 16],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game = doAction(game, 0, "discard", 6);
  game = doAction(game, 2, "hu");
  game = doAction(game, 1, "hu");
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 [1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [1,2] with the same checks, preserving the listed order.
  for (const seat of [1, 2]) {
    const score = huEvent(game, seat).score;
    assert.equal(score.fan, 5);
    assert.equal(score.total, 10);
    assert.equal(score.sevenPairsFixed, true);
    assert.equal(game.players[seat].firstHuPattern.sevenPairsFan, 3);
    assert.equal(game.players[seat].firstHuPattern.fixedFan, 5);
  }
  assert.equal(game.players[1].winPile[0].virtual, false);
  assert.equal(game.players[2].winPile[0].virtual, true);
  assert.deepEqual(game.discards[0].huSeats, [1, 2]);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：牌型规则引入前保存的房间不获得新的首胡或清一色七对计分
// Scenario: stored pre-pattern rooms do not gain the new first-win or pure-seven-pairs scoring
test("stored pre-pattern rooms do not gain the new first-win or pure-seven-pairs scoring", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6];
  const source = fixture({
    hands: [hand, waiting, waiting],
    drawTile: 6,
    head: [7],
    tail: [15, 15, 15, 16, 16, 16],
    rules: {
      specialHuPatterns: false,
    },
  });
  delete source.rules.specialHuPatterns;
  const before = structuredClone(source);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const game = doAction(source, 0, "hu");
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  assert.deepEqual(source, before);
  assert.equal(huEvent(game).score.fan, 1);
  assert.equal(huEvent(game).score.total, 1);
  assert.equal(huEvent(game).score.sevenPairsFixed, undefined);
  assert.equal(game.players[0].firstHuPattern, null);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});

// 七对在杠后接炮及补摸场景仍沿用首次固定档位，不随事件或胡牌区积累升番。
// Seven pairs keeps its first fixed tier for post-kong claims and replacement draws, without event or win-pile growth.
for (const snapshot of [true, false, 'absent']) {
  for (const repeated of [false, true]) {
    test(`seven pairs fixed tier with kong events: snapshot=${snapshot}, repeat=${repeated}`, () => {
      let game = fixture({
        hands: [seven, waiting, waiting],
        drawKind: 'replacement',
        drawTile: 13,
        huCounts: [repeated ? 1 : 0, 0, 0],
        priorWins: [repeated ? [13] : [], [], []],
        head: [13, 8],
        firstHuRadishesRevealed: true,
      });
      if (snapshot === 'absent') delete game.rules.kongEventFan;
      else game.rules.kongEventFan = snapshot;
      if (repeated) {
        game.players[0].firstHuPattern = {
          kind: 'sevenPairs', pureSuit: false, allTriplets: false,
          waitTiles: [...new Set(seven)], sevenPairsFan: 3, fixedFan: 3,
        };
      }
      game = doAction(JSON.parse(JSON.stringify(game)), 0, 'hu');
      assert.equal(huEvent(game).score.fan, 3);
      assert.equal(huEvent(game).score.kongReplacementBonus, undefined);
      assert.equal(game.players[0].firstHuPattern.fixedFan, 3);
      game = doAction(game, 0, 'hu');
      assert.equal(huEvents(game).at(-1).score.fan, 3);
      assertGameInvariants(game);
    });
  }
}

// 首次及再次七对接杠后炮都不能改变固定番；真正的弃牌窗口仍只由出牌者付款。
// First/repeated seven-pairs post-kong claims keep fixed fan; the real claim window still charges only the discarder.
for (const repeated of [false, true]) {
  test(`seven pairs post-kong discard retains fixed tier: repeat=${repeated}`, () => {
    let game = fixture({
      hands: [[...waiting, 13], sevenBase, waiting],
      drawTile: 13,
      huCounts: [0, repeated ? 1 : 0, 0],
      priorWins: [[], repeated ? [13] : [], []],
      kongSeats: [0],
      head: [8],
      firstHuRadishesRevealed: true,
    });
    if (repeated) {
      game.players[1].firstHuPattern = {
        kind: 'sevenPairs', pureSuit: false, allTriplets: false,
        waitTiles: [...new Set(seven)], sevenPairsFan: 3, fixedFan: 3,
      };
    }
    game = doAction(game, 0, 'discard', 13);
    game = passAll(doAction(JSON.parse(JSON.stringify(game)), 1, 'hu'));
    const event = huEvent(game, 1);
    assert.equal(event.source, 'kongDiscard');
    assert.equal(event.score.fan, 3);
    assert.equal(event.score.kongDiscardBonus, undefined);
    assert.deepEqual(event.payments.filter(payment => payment.delta < 0).map(payment => payment.seat), [0]);
    assertGameInvariants(game);
  });
}
