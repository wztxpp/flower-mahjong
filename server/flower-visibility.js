/**
 * 花麻将三代的只读公开投影：历史白名单与观战遮牌在这里保持既有语义。
 * Read-only projections for all Flower versions: preserve historical event allowlists and spectator masking here.
 * 不适用于成都；新模式必须登记自己的 publicEvents/spectatorView，不能只改牌数后复用。
 * Not a Chengdu projection: new modes must register their own publicEvents/spectatorView, not merely change tile counts.
 * 本模块不导入房间/注册器，避免记录层、模式层和观战层相互循环依赖。
 * No room/registry imports: history, mode dispatch and spectator projections remain acyclic.
 */
import { nameEvent } from '../shared/event-names.js';
import { visibleHistoryEvent, visibleScoreSummary } from '../shared/tile-visibility.js';

// Explicit public-event fields avoid copying a future engine's private fields.
// 公开事件用白名单复制字段，防止未来新增私人字段被自动带出。
// Copy public events through an allowlist so future private fields cannot leak automatically.
export function flowerPublicEvents(game, viewerSeat = null, participantNames = []) {
  const allowed = [
    'revision',
    'type',
    'seat',
    'source',
    'message',
    'tile',
    'fromSeat',
    'points',
    'payments',
    'score',
    'newRadishes',
    'radish',
    'reason',
    'automatic',
    'afterKong',
    'dragons',
    'kongSource',
    'kongType',
    'radishDeferred',
    'pendingKongRadishes',
    'hidden',
  ];
  return (game.history || []).map((storedEvent) => {
    // 个人历史也有座位权限；进行中不能从大厅记录绕过牌桌遮牌。
    // Profile history has seat permissions too; lobby records must not bypass live-table masking.
    const event = visibleHistoryEvent(game, storedEvent, viewerSeat);
    const result = {};
    // 摸牌事件即使含 tile 也不复制；其他允许字段深拷贝，避免共享可变对象。
    // Never copy a draw tile; deep-clone other allowed values to avoid shared mutable objects.
    for (const key of allowed)
      if (event[key] !== undefined && !(event.type === 'draw' && key === 'tile'))
        result[key] = structuredClone(event[key]);
    // 重新生成摸牌文案，防止旧引擎的原始 message 暴露摸到的牌。
    // Rebuild draw messages so original engine text cannot reveal the drawn tile.
    if (event.type === 'draw')
      result.message = `${Number.isInteger(event.seat) ? event.seat + 1 : ''}号位${event.source === 'replacement' ? '杠后补牌' : event.source === 'continuation' ? '胡后补摸' : '摸了一张牌'}。`;
    return nameEvent(result, participantNames);
  });
}
// 账本的嵌套集合也逐项白名单，不允许未来字段把暗牌或凭证夹带在 payments/dragons 中。
// Nested ledger collections also use allowlists so future fields cannot smuggle tiles or credentials in payments/dragons.
function publicLedger(entry) {
  const result = { ...entry };
  if (entry.payments) result.payments = entry.payments.map((payment) => ({ seat: payment.seat, delta: payment.delta }));
  if (entry.dragons) result.dragons = entry.dragons.map((dragon) => ({ tile: dragon.tile, count: dragon.count, points: dragon.points }));
  if (entry.kongSource) result.kongSource = { type: entry.kongSource.type, fromSeat: entry.kongSource.fromSeat };
  if (entry.newRadishes) result.newRadishes = entry.newRadishes.filter((tile) => Number.isInteger(tile) && tile >= 0 && tile < 18);
  if (entry.score) result.score = visibleScoreSummary(entry.score);
  return result;
}

// 明确选择可公开字段；不能先取得某个座位的私有视图再靠删几个字段变成观战。
// Select public fields explicitly, rather than taking a player's private view and deleting a few known secrets.
// 所有旧版本的观战也隐藏进行中的自摸和诊断；既有玩家规则/存档仍保持原样。
// Spectators of every version hide live self-draw wins and diagnostics; existing player rules/saves stay unchanged.
export function flowerSpectatorGameView(game) {
  const finished = game.phase === 'finished';
  const publicKongs = game.schemaVersion === 3 && game.rules?.publicConcealedKongs === true;
  const privacyGame = { ...game, schemaVersion: 3, rules: { ...game.rules, hideSelfDrawWins: true } };
  return {
    schemaVersion: game.schemaVersion ?? 1,
    phase: game.phase,
    turnStep: game.turnStep,
    currentSeat: game.currentSeat,
    dealerSeat: game.dealerSeat ?? 0,
    wallCount: game.wall.length,
    revision: game.revision,
    rules: structuredClone(game.rules),
    mySeat: null,
    sharedRadishes: game.players.flatMap((player) => player.radishes),
    firstHuRadishesRevealed: game.firstHuRadishesRevealed,
    pendingKongRadishes: game.pendingKongRadishes ?? 0,
    dragonSettlement: game.dragonSettlement ? {
      settled: game.dragonSettlement.settled,
      entries: game.dragonSettlement.entries.map((entry) => publicLedger({
        seat: entry.seat, points: entry.points, dragons: entry.dragons, payments: entry.payments,
      })),
    } : null,
    players: game.players.map((player, seat) => ({
      seat,
      handCount: player.hand.length,
      melds: player.melds.map((meld) => {
        const hidden = meld.type === 'anGang' && !publicKongs;
        return {
          type: meld.type,
          tile: hidden ? null : meld.tile,
          tiles: hidden ? Array(meld.tiles.length).fill(null) : [...meld.tiles],
          ...(hidden ? { hidden: true } : {}),
          ...(meld.extended ? { extended: true } : {}),
        };
      }),
      winPile: (player.winPile || []).map((win) => ({
        source: win.source,
        virtual: win.virtual,
        ...(win.source === 'selfDraw' && !finished ? { tile: null, hidden: true } : { tile: win.tile }),
      })),
      radishes: [...player.radishes],
      score: player.score,
      huCount: player.huCount,
      kongCount: player.kongCount ?? 0,
      // 即使终局也只给公开摘要；终局公开胡牌区，不等于公开暗手的完整计分输入。
      // Even after finish expose public summaries only: revealed win piles do not grant concealed-hand scoring inputs.
      lastScoreBreakdown: visibleScoreSummary(player.lastScoreBreakdown),
    })),
    discards: game.discards.map((discard) => ({
      seat: discard.seat,
      tile: discard.tile,
      ...(discard.claimedBy !== undefined ? { claimedBy: discard.claimedBy, claimedAs: discard.claimedAs } : {}),
      ...(discard.huSeats ? { huSeats: [...discard.huSeats] } : {}),
      ...(discard.afterKong ? { afterKong: true } : {}),
    })),
    retiredTiles: game.retiredTiles.map((record) =>
      finished ? { seat: record.seat, tile: record.tile } : { seat: record.seat, tile: null, hidden: true },
    ),
    history: flowerPublicEvents(privacyGame).map(publicLedger).map((event) => {
      // 旧版本暗杠事件不可绕过副露遮牌；未知扩展字段已由 publicEvents 白名单剔除。
      // Old concealed-kong events cannot bypass meld masking; publicEvents already removes unknown extension fields.
      if (['anGang', 'addGang'].includes(event.type) && !publicKongs) {
        return { ...event, tile: null, hidden: true, message: `${event.seat + 1}号位${event.type === 'anGang' ? '暗杠' : '加杠'}（牌面隐藏）。` };
      }
      return event;
    }),
    claim: game.claim ? {
      discardSeat: game.claim.discardSeat,
      tile: game.claim.tile,
      ...(game.claim.kind === 'robKong' ? { kind: 'robKong', kongType: game.claim.kongType } : {}),
    } : null,
    legalActions: [],
    drawnTile: null,
    waitTiles: [],
    lockedWaits: [],
    huLockActive: false,
    huDiagnostic: null,
    scoreBreakdown: null,
    finishReason: game.finishReason,
  };
}
