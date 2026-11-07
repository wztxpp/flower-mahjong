/**
 * 成都回合原型的显式开发策略：尚未确认的规则无默认，不代表用户正式选项。
 * Explicit development policies for the Chengdu turn prototype: undecided rules have no defaults and are not public settings.
 * 正式 createGame/模式注册继续阻断，不能用这些值或 approval 标记绕过上线闸门。
 * Production creation/registration remain blocked; these values or approval flags cannot bypass release gates.
 */
import { chengduExchangeRecipient } from './chengdu-contract.js';

// 每项策略都必须由隔离测试明确提供；值只决定该测试局，不会补进旧局或房间默认。
// Require every policy explicitly in isolated tests; values apply to that draft only, never backfilled saves or room defaults.
export function validateChengduPlayPolicy(input) {
  const allowedKeys = [
    'clockwiseSeats', 'turnDirection', 'simultaneousWins', 'afterDiscardWin',
    'passedWins', 'pureSuitStacking', 'claimsRequireClearDingque', 'kongsAfterPeng',
    'kongPoints', 'drawReadyCheck', 'flowerPigPaysReadyCheck', 'kongRefund', 'firstWinDrawSettlement',
  ];
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some((key) => !allowedKeys.includes(key)) || allowedKeys.some((key) => !Object.hasOwn(input, key))) {
    throw new TypeError('成都回合开发策略须明确提供全部字段');
  }
  chengduExchangeRecipient(0, 'clockwise', input.clockwiseSeats);
  const choices = {
    turnDirection: ['clockwise', 'counterclockwise'],
    simultaneousWins: ['all'],
    afterDiscardWin: ['singleWinnerNextMultipleDiscarder'],
    passedWins: ['untilOwnDraw'],
    pureSuitStacking: ['addTwo'],
    kongsAfterPeng: ['afterDiscard'],
    drawReadyCheck: ['notReadyPaysReady'],
    kongRefund: ['notReadyOrFlowerPig'],
    firstWinDrawSettlement: ['sameAsBloodBattle'],
  };
  for (const [field, values] of Object.entries(choices)) {
    if (!values.includes(input[field])) throw new TypeError(`成都开发策略 ${field} 无效`);
  }
  if (input.claimsRequireClearDingque !== false || input.flowerPigPaysReadyCheck !== false) {
    throw new TypeError('缺门未清可碰杠其他花色，花猪不重复赔查叫');
  }
  const points = input.kongPoints;
  if (!points || typeof points !== 'object' || Array.isArray(points) ||
    Object.keys(points).length !== 3 || ['anGang', 'mingGang', 'buGang'].some((key) =>
      !Number.isSafeInteger(points[key]) || points[key] < 0 || points[key] > 100000) ||
    points.anGang !== 2 || points.buGang !== 1 || points.mingGang !== 2) {
    throw new TypeError('杠分固定：暗杠2、补杠1、明杠由放牌者付2');
  }
  return structuredClone(input);
}
