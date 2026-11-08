// 终局总览的纯展示适配：只接收服务端明确提供的终局摘要，不读取历史拼账或猜测对手手牌。
// Pure finished-round display adapter: use explicit server summaries, never reconstruct ledgers or infer concealed hands.
import { tilePresentation } from './mahjong-tile-presentation.js';

// 保留零和负数；缺值与非法值显示“未记录”，不能用 Number(null) 或 || 0 补成真实零。
// Preserve zero/negative values; absent or invalid values stay unavailable rather than becoming a fabricated zero.
function recordedNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function recordedCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

// 每个牌区单独复制；有非法牌种时整区标记缺记录，避免静默删牌制造错误的终局手牌。
// Copy each card zone; an invalid identity marks the zone unavailable instead of silently dropping a terminal tile.
function recordedTiles(tiles) {
  return Array.isArray(tiles) && tiles.every((tile) => tilePresentation(tile)) ? [...tiles] : null;
}

// 输入完整已显示房间快照，输出仅用于排版的副本；双重终局门保护迟到或混合阶段的响应。
// Accept the full displayed room snapshot and return a display copy; both finish gates reject late/mixed-phase data.
export function roundSummaryView(state) {
  const game = state?.game;
  const summary = game?.roundSummary;
  if (state?.phase !== 'finished' || game?.phase !== 'finished' || !summary) return null;
  const gameMode = game.gameMode ?? state.gameMode ?? 'flower';
  if (!['flower', 'chengdu'].includes(gameMode) || summary.gameMode !== gameMode || !Array.isArray(summary.players)) return null;
  const seenSeats = new Set();
  const players = summary.players.flatMap((player) => {
    if (!Number.isInteger(player?.seat) || player.seat < 0 || seenSeats.has(player.seat)) return [];
    seenSeats.add(player.seat);
    const dragonStatus = gameMode === 'chengdu' ? 'notApplicable'
      : player.dragons?.status === 'settled' ? 'settled' : 'unavailable';
    return [{
      seat: player.seat,
      name: typeof player.name === 'string' && player.name.trim() ? player.name : `${player.seat + 1}号位`,
      huCount: recordedCount(player.huCount),
      roundScore: recordedNumber(player.roundScore),
      tableScore: recordedNumber(player.tableScore),
      finalHand: recordedTiles(player.finalHand),
      melds: Array.isArray(player.melds) ? player.melds.map((meld) => ({
        type: meld?.type,
        tiles: recordedTiles(meld?.tiles),
      })) : null,
      wins: Array.isArray(player.wins) ? player.wins.map((win) => ({
        tile: tilePresentation(win?.tile) ? win.tile : null,
        source: win?.source,
        virtual: win?.virtual === true,
        inHand: win?.inHand === true,
      })) : null,
      dragons: {
        status: dragonStatus,
        count: dragonStatus === 'settled' ? recordedCount(player.dragons.count) : null,
        details: dragonStatus === 'settled' && Array.isArray(player.dragons.details)
          ? player.dragons.details.map((detail) => ({
            tile: tilePresentation(detail?.tile) ? detail.tile : null,
            count: recordedCount(detail?.count),
            pointsPerOpponent: recordedNumber(detail?.pointsPerOpponent),
          })) : null,
      },
    }];
  });
  return players.length ? { gameMode, players } : null;
}

// 积分符号既有视觉也有文字区别；不根据分数推断胡牌次数、胜者排序或未记录的历史。
// Signed scores distinguish gain/loss in text as well as color, without inferring wins, rankings or missing history.
export function roundScoreText(value) {
  if (recordedNumber(value) === null) return '未记录';
  return value > 0 ? `+${value}` : String(value);
}
export function roundScoreTone(value) {
  if (recordedNumber(value) === null || value === 0) return 'neutral';
  return value > 0 ? 'positive' : 'negative';
}

// 只翻译已知协议词；未知旧类型不借用另一玩法语义，也不添加结算推断。
// Translate known protocol terms only; unknown legacy types do not borrow another mode's rules or imply settlement.
export function roundMeldLabel(type) {
  return ({ peng: '碰', anGang: '暗杠', mingGang: '明杠', buGang: '补杠', gang: '杠' })[type] || '副露';
}
export function roundWinLabel(win) {
  const source = ({ selfDraw: '自摸', discard: '接炮', robKong: '抢杠', kongDiscard: '杠后接炮' })[win.source] || '胡牌';
  return `${source}${win.virtual ? ' · 共胡' : ''}${win.inHand ? ' · 已含在手牌' : ''}`;
}
export function roundTileLabel(tile) {
  return tilePresentation(tile)?.label || '牌种未记录';
}
