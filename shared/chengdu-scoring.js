/**
 * 成都已确认番型的纯计分入口；只读取本人的完整手牌、副露和明确选项。
 * Pure scoring for confirmed Chengdu patterns, reading only own complete hand, melds and explicit options.
 * 不选择付款人、不改变积分；清一色与特殊牌型组合按已确认规则额外加两番。
 * Never choose payers or mutate scores; confirmed pure-suit combinations add two fan.
 */
import { CHENGDU_SUITS, inspectChengduHand, hasDingqueTiles } from './chengdu-hand.js';
import { CHENGDU_TILE_SET } from './tile-sets.js';
import { validateChengduScoringOptions, chengduWinPoints } from './chengdu-contract.js';

// 配置错误必须抛出，而不是伪装成“不胡”；不为遗漏的定缺或计分选项补默认。
// Throw configuration errors rather than disguising them as losing shapes; never default missing dingque or scoring.
function validateInputs(dingqueSuit, scoringOptions, isSelfDraw, pureSuitStacking) {
  const scoring = validateChengduScoringOptions(scoringOptions);
  if (!CHENGDU_SUITS.includes(dingqueSuit) || typeof isSelfDraw !== 'boolean') {
    throw new TypeError('计分需要明确的定缺与自摸标记');
  }
  // 旧开发调用方可继续显式传 addTwo，但不得用旧 highestOnly 改写已确认规则。
  // Existing development callers may still pass addTwo, but highestOnly cannot override the confirmed rule.
  if (pureSuitStacking !== undefined && pureSuitStacking !== 'addTwo') {
    throw new TypeError('清一色组合策略无效');
  }
  return scoring;
}

// 返回独立的番分明细或 null；结构校验唯一来源是 hand 模块，先校验再读取副露定缺。
// Return a detached breakdown or null; the hand module alone validates shapes, before dingque inspects melds.
// fan 保留封顶前且自摸修正前的牌型加根数，points 才应用自摸与封顶数学。
// fan is pattern plus roots before caps/self-draw; only points applies self-draw and cap arithmetic.
export function calculateChengduScore(hand, melds, dingqueSuit, scoringOptions, {
  isSelfDraw = false,
  pureSuitStacking,
} = {}) {
  const scoring = validateInputs(dingqueSuit, scoringOptions, isSelfDraw, pureSuitStacking);
  if (!Array.isArray(melds)) return null;
  const shape = inspectChengduHand(hand, melds);
  if (!shape.standard && !shape.sevenPairs) return null;
  if (hasDingqueTiles(hand, melds, dingqueSuit)) return null;

  // 七对独立择型；金钩钓已包含对对胡，不能重复加番。
  // Seven pairs is an independent choice; golden hook already includes all-triplets and cannot count it twice.
  let pattern = 'regular';
  let baseFan = 1;
  if (shape.sevenPairs) {
    pattern = 'sevenPairs';
    baseFan = 3;
  } else if (melds.length === 4) {
    pattern = 'goldenHook';
    baseFan = 3;
  } else if (shape.allTriplets) {
    pattern = 'allTriplets';
    baseFan = 2;
  }

  if (shape.pureSuit) {
    if (pattern === 'regular') {
      pattern = 'pureSuit';
      baseFan = 3;
    } else {
      // 清一色额外加两番是已确认玩法；金钩钓与七对仍不重复套用对对胡。
      // Pure suit adds the confirmed two fan; golden hook and seven pairs still exclude duplicate triplet bonuses.
      pattern = `pureSuit${pattern[0].toUpperCase()}${pattern.slice(1)}`;
      baseFan += 2;
    }
  }

  const fan = baseFan + shape.roots;
  return {
    pattern,
    baseFan,
    roots: shape.roots,
    fan,
    points: chengduWinPoints(fan, isSelfDraw, scoring),
    isSelfDraw,
  };
}

// 对27种候选逐一复用完整计分；拒绝第五张等结构非法牌，不读取牌墙或他人的牌。
// Reuse complete scoring for each of 27 candidates, rejecting fifth copies without reading walls or opponents.
// 查叫使用接炮基础值，包含清一色组合加番，不附加任何自摸分。
// Wait pricing includes pure-suit combinations without any self-draw adjustment.
export function getChengduWaitScores(hand, melds, dingqueSuit, scoringOptions, { pureSuitStacking } = {}) {
  validateInputs(dingqueSuit, scoringOptions, false, pureSuitStacking);
  if (!Array.isArray(hand)) return [];
  const waits = [];
  for (const { tile } of CHENGDU_TILE_SET.tiles) {
    const score = calculateChengduScore([...hand, tile], melds, dingqueSuit, scoringOptions, { pureSuitStacking });
    if (score) waits.push({ tile, ...score });
  }
  return waits;
}
