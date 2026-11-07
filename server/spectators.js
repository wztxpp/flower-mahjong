// 观战是独立只读能力，不是座位。签名凭证只验证本房间，不链接个人成绩或参与播放屏障。
// Spectating is an independent read-only capability, never a seat, profile record or presentation participant.
// 房间仅保存一个服务端签名秘密，人数不增加存储；每次入场产生独立随机凭证，绝不进入公开投影。
// One private signing secret per room keeps storage bounded; each admission gets a fresh random credential, never exposed in projections.
import { visibleScoreSummary } from '../shared/tile-visibility.js';
import { publicEvents } from './history.js';

const encoder = new TextEncoder();
const hex = (bytes) => Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
const bytesFromHex = (value) => Uint8Array.from(value.match(/../g), (byte) => parseInt(byte, 16));

// 用 Web Crypto HMAC 验签，不把座位凭证、昵称或房间号当作观战身份。
// Web Crypto verifies HMAC signatures; seat credentials, nicknames and room codes are not spectator identities.
async function signingKey(room) {
  return crypto.subtle.importKey('raw', encoder.encode(room.spectatorKey),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

// 为本次入场签发独立随机能力；调用者已通过房间入场检查，返回值只交给该观众。
// Issue a fresh random capability after room admission; return it only to that viewer.
export async function issueSpectatorToken(room) {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(32)));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(room), encoder.encode(`${room.id}:${nonce}`));
  return `watch.${nonce}.${hex(new Uint8Array(signature))}`;
}

// 区分格式与授权：任何伪造、跨房间或缺少签名秘密的 token 都失败，不回退到玩家身份。
// Distinguish syntax from authorization: forged/cross-room tokens and missing keys fail without player fallback.
export async function authenticatesSpectator(room, token) {
  const match = typeof token === 'string' && token.match(/^watch\.([a-f0-9]{64})\.([a-f0-9]{64})$/);
  if (!match || !room.spectatorKey) return false;
  return crypto.subtle.verify('HMAC', await signingKey(room), bytesFromHex(match[2]), encoder.encode(`${room.id}:${match[1]}`));
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
export function spectatorGameView(game) {
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
    history: publicEvents(privacyGame).map(publicLedger).map((event) => {
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
