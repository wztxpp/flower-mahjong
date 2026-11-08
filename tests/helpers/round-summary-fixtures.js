// 纯展示的终局摘要夹具：字段与服务端协议相同，数据全部为合成样例，不可提交给规则引擎。
// View-only terminal summary fixtures mirror the server contract using synthetic data, never executable game states.
export const ROUND_SUMMARY_VARIANTS = ['normal', 'missing', 'long', 'absent'];

// 只根据当前合成场景生成新摘要；不读真实历史、凭证、存储或网络。
// Build a fresh summary from a synthetic scenario, without real history, credentials, storage or network access.
export function terminalSummaryFixture(state, variant = 'normal') {
  if (!ROUND_SUMMARY_VARIANTS.includes(variant)) throw new Error('Unknown summary fixture variant');
  if (variant === 'absent') return null;
  const gameMode = state.gameMode;
  const chengdu = gameMode === 'chengdu';
  const legacy = !chengdu && state.game.schemaVersion < 3;
  const long = variant === 'long';
  const playerCount = state.game.players.length;
  const tileCount = chengdu ? 27 : 18;
  return {
    gameMode,
    schemaVersion: state.game.schemaVersion,
    finishReason: 'wallExhausted',
    players: state.game.players.map((player, seat) => {
      const missing = variant === 'missing';
      const winCount = chengdu ? seat < 2 ? 1 : 0 : seat === 0 ? long ? 24 : 3 : seat === 1 ? 1 : 0;
      const dragonCount = seat === 0 ? long ? 8 : 1 : 0;
      return {
        seat,
        name: long ? `合成牌友${seat + 1}·这是用于终局长名字换行的记录` : state.seats[seat].name,
        // 此处映射是夹具明确选择的历史角色，不模拟生产API对旧记录的默认值；缺记录场景保留null。
        // This fixture mapping explicitly selects historical roles, not production API legacy defaults; missing-record cases stay null.
        characterId: missing ? null : state.game.characters?.[seat] ?? null,
        huCount: missing ? null : winCount,
        roundScore: missing ? null : (seat === 0 ? playerCount - 1 : -1) * (long ? 123456 : 12),
        tableScore: missing ? null : (seat === 0 ? playerCount - 1 : -1) * (long ? 234567 : 24),
        finalHand: missing ? null : Array.from({ length: long ? chengdu ? 14 : 20 : seat === 0 ? 13 : 10 }, (_, index) => (index + seat * 3) % tileCount),
        melds: missing ? null : seat === 0 ? [] : [{
          type: seat % 2 ? 'peng' : 'anGang', tile: seat * 3,
          tiles: Array(long && !chengdu ? 20 : seat % 2 ? 3 : 4).fill(seat * 3),
        }],
        wins: missing ? null : Array.from({ length: winCount }, (_, index) => ({
          tile: (seat * 4 + index) % tileCount,
          source: index % 2 || seat === 1 ? 'discard' : 'selfDraw',
          virtual: !chengdu && seat === 1,
          inHand: chengdu && seat === 0,
        })),
        dragons: chengdu || legacy || missing ? {
          status: chengdu ? 'notApplicable' : 'unavailable', count: null, details: null, pointsPerOpponent: null, payments: null,
        } : {
          status: 'settled', count: dragonCount,
          details: Array.from({ length: dragonCount }, (_, index) => ({ tile: index % 18, count: long ? 20 : 8, pointsPerOpponent: long ? 40960 : 10 })),
          pointsPerOpponent: long ? 40960 * dragonCount : 10 * dragonCount,
          payments: [],
        },
      };
    }),
  };
}
