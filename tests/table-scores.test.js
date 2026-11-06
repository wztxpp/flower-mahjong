// 牌桌累计分、已结算分与本局临时分，防止同名换人继承积分。
// Table totals, settled and provisional scores, preventing same-name replacements inheriting points.
// 阅读说明见 docs/TESTING-READING-GUIDE.md；固定种子与凭证仅为测试，不应移入真实用户数据。
// See docs/TESTING-READING-GUIDE.md; seeded data and test credentials must stay separate from real user data.
import test from "node:test";
import assert from "node:assert/strict";
import { tableScores, ensureGameMetadata } from "../server/history.js";
const people = ["甲", "乙", "丙"].map((name, seat) => ({
  name,
  seat,
  tokenHash: `private-seat-${seat}`,
  playerHash: `private-profile-${seat}`,
}));
const entry = (id, scores, phase = "finished", participants = people) => ({
  meta: {
    id,
    participants: structuredClone(participants),
  },
  game: {
    phase,
    players: scores.map((score) => ({
      score,
    })),
  },
});
// 建立两局归档加一局进行中的牌桌，使用不同局 ID 防止累计分重复计算。
// Build a table with two archived games and one active game, using distinct IDs to detect double counting.
function roomFixture() {
  const round = entry("current", [3, -1, -2], "turn");
  return {
    id: "ABCDEF23",
    seats: structuredClone(people),
    archivedGames: [entry("one", [8, -3, -5]), entry("two", [-2, 5, -3])],
    game: round.game,
    gameMeta: round.meta,
  };
}
// 场景：牌桌总分将已结算局与当前暂计积分相加，不修改源账本
// Scenario: table total adds settled rounds and current provisional points without changing source ledger
test("table total adds settled rounds and current provisional points without changing source ledger", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const room = roomFixture(),
    before = structuredClone(room);
  const rows = tableScores(room);
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.deepEqual(
    rows.map((row) => row.totalScore),
    [9, 1, -10],
  );
  assert.deepEqual(
    rows.map((row) => row.settledScore),
    [6, 2, -8],
  );
  assert.deepEqual(
    rows.map((row) => row.provisionalScore),
    [3, -1, -2],
  );
  assert.deepEqual(
    rows.map((row) => row.settledGames),
    [2, 2, 2],
  );
  assert.equal(
    rows.reduce((sum, row) => sum + row.totalScore, 0),
    0,
  );
  assert.deepEqual(tableScores(JSON.parse(JSON.stringify(room))), rows);
  assert.deepEqual(tableScores(room), rows);
  assert.deepEqual(room, before);
  assert.doesNotMatch(
    JSON.stringify(rows),
    /private-seat|private-profile|tokenHash|playerHash/,
  );
});
// 场景：结算与归档会改变记账列，但绝不重复计入当前牌局
// Scenario: settling and archiving changes accounting columns but never double-counts the current game
test("settling and archiving changes accounting columns but never double-counts the current game", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const room = roomFixture();
  room.game.phase = "finished";
  const settled = tableScores(room);
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.deepEqual(
    settled.map((row) => row.settledScore),
    [9, 1, -10],
  );
  assert.deepEqual(
    settled.map((row) => row.provisionalScore),
    [0, 0, 0],
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  room.archivedGames.push(entry("current", [3, -1, -2]));
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.deepEqual(
    tableScores(room),
    settled,
    "duplicate archived current ID should not add the same game twice",
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const next = entry("next", [0, 0, 0], "turn");
  room.game = next.game;
  room.gameMeta = next.meta;
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.deepEqual(
    tableScores(room).map((row) => row.totalScore),
    settled.map((row) => row.totalScore),
  );
});
// 场景：同名替补不能继承他人积分，已离席玩家的累计积分仍守恒
// Scenario: same-name replacement cannot inherit another player’s score; departed totals remain conserved
test("same-name replacement cannot inherit another player’s score; departed totals remain conserved", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const room = roomFixture();
  room.game.phase = "finished";
  room.seats[2] = {
    name: "丙",
    tokenHash: "new-secret-seat",
    playerHash: people[2].playerHash,
  };
  const rows = tableScores(room);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(rows.length, 4);
  assert.equal(rows[2].seat, null);
  assert.equal(rows[2].detached, true);
  assert.equal(rows[2].totalScore, -10);
  assert.equal(rows[3].seat, 2);
  assert.equal(rows[3].totalScore, 0);
  assert.equal(
    rows.reduce((sum, row) => sum + row.totalScore, 0),
    0,
  );
  assert.notEqual(rows[2].id, rows[3].id);
  assert.doesNotMatch(JSON.stringify(rows), /private-|new-secret/);
});
// 场景：离席与重连绝不清除积分，大厅中新入牌局的在场玩家均从零开始
// Scenario: detaching/reconnecting never erases scores and a lobby starts all present players at zero
test("detaching/reconnecting never erases scores and a lobby starts all present players at zero", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const room = roomFixture();
  const initial = tableScores(room);
  room.seats[1].detached = true;
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(tableScores(room)[1].totalScore, initial[1].totalScore);
  assert.equal(tableScores(room)[1].detached, true);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  room.seats[1].detached = false;
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.deepEqual(tableScores(room), initial);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const lobby = tableScores({
    seats: [people[0], null, null],
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(lobby.length, 1);
  assert.equal(lobby[0].totalScore, 0);
});
// 场景：可验证的旧房间仅获得已知牌局，不编造丢失历史
// Scenario: old verifiable room receives only its known game; no fabricated lost history
test("old verifiable room receives only its known game; no fabricated lost history", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const room = {
    id: "ABCDEF23",
    createdAt: 1,
    updatedAt: 2,
    seats: structuredClone(people),
    game: entry("old", [1, -1, 0]).game,
  };
  ensureGameMetadata(room);
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.deepEqual(
    tableScores(room).map((row) => row.totalScore),
    [1, -1, 0],
  );
});
