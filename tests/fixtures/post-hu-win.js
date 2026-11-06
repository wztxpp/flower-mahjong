// 为必胡回归构造真实接炮、杠后弃牌及抢杠窗口；所有牌从八张配额重新分配。
// Build real discard, post-kong discard and rob-kong windows for mandatory-win regression.
// Every physical tile is allocated from its eight-copy budget; no production data is used.
import assert from 'node:assert/strict';
import { applyAction, assertGameInvariants } from '../../shared/game.js';
import { postHuKongGame } from './post-hu-kong.js';

// 零号位已经胡过、听一/四筒；一号位未胡，打出或加杠一筒。可选二号位同时必胡。
// Seat zero has won and waits on one/four dots; unwon seat one discards or extends one dot.
// Optionally add a second prior-winning claimant; all transitions use the real engine.
export function postHuWinClaim({ kind = 'discard', multiple = false, huCount = 1 } = {}) {
  const game = postHuKongGame({ winningDraw: true, huCount });
  const tile = game.lastDraw.tile;
  game.players[0].hand.splice(game.players[0].hand.lastIndexOf(tile), 1);
  if (kind === 'robKong') {
    // 加杠者本张不能自摸，否则胡优先会隐藏加杠；此手缺三筒，避免误造非法动作。
    // The upgrader must not self-win: hu would suppress addGang. Missing three dots keeps the upgrade legal.
    game.players[1].hand = [3, 4, 5, 6, 7, 8, 9, 10, 12, 17, 17];
    game.players[1].melds = [{ type: 'anGang', tile, tiles: Array(4).fill(tile) }];
    game.players[1].kongCount = 1;
  } else {
    game.players[1].hand.push(tile);
    game.players[1].hand.sort((left, right) => left - right);
    game.players[1].pendingKongDiscard = kind === 'kongDiscard';
  }
  if (multiple) {
    game.players[2].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 17, 17];
    game.players[2].huCount = 1;
    game.players[2].winPile = [{ tile, source: 'selfDraw', virtual: false }];
    game.retiredTiles.push({ seat: 2, tile });
  }
  game.currentSeat = 1;
  game.lastDraw = { seat: 1, tile, source: 'normal' };
  game.rules.autoDiscardAfterHu = false;
  // 重建墙牌而非从已有牌墙额外复制，保证每种八张及总数 144。
  // Rebuild the wall instead of duplicating existing copies; preserve eight of each and 144 total.
  const counts = Array(18).fill(8);
  const used = game.players.flatMap((player) => [
    ...player.hand, ...player.melds.flatMap((meld) => meld.tiles), ...player.radishes,
  ]);
  for (const value of [...used, ...game.retiredTiles.map((record) => record.tile)])
    assert.ok(--counts[value] >= 0, `Fixture overused tile ${value}`);
  game.wall = counts.flatMap((count, value) => Array(count).fill(value));
  assertGameInvariants(game);
  const claimed = applyAction(game, 1, { type: kind === 'robKong' ? 'addGang' : 'discard', tile });
  assert.equal(claimed.phase, 'claim');
  assertGameInvariants(claimed);
  return claimed;
}
