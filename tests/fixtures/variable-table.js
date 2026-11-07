// 可变人数/副数的合成夹具；先从每种牌配额扣除全部牌区，再构造牌墙，绝不读取真实牌局。
// Synthetic variable-table fixtures debit every physical zone before building the wall; no real games are read.
import assert from 'node:assert/strict';
import { createGame, assertGameInvariants } from '../../shared/game.js';

export const waiting = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
export const scattered = [1, 2, 4, 5, 7, 8, 10, 11, 13, 14, 15, 16, 17];
export const meld = (tile, count = 4, type = 'anGang') => ({ tile, type, tiles: Array(count).fill(tile) });

// inputs指定手牌/副露/胡数与墙头；其余实体退回墙牌。wallCount裁掉的牌进入退役区维持守恒。
// Inputs select hands/melds/wins/wall heads; unused copies form the wall and trimmed wall tiles are retired.
export function variableFixture({
  playerCount = 4, deckCount = 5, rules = {}, hands, melds = [], huCounts = [],
  currentSeat = 0, drawTile, head = [], radishes = [], wallCount, kongDiscard = false,
} = {}) {
  const game = createGame({ seed: 'variable-fixture', rules: {
    playerCount, deckCount, dragonStartCount: 20, bigSingleReadyPayment: false,
    autoDiscardAfterHu: false, ...rules,
  } });
  game.history = [];
  game.currentSeat = currentSeat;
  game.players.forEach((player, seat) => {
    player.melds = structuredClone(melds[seat] ?? []);
    player.hand = [...(hands?.[seat] ?? (seat === currentSeat ? [...scattered, 8] : scattered))]
      .sort((left, right) => left - right);
    player.huCount = huCounts[seat] ?? 0;
    player.kongCount = player.melds.filter(item => item.type !== 'peng').length;
    player.radishes = [...(radishes[seat] ?? [])];
    player.pendingKongDiscard = seat === currentSeat && kongDiscard;
  });
  game.firstHuRadishesRevealed = huCounts.some(count => count > 0);
  game.lastDraw = { seat: currentSeat, tile: drawTile ?? game.players[currentSeat].hand.at(-1), source: 'normal' };
  const counts = Array(18).fill(deckCount * 4);
  for (const tile of [...game.players.flatMap(player => [
    ...player.hand, ...player.melds.flatMap(item => item.tiles), ...player.radishes,
  ]), ...head]) assert.ok(--counts[tile] >= 0, `Tile ${tile} exceeded its physical budget`);
  const rest = counts.flatMap((count, tile) => Array(count).fill(tile));
  if (wallCount !== undefined) {
    assert.ok(wallCount >= head.length);
    game.retiredTiles.push(...rest.splice(wallCount - head.length).map(tile => ({ tile, seat: 0 })));
  }
  game.wall = [...head, ...rest];
  assertGameInvariants(game);
  return game;
}
