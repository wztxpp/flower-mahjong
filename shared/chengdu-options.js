/**
 * 只表达已确认的成都选项，不定义默认玩法、计番、封顶、自摸付款或换牌方向。
 * Express confirmed Chengdu choices only, without inventing defaults, fan/caps, self-draw payers or exchange direction.
 * 此基础层尚未开放成都开局；未来专属引擎在其建房验证器中调用本模块。
 * Chengdu creation is not enabled in this foundation; its future engine will call this module from room validation.
 */
export const CHENGDU_END_CONDITIONS = Object.freeze(['firstWin', 'bloodBattle']);

// firstWin 表示一家胡结束；bloodBattle 表示血战到底，具体同张多胡及结算顺序另待规则确认。
// firstWin ends at the first winning event; bloodBattle continues play, with simultaneous-win/settlement details still unconfirmed.
export function isChengduEndCondition(value) {
  return CHENGDU_END_CONDITIONS.includes(value);
}

// 两个可选项都须明确传入，避免把研发时的选择变成用户未确认的永久默认。
// Require both choices explicitly so a development assumption never becomes an unconfirmed persistent default.
// 定缺是固定约束，不是可关闭的开关；允许省略或 true，拒绝 false 及未知规则键。
// Dingque is mandatory: accept omission or true, reject false and unknown rule keys.
export function validateChengduOptions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some((key) => !['endCondition', 'exchangeThree', 'dingque'].includes(key)) ||
    !isChengduEndCondition(input.endCondition) || typeof input.exchangeThree !== 'boolean' ||
    (Object.hasOwn(input, 'dingque') && input.dingque !== true)) {
    throw new TypeError('成都选项须明确选择结束方式和是否换三张，且必须定缺');
  }
  return { endCondition: input.endCondition, exchangeThree: input.exchangeThree, dingque: true };
}
