// 阅读说明见 docs/TESTING-READING-GUIDE.md；固定种子与凭证仅为测试，不应移入真实用户数据。
// See docs/TESTING-READING-GUIDE.md; seeded data and test credentials must stay separate from real user data.
// 碰后先打一次牌，之后正常操作窗口允许用已持有的第四张补杠；v0.7.0 错误的 false 由兼容逻辑纠正。
// Discard once after peng, then permit a held fourth tile in a later normal action window; compatibility logic corrects the mistaken v0.7.0 false.
import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  applyAction,
  getLegalActions,
  getPlayerView,
  assertGameInvariants,
} from "../shared/game.js";
import { postHuKongGame } from "./fixtures/post-hu-kong.js";
import {
  pungUpgradeGame as fixture,
  takePeng,
} from "./fixtures/pung-upgrade.js";
const waiting = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
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
// 查询真实引擎给出的合法动作，匹配当前辅助函数接收的类型与可选牌面。
// Query actual engine legal actions using the helper’s type and optional tile criteria.
const has = (game, seat, type) =>
  getLegalActions(game, seat).some((action) => action.type === type);
// 让尚未回应的合法座位依次过牌，直到反应窗关闭；每一步使用返回的新状态。
// Pass each remaining eligible responder until the claim window closes, carrying forward each returned state.
function passAll(game) {
  // 持续推进场景直到 game.phase==='claim' 不再成立；循环内的动作/断言负责保证进展。
  // Advance while game.phase==='claim' holds; actions/assertions inside are responsible for progress.
  while (game.phase === "claim") {
    const seat = game.claim.eligibleSeats.find(
      (other) => !game.claim.responses[other],
    );
    game = move(game, seat, "pass");
  }
  return game;
}

/** Real conserved hands and wall; all peng/kong transitions below use applyAction. */
// 按本文件的参数构造场景；规则版本、手牌与牌墙由各测试显式选择。不要把 UI 快照误当成完整引擎状态。
// Build the local scenario from its parameters; each test chooses rules, hands and wall. A UI snapshot is not a complete engine state.

// 验证补杠可见且可执行，完成反应后核对四张副露、杠次数、历史和守恒。
// Verify upgrade availability/execution, then check four-tile meld, kong count, history and conservation.
function assertUpgrade(game, seat, tile) {
  assert.ok(
    getPlayerView(game, seat).legalActions.some(
      (action) => action.type === "buGang" && action.tile === tile,
    ),
  );
  const upgraded = passAll(move(game, seat, "buGang", tile));
  assert.equal(upgraded.players[seat].melds[0].type, "buGang");
  assert.deepEqual(upgraded.players[seat].melds[0].tiles, Array(4).fill(tile));
  assert.equal(upgraded.players[seat].kongCount, 1);
  assert.equal(
    upgraded.history.filter((event) => event.type === "buGang").length,
    1,
  );
  assertGameInvariants(upgraded);
  return upgraded;
}
// 先碰但不持有第四张，推进其他两席的真实回合，再验证自然摸到相同牌。
// Peng without the fourth copy, advance two other seats through real turns, then verify a natural matching draw.
function afterMatchingDraw(game) {
  game = takePeng(game);
  assert.equal(has(game, 1, "buGang"), false); // No fourth tile yet.
  game = passAll(move(game, 1, "discard", 16));
  for (let turn = 0; turn < 2; turn++) {
    assert.notEqual(game.currentSeat, 1);
    assert.equal(game.lastDraw.tile, 15);
    game = passAll(move(game, game.currentSeat, "discard", 15));
  }
  assert.equal(game.currentSeat, 1);
  assert.equal(game.lastDraw.source, "normal");
  assert.equal(game.lastDraw.tile, 0);
  return game;
}
// 同时检查合法动作与伪造提交均禁止补杠，并核对输入状态完全没变。
// Check both legal-action listing and forged submission reject an upgrade, with the input state unchanged.
function assertNoUpgrade(game, seat, tile) {
  const before = structuredClone(game);
  assert.equal(has(game, seat, "buGang"), false);
  assert.equal(
    getPlayerView(game, seat).legalActions.some(
      (action) => action.type === "buGang",
    ),
    false,
  );
  assert.throws(() => move(game, seat, "buGang", tile));
  assert.deepEqual(game, before); // A forged old-client action has no side effects.
  assert.equal(game.players[seat].melds[0].type, "peng");
  assert.equal(game.players[seat].melds[0].tiles.length, 3);
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
}
// 场景：新牌局禁止刚碰牌后立即用原已持有的第四张加杠
// Scenario: new games prohibit upgrading a real peng immediately with an already-held fourth tile
test("new games prohibit upgrading a real peng immediately with an already-held fourth tile", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const initial = fixture({
    heldFourth: true,
  });
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.equal(initial.rules.allowPungUpgrade, true);
  assert.equal(initial.rules.pungUpgradeAfterDiscard, true);
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  const game = takePeng(initial);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(game.lastDraw, null);
  assert.ok(game.players[1].hand.includes(0));
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assertNoUpgrade(game, 1, 0);
  assert.ok(has(game, 1, "discard"));
});
// 场景：新局真实碰牌后先打一次，之后摸到同牌时允许补杠
// Scenario: new games allow upgrading a real peng after its discard and a later matching draw
test("new games allow upgrading a real peng after its discard and a later matching draw", () => {
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assertUpgrade(afterMatchingDraw(fixture()), 1, 0);
});
for (const policy of ["missing", true]) {
  const setPolicy = (game) => {
    delete game.rules.pungUpgradeAfterDiscard;
    // 删除字段模拟真正的旧存档；缺字段与显式 true 都要独立覆盖。
    // Delete the field to model an actual old save; absence and explicit true need separate coverage.
    if (policy === "missing") delete game.rules.allowPungUpgrade;
    else game.rules.allowPungUpgrade = true;
    return JSON.parse(JSON.stringify(game));
  };
  // 场景：已保存的 allowPungUpgrade=${policy} 保留立即及后续碰牌加杠
  // Scenario: saved allowPungUpgrade=${policy} preserves immediate and later peng upgrades
  test(`saved allowPungUpgrade=${policy} preserves immediate and later peng upgrades`, () => {
    // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
    // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
    assertUpgrade(
      takePeng(
        setPolicy(
          fixture({
            heldFourth: true,
          }),
        ),
      ),
      1,
      0,
    );
    assertUpgrade(afterMatchingDraw(setPolicy(fixture())), 1, 0);
  });
  // 场景：已保存的 allowPungUpgrade=${policy} 在两种出牌模式下均保留胡后强制加杠
  // Scenario: saved allowPungUpgrade=${policy} preserves mandatory post-hu upgrade in both discard modes
  test(`saved allowPungUpgrade=${policy} preserves mandatory post-hu upgrade in both discard modes`, () => {
    // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
    // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
    // 逐项覆盖 [true,false]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in [true,false] with the same checks, preserving the listed order.
    for (const autoDiscardAfterHu of [true, false]) {
      const game = setPolicy(postHuKongGame());
      game.rules.autoDiscardAfterHu = autoDiscardAfterHu;
      assert.deepEqual(getLegalActions(game, 0), [
        {
          type: "buGang",
          tile: 2,
        },
      ]);
      assertUpgrade(game, 0, 2);
    }
  });
}
// 场景：纠正规则在两种打牌模式恢复合法胡后补杠，也适用于 v0.7.0 房间
// Scenario: corrected policy restores legal post-hu upgrade in both discard modes, including v0.7.0 rooms
test("corrected policy restores legal post-hu upgrade in both discard modes, including v0.7.0 rooms", () => {
  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  for (const autoDiscardAfterHu of [true, false])
    for (const oldRoom of [true, false]) {
      const game = postHuKongGame();
      // 删除新版标记并保留 v0.7.0 的 false，验证纠正逻辑能识别旧历史而不依赖新字段。
      // Remove new markers while retaining v0.7.0 false, exercising correction from old history rather than new fields.
      if (oldRoom) {
        game.rules.allowPungUpgrade = false;
        delete game.rules.pungUpgradeAfterDiscard;
        delete game.players[0].pendingPungDiscard;
      }
      game.rules.autoDiscardAfterHu = autoDiscardAfterHu;
      assert.deepEqual(getLegalActions(game, 0), [
        {
          type: "buGang",
          tile: 2,
        },
      ]);
      assertUpgrade(game, 0, 2);
    }
});
// 场景：新规则仍允许真正已有的四张杠扩为五张
// Scenario: the new rule preserves extending an existing true kong from four tiles to five
test("the new rule preserves extending an existing true kong from four tiles to five", () => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 逐项覆盖 [0,1]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [0,1] with the same checks, preserving the listed order.
  for (const huCount of [0, 1]) {
    const game = postHuKongGame({
      type: "addGang",
      huCount,
    });
    game.rules.allowPungUpgrade = false;
    assert.ok(has(game, 0, "addGang"));
    const next = passAll(move(game, 0, "addGang", 2));
    assert.equal(next.players[0].melds[0].tiles.length, 5);
    assert.equal(next.players[0].melds[0].extended, true);
    assertGameInvariants(next);
  }
});
// 场景：旧规则允许的碰牌加杠仍须让位于同时可自摸胡
// Scenario: legacy allowed peng upgrade still yields to simultaneous self-hu
test("legacy allowed peng upgrade still yields to simultaneous self-hu", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const game = postHuKongGame({
    huCount: 0,
  });
  game.rules.allowPungUpgrade = true;
  delete game.rules.preHuActionChoice;
  // Rebuild the concealed hand while preserving all physical tile counts.
  // The drawn 2 completes 2/3/4, 5/6/7, 9/10/11 and a pair of 17s.
  const replacementHand = [2, 3, 4, 5, 6, 7, 9, 10, 11, 17, 17];
  game.wall.push(...game.players[0].hand);
  // 逐项覆盖 replacementHand；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in replacementHand with the same checks, preserving the listed order.
  for (const tile of replacementHand)
    game.wall.splice(game.wall.indexOf(tile), 1);
  game.players[0].hand = replacementHand;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
  assert.ok(has(game, 0, "hu"));
  assertNoUpgrade(game, 0, 2);
});
// 场景：旧规则允许的碰牌加杠仍要求牌墙至少两张
// Scenario: legacy allowed peng upgrade still requires at least two wall tiles
test("legacy allowed peng upgrade still requires at least two wall tiles", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const initial = fixture({
    heldFourth: true,
  });
  initial.rules.allowPungUpgrade = true;
  delete initial.rules.pungUpgradeAfterDiscard;
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  const game = takePeng(initial);
  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  game.retiredTiles.push(
    ...game.wall.splice(1).map((tile) => ({
      seat: 0,
      tile,
    })),
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assertNoUpgrade(game, 1, 0);
});
// 先完成碰后的强制打牌，再让另外两席各打一次；返回原碰牌者的下一次正常窗口，不要求摸到补杠同牌。
// Discard after peng, advance the other two seats, then return the caller’s next normal window without requiring a matching draw.
function cycleAfterPengDiscard(game, tile = 17, expectedDraw = 9) {
  game = passAll(move(game, 1, "discard", tile));
  for (let i = 0; i < 2; i++)
    game = passAll(move(game, game.currentSeat, "discard", game.lastDraw.tile));
  assert.equal(game.currentSeat, 1);
  assert.equal(game.lastDraw.tile, expectedDraw);
  return game;
}
// 场景：早已持有第四张时，碰后完成打牌即可在后续窗口补杠，不要求新摸到同牌
// Scenario: an already-held fourth tile becomes eligible after the discard without drawing its match
test("an already-held fourth tile becomes eligible after the discard without drawing its match", () => {
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  const game = takePeng(
    fixture({
      heldFourth: true,
      head: [15, 15, 9, 9],
    }),
  );
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.equal(game.players[1].pendingPungDiscard, true);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assertNoUpgrade(game, 1, 0);
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  const later = cycleAfterPengDiscard(JSON.parse(JSON.stringify(game)));
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.equal(later.players[1].pendingPungDiscard, false);
  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  const next = assertUpgrade(later, 1, 0);
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.deepEqual(
    next.players.map((p) => p.score),
    [-1, 2, -1],
  );
  assert.equal(next.pendingKongRadishes, 1);
});
// 场景：v0.7.0 缺标记时从历史判断碰后待打牌，恢复后续补杠且不回写旧状态
// Scenario: v0.7.0 missing marker infers post-peng restriction from history and restores later upgrades without rewriting old state
test("v0.7.0 missing marker infers post-peng restriction from history and restores later upgrades without rewriting old state", () => {
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  let game = takePeng(
    fixture({
      heldFourth: true,
      head: [15, 15, 9, 9],
    }),
  );
  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  game.rules.allowPungUpgrade = false;
  delete game.rules.pungUpgradeAfterDiscard;
  for (const player of game.players) delete player.pendingPungDiscard;
  const before = structuredClone(game);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assertNoUpgrade(game, 1, 0);
  assert.deepEqual(game, before); // A forged old-client action has no side effects.

  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  game = cycleAfterPengDiscard(JSON.parse(JSON.stringify(game)));
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assertUpgrade(game, 1, 0);
  assert.equal(game.rules.allowPungUpgrade, false);
});
// 场景：暗杠及其补摸不能代替碰后必须完成的那次打牌
// Scenario: a concealed kong and replacement draw cannot stand in for the mandatory post-peng discard
test("a concealed kong and replacement draw cannot stand in for the mandatory post-peng discard", () => {
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  let game = takePeng(
    fixture({
      heldFourth: true,
      head: [15, 15, 9, 9],
    }),
  );
  // 本用例验证旧规则存档；新局的碰后禁暗杠由 action-choice 回归覆盖。
  // This regression models an old rule snapshot; action-choice tests cover the new restriction.
  delete game.rules.concealedKongAfterPungDiscard;
  // Substitute four non-zero concealed tiles with fours of another tile, keeping the wall conserved.
  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  const player = game.players[1];
  const removed = player.hand.splice(1, 4);
  game.wall.push(...removed);
  for (let i = 0; i < 4; i++) {
    const index = game.wall.indexOf(12);
    assert.ok(index >= 0);
    game.wall.splice(index, 1);
    player.hand.push(12);
  }
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
  assert.ok(has(game, 1, "anGang"));
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  game = move(game, 1, "anGang", 12);
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.equal(game.lastDraw.source, "replacement");
  assert.equal(player.pendingPungDiscard, true);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assertNoUpgrade(game, 1, 0);
  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  const old = structuredClone(game);
  delete old.players[1].pendingPungDiscard;
  old.rules.allowPungUpgrade = false;
  delete old.rules.pungUpgradeAfterDiscard;
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assertNoUpgrade(old, 1, 0);
});
// 场景：同牌的两个碰组中一个补杠后，另一个仍保持独立
// Scenario: two pungs of the same tile remain independent when one becomes a kong
test("two pungs of the same tile remain independent when one becomes a kong", () => {
  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  let game = createGame({
    seed: "two-pungs",
  });
  game.players[0].melds = [0, 0].map((tile) => ({
    type: "peng",
    tile,
    tiles: [0, 0, 0],
  }));
  game.players[0].hand = [0, 1, 3, 4, 6, 7, 9, 9];
  for (const seat of [1, 2])
    game.players[seat].hand = waiting.map((tile) => (tile === 0 ? 8 : tile));
  game.history = [
    {
      type: "peng",
      seat: 0,
      tile: 0,
    },
    {
      type: "discard",
      seat: 0,
      tile: 17,
    },
  ];
  game.lastDraw = {
    seat: 0,
    tile: 1,
    source: "normal",
  };
  // 十八种牌，每种八张。先登记所有已分配牌，再把余量填入牌墙；不能凭空增加牌。
  // There are eighteen kinds with eight copies each. Debit allocated tiles, then place remaining copies in the wall.
  const counts = Array(18).fill(8);
  // 逐项覆盖 [...game.players.flatMap(player=>player.hand),...head]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [...game.players.flatMap(player=>player.hand),...head] with the same checks, preserving the listed order.

  for (const p of game.players)
    for (const tile of [...p.hand, ...p.melds.flatMap((m) => m.tiles)])
      assert.ok(--counts[tile] >= 0);
  game.wall = counts.flatMap((count, tile) => Array(count).fill(tile));
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  game = passAll(move(game, 0, "buGang", 0));
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.deepEqual(
    game.players[0].melds.map((m) => [m.type, m.tiles.length]),
    [
      ["buGang", 4],
      ["peng", 3],
    ],
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
// 场景：恢复后的补杠仍开启抢杠；被成功抢胡时不收取杠分
// Scenario: restored later upgrade still opens rob-kong and a successful rob never charges kong points
test("restored later upgrade still opens rob-kong and a successful rob never charges kong points", () => {
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  let game = cycleAfterPengDiscard(
    takePeng(
      fixture({
        heldFourth: true,
        head: [15, 15, 9, 9],
      }),
    ),
  );
  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  const hand = [0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14];
  game.wall.push(...game.players[0].hand);
  // 逐项覆盖 replacementHand；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in replacementHand with the same checks, preserving the listed order.
  for (const tile of hand) {
    const index = game.wall.indexOf(tile);
    assert.ok(index >= 0);
    game.wall.splice(index, 1);
  }
  game.players[0].hand = hand;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  const before = structuredClone(game);
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  game = move(game, 1, "buGang", 0);
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.equal(game.claim.kind, "robKong");
  assert.equal(game.claim.kongType, "buGang");
  assert.deepEqual(getLegalActions(game, 0), [
    {
      type: "hu",
    },
    {
      type: "pass",
    },
  ]);
  assert.deepEqual(
    game.players.map((p) => p.score),
    before.players.map((p) => p.score),
  );
  assert.equal(game.players[1].melds[0].type, "peng");
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  game = passAll(move(game, 0, "hu"));
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.equal(game.history.filter((e) => e.type === "buGang").length, 0);
  assert.equal(game.players[1].kongCount, 0);
  assert.equal(game.players[1].melds[0].tiles.length, 3);
  assert.deepEqual(
    game.history.find((e) => e.type === "hu").payments.map((p) => p.seat),
    [1, 0],
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
});
