// 杠上花后续摸的合成守恒局；所有牌从副数预算分配，不读取或复制真实玩家记录。
// Conserved synthetic kong-win continuations; every tile comes from the deck budget, never real player records.
import assert from 'node:assert/strict';
import { applyAction, applyPresentedAction, assertGameInvariants } from '../../shared/game.js';
import { variableFixture, meld, waiting } from './variable-table.js';

export const waitsFourDots = [0, 1, 2, 3, 4, 5, 9, 10, 11, 15, 16, 17, 12];

// 本人杠后听5条；另外一人或两人听4筒，使后续弃牌是否受保护可以真实验证。
// The kong player waits on five bamboo; one/two opponents wait on four dots to exercise actual discard eligibility.
export function kongContinuationFixture({
  type = 'anGang', alreadyWon = false, autoDiscardAfterHu = true,
  twoClaimants = false, head = [4, 12, 6], rules = {},
} = {}) {
  const base = [6, 7, 8, 9, 10, 11, 15, 16, 17, 4];
  const hand = type === 'anGang' ? [0, 0, 0, 0, ...base] : [0, ...base];
  const melds = type === 'anGang' ? [] : [meld(0, type === 'buGang' ? 3 : 4, type === 'buGang' ? 'peng' : 'anGang')];
  return variableFixture({
    playerCount: 3, deckCount: 2, drawTile: 0,
    hands: [hand, waitsFourDots, twoClaimants ? waitsFourDots : waiting],
    melds: [melds], huCounts: [alreadyWon ? 1 : 0], head,
    rules: { specialHuPatterns: false, autoDiscardAfterHu, ...rules },
  });
}

// 模拟修正前已持久化的错误弃牌展示态；先真实杠/胡/续摸，再只恢复旧版遗留标记。
// Model an old persisted erroneous discard boundary: execute real kong/hu/draw first, then restore only the old stale marker.
export function oldContinuationDiscard() {
  let game = kongContinuationFixture({ autoDiscardAfterHu: false, twoClaimants: true });
  game = applyAction(game, 0, { type: 'anGang', tile: 0 });
  game = applyAction(game, 0, { type: 'hu' });
  assert.equal(game.lastDraw.source, 'continuation');
  game.players[0].pendingKongDiscard = true;
  // 旧实现按pending标记出牌；暂换lastDraw只为构造旧字节，不改变真实draw历史或实体牌。
  // The old implementation used pending alone; temporarily adjust lastDraw to construct old bytes, preserving draw history/tiles.
  game.lastDraw.source = 'replacement';
  game = applyPresentedAction(game, 0, { type: 'pass' });
  assert.equal(game.discards.at(-1).afterKong, true);
  assertGameInvariants(game);
  return JSON.parse(JSON.stringify(game));
}

// 旧引擎会为这张错误标记的牌开放两个胡窗口；保留已接受回应，测试只纠正后续意图。
// The old engine opened two hu responses for this stale marker; preserve accepted responses and correct only future intents.
export function oldContinuationClaim({ acceptedSeat = null, repeatedResponder = false } = {}) {
  const game = oldContinuationDiscard();
  delete game.presentation;
  game.phase = 'claim';
  game.turnStep = null;
  game.discards.at(-1).claimable = true;
  game.claim = {
    kind: 'discard', discardIndex: game.discards.length - 1, discardSeat: 0, tile: 12,
    eligibleSeats: [2, 1], options: { 1: [{ type: 'hu' }], 2: [{ type: 'hu' }] },
    responses: acceptedSeat === null ? {} : { [acceptedSeat]: { type: 'hu' } },
  };
  if (repeatedResponder) game.players[2].huCount = 1;
  assertGameInvariants(game);
  return JSON.parse(JSON.stringify(game));
}
