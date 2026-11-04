/** Pure schema-v2 engine. Scores are virtual; provisional overlaps are explicit rules. */
export const TILE_COUNT = 18;
export const DEFAULT_RULES = Object.freeze({
  sevenPairs: true,
  baseFan: 1,
  dragonPoints: Object.freeze({ 6: 10, 7: 20, 8: 40 }),
  multipleWinners: true,
  radishCountsMelds: true,
  dragonCountsMelds: true,
  radishCountsWinPile: false, // Prior wins count for fan; other overlap is unconfirmed.
  dragonCountsWinPile: false,
  stackDragonBonus: true,
  radishScope: 'own', // Shared-table radishes are not yet confirmed.
  sixPlusCopyFan: 0, // Only exactly four/five copies have confirmed fan bonuses.
  bigSingleOverlap: 'exclusive', // Fixed 50 from each opponent; additive is provisional.
  repeatHuLock: 'untilNaturalDraw',
  allowChangedWaitDuringLock: true,
  preserveWaitsOnPostHuKong: true,
});

const clone = value => JSON.parse(JSON.stringify(value));
const sorted = values => [...values].sort((a, b) => a - b);
const isTile = tile => Number.isInteger(tile) && tile >= 0 && tile < TILE_COUNT;
const label = tile => `${tile % 9 + 1}${tile < 9 ? '条' : '筒'}`;
const countsOf = tiles => {
  const counts = Array(TILE_COUNT).fill(0);
  for (const tile of tiles) counts[tile]++;
  return counts;
};
const meldTiles = player => player.melds.flatMap(meld => meld.tiles);
const sameSet = (a, b) => a.length === b.length && a.every((tile, i) => tile === b[i]);
const removeTile = (hand, tile, count = 1) => {
  for (let i = 0; i < count; i++) {
    const index = hand.indexOf(tile);
    if (index < 0) throw new Error('手牌中没有这张牌');
    hand.splice(index, 1);
  }
};

function normalizeRules(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('规则无效');
  const unknown = Object.keys(input).filter(key => !Object.hasOwn(DEFAULT_RULES, key));
  if (unknown.length) throw new Error(`未知规则：${unknown.join('、')}`);
  if (input.dragonPoints !== undefined && (!input.dragonPoints || typeof input.dragonPoints !== 'object' || Array.isArray(input.dragonPoints))) throw new Error('神龙分值无效');
  const rules = { ...DEFAULT_RULES, ...input, dragonPoints: { ...DEFAULT_RULES.dragonPoints, ...(input.dragonPoints || {}) } };
  for (const key of ['sevenPairs', 'multipleWinners', 'radishCountsMelds', 'dragonCountsMelds', 'radishCountsWinPile', 'dragonCountsWinPile', 'stackDragonBonus', 'allowChangedWaitDuringLock', 'preserveWaitsOnPostHuKong']) {
    if (typeof rules[key] !== 'boolean') throw new Error(`规则 ${key} 必须为布尔值`);
  }
  for (const key of ['baseFan', 'sixPlusCopyFan']) {
    if (!Number.isSafeInteger(rules[key]) || rules[key] < (key === 'baseFan' ? 1 : 0) || rules[key] > 1000) throw new Error('番数规则无效');
  }
  if (!['own', 'all'].includes(rules.radishScope)) throw new Error('萝卜归属规则无效');
  if (!['exclusive', 'additive'].includes(rules.bigSingleOverlap)) throw new Error('大单钓叠加规则无效');
  if (!['untilNaturalDraw', 'untilWaitChange'].includes(rules.repeatHuLock)) throw new Error('重复胡牌锁定规则无效');
  for (const [key, value] of Object.entries(rules.dragonPoints)) {
    if (!['6', '7', '8'].includes(key) || !Number.isSafeInteger(value) || value < 0 || value > 100000) throw new Error('神龙分值无效');
  }
  return rules;
}

function seededRandom(seed) {
  let state = 2166136261;
  for (const char of String(seed)) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state += 0x6D2B79F5;
    let n = state;
    n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

function secureRandom() {
  if (!globalThis.crypto?.getRandomValues) throw new Error('环境不支持安全洗牌');
  const bytes = new Uint32Array(1);
  globalThis.crypto.getRandomValues(bytes);
  return bytes[0] / 4294967296;
}

export function createGame({ seed, rules: inputRules } = {}) {
  const rules = normalizeRules(inputRules);
  const wall = Array.from({ length: 144 }, (_, i) => i % TILE_COUNT);
  const random = seed === undefined ? secureRandom : seededRandom(seed);
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  const players = Array.from({ length: 3 }, (_, seat) => ({
    seat, hand: [], melds: [], winPile: [], radishes: [], score: 0, huCount: 0, kongCount: 0,
    lockedWaits: [], huLockActive: false, pendingKongDiscard: false, lastScoreBreakdown: null,
  }));
  for (let i = 0; i < 13; i++) for (const player of players) player.hand.push(wall.shift());
  const initialTile = wall.shift();
  players[0].hand.push(initialTile);
  for (const player of players) player.hand.sort((a, b) => a - b);
  const game = {
    schemaVersion: 2, phase: 'turn', turnStep: 'discard', currentSeat: 0,
    wall, players, discards: [], retiredTiles: [], history: [], revision: 0,
    rules, claim: null, drawKind: 'normal',
    lastDraw: { seat: 0, tile: initialTile, source: 'initial' }, finishReason: null,
  };
  log(game, { type: 'start', message: '三位牌友已就位，东家先出牌。' });
  assertGameInvariants(game);
  return game;
}

/** Structural win test. Four melds and a pair, optionally seven pairs. */
export function isWinningHand(hand, meldCount = 0, rules = DEFAULT_RULES) {
  if (!Array.isArray(hand) || !hand.every(isTile) || !Number.isInteger(meldCount) || meldCount < 0 || meldCount > 4) return false;
  if (hand.length !== (4 - meldCount) * 3 + 2) return false;
  const counts = countsOf(hand);
  if (counts.some(count => count > 8)) return false;
  if (rules.sevenPairs && meldCount === 0 && counts.every(count => count % 2 === 0)) return true;
  const memo = new Map();
  function meldable() {
    const first = counts.findIndex(count => count > 0);
    if (first < 0) return true;
    const key = counts.join(',');
    if (memo.has(key)) return memo.get(key);
    let success = false;
    if (counts[first] >= 3) {
      counts[first] -= 3;
      success = meldable();
      counts[first] += 3;
    }
    if (!success && first % 9 <= 6 && counts[first + 1] && counts[first + 2]) {
      counts[first]--; counts[first + 1]--; counts[first + 2]--;
      success = meldable();
      counts[first]++; counts[first + 1]++; counts[first + 2]++;
    }
    memo.set(key, success);
    return success;
  }
  for (let tile = 0; tile < TILE_COUNT; tile++) {
    if (counts[tile] < 2) continue;
    counts[tile] -= 2;
    const success = meldable();
    counts[tile] += 2;
    if (success) return true;
  }
  return false;
}

/** Wait sets depend on shape, not the hidden wall or opponents' hands. */
export function getWaitTiles(hand, melds = [], rules = DEFAULT_RULES) {
  if (!Array.isArray(hand) || hand.length !== (4 - melds.length) * 3 + 1) return [];
  const owned = countsOf([...hand, ...melds.flatMap(meld => meld.tiles)]);
  return Array.from({ length: TILE_COUNT }, (_, i) => i).filter(tile => owned[tile] < 8 && isWinningHand([...hand, tile], melds.length, rules));
}

function huWaits(game, seat, tile, fromHand) {
  const player = game.players[seat];
  const base = [...player.hand];
  if (fromHand) removeTile(base, tile);
  if (!isWinningHand(fromHand ? player.hand : [...base, tile], player.melds.length, game.rules)) return null;
  const waits = getWaitTiles(base, player.melds, game.rules);
  if (player.huLockActive && (!game.rules.allowChangedWaitDuringLock || waits.some(wait => player.lockedWaits.includes(wait)))) return null;
  return waits;
}

function beforeDrawHand(game, seat) {
  const hand = [...game.players[seat].hand];
  if (game.lastDraw?.seat === seat) removeTile(hand, game.lastDraw.tile);
  return hand;
}

function canKong(game, seat, type, tile) {
  const player = game.players[seat];
  if (game.wall.length < 2) return false;
  if (!player.huCount || !game.rules.preserveWaitsOnPostHuKong) return true;
  const before = getWaitTiles(beforeDrawHand(game, seat), player.melds, game.rules);
  const hand = [...player.hand];
  const melds = clone(player.melds);
  if (type === 'anGang' || type === 'mingGang') {
    removeTile(hand, tile, type === 'anGang' ? 4 : 3);
    melds.push({ type, tile, tiles: Array(4).fill(tile) });
  } else {
    removeTile(hand, tile);
    const meld = melds.find(item => item.tile === tile && (type === 'buGang' ? item.type === 'peng' : item.type !== 'peng' && item.tiles.length === 4));
    if (!meld) return false;
    meld.tiles.push(tile);
    if (type === 'buGang') meld.type = 'buGang';
  }
  return before.length > 0 && sameSet(before, getWaitTiles(hand, melds, game.rules));
}

function claimOptions(game, seat, discarded) {
  const player = game.players[seat];
  const counts = countsOf(player.hand);
  const canDiscardHu = !game.players[discarded.seat].huCount || discarded.afterKong;
  // When both are possible the decision is hu or pass, never hu versus kong.
  if (canDiscardHu && huWaits(game, seat, discarded.tile, false)) return [{ type: 'hu' }];
  const actions = [];
  if (player.melds.length < 4 && counts[discarded.tile] >= 3 && canKong(game, seat, 'mingGang', discarded.tile)) actions.push({ type: 'mingGang', tile: discarded.tile });
  if (!player.huCount && !game.players[discarded.seat].huCount && player.melds.length < 4 && counts[discarded.tile] >= 2) actions.push({ type: 'peng', tile: discarded.tile });
  return actions;
}

export function getLegalActions(game, seat) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 2 || game.phase === 'finished') return [];
  if (game.phase === 'claim') {
    if (!game.claim?.eligibleSeats.includes(seat) || game.claim.responses[seat]) return [];
    return [...clone(game.claim.options[seat]), { type: 'pass' }];
  }
  if (game.phase !== 'turn' || game.currentSeat !== seat || game.turnStep !== 'discard') return [];
  const player = game.players[seat];
  const drawn = game.lastDraw?.seat === seat ? game.lastDraw.tile : null;
  const actions = (player.huCount ? (drawn === null ? [] : [drawn]) : sorted(new Set(player.hand))).map(tile => ({ type: 'discard', tile }));
  if (drawn !== null && huWaits(game, seat, drawn, true)) {
    actions.push({ type: 'hu' });
  } else {
    const counts = countsOf(player.hand);
    for (let tile = 0; tile < TILE_COUNT; tile++) {
      if (player.melds.length < 4 && counts[tile] >= 4 && canKong(game, seat, 'anGang', tile)) actions.push({ type: 'anGang', tile });
      if (counts[tile] && player.melds.some(meld => meld.type === 'peng' && meld.tile === tile) && canKong(game, seat, 'buGang', tile)) actions.push({ type: 'buGang', tile });
      if (counts[tile] && player.melds.some(meld => meld.type !== 'peng' && meld.tile === tile && meld.tiles.length === 4) && canKong(game, seat, 'addGang', tile)) actions.push({ type: 'addGang', tile });
    }
  }
  if (player.huCount && actions.some(action => action.type === 'hu' || action.type.endsWith('Gang'))) actions.push({ type: 'pass' });
  return actions;
}

/** Private, actionable explanation; reads no other player's concealed tiles. */
export function getHuDiagnostic(game, seat) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 2) throw new Error('座位无效');
  const reply = (code, message, extra = {}) => ({ canHu: code === 'AVAILABLE', code, message, ...extra });
  if (game.phase === 'finished') return reply('FINISHED', game.finishReason === 'allPlayersHu' ? '三家都已胡牌，本局结束。' : '牌墙已用完，本局结束。');
  const player = game.players[seat];
  let tile; let fromHand;
  if (game.phase === 'claim') {
    if (game.claim.discardSeat === seat) return reply('WRONG_TURN', '这是你打出的牌，请等待另外两家回应。');
    if (game.claim.responses[seat]) return reply('ALREADY_RESPONDED', '你已回应，正在等其他有资格的玩家操作。');
    tile = game.claim.tile; fromHand = false;
    const discarded = game.discards[game.claim.discardIndex];
    if (game.players[discarded.seat].huCount && !discarded.afterKong) return reply('PROTECTED_DISCARD', '对方已经胡过；其普通出牌不能接胡，杠后出牌除外。', { tile });
  } else {
    if (game.currentSeat !== seat) return reply('WRONG_TURN', '还没轮到你；有可接胡的弃牌时会提示。');
    if (game.turnStep !== 'discard' || game.lastDraw?.seat !== seat) return reply('WRONG_TURN', '碰牌后需要先出牌，不能直接自摸胡牌。');
    tile = game.lastDraw.tile; fromHand = true;
  }
  const base = [...player.hand];
  if (fromHand) removeTile(base, tile);
  const waitTiles = getWaitTiles(base, player.melds, game.rules);
  const extra = { tile, waitTiles };
  if (!isWinningHand(fromHand ? player.hand : [...player.hand, tile], player.melds.length, game.rules)) {
    return reply('SHAPE', waitTiles.length ? `这张${label(tile)}不在你的听口；可胡${waitTiles.map(label).join('、')}。` : '当前牌形还未凑成四组加一对（或已启用的七对），暂时不能胡。', extra);
  }
  if (!huWaits(game, seat, tile, fromHand)) {
    const message = game.rules.repeatHuLock === 'untilNaturalDraw'
      ? '本次仍命中锁定听口，要等下一次正常轮到你摸牌才可再胡；胡后补摸和杠后补牌不会解锁。'
      : game.rules.allowChangedWaitDuringLock
        ? '本次仍命中锁定听口；按本局设置，需要完全更换原听口后才能再次胡牌。'
        : '本局设置会持续锁定重复胡牌；当前不能再次胡牌。';
    return reply('WAIT_LOCK', message, extra);
  }
  if (game.phase === 'claim' && !game.claim.eligibleSeats.includes(seat)) return reply('NOT_ELIGIBLE', '本次弃牌没有你的可用接牌操作，请等待下一次机会。', extra);
  return reply('AVAILABLE', fromHand ? '这张牌可以自摸胡牌。' : '这张弃牌可以接胡；所有有资格的玩家回应后一起结算。', extra);
}

function log(game, event) { game.history.push({ revision: game.revision, ...event }); }
function finish(game, reason = 'wallExhausted') {
  game.phase = 'finished'; game.turnStep = null; game.claim = null; game.lastDraw = null;
  game.finishReason = reason;
  for (const discarded of game.discards) discarded.claimable = false;
  log(game, { type: 'finish', reason, message: reason === 'allPlayersHu' ? '三家都已胡牌，本局结束，积分已结算。' : '牌墙已摸完，本局结束，积分已结算。' });
}
function startDraw(game, seat, kind = 'normal') {
  game.currentSeat = seat; game.phase = 'turn'; game.turnStep = 'draw';
  game.drawKind = kind; game.lastDraw = null; game.claim = null;
}
function draw(game) {
  if (!game.wall.length) return finish(game);
  const seat = game.currentSeat; const source = game.drawKind;
  const player = game.players[seat];
  if (source === 'normal' && game.rules.repeatHuLock === 'untilNaturalDraw') player.huLockActive = false;
  const tile = game.wall.shift();
  player.hand.push(tile); player.hand.sort((a, b) => a - b);
  game.lastDraw = { seat, tile, source };
  game.phase = 'turn'; game.turnStep = 'discard';
  log(game, { type: 'draw', seat, source, message: `${seat + 1}号位${source === 'replacement' ? '杠后补牌' : source === 'continuation' ? '胡后补摸' : '摸了一张牌'}。` });
}

/** Confirmed fan table: 1,2,4,8,10,12,14,16, then +2 per fan. */
export function fanToPoints(fan) {
  if (!Number.isSafeInteger(fan) || fan < 1) throw new Error('番数无效');
  return fan <= 4 ? 2 ** (fan - 1) : 2 * fan;
}

function scoreHu(game, seat, bigSingle) {
  const player = game.players[seat];
  // The winning tile is now in winPile, not in hand. River references never join these counts.
  const handAndWins = [...player.hand, ...player.winPile.map(item => item.tile)];
  const owned = [...handAndWins, ...meldTiles(player)];
  const copyFanBonus = countsOf(owned).reduce((sum, count) => sum + (count === 4 ? 1 : count === 5 ? 2 : count >= 6 ? game.rules.sixPlusCopyFan : 0), 0);
  const fan = game.rules.baseFan + copyFanBonus;
  const fanPoints = fanToPoints(fan);
  const scoringRadishes = game.rules.radishScope === 'all' ? game.players.flatMap(other => other.radishes) : player.radishes;
  const currentWin = player.winPile.at(-1).tile;
  const currentWinningHand = [...player.hand, currentWin];
  const radishOwned = [...(game.rules.radishCountsWinPile ? handAndWins : currentWinningHand), ...(game.rules.radishCountsMelds ? meldTiles(player) : [])];
  const dragonOwned = [...(game.rules.dragonCountsWinPile ? handAndWins : currentWinningHand), ...(game.rules.dragonCountsMelds ? meldTiles(player) : [])];
  const matchCounts = countsOf(radishOwned);
  const radishCounts = countsOf(scoringRadishes);
  const allCounts = countsOf([...dragonOwned, ...scoringRadishes]);
  const radishBonus = matchCounts.reduce((sum, count, tile) => sum + count * radishCounts[tile], 0);
  // Retain the earlier dragon rule separately, including its 8+ cap. It does not add fan.
  const dragonBonus = allCounts.reduce((sum, count) => sum + (count >= 6 ? game.rules.dragonPoints[Math.min(8, count)] : 0), 0);
  const ordinary = fanPoints + radishBonus;
  const combined = game.rules.stackDragonBonus ? ordinary + dragonBonus : Math.max(ordinary, dragonBonus);
  const bigSinglePoints = bigSingle ? 50 : 0;
  const total = bigSingle ? (game.rules.bigSingleOverlap === 'exclusive' ? 50 : combined + 50) : combined;
  return { base: game.rules.baseFan, fan, fanPoints, copyFanBonus, radishBonus, dragonBonus, bigSingle, bigSinglePoints, overlapPolicy: game.rules.bigSingleOverlap, total };
}
function transfer(game, seat, payerSeats, amount) {
  const payments = payerSeats.map(payer => ({ seat: payer, delta: -amount }));
  payments.push({ seat, delta: amount * payerSeats.length });
  for (const payment of payments) game.players[payment.seat].score += payment.delta;
  return payments;
}

/** Prepare every simultaneous winner before scoring or deciding that the hand is over. */
function awardHuBatch(game, winners, tile, source, fromSeat = null, discardIndex = null) {
  const selfDraw = source === 'selfDraw';
  const prepared = winners.map((seat, index) => {
    const player = game.players[seat];
    const waits = huWaits(game, seat, tile, selfDraw);
    if (!waits) throw new Error('当前不能胡牌');
    const bigSingle = player.hand.length - (selfDraw ? 1 : 0) === 1;
    const newRadishes = [];
    if (player.huCount === 0) {
      for (let i = 0; i < 6 && game.wall.length; i++) newRadishes.push(game.wall.pop());
      player.radishes.push(...newRadishes);
    }
    if (selfDraw) {
      removeTile(player.hand, tile);
      game.retiredTiles.push({ seat, tile });
    }
    player.winPile.push({ tile, source, virtual: !selfDraw && index > 0, ...(discardIndex === null ? {} : { discardIndex }) });
    player.huCount++; player.lockedWaits = waits; player.huLockActive = true;
    return { seat, newRadishes, bigSingle };
  });
  for (const { seat, newRadishes, bigSingle } of prepared) {
    const score = scoreHu(game, seat, bigSingle);
    const payerSeats = source === 'discard' && !bigSingle ? [fromSeat] : [0, 1, 2].filter(other => other !== seat);
    const payments = transfer(game, seat, payerSeats, score.total);
    game.players[seat].lastScoreBreakdown = clone(score);
    const sourceLabel = bigSingle ? '大单钓' : selfDraw ? '自摸' : source === 'kongDiscard' ? '杠后接炮（按自摸）' : '接炮';
    log(game, { type: 'hu', seat, tile, source, fromSeat, points: score.total, score, payments, newRadishes,
      message: `${seat + 1}号位${sourceLabel}${label(tile)}，${payerSeats.length === 1 ? '出牌方' : '另外两家各'}付${score.total}分，本次收入${score.total * payerSeats.length}分${newRadishes.length ? `，翻出${newRadishes.length}张萝卜` : ''}。` });
  }
}
function continueAfterHu(game, seat) {
  if (game.players.every(player => player.huCount > 0)) finish(game, 'allPlayersHu');
  else startDraw(game, seat, 'continuation');
}

function kong(game, seat, type, tile, fromSeat = null) {
  const player = game.players[seat];
  let concealed = type === 'anGang';
  if (type === 'buGang' || type === 'addGang') {
    removeTile(player.hand, tile);
    const meld = player.melds.find(item => item.tile === tile && (type === 'buGang' ? item.type === 'peng' : item.type !== 'peng' && item.tiles.length === 4));
    concealed = meld.type === 'anGang';
    if (type === 'buGang') meld.type = 'buGang';
    meld.tiles.push(tile);
    if (type === 'addGang') meld.extended = true;
  } else {
    removeTile(player.hand, tile, type === 'mingGang' ? 3 : 4);
    player.melds.push({ type, tile, tiles: Array(4).fill(tile), ...(fromSeat === null ? {} : { fromSeat }) });
  }
  const amount = type === 'anGang' || type === 'mingGang' ? 2 : 1;
  const payerSeats = type === 'mingGang' ? [fromSeat] : [0, 1, 2].filter(other => other !== seat);
  const payments = transfer(game, seat, payerSeats, amount);
  const radish = game.wall.pop();
  player.radishes.push(radish); player.kongCount++; player.pendingKongDiscard = true;
  game.claim = null; game.lastDraw = null;
  log(game, { type, seat, ...(concealed ? {} : { tile }), fromSeat, radish, points: amount, payments,
    message: `${seat + 1}号位${{ anGang: '暗杠', buGang: '补杠', mingGang: '明杠', addGang: '加杠至五张' }[type]}，${payerSeats.length === 1 ? '出牌方' : '另外两家各'}付${amount}分，翻出萝卜${label(radish)}。` });
  startDraw(game, seat, 'replacement');
}

function resolveClaims(game) {
  const claim = game.claim;
  if (!claim.eligibleSeats.every(seat => claim.responses[seat])) return;
  const discarded = game.discards[claim.discardIndex];
  discarded.claimable = false;
  const order = [1, 2].map(offset => (discarded.seat + offset) % 3);
  let winners = order.filter(seat => claim.responses[seat]?.type === 'hu');
  if (!game.rules.multipleWinners) winners = winners.slice(0, 1);
  if (winners.length) {
    discarded.huSeats = winners;
    awardHuBatch(game, winners, discarded.tile, discarded.afterKong ? 'kongDiscard' : 'discard', discarded.seat, claim.discardIndex);
    continueAfterHu(game, winners[0]);
    return;
  }
  // Wait for everyone first; kong outranks peng, equal claims use clockwise proximity.
  const caller = order.find(seat => claim.responses[seat]?.type === 'mingGang') ?? order.find(seat => claim.responses[seat]?.type === 'peng');
  if (caller === undefined) return startDraw(game, (discarded.seat + 1) % 3);
  const type = claim.responses[caller].type;
  discarded.claimedBy = caller; discarded.claimedAs = type;
  if (type === 'mingGang') kong(game, caller, type, discarded.tile, discarded.seat);
  else {
    const player = game.players[caller];
    removeTile(player.hand, discarded.tile, 2);
    player.melds.push({ type: 'peng', tile: discarded.tile, tiles: Array(3).fill(discarded.tile), fromSeat: discarded.seat });
    game.phase = 'turn'; game.currentSeat = caller; game.turnStep = 'discard'; game.lastDraw = null; game.claim = null;
    log(game, { type: 'peng', seat: caller, tile: discarded.tile, message: `${caller + 1}号位碰${label(discarded.tile)}，请出牌。` });
  }
}

function discard(game, seat, tile, automatic = false) {
  const player = game.players[seat];
  removeTile(player.hand, tile);
  const discarded = { seat, tile, claimable: false, afterKong: player.pendingKongDiscard };
  player.pendingKongDiscard = false;
  game.discards.push(discarded); game.lastDraw = null;
  log(game, { type: 'discard', seat, tile, automatic, afterKong: discarded.afterKong,
    message: `${seat + 1}号位${automatic ? '摸后自动打出' : '打出'}${label(tile)}${discarded.afterKong ? '（杠后出牌，可按自摸接胡）' : ''}。` });
  const options = {};
  for (const other of [0, 1, 2].filter(other => other !== seat)) {
    const available = claimOptions(game, other, discarded);
    if (available.length) options[other] = available;
  }
  const eligibleSeats = Object.keys(options).map(Number);
  if (eligibleSeats.length) {
    discarded.claimable = true; game.phase = 'claim'; game.turnStep = null;
    game.claim = { discardIndex: game.discards.length - 1, discardSeat: seat, tile, eligibleSeats, options, responses: {} };
  } else startDraw(game, (seat + 1) % 3);
}

/** No timing race or user draw action: stop only at a real player decision. */
function settleAutomatic(game) {
  // Each two automatic transitions consume at least one of the 144 physical tiles.
  for (let transitions = 0; transitions < 300; transitions++) {
    if (game.phase !== 'turn') return;
    if (game.turnStep === 'draw') { draw(game); continue; }
    const seat = game.currentSeat; const player = game.players[seat];
    if (!player.huCount) return;
    if (getLegalActions(game, seat).some(action => action.type === 'hu' || action.type.endsWith('Gang'))) return;
    if (game.lastDraw?.seat !== seat) throw new Error('胡后缺少摸牌记录');
    discard(game, seat, game.lastDraw.tile, true);
  }
  throw new Error('自动轮转超出牌墙上限');
}

export function applyAction(game, seat, action) {
  if (game.schemaVersion !== 2) throw new Error('旧牌局需要使用原版本规则');
  if (!action || typeof action !== 'object' || Array.isArray(action) || typeof action.type !== 'string') throw new Error('操作格式无效');
  if (Object.keys(action).some(key => !['type', 'tile'].includes(key))) throw new Error('操作包含未知字段');
  const matched = getLegalActions(game, seat).find(legal => legal.type === action.type && legal.tile === action.tile);
  if (!matched) throw new Error('当前不能执行这项操作，请刷新牌桌');
  const next = clone(game);
  next.revision++;
  if (next.phase === 'claim') {
    next.claim.responses[seat] = clone(matched);
    resolveClaims(next);
  } else if (action.type === 'discard' || action.type === 'pass') {
    discard(next, seat, action.type === 'pass' ? next.lastDraw.tile : action.tile);
  } else if (action.type === 'hu') {
    awardHuBatch(next, [seat], next.lastDraw.tile, 'selfDraw');
    continueAfterHu(next, seat);
  } else if (['anGang', 'buGang', 'addGang'].includes(action.type)) kong(next, seat, action.type, action.tile);
  settleAutomatic(next);
  assertGameInvariants(next);
  return next;
}

export function getPlayerView(game, seat) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 2) throw new Error('座位无效');
  const me = game.players[seat];
  return {
    schemaVersion: 2, phase: game.phase, turnStep: game.turnStep, currentSeat: game.currentSeat,
    wallCount: game.wall.length, revision: game.revision, rules: clone(game.rules), mySeat: seat,
    players: game.players.map((player, index) => ({
      seat: index, ...(index === seat ? { hand: [...player.hand] } : {}), handCount: player.hand.length,
      melds: player.melds.map(meld => meld.type === 'anGang' && index !== seat
        ? { type: 'anGang', tile: null, tiles: Array(meld.tiles.length).fill(null), hidden: true, ...(meld.extended ? { extended: true } : {}) }
        : clone(meld)),
      winPile: clone(player.winPile), radishes: [...player.radishes], score: player.score, huCount: player.huCount,
      kongCount: player.kongCount, lastScoreBreakdown: clone(player.lastScoreBreakdown),
    })),
    discards: clone(game.discards), retiredTiles: clone(game.retiredTiles), history: clone(game.history),
    claim: game.claim ? { discardSeat: game.claim.discardSeat, tile: game.claim.tile,
      eligibleSeats: [...game.claim.eligibleSeats], respondedSeats: Object.keys(game.claim.responses).map(Number) } : null,
    legalActions: getLegalActions(game, seat), huDiagnostic: getHuDiagnostic(game, seat), scoreBreakdown: clone(me.lastScoreBreakdown),
    waitTiles: getWaitTiles(beforeDrawHand(game, seat), me.melds, game.rules),
    lockedWaits: [...me.lockedWaits], huLockActive: me.huLockActive,
    drawnTile: game.lastDraw?.seat === seat ? game.lastDraw.tile : null, finishReason: game.finishReason,
  };
}

/** Logical win piles reference existing physical tiles, and are never extra physical copies. */
export function assertGameInvariants(game) {
  const tiles = [...game.wall, ...game.retiredTiles.map(item => item.tile),
    ...game.discards.filter(item => item.claimedBy === undefined).map(item => item.tile),
    ...game.players.flatMap(player => [...player.hand, ...meldTiles(player), ...player.radishes])];
  if (tiles.length !== 144 || !tiles.every(isTile) || countsOf(tiles).some(count => count !== 8)) throw new Error('牌张守恒检查失败');
  if (game.players.length !== 3 || game.players.reduce((sum, player) => sum + player.score, 0) !== 0) throw new Error('积分守恒检查失败');
  for (const player of game.players) {
    if (!Number.isSafeInteger(player.score) || player.melds.length > 4 || !Number.isSafeInteger(player.huCount) || player.huCount < 0) throw new Error('玩家状态无效');
    for (const meld of player.melds) {
      if (!['peng', 'mingGang', 'anGang', 'buGang'].includes(meld.type) || !isTile(meld.tile) || !meld.tiles.every(tile => tile === meld.tile)
        || (meld.type === 'peng' ? meld.tiles.length !== 3 : ![4, 5].includes(meld.tiles.length))) throw new Error('副露状态无效');
    }
    for (const win of player.winPile) {
      if (!isTile(win.tile) || !['selfDraw', 'discard', 'kongDiscard'].includes(win.source) || typeof win.virtual !== 'boolean') throw new Error('胡牌堆状态无效');
      if (win.source !== 'selfDraw' && (!Number.isInteger(win.discardIndex) || game.discards[win.discardIndex]?.tile !== win.tile)) throw new Error('胡牌引用无效');
      if (win.source === 'selfDraw' && win.virtual) throw new Error('自摸不能是虚拟牌');
    }
    const base = (4 - player.melds.length) * 3 + 1;
    const extra = game.phase === 'turn' && game.turnStep === 'discard' && game.currentSeat === player.seat ? 1 : 0;
    if (player.hand.length !== base + extra) throw new Error(`手牌数量检查失败：${player.seat}`);
  }
  return true;
}
