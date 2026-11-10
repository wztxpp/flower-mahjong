/**
 * v3 当前规则 / Current v3 rules
 * 纯状态机：接收局状态与动作，返回新状态；无网络、数据库、界面或定时器。
 * Pure state machine: game state plus action produces new state; no network, database, UI, or timers.
 * 旧局缺少某个规则开关时必须按原判断兼容，不能在读取时补 DEFAULT_RULES。
 * Preserve the original missing-flag semantics; never inject DEFAULT_RULES while reading saved games.
 * 阅读 / Read: docs/ENGINE-READING-GUIDE.md, docs/TERMINOLOGY.md.
 */
/** Pure schema-v3 engine. Scores are virtual; provisional overlaps are explicit rules. */
import { hidesPrivateWinDetails, visibleHistoryEvent, visibleScoreSummary } from './tile-visibility.js';
import {
  DEFAULT_BIG_SINGLE_READY_POINTS, isBigSingleReadyPoints,
  DEFAULT_PLAYER_COUNT, DEFAULT_DECK_COUNT, DEFAULT_DRAGON_START_COUNT,
  isPlayerCount, isDeckCount, isDragonStartCount, copiesPerTile,
} from './start-options.js';
/* 十八种条筒牌；每种张数由开局副数决定，缺字段旧局仍为八张。
 * Eighteen bamboo/dot identities; saved deck count sets copies, with eight for older games. */
export const TILE_COUNT = 18;
/* 新局默认值；保存局使用自己的 rules，不受以后默认值改动影响。
 * New-game defaults; saved games keep their own rules when defaults change. */
export const DEFAULT_RULES = Object.freeze({
  // 仅新局保存这些维度与计分开关；读取旧局绝不补写新默认。
  // Only new games save dimensions/scoring flags; reads never inject defaults into old saves.
  playerCount: DEFAULT_PLAYER_COUNT,
  deckCount: DEFAULT_DECK_COUNT,
  dragonStartCount: DEFAULT_DRAGON_START_COUNT,
  exponentialDragon: true,
  extendedCopyFan: true,
  // 是否允许七对结构。
  // Enable the seven-pairs shape.
  sevenPairs: true,
  // 暗杠牌面公开；缺字段旧局仍沿用隐藏策略。
  // Publish concealed-kong faces; saves missing this flag retain hidden faces.
  publicConcealedKongs: true,
  // 进行中只让本人看自摸胡牌；不改变权威牌区或计分。
  // Only the owner sees self-drawn wins during play; authority and scoring stay unchanged.
  hideSelfDrawWins: true,
  // 允许碰后补杠；v0.7.0 已保存的 false 按已确认纠错映射为先出牌策略。
  // Allow peng upgrades; saved v0.7.0 false values map to the authorized after-discard correction.
  allowPungUpgrade: true,
  // 碰后必须真正打出一张牌，之后正常操作窗口才允许补杠。
  // Require an actual post-peng discard before later legal upgrade windows.
  pungUpgradeAfterDiscard: true,
  // 未首次胡牌时同时保留胡、碰和合法杠；旧局缺字段仍用原有优先规则。
  // Offer all legal choices before the first win; missing saved flags retain old priority.
  preHuActionChoice: true,
  // 碰后的这次出牌前不能暗杠，实际出牌后正常窗口恢复。
  // No concealed kong before the post-peng discard; later normal windows resume.
  concealedKongAfterPungDiscard: true,
  // 本局行牌方向；缺失字段保留旧方向。
  // Saved turn direction; missing fields retain the historical direction.
  turnDirection: 'counterclockwise',
  // 胡后无选择时是否自动打出新摸牌；缺失字段维持自动。
  // Whether to auto-discard an uninteresting post-hu draw; missing flags retain automatic behavior.
  autoDiscardAfterHu: true,
  // 新局是否启用一次大单吊待牌喜钱；缺失开关的旧局不补收。
  // Enable the once-per-game big-single ready bonus; do not back-charge saves lacking the switch.
  bigSingleReadyPayment: true,
  // 每家支付的喜钱；0 表示不收，缺失金额的旧局仍按 50。
  // Ready bonus per opponent; zero means no charge, and old saves without an amount retain fifty.
  bigSingleReadyPoints: DEFAULT_BIG_SINGLE_READY_POINTS,
  // 是否使用新版七对/大单吊牌型与固定听口规则。
  // Enable special seven-pairs/big-single pattern and wait rules.
  specialHuPatterns: true,
  // 新局的杠后接炮与杠上花各加一番；缺失或 false 保留旧算分，七对固定档位不叠加。
  // New games add one fan for post-kong discard/replacement wins; absent/false keeps old scoring and seven pairs stays fixed.
  kongEventFan: true,
  // 普通胡牌的基础番数，不等于已经换算的分数。
  // Base fan for an ordinary win, not converted points.
  baseFan: 1,
  // 六、七、八张神龙的分值表，规则对象内部也单独冻结默认表。
  // Dragon point tiers for six, seven, and eight copies; freeze the nested default table too.
  dragonPoints: Object.freeze({
    6: 10,
    7: 20,
    8: 40,
  }),
  // 是否允许同一弃牌由多个合法赢家同时胡。
  // Allow simultaneous legal winners on the same discard.
  multipleWinners: true,
  // 最后一家首次胡时的付款例外，按具体来源区分。
  // Enable source-specific payer exceptions for the final first-time winner.
  finalHuPaymentExceptions: true,
  // 普通自摸只向尚未胡的对手收分；杠后补摸另按来源处理。
  // Charge only unwon opponents for ordinary self-draw; kong replacement uses its own provenance.
  selfDrawOnlyUnwon: true,
  // 萝卜匹配是否计入本人碰杠牌。
  // Include personal meld tiles when matching radishes.
  radishCountsMelds: true,
  // 神龙张数是否计入本人碰杠牌。
  // Include personal meld tiles when counting dragons.
  dragonCountsMelds: true,
  // 萝卜匹配是否计入历史逻辑胡牌区；各版本默认不同。
  // Include logical win-pile tiles in radish matching; defaults differ by version.
  radishCountsWinPile: true,
  // 神龙是否计入逻辑胡牌区；引用不增加实体守恒张数。
  // Include logical win-pile tiles in dragon counts without creating physical copies.
  dragonCountsWinPile: true,
  // v3 终局神龙是否计入全桌共享萝卜。
  // Include table-wide shared radishes in v3 final dragon settlement.
  dragonCountsSharedRadishes: true,
  // 保留各版本的神龙叠加配置；当前 v3 终局独立结算，不把字段名当作新公式。
  // Preserve versioned overlap configuration; v3 settles dragons separately at finish.
  stackDragonBonus: true,
  // 萝卜计分范围：旧版可为 own，本版取值以此快照为准。
  // Radish scoring scope: older rules may use own; follow this saved snapshot.
  radishScope: 'all',
  // 恰好六张同牌增加的番数。
  // Fan bonus for exactly six matching copies.
  sixCopyFan: 3,
  // 超过八张逻辑同牌时保留的未确认兜底；七/八张有明确档位。
  // Provisional fallback above eight logical copies; seven/eight have explicit tiers.
  sevenPlusCopyFan: 0,
  // 旧大单吊固定分与普通分的重叠策略；新版特殊牌型另走番数路径。
  // Legacy fixed-big-single overlap policy; newer special patterns use the fan path.
  bigSingleOverlap: 'exclusive',
  // 重复胡锁的历史策略名；具体效力取决于对应引擎版本。
  // Historical repeat-win lock policy; enforcement depends on engine version.
  repeatHuLock: 'untilNaturalDraw',
  // 旧锁规则下是否允许改变后的听口；不能把旧开关直接解释为 v3 限制。
  // Allow changed waits under historical locks; do not infer a v3 restriction from the old flag.
  allowChangedWaitDuringLock: true,
  // 胡后杠是否必须完整保留杠前听口集合。
  // Require every pre-kong wait to survive a post-hu kong.
  preserveWaitsOnPostHuKong: true,
});
/* 复制可序列化状态，避免在一次试算中修改调用方的原对象。
 * Copy serializable state so trial calculations never mutate the caller’s object. */
const cloneSerializable = (value) => JSON.parse(JSON.stringify(value));
/* 复制并按牌种编号升序排序；原数组或集合保持不变。
 * Copy and sort tile identities numerically without changing the input array or set. */
const sortTiles = (values) => [...values].sort((a, b) => a - b);
/* 只接受 0–17 的整数牌种；0–8 是条，9–17 是筒。
 * Accept integer tile identities 0–17 only: 0–8 are bamboo and 9–17 are dots. */
const isTile = (tile) => Number.isInteger(tile) && tile >= 0 && tile < TILE_COUNT;
/* 把内部零起始牌种转换为玩家看到的“一至九条/筒”文字。
 * Convert a zero-based tile identity to its player-facing bamboo/dot label. */
const tileLabel = (tile) => `${(tile % 9) + 1}${tile < 9 ? '条' : '筒'}`;
/* 把牌列表变成 18 项频次数组；索引是牌种，值是该牌种张数。
 * Convert a tile list to 18 frequencies indexed by tile identity. */
const countTiles = (tiles) => {
  const counts = Array(TILE_COUNT).fill(0);
  for (const tile of tiles) counts[tile]++;
  return counts;
};
/* 展开玩家所有碰杠组的牌，供计番与守恒检查使用。
 * Flatten a player’s meld tiles for scoring and conservation checks. */
const tilesInMelds = (player) => player.melds.flatMap((meld) => meld.tiles);
/* 已成立的杠可加到本局同牌总数；碰仍必须先通过独立补杠流程。
 * An established kong may grow to the deck's copy limit; a peng uses its separate upgrade path. */
const canExtendKong = (game, meld) =>
  meld.type !== 'peng' && meld.tiles.length >= 4 && meld.tiles.length < copiesPerTile(game.rules);
// 所有付款、轮转及授权共用真实参与座位，绝不根据角色池大小推断人数。
// Payments, rotation and authorization use actual participating seats, never the character roster size.
const allSeats = (game) => game.players.map((player) => player.seat);
const validSeat = (game, seat) => Number.isInteger(seat) && seat >= 0 && seat < game.players.length;
/* 比较已排序且已规范化的听牌列表；这里比较元素与顺序，不是通用集合算法。
 * Compare normalized sorted wait lists by element and order; this is not a general set algorithm. */
const sameTileList = (a, b) => a.length === b.length && a.every((tile, i) => tile === b[i]);
/* 从传入的手牌原地移除指定张数；任何一张不存在就拒绝非法动作。
 * Remove the requested copies from the supplied hand in place; reject a missing copy. */
const removeTilesFromHand = (hand, tile, count = 1) => {
  for (let i = 0; i < count; i++) {
    const index = hand.indexOf(tile);
    if (index < 0) throw new Error('手牌中没有这张牌');
    hand.splice(index, 1);
  }
};
/* 仅在创建新局时合并默认值并校验输入；不要用它补写已保存的旧局规则。
 * Merge defaults and validate rules only for new games; never retrofit a saved game through this helper. */
function normalizeNewGameRules(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('规则无效');
  /* 拒绝拼错或未支持的规则名，避免用户以为设置已经生效。
   * Reject misspelled or unsupported rule names rather than silently ignoring them. */
  const unknown = Object.keys(input).filter((key) => !Object.hasOwn(DEFAULT_RULES, key));
  if (unknown.length) throw new Error(`未知规则：${unknown.join('、')}`);
  if (
    input.dragonPoints !== undefined &&
    (!input.dragonPoints ||
      typeof input.dragonPoints !== 'object' ||
      Array.isArray(input.dragonPoints))
  )
    throw new Error('神龙分值无效');
  const rules = {
    ...DEFAULT_RULES,
    ...input,
    dragonPoints: {
      ...DEFAULT_RULES.dragonPoints,
      ...(input.dragonPoints || {}),
    },
  };
  if (!isBigSingleReadyPoints(rules.bigSingleReadyPoints)) throw new Error('大单吊喜钱分值无效');
  if (!isPlayerCount(rules.playerCount)) throw new Error('人数必须为3或4人');
  if (!isDeckCount(rules.deckCount)) throw new Error('副数必须为1至5副，每次增加半副');
  if (!isDragonStartCount(rules.dragonStartCount)) throw new Error('神龙起算张数必须为1至20的整数');
  for (const key of [
    'exponentialDragon',
    'extendedCopyFan',
    'sevenPairs',
    'publicConcealedKongs',
    'hideSelfDrawWins',
    'allowPungUpgrade',
    'pungUpgradeAfterDiscard',
    'preHuActionChoice',
    'concealedKongAfterPungDiscard',
    'autoDiscardAfterHu',
    'bigSingleReadyPayment',
    'specialHuPatterns',
    'kongEventFan',
    'multipleWinners',
    'finalHuPaymentExceptions',
    'selfDrawOnlyUnwon',
    'radishCountsMelds',
    'dragonCountsMelds',
    'radishCountsWinPile',
    'dragonCountsWinPile',
    'dragonCountsSharedRadishes',
    'stackDragonBonus',
    'allowChangedWaitDuringLock',
    'preserveWaitsOnPostHuKong',
  ]) {
    if (typeof rules[key] !== 'boolean') throw new Error(`规则 ${key} 必须为布尔值`);
  }
  for (const key of ['baseFan', 'sixCopyFan', 'sevenPlusCopyFan']) {
    if (
      !Number.isSafeInteger(rules[key]) ||
      rules[key] < (key === 'baseFan' ? 1 : 0) ||
      rules[key] > 1000
    )
      throw new Error('番数规则无效');
  }
  if (!['clockwise', 'counterclockwise'].includes(rules.turnDirection))
    throw new Error('行牌方向无效');
  if (rules.radishScope !== 'all') throw new Error('萝卜归属规则无效');
  if (!['exclusive', 'additive'].includes(rules.bigSingleOverlap))
    throw new Error('大单钓叠加规则无效');
  if (!['untilNaturalDraw', 'untilWaitChange'].includes(rules.repeatHuLock))
    throw new Error('重复胡牌锁定规则无效');
  for (const [key, value] of Object.entries(rules.dragonPoints)) {
    if (
      !['6', '7', '8'].includes(key) ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > 100000
    )
      throw new Error('神龙分值无效');
  }
  return rules;
}
/* 把测试种子转成可重复的伪随机序列；不得代替正式开局的安全随机源。
 * Turn a test seed into a repeatable pseudorandom sequence, never the production shuffle source. */
function seededRandom(seed) {
  let state = 2166136261;
  for (const char of String(seed)) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
/* 从平台密码学随机源取一个 [0,1) 数值，供正式洗牌使用。
 * Read a cryptographically random value in [0,1) for production shuffling. */
function secureRandom() {
  if (!globalThis.crypto?.getRandomValues) throw new Error('环境不支持安全洗牌');
  const bytes = new Uint32Array(1);
  globalThis.crypto.getRandomValues(bytes);
  return bytes[0] / 4294967296;
}

/* 按真实人数与本局方向排列其他座位；四人逆时针为右、对、左。缺方向仍走旧顺时针。
 * Order other seats by player count and saved direction: right/opposite/left for four-seat counterclockwise play. */
export function turnOrderAfter(game, seat) {
  const count = game.players.length;
  const offsets = Array.from({ length: count - 1 }, (_, index) => index + 1);
  if (game.rules?.turnDirection === 'counterclockwise') offsets.reverse();
  return offsets.map((offset) => (seat + offset) % count);
}
/* 找上一局历史中第一个合法胡牌事件作为下一局庄家；没有记录则回到 0 号位。
 * Use the first valid hu event in the previous game as the next dealer, otherwise seat 0. */
export function dealerForNextGame(previousGame) {
  const valid = (seat) => Number.isInteger(seat) && seat >= 0 &&
    seat < (previousGame?.players?.length ?? DEFAULT_PLAYER_COUNT);
  const firstHu = Array.isArray(previousGame?.history)
    ? previousGame.history.find((event) => event?.type === 'hu' && valid(event.seat))
    : null;
  return firstHu ? firstHu.seat : 0;
}
/* 新局按人数与副数洗发牌；各十三张、庄家十四张的结构规则不变。
 * Deal a new game using its dimensions; preserve thirteen tiles per player and fourteen for the dealer. */
export function createGame({ seed, rules: inputRules, dealerSeat = 0 } = {}) {
  const rules = normalizeNewGameRules(inputRules);
  if (!Number.isInteger(dealerSeat) || dealerSeat < 0 || dealerSeat >= rules.playerCount)
    throw new Error('庄家座位无效');
  /* 牌墙是有顺序的实体牌列表；头部摸牌，尾部翻萝卜。
   * The wall is an ordered physical tile list: draw at the head and reveal radishes from the tail. */
  const wall = Array.from(
    {
      length: TILE_COUNT * copiesPerTile(rules),
    },
    (_, i) => i % TILE_COUNT,
  );
  /* 提供种子时使用测试随机源，否则使用安全随机源。
   * Use deterministic randomness only when a seed is supplied; otherwise use secure randomness. */
  const random = seed === undefined ? secureRandom : seededRandom(seed);
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  const players = Array.from(
    {
      length: rules.playerCount,
    },
    (_, seat) => ({
      seat,
      hand: [],
      melds: [],
      winPile: [],
      radishes: [],
      score: 0,
      huCount: 0,
      kongCount: 0,
      bigSingleReadyPaid: false,
      pendingPungDiscard: false,
      lockedWaits: [],
      huLockActive: false,
      pendingKongDiscard: false,
      lastScoreBreakdown: null,
      firstHuPattern: null,
    }),
  );
  for (let i = 0; i < 13; i++) for (const player of players) player.hand.push(wall.shift());
  /* 庄家额外获得的第十四张牌，也是初始 lastDraw。
   * The dealer’s extra fourteenth tile also initializes lastDraw. */
  const initialTile = wall.shift();
  players[dealerSeat].hand.push(initialTile);
  for (const player of players) player.hand.sort((a, b) => a - b);
  const game = {
    schemaVersion: 3,
    phase: 'turn',
    turnStep: 'discard',
    currentSeat: dealerSeat,
    dealerSeat,
    wall,
    players,
    discards: [],
    retiredTiles: [],
    history: [],
    revision: 0,
    rules,
    claim: null,
    drawKind: 'normal',
    firstHuRadishesRevealed: false,
    pendingKongRadishes: 0,
    dragonSettlement: {
      settled: false,
      entries: [],
    },
    lastDraw: {
      seat: dealerSeat,
      tile: initialTile,
      source: 'initial',
    },
    finishReason: null,
  };
  appendHistoryEvent(game, {
    type: 'start',
    seat: dealerSeat,
    message: `${rules.playerCount}位牌友已就位，${dealerSeat + 1}号位坐庄，庄家先出牌。`,
  });
  assertGameInvariants(game);
  return game;
}

/** Structural win test. Four melds and a pair, optionally seven pairs. */
/* 只验证牌型结构：四组面子加一对，或规则允许的七对；不读取牌墙与对手手牌。
 * Validate structural completion: four groups and a pair, or enabled seven pairs; never inspect the wall or opponents. */
export function isWinningHand(hand, meldCount = 0, rules = DEFAULT_RULES) {
  if (
    !Array.isArray(hand) ||
    !hand.every(isTile) ||
    !Number.isInteger(meldCount) ||
    meldCount < 0 ||
    meldCount > 4
  )
    return false;
  /* 每副露一组，手牌结构需求减少三张；数量不符就无需继续递归。
   * Each meld removes three required concealed tiles; reject a mismatched size before recursion. */
  if (hand.length !== (4 - meldCount) * 3 + 2) return false;
  const counts = countTiles(hand);
  if (counts.some((count) => count > copiesPerTile(rules))) return false;
  if (rules.sevenPairs && meldCount === 0 && counts.every((count) => count % 2 === 0)) return true;
  /* 缓存同一剩余牌频次的拆组结果，避免递归重复搜索。
   * Memoize decomposition results for the same remaining tile frequencies. */
  const memo = new Map();
  /* 递归拆掉最小牌种的刻子或同花色顺子，尝试后必须恢复计数，供另一条分支继续。
   * Recursively remove a triplet or same-suit sequence from the lowest tile; restore counts after each trial. */
  function meldable() {
    /* 总是处理最小的未用牌种，因此不必重复枚举相同拆组顺序。
     * Always start with the lowest remaining tile to avoid redundant decomposition orders. */
    const first = counts.findIndex((count) => count > 0);
    /* 所有剩余牌都已成功拆成面子，当前递归路径成立。
     * No tiles remain, so this recursive decomposition succeeds. */
    if (first < 0) return true;
    const key = counts.join(',');
    if (memo.has(key)) return memo.get(key);
    let success = false;
    /* 先尝试取三张相同牌作刻子；失败后仍需回滚再尝试顺子。
     * First try a triplet; restore counts afterward before considering a sequence. */
    if (counts[first] >= 3) {
      counts[first] -= 3;
      success = meldable();
      counts[first] += 3;
    }
    /* 只有同一花色的 1–7 才能作为顺子起点；8、9 不能跨到另一花色。
     * Only ranks one through seven can start a sequence; ranks eight and nine must not cross suits. */
    if (!success && first % 9 <= 6 && counts[first + 1] && counts[first + 2]) {
      counts[first]--;
      counts[first + 1]--;
      counts[first + 2]--;
      success = meldable();
      counts[first]++;
      counts[first + 1]++;
      counts[first + 2]++;
    }
    memo.set(key, success);
    return success;
  }
  for (let tile = 0; tile < TILE_COUNT; tile++) {
    /* 此牌种不足两张，不能作为本次尝试的将牌。
     * This identity lacks two copies and cannot be the trial pair. */
    if (counts[tile] < 2) continue;
    counts[tile] -= 2;
    const success = meldable();
    counts[tile] += 2;
    if (success) return true;
  }
  return false;
}

/** Wait sets depend on shape, not the hidden wall or opponents' hands. */
/* 枚举 18 种候选牌，找出能把当前待牌手牌补成胡牌的牌种；不窥探剩余牌墙。
 * Try all 18 identities to find tiles completing the waiting hand without inspecting the hidden wall. */
export function getWaitTiles(hand, melds = [], rules = DEFAULT_RULES) {
  if (!Array.isArray(hand) || hand.length !== (4 - melds.length) * 3 + 1) return [];
  const owned = countTiles([...hand, ...melds.flatMap((meld) => meld.tiles)]);
  return Array.from(
    {
      length: TILE_COUNT,
    },
    (_, i) => i,
  ).filter((tile) => owned[tile] < copiesPerTile(rules) && isWinningHand([...hand, tile], melds.length, rules));
}

/** Pattern metadata is captured from a complete first winning shape, never from accumulated wins. */
/* 从完整的首次符合条件的胡牌形状提取牌型信息；七对档位由这张快照固定。
 * Capture pattern metadata from the complete qualifying winning shape; this snapshot fixes the seven-pairs tier. */
function classifyHuPattern(hand, melds, rules) {
  const counts = countTiles(hand);
  const allTiles = [...hand, ...melds.flatMap((meld) => meld.tiles)];
  /* 所有参与牌型的牌必须同属条或同属筒，才是清一色。
   * Every tile in the shape must belong to the same suit for a pure suit. */
  const pureSuit = allTiles.length > 0 && allTiles.every((tile) => tile < 9 === allTiles[0] < 9);
  /* 四组已成副露加最后一对，表示大单吊胡牌形状。
   * Four established melds plus the final pair form the big-single winning shape. */
  const bigSingle = melds.length === 4 && hand.length === 2;
  /* 七对要求没有副露、手牌十四张且每种牌张数都是偶数。
   * Seven pairs requires no melds, fourteen concealed tiles, and even counts per identity. */
  const isSevenPairs =
    rules.sevenPairs &&
    melds.length === 0 &&
    hand.length === 14 &&
    counts.every((count) => count % 2 === 0);
  // Freeze the confirmed formula using the complete first win: base three, then n - 3 for each group of four or more.
  /* 每组四张及以上增加“张数减三”番；基础七对三番。
   * Each group of at least four adds count minus three fan; seven pairs starts at three fan. */
  const sevenPairsFan = 3 + counts.reduce((sum, count) => sum + (count >= 4 ? count - 3 : 0), 0);
  /* 先排除大单吊，再试每种可能的将牌；扣将后各牌种必须能分成刻子。
   * Exclude big single, then try each possible pair; all remaining counts must divide into triplets. */
  const allTriplets =
    !bigSingle &&
    counts.some(
      (count, pair) =>
        count >= 2 && counts.every((copies, tile) => (copies - (tile === pair ? 2 : 0)) % 3 === 0),
    );
  const kind = isSevenPairs ? 'sevenPairs' : bigSingle ? 'bigSingle' : 'standard';
  return {
    kind,
    pureSuit,
    allTriplets,
    waitTiles: kind === 'standard' ? [] : sortTiles(new Set(allTiles)),
    fixedFan: isSevenPairs ? sevenPairsFan + (pureSuit ? 2 : 0) : null,
    ...(isSevenPairs
      ? {
          sevenPairsFan,
        }
      : {}),
  };
}

/** Expanded post-win waits use only this player's saved shape and own/public tile zones. */
/* 普通牌型重新算听口；特殊牌型复用保存听口，排除已达到本局实体上限的同牌。
 * Recompute ordinary waits; special patterns reuse saved waits and exclude identities at this game’s copy limit. */
function contextualWaitTiles(game, player, hand, melds = player.melds) {
  /* 牌型快照用于固定特殊胡牌档位；不要用后来累积的胡牌区反推首次牌型。
   * The pattern snapshot preserves a special winning tier; later win-pile growth cannot reconstruct the first shape. */
  const pattern =
    game.rules.specialHuPatterns === true && player.huCount > 0 ? player.firstHuPattern : null;
  if (!pattern || !['sevenPairs', 'bigSingle'].includes(pattern.kind))
    return getWaitTiles(hand, melds, game.rules);
  if (hand.length !== (4 - melds.length) * 3 + 1) return [];
  const owned = countTiles([
    ...hand,
    ...melds.flatMap((meld) => meld.tiles),
    ...player.winPile.map((win) => win.tile),
  ]);
  return pattern.waitTiles.filter((tile) => owned[tile] < copiesPerTile(game.rules));
}
// 本人打出的同种牌，在本人下一次实际摸牌之前不能接胡；只读已提交的公开事件。
// A self-discarded identity cannot be claimed for hu until this seat actually draws again.
// 普通摸、胡后续摸和杠补摸都有 draw；碰/杠申请、抢杠放牌和进入摸牌步骤都不是摸牌。
// Normal/continuation/replacement draws all log draw; peng, kong offers and entering a draw step do not.
// 新旧schema3共用完整追加历史，不回填规则/状态；没有可用证据时不从牌河或暗手猜禁胡。
// Both current and saved schema-three games use append-only history without migration; missing evidence never invents a lock.
function hasSelfDiscardHuLock(game, seat, tile) {
  for (let index = game.history.length - 1; index >= 0; index--) {
    const event = game.history[index];
    if (event.seat !== seat) continue;
    if (event.type === 'draw') return false;
    if (event.type === 'discard' && event.tile === tile) return true;
  }
  return false;
}
/* 取候选胡牌前的待牌手牌，再按本版本规则验证能否胡；不能胡返回 null，能胡返回听口。
 * Build the waiting hand before the candidate win and validate this version’s hu rules; return null or its wait list. */
function getAllowedHuWaits(game, seat, tile, fromHand, honorCommittedClaim = false) {
  if (!fromHand && !honorCommittedClaim && hasSelfDiscardHuLock(game, seat, tile)) return null;
  const player = game.players[seat];
  const base = [...player.hand];
  if (fromHand) removeTilesFromHand(base, tile);
  const waits = contextualWaitTiles(game, player, base);
  if (!waits.includes(tile)) return null;
  // 胡过本身不锁下一次接胡；本次只禁止自己打出过的同种牌，旧huLock字段不复活。
  // A prior win alone does not lock subsequent claims; only self-discarded identities are blocked, not legacy huLock fields.
  return waits;
}
/* 复制手牌并扣除当前最后摸到的牌，恢复计算听口需要的待牌张数。
 * Copy the hand and remove its current last draw to recover the waiting-hand size used by wait calculations. */
function getHandBeforeLastDraw(game, seat) {
  const hand = [...game.players[seat].hand];
  if (game.lastDraw?.seat === seat) removeTilesFromHand(hand, game.lastDraw.tile);
  return hand;
}
/* 试算杠后的手牌和副露；胡后固定牌型与完整听口均须保留。试算不改原局。
 * Simulate the hand and melds after a kong; preserve the fixed post-hu shape and every wait without mutating the game. */
function canDeclareKong(game, seat, type, tile) {
  const player = game.players[seat];
  /* 保留补摸与萝卜所需的牌墙余量；不能宣告无法完成后续步骤的杠。
   * Require enough wall capacity for replacement/radish steps before declaring a kong. */
  if (game.wall.length < 2) return false;
  // 胡后锁的是原手牌，不只是听口。补碰/加杠只能用本次真正摸入的同牌；
  // 否则会把锁定顺子里的牌抽走，再用另一张摸牌拼回相同听口（例如345筒换456筒）。
  // After hu the held hand itself is locked, not merely its waits. An upgrade must use
  // the actual current draw; otherwise 345 dots can illegally become 456 with unchanged waits.
  // 七对的扩展听口来自首胡快照，不能用它证明拆对子成杠后仍是七对。
  // 先保护已确认牌型，独立于旧听口开关；只拒绝未来动作，不改旧副露、快照或积分。
  // Expanded seven-pairs waits come from the first-win snapshot, not structural validation.
  // Guard that fixed pattern before the legacy wait toggle, without rewriting committed melds, snapshots or scores.
  if (player.huCount > 0 && player.firstHuPattern?.kind === 'sevenPairs') return false;
  // 暗杠也必须用本次摸牌把原刻子变成杠；不能拿走原有四张而把不同的新牌留在锁手中。
  // 明杠由他人弃牌补足原刻子，不要求本人摸牌；未胡者仍保留原有杠牌选择。
  // A concealed kong must likewise extend a held triplet with the current draw, never exchange four held tiles for it.
  // An exposed kong instead consumes another player's discard; unwon players retain their original choices.
  if (player.huCount > 0 && ['anGang', 'buGang', 'addGang'].includes(type) &&
    (game.lastDraw?.seat !== seat || game.lastDraw.tile !== tile)) return false;
  // 用户确认胡后不能改牌型，旧false/缺字段不能绕过；保留存档原值而不回填或迁移。
  // The confirmed post-hu shape rule also applies to old false/missing toggles; preserve saved values without migration.
  if (!player.huCount) return true;
  const before = contextualWaitTiles(game, player, getHandBeforeLastDraw(game, seat));
  const hand = [...player.hand];
  const melds = cloneSerializable(player.melds);
  if (type === 'anGang' || type === 'mingGang') {
    removeTilesFromHand(hand, tile, type === 'anGang' ? 4 : 3);
    melds.push({
      type,
      tile,
      tiles: Array(4).fill(tile),
    });
  } else {
    removeTilesFromHand(hand, tile);
    const meld = melds.find(
      (item) =>
        item.tile === tile && (type === 'buGang' ? item.type === 'peng' : canExtendKong(game, item)),
    );
    if (!meld) return false;
    meld.tiles.push(tile);
    if (type === 'buGang') meld.type = 'buGang';
  }
  return before.length > 0 && sameTileList(before, contextualWaitTiles(game, player, hand, melds));
}
/* 判断已胡来源的弃牌是否受保护；只读计算，不改已经提交的弃牌、回应和旧账。
 * Determine whether a won source's discard is protected, without rewriting committed discards, responses or scores.
 * 旧版本可能把杠标记带过胡后续摸。仅在牌河与对应事件数量一致、当前末张弃牌精确匹配、
 * 且其前一个本人动作确为胡后续摸时纠正资格；缺记录不能猜，真实新杠会中断该证据链。
 * Older versions carried kong markers through continuation draws. Correct eligibility only when river/event counts
 * agree, the current final discard matches exactly and its preceding own action is a continuation draw; never guess missing history. */
function isProtectedPostHuDiscard(game, discarded) {
  if (!discarded || discarded.robKong || !game.players[discarded.seat].huCount) return false;
  if (!discarded.afterKong) return true;
  if (game.discards.at(-1) !== discarded) return false;
  const riverEvents = game.history.filter((event) => ['discard', 'robKongAttempt'].includes(event.type));
  if (riverEvents.length !== game.discards.length) return false;
  const event = riverEvents.at(-1);
  if (event?.type !== 'discard' || event.seat !== discarded.seat ||
      event.tile !== discarded.tile || event.afterKong !== true) return false;
  // 只取弃牌前最近的本人动作，不越过另一轮胡、杠、碰或出牌寻找更老的续摸。
  // Inspect only the nearest preceding own action, never reaching past a later hu, kong, peng or discard.
  for (let index = game.history.lastIndexOf(event) - 1; index >= 0; index--) {
    const previous = game.history[index];
    if (previous.seat !== discarded.seat) continue;
    if (previous.type === 'draw') return previous.source === 'continuation';
    if (['hu', 'anGang', 'mingGang', 'buGang', 'addGang', 'peng', 'discard', 'robKongAttempt'].includes(previous.type))
      return false;
  }
  return false;
}
/* 为一个接牌座位计算此弃牌可用的胡、明杠、碰；按当前版本保留来源保护与优先级。
 * Compute this seat’s hu, exposed-kong, and peng options for one discard using this version’s protection and priority. */
function getDiscardClaimOptions(game, seat, discarded) {
  const player = game.players[seat];
  const counts = countTiles(player.hand);
  /* 弃牌来源是否已胡过决定其普通弃牌是否受保护。
   * A source player who has already won may have protected ordinary discards. */
  const sourceHasHu = game.players[discarded.seat].huCount > 0;
  const canHu =
    !isProtectedPostHuDiscard(game, discarded) &&
    getAllowedHuWaits(game, seat, discarded.tile, false);
  // A post-hu source is protected from both peng and mingGang, even after its kong.
  /* 来源已胡时保留胡牌例外，但不允许以该弃牌碰或明杠。
   * For an already-won source, retain any hu exception but forbid peng and exposed kong. */
  if (sourceHasHu)
    return canHu
      ? [
          {
            type: 'hu',
          },
        ]
      : [];
  const canGang =
    player.melds.length < 4 &&
    counts[discarded.tile] >= 3 &&
    canDeclareKong(game, seat, 'mingGang', discarded.tile);
  const canPeng = !player.huCount && player.melds.length < 4 && counts[discarded.tile] >= 2;
  // 新局未胡玩家保留所有合法选择；已胡必胡仍由最终白名单保证。
  // New games retain all unwon-player choices; the final allowlist still enforces post-hu wins.
  // 旧局缺开关时不改变已经采用的胡优先策略。
  // Missing saved flags preserve the historical hu-first policy.
  if (canHu && canGang && (player.huCount > 0 || game.rules.preHuActionChoice !== true))
    return [
      {
        type: 'hu',
      },
    ];
  const actions = canHu
    ? [
        {
          type: 'hu',
        },
      ]
    : [];
  if (canGang)
    actions.push({
      type: 'mingGang',
      tile: discarded.tile,
    });
  if (canPeng)
    actions.push({
      type: 'peng',
      tile: discarded.tile,
    });
  return actions;
}

/** v0.7.0 incorrectly disabled all pung upgrades. Correct those live games without
 * rewriting their hands, history, pending claims or scores. Older allow/missing
 * policies keep their original timing. */
// 新策略及 v0.7.0 的错误禁用值都要求先完成碰后出牌；更老的允许/缺省策略仍保留。
// Both the new policy and v0.7.0's erroneous false require a post-peng discard; older allow/missing timing stays intact.
function requiresPungDiscard(game) {
  return game.rules.pungUpgradeAfterDiscard === true || game.rules.allowPungUpgrade === false;
}
// 判断本座位是否仍欠碰后那次出牌。新存档读布尔标记；旧存档逆查最后碰/出牌事件。
// Determine whether the seat still owes its post-peng discard: use the saved flag or scan legacy events backward.
// 暗杠、补摸等都不能代替真正出牌，所以扫描时只认 peng 和 discard。
// A concealed kong or replacement draw does not discharge this requirement; only peng/discard events matter.
function pendingPungDiscard(game, seat) {
  const saved = game.players[seat].pendingPungDiscard;
  if (typeof saved === 'boolean') return saved;
  // Pre-fix games have no marker. Kong/replacement draws do not discharge the
  // requirement: only the player's actual discard after their latest peng does.
  for (let i = game.history.length - 1; i >= 0; i--) {
    const event = game.history[i];
    if (event.seat !== seat) continue;
    if (event.type === 'discard') return false;
    if (event.type === 'peng') return true;
  }
  return false;
}
/* 服务端权威动作白名单；按阶段、轮次和座位返回具体动作，不信任前端按钮。
 * Return the authoritative action allowlist by phase, turn, and seat; frontend buttons are not trusted validation. */
export function getLegalActions(game, seat) {
  // 展示结束前所有座位都必须等待，不能用旧按钮绕过续行边界。
  // Every seat waits for presentation; stale buttons cannot bypass the continuation boundary.
  if (
    game.presentation || !validSeat(game, seat) ||
    game.phase === 'finished'
  ) return [];
  if (game.phase === 'claim') {
    if (!game.claim?.eligibleSeats.includes(seat) || game.claim.responses[seat]) return [];
    // 已保存未回应窗口也要过滤新禁胡条件，但保留过牌让旧窗口可正常收束。
    // Filter unanswered saved windows too, retaining pass so a now-blocked old window can close.
    // 已提交回应在上面返回空动作，不在读取时改写或撤销。
    // Already committed responses returned above are never rewritten or revoked on read.
    const protectedDiscard = isProtectedPostHuDiscard(game, game.discards[game.claim.discardIndex]);
    const options = cloneSerializable(game.claim.options[seat]).filter((action) => {
      if (action.type === 'hu')
        return !protectedDiscard && !hasSelfDiscardHuLock(game, seat, game.claim.tile);
      // 保存窗口中的未回应明杠也须保护胡后牌型；已接受的回应在函数开头返回，不撤销。
      // Revalidate unanswered saved exposed kongs against the fixed post-hu shape; accepted responses returned above stay committed.
      if (action.type === 'mingGang' && game.players[seat].huCount > 0)
        return canDeclareKong(game, seat, action.type, action.tile);
      return true;
    });
    // 已胡者能胡就只能胡，普通接炮和抢杠共用此入口。读取时也过滤旧存档的选项，
    // 但不改写原窗口、已提交回应或历史；旧客户端不能通过直接发“过”绕过。
    // A prior winner must take an available discard/rob-kong win. Filter saved options on read
    // without rewriting the window, submitted responses or history; old-client pass requests fail too.
    if (game.players[seat].huCount > 0 && options.some((action) => action.type === 'hu'))
      return options.filter((action) => action.type === 'hu');
    return [
      ...options,
      {
        type: 'pass',
      },
    ];
  }
  if (game.phase !== 'turn' || game.currentSeat !== seat || game.turnStep !== 'discard') return [];
  const player = game.players[seat];
  /* 只承认当前座位对应的最后摸牌，碰牌后不能伪造一次自摸。
   * Recognize only this seat’s last draw; a peng cannot manufacture a self-draw win. */
  const drawn = game.lastDraw?.seat === seat ? game.lastDraw.tile : null;
  const actions = (
    player.huCount ? (drawn === null ? [] : [drawn]) : sortTiles(new Set(player.hand))
  ).map((tile) => ({
    type: 'discard',
    tile,
  }));
  const canHu = drawn !== null && getAllowedHuWaits(game, seat, drawn, true);
  if (canHu) {
    // 胡后的自然摸牌、续摸和杠后补摸统一必须胡；返回前排除所有过牌/出牌选择。
    // Normal, continuation and kong-replacement draws all require a post-hu win;
    // return before exposing any discard/pass alternative, regardless of the auto-discard setting.
    if (player.huCount > 0) return [{ type: 'hu' }];
    actions.push({
      type: 'hu',
    });
  }
  // 首胡前胡与杠不是互斥；保存局未启用新开关时仍保留旧行为。
  // Before the first win, hu and kong are independent choices; old saves retain their policy.
  if (!canHu || game.rules.preHuActionChoice === true) {
    const counts = countTiles(player.hand);
    for (let tile = 0; tile < TILE_COUNT; tile++) {
      if (
        player.melds.length < 4 &&
        counts[tile] >= 4 &&
        // 只有本人的真实出牌才能结束碰后禁暗杠窗口，补摸不算。
        // Only this player's actual discard ends the post-peng restriction, not a replacement draw.
        !(game.rules.concealedKongAfterPungDiscard === true && pendingPungDiscard(game, seat)) &&
        canDeclareKong(game, seat, 'anGang', tile)
      )
        actions.push({
          type: 'anGang',
          tile,
        });
      if (
        (!requiresPungDiscard(game) || !pendingPungDiscard(game, seat)) &&
        counts[tile] &&
        player.melds.some((meld) => meld.type === 'peng' && meld.tile === tile) &&
        canDeclareKong(game, seat, 'buGang', tile)
      )
        actions.push({
          type: 'buGang',
          tile,
        });
      if (
        counts[tile] &&
        player.melds.some((meld) => meld.tile === tile && canExtendKong(game, meld)) &&
        canDeclareKong(game, seat, 'addGang', tile)
      )
        actions.push({
          type: 'addGang',
          tile,
        });
    }
  }
  // Once the hand is locked after hu, a legal kong is mandatory when no hu is available.
  // Filtering discard as well as pass prevents older clients from bypassing the choice.
  if (
    player.huCount &&
    !actions.some((action) => action.type === 'hu') &&
    actions.some((action) => action.type.endsWith('Gang'))
  )
    return actions.filter((action) => action.type.endsWith('Gang'));
  // Manual mode is a server-side decision, not a client timer. Only pass may
  // release the drawn tile; an old/forged discard must not skip that confirmation.
  if (player.huCount && drawn !== null && game.rules.autoDiscardAfterHu === false)
    return [
      ...actions.filter((action) => action.type !== 'discard'),
      {
        type: 'pass',
      },
    ];
  return actions;
}

/** Private, actionable explanation; reads no other player's concealed tiles. */
/* 只用本人和公开信息解释当前不能胡的原因；返回机器码、中文提示和可公开的补充信息。
 * Explain hu availability using only this player’s and public information; return a code, message, and permitted details. */
export function getHuDiagnostic(game, seat) {
  if (!validSeat(game, seat)) throw new Error('座位无效');
  const reply = (code, message, extra = {}) => ({
    canHu: code === 'AVAILABLE',
    code,
    message,
    ...extra,
  });
  /* 终局不能再次关闭或结算，避免重复事件或积分。
   * Do not finish or settle an already finished game again. */
  if (game.phase === 'finished')
    return reply(
      'FINISHED',
      game.finishReason === 'allPlayersHu' ? '所有玩家都已胡牌，本局结束。' : '牌墙已用完，本局结束。',
    );
  const player = game.players[seat];
  let tile;
  let fromHand;
  if (game.phase === 'claim') {
    if (game.claim.discardSeat === seat)
      return reply('WRONG_TURN', '这是你打出的牌，请等待其他玩家回应。');
    if (game.claim.responses[seat])
      return reply('ALREADY_RESPONDED', '你已回应，正在等其他有资格的玩家操作。');
    tile = game.claim.tile;
    fromHand = false;
    const discarded = game.discards[game.claim.discardIndex];
    if (isProtectedPostHuDiscard(game, discarded))
      return reply('PROTECTED_DISCARD', '对方已经胡过；其普通出牌不能接胡，杠后出牌除外。', {
        tile,
      });
  } else {
    if (game.currentSeat !== seat)
      return reply('WRONG_TURN', '还没轮到你；有可接胡的弃牌时会提示。');
    if (game.turnStep !== 'discard' || game.lastDraw?.seat !== seat)
      return reply('WRONG_TURN', '碰牌后需要先出牌，不能直接自摸胡牌。');
    tile = game.lastDraw.tile;
    fromHand = true;
  }
  const base = [...player.hand];
  if (fromHand) removeTilesFromHand(base, tile);
  const waitTiles = contextualWaitTiles(game, player, base);
  const extra = {
    tile,
    waitTiles,
  };
  if (!fromHand && hasSelfDiscardHuLock(game, seat, tile))
    return reply('SELF_DISCARD_LOCK', `你打出过${tileLabel(tile)}，下次自己摸牌前不能胡这张牌；其他听口不受此限制。`, extra);
  if (!waitTiles.includes(tile)) {
    return reply(
      'SHAPE',
      waitTiles.length
        ? `这张${tileLabel(tile)}不在你的听口；可胡${waitTiles.map(tileLabel).join('、')}。`
        : '当前牌形还未凑成四组加一对（或已启用的七对），暂时不能胡。',
      extra,
    );
  }
  if (game.phase === 'claim' && !game.claim.eligibleSeats.includes(seat))
    return reply('NOT_ELIGIBLE', '本次弃牌没有你的可用接牌操作，请等待下一次机会。', extra);
  // 诊断也遵守已胡必胡，避免抢杠说明仍误导玩家可以过；可胡判断仍来自上面的真实牌型。
  // Diagnostics must not advertise pass to a prior winner; availability still uses the actual shape checks above.
  if (player.huCount > 0)
    return reply('AVAILABLE', '你已经胡过，当前能胡就必须胡；请点击“胡牌”，不能过、出牌、碰或杠。', extra);
  return reply(
    'AVAILABLE',
    game.claim?.kind === 'robKong'
      ? `这张${game.claim.kongType === 'addGang' ? '加杠' : '补杠'}牌可以抢杠胡；只有胡或过，所有回应后一起结算。`
      : fromHand
        ? '这张牌可以自摸胡牌。'
        : '这张弃牌可以接胡；所有有资格的玩家回应后一起结算。',
    extra,
  );
}
/* 记录已经成立的事件并标注本次引擎修订号；事件顺序也用于语音和杠后来源判断。
 * Append a committed event with the engine revision; order also drives voices and replacement-draw provenance. */
function appendHistoryEvent(game, event) {
  game.history.push({
    revision: game.revision,
    ...event,
  });
}
/* 关闭本局的动作窗口并保留最终状态；终局结算方式由该规则版本决定。
 * Close this game’s action window and preserve final state; settlement follows this engine version. */
function finishGame(game, reason = 'wallExhausted') {
  /* 终局不能再次关闭或结算，避免重复事件或积分。
   * Do not finish or settle an already finished game again. */
  if (game.phase === 'finished') return;
  game.phase = 'finished';
  game.turnStep = null;
  game.claim = null;
  game.lastDraw = null;
  game.finishReason = reason;
  for (const discarded of game.discards) discarded.claimable = false;
  settleDragons(game);
  appendHistoryEvent(game, {
    type: 'finish',
    reason,
    message:
      reason === 'allPlayersHu'
        ? '所有玩家都已胡牌，本局结束，积分已结算。'
        : '牌墙已摸完，本局结束，积分已结算。',
  });
}
/* 把状态移到指定座位的摸牌步骤，并清空已完成的接牌窗口和上次摸牌记录。
 * Enter the requested seat’s draw step and clear the completed claim window and previous draw. */
function beginDrawStep(game, seat, kind = 'normal') {
  game.currentSeat = seat;
  game.phase = 'turn';
  game.turnStep = 'draw';
  game.drawKind = kind;
  game.lastDraw = null;
  game.claim = null;
}
/* 仅接受座位与付款来源都合法的杠事件，避免把无关历史当作本次补摸的来源。
 * Accept only a kong event with a valid seat and payer source, never unrelated historical provenance. */
function kongSourceFromEvent(game, event, seat) {
  if (event?.seat !== seat || !['mingGang', 'anGang', 'buGang', 'addGang'].includes(event.type))
    return null;
  if (
    event.type === 'mingGang'
      ? !Number.isInteger(event.fromSeat) ||
        event.fromSeat < 0 ||
        event.fromSeat >= game.players.length ||
        event.fromSeat === seat
      : event.fromSeat !== null
  )
    return null;
  return {
    type: event.type,
    fromSeat: event.fromSeat,
  };
}
/* 优先读本次补摸保存的杠来源；旧存档只允许用相邻且同修订号的杠/摸牌事件回溯。
 * Read saved replacement provenance first; legacy fallback requires adjacent kong/draw events in the same revision. */
function replacementKongSource(game, seat) {
  const draw = game.lastDraw;
  if (draw?.seat !== seat || draw.source !== 'replacement') return null;
  if (Object.hasOwn(draw, 'kongSource'))
    return kongSourceFromEvent(
      game,
      {
        ...draw.kongSource,
        seat,
      },
      seat,
    );
  // Older schema-3 saves did not retain provenance. Only the adjacent, matching
  // kong/draw pair proves which kong caused this draw; never reuse an older kong.
  const drawn = game.history.at(-1),
    kong = game.history.at(-2);
  if (
    drawn?.type !== 'draw' ||
    drawn.seat !== seat ||
    drawn.source !== 'replacement' ||
    !Number.isSafeInteger(drawn.revision) ||
    drawn.revision < 0 ||
    kong?.revision !== drawn.revision
  )
    return null;
  return kongSourceFromEvent(game, kong, seat);
}
/* 从牌墙头取一张牌并进入出牌步骤；只记录公开的摸牌事件，不公开摸到的牌种。
 * Take a tile from the wall head and enter the discard step; the public draw event does not reveal its identity. */
function drawTile(game) {
  /* 牌墙耗尽立即终局，不从空数组取出 undefined 当作牌。
   * An empty wall ends the game; never draw undefined as a tile. */
  if (!game.wall.length) return finishGame(game);
  const seat = game.currentSeat;
  const source = game.drawKind;
  const player = game.players[seat];
  if (source === 'normal' && game.rules.repeatHuLock === 'untilNaturalDraw')
    player.huLockActive = false;
  const tile = game.wall.shift();
  player.hand.push(tile);
  player.hand.sort((a, b) => a - b);
  const latest = game.history.at(-1);
  const kongSource =
    source === 'replacement' && latest?.revision === game.revision
      ? kongSourceFromEvent(game, latest, seat)
      : null;
  game.lastDraw = {
    seat,
    tile,
    source,
    ...(kongSource
      ? {
          kongSource,
        }
      : {}),
  };
  game.phase = 'turn';
  game.turnStep = 'discard';
  appendHistoryEvent(game, {
    type: 'draw',
    seat,
    source,
    message: `${seat + 1}号位${source === 'replacement' ? '杠后补牌' : source === 'continuation' ? '胡后补摸' : '摸了一张牌'}。`,
  });
}

/** Confirmed fan table: 1,2,4,8,10,12,14,16, then +2 per fan. */
/* 把番数转成每个付款方应付的基础分：1–4 番翻倍，5 番起按 2×番数计算。
 * Convert fan to base points per payer: double through four fan, then use twice the fan count. */
export function fanToPoints(fan) {
  if (!Number.isSafeInteger(fan) || fan < 1) throw new Error('番数无效');
  return fan <= 4 ? 2 ** (fan - 1) : 2 * fan;
}
/* 只计算本次胡牌分解，不直接转账；各版本的萝卜、神龙和大单吊重叠策略不能混用。
 * Calculate one hu score breakdown without transferring points; keep version-specific radish, dragon, and big-single policies. */
function calculateHuScore(game, seat, bigSingle, pattern, kongEventType = null) {
  const player = game.players[seat];
  // The winning tile is now in winPile, not in hand. River references never join these counts.
  /* 本人手牌与逻辑胡牌区一起参与相应计分，不把弃牌河再计一遍。
   * Combine the hand and logical win pile for applicable scoring without recounting the discard river. */
  const handAndWins = [...player.hand, ...player.winPile.map((item) => item.tile)];
  const owned = [...handAndWins, ...tilesInMelds(player)];
  /* 新局同牌四张起每张一番；旧局保留原档位和超过八张的兜底，七对仍使用首次固定档位。
   * New games add count minus three from four copies; old saves retain their tiers/fallback and seven pairs stays fixed. */
  const rawCopyFanBonus = countTiles(owned).reduce(
    (sum, count) =>
      sum +
      (count === 4
        ? 1
        : count === 5
          ? 2
          : count === 6
            ? game.rules.sixCopyFan
            : count === 7
              ? 4
              : count === 8
                ? 5
                : count > 8
                  ? game.rules.extendedCopyFan === true
                    ? count - 3
                    : game.rules.sevenPlusCopyFan
                  : 0),
    0,
  );
  const special = game.rules.specialHuPatterns === true;
  // The first qualifying seven-pairs win freezes its full tier, including an existing pure suit.
  /* 已启用特殊牌型且当前为七对时，采用首次七对固定档位。
   * Use the captured seven-pairs tier only when special-pattern rules are enabled. */
  const sevenPairsFixed = special && pattern?.kind === 'sevenPairs';
  const copyFanBonus = sevenPairsFixed ? 0 : rawCopyFanBonus;
  const patternBonuses = [];
  if (sevenPairsFixed) {
    patternBonuses.push({
      type: 'sevenPairs',
      fan: pattern.sevenPairsFan,
    });
    if (pattern.pureSuit)
      patternBonuses.push({
        type: 'pureSuit',
        fan: 2,
      });
  } else if (special) {
    if (bigSingle)
      patternBonuses.push({
        type: 'bigSingle',
        fan: 2,
      });
    else if (pattern?.allTriplets)
      patternBonuses.push({
        type: 'allTriplets',
        fan: 2,
      });
    if (pattern?.pureSuit)
      patternBonuses.push({
        type: 'pureSuit',
        fan: 2,
      });
  }
  // 事件番只影响本次胡，不写入首胡牌型，避免后续胡重复累积。
  // Event fan belongs to this win only; never store it in the first pattern and accumulate it on later wins.
  const kongEventBonus = kongEventType ? 1 : 0;
  const fan =
    (sevenPairsFixed
      ? pattern.fixedFan
      : game.rules.baseFan +
        copyFanBonus +
        patternBonuses.reduce((sum, item) => sum + item.fan, 0)) + kongEventBonus;
  if (kongEventBonus)
    patternBonuses.push({
      type: kongEventType,
      fan: kongEventBonus,
    });
  const fanPoints = fanToPoints(fan);
  /* 当前 v3 按全桌共享萝卜计分；翻牌归属与计分归属不是同一个概念。
   * Current v3 scores the shared table radish pool; reveal ownership differs from scoring scope. */
  const scoringRadishes = game.players.flatMap((other) => other.radishes);
  const currentWin = player.winPile.at(-1).tile;
  const currentWinningHand = [...player.hand, currentWin];
  /* 按本局规则选择能与萝卜匹配的牌区，不含对手私有牌。
   * Choose enabled personal scoring zones for radish matching, never opponents’ concealed tiles. */
  const radishOwned = [
    ...(game.rules.radishCountsWinPile ? handAndWins : currentWinningHand),
    ...(game.rules.radishCountsMelds ? tilesInMelds(player) : []),
  ];
  const matchCounts = countTiles(radishOwned);
  const radishCounts = countTiles(scoringRadishes);
  /* 每种牌的“本人匹配张数 × 同种萝卜张数”相加，不能只数是否出现。
   * Sum personal matching copies times matching radish copies; presence alone is insufficient. */
  const radishBonus = matchCounts.reduce((sum, count, tile) => sum + count * radishCounts[tile], 0);
  // Dragons settle once at game end, never on an individual hu.
  const dragonBonus = 0;
  const combined = fanPoints + radishBonus;
  const bigSinglePoints = bigSingle && !special ? 50 : 0;
  const total =
    bigSingle && !special
      ? game.rules.bigSingleOverlap === 'exclusive'
        ? 50
        : combined + 50
      : combined;
  return {
    base: game.rules.baseFan,
    fan,
    fanPoints,
    copyFanBonus,
    radishBonus,
    dragonBonus,
    bigSingle,
    bigSinglePoints,
    // 保留抢杠的历史字段名；新增来源使用独立字段，不把旧事件伪装成新快照。
    // Preserve the historical rob-kong field; new sources use distinct fields without rewriting old events.
    ...(kongEventBonus ? { [`${kongEventType}Bonus`]: kongEventBonus } : {}),
    overlapPolicy: special ? 'fan' : game.rules.bigSingleOverlap,
    total,
    ...(special
      ? {
          patternBonuses,
          sevenPairsFixed,
          specialHuPattern: pattern?.kind === 'standard' ? null : (pattern?.kind ?? null),
        }
      : {}),
  };
}
/* 为每位付款方扣同额积分，再把合计加给收款座位；返回可审计的零和转账明细。
 * Debit each payer equally and credit the recipient with the total; return auditable zero-sum payment entries. */
function transferPoints(game, seat, payerSeats, amount) {
  const payments = payerSeats.map((payer) => ({
    seat: payer,
    delta: -amount,
  }));
  payments.push({
    seat,
    delta: amount * payerSeats.length,
  });
  for (const payment of payments) game.players[payment.seat].score += payment.delta;
  return payments;
}

/** Award only an actual stable ready shape, never a speculative claim or a read. */
/* 仅在真实成立的大单吊待牌状态收一次喜钱；合法动作试算与只读请求不能触发收款。
 * Award the ready bonus once only for a committed big-single waiting shape, never a speculative action or read. */
function awardBigSingleReady(game, seat) {
  const player = game.players[seat];
  if (
    game.rules.bigSingleReadyPayment !== true ||
    game.rules.specialHuPatterns !== true ||
    player.bigSingleReadyPaid === true ||
    player.melds.length !== 4 ||
    player.hand.length !== 1 ||
    getWaitTiles(player.hand, player.melds, game.rules).length === 0
  )
    return;
  player.bigSingleReadyPaid = true;
  // Old saved games lack the amount and must retain their original 50-point rule.
  // nullish 回退保留旧局 50 分；0 是有效配置，不能用 || 错误变回 50。
  // A nullish fallback preserves legacy fifty; zero is valid and must not be replaced by a truthy fallback.
  const points = game.rules.bigSingleReadyPoints ?? DEFAULT_BIG_SINGLE_READY_POINTS;
  // 0 分仍记录本局已处理，但不生成扣款；正常金额沿用同一零和转账入口。
  // Zero still marks the bonus processed but creates no debit; other amounts use the same zero-sum transfer.
  const payments =
    points === 0
      ? []
      : transferPoints(
          game,
          seat,
          allSeats(game).filter((other) => other !== seat),
          points,
        );
  appendHistoryEvent(game, {
    type: 'bigSingleReady',
    seat,
    points,
    payments,
    message: `${seat + 1}号位大单吊听牌，${points === 0 ? '本局喜钱设为0分，不收取' : `另外${game.players.length - 1}家各付${points}分喜钱`}，本局仅结算一次，后续胡牌分另算。`,
  });
}

/** End-of-game transfers are independently guarded so serialization/retries cannot re-charge them. */
/* 终局按手牌、副露、胡牌区及启用的共享萝卜算神龙；settled 标记避免重复收费。
 * Settle dragons at game end using enabled tile zones; the settled guard prevents duplicate charges. */
function settleDragons(game) {
  /* 此标记随存档保存，读取、重试和重复终局不能再次收取神龙分。
   * This persisted guard prevents dragon charges on reload, retry, or repeated finish. */
  if (game.dragonSettlement.settled) return;
  const sharedRadishes = game.players.flatMap((player) => player.radishes);
  const entries = game.players
    .map((player) => {
      const owned = [
        ...player.hand,
        ...(game.rules.dragonCountsMelds ? tilesInMelds(player) : []),
        ...(game.rules.dragonCountsWinPile ? player.winPile.map((win) => win.tile) : []),
        ...(game.rules.dragonCountsSharedRadishes ? sharedRadishes : []),
      ];
      // 新局从保存门槛起10分，每多一张翻倍；缺标记旧局沿用原6/7/8封顶分表。
      // New snapshots double ten points from their saved threshold; absent flags preserve the old capped table.
      const exponential = game.rules.exponentialDragon === true;
      const threshold = exponential ? game.rules.dragonStartCount : 6;
      const dragons = countTiles(owned).flatMap((count, tile) =>
        count >= threshold
          ? [
              {
                tile,
                count,
                points: exponential
                  ? 10 * 2 ** (count - threshold)
                  : game.rules.dragonPoints[Math.min(8, count)],
              },
            ]
          : [],
      );
      return {
        seat: player.seat,
        dragons,
        points: dragons.reduce((sum, dragon) => sum + dragon.points, 0),
      };
    })
    .filter((entry) => entry.dragons.length);
  game.dragonSettlement = {
    settled: true,
    entries: [],
  };
  for (const entry of entries) {
    const payments = transferPoints(
      game,
      entry.seat,
      allSeats(game).filter((seat) => seat !== entry.seat),
      entry.points,
    );
    const settled = {
      ...entry,
      payments,
    };
    game.dragonSettlement.entries.push(settled);
    appendHistoryEvent(game, {
      type: 'dragonSettlement',
      ...cloneSerializable(settled),
      message: `${entry.seat + 1}号位终局神龙结算：${entry.dragons.map((dragon) => `${tileLabel(dragon.tile)}${dragon.count}张`).join('、')}，另外${game.players.length - 1}家各付${entry.points}分。`,
    });
  }
}

/** Prepare every simultaneous winner before scoring or deciding that the hand is over. */
/* 先为所有同时胡牌者更新牌区，再统一算分和付款；避免一炮多响被首个赢家提前结束。
 * Prepare tile zones for every simultaneous winner before scoring and payment so the first winner cannot end the batch early. */
function settleHuBatch(game, winners, tile, source, fromSeat = null, discardIndex = null) {
  const selfDraw = source === 'selfDraw';
  const replacementKong = selfDraw ? replacementKongSource(game, winners[0]) : null;
  // Snapshot before the simultaneous batch. Only the specifically confirmed repeat-selfdraw case changes.
  /* 先保存整个同时胡牌批次之前的已胡座位，避免前一个赢家改变后一个人的付款判断。
   * Snapshot won seats before the simultaneous batch so earlier winners do not distort later payer decisions. */
  const priorHuSeats = game.players
    .filter((player) => player.huCount > 0)
    .map((player) => player.seat);
  /* 先为所有赢家准备牌区与牌型，再进入下面的算分循环。
   * Prepare zones and patterns for every winner before entering the scoring loop below. */
  const prepared = winners.map((seat, index) => {
    const player = game.players[seat];
    // 仅当前这个已接受的接胡回应可保留旧意图；牌种、来源位、弃牌索引及胡牌来源均须一致。
    // Only this exact accepted claim may retain an old intent: identity, source seat, river index and win source must match.
    const claimedDiscard = game.discards[discardIndex];
    const honorCommittedClaim = !selfDraw && game.phase === 'claim' &&
      game.claim?.tile === tile && game.claim.discardSeat === fromSeat &&
      game.claim.discardIndex === discardIndex && game.claim.responses[seat]?.type === 'hu' &&
      source === (game.claim.kind === 'robKong' ? 'robKong' : claimedDiscard?.afterKong ? 'kongDiscard' : 'discard');
    const waits = getAllowedHuWaits(
      game,
      seat,
      tile,
      selfDraw,
      // 发布前已接受的回应属于已提交意图，不能因新禁胡规则卡死整个多人窗口。
      // Honor an accepted pre-correction claim so the new lock cannot strand a saved multi-party window.
      // 新请求先经getLegalActions拒绝，因此此例外不能让旧客户端新提交禁胡动作。
      // New requests already pass getLegalActions, so old clients cannot use this settlement-only exception to bypass the lock.
      honorCommittedClaim,
    );
    if (!waits) throw new Error('当前不能胡牌');
    /* 四组已成副露加最后一对，表示大单吊胡牌形状。
     * Four established melds plus the final pair form the big-single winning shape. */
    const bigSingle = player.hand.length - (selfDraw ? 1 : 0) === 1;
    const wasRepeat = player.huCount > 0;
    const winningHand = selfDraw ? [...player.hand] : [...player.hand, tile];
    /* 牌型快照用于固定特殊胡牌档位；不要用后来累积的胡牌区反推首次牌型。
     * The pattern snapshot preserves a special winning tier; later win-pile growth cannot reconstruct the first shape. */
    let pattern = null;
    /* 七对或大单吊的重复胡牌沿用此前保存的特殊牌型。
     * Repeated seven-pairs or big-single wins reuse their saved special pattern. */
    const repeatedSpecial =
      wasRepeat && ['sevenPairs', 'bigSingle'].includes(player.firstHuPattern?.kind);
    if (game.rules.specialHuPatterns === true) {
      pattern = repeatedSpecial
        ? player.firstHuPattern
        : classifyHuPattern(winningHand, player.melds, game.rules);
      // A standard first win can later become the player's first qualifying special win.
      if (!player.firstHuPattern || (!repeatedSpecial && pattern.kind !== 'standard'))
        player.firstHuPattern = cloneSerializable(pattern);
    }
    /* 只存这次新翻的萝卜，供事件展示；累计萝卜另存于玩家状态。
     * Collect only newly revealed radishes for this event; cumulative radishes live in player state. */
    const newRadishes = [];
    if (!game.firstHuRadishesRevealed) {
      game.firstHuRadishesRevealed = true;
      // Missing field means an older save whose kong radishes were already revealed.
      /* 首胡一次翻六张，再补翻首胡之前累计的杠萝卜；缺字段视为旧局已处理。
       * Reveal six first-hu radishes plus deferred kong radishes; a missing field means legacy handling already applied. */
      const radishCount = 6 + (game.pendingKongRadishes ?? 0);
      game.pendingKongRadishes = 0;
      for (let i = 0; i < radishCount && game.wall.length; i++) newRadishes.push(game.wall.pop());
      player.radishes.push(...newRadishes);
    }
    if (selfDraw) {
      removeTilesFromHand(player.hand, tile);
      game.retiredTiles.push({
        seat,
        tile,
      });
    }
    player.winPile.push({
      tile,
      source,
      virtual: !selfDraw && index > 0,
      ...(discardIndex === null
        ? {}
        : {
            discardIndex,
          }),
    });
    player.huCount++;
    player.lockedWaits =
      game.rules.specialHuPatterns === true
        ? contextualWaitTiles(game, player, player.hand)
        : waits;
    player.huLockActive = true;
    return {
      seat,
      newRadishes,
      bigSingle,
      pattern,
      wasRepeat,
    };
  });
  for (const { seat, newRadishes, bigSingle, pattern, wasRepeat } of prepared) {
    /* 七对沿用固定档位，首次及重复胡均不叠加事件番。普通抢杠保留历史加番；
     * 其他来源严格要求开局快照为 true，旧存档不能靠读取新默认值启用。
     * Seven pairs keeps its fixed tier on first and repeated wins. Ordinary rob-kong retains its historical bonus;
     * other sources require an explicit true snapshot, never a default injected into saved games. */
    let kongEventType = null;
    if (pattern?.kind !== 'sevenPairs') {
      if (source === 'robKong') kongEventType = 'robKong';
      else if (game.rules.kongEventFan === true) {
        if (source === 'kongDiscard') kongEventType = 'kongDiscard';
        // 只认本次杠后补摸；普通摸牌、胡后续摸和上一次杠的标记都不能获得此番。
        // Only the current replacement draw qualifies, not natural/continuation draws or an earlier kong marker.
        else if (selfDraw && game.lastDraw?.seat === seat && game.lastDraw.source === 'replacement')
          kongEventType = 'kongReplacement';
      }
    }
    const score = calculateHuScore(game, seat, bigSingle, pattern, kongEventType);
    const repeatSelfDrawWithOneUnhu =
      selfDraw && !bigSingle && priorHuSeats.length === game.players.length - 1 && priorHuSeats.includes(seat);
    /* 本批次之前尚未胡、而现在全员均已胡，才符合末家首次胡的付款例外。
     * The final-first-hu payment exception requires a previously unwon seat and all seats now having won. */
    const finalFirstHu =
      game.rules.finalHuPaymentExceptions === true &&
      !priorHuSeats.includes(seat) &&
      game.players.every((player) => player.huCount > 0);
    // A discard after a kong is still a discard: only its actual source pays.
    const payerSeats =
      source === 'kongDiscard' || source === 'robKong'
        ? [fromSeat]
        : replacementKong
          ? replacementKong.type === 'mingGang'
            ? [replacementKong.fromSeat]
            : allSeats(game).filter((other) => other !== seat)
          : finalFirstHu && selfDraw
            ? allSeats(game).filter((other) => other !== seat)
            : selfDraw &&
                game.lastDraw?.source !== 'replacement' &&
                game.rules.selfDrawOnlyUnwon === true
              ? allSeats(game).filter((other) => other !== seat && !priorHuSeats.includes(other))
              : repeatSelfDrawWithOneUnhu
                ? allSeats(game).filter((other) => !priorHuSeats.includes(other))
                : source === 'discard' && !bigSingle
                  ? [fromSeat]
                  : allSeats(game).filter((other) => other !== seat);
    const payments = transferPoints(game, seat, payerSeats, score.total);
    game.players[seat].lastScoreBreakdown = cloneSerializable(score);
    const payerLabel =
      payerSeats.length === 0
        ? '无未胡付款方，本次不收取胡牌分'
        : payerSeats.length === 1
          ? `${payerSeats[0] + 1}号位付${score.total}分`
          : `另外${payerSeats.length}家各付${score.total}分`;
    const sourceLabel =
      source === 'robKong'
        ? `${bigSingle ? '大单钓·' : ''}抢杠胡（仅补杠者付款）`
        : source === 'kongDiscard'
          ? `${bigSingle ? '大单钓·' : ''}杠后接炮（仅出牌者付款）`
          : replacementKong?.type === 'mingGang'
            ? `${bigSingle ? '大单钓·' : ''}明杠后补摸胡（仅杠牌出牌者付款）`
            : bigSingle
              ? '大单钓'
              : selfDraw
                ? '自摸'
                : '接炮';
    appendHistoryEvent(game, {
      type: 'hu',
      seat,
      tile,
      source,
      fromSeat,
      ...(replacementKong
        ? {
            kongSource: cloneSerializable(replacementKong),
          }
        : {}),
      points: score.total,
      score,
      payments,
      newRadishes,
      message: `${seat + 1}号位${sourceLabel}${tileLabel(tile)}，${payerLabel}，本次收入${score.total * payerSeats.length}分${newRadishes.length ? `，翻出${newRadishes.length}张萝卜` : ''}。`,
    });
  }
}
/* 完成本轮胡牌结算后决定终局或胡后补摸；不把胡牌等同于个人离席。
 * After settling hu, decide between game end and continuation draw; hu does not mean leaving a seat. */
function continueAfterHu(game, seat, presentationOptions) {
  // 胡牌已消费本次杠后机会；之后续摸弃牌受已胡保护，不再给他家接胡或加杠后番。
  // Hu consumes this kong opportunity. Later continuation discards are protected, not new post-kong claims.
  // 在展示暂停前清除，也覆盖从旧版“胡牌展示中”存档恢复的入口；既有结算不重算。
  // Clear before pausing, including restored old hu-presentation states, without recalculating committed scores.
  game.players[seat].pendingKongDiscard = false;
  // 结算已完成，但终局判定和续摸要等本批胡牌展示结束。
  // Settlement is committed; defer the end decision and draw until the hu batch is presented.
  if (presentationOptions?.pausePresentation) {
    game.phase = 'turn';
    game.turnStep = 'draw';
    game.currentSeat = seat;
    game.lastDraw = null;
    game.claim = null;
    game.presentation = { stage: 'hu', seat };
    return;
  }
  if (game.players.every((player) => player.huCount > 0)) finishGame(game, 'allPlayersHu');
  else beginDrawStep(game, seat, 'continuation');
}
/* 真正提交杠：移动实体牌、处理本版本杠分和萝卜、记录事件，再进入补摸流程。
 * Commit a kong: move physical tiles, apply this version’s payments and radishes, log, and enter replacement draw. */
function declareKong(game, seat, type, tile, fromSeat = null, presentationOptions) {
  const player = game.players[seat];
  let concealed = type === 'anGang';
  let kongSize = 4;
  if (type === 'buGang' || type === 'addGang') {
    removeTilesFromHand(player.hand, tile);
    const meld = player.melds.find(
      (item) =>
        item.tile === tile && (type === 'buGang' ? item.type === 'peng' : canExtendKong(game, item)),
    );
    concealed = meld.type === 'anGang';
    if (type === 'buGang') meld.type = 'buGang';
    meld.tiles.push(tile);
    kongSize = meld.tiles.length;
    if (type === 'addGang') meld.extended = true;
  } else {
    removeTilesFromHand(player.hand, tile, type === 'mingGang' ? 3 : 4);
    player.melds.push({
      type,
      tile,
      tiles: Array(4).fill(tile),
      ...(fromSeat === null
        ? {}
        : {
            fromSeat,
          }),
    });
  }
  // Keep the kong event immediately before its replacement draw for provenance.
  awardBigSingleReady(game, seat);
  const amount = type === 'anGang' || type === 'mingGang' ? 2 : 1;
  const payerSeats = type === 'mingGang' ? [fromSeat] : allSeats(game).filter((other) => other !== seat);
  const payments = transferPoints(game, seat, payerSeats, amount);
  /* 全桌首胡前只累计应翻数量；首次胡时才真正从牌墙尾部移出。
   * Before the table’s first hu, accumulate radish debt; remove actual wall-tail tiles at first hu. */
  const radishDeferred = !game.firstHuRadishesRevealed;
  let radish;
  if (radishDeferred) game.pendingKongRadishes = (game.pendingKongRadishes ?? 0) + 1;
  else {
    radish = game.wall.pop();
    player.radishes.push(radish);
  }
  player.kongCount++;
  player.pendingKongDiscard = true;
  game.claim = null;
  game.lastDraw = null;
  appendHistoryEvent(game, {
    type,
    seat,
    ...(concealed
      ? {}
      : {
          tile,
        }),
    fromSeat,
    ...(radishDeferred
      ? {
          radishDeferred: true,
          pendingKongRadishes: game.pendingKongRadishes,
        }
      : {
          radish,
        }),
    points: amount,
    payments,
    message: `${seat + 1}号位${
      {
        anGang: '暗杠',
        buGang: '补杠',
        mingGang: '明杠',
        addGang: `加杠至${kongSize}张`,
      }[type]
    }，${payerSeats.length === 1 ? '出牌方' : `另外${payerSeats.length}家各`}付${amount}分，${radishDeferred ? `累计待翻萝卜${game.pendingKongRadishes}张，首胡时一起翻` : `翻出萝卜${tileLabel(radish)}`}。`,
  });
  beginDrawStep(game, seat, 'replacement');
  if (presentationOptions?.pausePresentation) game.presentation = { stage: 'kong', seat };
}

/** An upgrade offers only the new tile. The original meld and all kong effects stay untouched. */
/* 补杠/加杠先只拿出新增一张供抢杠；所有人过以前，不修改原副露和杠分。
 * Offer only the new tile for rob-kong; do not change the original meld or kong payments until every responder passes. */
function offerKongUpgrade(game, seat, type, tile, presentationOptions) {
  const player = game.players[seat];
  const afterKong = game.lastDraw?.seat === seat && game.lastDraw.source === 'replacement';
  // A won player's ordinary draw is protected, just like its ordinary discard.
  if (player.huCount && !afterKong) return declareKong(game, seat, type, tile, null, presentationOptions);
  const options = {};
  for (const other of turnOrderAfter(game, seat)) {
    // Rob-kong is its own repeat-win exception. It never offers peng or mingGang.
    if (getAllowedHuWaits(game, other, tile, false))
      options[other] = [
        {
          type: 'hu',
        },
      ];
  }
  /* 按本局顺位保留有至少一项接牌动作的座位，响应窗口只等待这些人。
   * Keep eligible seats in saved turn order; the claim window waits only for them. */
  const eligibleSeats = turnOrderAfter(game, seat).filter((other) => options[other]);
  if (!eligibleSeats.length) return declareKong(game, seat, type, tile, null, presentationOptions);
  removeTilesFromHand(player.hand, tile);
  player.pendingKongDiscard = false;
  game.discards.push({
    seat,
    tile,
    claimable: true,
    afterKong,
    robKong: true,
  });
  game.lastDraw = null;
  game.phase = 'claim';
  game.turnStep = null;
  game.claim = {
    kind: 'robKong',
    kongType: type,
    discardIndex: game.discards.length - 1,
    discardSeat: seat,
    tile,
    eligibleSeats,
    options,
    responses: {},
  };
  appendHistoryEvent(game, {
    type: 'robKongAttempt',
    seat,
    tile,
    kongType: type,
    afterKong,
    message: `${seat + 1}号位尝试${type === 'addGang' ? '加杠' : '补杠'}${tileLabel(tile)}，等待其他玩家抢杠胡或过。`,
  });
}
/* 等待所有有资格座位回应后，一次性按本版本优先级处理；不按网络先到先得。
 * Wait for all eligible responses, then resolve together using version-specific priority, never network arrival order. */
function resolveClaimWindow(game, presentationOptions) {
  const claim = game.claim;
  /* 必须等到所有有资格玩家都明确回应，防止先点击的人抢走更高优先级。
   * Wait for every eligible response so arrival order cannot defeat a higher-priority action. */
  if (!claim.eligibleSeats.every((seat) => claim.responses[seat])) return;
  const discarded = game.discards[claim.discardIndex];
  discarded.claimable = false;
  const order = turnOrderAfter(game, discarded.seat);
  let winners = order.filter((seat) => claim.responses[seat]?.type === 'hu');
  if (!game.rules.multipleWinners) winners = winners.slice(0, 1);
  /* 只要有人胡牌，先走胡牌结算路径，下面的碰杠路径不再执行。
   * Any hu winner selects the hu settlement path and bypasses subsequent peng/kong resolution. */
  if (winners.length) {
    discarded.huSeats = winners;
    settleHuBatch(
      game,
      winners,
      discarded.tile,
      claim.kind === 'robKong' ? 'robKong' : discarded.afterKong ? 'kongDiscard' : 'discard',
      discarded.seat,
      claim.discardIndex,
    );
    continueAfterHu(game, winners[0], presentationOptions);
    return;
  }
  if (claim.kind === 'robKong') {
    // Move the offered physical tile into its original meld only once everyone passed.
    discarded.claimedBy = discarded.seat;
    discarded.claimedAs = claim.kongType;
    game.players[discarded.seat].hand.push(discarded.tile);
    game.players[discarded.seat].hand.sort((a, b) => a - b);
    declareKong(game, discarded.seat, claim.kongType, discarded.tile, null, presentationOptions);
    return;
  }
  // Wait for everyone first; kong outranks peng, equal claims use the saved direction, never click order.
  const caller =
    order.find((seat) => claim.responses[seat]?.type === 'mingGang') ??
    order.find((seat) => claim.responses[seat]?.type === 'peng');
  if (caller === undefined) return beginDrawStep(game, order[0]);
  const type = claim.responses[caller].type;
  discarded.claimedBy = caller;
  discarded.claimedAs = type;
  if (type === 'mingGang') declareKong(game, caller, type, discarded.tile, discarded.seat, presentationOptions);
  else {
    const player = game.players[caller];
    removeTilesFromHand(player.hand, discarded.tile, 2);
    // 碰成立后登记待出牌要求；其它杠动作不能把此标记清掉。
    // A committed peng starts the discard obligation; other kong actions cannot clear it.
    player.pendingPungDiscard = true;
    player.melds.push({
      type: 'peng',
      tile: discarded.tile,
      tiles: Array(3).fill(discarded.tile),
      fromSeat: discarded.seat,
    });
    game.phase = 'turn';
    game.currentSeat = caller;
    game.turnStep = 'discard';
    game.lastDraw = null;
    game.claim = null;
    appendHistoryEvent(game, {
      type: 'peng',
      seat: caller,
      tile: discarded.tile,
      message: `${caller + 1}号位碰${tileLabel(discarded.tile)}，请出牌。`,
    });
    if (presentationOptions?.pausePresentation) game.presentation = { stage: 'peng', seat: caller };
  }
}
/* 提交一张弃牌、清除摸牌上下文，再建立接牌窗口；无人能接时进入下家摸牌步骤。
 * Commit a discard, clear draw context, then open a claim window or advance to the next draw if nobody can claim. */
function discardTile(game, seat, tile, automatic = false, presentationOptions) {
  const player = game.players[seat];
  removeTilesFromHand(player.hand, tile);
  const discarded = {
    seat,
    tile,
    claimable: false,
    // 旧存档可能已完成续摸但还未弃牌；当前真实续摸来源足以证明旧杠标记已失效。
    // A saved continuation may already be drawn: its actual draw source proves the old kong marker expired.
    // 后续新杠的来源是 replacement，仍保留真正杠后出牌的接胡资格。
    // A newly committed kong produces replacement instead, preserving genuine post-kong discard claims.
    afterKong: player.pendingKongDiscard &&
      !(game.lastDraw?.seat === seat && game.lastDraw.source === 'continuation'),
  };
  player.pendingKongDiscard = false;
  // 只有实际弃牌才完成这次碰后的义务，后续符合条件即可补杠。
  // Only an actual discard fulfills the obligation and permits later otherwise-legal upgrades.
  player.pendingPungDiscard = false;
  game.discards.push(discarded);
  game.lastDraw = null;
  appendHistoryEvent(game, {
    type: 'discard',
    seat,
    tile,
    automatic,
    afterKong: discarded.afterKong,
    message: `${seat + 1}号位${automatic ? '摸后自动打出' : '打出'}${tileLabel(tile)}${discarded.afterKong ? '（杠后出牌，接胡仅出牌者付款）' : ''}。`,
  });
  awardBigSingleReady(game, seat);
  // 只保存公开弃牌索引，不提前计算或泄露任何对手的回应选项。
  // Store only the public discard index; do not compute or expose opponents' claims yet.
  if (presentationOptions?.pausePresentation) {
    game.phase = 'turn';
    game.turnStep = 'draw';
    game.currentSeat = seat;
    game.claim = null;
    game.presentation = { stage: 'discard', discardIndex: game.discards.length - 1 };
    return;
  }
  openDiscardClaimWindow(game, game.discards.length - 1);
}
/* 展示完成后才为指定已提交弃牌计算回应；此助手不再次移牌或记出牌事件。
 * Compute claims for a committed discard after presentation, without moving or logging the tile again. */
function openDiscardClaimWindow(game, discardIndex) {
  const discarded = game.discards[discardIndex];
  const { seat, tile } = discarded;
  const options = {};
  for (const other of turnOrderAfter(game, seat)) {
    const available = getDiscardClaimOptions(game, other, discarded);
    if (available.length) options[other] = available;
  }
  /* 按本局顺位保留有至少一项接牌动作的座位，响应窗口只等待这些人。
   * Keep eligible seats in saved turn order; the claim window waits only for them. */
  const eligibleSeats = turnOrderAfter(game, seat).filter((other) => options[other]);
  if (eligibleSeats.length) {
    discarded.claimable = true;
    game.phase = 'claim';
    game.turnStep = null;
    game.claim = {
      discardIndex: game.discards.length - 1,
      discardSeat: seat,
      tile,
      eligibleSeats,
      options,
      responses: {},
    };
  } else beginDrawStep(game, turnOrderAfter(game, seat)[0]);
}

/** No timing race or user draw action: stop only at a real player decision. */
/* 自动执行无需用户选择的摸牌/胡后摸打，遇到真实决策点立即停止；上限用于发现死循环。
 * Advance automatic draws and post-hu discards until a real decision is needed; the bound detects loops. */
function advanceAutomaticSteps(game, presentationOptions) {
  // 每两次自动转移至少消耗一张牌，按副数扩展防死循环界限，五副牌也不能提前截停。
  // Every two transitions consume a tile; scale the loop guard so five-deck games cannot stop early.
  const transitionLimit = 2 * TILE_COUNT * copiesPerTile(game.rules) + 12;
  for (let transitions = 0; transitions < transitionLimit; transitions++) {
    /* 接牌阶段或终局需要等待/停止，自动轮转不能跨过这些边界。
     * Claims and finished games stop automatic advancement at their phase boundaries. */
    if (game.presentation || game.phase !== 'turn') return;
    if (game.turnStep === 'draw') {
      drawTile(game);
      continue;
    }
    const seat = game.currentSeat;
    const player = game.players[seat];
    if (!player.huCount) return;
    if (game.rules.autoDiscardAfterHu === false) return;
    if (
      getLegalActions(game, seat).some(
        (action) => action.type === 'hu' || action.type.endsWith('Gang'),
      )
    )
      return;
    if (game.lastDraw?.seat !== seat) throw new Error('胡后缺少摸牌记录');
    discardTile(game, seat, game.lastDraw.tile, true, presentationOptions);
  }
  throw new Error('自动轮转超出牌墙上限');
}
/* 校验动作属于当前白名单后复制整局，在副本提交动作并检查守恒；成功才返回新状态。
 * Validate the action against the current allowlist, apply it to a copy, check invariants, and return only a valid new state. */
export function applyAction(game, seat, action) {
  return applyGameAction(game, seat, action);
}
/* 可选的音画分步入口；不写入规则快照，也不改变旧 applyAction 的同步行为。
 * Opt into presentation pacing per call, without altering rules or the immediate applyAction contract. */
export function applyPresentedAction(game, seat, action) {
  return applyGameAction(game, seat, action, { pausePresentation: true });
}
/* 恢复一段已提交展示；引擎 revision 保持原动作来源，房间 CAS 版本由 API 管理。
 * Resume one committed presentation boundary; retain action provenance revision, leaving room CAS to the API. */
export function continuePresentedGame(game) {
  if (game.schemaVersion !== 3) throw new Error('旧牌局需要使用原版本规则');
  if (!game.presentation) throw new Error('当前没有等待展示的操作');
  assertGameInvariants(game);
  const next = cloneSerializable(game);
  const presentation = next.presentation;
  delete next.presentation;
  if (presentation.stage === 'discard') openDiscardClaimWindow(next, presentation.discardIndex);
  else if (presentation.stage === 'hu') {
    // 终局沿用即时引擎原来的行动座位；未终局时 continueAfterHu 再指定优先赢家。
    // Preserve the immediate engine's ending seat; ongoing play then selects the priority winner.
    next.currentSeat = next.history.at(-1).fromSeat ?? presentation.seat;
    continueAfterHu(next, presentation.seat);
  }
  // 碰已经处于出牌步骤，杠已经处于补摸步骤，无需重复提交。
  // Peng already sits at discard and kong at replacement draw; never commit either twice.
  advanceAutomaticSteps(next, { pausePresentation: true });
  assertGameInvariants(next);
  return next;
}
/* 两个公开入口共用验证与转换，展示选项只沿本次调用显式传递。
 * Share validation and transitions between public entries, passing presentation options only within this call. */
function applyGameAction(game, seat, action, presentationOptions) {
  if (game.schemaVersion !== 3) throw new Error('旧牌局需要使用原版本规则');
  if (
    !action ||
    typeof action !== 'object' ||
    Array.isArray(action) ||
    typeof action.type !== 'string'
  )
    throw new Error('操作格式无效');
  if (Object.keys(action).some((key) => !['type', 'tile'].includes(key)))
    throw new Error('操作包含未知字段');
  /* 动作的 type 和 tile 都必须与服务端计算的合法动作完全一致。
   * Both action type and tile must exactly match a server-computed legal action. */
  const matched = getLegalActions(game, seat).find(
    (legal) => legal.type === action.type && legal.tile === action.tile,
  );
  /* 前端提交内容不是当前合法动作就拒绝，不能绕过回合和规则限制。
   * Reject requests absent from the current allowlist; clients cannot bypass turn or rule restrictions. */
  if (!matched) throw new Error('当前不能执行这项操作，请刷新牌桌');
  /* 全部修改都发生在副本；非法动作不会半途改坏调用方的原状态。
   * All mutations affect the copy; rejected actions leave the caller’s original state untouched. */
  const next = cloneSerializable(game);
  next.revision++;
  if (next.phase === 'claim') {
    next.claim.responses[seat] = cloneSerializable(matched);
    resolveClaimWindow(next, presentationOptions);
  } else if (action.type === 'discard' || action.type === 'pass') {
    discardTile(
      next,
      seat,
      action.type === 'pass' ? next.lastDraw.tile : action.tile,
      false,
      presentationOptions,
    );
  } else if (action.type === 'hu') {
    settleHuBatch(next, [seat], next.lastDraw.tile, 'selfDraw');
    continueAfterHu(next, seat, presentationOptions);
  } else if (['buGang', 'addGang'].includes(action.type))
    offerKongUpgrade(next, seat, action.type, action.tile, presentationOptions);
  else if (action.type === 'anGang')
    declareKong(next, seat, action.type, action.tile, null, presentationOptions);
  advanceAutomaticSteps(next, presentationOptions);
  assertGameInvariants(next);
  return next;
}
/* 按座位与本局快照投影：公开暗杠，隐藏对手手牌、自摸胡牌及待决选择；旧局保持原策略。
 * Project by seat and saved rules: publish kongs, conceal opponents’ hands/self-drawn wins/pending choices, and retain legacy policy. */
export function getPlayerView(game, seat) {
  if (!validSeat(game, seat)) throw new Error('座位无效');
  const me = game.players[seat];
  return {
    schemaVersion: 3,
    ...(game.presentation ? { presentation: { stage: game.presentation.stage } } : {}),
    phase: game.phase,
    turnStep: game.turnStep,
    currentSeat: game.currentSeat,
    dealerSeat: game.dealerSeat ?? 0,
    wallCount: game.wall.length,
    revision: game.revision,
    rules: cloneSerializable(game.rules),
    mySeat: seat,
    sharedRadishes: game.players.flatMap((player) => player.radishes),
    firstHuRadishesRevealed: game.firstHuRadishesRevealed,
    pendingKongRadishes: game.pendingKongRadishes ?? 0,
    dragonSettlement: cloneSerializable(game.dragonSettlement),
    players: game.players.map((player, index) => ({
      seat: index,
      ...(index === seat
        ? {
            hand: [...player.hand],
          }
        : {}),
      handCount: player.hand.length,
      melds: player.melds.map((meld) =>
        meld.type === 'anGang' && index !== seat && game.rules.publicConcealedKongs !== true
          ? {
              type: 'anGang',
              tile: null,
              tiles: Array(meld.tiles.length).fill(null),
              hidden: true,
              ...(meld.extended
                ? {
                    extended: true,
                  }
                : {}),
            }
          : cloneSerializable(meld),
      ),
      // 只隐藏已移入胡牌区的自摸记录，不把当前摸牌误当成胡牌。
      // Hide only settled self-draw win entries, never confuse them with the current draw.
      winPile: player.winPile.map((win) =>
        win.source === 'selfDraw' && hidesPrivateWinDetails(game, index, seat)
          ? { source: win.source, virtual: win.virtual, tile: null, hidden: true }
          : cloneSerializable(win),
      ),
      radishes: [...player.radishes],
      score: player.score,
      huCount: player.huCount,
      kongCount: player.kongCount,
      // handCounts 等扩展分解可能含完整暗手与以前自摸牌，不能只遮当前事件的 tile。
      // Extended breakdowns can include concealed hands and past self-draws; masking only event.tile is insufficient.
      lastScoreBreakdown: hidesPrivateWinDetails(game, index, seat)
        ? visibleScoreSummary(player.lastScoreBreakdown) : cloneSerializable(player.lastScoreBreakdown),
    })),
    discards: cloneSerializable(game.discards),
    // 实体归档是胡牌区的另一引用，同样按拥有者遮牌，但不改实体存档。
    // Retired physical tiles mirror win-pile references; mask by owner without mutating stored tiles.
    retiredTiles: game.retiredTiles.map((record) =>
      hidesPrivateWinDetails(game, record.seat, seat)
        ? { seat: record.seat, tile: null, hidden: true } : cloneSerializable(record),
    ),
    history: game.history.map((event) => visibleHistoryEvent(game, event, seat)),
    claim: game.claim
      ? {
          discardSeat: game.claim.discardSeat,
          tile: game.claim.tile,
          ...(game.claim.kind === 'robKong'
            ? {
                kind: 'robKong',
                kongType: game.claim.kongType,
              }
            : {}),
          eligibleSeats: [...game.claim.eligibleSeats],
          respondedSeats: Object.keys(game.claim.responses).map(Number),
        }
      : null,
    legalActions: getLegalActions(game, seat),
    huDiagnostic: getHuDiagnostic(game, seat),
    scoreBreakdown: cloneSerializable(me.lastScoreBreakdown),
    waitTiles: contextualWaitTiles(game, me, getHandBeforeLastDraw(game, seat)),
    ...(game.rules.specialHuPatterns === true
      ? {
          specialHuPattern: cloneSerializable(me.firstHuPattern ?? null),
        }
      : {}),
    lockedWaits: [...me.lockedWaits],
    huLockActive: me.huLockActive,
    drawnTile: game.lastDraw?.seat === seat ? game.lastDraw.tile : null,
    finishReason: game.finishReason,
  };
}

/** Logical win piles reference existing physical tiles, and are never extra physical copies. */
/* 按本局副数验证实体总数/单牌总数、零和及手牌结构；胡牌逻辑引用不增加实体牌。
 * Validate saved total/copy budgets, zero-sum balances and hand shape; logical wins do not add physical copies. */
export function assertGameInvariants(game) {
  // 只校验已保存字段，不填补缺失字段；损坏的维度不能变成任意人数/牌数。
  // Validate saved fields without backfilling them; corrupted dimensions cannot expand seats or tile budgets.
  for (const [key, validate] of [
    ['playerCount', isPlayerCount], ['deckCount', isDeckCount], ['dragonStartCount', isDragonStartCount],
  ]) {
    if (Object.hasOwn(game.rules, key) && !validate(game.rules[key])) throw new Error('牌桌配置无效');
  }
  if (game.rules.exponentialDragon === true && !isDragonStartCount(game.rules.dragonStartCount))
    throw new Error('神龙起算张数无效');
  // 标记只包含恢复所需的公开索引/座位，且必须与暂停阶段一致。
  // Markers contain only public resume indices/seats and must agree with the paused phase.
  if (game.presentation) {
    const { stage, seat, discardIndex } = game.presentation;
    const isDiscard = stage === 'discard';
    if (
      !['discard', 'hu', 'kong', 'peng'].includes(stage) ||
      Object.keys(game.presentation).some(
        (key) => !['stage', isDiscard ? 'discardIndex' : 'seat'].includes(key),
      ) ||
      game.phase !== 'turn' || game.claim !== null || game.lastDraw !== null ||
      game.turnStep !== (stage === 'peng' ? 'discard' : 'draw') ||
      (isDiscard
        ? !Number.isInteger(discardIndex) || discardIndex !== game.discards.length - 1 ||
          game.discards[discardIndex]?.seat !== game.currentSeat ||
          game.discards[discardIndex]?.claimable || game.discards[discardIndex]?.claimedBy !== undefined
        : !validSeat(game, seat) || seat !== game.currentSeat)
    ) throw new Error('展示续行状态无效');
  }
  if (
    Object.hasOwn(game.rules, 'bigSingleReadyPoints') &&
    !isBigSingleReadyPoints(game.rules.bigSingleReadyPoints)
  )
    throw new Error('大单吊喜钱分值无效');
  if (
    game.dealerSeat !== undefined &&
    (!Number.isInteger(game.dealerSeat) || game.dealerSeat < 0 || game.dealerSeat >= game.players.length)
  )
    throw new Error('庄家座位无效');
  if (
    game.schemaVersion !== 3 ||
    typeof game.firstHuRadishesRevealed !== 'boolean' ||
    typeof game.dragonSettlement?.settled !== 'boolean' ||
    !Array.isArray(game.dragonSettlement.entries)
  )
    throw new Error('牌局版本状态无效');
  if (
    game.pendingKongRadishes !== undefined &&
    (!Number.isSafeInteger(game.pendingKongRadishes) ||
      game.pendingKongRadishes < 0 ||
      game.pendingKongRadishes > game.players.reduce((sum, player) => sum + player.kongCount, 0) ||
      (game.firstHuRadishesRevealed && game.pendingKongRadishes !== 0))
  )
    throw new Error('待翻萝卜状态无效');
  if (
    game.lastDraw &&
    Object.hasOwn(game.lastDraw, 'kongSource') &&
    (game.lastDraw.source !== 'replacement' ||
      !kongSourceFromEvent(
        game,
        {
          ...game.lastDraw.kongSource,
          seat: game.lastDraw.seat,
        },
        game.lastDraw.seat,
      ))
  )
    throw new Error('杠后补摸来源无效');
  if (game.claim?.kind === 'robKong') {
    const claim = game.claim,
      offered = game.discards[claim.discardIndex];
    const player = game.players[claim.discardSeat];
    if (
      game.phase !== 'claim' ||
      !['buGang', 'addGang'].includes(claim.kongType) ||
      !offered?.robKong ||
      offered.tile !== claim.tile ||
      offered.seat !== claim.discardSeat ||
      !offered.claimable ||
      offered.claimedBy !== undefined ||
      game.lastDraw !== null ||
      !player?.melds.some(
        (meld) =>
          meld.tile === claim.tile &&
          (claim.kongType === 'buGang' ? meld.type === 'peng' : canExtendKong(game, meld)),
      ) ||
      !claim.eligibleSeats.length ||
      claim.eligibleSeats.some(
        (seat) =>
          !validSeat(game, seat) ||
          seat === claim.discardSeat ||
          claim.options[seat]?.length !== 1 ||
          claim.options[seat][0].type !== 'hu',
      ) ||
      Object.entries(claim.responses).some(
        ([seat, response]) =>
          !claim.eligibleSeats.includes(Number(seat)) || !['hu', 'pass'].includes(response.type),
      )
    )
      throw new Error('抢杠状态无效');
  }
  const tiles = [
    ...game.wall,
    ...game.retiredTiles.map((item) => item.tile),
    ...game.discards.filter((item) => item.claimedBy === undefined).map((item) => item.tile),
    ...game.players.flatMap((player) => [
      ...player.hand,
      ...tilesInMelds(player),
      ...player.radishes,
    ]),
  ];
  if (
    tiles.length !== TILE_COUNT * copiesPerTile(game.rules) ||
    !tiles.every(isTile) ||
    countTiles(tiles).some((count) => count !== copiesPerTile(game.rules))
  )
    throw new Error('牌张守恒检查失败');
  if (
    game.players.length !== (game.rules.playerCount ?? DEFAULT_PLAYER_COUNT) ||
    game.players.some((player, index) => player.seat !== index) ||
    game.players.reduce((sum, player) => sum + player.score, 0) !== 0
  )
    throw new Error('积分守恒检查失败');
  for (const player of game.players) {
    if (player.pendingPungDiscard !== undefined && typeof player.pendingPungDiscard !== 'boolean')
      throw new Error('碰后待出牌状态无效');
    if (player.bigSingleReadyPaid !== undefined && typeof player.bigSingleReadyPaid !== 'boolean')
      throw new Error('大单吊听牌收分状态无效');
    if (
      !Number.isSafeInteger(player.score) ||
      player.melds.length > 4 ||
      !Number.isSafeInteger(player.huCount) ||
      player.huCount < 0
    )
      throw new Error('玩家状态无效');
    if (player.firstHuPattern != null) {
      /* 牌型快照用于固定特殊胡牌档位；不要用后来累积的胡牌区反推首次牌型。
       * The pattern snapshot preserves a special winning tier; later win-pile growth cannot reconstruct the first shape. */
      const pattern = player.firstHuPattern;
      if (
        !player.huCount ||
        !['standard', 'sevenPairs', 'bigSingle'].includes(pattern.kind) ||
        typeof pattern.pureSuit !== 'boolean' ||
        typeof pattern.allTriplets !== 'boolean' ||
        !Array.isArray(pattern.waitTiles) ||
        !pattern.waitTiles.every(isTile) ||
        !sameTileList(pattern.waitTiles, sortTiles(new Set(pattern.waitTiles))) ||
        (pattern.kind === 'standard'
          ? pattern.waitTiles.length !== 0
          : pattern.waitTiles.length === 0) ||
        (pattern.kind === 'sevenPairs'
          ? !Number.isSafeInteger(pattern.sevenPairsFan) ||
            pattern.sevenPairsFan < 3 ||
            pattern.fixedFan !== pattern.sevenPairsFan + (pattern.pureSuit ? 2 : 0)
          : pattern.fixedFan !== null)
      )
        throw new Error('首胡牌型状态无效');
    }
    for (const meld of player.melds) {
      if (
        !['peng', 'mingGang', 'anGang', 'buGang'].includes(meld.type) ||
        !isTile(meld.tile) ||
        !meld.tiles.every((tile) => tile === meld.tile) ||
        (meld.type === 'peng'
          ? meld.tiles.length !== 3
          : meld.tiles.length < 4 || meld.tiles.length > copiesPerTile(game.rules))
      )
        throw new Error('副露状态无效');
    }
    for (const win of player.winPile) {
      if (
        !isTile(win.tile) ||
        !['selfDraw', 'discard', 'kongDiscard', 'robKong'].includes(win.source) ||
        typeof win.virtual !== 'boolean'
      )
        throw new Error('胡牌堆状态无效');
      if (
        win.source !== 'selfDraw' &&
        (!Number.isInteger(win.discardIndex) || game.discards[win.discardIndex]?.tile !== win.tile)
      )
        throw new Error('胡牌引用无效');
      if (win.source === 'selfDraw' && win.virtual) throw new Error('自摸不能是虚拟牌');
    }
    const base = (4 - player.melds.length) * 3 + 1;
    const extra =
      game.phase === 'turn' && game.turnStep === 'discard' && game.currentSeat === player.seat
        ? 1
        : 0;
    if (player.hand.length !== base + extra) throw new Error(`手牌数量检查失败：${player.seat}`);
  }
  return true;
}
