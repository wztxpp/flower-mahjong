// 提供守恒的胡后必杠夹具，供引擎、HTTP 和界面测试共同使用。
// Provide a conserved mandatory post-win kong fixture shared by engine, HTTP and UI tests.
// 阅读说明见 docs/TESTING-READING-GUIDE.md；固定种子与凭证仅为测试，不应移入真实用户数据。
// See docs/TESTING-READING-GUIDE.md; seeded data and test credentials must stay separate from real user data.
import assert from "node:assert/strict";
import { createGame, assertGameInvariants } from "../../shared/game.js";
const waiting = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];

/** Conserved real-engine state for mandatory post-hu own-kong decisions. */
// 构造胡后补杠/暗杠/扩杠局面；已胡实物牌记入 retiredTiles，剩余牌补齐牌墙，最后检查守恒。
// Build post-win kong states; prior physical wins enter retiredTiles, remaining copies fill the wall, then invariants are checked.
export function postHuKongGame({
  type = "buGang",
  huCount = 1,
  winningDraw = false,
} = {}) {
  const game = createGame({
    seed: "mandatory-post-hu-kong",
    rules: {
      allowPungUpgrade: true,
      specialHuPatterns: false,
    },
  });
  const tile = type === "anGang" ? 0 : 2;
  const baseHand =
    type === "anGang"
      ? [0, 0, 0, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17]
      : [3, 4, 5, 6, 7, 8, 10, 11, 17, 17];
  const winningTile = type === "anGang" ? 17 : 9;
  const drawTile = winningDraw ? winningTile : tile;
  game.players.forEach((player, seat) => {
    player.hand =
      seat === 0 ? [...baseHand, drawTile].sort((a, b) => a - b) : [...waiting];
    player.melds =
      seat === 0 && type !== "anGang"
        ? [
            {
              type: type === "buGang" ? "peng" : "anGang",
              tile,
              tiles: Array(type === "buGang" ? 3 : 4).fill(tile),
            },
          ]
        : [];
    player.huCount = seat === 0 ? huCount : 0;
    player.winPile = Array(player.huCount)
      .fill(null)
      .map(() => ({
        tile: winningTile,
        source: "selfDraw",
        virtual: false,
      }));
    player.kongCount = player.melds.filter(
      (meld) => meld.type !== "peng",
    ).length;
  });
  game.history = [];
  game.discards = [];
  // 已胡的实物牌仍占一张物理配额；winPile 是展示/计分引用，不能当成新增的牌。
  // Physical winning tiles still occupy one copy; winPile is a display/scoring reference, not newly created tiles.
  game.retiredTiles = Array(huCount)
    .fill(null)
    .map(() => ({
      seat: 0,
      tile: winningTile,
    }));
  game.firstHuRadishesRevealed = huCount > 0;
  game.phase = "turn";
  game.turnStep = "discard";
  game.currentSeat = 0;
  game.drawKind = "normal";
  game.lastDraw = {
    seat: 0,
    tile: drawTile,
    source: "normal",
  };
  const head = [winningTile, 6],
    tail = [7];
  // 十八种牌，每种八张。先登记所有已分配牌，再把余量填入牌墙；不能凭空增加牌。
  // There are eighteen kinds with eight copies each. Debit allocated tiles, then place remaining copies in the wall.
  const counts = Array(18).fill(8);
  // 从每种牌八张的余量扣除一张；负数表示夹具凭空制造了第九张，立即失败。
  // Debit one of the eight copies of a tile; a negative remainder means the fixture invented a ninth copy and must fail.
  const use = (value) =>
    assert.ok(--counts[value] >= 0, `Fixture overused tile ${value}`);
  // 逐项覆盖 game.players；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in game.players with the same checks, preserving the listed order.
  for (const player of game.players)
    [...player.hand, ...player.melds.flatMap((meld) => meld.tiles)].forEach(
      use,
    );
  game.retiredTiles.forEach((record) => use(record.tile));
  [...head, ...tail].forEach(use);
  game.wall = [
    ...head,
    ...counts.flatMap((count, value) => Array(count).fill(value)),
    ...tail,
  ];
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
  return game;
}
