/**
 * 成都正式存档边界：schema 2 与未发布 schema 1 原型严格分离，不接受改一个布尔标记来升级。
 * Production Chengdu save boundary: schema two is separate from unpublished schema-one drafts, never upgraded by flipping a boolean.
 * 固定已确认策略、四座位几何、轮回和展示快照；只做纯校验，不读写房间或改旧局。
 * Validate confirmed policy, seat geometry, exchange and visibility snapshots without storage effects or save migration.
 */
import { planChengduExchangeRound } from './chengdu-contract.js';
import { validateChengduPlayPolicy } from './chengdu-play-policy.js';

export const CHENGDU_SCHEMA_VERSION = 2;
export const CHENGDU_RULES_VERSION = 'chengdu-1';

// 屏幕下→左→上→右为顺时针；正常行牌逆时针，因此0号后轮到3号。
// Screen bottom/left/top/right is clockwise; normal counterclockwise play therefore advances from seat zero to three.
export function chengduProductionPolicy() {
  return {
    clockwiseSeats: [0, 1, 2, 3], turnDirection: 'counterclockwise', simultaneousWins: 'all',
    afterDiscardWin: 'singleWinnerNextMultipleDiscarder', passedWins: 'untilOwnDraw', pureSuitStacking: 'addTwo',
    claimsRequireClearDingque: false, kongsAfterPeng: 'afterDiscard',
    kongPoints: { anGang: 2, mingGang: 2, buGang: 1 }, drawReadyCheck: 'notReadyPaysReady',
    flowerPigPaysReadyCheck: false, kongRefund: 'notReadyOrFlowerPig', firstWinDrawSettlement: 'sameAsBloodBattle',
  };
}

// 正式规则沿用已有展示基线：暗杠公开、自摸牌进行中仅本人可见、终局公开；其余暗手不公开。
// Production follows existing presentation: public established concealed kongs and owner-only self-draw tiles until finish; other hands remain private.
export function chengduProductionVisibility() {
  return { turnDirection: 'counterclockwise', publicConcealedKongs: true, hideSelfDrawWins: true };
}

// 不依赖对象键排列比较固定快照，仍拒绝缺字段、额外策略和不同数组顺序。
// Compare fixed snapshots independent of object-key order, rejecting missing/extra fields and changed array order.
function sameSnapshot(actual, expected) {
  if (expected === null || typeof expected !== 'object') return actual === expected;
  if (!actual || typeof actual !== 'object' || Array.isArray(actual) !== Array.isArray(expected)) return false;
  return Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && sameSnapshot(actual[key], value));
}

// 仅版本头可用于已裁剪历史分发；完整牌局还必须调用下方验证及回合不变量。
// The header alone selects sanitized history; complete games additionally require snapshot and runtime invariant validation.
export function isChengduProductionHeader(game) {
  return game?.gameMode === 'chengdu' && game.schemaVersion === CHENGDU_SCHEMA_VERSION &&
    game.rulesVersion === CHENGDU_RULES_VERSION && game.runtimeKind === 'production' &&
    !Object.hasOwn(game, 'developmentOnly') && !Object.hasOwn(game, 'developmentStage');
}

// 保存必须含开局快照和与轮回相符的交换计划；不从当前默认值补写缺少的旧存档字段。
// Saves must retain exact start snapshots and a matching exchange plan; never backfill missing fields from today's defaults.
export function assertChengduProductionSnapshot(game) {
  if (!isChengduProductionHeader(game) || !['preparation', 'play'].includes(game.stage)) {
    throw new Error('不是支持的成都正式存档');
  }
  validateChengduPlayPolicy(game.playPolicy);
  if (!sameSnapshot(game.playPolicy, chengduProductionPolicy())) throw new Error('成都正式行牌策略无效');
  for (const [key, value] of Object.entries(chengduProductionVisibility())) {
    if (game.rules?.[key] !== value) throw new Error('成都正式展示快照缺失或无效');
  }
  const round = planChengduExchangeRound({
    exchangeThree: game.rules.exchangeThree, exchangeOrdinal: game.exchangeOrdinal,
    clockwiseSeats: game.playPolicy.clockwiseSeats,
  });
  if (game.nextExchangeOrdinal !== round.nextExchangeOrdinal ||
    !sameSnapshot(game.preparation?.exchangePlan, round.exchangePlan)) throw new Error('成都换牌轮回快照无效');
  return true;
}

// 内部状态机同时验证原型和正式局；HTTP只经正式入口，不能把原型当成版本兼容。
// Internal mechanics validate draft and production games; HTTP must use the production entry, never draft-version fallback.
export function assertChengduStateIdentity(game) {
  if (isChengduProductionHeader(game)) return assertChengduProductionSnapshot(game);
  if (!game || game.gameMode !== 'chengdu' || game.schemaVersion !== 1 || game.developmentOnly !== true ||
    Object.hasOwn(game, 'runtimeKind') || Object.hasOwn(game, 'rulesVersion') || Object.hasOwn(game, 'stage')) {
    throw new Error('成都状态版本无效');
  }
  return true;
}

// 投影不复制任意元数据；原型只显示原型标记，正式只显示正式版本与阶段。
// Project only known metadata: draft markers for drafts, production version/stage for production.
export function chengduStateHeader(game) {
  if (isChengduProductionHeader(game)) return {
    gameMode: 'chengdu', schemaVersion: CHENGDU_SCHEMA_VERSION, rulesVersion: CHENGDU_RULES_VERSION,
    runtimeKind: 'production', stage: game.stage,
  };
  return { gameMode: 'chengdu', schemaVersion: 1, developmentOnly: true,
    ...(game.developmentStage ? { developmentStage: game.developmentStage } : {}) };
}
