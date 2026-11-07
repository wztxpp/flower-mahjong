/**
 * 成都独立回合状态机：发牌/换三张/定缺后支持出牌、碰、杠、抢杠、胡和血战退出。
 * Independent turn state machine: preparation followed by discards, peng, kongs, rob-kong, wins and blood-battle retirement.
 * 原型schema 1与正式schema 2分别验版本和策略；生产外部入口为chengdu-engine.js，不借用花麻将。
 * Draft schema one and production schema two validate distinct identities/policies; chengdu-engine.js is the production entry, without Flower reuse.
 */
import * as preparation from './chengdu-game.js';
import { validateChengduOptions } from './chengdu-options.js';
import { validateChengduScoringOptions } from './chengdu-contract.js';
import { CHENGDU_SUITS, getChengduDiscardTiles, hasDingqueTiles } from './chengdu-hand.js';
import { calculateChengduScore, getChengduWaitScores } from './chengdu-scoring.js';
import { CHENGDU_TILE_SET, isTileInSet } from './tile-sets.js';
import { validateChengduPlayPolicy } from './chengdu-play-policy.js';
import { buildChengduDrawSettlement } from './chengdu-settlement.js';
import { assertChengduStateIdentity, chengduStateHeader, chengduProductionVisibility, isChengduProductionHeader } from './chengdu-production-contract.js';

const PREPARATION_PHASES = ['exchange', 'dingque'];
const ACTIVE_PHASES = ['turn', 'claim', 'finished'];

// 仅明确的0至3座位有效；undefined/null不得被视作观战者或0号玩家。
// Only explicit seats zero through three are valid; never coerce absent/null into spectators or player zero.
function requireSeat(seat) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3) throw new TypeError('成都座位无效');
}

// 此工厂只建开发局；正式工厂在chengdu-engine.js。要求完整牌墙和实验策略，不修改输入。
// This factory creates drafts only; production has its own entry. Require full walls and explicit policies without input mutation.
export function createDevelopmentGame(input, playPolicy) {
  const game = preparation.createPreparationGame(input);
  game.playPolicy = validateChengduPlayPolicy(playPolicy);
  game.developmentStage = 'preparation';
  assertGameInvariants(game);
  return game;
}

// 在唯一的最后定缺提交之后进入回合；没有新牌墙、额外发牌或独立房间身份。
// Enter turns only after the final dingque submission, without a new wall, extra deal or separate room identity.
function beginPlay(game) {
  if (isChengduProductionHeader(game)) game.stage = 'play';
  else game.developmentStage = 'play';
  game.phase = 'turn';
  game.currentSeat = game.dealerSeat;
  game.turnStep = 'discard';
  game.discards = [];
  game.claim = null;
  // 换三张可能已换走庄家原多发的一张；起手可胡，但不能伪造一张仍在手中的新摸牌。
  // Exchange may have removed the dealer's extra tile: the initial hand can win without inventing a retained draw identity.
  game.lastDraw = { seat: game.dealerSeat, tile: null, source: 'initial' };
  game.kongLedger = [];
  game.drawSettlement = null;
  game.finishReason = null;
  for (const player of game.players) {
    player.won = null;
    player.passedWin = false;
    player.mustDiscardAfterPeng = false;
  }
}

// 计算顺位只遍历四个位置；已胡者退出本局，不再摸牌、接牌、付后续自摸或杠分。
// Traverse four positions in snapshot order; retired winners no longer draw, claim or pay later self-draw/kong events.
function seatsAfter(game, seat) {
  const seats = game.playPolicy.clockwiseSeats;
  const offset = game.playPolicy.turnDirection === 'clockwise' ? 1 : -1;
  const start = seats.indexOf(seat);
  return [1, 2, 3].map((distance) => seats[(start + offset * distance + 8) % 4]);
}
function activeOthers(game, seat) {
  return seatsAfter(game, seat).filter((other) => game.players[other].won === null);
}

// 算分只使用本人的牌与保存选项；接炮/抢杠附加一张结构引用，但不移动另一家的实体牌。
// Score own tiles and saved choices only; discard/rob wins add a structural reference without transferring physical copies.
function scoreFor(game, seat, tile, isSelfDraw) {
  const player = game.players[seat];
  return calculateChengduScore(
    isSelfDraw ? player.hand : [...player.hand, tile], player.melds, player.dingqueSuit,
    { selfDraw: game.rules.selfDraw, fanCap: game.rules.fanCap },
    { isSelfDraw, pureSuitStacking: game.playPolicy.pureSuitStacking },
  );
}

// 全部转账先校验后成对记账；只在动作副本上调用，避免中途异常留下半批账本。
// Validate all transfers before paired postings; call only on action clones to avoid partial batches on failure.
function postPayments(game, payments) {
  for (const payment of payments) {
    requireSeat(payment.from);
    requireSeat(payment.to);
    if (payment.from === payment.to || !Number.isSafeInteger(payment.points) || payment.points < 0) {
      throw new Error('成都转账无效');
    }
  }
  for (const payment of payments) {
    game.players[payment.from].score -= payment.points;
    game.players[payment.to].score += payment.points;
  }
}

// 只有墙耗尽的自动边界调用；首胡与血战都原子完成查花猪、查叫和退杠。
// Called only on the exhausted-wall boundary; both modes atomically post missing-suit, ready-check and refund settlements.
function settleDraw(game) {
  if (game.drawSettlement?.status === 'settled' || game.history.some((event) => event.type === 'drawSettlement')) {
    throw new Error('成都流局已经结算，不可重复入账');
  }
  const plan = buildChengduDrawSettlement(game);
  game.currentSeat = null;
  game.turnStep = null;
  game.lastDraw = null;
  game.claim = null;
  postPayments(game, plan.payments);
  for (const kong of game.kongLedger) if (plan.refundIds.includes(kong.id)) kong.refunded = true;
  game.drawSettlement = { status: 'settled', payments: structuredClone(plan.payments), refundIds: [...plan.refundIds] };
  game.history.push({ type: 'drawSettlement', payments: structuredClone(plan.payments) });
  finishGame(game, 'wallExhausted');
}

// 终局不再自动摸牌或付款；已记的胡/杠与流局账保留，后续读取不会重算。
// Finishing never draws or posts again; preserve prior ledgers and never recalculate on reads.
function finishGame(game, reason) {
  game.phase = 'finished';
  game.finishReason = reason;
  game.currentSeat = null;
  game.turnStep = null;
  game.claim = null;
  game.lastDraw = null;
}

// 自动摸牌只前进一个真实回合，不代替玩家选择；清除过胡锁必须发生在本人确实摸到牌以后。
// Draw exactly one real turn without making choices; clear a passed-win lock only after that player actually draws.
function beginDraw(game, seat, source = 'normal') {
  if (game.players[seat].won !== null) throw new Error('已胡玩家不能再摸牌');
  if (!game.wall.length) {
    settleDraw(game);
    return;
  }
  const tile = game.wall.shift();
  game.players[seat].hand.push(tile);
  game.players[seat].hand.sort((left, right) => left - right);
  game.players[seat].passedWin = false;
  game.phase = 'turn';
  game.currentSeat = seat;
  game.turnStep = 'discard';
  game.claim = null;
  game.lastDraw = { seat, tile, source };
  game.history.push({ type: 'draw', seat, tile, source });
}

// 三种杠只收显式开发金额；明杠由放牌者付，其余由本次仍在局内的其他玩家付。
// Kongs use explicit development amounts; the discarder pays an exposed kong, while active opponents pay concealed/upgraded kongs.
function settleKong(game, seat, type, fromSeat = null, tile = game.players[seat].melds.at(-1).tile) {
  const payers = type === 'mingGang' ? [fromSeat] : activeOthers(game, seat);
  const points = game.playPolicy.kongPoints[type];
  const payments = payers.map((from) => ({ from, to: seat, points, reason: type }));
  postPayments(game, payments);
  const id = game.kongLedger.length;
  game.kongLedger.push({ id, seat, type, tile, payments: structuredClone(payments), refunded: false });
  game.history.push({ type, seat, tile, payments, kongId: id });
}

// 严格移除真实持有的份数，任何缺牌都在副本中抛错；不得用负下标误删最后一张。
// Remove genuine held copies only, throwing on the cloned state rather than splicing a negative index.
function removeTiles(hand, tile, count) {
  for (let removed = 0; removed < count; removed++) {
    const index = hand.indexOf(tile);
    if (index < 0) throw new Error('要移除的牌不在手中');
    hand.splice(index, 1);
  }
}

// 胡牌优先，但等待全部有资格者回应；响应速度不能决定多胡结果或先收某家的钱。
// Wins have priority but wait for every eligible response; response speed cannot determine winners or early payments.
function settleWins(game, winners, source, tile, fromSeat) {
  const activeBefore = game.players.filter((player) => player.won === null).map((player) => player.seat);
  const results = winners.map((seat) => {
    const score = scoreFor(game, seat, tile, source === 'selfDraw');
    if (!score) throw new Error('胡牌结构不合法');
    const payers = source === 'selfDraw' ? activeBefore.filter((other) => other !== seat) : [fromSeat];
    return { seat, score, payments: payers.map((from) => ({ from, to: seat, points: score.points, reason: 'hu' })) };
  });
  // 抢补杠成功只移出新增一张，原碰不变、不收杠分、不补摸，实体牌留在公开弃牌区。
  // Successful rob-kong removes only the added tile, retaining the peng and no kong payment/replacement; keep the copy in discards.
  if (source === 'robKong') {
    removeTiles(game.players[fromSeat].hand, tile, 1);
    game.discards.push({ seat: fromSeat, tile, claimed: false, winning: true, source: 'robKong' });
  } else if (source === 'discard') {
    game.discards[game.claim.discardIndex].winning = true;
  }
  postPayments(game, results.flatMap((result) => result.payments));
  for (const result of results) {
    game.players[result.seat].won = { source, tile, fromSeat, batchId: game.revision + 1, score: structuredClone(result.score) };
    game.players[result.seat].mustDiscardAfterPeng = false;
    game.history.push({ type: 'hu', seat: result.seat, source, tile, fromSeat, batchId: game.revision + 1, score: result.score, payments: result.payments });
  }
  game.claim = null;
  if (game.rules.endCondition === 'firstWin') finishGame(game, 'firstWin');
  else if (game.players.filter((player) => player.won === null).length <= 1) finishGame(game, 'threeWinners');
  else {
    // 用户最后确认胡者退出：自摸/单人接炮后由胡家下一位未胡者摸，多响由炮家摸。
    // Final confirmation retires winners: self-draw/single discard advances after that winner, while multiple wins return to the discarder.
    const nextSeat = source !== 'selfDraw' && winners.length > 1 ? fromSeat : activeOthers(game, winners[0])[0];
    beginDraw(game, nextSeat);
  }
}

// 用户确认缺门未清也可碰杠其他花色，但缺门牌自身不能碰杠，缺门未清仍不能胡。
// Confirmed non-missing-suit melds remain legal before clearance; missing-suit melds and uncleared-dingque wins remain illegal.
function canMeld(player, tile) {
  return CHENGDU_TILE_SET.tiles[tile].suit !== player.dingqueSuit;
}

// 构造私有回应白名单，胡/明杠/碰同时存在时都保留；只能在所有人确认后处理动作优先级。
// Build private response allowlists, preserving concurrent hu/kong/peng choices until full-window priority resolution.
function makeClaim(game, fromSeat, tile, source, extra = {}) {
  const options = {};
  for (const seat of activeOthers(game, fromSeat)) {
    const player = game.players[seat];
    const choices = [];
    if (!(game.playPolicy.passedWins === 'untilOwnDraw' && player.passedWin) && scoreFor(game, seat, tile, false)) {
      choices.push({ type: 'hu' });
    }
    if (source === 'discard' && canMeld(player, tile)) {
      const copies = player.hand.filter((held) => held === tile).length;
      if (copies >= 3 && game.wall.length) choices.push({ type: 'mingGang', tile });
      if (copies >= 2) choices.push({ type: 'peng', tile });
    }
    if (choices.length) options[seat] = [...choices, { type: 'pass' }];
  }
  const eligibleSeats = activeOthers(game, fromSeat).filter((seat) => Object.hasOwn(options, seat));
  if (!eligibleSeats.length) return null;
  return { source, fromSeat, tile, eligibleSeats, options, responses: {},
    passedWinAtOpen: game.players.map((player) => player.passedWin), ...extra };
}

// 无人抢补杠时才提交第四张，并记录真正补杠牌而不是依赖副露数组最后一组。
// Commit an upgraded kong only after no robbers win, using its actual tile rather than the last meld's identity.
function completeUpgrade(game, seat, tile, meldIndex) {
  const meld = game.players[seat].melds[meldIndex];
  if (meld?.type !== 'peng' || meld.tile !== tile) throw new Error('补杠的原碰不存在');
  removeTiles(game.players[seat].hand, tile, 1);
  meld.type = 'buGang';
  meld.tiles.push(tile);
  settleKong(game, seat, 'buGang', null, tile);
  beginDraw(game, seat, 'replacement');
}

// 所有回应到齐后先胡，再明杠、再碰；同级沿保存的回合方向，而非请求到达顺序。
// After all responses arrive, prioritize hu, exposed kong, then peng, using saved turn order rather than arrival order.
function resolveClaim(game) {
  const claim = game.claim;
  if (!claim.eligibleSeats.every((seat) => Object.hasOwn(claim.responses, seat))) return;
  const winners = claim.eligibleSeats.filter((seat) => claim.responses[seat].type === 'hu');
  if (winners.length) {
    settleWins(game, winners, claim.source, claim.tile, claim.fromSeat);
    return;
  }
  if (claim.source === 'robKong') {
    completeUpgrade(game, claim.fromSeat, claim.tile, claim.meldIndex);
    return;
  }
  const chosenSeat = claim.eligibleSeats.find((seat) => claim.responses[seat].type === 'mingGang') ??
    claim.eligibleSeats.find((seat) => claim.responses[seat].type === 'peng');
  if (chosenSeat !== undefined) {
    const type = claim.responses[chosenSeat].type;
    const player = game.players[chosenSeat];
    removeTiles(player.hand, claim.tile, type === 'peng' ? 2 : 3);
    player.melds.push({ type, tile: claim.tile, tiles: Array(type === 'peng' ? 3 : 4).fill(claim.tile), fromSeat: claim.fromSeat });
    game.discards[claim.discardIndex].claimed = true;
    game.claim = null;
    if (type === 'mingGang') {
      settleKong(game, chosenSeat, type, claim.fromSeat);
      beginDraw(game, chosenSeat, 'replacement');
    } else {
      player.mustDiscardAfterPeng = game.playPolicy.kongsAfterPeng === 'afterDiscard';
      game.phase = 'turn';
      game.currentSeat = chosenSeat;
      game.turnStep = 'discard';
      game.lastDraw = null;
      game.history.push({ type: 'peng', seat: chosenSeat, tile: claim.tile, fromSeat: claim.fromSeat });
    }
    return;
  }
  beginDraw(game, activeOthers(game, claim.fromSeat)[0]);
}

// 只接受本模式字段与牌种，拒绝额外字段、吃牌、花麻将加杠和伪造计分。
// Accept this mode's fields/identities only, rejecting extras, chi, Flower extended kongs and forged scores.
export function parseAction(input) {
  if (input?.type === 'exchangeThree' || input?.type === 'dingque') return preparation.parseAction(input);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('成都动作格式无效');
  if (['pass', 'hu'].includes(input.type) && Object.keys(input).length === 1) return { type: input.type };
  if (['discard', 'peng', 'mingGang', 'anGang', 'buGang'].includes(input.type) &&
    Object.keys(input).length === 2 && Object.hasOwn(input, 'tile') && isTileInSet(input.tile, CHENGDU_TILE_SET)) {
    return { type: input.type, tile: input.tile };
  }
  throw new TypeError('成都动作格式无效');
}

// 完成与未决结算都无合法动作；血战退出者不因重连或曾有可胡动作重新进入牌局。
// Finished states expose no actions; retired winners cannot re-enter through reconnect or old winning options.
export function getLegalActions(game, seat) {
  requireSeat(seat);
  assertGameInvariants(game);
  if (PREPARATION_PHASES.includes(game.phase)) return preparation.getLegalActions(game, seat);
  const player = game.players[seat];
  if (player.won !== null) return [];
  if (game.phase === 'claim') {
    if (!game.claim.eligibleSeats.includes(seat) || Object.hasOwn(game.claim.responses, seat)) return [];
    return structuredClone(game.claim.options[seat]);
  }
  if (game.phase !== 'turn' || game.currentSeat !== seat) return [];
  const choices = getChengduDiscardTiles(player.hand, player.dingqueSuit).map((tile) => ({ type: 'discard', tile }));
  if (game.lastDraw?.seat === seat && scoreFor(game, seat, null, true)) choices.unshift({ type: 'hu' });
  if (!game.wall.length || player.mustDiscardAfterPeng) return choices;
  for (const tile of [...new Set(player.hand)].sort((left, right) => left - right)) {
    if (!canMeld(player, tile)) continue;
    if (player.hand.filter((held) => held === tile).length === 4) choices.push({ type: 'anGang', tile });
    if (player.melds.some((meld) => meld.type === 'peng' && meld.tile === tile)) choices.push({ type: 'buGang', tile });
  }
  return choices;
}

// 动作精确匹配后才克隆；准备层保持其原合同，最后一次定缺原子接到本模式回合。
// Clone only after an exact allowlist match; preserve preparation's contract and atomically enter turns after the final choice.
export function applyAction(game, seat, input) {
  requireSeat(seat);
  const action = parseAction(input);
  if (!getLegalActions(game, seat).some((candidate) => JSON.stringify(candidate) === JSON.stringify(action))) {
    throw new Error('当前不能执行这个成都动作');
  }
  if (PREPARATION_PHASES.includes(game.phase)) {
    const next = preparation.applyAction(game, seat, action);
    if (next.phase === 'rulesPending') beginPlay(next);
    assertGameInvariants(next);
    return next;
  }
  const next = structuredClone(game);
  const player = next.players[seat];
  // 放弃自摸而选择出牌或杠都算过胡；若杠成功并补摸会自然解锁，若被抢则不能错误地提前解锁。
  // Declining self-draw for a discard or kong passes hu; successful replacement draws clear it, but robbery must not clear it early.
  if (next.phase === 'turn' && action.type !== 'hu' && next.lastDraw?.seat === seat && scoreFor(next, seat, null, true)) {
    player.passedWin = true;
  }
  if (next.phase === 'claim') {
    if (action.type !== 'hu' && next.claim.options[seat].some((option) => option.type === 'hu')) player.passedWin = true;
    next.claim.responses[seat] = action;
    resolveClaim(next);
  } else if (action.type === 'discard') {
    removeTiles(player.hand, action.tile, 1);
    player.mustDiscardAfterPeng = false;
    next.lastDraw = null;
    next.discards.push({ seat, tile: action.tile, claimed: false, winning: false, source: 'discard' });
    next.history.push({ type: 'discard', seat, tile: action.tile });
    next.claim = makeClaim(next, seat, action.tile, 'discard', { discardIndex: next.discards.length - 1 });
    if (next.claim) {
      next.phase = 'claim';
      next.currentSeat = null;
      next.turnStep = null;
    } else beginDraw(next, activeOthers(next, seat)[0]);
  } else if (action.type === 'hu') {
    const tile = next.lastDraw?.tile ?? null;
    settleWins(next, [seat], 'selfDraw', tile, null);
  } else if (action.type === 'anGang') {
    removeTiles(player.hand, action.tile, 4);
    player.melds.push({ type: 'anGang', tile: action.tile, tiles: Array(4).fill(action.tile), fromSeat: null });
    settleKong(next, seat, 'anGang');
    beginDraw(next, seat, 'replacement');
  } else if (action.type === 'buGang') {
    const meldIndex = player.melds.findIndex((meld) => meld.type === 'peng' && meld.tile === action.tile);
    next.claim = makeClaim(next, seat, action.tile, 'robKong', { meldIndex });
    if (next.claim) {
      next.phase = 'claim';
      next.currentSeat = null;
      next.turnStep = null;
      next.lastDraw = null;
    } else completeUpgrade(next, seat, action.tile, meldIndex);
  }
  next.revision++;
  assertGameInvariants(next);
  return next;
}

// 终局再读/再尝试结算不会加账；流局已自动完成，不接受客户端主动触发或替换规则。
// Repeated finished settlement never reposts; exhaustion settles automatically, with no client-triggered/replacement-policy path.
export function settleDevelopmentDraw(game) {
  assertGameInvariants(game);
  if (game.phase === 'finished' && game.finishReason === 'wallExhausted') return structuredClone(game);
  throw new Error('当前不是已结算流局');
}

// 校验开发版本、实体牌、阶段手数与零和；弃牌被碰杠后只在副露计数，胡牌记录始终是引用。
// Validate draft version, physical copies, phase-specific hand sizes and zero-sum scores; claimed discards and win references never double-count.
export function assertGameInvariants(game) {
  assertChengduStateIdentity(game);
  validateChengduPlayPolicy(game.playPolicy);
  const stage = isChengduProductionHeader(game) ? game.stage : game.developmentStage;
  if (stage === 'preparation' && PREPARATION_PHASES.includes(game.phase)) return preparation.assertGameInvariants(game);
  if (stage !== 'play' || !ACTIVE_PHASES.includes(game.phase) || game.players.length !== 4 ||
    !Number.isSafeInteger(game.revision) || game.revision < 0) throw new Error('成都回合状态无效');
  requireSeat(game.dealerSeat);
  validateChengduOptions({ endCondition: game.rules.endCondition, exchangeThree: game.rules.exchangeThree, dingque: game.rules.dingque });
  validateChengduScoringOptions({ selfDraw: game.rules.selfDraw, fanCap: game.rules.fanCap });
  if (game.rules.playerCount !== 4 || game.rules.copiesPerTile !== 4 || !Array.isArray(game.wall) ||
    !Array.isArray(game.history) || !Array.isArray(game.discards)) throw new Error('成都牌桌配置无效');
  if (game.phase === 'turn') {
    requireSeat(game.currentSeat);
    if (game.turnStep !== 'discard' || game.players[game.currentSeat].won !== null || game.claim !== null) throw new Error('成都回合标记无效');
  } else if (game.currentSeat !== null || game.turnStep !== null) throw new Error('非回合阶段不得有行动位');
  const physical = [...game.wall];
  for (let seat = 0; seat < 4; seat++) {
    const player = game.players[seat];
    if (player.seat !== seat || !CHENGDU_SUITS.includes(player.dingqueSuit) || !Array.isArray(player.hand) ||
      !Array.isArray(player.melds) || player.melds.length > 4 || !Number.isSafeInteger(player.score) ||
      typeof player.passedWin !== 'boolean' || typeof player.mustDiscardAfterPeng !== 'boolean') throw new Error('成都玩家状态无效');
    for (const meld of player.melds) {
      const count = meld.type === 'peng' ? 3 : 4;
      if (!['peng', 'anGang', 'mingGang', 'buGang'].includes(meld.type) || meld.tiles.length !== count ||
        meld.tiles.some((tile) => tile !== meld.tile)) throw new Error('成都副露状态无效');
      physical.push(...meld.tiles);
    }
    const hasExtra = player.won?.source === 'selfDraw' || (game.phase === 'turn' && game.currentSeat === seat) ||
      (game.phase === 'claim' && game.claim?.source === 'robKong' && game.claim.fromSeat === seat);
    const expected = 13 - player.melds.length * 3 + (hasExtra ? 1 : 0);
    if (player.hand.length !== expected) throw new Error(`成都座位${seat}手数不合法：${player.hand.length}/${expected}`);
    if (player.won !== null && (!['selfDraw', 'discard', 'robKong'].includes(player.won.source) ||
      hasDingqueTiles(player.hand, player.melds, player.dingqueSuit))) throw new Error('成都已胡状态无效');
    physical.push(...player.hand);
  }
  for (const discard of game.discards) {
    requireSeat(discard.seat);
    if (typeof discard.claimed !== 'boolean' || !isTileInSet(discard.tile, CHENGDU_TILE_SET)) throw new Error('成都弃牌无效');
    if (!discard.claimed) physical.push(discard.tile);
  }
  const counts = Array(27).fill(0);
  for (const tile of physical) {
    if (!isTileInSet(tile, CHENGDU_TILE_SET)) throw new Error('成都牌种无效');
    counts[tile]++;
  }
  if (physical.length !== 108 || counts.some((count) => count !== 4)) throw new Error('成都实体牌不守恒');
  if (game.players.reduce((sum, player) => sum + player.score, 0) !== 0) throw new Error('成都虚拟积分不守恒');
  if (!Array.isArray(game.kongLedger)) throw new Error('成都杠账缺失');
  const settledKongs = new Set();
  for (let index = 0; index < game.kongLedger.length; index++) {
    const kong = game.kongLedger[index];
    requireSeat(kong.seat);
    if (kong.id !== index || !['anGang', 'mingGang', 'buGang'].includes(kong.type) ||
      typeof kong.refunded !== 'boolean' || !Array.isArray(kong.payments) ||
      settledKongs.has(`${kong.seat}:${kong.tile}`) ||
      !game.players[kong.seat].melds.some((meld) => meld.type === kong.type && meld.tile === kong.tile)) throw new Error('成都杠账无效');
    settledKongs.add(`${kong.seat}:${kong.tile}`);
    // 杠账必须与原始已提交事件完整一致，不能只检查剩下的付款条目而静默漏退一位付款人。
    // Match the complete original committed kong event, not just remaining entries that could silently omit a refund payer.
    const events = game.history.filter((event) => event.kongId === kong.id && ['anGang', 'mingGang', 'buGang'].includes(event.type));
    if (events.length !== 1 || events[0].type !== kong.type || events[0].seat !== kong.seat || events[0].tile !== kong.tile ||
      JSON.stringify(events[0].payments) !== JSON.stringify(kong.payments) || !kong.payments.length ||
      kong.payments.length > 3 || (kong.type === 'mingGang' && kong.payments.length !== 1)) throw new Error('成都杠账与原付款事件不一致');
    const payers = new Set();
    for (const payment of kong.payments) {
      requireSeat(payment.from);
      if (payment.to !== kong.seat || payment.from === kong.seat || payers.has(payment.from) ||
        payment.points !== game.playPolicy.kongPoints[kong.type]) throw new Error('成都杠账付款无效');
      payers.add(payment.from);
    }
  }
  if (game.phase === 'claim') {
    const claim = game.claim;
    if (!claim || !['discard', 'robKong'].includes(claim.source) || !claim.eligibleSeats.length ||
      new Set(claim.eligibleSeats).size !== claim.eligibleSeats.length) throw new Error('成都回应窗口无效');
    requireSeat(claim.fromSeat);
    if (!isTileInSet(claim.tile, CHENGDU_TILE_SET)) throw new Error('成都回应牌无效');
    if (!Array.isArray(claim.passedWinAtOpen) || claim.passedWinAtOpen.length !== 4 ||
      claim.passedWinAtOpen.some((value) => typeof value !== 'boolean')) throw new Error('成都窗口过胡快照无效');
    // 从窗口开启时的锁重建完整资格，不能仅检查存档列出的人而遗漏另一个可胡者。
    // Rebuild all eligibility using opening locks, rather than validating only listed seats and overlooking another winner.
    const atOpen = { ...game, players: game.players.map((player, seat) => ({ ...player, passedWin: claim.passedWinAtOpen[seat] })) };
    const expected = makeClaim(atOpen, claim.fromSeat, claim.tile, claim.source);
    if (!expected || JSON.stringify(expected.eligibleSeats) !== JSON.stringify(claim.eligibleSeats) ||
      JSON.stringify(expected.options) !== JSON.stringify(claim.options)) throw new Error('成都完整回应资格无效');
    for (let seat = 0; seat < 4; seat++) {
      const declined = Object.hasOwn(claim.responses, seat) && claim.responses[seat].type !== 'hu' &&
        claim.options[seat]?.some((action) => action.type === 'hu');
      const expectedLock = declined ? true : claim.passedWinAtOpen[seat];
      if (game.players[seat].passedWin !== expectedLock) throw new Error('成都回应过胡锁无效');
    }
    if (Object.keys(claim.responses).some((seat) => !claim.eligibleSeats.includes(Number(seat))) ||
      Object.keys(claim.options).some((seat) => !claim.eligibleSeats.includes(Number(seat))) ||
      claim.eligibleSeats.every((seat) => Object.hasOwn(claim.responses, seat))) throw new Error('成都回应集合无效');
    if (claim.source === 'discard') {
      const discard = game.discards[claim.discardIndex];
      if (claim.discardIndex !== game.discards.length - 1 || !discard || discard.claimed || discard.winning ||
        discard.seat !== claim.fromSeat || discard.tile !== claim.tile) throw new Error('成都弃牌窗口来源无效');
    } else {
      const meld = game.players[claim.fromSeat].melds[claim.meldIndex];
      if (meld?.type !== 'peng' || meld.tile !== claim.tile || !game.players[claim.fromSeat].hand.includes(claim.tile) ||
        !game.wall.length) throw new Error('成都抢杠窗口来源无效');
    }
    for (const seat of claim.eligibleSeats) {
      requireSeat(seat);
      if (seat === claim.fromSeat || game.players[seat].won !== null || !Array.isArray(claim.options[seat])) throw new Error('成都回应资格无效');
      const options = claim.options[seat];
      if (options.length < 2 || options.filter((action) => action.type === 'pass').length !== 1 ||
        new Set(options.map((action) => JSON.stringify(action))).size !== options.length) throw new Error('成都回应选项无效');
      for (const action of options) {
        parseAction(action);
        if (!['hu', 'pass', 'peng', 'mingGang'].includes(action.type) ||
          (claim.source === 'robKong' && !['hu', 'pass'].includes(action.type))) throw new Error('成都回应动作无效');
        if (action.type === 'hu' && !scoreFor(game, seat, claim.tile, false)) throw new Error('成都保存胡牌选项无效');
        if (['peng', 'mingGang'].includes(action.type)) {
          const copies = game.players[seat].hand.filter((tile) => tile === claim.tile).length;
          if (action.tile !== claim.tile || !canMeld(game.players[seat], claim.tile) ||
            copies < (action.type === 'peng' ? 2 : 3) || (action.type === 'mingGang' && !game.wall.length)) {
            throw new Error('成都保存副露选项无效');
          }
        }
      }
      if (Object.hasOwn(claim.responses, seat) && !claim.options[seat]
        .some((action) => JSON.stringify(action) === JSON.stringify(claim.responses[seat]))) throw new Error('成都保存回应无效');
    }
  } else if (game.claim !== null) throw new Error('成都非回应阶段残留窗口');
  const settlementEvents = game.history.filter((event) => event.type === 'drawSettlement');
  if (game.phase === 'finished' && game.finishReason === 'wallExhausted') {
    if (game.wall.length || game.drawSettlement?.status !== 'settled' || settlementEvents.length !== 1 ||
      JSON.stringify(settlementEvents[0].payments) !== JSON.stringify(game.drawSettlement.payments) ||
      !Array.isArray(game.drawSettlement.refundIds) || new Set(game.drawSettlement.refundIds).size !== game.drawSettlement.refundIds.length ||
      game.drawSettlement.refundIds.some((id) => game.kongLedger[id]?.refunded !== true) ||
      game.kongLedger.some((kong) => kong.refunded !== game.drawSettlement.refundIds.includes(kong.id))) throw new Error('成都已结算流局记录无效');
  } else if (game.drawSettlement !== null || settlementEvents.length || game.kongLedger.some((kong) => kong.refunded)) {
    throw new Error('成都非流局结算阶段残留账本');
  }
  if (game.phase === 'finished' && !['wallExhausted', 'firstWin', 'threeWinners'].includes(game.finishReason)) throw new Error('成都结束原因无效');
  if (game.phase !== 'finished' && game.finishReason !== null) throw new Error('成都进行中局残留结束原因');
  return true;
}

// 事件采用正向白名单：抽牌仅本人见；正式局已成立暗杠公开、自摸终局公开；原型保留原遮蔽。
// Event allowlists keep draws private, disclose production established kongs and finished wins, and preserve conservative draft masking.
export function publicEvents(game, viewerSeat = null) {
  if (viewerSeat !== null) requireSeat(viewerSeat);
  const events = [];
  const production = isChengduProductionHeader(game);
  for (const event of game.history) {
    if (event.type === 'exchangeCompleted' || event.type === 'dingqueCompleted') {
      events.push(...preparation.publicEvents({ history: [event] }));
      continue;
    }
    if (event.type === 'draw') {
      events.push({ type: 'draw', seat: event.seat, source: event.source,
        tile: event.seat === viewerSeat && event.hidden !== true ? event.tile : null,
        hidden: event.hidden === true || event.seat !== viewerSeat });
      continue;
    }
    if (['discard', 'peng', 'anGang', 'mingGang', 'buGang'].includes(event.type)) {
      const hidden = event.hidden === true || (event.type === 'anGang' && event.seat !== viewerSeat && !production);
      events.push({ type: event.type, seat: event.seat, tile: hidden ? null : event.tile,
        ...(hidden ? { hidden: true } : {}),
        ...(Number.isInteger(event.fromSeat) ? { fromSeat: event.fromSeat } : {}),
        ...(event.payments ? { payments: projectPayments(event.payments) } : {}),
      });
      continue;
    }
    if (event.type === 'hu') {
      const hidden = event.hidden === true || (event.source === 'selfDraw' && event.seat !== viewerSeat &&
        !(production && game.phase === 'finished'));
      events.push({ type: 'hu', seat: event.seat, source: event.source, fromSeat: event.fromSeat,
        tile: hidden ? null : event.tile, hidden,
        points: event.score?.points ?? event.points, payments: projectPayments(event.payments) });
      continue;
    }
    if (event.type === 'drawSettlement') events.push({ type: event.type, payments: projectPayments(event.payments) });
  }
  return events;
}

// 积分事件是公开虚拟账，只拷贝座位、金额和原因，不展开未来可能加入的私人听牌诊断。
// Public virtual-ledger events copy seats, amount and reason only, never future private wait diagnostics.
function projectPayments(payments) {
  return payments.map((payment) => ({ from: payment.from, to: payment.to, points: payment.points, reason: payment.reason }));
}

// 所有视图均与权威对象分离；观众/换座者无手牌、换牌内容、听口或动作权限。
// All views are detached; spectators/replacements receive no hands, exchange contents, waits or action authority.
function projectGame(game, seat) {
  assertGameInvariants(game);
  if (PREPARATION_PHASES.includes(game.phase)) {
    return seat === null ? preparation.getSpectatorView(game) : preparation.getPlayerView(game, seat);
  }
  const ownPlayer = seat === null ? null : game.players[seat];
  return {
    ...chengduStateHeader(game),
    revision: game.revision, phase: game.phase, dealerSeat: game.dealerSeat, currentSeat: game.currentSeat,
    turnStep: game.turnStep, mySeat: seat, wallCount: game.wall.length, finishReason: game.finishReason,
    rules: {
      endCondition: game.rules.endCondition, exchangeThree: game.rules.exchangeThree, dingque: true,
      selfDraw: game.rules.selfDraw, fanCap: game.rules.fanCap, playerCount: 4, copiesPerTile: 4,
      ...(isChengduProductionHeader(game) ? chengduProductionVisibility() : {}),
    },
    players: game.players.map((player) => ({
      seat: player.seat, handCount: player.hand.length, score: player.score, dingqueSuit: player.dingqueSuit,
      ...(seat === player.seat ? { hand: [...player.hand] } : {}),
      melds: player.melds.map((meld) => {
        const hidden = meld.type === 'anGang' && seat !== player.seat && !isChengduProductionHeader(game);
        return { type: meld.type, tile: hidden ? null : meld.tile, tiles: meld.tiles.map((tile) => hidden ? null : tile),
          fromSeat: meld.fromSeat, ...(hidden ? { hidden: true } : {}) };
      }),
      won: player.won === null ? null : {
        source: player.won.source, fromSeat: player.won.fromSeat, points: player.won.score.points,
        tile: player.won.source === 'selfDraw' && seat !== player.seat &&
          !(isChengduProductionHeader(game) && game.phase === 'finished') ? null : player.won.tile,
        hidden: player.won.source === 'selfDraw' && seat !== player.seat &&
          !(isChengduProductionHeader(game) && game.phase === 'finished'),
      },
    })),
    discards: game.discards.map((discard) => ({ seat: discard.seat, tile: discard.tile, claimed: discard.claimed, winning: discard.winning })),
    claim: game.claim ? { source: game.claim.source, fromSeat: game.claim.fromSeat, tile: game.claim.tile,
      ...(seat === null ? {} : { hasResponded: Object.hasOwn(game.claim.responses, seat) }) } : null,
    drawnTile: game.lastDraw?.seat === seat ? game.lastDraw.tile : null,
    legalActions: seat === null ? [] : getLegalActions(game, seat),
    waitTiles: !ownPlayer || ownPlayer.won ? [] : getChengduWaitScores(
      ownPlayer.hand, ownPlayer.melds, ownPlayer.dingqueSuit,
      { selfDraw: game.rules.selfDraw, fanCap: game.rules.fanCap },
      { pureSuitStacking: game.playPolicy.pureSuitStacking },
    ).map((wait) => wait.tile),
    history: publicEvents(game, seat),
    settlement: game.drawSettlement ? { status: 'settled', payments: projectPayments(game.drawSettlement.payments) } : null,
  };
}

// 房间层仍须先验证座位凭证，本引擎只按已获准的座位投影，不接管身份服务。
// Room authorization must validate the capability first; this engine projects an authorized seat without owning identities.
export function getPlayerView(game, seat) {
  requireSeat(seat);
  return projectGame(game, seat);
}
export function getSpectatorView(game) {
  return projectGame(game, null);
}
export function getFormerParticipantView(game) {
  return projectGame(game, null);
}

// 用户确认一炮多响由炮家坐庄，否则首胡者坐庄；整局无人胡时原庄不变，不借用花麻将算法。
// Confirmed multi-win discarder becomes dealer, otherwise the first winner; no-win draws keep the dealer without borrowing Flower logic.
export function dealerForNextGame(game) {
  if (!game || game.phase !== 'finished') throw new Error('成都下一局庄家只能在终局确定');
  assertGameInvariants(game);
  const wins = game.history.filter((event) => event.type === 'hu');
  if (!wins.length) return game.dealerSeat;
  const multiWin = wins.find((event) => event.source !== 'selfDraw' &&
    wins.filter((other) => other.batchId === event.batchId).length > 1);
  return multiWin ? multiWin.fromSeat : wins[0].seat;
}
