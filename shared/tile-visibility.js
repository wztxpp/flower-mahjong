// 只读展示隐私：房间视图与个人历史共用，不参与胡牌、计分或存档迁移。
// Read-only display privacy shared by room views and profile history, never scoring or save migration.
// 仅新 schema 3 的明确快照启用；旧版本与缺字段存档保留原行为。
// Only explicit new schema-three snapshots opt in; older schemas and missing flags retain their behavior.
export function hidesPrivateWinDetails(game, ownerSeat, viewerSeat) {
  return game.schemaVersion === 3 && game.rules?.hideSelfDrawWins === true &&
    game.phase !== 'finished' && ownerSeat !== viewerSeat;
}

// 公开算分摘要采用类型白名单；保留番数/来源标签，但不复制牌数、听口或未知嵌套数据。
// Public score summaries use a typed allowlist: retain fan/source labels, never tile counts, waits or unknown nested data.
// 公开金额仍可供玩家推理；此边界防止直接泄露牌种元数据，不承诺阻止数学推断。
// Public amounts still support deductions; this boundary prevents direct tile metadata exposure, not mathematical inference.
export function visibleScoreSummary(score) {
  if (!score || typeof score !== 'object') return null;
  const result = {};
  for (const key of ['base', 'fan', 'fanPoints', 'copyFanBonus', 'radishBonus', 'dragonBonus',
    'total', 'bigSinglePoints', 'robKongBonus', 'kongReplacementBonus', 'kongDiscardBonus']) {
    if (typeof score[key] === 'number' && Number.isFinite(score[key])) result[key] = score[key];
  }
  for (const key of ['bigSingle', 'sevenPairsFixed']) {
    if (typeof score[key] === 'boolean') result[key] = score[key];
  }
  if (['exclusive', 'additive', 'fan'].includes(score.overlapPolicy)) result.overlapPolicy = score.overlapPolicy;
  if ([null, 'sevenPairs', 'bigSingle'].includes(score.specialHuPattern)) result.specialHuPattern = score.specialHuPattern;
  const types = ['sevenPairs', 'pureSuit', 'bigSingle', 'allTriplets', 'robKong', 'kongReplacement', 'kongDiscard'];
  if (Array.isArray(score.patternBonuses)) {
    result.patternBonuses = score.patternBonuses
      .filter((bonus) => bonus && types.includes(bonus.type) && typeof bonus.fan === 'number' && Number.isFinite(bonus.fan))
      .map((bonus) => ({ type: bonus.type, fan: bonus.fan }));
  }
  return result;
}

// 从服务端事件构造座位视图。对手全部胡牌计分明细均过滤，因为后续接炮计分仍可能包含先前自摸牌。
// Project an authoritative event for one seat. Filter all opponent win breakdowns: later discard wins can still count earlier private self-draws.
// 金额、转账和公共萝卜保持可审计；牌面、文字及可扩展元数据不能成为旁路。
// Keep amounts, transfers and public radishes auditable; tile faces, prose and extensible metadata must not bypass privacy.
export function visibleHistoryEvent(game, event, viewerSeat) {
  if (!hidesPrivateWinDetails(game, event.seat, viewerSeat)) return structuredClone(event);
  // 旧/异常摸牌记录也不能在牌桌历史带出牌种；本人投影仍保留原记录。
  // Legacy or malformed draw records must not expose an opponent tile through room history; owners keep the original.
  if (event.type === 'draw') {
    return {
      revision: event.revision,
      type: event.type,
      seat: event.seat,
      source: event.source,
      message: `${event.seat + 1}号位${event.source === 'replacement' ? '杠后补牌' : event.source === 'continuation' ? '胡后补摸' : '摸了一张牌'}。`,
    };
  }
  if (event.type !== 'hu') return structuredClone(event);
  if (event.source !== 'selfDraw') {
    const result = structuredClone(event);
    if (result.score !== undefined) result.score = visibleScoreSummary(result.score);
    return result;
  }
  const result = {};
  // 白名单只留动作身份和公开账本；不复制未来可能携带暗牌的未知字段。
  // Allowlist identity and public ledger fields, not future unknown fields that might carry private tiles.
  for (const key of ['revision', 'type', 'seat', 'source', 'fromSeat', 'points', 'payments', 'newRadishes']) {
    if (event[key] !== undefined) result[key] = structuredClone(event[key]);
  }
  if (event.kongSource) {
    result.kongSource = { type: event.kongSource.type, fromSeat: event.kongSource.fromSeat };
  }
  return {
    ...result,
    tile: null,
    hidden: true,
    score: visibleScoreSummary(event.score),
    message: `${event.seat + 1}号位自摸（牌面隐藏），本次每位付款方付${event.points}分。`,
  };
}
