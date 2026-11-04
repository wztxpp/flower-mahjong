import assert from 'node:assert/strict';
import { createGame, assertGameInvariants } from '../../shared/game.js';

const waiting = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];

/** Conserved real-engine state for mandatory post-hu own-kong decisions. */
export function postHuKongGame({ type = 'buGang', huCount = 1, winningDraw = false } = {}) {
  const game = createGame({ seed: 'mandatory-post-hu-kong', rules: { specialHuPatterns: false } });
  const tile = type === 'anGang' ? 0 : 2;
  const baseHand = type === 'anGang'
    ? [0, 0, 0, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17]
    : [3, 4, 5, 6, 7, 8, 10, 11, 17, 17];
  const winningTile = type === 'anGang' ? 17 : 9;
  const drawTile = winningDraw ? winningTile : tile;
  game.players.forEach((player, seat) => {
    player.hand = seat === 0 ? [...baseHand, drawTile].sort((a, b) => a - b) : [...waiting];
    player.melds = seat === 0 && type !== 'anGang' ? [{ type: type === 'buGang' ? 'peng' : 'anGang', tile, tiles: Array(type === 'buGang' ? 3 : 4).fill(tile) }] : [];
    player.huCount = seat === 0 ? huCount : 0;
    player.winPile = Array(player.huCount).fill(null).map(() => ({ tile: winningTile, source: 'selfDraw', virtual: false }));
    player.kongCount = player.melds.filter(meld => meld.type !== 'peng').length;
  });
  game.history = []; game.discards = [];
  game.retiredTiles = Array(huCount).fill(null).map(() => ({ seat: 0, tile: winningTile }));
  game.firstHuRadishesRevealed = huCount > 0;
  game.phase = 'turn'; game.turnStep = 'discard'; game.currentSeat = 0; game.drawKind = 'normal';
  game.lastDraw = { seat: 0, tile: drawTile, source: 'normal' };
  const head = [winningTile, 6], tail = [7];
  const counts = Array(18).fill(8);
  const use = value => assert.ok(--counts[value] >= 0, `Fixture overused tile ${value}`);
  for (const player of game.players) [...player.hand, ...player.melds.flatMap(meld => meld.tiles)].forEach(use);
  game.retiredTiles.forEach(record => use(record.tile));
  [...head, ...tail].forEach(use);
  game.wall = [...head, ...counts.flatMap((count, value) => Array(count).fill(value)), ...tail];
  assertGameInvariants(game);
  return game;
}
