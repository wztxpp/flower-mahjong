/**
 * 成都正式纯引擎入口：只创建/接受独立 schema 2，固定规则已确认，不接受实验策略或升级原型。
 * Production Chengdu entry: create/accept only independent schema two with confirmed rules, never experimental policies or promoted drafts.
 * 房间负责凭证、加密洗牌、CAS与轮回持久化；本层只收完整牌墙，动作不改输入，投影不泄露暗手。
 * Rooms own credentials, cryptographic shuffling, CAS and cursor persistence; this layer receives a complete wall and returns immutable transitions/private projections.
 */
import * as preparation from './chengdu-game.js';
import * as play from './chengdu-play.js';
import { validateChengduOptions } from './chengdu-options.js';
import { validateChengduScoringOptions, planChengduExchangeRound } from './chengdu-contract.js';
import { assertChengduProductionSnapshot } from './chengdu-production-contract.js';
export { CHENGDU_SCHEMA_VERSION, CHENGDU_RULES_VERSION, isChengduProductionHeader } from './chengdu-production-contract.js';

// 只在成功开局边界使用：wall是服务端加密洗好的108张牌，ordinal是此前成功启用换牌的局数。
// Start-boundary only: wall is the server's cryptographically shuffled 108 tiles; ordinal counts previous successful exchange-enabled games.
// 严格拒绝force/approved、用户策略及未知输入；返回nextExchangeOrdinal但不写房间或推进持久游标。
// Reject force/approved, user-authored policy and unknown inputs; return nextExchangeOrdinal without persisting or advancing a room cursor.
export function createGame(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some((key) => !['wall', 'dealerSeat', 'options', 'scoring', 'exchangeOrdinal'].includes(key))) {
    throw new TypeError('成都正式开局参数无效');
  }
  const options = validateChengduOptions(input.options);
  const scoring = validateChengduScoringOptions(input.scoring);
  const round = planChengduExchangeRound({
    exchangeThree: options.exchangeThree, exchangeOrdinal: input.exchangeOrdinal, clockwiseSeats: [0, 1, 2, 3],
  });
  const game = preparation.createProductionPreparationGame({
    wall: input.wall, dealerSeat: input.dealerSeat, options, scoring, exchangePlan: round.exchangePlan,
  }, round);
  assertGameInvariants(game);
  return game;
}

// 正式入口每次读写先完整验版本/快照/状态，不把未知存档回退到原型或花麻将。
// Every production read/write validates version, snapshots and state; never fall back to draft or Flower for unknown saves.
export function assertGameInvariants(game) {
  assertChengduProductionSnapshot(game);
  return play.assertGameInvariants(game);
}
export function parseAction(input) {
  return play.parseAction(input);
}
export function getLegalActions(game, seat) {
  assertGameInvariants(game);
  return play.getLegalActions(game, seat);
}
export function applyAction(game, seat, action) {
  assertGameInvariants(game);
  const next = play.applyAction(game, seat, action);
  assertGameInvariants(next);
  return next;
}
export function getPlayerView(game, seat) {
  assertGameInvariants(game);
  return play.getPlayerView(game, seat);
}
export function getSpectatorView(game) {
  assertGameInvariants(game);
  return play.getSpectatorView(game);
}
export function getFormerParticipantView(game) {
  assertGameInvariants(game);
  return play.getFormerParticipantView(game);
}
export function dealerForNextGame(game) {
  assertGameInvariants(game);
  return play.dealerForNextGame(game);
}
export function settleGame(game) {
  assertGameInvariants(game);
  return play.settleDevelopmentDraw(game);
}

// 历史档案已是公开投影，可能没有手牌或墙；再次白名单过滤必须幂等，不能恢复隐藏牌面。
// Archived histories are public projections without hands/walls; repeated allowlisting must be idempotent and never restore hidden faces.
export function publicEvents(game, viewerSeat = null) {
  return play.publicEvents(game, viewerSeat);
}
