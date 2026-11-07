/**
 * 成都建房配置的公开合同：只保存已确认的选择，不启动、发牌或计算结算。
 * Public Chengdu room-settings contract: save confirmed choices without starting, dealing or settling a game.
 * 前后端共用严格校验；花麻将字段和客户端“已批准”标记不能混入这个快照。
 * Client/server share strict validation; Flower fields and client approval flags cannot enter this snapshot.
 */
import { validateChengduOptions } from './chengdu-options.js';
import { validateChengduScoringOptions } from './chengdu-contract.js';

export { CHENGDU_FAN_CAPS } from './chengdu-contract.js';
export const CHENGDU_START_PENDING_MESSAGE = '成都麻将目前仅支持房间准备，规则和引擎验证完成后才能开局。';

// 返回独立的配置副本；四人/定缺是固定约束，其余四项必须明确选择，不发明默认玩法。
// Return a separate snapshot; four seats/dingque are fixed, while all four choices must be explicit without invented defaults.
export function validateChengduRoomSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some((key) => !['playerCount', 'dingque', 'endCondition', 'exchangeThree', 'selfDraw', 'fanCap'].includes(key)) ||
    (Object.hasOwn(input, 'playerCount') && input.playerCount !== 4)) {
    throw new TypeError('成都麻将固定四人，请检查本桌玩法选项');
  }
  const options = validateChengduOptions({
    endCondition: input.endCondition,
    exchangeThree: input.exchangeThree,
    ...(Object.hasOwn(input, 'dingque') ? { dingque: input.dingque } : {}),
  });
  const scoring = validateChengduScoringOptions({ selfDraw: input.selfDraw, fanCap: input.fanCap });
  return { playerCount: 4, ...options, ...scoring };
}

// 表单输入未完成时只返回 false，不在每次渲染抛错；提交时仍使用上面的完整校验。
// Incomplete drafts return false rather than throwing on each render; submission still uses full validation above.
export function isChengduRoomSettings(input) {
  try {
    validateChengduRoomSettings(input);
    return true;
  } catch {
    return false;
  }
}
