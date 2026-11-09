// 纯展示快照，不是可提交的引擎状态；仅供本地布局验收，绝不连接房间或包含真实身份。
// View-only snapshots, not executable engine states: local layout acceptance only, without rooms or real identities.
// 对手只含公开区域/手牌数量。变化彼此独立，刻意不宣称一次合法对局可以依次经过所有画面。
// Opponents contain public zones/counts only. Independent variations do not claim a legal game can traverse every frame.
import { terminalSummaryFixture } from './round-summary-fixtures.js';

export const STABLE_TABLE_CASES = ['flower-3', 'flower-4', 'chengdu-4'];
export const STABLE_TABLE_COMPAT_CASES = ['flower-legacy-1', 'flower-legacy-2', 'flower-spectator', 'chengdu-spectator'];
export const STABLE_TABLE_STAGES = [
  ['empty', '空牌河 / 等待'], ['one-row', '牌河一行'], ['many-rows', '牌河多行'],
  ['river-growth', '牌河再增长'], ['discard', '可出牌'], ['claim', '胡碰杠回应'], ['public-growth', '公开牌区增长'],
  ['history-growth', '积分与历史增长'], ['long-names', '长名字与多位积分'],
  ['hint', '听牌与诊断提示'], ['busy', '本页忙碌提示'], ['syncing', '本页同步提示'],
  ['offline', '本页离线提示'], ['restored', '恢复等待'],
];
// 手动场景与自动阶段分开，避免改变既有13次变化矩阵；各玩法私有场景只供对应玩家视图。
// Keep manual views outside the existing thirteen-transition matrix; private scenarios require the matching mode's player view.
export const STABLE_TABLE_MANUAL_STAGES = [
  ['many-actions', '多暗杠与胡牌动作（花麻将手动）'],
  ['normal-feedback', '折叠诊断与普通上次结算（花麻将手动）'],
  ['long-feedback', '超长诊断与结算（花麻将手动）'],
  ['chengdu-exchange', '换三张普通说明（成都手动）'],
  ['chengdu-dingque', '定缺与收到三张牌（成都手动）'],
  ['finished', '本局结束与下一局入口（手动）'],
  ['legacy-config', '旧桌结束与可编辑配置（手动）'],
  ['ordinary-public', '普通碰杠、胡牌与十三张萝卜（手动）'],
  ['short-hand', '短手牌居中（手动）'],
  ['rob-kong', '他家补杠回应（手动）'],
];
const MANY_ACTIONS_HAND = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3];
export const STABLE_TABLE_CHARACTERS = ['sweet', 'elegant', 'sunny', 'landlord', 'honest', 'wealthy', 'star'];
const HAND = [0, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 17];

// 返回新对象，按钮只能把它交给视图setter；这里没有fetch、存储、规则执行或凭证。
// Return a fresh object for the view setter only; no fetch, storage, rule execution, or credential exists here.
export function stableTableSnapshot(caseId, stageId, characterId = 'sweet') {
  if (![...STABLE_TABLE_CASES, ...STABLE_TABLE_COMPAT_CASES].includes(caseId)) throw new Error('Unknown fixture case');
  const stages = [...STABLE_TABLE_STAGES, ...STABLE_TABLE_MANUAL_STAGES];
  if (!stages.some(([id]) => id === stageId)) throw new Error('Unknown fixture stage');
  if (!STABLE_TABLE_CHARACTERS.includes(characterId)) throw new Error('Unknown fixture character');
  const characters = [characterId, 'elegant', 'sunny', 'landlord'];
  const shortHand = stageId === 'short-hand';
  const robKong = stageId === 'rob-kong';
  const manyActions = stageId === 'many-actions';
  const feedback = ['normal-feedback', 'long-feedback'].includes(stageId);
  const chengduPreparation = ['chengdu-exchange', 'chengdu-dingque'].includes(stageId);
  const exchange = stageId === 'chengdu-exchange';
  const finished = stageId === 'finished' || stageId === 'legacy-config';
  if (stageId === 'legacy-config' && !caseId.startsWith('flower-legacy')) throw new Error('Configuration fixture requires legacy Flower');
  const ordinaryPublic = stageId === 'ordinary-public';
  const manual = manyActions || feedback || chengduPreparation || finished || ordinaryPublic || shortHand || robKong;
  if (chengduPreparation && caseId !== 'chengdu-4') throw new Error('Manual preparation fixture requires current Chengdu player view');
  if (feedback && !['flower-3', 'flower-4'].includes(caseId)) throw new Error('Manual feedback fixture requires current Flower player view');
  if (manyActions && !['flower-3', 'flower-4'].includes(caseId)) throw new Error('Manual many-actions fixture requires current Flower player view');
  const hand = manyActions ? MANY_ACTIONS_HAND : shortHand ? [0, 1, 9, 17] : HAND;
  const chengdu = caseId.startsWith('chengdu');
  const spectator = caseId.endsWith('spectator');
  const legacyVersion = caseId.includes('legacy') ? Number(caseId.at(-1)) : null;
  const playerCount = caseId === 'flower-3' || legacyVersion ? 3 : 4;
  const stageIndex = stages.findIndex(([id]) => id === stageId);
  const growing = !manual && stageIndex >= 6 && stageId !== 'restored';
  const historyGrowth = !manual && stageIndex >= 7 && stageId !== 'restored';
  const longNames = stageId === 'long-names';
  const claim = stageId === 'claim' || robKong;
  const discarding = stageId === 'discard' || manyActions || shortHand;
  const perSeatDiscards = ordinaryPublic ? 18 : manual || stageId === 'empty' || stageId === 'restored' ? 0 : stageId === 'one-row' ? 3 : chengdu ? stageId === 'river-growth' ? 15 : 10 : stageId === 'river-growth' ? 48 : 36;
  const names = Array.from({ length: playerCount }, (_, seat) => longNames
    ? `合成牌友${seat + 1}·这是用于换行验收的长名字` : `合成牌友${seat + 1}`);
  const scores = Array.from({ length: playerCount }, (_, seat) => historyGrowth
    ? seat === 0 ? 123456 * (playerCount - 1) : -123456 : 0);
  const players = names.map((name, seat) => ({
    seat, name, handCount: seat === 0 ? hand.length : 13,
    ...(seat === 0 && !spectator ? { hand: [...hand] } : {}), score: scores[seat],
    huCount: !chengdu ? growing ? 12 : ordinaryPublic ? 1 : 0 : 0, kongCount: growing ? 2 : 0,
    // 普通公开牌场景只加一组碰与一次胡，不能沿用四副露/十二胡的极限增长数据。
    // Ordinary public cards use one peng and one win, not the four-meld/twelve-win growth stress data.
    melds: growing || ordinaryPublic ? Array.from({ length: growing ? 4 : 1 }, (_, index) => ({
      type: growing && !chengdu && !legacyVersion && index === 0 ? 'anGang' : index % 2 ? 'anGang' : 'peng', tile: (seat * 4 + index) % (chengdu ? 27 : 18),
      tiles: Array(growing && !chengdu && !legacyVersion && index === 0 ? 20 : index % 2 ? 4 : 3).fill((seat * 4 + index) % (chengdu ? 27 : 18)),
    })) : [],
    winPile: (growing || ordinaryPublic) && !chengdu ? Array.from({ length: growing ? 12 : 1 }, (_, index) => ({
      tile: seat === 0 && !spectator ? index % 18 : null, hidden: seat !== 0 || spectator, source: 'selfDraw', virtual: false,
    })) : [],
    radishes: growing && legacyVersion ? Array.from({ length: 12 }, (_, index) => index % 18) : [],
    dingqueSuit: chengduPreparation ? null : 'characters', dingqueSubmitted: !chengduPreparation,
    won: growing && chengdu && seat !== 0 ? { tile: (seat * 9) % 27, source: 'discard', points: 64 } : null,
  }));
  const settings = chengdu
    ? { playerCount: 4, dingque: true, endCondition: 'bloodBattle', exchangeThree: chengduPreparation, selfDraw: 'addBase', fanCap: 4 }
    : { playerCount, deckCount: 5, dragonStartCount: 8, autoDiscardAfterHu: false, bigSingleReadyPoints: 0 };
  const history = Array.from({ length: historyGrowth ? 60 : 0 }, (_, index) => ({
    type: 'discard', seat: index % playerCount, tile: index % (chengdu ? 27 : 18),
    message: `合成记录 ${index + 1}：牌友出牌；这是一条用来检查换行与内部滚动的公开记录。`,
  }));
  // 与截图相同的真实模板字段：诊断、结算加番、本人胡牌付款记录；仅为合成展示，不执行结算。
  // Match actual template inputs: diagnostic, score bonus and own-hu payments; synthetic display only, never settlement.
  if (feedback) history.push({ type: 'hu', seat: 0, tile: 0, source: 'selfDraw', payments: [
    { seat: 0, delta: 20 }, { seat: 1, delta: -10 }, { seat: 2, delta: -10 },
  ] });
  const tableScores = Array.from({ length: historyGrowth ? 28 : playerCount }, (_, index) => ({
    id: `fixture-score-${index}`, name: index < playerCount ? names[index] : `已离桌合成人物${index + 1}`,
    seat: index < playerCount ? index : null, detached: index >= playerCount,
    settledScore: historyGrowth ? index % 2 ? -123456 : 123456 : 0, provisionalScore: 0,
    totalScore: historyGrowth ? index % 2 ? -123456 : 123456 : 0,
  }));
  // 仅此手动样例模拟没有固定开局字段的旧桌；只读预览仍阻断真实准备/开局提交。
  // Only this manual fixture represents a legacy room without fixed start fields; the preview still blocks actual start submissions.
  if (stageId === 'legacy-config') {
    delete settings.autoDiscardAfterHu;
    delete settings.bigSingleReadyPoints;
  }
  const snapshot = {
    label: stages[stageIndex][1], caseId, stageId,
    ui: { busy: stageId === 'busy', syncing: stageId === 'syncing', offline: stageId === 'offline' },
    state: {
      id: 'VIEWONLY', gameMode: chengdu ? 'chengdu' : 'flower', phase: finished ? 'finished' : 'playing', you: spectator ? null : 0,
      viewerRole: spectator ? 'spectator' : 'player', hostSeat: 0, rulesVersion: chengdu ? 2 : 3, revision: stageIndex,
      settings, presentationMode: 'local', tableScores,
      seats: names.map((name, seat) => ({ seat, name, characterId: characters[seat], connected: true, isCurrentParticipant: true })),
      game: {
        id: `view-only-${caseId}`, gameMode: chengdu ? 'chengdu' : 'flower', schemaVersion: chengdu ? 2 : legacyVersion || 3,
        mySeat: spectator ? null : 0, characters: characters.slice(0, playerCount), participantNames: names, players,
        phase: finished ? 'finished' : chengduPreparation ? exchange ? 'exchange' : 'dingque' : claim ? 'claim' : 'turn',
        turnStep: finished || claim || chengduPreparation ? null : 'discard', currentSeat: chengduPreparation || discarding ? 0 : 1,
        // 终局仅供页脚/再开按钮的位置检查，不把合成视图交给规则引擎或实际点击下一局。
        // Finished views inspect footer/restart placement only, never execute these synthetic snapshots or click through to a new game.
        ...(finished ? { finishReason: 'wallExhausted' } : {}),
        dealerSeat: 0, wallCount: finished ? 0 : 60, revision: stageIndex, rules: {
          ...settings, specialHuPatterns: true, preHuActionChoice: true, concealedKongAfterPungDiscard: true,
          radishCountsWinPile: true, pungUpgradeAfterDiscard: true, turnDirection: 'counterclockwise',
          exponentialDragon: true, extendedCopyFan: true,
        },
        discards: Array.from({ length: perSeatDiscards * playerCount }, (_, index) => ({
          seat: index % playerCount, tile: index % (chengdu ? 27 : 18), claimed: false,
        })), history,
        sharedRadishes: (growing || ordinaryPublic) && !chengdu ? Array.from({ length: growing ? 36 : 13 }, (_, index) => index % 18) : [],
        // 当前引擎动作协议：先列可出牌，再列自摸胡与三种暗杠；按钮只是展示，不执行动作。
        // Current engine action protocol: distinct discards, self-draw hu and three concealed kongs; display only, never execute.
        // 准备阶段只给本人合法选择/收到的三张牌；没有提交、网络或对手私有换牌数据。
        // Preparation exposes only own choices/received tiles, without submission, networking or opponents' private exchange data.
        ...(chengduPreparation ? { preparation: {
          exchangeDirection: 'clockwise', exchangeSubmittedSeats: exchange ? [] : [0, 1, 2, 3],
          myExchange: exchange ? null : [0, 0, 1],
          ...(exchange ? {} : { receivedExchange: { fromSeat: 3, tiles: [0, 0, 1] } }),
        } } : {}),
        legalActions: spectator ? [] : chengduPreparation
          ? exchange ? [{ type: 'exchangeThree', tiles: [0, 0, 1] }]
            : ['bamboo', 'dots', 'characters'].map((suit) => ({ type: 'dingque', suit }))
          : manyActions
          ? [...new Set(hand)].map((tile) => ({ type: 'discard', tile })).concat({ type: 'hu' }, [0, 1, 2].map((tile) => ({ type: 'anGang', tile })))
          : discarding ? hand.map((tile) => ({ type: 'discard', tile })) : claim
          ? robKong ? [{ type: 'hu' }, { type: 'pass' }] : [{ type: 'hu' }, { type: 'peng', tile: 0 }, { type: 'mingGang', tile: 0 }, { type: 'pass' }] : [],
        claim: claim ? { tile: 0, discardSeat: 1, fromSeat: 1, source: robKong ? 'robKong' : 'discard', kind: robKong ? 'robKong' : 'discard', kongType: robKong ? 'buGang' : undefined, eligibleSeats: [0], respondedSeats: [] } : null,
        waitTiles: stageId === 'hint' ? [0, 3, 6, 9, 12, 15, 17] : [],
        huDiagnostic: feedback ? { canHu: false, tile: 0, message: '合成诊断：当前手牌尚未满足胡牌条件。'.repeat(stageId === 'long-feedback' ? 30 : 1) } : stageId === 'hint' ? { canHu: false, tile: 0, message: '合成提示：当前手牌尚未满足胡牌条件。仅用来验收提示切换后布局是否固定。' } : null,
        scoreBreakdown: feedback ? { fan: 3, fanPoints: 4, radishBonus: 6, total: 10, copyFanBonus: 1, patternBonuses: [{ type: 'kongReplacement', fan: 1 }] } : stageId === 'hint' ? { fan: 12, fanPoints: 4096, radishBonus: 36, total: 4132 } : null,
        specialHuPattern: null, drawnTile: manyActions ? 3 : discarding ? 17 : null,
      },
    },
  };
  // 终局才增加显式公开摘要；原玩家牌区仍按原隐私形状保留。
  // Only terminal views gain the explicit public summary; existing player-zone privacy shapes remain unchanged.
  if (finished) snapshot.state.game.roundSummary = terminalSummaryFixture(snapshot.state);
  return snapshot;
}

// 仅供隔离浏览器切换观看席位：复制合成快照，把同一份虚构私有手牌交给所选席位，绝不读取对手暗手。
// Isolated viewing-seat switch: clone the synthetic view and assign its invented private rack to the selected seat, never reading opponent hands.
export function stableTableSeatSnapshot(snapshot, seat = 0) {
  const result = structuredClone(snapshot);
  const { state } = result;
  if (state.viewerRole === 'spectator') return result;
  const players = state.game.players;
  if (!Number.isInteger(seat) || !players.some((player) => player.seat === seat)) return result;
  const previousSeat = state.game.mySeat;
  const hand = players.find((player) => player.seat === previousSeat)?.hand;
  for (const player of players) delete player.hand;
  const viewer = players.find((player) => player.seat === seat);
  viewer.hand = [...(hand || [])];
  viewer.handCount = viewer.hand.length;
  state.you = seat;
  state.game.mySeat = seat;
  // 只保留原合成桌的几何/公开座位；换位后的按钮不冒充该座位真实可用的动作。
  // Preserve public seats/geometry, clearing fabricated actions rather than claiming another seat's real permissions.
  if (seat !== previousSeat) state.game.legalActions = [];
  return result;
}
