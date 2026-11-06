// 共享的真实碰牌/补杠夹具：准备合法牌局，碰与补杠都必须通过 applyAction 执行。
// Shared real peng/upgrade fixture: prepare a legal game and perform meld transitions through applyAction.
// heldFourth 控制碰前是否已持有第四张；head 控制后续自然摸牌，二者是不同条件。
// heldFourth controls an already-held fourth copy; head controls later draws. They are independent conditions.
import assert from "node:assert/strict";
import {
  createGame,
  applyAction,
  getLegalActions,
  assertGameInvariants,
} from "../../shared/game.js";
const waiting = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
const pengHand = [0, 0, 3, 4, 5, 6, 7, 8, 10, 11, 16, 17, 17];
// 将类型和可选牌面交给真实引擎；未提供 tile 时不发送该字段，返回新状态。
// Submit type/optional tile to the real engine, omitting absent tile fields and returning new state.
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
// 读取引擎合法动作，不用夹具自行决定是否能碰或补杠。
// Read engine legal actions rather than letting the fixture decide legality.
const has = (game, seat, type) =>
  getLegalActions(game, seat).some((action) => action.type === type);
// 依次让尚未回应的座位过牌，直到反应窗关闭；保留每一步返回的新状态。
// Pass each outstanding responder until the claim window closes, carrying forward each returned state.
function passAll(game) {
  while (game.phase === "claim") {
    const seat = game.claim.eligibleSeats.find(
      (other) => !game.claim.responses[other],
    );
    game = move(game, seat, "pass");
  }
  return game;
}

/** Real conserved hands and wall; all peng/kong transitions below use applyAction. */
// 构造即将由零席打出目标牌、一席可碰的守恒状态；固定种子只供重放测试。
// Build a conserved state where seat zero discards the target and seat one can peng; the seed is for replay only.
export function pungUpgradeGame({
  heldFourth = false,
  head = [15, 15, 0, 9],
} = {}) {
  const game = createGame({
    seed: "peng-upgrade-regression",
  });
  game.players[0].hand = [...waiting, 0].sort((a, b) => a - b);
  game.players[1].hand = [...pengHand];
  // 用同牌替换一张手牌，随后统一重建墙牌；不能凭空多加一张。
  // Replace one held tile, then rebuild the wall from remaining copies rather than inventing an extra tile.
  if (heldFourth) game.players[1].hand[game.players[1].hand.indexOf(16)] = 0;
  game.players[1].hand.sort((a, b) => a - b);
  game.players[2].hand = [...waiting];
  // 把当前摸牌来源设为普通摸牌，确保出牌入口与夹具手牌一致。
  // Set ordinary draw provenance so the discard entry point agrees with the fixture hand.
  game.lastDraw = {
    seat: 0,
    tile: 0,
    source: "normal",
  };
  game.history = [];
  // 十八种各八张，先扣除所有手牌和预设墙头，余量才进入牌墙。
  // Start with eight copies of eighteen kinds, debit hands and fixed wall head, then fill the remaining wall.
  const counts = Array(18).fill(8);
  for (const tile of [
    ...game.players.flatMap((player) => player.hand),
    ...head,
  ]) {
    // 任何扣除为负都说明夹具超用同种牌，应立即失败。
    // A negative remainder means overused physical copies and must fail immediately.
    assert.ok(--counts[tile] >= 0, `Fixture overused tile ${tile}`);
  }
  game.wall = [
    ...head,
    ...counts.flatMap((count, tile) => Array(count).fill(tile)),
  ];
  // 返回前验证牌数与积分等引擎不变量，不用非法夹具制造所需结果。
  // Validate engine invariants before returning instead of manufacturing outcomes with illegal fixtures.
  assertGameInvariants(game);
  return game;
}
// 执行真实弃牌与碰牌，返回碰后待打牌窗口；没有摸牌，也尚未满足补杠时机。
// Execute a real discard/peng and return the pending-discard window, with no draw and no upgrade timing yet.
export function takePeng(game) {
  game = move(game, 0, "discard", 0);
  assert.ok(has(game, 1, "peng"));
  game = passAll(move(game, 1, "peng", 0));
  assert.equal(game.currentSeat, 1);
  assert.equal(game.players[1].melds[0].type, "peng");
  // 碰牌不附送摸牌；这个 null 也是旧存档判断碰后待打牌的重要上下文。
  // Peng grants no draw; null also contributes to legacy pending-discard context.
  assert.equal(game.lastDraw, null);
  return game;
}
