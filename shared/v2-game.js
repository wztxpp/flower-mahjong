/**
 * v2 兼容规则 / Compatibility v2 rules
 * 纯状态机：接收局状态与动作，返回新状态；无网络、数据库、界面或定时器。
 * Pure state machine: game state plus action produces new state; no network, database, UI, or timers.
 * 此文件有意保留旧规则差异，禁止为了消除重复而替换成新版引擎。
 * Intentional legacy differences must not be deduplicated into the current engine.
 * 阅读 / Read: docs/ENGINE-READING-GUIDE.md, docs/TERMINOLOGY.md.
 */
/* 牌种有 18 种；每种八张，一共 144 张实体牌。
 * There are 18 identities, eight copies each, for 144 physical tiles. */
/** Pure schema-v2 engine. Scores are virtual; provisional overlaps are explicit rules. */
export const TILE_COUNT = 18;
/* 新局默认值；保存局使用自己的 rules，不受以后默认值改动影响。
 * New-game defaults; saved games keep their own rules when defaults change. */
export const DEFAULT_RULES = Object.freeze({
  // 是否允许七对结构。
  // Enable the seven-pairs shape.
  sevenPairs: true,
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
  // 萝卜匹配是否计入本人碰杠牌。
  // Include personal meld tiles when matching radishes.
  radishCountsMelds: true,
  // 神龙张数是否计入本人碰杠牌。
  // Include personal meld tiles when counting dragons.
  dragonCountsMelds: true,
  // 萝卜匹配是否计入历史逻辑胡牌区；各版本默认不同。
  // Include logical win-pile tiles in radish matching; defaults differ by version.
  radishCountsWinPile: false,
  // 神龙是否计入逻辑胡牌区；引用不增加实体守恒张数。
  // Include logical win-pile tiles in dragon counts without creating physical copies.
  dragonCountsWinPile: false,
  // 保留各版本的神龙叠加配置；当前 v3 终局独立结算，不把字段名当作新公式。
  // Preserve versioned overlap configuration; v3 settles dragons separately at finish.
  stackDragonBonus: true,
  // 萝卜计分范围：旧版可为 own，本版取值以此快照为准。
  // Radish scoring scope: older rules may use own; follow this saved snapshot.
  radishScope: 'own',
  // v2 对六张及以上逻辑同牌的暂定加番配置。
  // Provisional v2 bonus for at least six logical copies.
  sixPlusCopyFan: 0,
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
  for (const key of [
    'sevenPairs',
    'multipleWinners',
    'radishCountsMelds',
    'dragonCountsMelds',
    'radishCountsWinPile',
    'dragonCountsWinPile',
    'stackDragonBonus',
    'allowChangedWaitDuringLock',
    'preserveWaitsOnPostHuKong',
  ]) {
    if (typeof rules[key] !== 'boolean') throw new Error(`规则 ${key} 必须为布尔值`);
  }
  for (const key of ['baseFan', 'sixPlusCopyFan']) {
    if (
      !Number.isSafeInteger(rules[key]) ||
      rules[key] < (key === 'baseFan' ? 1 : 0) ||
      rules[key] > 1000
    )
      throw new Error('番数规则无效');
  }
  if (!['own', 'all'].includes(rules.radishScope)) throw new Error('萝卜归属规则无效');
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
/* 创建全新的独立牌局：校验规则、洗 144 张牌、发牌、建立初始状态并检查守恒。
 * Create a new independent game: validate rules, shuffle 144 tiles, deal, initialize state, and check invariants. */
export function createGame({ seed, rules: inputRules } = {}) {
  const rules = normalizeNewGameRules(inputRules);
  /* 牌墙是有顺序的实体牌列表；头部摸牌，尾部翻萝卜。
   * The wall is an ordered physical tile list: draw at the head and reveal radishes from the tail. */
  const wall = Array.from(
    {
      length: 144,
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
      length: 3,
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
      lockedWaits: [],
      huLockActive: false,
      pendingKongDiscard: false,
      lastScoreBreakdown: null,
    }),
  );
  for (let i = 0; i < 13; i++) for (const player of players) player.hand.push(wall.shift());
  /* 庄家额外获得的第十四张牌，也是初始 lastDraw。
   * The dealer’s extra fourteenth tile also initializes lastDraw. */
  const initialTile = wall.shift();
  players[0].hand.push(initialTile);
  for (const player of players) player.hand.sort((a, b) => a - b);
  const game = {
    schemaVersion: 2,
    phase: 'turn',
    turnStep: 'discard',
    currentSeat: 0,
    wall,
    players,
    discards: [],
    retiredTiles: [],
    history: [],
    revision: 0,
    rules,
    claim: null,
    drawKind: 'normal',
    lastDraw: {
      seat: 0,
      tile: initialTile,
      source: 'initial',
    },
    finishReason: null,
  };
  appendHistoryEvent(game, {
    type: 'start',
    message: '三位牌友已就位，东家先出牌。',
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
  if (counts.some((count) => count > 8)) return false;
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
  ).filter((tile) => owned[tile] < 8 && isWinningHand([...hand, tile], melds.length, rules));
}
/* 取候选胡牌前的待牌手牌，再按本版本规则验证能否胡；不能胡返回 null，能胡返回听口。
 * Build the waiting hand before the candidate win and validate this version’s hu rules; return null or its wait list. */
function getAllowedHuWaits(game, seat, tile, fromHand) {
  const player = game.players[seat];
  const base = [...player.hand];
  if (fromHand) removeTilesFromHand(base, tile);
  if (!isWinningHand(fromHand ? player.hand : [...base, tile], player.melds.length, game.rules))
    return null;
  const waits = getWaitTiles(base, player.melds, game.rules);
  if (
    player.huLockActive &&
    (!game.rules.allowChangedWaitDuringLock ||
      waits.some((wait) => player.lockedWaits.includes(wait)))
  )
    return null;
  return waits;
}
/* 复制手牌并扣除当前最后摸到的牌，恢复计算听口需要的待牌张数。
 * Copy the hand and remove its current last draw to recover the waiting-hand size used by wait calculations. */
function getHandBeforeLastDraw(game, seat) {
  const hand = [...game.players[seat].hand];
  if (game.lastDraw?.seat === seat) removeTilesFromHand(hand, game.lastDraw.tile);
  return hand;
}
/* 试算杠后的手牌和副露；胡后若要求保留听口，前后听口必须完全一致。试算不改原局。
 * Simulate the hand and melds after a kong; post-hu waits must remain identical when required. Do not mutate the game. */
function canDeclareKong(game, seat, type, tile) {
  const player = game.players[seat];
  /* 保留补摸与萝卜所需的牌墙余量；不能宣告无法完成后续步骤的杠。
   * Require enough wall capacity for replacement/radish steps before declaring a kong. */
  if (game.wall.length < 2) return false;
  if (!player.huCount || !game.rules.preserveWaitsOnPostHuKong) return true;
  const before = getWaitTiles(getHandBeforeLastDraw(game, seat), player.melds, game.rules);
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
        item.tile === tile &&
        (type === 'buGang'
          ? item.type === 'peng'
          : item.type !== 'peng' && item.tiles.length === 4),
    );
    if (!meld) return false;
    meld.tiles.push(tile);
    if (type === 'buGang') meld.type = 'buGang';
  }
  return before.length > 0 && sameTileList(before, getWaitTiles(hand, melds, game.rules));
}
/* 为一个接牌座位计算此弃牌可用的胡、明杠、碰；按当前版本保留来源保护与优先级。
 * Compute this seat’s hu, exposed-kong, and peng options for one discard using this version’s protection and priority. */
function getDiscardClaimOptions(game, seat, discarded) {
  const player = game.players[seat];
  const counts = countTiles(player.hand);
  const canDiscardHu = !game.players[discarded.seat].huCount || discarded.afterKong;
  // When both are possible the decision is hu or pass, never hu versus kong.
  if (canDiscardHu && getAllowedHuWaits(game, seat, discarded.tile, false))
    return [
      {
        type: 'hu',
      },
    ];
  const actions = [];
  if (
    player.melds.length < 4 &&
    counts[discarded.tile] >= 3 &&
    canDeclareKong(game, seat, 'mingGang', discarded.tile)
  )
    actions.push({
      type: 'mingGang',
      tile: discarded.tile,
    });
  if (
    !player.huCount &&
    !game.players[discarded.seat].huCount &&
    player.melds.length < 4 &&
    counts[discarded.tile] >= 2
  )
    actions.push({
      type: 'peng',
      tile: discarded.tile,
    });
  return actions;
}
/* 服务端权威动作白名单；按阶段、轮次和座位返回具体动作，不信任前端按钮。
 * Return the authoritative action allowlist by phase, turn, and seat; frontend buttons are not trusted validation. */
export function getLegalActions(game, seat) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 2 || game.phase === 'finished') return [];
  if (game.phase === 'claim') {
    if (!game.claim?.eligibleSeats.includes(seat) || game.claim.responses[seat]) return [];
    return [
      ...cloneSerializable(game.claim.options[seat]),
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
  if (drawn !== null && getAllowedHuWaits(game, seat, drawn, true)) {
    actions.push({
      type: 'hu',
    });
  } else {
    const counts = countTiles(player.hand);
    for (let tile = 0; tile < TILE_COUNT; tile++) {
      if (
        player.melds.length < 4 &&
        counts[tile] >= 4 &&
        canDeclareKong(game, seat, 'anGang', tile)
      )
        actions.push({
          type: 'anGang',
          tile,
        });
      if (
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
        player.melds.some(
          (meld) => meld.type !== 'peng' && meld.tile === tile && meld.tiles.length === 4,
        ) &&
        canDeclareKong(game, seat, 'addGang', tile)
      )
        actions.push({
          type: 'addGang',
          tile,
        });
    }
  }
  if (
    player.huCount &&
    actions.some((action) => action.type === 'hu' || action.type.endsWith('Gang'))
  )
    actions.push({
      type: 'pass',
    });
  return actions;
}

/** Private, actionable explanation; reads no other player's concealed tiles. */
/* 只用本人和公开信息解释当前不能胡的原因；返回机器码、中文提示和可公开的补充信息。
 * Explain hu availability using only this player’s and public information; return a code, message, and permitted details. */
export function getHuDiagnostic(game, seat) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 2) throw new Error('座位无效');
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
      game.finishReason === 'allPlayersHu' ? '三家都已胡牌，本局结束。' : '牌墙已用完，本局结束。',
    );
  const player = game.players[seat];
  let tile;
  let fromHand;
  if (game.phase === 'claim') {
    if (game.claim.discardSeat === seat)
      return reply('WRONG_TURN', '这是你打出的牌，请等待另外两家回应。');
    if (game.claim.responses[seat])
      return reply('ALREADY_RESPONDED', '你已回应，正在等其他有资格的玩家操作。');
    tile = game.claim.tile;
    fromHand = false;
    const discarded = game.discards[game.claim.discardIndex];
    if (game.players[discarded.seat].huCount && !discarded.afterKong)
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
  const waitTiles = getWaitTiles(base, player.melds, game.rules);
  const extra = {
    tile,
    waitTiles,
  };
  if (
    !isWinningHand(fromHand ? player.hand : [...player.hand, tile], player.melds.length, game.rules)
  ) {
    return reply(
      'SHAPE',
      waitTiles.length
        ? `这张${tileLabel(tile)}不在你的听口；可胡${waitTiles.map(tileLabel).join('、')}。`
        : '当前牌形还未凑成四组加一对（或已启用的七对），暂时不能胡。',
      extra,
    );
  }
  if (!getAllowedHuWaits(game, seat, tile, fromHand)) {
    const message =
      game.rules.repeatHuLock === 'untilNaturalDraw'
        ? '本次仍命中锁定听口，要等下一次正常轮到你摸牌才可再胡；胡后补摸和杠后补牌不会解锁。'
        : game.rules.allowChangedWaitDuringLock
          ? '本次仍命中锁定听口；按本局设置，需要完全更换原听口后才能再次胡牌。'
          : '本局设置会持续锁定重复胡牌；当前不能再次胡牌。';
    return reply('WAIT_LOCK', message, extra);
  }
  if (game.phase === 'claim' && !game.claim.eligibleSeats.includes(seat))
    return reply('NOT_ELIGIBLE', '本次弃牌没有你的可用接牌操作，请等待下一次机会。', extra);
  return reply(
    'AVAILABLE',
    fromHand ? '这张牌可以自摸胡牌。' : '这张弃牌可以接胡；所有有资格的玩家回应后一起结算。',
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
  game.phase = 'finished';
  game.turnStep = null;
  game.claim = null;
  game.lastDraw = null;
  game.finishReason = reason;
  for (const discarded of game.discards) discarded.claimable = false;
  appendHistoryEvent(game, {
    type: 'finish',
    reason,
    message:
      reason === 'allPlayersHu'
        ? '三家都已胡牌，本局结束，积分已结算。'
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
  game.lastDraw = {
    seat,
    tile,
    source,
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
function calculateHuScore(game, seat, bigSingle) {
  const player = game.players[seat];
  // The winning tile is now in winPile, not in hand. River references never join these counts.
  /* 本人手牌与逻辑胡牌区一起参与相应计分，不把弃牌河再计一遍。
   * Combine the hand and logical win pile for applicable scoring without recounting the discard river. */
  const handAndWins = [...player.hand, ...player.winPile.map((item) => item.tile)];
  const owned = [...handAndWins, ...tilesInMelds(player)];
  const copyFanBonus = countTiles(owned).reduce(
    (sum, count) =>
      sum + (count === 4 ? 1 : count === 5 ? 2 : count >= 6 ? game.rules.sixPlusCopyFan : 0),
    0,
  );
  const fan = game.rules.baseFan + copyFanBonus;
  const fanPoints = fanToPoints(fan);
  const scoringRadishes =
    game.rules.radishScope === 'all'
      ? game.players.flatMap((other) => other.radishes)
      : player.radishes;
  const currentWin = player.winPile.at(-1).tile;
  const currentWinningHand = [...player.hand, currentWin];
  /* 按本局规则选择能与萝卜匹配的牌区，不含对手私有牌。
   * Choose enabled personal scoring zones for radish matching, never opponents’ concealed tiles. */
  const radishOwned = [
    ...(game.rules.radishCountsWinPile ? handAndWins : currentWinningHand),
    ...(game.rules.radishCountsMelds ? tilesInMelds(player) : []),
  ];
  const dragonOwned = [
    ...(game.rules.dragonCountsWinPile ? handAndWins : currentWinningHand),
    ...(game.rules.dragonCountsMelds ? tilesInMelds(player) : []),
  ];
  const matchCounts = countTiles(radishOwned);
  const radishCounts = countTiles(scoringRadishes);
  const allCounts = countTiles([...dragonOwned, ...scoringRadishes]);
  /* 每种牌的“本人匹配张数 × 同种萝卜张数”相加，不能只数是否出现。
   * Sum personal matching copies times matching radish copies; presence alone is insufficient. */
  const radishBonus = matchCounts.reduce((sum, count, tile) => sum + count * radishCounts[tile], 0);
  // Retain the earlier dragon rule separately, including its 8+ cap. It does not add fan.
  const dragonBonus = allCounts.reduce(
    (sum, count) => sum + (count >= 6 ? game.rules.dragonPoints[Math.min(8, count)] : 0),
    0,
  );
  const ordinary = fanPoints + radishBonus;
  const combined = game.rules.stackDragonBonus
    ? ordinary + dragonBonus
    : Math.max(ordinary, dragonBonus);
  const bigSinglePoints = bigSingle ? 50 : 0;
  const total = bigSingle
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
    overlapPolicy: game.rules.bigSingleOverlap,
    total,
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

/** Prepare every simultaneous winner before scoring or deciding that the hand is over. */
/* 先为所有同时胡牌者更新牌区，再统一算分和付款；避免一炮多响被首个赢家提前结束。
 * Prepare tile zones for every simultaneous winner before scoring and payment so the first winner cannot end the batch early. */
function settleHuBatch(game, winners, tile, source, fromSeat = null, discardIndex = null) {
  const selfDraw = source === 'selfDraw';
  /* 先为所有赢家准备牌区与牌型，再进入下面的算分循环。
   * Prepare zones and patterns for every winner before entering the scoring loop below. */
  const prepared = winners.map((seat, index) => {
    const player = game.players[seat];
    const waits = getAllowedHuWaits(game, seat, tile, selfDraw);
    if (!waits) throw new Error('当前不能胡牌');
    const bigSingle = player.hand.length - (selfDraw ? 1 : 0) === 1;
    /* 只存这次新翻的萝卜，供事件展示；累计萝卜另存于玩家状态。
     * Collect only newly revealed radishes for this event; cumulative radishes live in player state. */
    const newRadishes = [];
    if (player.huCount === 0) {
      for (let i = 0; i < 6 && game.wall.length; i++) newRadishes.push(game.wall.pop());
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
    player.lockedWaits = waits;
    player.huLockActive = true;
    return {
      seat,
      newRadishes,
      bigSingle,
    };
  });
  for (const { seat, newRadishes, bigSingle } of prepared) {
    const score = calculateHuScore(game, seat, bigSingle);
    const payerSeats =
      source === 'discard' && !bigSingle ? [fromSeat] : [0, 1, 2].filter((other) => other !== seat);
    const payments = transferPoints(game, seat, payerSeats, score.total);
    game.players[seat].lastScoreBreakdown = cloneSerializable(score);
    const sourceLabel = bigSingle
      ? '大单钓'
      : selfDraw
        ? '自摸'
        : source === 'kongDiscard'
          ? '杠后接炮（按自摸）'
          : '接炮';
    appendHistoryEvent(game, {
      type: 'hu',
      seat,
      tile,
      source,
      fromSeat,
      points: score.total,
      score,
      payments,
      newRadishes,
      message: `${seat + 1}号位${sourceLabel}${tileLabel(tile)}，${payerSeats.length === 1 ? '出牌方' : '另外两家各'}付${score.total}分，本次收入${score.total * payerSeats.length}分${newRadishes.length ? `，翻出${newRadishes.length}张萝卜` : ''}。`,
    });
  }
}
/* 完成本轮胡牌结算后决定终局或胡后补摸；不把胡牌等同于个人离席。
 * After settling hu, decide between game end and continuation draw; hu does not mean leaving a seat. */
function continueAfterHu(game, seat) {
  if (game.players.every((player) => player.huCount > 0)) finishGame(game, 'allPlayersHu');
  else beginDrawStep(game, seat, 'continuation');
}
/* 真正提交杠：移动实体牌、处理本版本杠分和萝卜、记录事件，再进入补摸流程。
 * Commit a kong: move physical tiles, apply this version’s payments and radishes, log, and enter replacement draw. */
function declareKong(game, seat, type, tile, fromSeat = null) {
  const player = game.players[seat];
  let concealed = type === 'anGang';
  if (type === 'buGang' || type === 'addGang') {
    removeTilesFromHand(player.hand, tile);
    const meld = player.melds.find(
      (item) =>
        item.tile === tile &&
        (type === 'buGang'
          ? item.type === 'peng'
          : item.type !== 'peng' && item.tiles.length === 4),
    );
    concealed = meld.type === 'anGang';
    if (type === 'buGang') meld.type = 'buGang';
    meld.tiles.push(tile);
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
  const amount = type === 'anGang' || type === 'mingGang' ? 2 : 1;
  const payerSeats = type === 'mingGang' ? [fromSeat] : [0, 1, 2].filter((other) => other !== seat);
  const payments = transferPoints(game, seat, payerSeats, amount);
  const radish = game.wall.pop();
  player.radishes.push(radish);
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
    radish,
    points: amount,
    payments,
    message: `${seat + 1}号位${
      {
        anGang: '暗杠',
        buGang: '补杠',
        mingGang: '明杠',
        addGang: '加杠至五张',
      }[type]
    }，${payerSeats.length === 1 ? '出牌方' : '另外两家各'}付${amount}分，翻出萝卜${tileLabel(radish)}。`,
  });
  beginDrawStep(game, seat, 'replacement');
}
/* 等待所有有资格座位回应后，一次性按本版本优先级处理；不按网络先到先得。
 * Wait for all eligible responses, then resolve together using version-specific priority, never network arrival order. */
function resolveClaimWindow(game) {
  const claim = game.claim;
  /* 必须等到所有有资格玩家都明确回应，防止先点击的人抢走更高优先级。
   * Wait for every eligible response so arrival order cannot defeat a higher-priority action. */
  if (!claim.eligibleSeats.every((seat) => claim.responses[seat])) return;
  const discarded = game.discards[claim.discardIndex];
  discarded.claimable = false;
  const order = [1, 2].map((offset) => (discarded.seat + offset) % 3);
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
      discarded.afterKong ? 'kongDiscard' : 'discard',
      discarded.seat,
      claim.discardIndex,
    );
    continueAfterHu(game, winners[0]);
    return;
  }
  // Wait for everyone first; kong outranks peng, equal claims use clockwise proximity.
  const caller =
    order.find((seat) => claim.responses[seat]?.type === 'mingGang') ??
    order.find((seat) => claim.responses[seat]?.type === 'peng');
  if (caller === undefined) return beginDrawStep(game, (discarded.seat + 1) % 3);
  const type = claim.responses[caller].type;
  discarded.claimedBy = caller;
  discarded.claimedAs = type;
  if (type === 'mingGang') declareKong(game, caller, type, discarded.tile, discarded.seat);
  else {
    const player = game.players[caller];
    removeTilesFromHand(player.hand, discarded.tile, 2);
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
  }
}
/* 提交一张弃牌、清除摸牌上下文，再建立接牌窗口；无人能接时进入下家摸牌步骤。
 * Commit a discard, clear draw context, then open a claim window or advance to the next draw if nobody can claim. */
function discardTile(game, seat, tile, automatic = false) {
  const player = game.players[seat];
  removeTilesFromHand(player.hand, tile);
  const discarded = {
    seat,
    tile,
    claimable: false,
    afterKong: player.pendingKongDiscard,
  };
  player.pendingKongDiscard = false;
  game.discards.push(discarded);
  game.lastDraw = null;
  appendHistoryEvent(game, {
    type: 'discard',
    seat,
    tile,
    automatic,
    afterKong: discarded.afterKong,
    message: `${seat + 1}号位${automatic ? '摸后自动打出' : '打出'}${tileLabel(tile)}${discarded.afterKong ? '（杠后出牌，可按自摸接胡）' : ''}。`,
  });
  const options = {};
  for (const other of [0, 1, 2].filter((other) => other !== seat)) {
    const available = getDiscardClaimOptions(game, other, discarded);
    if (available.length) options[other] = available;
  }
  /* 按本局顺位保留有至少一项接牌动作的座位，响应窗口只等待这些人。
   * Keep eligible seats in saved turn order; the claim window waits only for them. */
  const eligibleSeats = Object.keys(options).map(Number);
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
  } else beginDrawStep(game, (seat + 1) % 3);
}

/** No timing race or user draw action: stop only at a real player decision. */
/* 自动执行无需用户选择的摸牌/胡后摸打，遇到真实决策点立即停止；上限用于发现死循环。
 * Advance automatic draws and post-hu discards until a real decision is needed; the bound detects loops. */
function advanceAutomaticSteps(game) {
  // Each two automatic transitions consume at least one of the 144 physical tiles.
  for (let transitions = 0; transitions < 300; transitions++) {
    /* 接牌阶段或终局需要等待/停止，自动轮转不能跨过这些边界。
     * Claims and finished games stop automatic advancement at their phase boundaries. */
    if (game.phase !== 'turn') return;
    if (game.turnStep === 'draw') {
      drawTile(game);
      continue;
    }
    const seat = game.currentSeat;
    const player = game.players[seat];
    if (!player.huCount) return;
    if (
      getLegalActions(game, seat).some(
        (action) => action.type === 'hu' || action.type.endsWith('Gang'),
      )
    )
      return;
    if (game.lastDraw?.seat !== seat) throw new Error('胡后缺少摸牌记录');
    discardTile(game, seat, game.lastDraw.tile, true);
  }
  throw new Error('自动轮转超出牌墙上限');
}
/* 校验动作属于当前白名单后复制整局，在副本提交动作并检查守恒；成功才返回新状态。
 * Validate the action against the current allowlist, apply it to a copy, check invariants, and return only a valid new state. */
export function applyAction(game, seat, action) {
  if (game.schemaVersion !== 2) throw new Error('旧牌局需要使用原版本规则');
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
    resolveClaimWindow(next);
  } else if (action.type === 'discard' || action.type === 'pass') {
    discardTile(next, seat, action.type === 'pass' ? next.lastDraw.tile : action.tile);
  } else if (action.type === 'hu') {
    settleHuBatch(next, [seat], next.lastDraw.tile, 'selfDraw');
    continueAfterHu(next, seat);
  } else if (['anGang', 'buGang', 'addGang'].includes(action.type))
    declareKong(next, seat, action.type, action.tile);
  advanceAutomaticSteps(next);
  assertGameInvariants(next);
  return next;
}
/* 按请求座位裁剪私有状态：本人手牌可见，对手暗杠/手牌和待决选择不可泄露。
 * Project state for the requesting seat: reveal its hand but conceal opponents’ hands, hidden kongs, and pending choices. */
export function getPlayerView(game, seat) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 2) throw new Error('座位无效');
  const me = game.players[seat];
  return {
    schemaVersion: 2,
    phase: game.phase,
    turnStep: game.turnStep,
    currentSeat: game.currentSeat,
    wallCount: game.wall.length,
    revision: game.revision,
    rules: cloneSerializable(game.rules),
    mySeat: seat,
    players: game.players.map((player, index) => ({
      seat: index,
      ...(index === seat
        ? {
            hand: [...player.hand],
          }
        : {}),
      handCount: player.hand.length,
      melds: player.melds.map((meld) =>
        meld.type === 'anGang' && index !== seat
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
      winPile: cloneSerializable(player.winPile),
      radishes: [...player.radishes],
      score: player.score,
      huCount: player.huCount,
      kongCount: player.kongCount,
      lastScoreBreakdown: cloneSerializable(player.lastScoreBreakdown),
    })),
    discards: cloneSerializable(game.discards),
    retiredTiles: cloneSerializable(game.retiredTiles),
    history: cloneSerializable(game.history),
    claim: game.claim
      ? {
          discardSeat: game.claim.discardSeat,
          tile: game.claim.tile,
          eligibleSeats: [...game.claim.eligibleSeats],
          respondedSeats: Object.keys(game.claim.responses).map(Number),
        }
      : null,
    legalActions: getLegalActions(game, seat),
    huDiagnostic: getHuDiagnostic(game, seat),
    scoreBreakdown: cloneSerializable(me.lastScoreBreakdown),
    waitTiles: getWaitTiles(getHandBeforeLastDraw(game, seat), me.melds, game.rules),
    lockedWaits: [...me.lockedWaits],
    huLockActive: me.huLockActive,
    drawnTile: game.lastDraw?.seat === seat ? game.lastDraw.tile : null,
    finishReason: game.finishReason,
  };
}

/** Logical win piles reference existing physical tiles, and are never extra physical copies. */
/* 验证实体牌总数、每种八张、积分零和和阶段手牌数量；逻辑胡牌引用不能当成新实体牌。
 * Check physical tile counts, eight copies per identity, zero-sum scores, and phase-dependent hand sizes; logical wins are references. */
export function assertGameInvariants(game) {
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
    tiles.length !== 144 ||
    !tiles.every(isTile) ||
    countTiles(tiles).some((count) => count !== 8)
  )
    throw new Error('牌张守恒检查失败');
  if (
    game.players.length !== 3 ||
    game.players.reduce((sum, player) => sum + player.score, 0) !== 0
  )
    throw new Error('积分守恒检查失败');
  for (const player of game.players) {
    if (
      !Number.isSafeInteger(player.score) ||
      player.melds.length > 4 ||
      !Number.isSafeInteger(player.huCount) ||
      player.huCount < 0
    )
      throw new Error('玩家状态无效');
    for (const meld of player.melds) {
      if (
        !['peng', 'mingGang', 'anGang', 'buGang'].includes(meld.type) ||
        !isTile(meld.tile) ||
        !meld.tiles.every((tile) => tile === meld.tile) ||
        (meld.type === 'peng' ? meld.tiles.length !== 3 : ![4, 5].includes(meld.tiles.length))
      )
        throw new Error('副露状态无效');
    }
    for (const win of player.winPile) {
      if (
        !isTile(win.tile) ||
        !['selfDraw', 'discard', 'kongDiscard'].includes(win.source) ||
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
