/**
 * v1 兼容规则 / Compatibility v1 rules
 * 纯状态机：接收局状态与动作，返回新状态；无网络、数据库、界面或定时器。
 * Pure state machine: game state plus action produces new state; no network, database, UI, or timers.
 * 此文件有意保留旧规则差异，禁止为了消除重复而替换成新版引擎。
 * Intentional legacy differences must not be deduplicated into the current engine.
 * 阅读 / Read: docs/ENGINE-READING-GUIDE.md, docs/TERMINOLOGY.md.
 */
/* 牌种有 18 种；每种八张，一共 144 张实体牌。
 * There are 18 identities, eight copies each, for 144 physical tiles. */
/** Pure, dependency-free engine for the documented provisional Zigong variant. */
export const TILE_COUNT = 18;
/* 新局默认值；保存局使用自己的 rules，不受以后默认值改动影响。
 * New-game defaults; saved games keep their own rules when defaults change. */
export const DEFAULT_RULES = Object.freeze({
  // 是否允许七对结构。
  // Enable the seven-pairs shape.
  sevenPairs: true,
  // 旧版基础胡分；旧版没有新版的番数转换。
  // Legacy base hu points, before the later fan conversion model.
  baseHuPoints: 1,
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
  // 保留各版本的神龙叠加配置；当前 v3 终局独立结算，不把字段名当作新公式。
  // Preserve versioned overlap configuration; v3 settles dragons separately at finish.
  stackDragonBonus: true,
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
    'stackDragonBonus',
    'allowChangedWaitDuringLock',
    'preserveWaitsOnPostHuKong',
  ]) {
    if (typeof rules[key] !== 'boolean') throw new Error(`规则 ${key} 必须为布尔值`);
  }
  if (
    !Number.isSafeInteger(rules.baseHuPoints) ||
    rules.baseHuPoints < 0 ||
    rules.baseHuPoints > 100000
  )
    throw new Error('基础分无效');
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
      radishes: [],
      score: 0,
      huCount: 0,
      lockedWaits: [],
      huLockActive: false,
      pendingKongDiscard: false,
    }),
  );
  for (let i = 0; i < 13; i++) for (const player of players) player.hand.push(wall.shift());
  /* 庄家额外获得的第十四张牌，也是初始 lastDraw。
   * The dealer’s extra fourteenth tile also initializes lastDraw. */
  const initialTile = wall.shift();
  players[0].hand.push(initialTile);
  for (const player of players) player.hand.sort((a, b) => a - b);
  const game = {
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
  const complete = fromHand ? player.hand : [...base, tile];
  if (!isWinningHand(complete, player.melds.length, game.rules)) return null;
  const waits = getWaitTiles(base, player.melds, game.rules);
  if (player.huLockActive) {
    if (
      !game.rules.allowChangedWaitDuringLock ||
      waits.some((wait) => player.lockedWaits.includes(wait))
    )
      return null;
  }
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
  if (game.wall.length < 2) return false; // One radish and one replacement must be available.
  if (!player.huCount || !game.rules.preserveWaitsOnPostHuKong) return true;
  const before = getWaitTiles(getHandBeforeLastDraw(game, seat), player.melds, game.rules);
  const hand = [...player.hand];
  const melds = cloneSerializable(player.melds);
  if (type === 'anGang') {
    removeTilesFromHand(hand, tile, 4);
    melds.push({
      type,
      tile,
      tiles: [tile, tile, tile, tile],
    });
  } else if (type === 'buGang') {
    removeTilesFromHand(hand, tile);
    const meld = melds.find((item) => item.type === 'peng' && item.tile === tile);
    if (!meld) return false;
    meld.type = 'buGang';
    meld.tiles.push(tile);
  } else {
    removeTilesFromHand(hand, tile, 3);
    melds.push({
      type,
      tile,
      tiles: [tile, tile, tile, tile],
    });
  }
  const after = getWaitTiles(hand, melds, game.rules);
  return before.length > 0 && sameTileList(before, after);
}
/* 为一个接牌座位计算此弃牌可用的胡、明杠、碰；按当前版本保留来源保护与优先级。
 * Compute this seat’s hu, exposed-kong, and peng options for one discard using this version’s protection and priority. */
function getDiscardClaimOptions(game, seat, discarded) {
  const player = game.players[seat];
  const counts = countTiles(player.hand);
  const actions = [];
  const canDiscardHu = !game.players[discarded.seat].huCount || discarded.afterKong;
  if (canDiscardHu && getAllowedHuWaits(game, seat, discarded.tile, false))
    actions.push({
      type: 'hu',
    });
  if (
    player.melds.length < 4 &&
    counts[discarded.tile] >= 3 &&
    canDeclareKong(game, seat, 'mingGang', discarded.tile)
  )
    actions.push({
      type: 'mingGang',
      tile: discarded.tile,
    });
  if (player.melds.length < 4 && counts[discarded.tile] >= 2)
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
  if (game.phase !== 'turn' || game.currentSeat !== seat) return [];
  if (game.turnStep === 'draw')
    return game.wall.length
      ? [
          {
            type: 'draw',
          },
        ]
      : [];
  const player = game.players[seat];
  const actions = sortTiles(new Set(player.hand)).map((tile) => ({
    type: 'discard',
    tile,
  }));
  if (game.lastDraw?.seat === seat && getAllowedHuWaits(game, seat, game.lastDraw.tile, true))
    actions.push({
      type: 'hu',
    });
  const counts = countTiles(player.hand);
  for (let tile = 0; tile < TILE_COUNT; tile++) {
    if (player.melds.length < 4 && counts[tile] >= 4 && canDeclareKong(game, seat, 'anGang', tile))
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
  }
  return actions;
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
function finishGame(game) {
  game.phase = 'finished';
  game.turnStep = null;
  game.claim = null;
  game.lastDraw = null;
  game.finishReason = 'wallExhausted';
  for (const discarded of game.discards) discarded.claimable = false;
  appendHistoryEvent(game, {
    type: 'finish',
    message: '牌墙已摸完，本局结束，积分已结算。',
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
  /* 牌墙耗尽立即终局，不从空数组取出 undefined 当作牌。
   * An empty wall ends the game; never draw undefined as a tile. */
  if (!game.wall.length) finishGame(game);
}
/* 从牌墙头取一张牌并进入出牌步骤；只记录公开的摸牌事件，不公开摸到的牌种。
 * Take a tile from the wall head and enter the discard step; the public draw event does not reveal its identity. */
function drawTile(game, seat, source = 'normal') {
  /* 牌墙耗尽立即终局，不从空数组取出 undefined 当作牌。
   * An empty wall ends the game; never draw undefined as a tile. */
  if (!game.wall.length) return finishGame(game);
  const player = game.players[seat];
  if (
    source === 'normal' &&
    game.drawKind === 'normal' &&
    game.rules.repeatHuLock === 'untilNaturalDraw'
  )
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
  game.currentSeat = seat;
  appendHistoryEvent(game, {
    type: 'draw',
    seat,
    source,
    message: `${seat + 1}号位${source === 'replacement' ? '杠后补牌' : '摸了一张牌'}。`,
  });
}
/* 只计算本次胡牌分解，不直接转账；各版本的萝卜、神龙和大单吊重叠策略不能混用。
 * Calculate one hu score breakdown without transferring points; keep version-specific radish, dragon, and big-single policies. */
function calculateHuScore(game, seat, winningHand) {
  const player = game.players[seat];
  const owned = [...winningHand, ...tilesInMelds(player)];
  const matchCounts = countTiles(game.rules.radishCountsMelds ? owned : winningHand);
  const radishCounts = countTiles(player.radishes);
  const allCounts = countTiles([
    ...(game.rules.dragonCountsMelds ? owned : winningHand),
    ...player.radishes,
  ]);
  /* 每种牌的“本人匹配张数 × 同种萝卜张数”相加，不能只数是否出现。
   * Sum personal matching copies times matching radish copies; presence alone is insufficient. */
  const radishBonus = matchCounts.reduce((sum, count, tile) => sum + count * radishCounts[tile], 0);
  const dragonBonus = allCounts.reduce(
    (sum, count) => sum + (count >= 6 ? game.rules.dragonPoints[Math.min(8, count)] : 0),
    0,
  );
  const ordinary = game.rules.baseHuPoints + radishBonus;
  const total = game.rules.stackDragonBonus
    ? ordinary + dragonBonus
    : Math.max(ordinary, dragonBonus);
  return {
    base: game.rules.baseHuPoints,
    radishBonus,
    dragonBonus,
    total,
  };
}
/* 按旧版单人胡牌顺序翻萝卜、计算积分、转账并记录听口锁；这是历史规则兼容路径。
 * Apply the legacy single-winner sequence: reveal radishes, score, transfer, and save the wait lock. */
function settleLegacyHu(game, seat, tile, source, fromSeat = null) {
  const player = game.players[seat];
  const selfDraw = source === 'selfDraw';
  const waits = getAllowedHuWaits(game, seat, tile, selfDraw);
  if (!waits) throw new Error('当前不能胡牌');
  /* 只存这次新翻的萝卜，供事件展示；累计萝卜另存于玩家状态。
   * Collect only newly revealed radishes for this event; cumulative radishes live in player state. */
  const newRadishes = [];
  if (player.huCount === 0) {
    for (let i = 0; i < 6 && game.wall.length; i++) newRadishes.push(game.wall.pop());
    player.radishes.push(...newRadishes);
  }
  const winningHand = selfDraw ? [...player.hand] : [...player.hand, tile];
  const score = calculateHuScore(game, seat, winningHand);
  const payerSeats =
    source === 'discard' ? [fromSeat] : [0, 1, 2].filter((other) => other !== seat);
  const payments = payerSeats.map((payer) => ({
    seat: payer,
    delta: -score.total,
  }));
  payments.push({
    seat,
    delta: score.total * payerSeats.length,
  });
  for (const payment of payments) game.players[payment.seat].score += payment.delta;
  player.huCount++;
  player.lockedWaits = waits;
  player.huLockActive = true;
  if (selfDraw) {
    removeTilesFromHand(player.hand, tile);
    game.retiredTiles.push({
      seat,
      tile,
    });
  }
  const sourceLabel =
    source === 'selfDraw' ? '自摸' : source === 'kongDiscard' ? '杠后接炮（按自摸）' : '接炮';
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
    message: `${seat + 1}号位${sourceLabel}${tileLabel(tile)}，每家应付${score.total}分，本次收入${score.total * payerSeats.length}分${newRadishes.length ? `，翻出${newRadishes.length}张萝卜` : ''}。`,
  });
}
/* 真正提交杠：移动实体牌、处理本版本杠分和萝卜、记录事件，再进入补摸流程。
 * Commit a kong: move physical tiles, apply this version’s payments and radishes, log, and enter replacement draw. */
function declareKong(game, seat, type, tile, fromSeat = null) {
  const player = game.players[seat];
  if (type === 'buGang') {
    removeTilesFromHand(player.hand, tile);
    const meld = player.melds.find((item) => item.type === 'peng' && item.tile === tile);
    meld.type = 'buGang';
    meld.tiles.push(tile);
  } else {
    removeTilesFromHand(player.hand, tile, type === 'mingGang' ? 3 : 4);
    player.melds.push({
      type,
      tile,
      tiles: [tile, tile, tile, tile],
      ...(fromSeat === null
        ? {}
        : {
            fromSeat,
          }),
    });
  }
  const radish = game.wall.pop();
  player.radishes.push(radish);
  player.pendingKongDiscard = true;
  game.claim = null;
  game.lastDraw = null;
  appendHistoryEvent(game, {
    type,
    seat,
    ...(type === 'anGang'
      ? {}
      : {
          tile,
        }),
    radish,
    message: `${seat + 1}号位${
      {
        anGang: '暗杠',
        buGang: '补杠',
        mingGang: '明杠',
      }[type]
    }，翻出萝卜${tileLabel(radish)}。`,
  });
  drawTile(game, seat, 'replacement');
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
    for (const seat of winners)
      settleLegacyHu(
        game,
        seat,
        discarded.tile,
        discarded.afterKong ? 'kongDiscard' : 'discard',
        discarded.seat,
      );
    discarded.huSeats = winners;
    beginDrawStep(game, winners[0], 'continuation');
    return;
  }
  const caller = order.find((seat) => ['peng', 'mingGang'].includes(claim.responses[seat]?.type));
  if (caller === undefined) {
    beginDrawStep(game, (discarded.seat + 1) % 3);
    return;
  }
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
/* 校验动作属于当前白名单后复制整局，在副本提交动作并检查守恒；成功才返回新状态。
 * Validate the action against the current allowlist, apply it to a copy, check invariants, and return only a valid new state. */
export function applyAction(game, seat, action) {
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
    // Do not reveal a pending choice until every eligible player has responded.
    resolveClaimWindow(next);
  } else if (action.type === 'draw') drawTile(next, seat);
  else if (action.type === 'discard') {
    const player = next.players[seat];
    removeTilesFromHand(player.hand, action.tile);
    const discarded = {
      seat,
      tile: action.tile,
      claimable: false,
      afterKong: player.pendingKongDiscard,
    };
    player.pendingKongDiscard = false;
    next.discards.push(discarded);
    next.lastDraw = null;
    appendHistoryEvent(next, {
      type: 'discard',
      seat,
      tile: action.tile,
      afterKong: discarded.afterKong,
      message: `${seat + 1}号位打出${tileLabel(action.tile)}${discarded.afterKong ? '（杠后出牌，可按自摸接胡）' : ''}。`,
    });
    const options = {};
    for (const other of [0, 1, 2].filter((other) => other !== seat)) {
      const available = getDiscardClaimOptions(next, other, discarded);
      if (available.length) options[other] = available;
    }
    /* 按本局顺位保留有至少一项接牌动作的座位，响应窗口只等待这些人。
     * Keep eligible seats in saved turn order; the claim window waits only for them. */
    const eligibleSeats = Object.keys(options).map(Number);
    if (eligibleSeats.length) {
      discarded.claimable = true;
      next.phase = 'claim';
      next.turnStep = null;
      next.claim = {
        discardIndex: next.discards.length - 1,
        discardSeat: seat,
        tile: action.tile,
        eligibleSeats,
        options,
        responses: {},
      };
    } else beginDrawStep(next, (seat + 1) % 3);
  } else if (action.type === 'hu') {
    settleLegacyHu(next, seat, next.lastDraw.tile, 'selfDraw');
    beginDrawStep(next, seat, 'continuation');
  } else if (action.type === 'anGang' || action.type === 'buGang')
    declareKong(next, seat, action.type, action.tile);
  assertGameInvariants(next);
  return next;
}
/* 按请求座位裁剪私有状态：本人手牌可见，对手暗杠/手牌和待决选择不可泄露。
 * Project state for the requesting seat: reveal its hand but conceal opponents’ hands, hidden kongs, and pending choices. */
export function getPlayerView(game, seat) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 2) throw new Error('座位无效');
  const me = game.players[seat];
  const view = {
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
              tiles: [null, null, null, null],
              hidden: true,
            }
          : cloneSerializable(meld),
      ),
      radishes: [...player.radishes],
      score: player.score,
      huCount: player.huCount,
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
    waitTiles: getWaitTiles(getHandBeforeLastDraw(game, seat), me.melds, game.rules),
    lockedWaits: [...me.lockedWaits],
    huLockActive: me.huLockActive,
    drawnTile: game.lastDraw?.seat === seat ? game.lastDraw.tile : null,
    finishReason: game.finishReason,
  };
  return view;
}

/** Counts physical tiles, excluding a claimed discard's historical duplicate. */
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
    if (!Number.isSafeInteger(player.score) || player.melds.length > 4)
      throw new Error('玩家状态无效');
    const base = (4 - player.melds.length) * 3 + 1;
    const extra =
      game.phase === 'turn' && game.turnStep === 'discard' && game.currentSeat === player.seat
        ? 1
        : 0;
    // A wall-ending hu has already returned the winner to a waiting hand.
    // A final unclaimed discard also leaves all hands at their waiting size.
    if (player.hand.length !== base + extra) throw new Error(`手牌数量检查失败：${player.seat}`);
  }
  return true;
}
