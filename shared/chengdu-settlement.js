/**
 * 成都流局付款计划：先完整计算，再由回合层原子入账；此模块不改变牌或积分。
 * Chengdu draw payment plans are computed completely before atomic runtime posting; this module mutates no tiles or scores.
 * 花猪按最新用户确认赔每位非花猪 min(16,封顶)；查叫与退杠按最新确认；首胡与血战无人胡流局采用同样三项结算。
 * Confirmed missing-suit penalties pay each non-offender min(16, cap); ready/refund rules follow confirmation; first-win and blood-battle exhausted draws use the same three settlements.
 */
import { chengduCapPoints } from './chengdu-contract.js';
import { hasDingqueTiles } from './chengdu-hand.js';
import { getChengduWaitScores } from './chengdu-scoring.js';

// 以本人手牌计算每位未胡者的最高听牌分，不读取墙牌；已胡者不是查叫付款/收款候选。
// Compute each unwon player's maximum own-hand wait value without wall knowledge; winners are excluded from ready checks.
export function classifyChengduDrawPlayers(game) {
  const options = { selfDraw: game.rules.selfDraw, fanCap: game.rules.fanCap };
  return game.players.map((player) => {
    const flowerPig = hasDingqueTiles(player.hand, player.melds, player.dingqueSuit);
    const waits = player.won || flowerPig ? [] : getChengduWaitScores(
      player.hand, player.melds, player.dingqueSuit, options,
      { pureSuitStacking: game.playPolicy.pureSuitStacking },
    );
    return {
      seat: player.seat, won: player.won !== null, flowerPig,
      ready: waits.length > 0, maximumPoints: waits.length ? Math.max(...waits.map((wait) => wait.points)) : null,
    };
  });
}

// 只返回虚拟分转账和已存在的杠账引用；未决项存在时调用方必须整批不提交。
// Return virtual transfers and existing kong-ledger references only; any gap means the caller must post none of the plan.
export function buildChengduDrawSettlement(game) {
  const classifications = classifyChengduDrawPlayers(game);
  const payments = [];
  const refundIds = [];
  const gaps = [];
  // 固定花猪赔付与听牌/已胡状态无关，唯独花猪之间不赔；自摸加底不叠加此罚分。
  // The fixed penalty ignores recipients' readiness/win status, excludes other offenders, and never adds self-draw base points.
  const flowerPigPoints = Math.min(16, chengduCapPoints(game.rules.fanCap));
  for (const payer of classifications.filter((player) => player.flowerPig)) {
    for (const recipient of classifications.filter((player) => !player.flowerPig)) {
      payments.push({ from: payer.seat, to: recipient.seat, points: flowerPigPoints, reason: 'flowerPig' });
    }
  }
  const readyPlayers = classifications.filter((player) => !player.won && !player.flowerPig && player.ready);
  // 花猪已经承担固定赔付，不再重复加入查叫付款人；其余未听者赔给各听牌者的最高可胡分。
  // Offenders already pay their fixed penalty and do not also pay ready checks; other non-ready players pay each ready maximum.
  const notReadyPlayers = classifications.filter((player) => !player.won && !player.ready && !player.flowerPig);
  for (const payer of notReadyPlayers) {
    for (const recipient of readyPlayers) {
      payments.push({ from: payer.seat, to: recipient.seat, points: recipient.maximumPoints, reason: 'notReady' });
    }
  }
  const refundableKongs = game.kongLedger.filter((kong) => !kong.refunded && !classifications[kong.seat].won);
  // 用户确认花猪和未听牌者都退还全部已收杠分，逐笔退给原付款人，不按现时剩余座位重新分配。
  // Confirmed offenders and non-ready players refund all received kong payments to their original payers, not current active seats.
  for (const kong of refundableKongs) {
    const recipient = classifications[kong.seat];
    if (recipient.ready) continue;
    refundIds.push(kong.id);
    for (const payment of kong.payments) {
      payments.push({ from: payment.to, to: payment.from, points: payment.points, reason: 'kongRefund', kongId: kong.id });
    }
  }
  return { classifications, payments, refundIds, gaps };
}
