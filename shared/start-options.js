/**
 * 前端表单和服务端共用的开局金额约束；这里只检查数值，不计算胡牌或修改已有局。
 * Shared start-option bounds for form and server validation; no scoring or saved-game mutation occurs here.
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
