/**
 * 终局只读白名单：注册表分别选择花麻将/成都投影，不改规则、牌区、旧视图或已结算账。
 * Finished-only allowlists: the registry selects Flower/Chengdu projections without changing rules, zones, old views or ledgers.
 * 只有服务器确认 finished 才公开实际剩余手牌；胡牌引用另列，不能拼回手牌或重新计分。
 * Only authoritative finished games reveal remaining hands; win references stay separate, never appended or rescored.
 */

// 缺失旧字段明确为 null；0 是已有真实记录，不从缺字段或胡牌日志长度猜计数。
// Missing legacy fields are null; zero must be recorded, never guessed from absent fields or event counts.
function recordedNumber(value) {
  return Number.isFinite(value) ? value : null;
}

// 仅复制牌区的已定义公开字段；不展开可能夹带听口、凭证或未来私有诊断的原对象。
// Copy only defined tile-zone fields, not entire objects that may gain waits, credentials or private diagnostics.
function finalTiles(player, seat) {
  return {
    seat,
    roundScore: recordedNumber(player.score),
    finalHand: Array.isArray(player.hand) ? [...player.hand] : null,
    melds: Array.isArray(player.melds) ? player.melds.map((meld) => ({
      type: meld.type,
      tile: meld.tile,
      tiles: [...meld.tiles],
      ...(Number.isInteger(meld.fromSeat) ? { fromSeat: meld.fromSeat } : {}),
      ...(meld.extended === true ? { extended: true } : {}),
    })) : null,
  };
}

// 不适用与缺记录不同：成都没有花麻将神龙，旧花麻将却有无法还原组数的逐次胡牌奖分。
// Not applicable differs from unavailable: Chengdu has no Flower dragons; legacy Flower bonuses cannot reconstruct group counts.
function absentDragons(status) {
  return { status, count: null, details: null, pointsPerOpponent: null, payments: null };
}

// 只读 v3 已完成的真实结算；未出现本席记录才代表确定的零组，不从最终牌面重新推算。
// Read only completed v3 settlement records: an absent seat entry then means zero groups, never recompute from final tiles.
function settledDragons(game, seat, schemaVersion) {
  const settlement = game.dragonSettlement;
  if (schemaVersion !== 3 || settlement?.settled !== true || !Array.isArray(settlement.entries)) {
    return absentDragons('unavailable');
  }
  const entries = settlement.entries.filter((entry) => entry.seat === seat);
  const details = entries.flatMap((entry) => entry.dragons.map((dragon) => ({
    tile: dragon.tile,
    count: dragon.count,
    pointsPerOpponent: dragon.points,
  })));
  return {
    status: 'settled',
    count: details.length,
    details,
    // points 是每位他家所付，不是本席净收入；payments 只属于本席收神龙的真实记录。
    // Stored points are charged per opponent, not net profit; payments belong only to this seat's dragon receipts.
    pointsPerOpponent: entries.reduce((sum, entry) => sum + entry.points, 0),
    payments: entries.flatMap((entry) => entry.payments.map((payment) => ({
      seat: payment.seat,
      delta: payment.delta,
    }))),
  };
}

// v1 没有胡牌区，只能列出实际 hu 事件；v2/v3 用持久胡牌区，绝不把缺记录补成“未胡”。
// v1 has no win pile, so use recorded hu events; v2/v3 use persisted piles and never turn missing records into no wins.
function flowerWins(game, player, seat, schemaVersion) {
  const wins = schemaVersion === 1
    ? (Array.isArray(game.history) ? game.history.filter((event) => event.type === 'hu' && event.seat === seat) : null)
    : player.winPile;
  if (!Array.isArray(wins)) return null;
  return wins.map((win) => ({
    tile: win.tile,
    source: win.source,
    inHand: false,
    ...(Number.isInteger(win.fromSeat) ? { fromSeat: win.fromSeat } : {}),
    ...(typeof win.virtual === 'boolean' ? { virtual: win.virtual } : {}),
  }));
}

// 每个花麻将版本由注册表显式传入版本；此处只展示终局，不导入或合并三份规则引擎。
// The registry supplies each Flower version explicitly; display only, without importing or merging the three engines.
export function flowerRoundSummary(game, schemaVersion) {
  if (game.phase !== 'finished') return null;
  return {
    gameMode: 'flower',
    schemaVersion,
    finishReason: game.finishReason ?? null,
    players: game.players.map((player, seat) => ({
      ...finalTiles(player, seat),
      huCount: recordedNumber(player.huCount),
      wins: flowerWins(game, player, seat, schemaVersion),
      dragons: settledDragons(game, seat, schemaVersion),
    })),
  };
}

// 成都自摸胡牌仍在 hand，接炮/抢杠牌在弃牌区；inHand 防止客户端把第14张重复添加。
// Chengdu keeps self-draw wins in hand and discard/rob-kong wins in the river; inHand prevents duplicating a fourteenth tile.
export function chengduRoundSummary(game) {
  if (game.phase !== 'finished') return null;
  return {
    gameMode: 'chengdu',
    schemaVersion: game.schemaVersion,
    finishReason: game.finishReason ?? null,
    players: game.players.map((player, seat) => ({
      ...finalTiles(player, seat),
      huCount: player.won === null ? 0 : player.won ? 1 : null,
      wins: player.won === null ? [] : player.won ? [{
        tile: player.won.tile,
        source: player.won.source,
        fromSeat: player.won.fromSeat,
        inHand: player.won.source === 'selfDraw',
      }] : null,
      dragons: absentDragons('notApplicable'),
    })),
  };
}
