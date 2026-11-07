/**
 * 成都未决规则与安全闸门；已确认选项不代表完整规则已能开局。
 * Chengdu unresolved-rule contract and safety gates: confirmed choices do not make a complete playable ruleset.
 * 不接受客户端自称 approved 来跳过闸门；未来实现必须随测试和版本登记一起移除对应缺口。
 * A client-provided approval flag cannot bypass gates; implement and test each gap before registering a version.
 */
export const CHENGDU_SELF_DRAW_MODES = Object.freeze(['addBase', 'addFan']);
export const CHENGDU_FAN_CAPS = Object.freeze([4, 5, 6]);
export const CHENGDU_EXCHANGE_CYCLE = Object.freeze(['clockwise', 'opposite', 'counterclockwise']);

// 已确认的设置单独验证，不修改基础选项合同，也不为省略项发明默认值。
// Validate confirmed scoring choices separately, preserving the base-options contract without inventing omitted defaults.
export function validateChengduScoringOptions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some((key) => !['selfDraw', 'fanCap'].includes(key)) ||
    !CHENGDU_SELF_DRAW_MODES.includes(input.selfDraw) || !CHENGDU_FAN_CAPS.includes(input.fanCap)) {
    throw new TypeError('请明确选择自摸加底或加番，以及4、5或6番封顶');
  }
  return { selfDraw: input.selfDraw, fanCap: input.fanCap };
}

// 只映射用户确认的三个封顶档位；本函数不是一般番分表，不应用于未确认的牌型。
// Map only the three confirmed caps; this is not a general fan table and must not price unconfirmed shapes.
export function chengduCapPoints(fanCap) {
  if (!CHENGDU_FAN_CAPS.includes(fanCap)) throw new TypeError('封顶档位无效');
  return 2 ** (fanCap - 1);
}

// 根据已经算出的正整数番数做封顶与自摸修正；不负责给牌型计番或决定付款人。
// Cap an already computed positive fan value and apply self-draw adjustment, without classifying shapes or choosing payers.
// 用户确认加底在封顶后再加1，因此4番封顶自摸加底可到9分；加番先加1番再封顶。
// Confirmed add-base applies after the cap (four-fan cap can pay nine); add-fan increases fan before capping.
export function chengduWinPoints(fan, isSelfDraw, options) {
  const scoring = validateChengduScoringOptions(options);
  if (!Number.isSafeInteger(fan) || fan < 1 || typeof isSelfDraw !== 'boolean') {
    throw new TypeError('计分需要正整数番数及明确的自摸标记');
  }
  const effectiveFan = Math.min(fan, scoring.fanCap) + (isSelfDraw && scoring.selfDraw === 'addFan' ? 1 : 0);
  const cappedPoints = 2 ** (Math.min(effectiveFan, scoring.fanCap) - 1);
  return cappedPoints + (isSelfDraw && scoring.selfDraw === 'addBase' ? 1 : 0);
}

// 用户确认从顺时针开始，只按成功开启换三张的局计数；保留原签名但拒绝其他起点。
// The confirmed cycle starts clockwise and counts successfully started exchange rounds only; preserve the signature but reject other starts.
export function chengduExchangeDirection(cycleStart, cycleOrdinal) {
  const start = CHENGDU_EXCHANGE_CYCLE.indexOf(cycleStart);
  if (cycleStart !== 'clockwise' || !Number.isSafeInteger(cycleOrdinal) || cycleOrdinal < 0) {
    throw new TypeError('换牌方向需要明确的轮回起点与非负局序');
  }
  return CHENGDU_EXCHANGE_CYCLE[(start + cycleOrdinal % 3) % 3];
}

// 方向由显式的屏幕顺时针座位表解释，绝不偷偷把 seat + 1 当作顺时针。
// Interpret direction using an explicit clockwise seat layout, never silently equating seat + 1 with clockwise.
export function chengduExchangeRecipient(seat, direction, clockwiseSeats) {
  if (!Array.isArray(clockwiseSeats) || clockwiseSeats.length !== 4 ||
    new Set(clockwiseSeats).size !== 4 || clockwiseSeats.some((item) => !Number.isInteger(item) || item < 0 || item > 3) ||
    !Number.isInteger(seat) || seat < 0 || seat > 3 || !CHENGDU_EXCHANGE_CYCLE.includes(direction)) {
    throw new TypeError('换牌方向或四人座位映射无效');
  }
  const offset = { clockwise: 1, opposite: 2, counterclockwise: 3 }[direction];
  return clockwiseSeats[(clockwiseSeats.indexOf(seat) + offset) % 4];
}

// 本局计划不原地推进游标；房间层须把新局和 nextExchangeOrdinal 同一次 CAS 保存。
// Planning never mutates a cursor; rooms must persist the game and nextExchangeOrdinal in one successful CAS.
// 不开启换三张的局、读取、重连和失败开局都不消耗轮回；序号溢出明确拒绝。
// Disabled rounds, reads, reconnects and failed starts consume no cycle position; reject counter overflow explicitly.
export function planChengduExchangeRound({ exchangeThree, exchangeOrdinal, clockwiseSeats } = {}) {
  if (typeof exchangeThree !== 'boolean' || !Number.isSafeInteger(exchangeOrdinal) || exchangeOrdinal < 0 ||
    (exchangeThree && exchangeOrdinal === Number.MAX_SAFE_INTEGER)) {
    throw new TypeError('换牌轮回需要明确开关及安全的已开换牌局数');
  }
  if (!exchangeThree) return { exchangeOrdinal, nextExchangeOrdinal: exchangeOrdinal, exchangePlan: null };
  const direction = chengduExchangeDirection('clockwise', exchangeOrdinal);
  chengduExchangeRecipient(0, direction, clockwiseSeats);
  return {
    exchangeOrdinal, nextExchangeOrdinal: exchangeOrdinal + 1,
    exchangePlan: { direction, clockwiseSeats: [...clockwiseSeats], sameSuitRequired: true },
  };
}

// 用户规则已确认；保留旧错误字段供原型调用方兼容，不能当作正式入口许可。
// User rules are resolved; retain the legacy error field for draft callers, never as production-entry permission.
export const CHENGDU_RULE_GAPS = Object.freeze([]);

// 错误只携带公开缺口代码，不附带原始牌局、手牌、凭证或私有回应。
// Errors carry public gap identifiers only, never raw games, hands, credentials or private responses.
export class ChengduRulesPendingError extends Error {
  constructor(operation) {
    const label = { start: '开局', settlement: '结算', scoring: '计分', dealer: '下局庄家' }[operation] ?? '规则操作';
    super(`成都${label}不能使用旧准备入口：须通过独立正式引擎`);
    this.name = 'ChengduRulesPendingError';
    this.code = 'CHENGDU_RULES_PENDING';
    this.status = 409;
    this.operation = operation;
    this.gaps = [...CHENGDU_RULE_GAPS];
  }
}

// 不读取或改变输入，且没有 force/approved 旁路；生产启动和结算都必须失败关闭。
// Do not read or mutate input and provide no force/approved bypass; production start and settlement fail closed.
export function requireChengduRules(operation) {
  throw new ChengduRulesPendingError(operation);
}
