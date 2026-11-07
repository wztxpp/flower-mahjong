/**
 * 前端与服务端共用建房维度和开局金额约束；这里只校验数值，不计分或修改旧局。
 * Shared room-dimension and round-amount validation; no scoring or saved-game mutation occurs here.
 */
// 每个对手支付的虚拟积分默认值；缺金额的旧局也使用这个稳定默认值。
// Default virtual points per opponent; saved games lacking an amount use this stable fallback.
export const DEFAULT_BIG_SINGLE_READY_POINTS = 50;
// 防止异常大数字或不安全整数进入账本；上下限与前端提示保持一致。
// Bound ledger inputs and keep the frontend message consistent with server validation.
export const MAX_BIG_SINGLE_READY_POINTS = 100000;

// 0 是合法的“不收取”，小数、字符串、负数和越界数字均无效。
// Zero means no charge; fractions, strings, negatives, and out-of-range values are invalid.
export function isBigSingleReadyPoints(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_BIG_SINGLE_READY_POINTS;
}

// 房间在创建时固定人数、副数与神龙门槛；半副为十八种牌各两张。
// Creation-time table dimensions stay fixed; a half-deck contains two of each of eighteen identities.
export const DEFAULT_PLAYER_COUNT = 3;
export const DEFAULT_DECK_COUNT = 2;
export const DEFAULT_DRAGON_START_COUNT = 6;
export const MIN_DRAGON_START_COUNT = 1;
export const MAX_DRAGON_START_COUNT = 20;

// 只接收真正的数值；不让字符串、NaN 或非半副步进进入持久快照。
// Accept numeric values only, excluding strings, NaN and fractions outside half-deck steps.
export function isPlayerCount(value) {
  return value === 3 || value === 4;
}
// 整副和半副都均匀扩充十八种牌，拒绝更细步进。
// Full/half decks expand every identity evenly; smaller fractional steps are invalid.
export function isDeckCount(value) {
  return Number.isFinite(value) && value >= 1 && value <= 5 && Number.isInteger(value * 2);
}
// 门槛可超过该桌单牌数，界面提示但不擅自降低用户选值。
// Thresholds may exceed the current copy budget; warn in the UI without reducing the selection.
export function isDragonStartCount(value) {
  return Number.isInteger(value) && value >= MIN_DRAGON_START_COUNT && value <= MAX_DRAGON_START_COUNT;
}

// 读取缺配置的旧规则时只返回原双副数量，不修改原快照。
// Read missing saved configuration as the original double deck without mutating the snapshot.
export function copiesPerTile(rules) {
  return (rules?.deckCount ?? DEFAULT_DECK_COUNT) * 4;
}
