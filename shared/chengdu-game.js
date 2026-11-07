/**
 * 成都独立准备层：同一发牌/交换算法用于原型schema 1和正式schema 2，版本合同分开验证。
 * Independent preparation: shared dealing/exchange mechanics for draft schema one and production schema two, with separate version contracts.
 * 旧createGame/settleGame仍阻断；正式调用chengdu-engine.js，最后一次定缺由回合层接管。
 * Legacy createGame/settleGame remain blocked; production uses chengdu-engine.js and the runtime takes over final dingque.
 * 不复用花麻将牌型、计分或续摸；身份、座位凭证、CAS、离席与重连仍由原房间生命周期管理。
 * Never reuse Flower shapes/scoring/continuation; identity, capabilities, CAS, departure and reconnect belong to existing rooms.
 */
import { CHENGDU_TILE_SET, isTileInSet } from './tile-sets.js';
import { CHENGDU_SUITS } from './chengdu-hand.js';
import { validateChengduOptions } from './chengdu-options.js';
import { assertChengduStateIdentity, chengduStateHeader, chengduProductionPolicy,
  chengduProductionVisibility, CHENGDU_SCHEMA_VERSION, CHENGDU_RULES_VERSION } from './chengdu-production-contract.js';
import {
  validateChengduScoringOptions, chengduExchangeRecipient,
  CHENGDU_EXCHANGE_CYCLE, CHENGDU_RULE_GAPS, requireChengduRules,
} from './chengdu-contract.js';

export const CHENGDU_PLAYER_COUNT = 4;
export const CHENGDU_TILE_COUNT = 108;
export const CHENGDU_COPIES_PER_TILE = 4;

// 仅用显式整数座位寻址；null/字符串不经自动转换，避免无意获取0号位权限。
// Address explicit integer seats only; never coerce null/strings into accidental seat-zero access.
function requireSeat(seat) {
  if (!Number.isInteger(seat) || seat < 0 || seat >= CHENGDU_PLAYER_COUNT) throw new TypeError('座位无效');
}

// 验证实体牌预算，返回新计数数组；用于输入牌墙和每次成功动作后的守恒检查。
// Validate physical copy budgets and return fresh counts for supplied walls and post-action conservation.
function physicalTileCounts(tiles) {
  if (!Array.isArray(tiles) || tiles.length !== CHENGDU_TILE_COUNT) throw new Error('成都实体牌须为108张');
  const counts = Array(27).fill(0);
  for (const tile of tiles) {
    if (!isTileInSet(tile, CHENGDU_TILE_SET)) throw new Error('成都牌种无效');
    counts[tile]++;
  }
  if (counts.some((count) => count !== CHENGDU_COPIES_PER_TILE)) throw new Error('成都每种实体牌须恰好4张');
  return counts;
}

// 验证每局交换计划；正式合同另外约束其来自固定轮回，原型仍可显式构造方向夹具。
// Validate per-game exchange plans; production separately binds them to its confirmed cycle, while drafts allow explicit direction fixtures.
function validateExchangePlan(plan, enabled) {
  if (!enabled) {
    if (plan !== undefined && plan !== null) throw new TypeError('未换三张时不得传换牌计划');
    return null;
  }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) ||
    Object.keys(plan).some((key) => !['direction', 'clockwiseSeats', 'sameSuitRequired'].includes(key)) ||
    !CHENGDU_EXCHANGE_CYCLE.includes(plan.direction) || plan.sameSuitRequired !== true) {
    throw new TypeError('开发换牌计划须明确方向、座位映射，且必须同花色');
  }
  chengduExchangeRecipient(0, plan.direction, plan.clockwiseSeats);
  return structuredClone(plan);
}

// 真正开局仍被永久代码闸门阻断；传入任意 approved/force 字段也不能绕过。
// Real game creation remains code-gated; caller-supplied approved/force fields cannot bypass it.
export function createGame() {
  return requireChengduRules('start');
}

// 此入口不代表开局许可：要求外部完整牌墙，确定性发牌，只构造有明确开发标记的准备局。
// This is not launch permission: require a complete externally supplied wall and create a deterministic marked preparation draft.
// 不含随机数/时钟/数据库；先复制输入，任何错误都不会半改调用方数据。
// No randomness, clocks or storage; clone inputs so errors never partially mutate caller data.
export function createPreparationGame(input = {}) {
  return createPreparationState(input, { schemaVersion: 1, developmentOnly: true });
}

// 正式入口从完整牌墙发牌构造新对象，不升级原型存档；固定策略与轮回由正式工厂提供。
// Production construction deals into a new object, never upgrades a saved draft; its factory supplies the confirmed round snapshot.
export function createProductionPreparationGame(input, round) {
  return createPreparationState(input, {
    schemaVersion: CHENGDU_SCHEMA_VERSION, rulesVersion: CHENGDU_RULES_VERSION, runtimeKind: 'production',
    stage: 'preparation', exchangeOrdinal: round.exchangeOrdinal, nextExchangeOrdinal: round.nextExchangeOrdinal,
    playPolicy: chengduProductionPolicy(),
  });
}

// 共用确定性发牌算法，不共用版本认定；身份合同和牌数分别校验，错误不改变调用方输入。
// Share deterministic dealing, not version acceptance; validate identity and physical budgets independently without mutating inputs.
function createPreparationState({ wall, dealerSeat, options, scoring, exchangePlan } = {}, identity) {
  requireSeat(dealerSeat);
  physicalTileCounts(wall);
  const rules = {
    ...validateChengduOptions(options),
    ...validateChengduScoringOptions(scoring),
    playerCount: CHENGDU_PLAYER_COUNT,
    copiesPerTile: CHENGDU_COPIES_PER_TILE,
    ...(identity.runtimeKind === 'production' ? chengduProductionVisibility() : {}),
  };
  const plan = validateExchangePlan(exchangePlan, rules.exchangeThree);
  const remainingWall = [...wall];
  const players = Array.from({ length: CHENGDU_PLAYER_COUNT }, (_, seat) => ({
    seat, hand: remainingWall.splice(0, 13).sort((left, right) => left - right),
    melds: [], score: 0, dingqueSuit: null,
  }));
  players[dealerSeat].hand.push(remainingWall.shift());
  players[dealerSeat].hand.sort((left, right) => left - right);
  const game = {
    gameMode: 'chengdu', ...identity,
    revision: 0, dealerSeat, currentSeat: null, turnStep: null,
    phase: rules.exchangeThree ? 'exchange' : 'dingque', rules,
    wall: remainingWall, players, history: [],
    preparation: {
      exchangePlan: plan,
      exchangeSelections: Array(CHENGDU_PLAYER_COUNT).fill(null),
      exchangeReceipts: Array(CHENGDU_PLAYER_COUNT).fill(null),
    },
  };
  assertGameInvariants(game);
  return game;
}

// 只解析准备阶段动作，额外字段拒绝而非忽略；副本中排序让等价的三张牌不依赖点击顺序。
// Parse preparation actions only, rejecting extra fields; sort copied selections so click order has no semantic effect.
export function parseAction(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('操作格式无效');
  if (input.type === 'exchangeThree' && Object.keys(input).every((key) => ['type', 'tiles'].includes(key)) &&
    Array.isArray(input.tiles) && input.tiles.length === 3 && input.tiles.every((tile) => isTileInSet(tile, CHENGDU_TILE_SET))) {
    return { type: input.type, tiles: [...input.tiles].sort((left, right) => left - right) };
  }
  if (input.type === 'dingque' && Object.keys(input).every((key) => ['type', 'suit'].includes(key)) &&
    CHENGDU_SUITS.includes(input.suit)) return { type: input.type, suit: input.suit };
  throw new TypeError('成都准备阶段操作无效');
}

// 枚举手中每个三张多重集合，重复牌只能按真实张数选择；相同组合只返回一次。
// Enumerate unique three-tile multisets from the actual hand, respecting duplicate-copy counts.
function exchangeActions(hand, sameSuitRequired) {
  const choices = new Map();
  for (let first = 0; first < hand.length - 2; first++) {
    for (let second = first + 1; second < hand.length - 1; second++) {
      for (let third = second + 1; third < hand.length; third++) {
        const tiles = [hand[first], hand[second], hand[third]].sort((left, right) => left - right);
        if (sameSuitRequired && new Set(tiles.map((tile) => Math.floor(tile / 9))).size !== 1) continue;
        choices.set(tiles.join(','), { type: 'exchangeThree', tiles });
      }
    }
  }
  return [...choices.values()];
}

// 已提交的座位等待其余人，不接受重复决定；没有自动代选、计时跳过或借用花麻将续进。
// Submitted seats wait for everyone else, rejecting repeated decisions without auto-selection, timeouts or Flower continuation.
export function getLegalActions(game, seat) {
  requireSeat(seat);
  assertGameInvariants(game);
  if (game.phase === 'exchange' && game.preparation.exchangeSelections[seat] === null) {
    return exchangeActions(game.players[seat].hand, game.preparation.exchangePlan.sameSuitRequired);
  }
  if (game.phase === 'dingque' && game.players[seat].dingqueSuit === null) {
    return CHENGDU_SUITS.map((suit) => ({ type: 'dingque', suit }));
  }
  return [];
}

// 四家都提交后先统一扣牌，再统一入账，防止后提交者选择刚收到的牌或借中间状态窥牌。
// After all submissions, remove all outgoing tiles before adding any incoming ones, avoiding order-dependent selection or leaks.
function completeExchange(game) {
  const { exchangeSelections, exchangePlan } = game.preparation;
  for (let seat = 0; seat < CHENGDU_PLAYER_COUNT; seat++) {
    for (const tile of exchangeSelections[seat]) {
      const index = game.players[seat].hand.indexOf(tile);
      if (index < 0) throw new Error('换出牌不在手中');
      game.players[seat].hand.splice(index, 1);
    }
  }
  for (let seat = 0; seat < CHENGDU_PLAYER_COUNT; seat++) {
    const recipient = chengduExchangeRecipient(seat, exchangePlan.direction, exchangePlan.clockwiseSeats);
    const tiles = [...exchangeSelections[seat]];
    game.players[recipient].hand.push(...tiles);
    game.players[recipient].hand.sort((left, right) => left - right);
    game.preparation.exchangeReceipts[recipient] = { fromSeat: seat, tiles };
  }
  game.phase = 'dingque';
  game.history.push({ type: 'exchangeCompleted', direction: exchangePlan.direction });
}

// 唯一写入口先验证和精确匹配白名单，再复制转换；旧对象和失败动作都没有副作用。
// The sole write entry validates and exactly matches the allowlist before cloning/transitions, leaving inputs unchanged on failure.
export function applyAction(game, seat, input) {
  requireSeat(seat);
  const action = parseAction(input);
  const allowed = getLegalActions(game, seat).some((candidate) => JSON.stringify(candidate) === JSON.stringify(action));
  if (!allowed) throw new Error('当前不能执行这个成都准备动作');
  const next = structuredClone(game);
  if (action.type === 'exchangeThree') {
    next.preparation.exchangeSelections[seat] = [...action.tiles];
    if (next.preparation.exchangeSelections.every((selection) => selection !== null)) completeExchange(next);
  } else {
    next.players[seat].dingqueSuit = action.suit;
    if (next.players.every((player) => player.dingqueSuit !== null)) {
      next.phase = 'rulesPending';
      next.history.push({ type: 'dingqueCompleted' });
    }
  }
  next.revision++;
  assertGameInvariants(next);
  return next;
}

// 原型没有付款入口，尤其不把流局查花猪/查叫/退杠当作零分成功结算。
// No payment entry exists in this prototype, especially no silent zero-point flower-pig/ready/refund settlement.
export function settleGame() {
  return requireChengduRules('settlement');
}

// 只白名单复制安全事件；没有任意 text/payload 展开，后续新增事件默认不公开。
// Allowlist safe events only, never spreading arbitrary text/payload; future event types remain private by default.
export function publicEvents(game) {
  return game.history.flatMap((event) => {
    if (event.type === 'exchangeCompleted' && CHENGDU_EXCHANGE_CYCLE.includes(event.direction)) {
      return [{ type: event.type, direction: event.direction }];
    }
    return event.type === 'dingqueCompleted' ? [{ type: event.type }] : [];
  });
}

// 三类视图共用正向白名单；即使存档新增秘密字段，也不会因为展开整个对象而漏到客户端。
// All audiences use a positive allowlist, so newly saved secrets cannot leak through whole-object spreading.
function projectGame(game, seat) {
  assertGameInvariants(game);
  const isPlayer = seat !== null;
  const dingqueComplete = game.phase === 'rulesPending';
  const view = {
    ...chengduStateHeader(game),
    revision: game.revision, phase: game.phase,
    dealerSeat: game.dealerSeat, currentSeat: null, turnStep: null,
    mySeat: seat, wallCount: game.wall.length,
    rules: {
      endCondition: game.rules.endCondition, exchangeThree: game.rules.exchangeThree,
      dingque: true, selfDraw: game.rules.selfDraw, fanCap: game.rules.fanCap,
      playerCount: CHENGDU_PLAYER_COUNT, copiesPerTile: CHENGDU_COPIES_PER_TILE,
      ...(game.runtimeKind === 'production' ? chengduProductionVisibility() : {}),
    },
    players: game.players.map((player) => ({
      seat: player.seat, handCount: player.hand.length, melds: [], score: player.score,
      dingqueSubmitted: player.dingqueSuit !== null,
      dingqueSuit: dingqueComplete || player.seat === seat ? player.dingqueSuit : null,
      ...(player.seat === seat ? { hand: [...player.hand] } : {}),
    })),
    preparation: {
      exchangeDirection: game.preparation.exchangePlan?.direction ?? null,
      exchangeSubmittedSeats: game.preparation.exchangeSelections.flatMap((selection, index) => selection ? [index] : []),
      ...(isPlayer ? {
        myExchange: game.preparation.exchangeSelections[seat] && [...game.preparation.exchangeSelections[seat]],
        receivedExchange: game.preparation.exchangeReceipts[seat] && structuredClone(game.preparation.exchangeReceipts[seat]),
      } : {}),
    },
    legalActions: isPlayer ? getLegalActions(game, seat) : [],
    history: publicEvents(game),
    ...(game.developmentOnly === true ? { rulesPending: [...CHENGDU_RULE_GAPS] } : {}),
  };
  return view;
}

// 本人视图需由房间层先验凭证；座位下标本身从不是身份。返回值与权威对象完全分离。
// Room authorization must precede a seat view; an index is never identity. Return detached data only.
export function getPlayerView(game, seat) {
  requireSeat(seat);
  return projectGame(game, seat);
}

// 观众和原参与者均无私有手牌/换牌权限；结束准备阶段也不等于整局结束或允许摊牌。
// Viewers and former occupants have no private hands/exchanges; preparation completion never means final-hand disclosure.
export function getSpectatorView(game) {
  return projectGame(game, null);
}
export function getFormerParticipantView(game) {
  return projectGame(game, null);
}

// 校验原型版本、阶段、人数、牌预算和零和；声明此边界不能当成完整对局规则验证器。
// Validate prototype version/phase/seats, physical budgets and zero-sum scores; this is not a full gameplay validator.
export function assertGameInvariants(game) {
  assertChengduStateIdentity(game);
  if (!['exchange', 'dingque', 'rulesPending'].includes(game.phase)) throw new Error('不是支持的成都准备局');
  requireSeat(game.dealerSeat);
  if (!Number.isSafeInteger(game.revision) || game.revision < 0 || game.currentSeat !== null || game.turnStep !== null) {
    throw new Error('成都准备阶段回合标记无效');
  }
  if (!Array.isArray(game.players) || game.players.length !== CHENGDU_PLAYER_COUNT || !Array.isArray(game.history)) {
    throw new Error('成都须为四人牌桌');
  }
  const { rules, preparation } = game;
  validateChengduOptions({ endCondition: rules.endCondition, exchangeThree: rules.exchangeThree, dingque: rules.dingque });
  validateChengduScoringOptions({ selfDraw: rules.selfDraw, fanCap: rules.fanCap });
  if (rules.playerCount !== CHENGDU_PLAYER_COUNT || rules.copiesPerTile !== CHENGDU_COPIES_PER_TILE) throw new Error('成都牌数配置无效');
  validateExchangePlan(preparation.exchangePlan, rules.exchangeThree);
  for (const field of ['exchangeSelections', 'exchangeReceipts']) {
    if (!Array.isArray(preparation[field]) || preparation[field].length !== CHENGDU_PLAYER_COUNT) throw new Error('准备记录人数错误');
  }
  for (let seat = 0; seat < CHENGDU_PLAYER_COUNT; seat++) {
    const player = game.players[seat];
    if (player.seat !== seat || !Array.isArray(player.hand) || player.hand.length !== (seat === game.dealerSeat ? 14 : 13) ||
      !Array.isArray(player.melds) || player.melds.length !== 0 || player.score !== 0 ||
      (player.dingqueSuit !== null && !CHENGDU_SUITS.includes(player.dingqueSuit))) throw new Error('准备阶段玩家状态无效');
    const selection = preparation.exchangeSelections[seat];
    if (selection !== null) {
      const parsed = parseAction({ type: 'exchangeThree', tiles: selection });
      if (!rules.exchangeThree || (preparation.exchangePlan.sameSuitRequired &&
        new Set(parsed.tiles.map((tile) => Math.floor(tile / 9))).size !== 1)) throw new Error('保存的换牌选择无效');
      if (game.phase === 'exchange' && !exchangeActions(player.hand, preparation.exchangePlan.sameSuitRequired)
        .some((action) => JSON.stringify(action.tiles) === JSON.stringify(parsed.tiles))) throw new Error('换牌选择不属于本人手牌');
    }
    const receipt = preparation.exchangeReceipts[seat];
    if (receipt !== null) {
      requireSeat(receipt.fromSeat);
      const receivedTiles = parseAction({ type: 'exchangeThree', tiles: receipt.tiles }).tiles;
      // 准备完成后尚未有人出牌，所以收进的三张必须仍在收件者手里，不能只验证历史记录互相匹配。
      // No discards occur during preparation, so the recipient must still hold all incoming copies, not just matching references.
      const remainingHand = [...player.hand];
      for (const tile of receivedTiles) {
        const tileIndex = remainingHand.indexOf(tile);
        if (tileIndex < 0) throw new Error('换入牌不在收件者手中');
        remainingHand.splice(tileIndex, 1);
      }
      if (!rules.exchangeThree || chengduExchangeRecipient(receipt.fromSeat, preparation.exchangePlan.direction,
        preparation.exchangePlan.clockwiseSeats) !== seat ||
        JSON.stringify(receipt.tiles) !== JSON.stringify(preparation.exchangeSelections[receipt.fromSeat])) {
        throw new Error('换牌收件记录无效');
      }
    }
  }
  const selectionCount = preparation.exchangeSelections.filter((selection) => selection !== null).length;
  const receiptCount = preparation.exchangeReceipts.filter((receipt) => receipt !== null).length;
  if (game.phase === 'exchange' && (!rules.exchangeThree || selectionCount === 4 || receiptCount !== 0 ||
    game.players.some((player) => player.dingqueSuit !== null))) throw new Error('换牌阶段边界无效');
  if (game.phase !== 'exchange' && rules.exchangeThree && (selectionCount !== 4 || receiptCount !== 4)) throw new Error('换牌未完整提交');
  if (!rules.exchangeThree && (selectionCount !== 0 || receiptCount !== 0)) throw new Error('未启用换牌却有交换记录');
  const dingqueCount = game.players.filter((player) => player.dingqueSuit !== null).length;
  if ((game.phase === 'dingque' && dingqueCount === 4) || (game.phase === 'rulesPending' && dingqueCount !== 4)) {
    throw new Error('定缺阶段边界无效');
  }
  // 交换记录是历史引用，不再计入实体牌；否则同一组牌会被错误地算三遍。
  // Exchange records are historical references, not additional physical tiles counted alongside wall/hands.
  physicalTileCounts([...game.wall, ...game.players.flatMap((player) => player.hand)]);
  if (game.players.reduce((total, player) => total + player.score, 0) !== 0) throw new Error('成都虚拟积分必须零和');
  return true;
}
