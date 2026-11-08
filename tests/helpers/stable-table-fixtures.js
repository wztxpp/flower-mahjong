// 纯展示快照，不是可提交的引擎状态；仅供本地布局验收，绝不连接房间或包含真实身份。
// View-only snapshots, not executable engine states: local layout acceptance only, without rooms or real identities.
// 对手只含公开区域/手牌数量。变化彼此独立，刻意不宣称一次合法对局可以依次经过所有画面。
// Opponents contain public zones/counts only. Independent variations do not claim a legal game can traverse every frame.
export const STABLE_TABLE_CASES = ['flower-3', 'flower-4', 'chengdu-4'];
export const STABLE_TABLE_COMPAT_CASES = ['flower-legacy-1', 'flower-legacy-2', 'flower-spectator', 'chengdu-spectator'];
export const STABLE_TABLE_STAGES = [
  ['empty', '空牌河 / 等待'], ['one-row', '牌河一行'], ['many-rows', '牌河多行'],
  ['river-growth', '牌河再增长'], ['discard', '可出牌'], ['claim', '胡碰杠回应'], ['public-growth', '公开牌区增长'],
  ['history-growth', '积分与历史增长'], ['long-names', '长名字与多位积分'],
  ['hint', '听牌与诊断提示'], ['busy', '本页忙碌提示'], ['syncing', '本页同步提示'],
  ['offline', '本页离线提示'], ['restored', '恢复等待'],
];
const CHARACTERS = ['sweet', 'elegant', 'sunny', 'landlord'];
const HAND = [0, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 17];

// 返回新对象，按钮只能把它交给视图setter；这里没有fetch、存储、规则执行或凭证。
// Return a fresh object for the view setter only; no fetch, storage, rule execution, or credential exists here.
export function stableTableSnapshot(caseId, stageId) {
  if (![...STABLE_TABLE_CASES, ...STABLE_TABLE_COMPAT_CASES].includes(caseId)) throw new Error('Unknown fixture case');
  if (!STABLE_TABLE_STAGES.some(([id]) => id === stageId)) throw new Error('Unknown fixture stage');
  const chengdu = caseId.startsWith('chengdu');
  const spectator = caseId.endsWith('spectator');
  const legacyVersion = caseId.includes('legacy') ? Number(caseId.at(-1)) : null;
  const playerCount = caseId === 'flower-3' || legacyVersion ? 3 : 4;
  const stageIndex = STABLE_TABLE_STAGES.findIndex(([id]) => id === stageId);
  const growing = stageIndex >= 6 && stageId !== 'restored';
  const historyGrowth = stageIndex >= 7 && stageId !== 'restored';
  const longNames = stageId === 'long-names';
  const claim = stageId === 'claim';
  const discarding = stageId === 'discard';
  const perSeatDiscards = stageId === 'empty' || stageId === 'restored' ? 0 : stageId === 'one-row' ? 3 : chengdu ? stageId === 'river-growth' ? 15 : 10 : stageId === 'river-growth' ? 48 : 36;
  const names = Array.from({ length: playerCount }, (_, seat) => longNames
    ? `合成牌友${seat + 1}·这是用于换行验收的长名字` : `合成牌友${seat + 1}`);
  const scores = Array.from({ length: playerCount }, (_, seat) => historyGrowth
    ? seat === 0 ? 123456 * (playerCount - 1) : -123456 : 0);
  const players = names.map((name, seat) => ({
    seat, name, handCount: seat === 0 ? 14 : 13,
    ...(seat === 0 && !spectator ? { hand: [...HAND] } : {}), score: scores[seat],
    huCount: growing && !chengdu ? 12 : 0, kongCount: growing ? 2 : 0,
    melds: growing ? Array.from({ length: 4 }, (_, index) => ({
      type: !chengdu && !legacyVersion && index === 0 ? 'anGang' : index % 2 ? 'anGang' : 'peng', tile: (seat * 4 + index) % (chengdu ? 27 : 18),
      tiles: Array(!chengdu && !legacyVersion && index === 0 ? 20 : index % 2 ? 4 : 3).fill((seat * 4 + index) % (chengdu ? 27 : 18)),
    })) : [],
    winPile: growing && !chengdu ? Array.from({ length: 12 }, (_, index) => ({
      tile: seat === 0 && !spectator ? index % 18 : null, hidden: seat !== 0 || spectator, source: 'selfDraw', virtual: false,
    })) : [],
    radishes: growing && legacyVersion ? Array.from({ length: 12 }, (_, index) => index % 18) : [], dingqueSuit: 'characters', dingqueSubmitted: true,
    won: growing && chengdu && seat !== 0 ? { tile: (seat * 9) % 27, source: 'discard', points: 64 } : null,
  }));
  const settings = chengdu
    ? { playerCount: 4, dingque: true, endCondition: 'bloodBattle', exchangeThree: false, selfDraw: 'addBase', fanCap: 4 }
    : { playerCount, deckCount: 5, dragonStartCount: 8, autoDiscardAfterHu: false, bigSingleReadyPoints: 0 };
  const history = Array.from({ length: historyGrowth ? 60 : 0 }, (_, index) => ({
    type: 'discard', seat: index % playerCount, tile: index % (chengdu ? 27 : 18),
    message: `合成记录 ${index + 1}：牌友出牌；这是一条用来检查换行与内部滚动的公开记录。`,
  }));
  const tableScores = Array.from({ length: historyGrowth ? 28 : playerCount }, (_, index) => ({
    id: `fixture-score-${index}`, name: index < playerCount ? names[index] : `已离桌合成人物${index + 1}`,
    seat: index < playerCount ? index : null, detached: index >= playerCount,
    settledScore: historyGrowth ? index % 2 ? -123456 : 123456 : 0, provisionalScore: 0,
    totalScore: historyGrowth ? index % 2 ? -123456 : 123456 : 0,
  }));
  return {
    label: STABLE_TABLE_STAGES[stageIndex][1], caseId, stageId,
    ui: { busy: stageId === 'busy', syncing: stageId === 'syncing', offline: stageId === 'offline' },
    state: {
      id: 'VIEWONLY', gameMode: chengdu ? 'chengdu' : 'flower', phase: 'playing', you: spectator ? null : 0,
      viewerRole: spectator ? 'spectator' : 'player', hostSeat: 0, rulesVersion: chengdu ? 2 : 3, revision: stageIndex,
      settings, presentationMode: 'local', tableScores,
      seats: names.map((name, seat) => ({ seat, name, character: CHARACTERS[seat], connected: true, isCurrentParticipant: true })),
      game: {
        id: `view-only-${caseId}`, gameMode: chengdu ? 'chengdu' : 'flower', schemaVersion: chengdu ? 2 : legacyVersion || 3,
        mySeat: spectator ? null : 0, characters: CHARACTERS.slice(0, playerCount), participantNames: names, players,
        phase: claim ? 'claim' : 'turn', turnStep: claim ? null : 'discard', currentSeat: discarding ? 0 : 1,
        dealerSeat: 0, wallCount: 60, revision: stageIndex, rules: {
          ...settings, specialHuPatterns: true, preHuActionChoice: true, concealedKongAfterPungDiscard: true,
          radishCountsWinPile: true, pungUpgradeAfterDiscard: true, turnDirection: 'counterclockwise',
          exponentialDragon: true, extendedCopyFan: true,
        },
        discards: Array.from({ length: perSeatDiscards * playerCount }, (_, index) => ({
          seat: index % playerCount, tile: index % (chengdu ? 27 : 18), claimed: false,
        })), history,
        sharedRadishes: growing && !chengdu ? Array.from({ length: 36 }, (_, index) => index % 18) : [],
        legalActions: spectator ? [] : discarding ? HAND.map((tile) => ({ type: 'discard', tile })) : claim
          ? [{ type: 'hu' }, { type: 'peng', tile: 0 }, { type: 'mingGang', tile: 0 }, { type: 'pass' }] : [],
        claim: claim ? { tile: 0, discardSeat: 1, fromSeat: 1, source: 'discard', eligibleSeats: [0], respondedSeats: [] } : null,
        waitTiles: stageId === 'hint' ? [0, 3, 6, 9, 12, 15, 17] : [],
        huDiagnostic: stageId === 'hint' ? { canHu: false, tile: 0, message: '合成提示：当前手牌尚未满足胡牌条件。仅用来验收提示切换后布局是否固定。' } : null,
        scoreBreakdown: stageId === 'hint' ? { fan: 12, fanPoints: 4096, radishBonus: 36, total: 4132 } : null,
        specialHuPattern: null, drawnTile: discarding ? 17 : null,
      },
    },
  };
}
