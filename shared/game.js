/** Pure schema-v3 engine. Scores are virtual; provisional overlaps are explicit rules. */
export const TILE_COUNT = 18;
export const DEFAULT_RULES = Object.freeze({
  sevenPairs: true,
  autoDiscardAfterHu: true, // Chosen at game start; missing flags keep saved games automatic.
  bigSingleReadyPayment: true, // New games only: one ready-state payment, never retroactive.
  specialHuPatterns: true, // New games only; saved games without this flag retain their original scoring.
  baseFan: 1,
  dragonPoints: Object.freeze({ 6: 10, 7: 20, 8: 40 }),
  multipleWinners: true,
  finalHuPaymentExceptions: true, // Final first win: selfdraw pays both; post-hu kong discard pays its source only.
  selfDrawOnlyUnwon: true, // Ordinary self-draw excludes already-won opponents; kong replacement keeps its separate rule.
  radishCountsMelds: true,
  dragonCountsMelds: true,
  radishCountsWinPile: true, // Confirmed: all personal win records, melds and hand match the shared pool.
  dragonCountsWinPile: true, // All logical wins, including shared-discard virtual references.
  dragonCountsSharedRadishes: true, // Confirmed fourth zone for final dragon settlement.
  stackDragonBonus: true,
  radishScope: 'all', // Physical flip provenance stays per seat; scoring uses one table-wide pool.
  sixCopyFan: 3, // Exactly six identical tiles add three fan.
  sevenPlusCopyFan: 0, // Preserve the saved fallback only for unconfirmed logical counts above eight.
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
const canExtendKong = meld => meld.type !== 'peng' && meld.tiles.length >= 4 && meld.tiles.length < 8;
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
  for (const key of ['sevenPairs', 'autoDiscardAfterHu', 'bigSingleReadyPayment', 'specialHuPatterns', 'multipleWinners', 'finalHuPaymentExceptions', 'selfDrawOnlyUnwon', 'radishCountsMelds', 'dragonCountsMelds', 'radishCountsWinPile', 'dragonCountsWinPile', 'dragonCountsSharedRadishes', 'stackDragonBonus', 'allowChangedWaitDuringLock', 'preserveWaitsOnPostHuKong']) {
    if (typeof rules[key] !== 'boolean') throw new Error(`规则 ${key} 必须为布尔值`);
  }
  for (const key of ['baseFan', 'sixCopyFan', 'sevenPlusCopyFan']) {
    if (!Number.isSafeInteger(rules[key]) || rules[key] < (key === 'baseFan' ? 1 : 0) || rules[key] > 1000) throw new Error('番数规则无效');
  }
  if (rules.radishScope !== 'all') throw new Error('萝卜归属规则无效');
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

export function dealerForNextGame(previousGame) {
  const valid = seat => Number.isInteger(seat) && seat >= 0 && seat <= 2;
  const firstHu = Array.isArray(previousGame?.history) ? previousGame.history.find(event => event?.type === 'hu' && valid(event.seat)) : null;
  return firstHu ? firstHu.seat : 0;
}

export function createGame({ seed, rules: inputRules, dealerSeat = 0 } = {}) {
  if (!Number.isInteger(dealerSeat) || dealerSeat < 0 || dealerSeat > 2) throw new Error('庄家座位无效');
  const rules = normalizeRules(inputRules);
  const wall = Array.from({ length: 144 }, (_, i) => i % TILE_COUNT);
  const random = seed === undefined ? secureRandom : seededRandom(seed);
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  const players = Array.from({ length: 3 }, (_, seat) => ({
    seat, hand: [], melds: [], winPile: [], radishes: [], score: 0, huCount: 0, kongCount: 0,
    bigSingleReadyPaid: false,
    lockedWaits: [], huLockActive: false, pendingKongDiscard: false, lastScoreBreakdown: null, firstHuPattern: null,
  }));
  for (let i = 0; i < 13; i++) for (const player of players) player.hand.push(wall.shift());
  const initialTile = wall.shift();
  players[dealerSeat].hand.push(initialTile);
  for (const player of players) player.hand.sort((a, b) => a - b);
  const game = {
    schemaVersion: 3, phase: 'turn', turnStep: 'discard', currentSeat: dealerSeat, dealerSeat,
    wall, players, discards: [], retiredTiles: [], history: [], revision: 0,
    rules, claim: null, drawKind: 'normal', firstHuRadishesRevealed: false, pendingKongRadishes: 0,
    dragonSettlement: { settled: false, entries: [] },
    lastDraw: { seat: dealerSeat, tile: initialTile, source: 'initial' }, finishReason: null,
  };
  log(game, { type: 'start', seat: dealerSeat, message: `三位牌友已就位，${dealerSeat + 1}号位坐庄，庄家先出牌。` });
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

/** Pattern metadata is captured from a complete first winning shape, never from accumulated wins. */
function classifyHuPattern(hand, melds, rules) {
  const counts = countsOf(hand);
  const allTiles = [...hand, ...melds.flatMap(meld => meld.tiles)];
  const pureSuit = allTiles.length > 0 && allTiles.every(tile => (tile < 9) === (allTiles[0] < 9));
  const bigSingle = melds.length === 4 && hand.length === 2;
  const isSevenPairs = rules.sevenPairs && melds.length === 0 && hand.length === 14 && counts.every(count => count % 2 === 0);
  // Freeze the confirmed formula using the complete first win: base three, then n - 3 for each group of four or more.
  const sevenPairsFan = 3 + counts.reduce((sum, count) => sum + (count >= 4 ? count - 3 : 0), 0);
  const allTriplets = !bigSingle && counts.some((count, pair) => count >= 2
    && counts.every((copies, tile) => (copies - (tile === pair ? 2 : 0)) % 3 === 0));
  const kind = isSevenPairs ? 'sevenPairs' : bigSingle ? 'bigSingle' : 'standard';
  return {
    kind, pureSuit, allTriplets,
    waitTiles: kind === 'standard' ? [] : sorted(new Set(allTiles)),
    fixedFan: isSevenPairs ? sevenPairsFan + (pureSuit ? 2 : 0) : null,
    ...(isSevenPairs ? { sevenPairsFan } : {}),
  };
}

/** Expanded post-win waits use only this player's saved shape and own/public tile zones. */
function contextualWaitTiles(game, player, hand, melds = player.melds) {
  const pattern = game.rules.specialHuPatterns === true && player.huCount > 0 ? player.firstHuPattern : null;
  if (!pattern || !['sevenPairs', 'bigSingle'].includes(pattern.kind)) return getWaitTiles(hand, melds, game.rules);
  if (hand.length !== (4 - melds.length) * 3 + 1) return [];
  const owned = countsOf([...hand, ...melds.flatMap(meld => meld.tiles), ...player.winPile.map(win => win.tile)]);
  return pattern.waitTiles.filter(tile => owned[tile] < 8);
}

function huWaits(game, seat, tile, fromHand, kongDiscard = false) {
  const player = game.players[seat];
  const base = [...player.hand];
  if (fromHand) removeTile(base, tile);
  const waits = contextualWaitTiles(game, player, base);
  if (!waits.includes(tile)) return null;
  // Winning once does not block a later legal discard win before a natural draw.
  // Legacy lock fields remain readable for saved-state compatibility only; source
  // protection (ordinary discards by an already-won player) stays in claimOptions.
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
  const before = contextualWaitTiles(game, player, beforeDrawHand(game, seat));
  const hand = [...player.hand];
  const melds = clone(player.melds);
  if (type === 'anGang' || type === 'mingGang') {
    removeTile(hand, tile, type === 'anGang' ? 4 : 3);
    melds.push({ type, tile, tiles: Array(4).fill(tile) });
  } else {
    removeTile(hand, tile);
    const meld = melds.find(item => item.tile === tile && (type === 'buGang' ? item.type === 'peng' : canExtendKong(item)));
    if (!meld) return false;
    meld.tiles.push(tile);
    if (type === 'buGang') meld.type = 'buGang';
  }
  return before.length > 0 && sameSet(before, contextualWaitTiles(game, player, hand, melds));
}

function claimOptions(game, seat, discarded) {
  const player = game.players[seat];
  const counts = countsOf(player.hand);
  const sourceHasHu = game.players[discarded.seat].huCount > 0;
  const canHu = (!sourceHasHu || discarded.afterKong) && huWaits(game, seat, discarded.tile, false, discarded.afterKong === true);
  // A post-hu source is protected from both peng and mingGang, even after its kong.
  if (sourceHasHu) return canHu ? [{ type: 'hu' }] : [];
  const canGang = player.melds.length < 4 && counts[discarded.tile] >= 3 && canKong(game, seat, 'mingGang', discarded.tile);
  const canPeng = !player.huCount && player.melds.length < 4 && counts[discarded.tile] >= 2;
  // Hu + legal kong remains hu/pass. Hu + peng without kong offers both choices.
  if (canHu && canGang) return [{ type: 'hu' }];
  const actions = canHu ? [{ type: 'hu' }] : [];
  if (canGang) actions.push({ type: 'mingGang', tile: discarded.tile });
  if (canPeng) actions.push({ type: 'peng', tile: discarded.tile });
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
      if (counts[tile] && player.melds.some(meld => meld.tile === tile && canExtendKong(meld)) && canKong(game, seat, 'addGang', tile)) actions.push({ type: 'addGang', tile });
    }
  }
  // Once the hand is locked after hu, a legal kong is mandatory when no hu is available.
  // Filtering discard as well as pass prevents older clients from bypassing the choice.
  if (player.huCount && !actions.some(action => action.type === 'hu') && actions.some(action => action.type.endsWith('Gang'))) return actions.filter(action => action.type.endsWith('Gang'));
  // Manual mode is a server-side decision, not a client timer. Only pass may
  // release the drawn tile; an old/forged discard must not skip that confirmation.
  if (player.huCount && drawn !== null && game.rules.autoDiscardAfterHu === false) return [...actions.filter(action => action.type !== 'discard'), { type: 'pass' }];
  if (player.huCount && actions.some(action => action.type === 'hu')) actions.push({ type: 'pass' });
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
    if (game.players[discarded.seat].huCount && !discarded.afterKong && !discarded.robKong) return reply('PROTECTED_DISCARD', '对方已经胡过；其普通出牌不能接胡，杠后出牌除外。', { tile });
  } else {
    if (game.currentSeat !== seat) return reply('WRONG_TURN', '还没轮到你；有可接胡的弃牌时会提示。');
    if (game.turnStep !== 'discard' || game.lastDraw?.seat !== seat) return reply('WRONG_TURN', '碰牌后需要先出牌，不能直接自摸胡牌。');
    tile = game.lastDraw.tile; fromHand = true;
  }
  const base = [...player.hand];
  if (fromHand) removeTile(base, tile);
  const waitTiles = contextualWaitTiles(game, player, base);
  const extra = { tile, waitTiles };
  if (!waitTiles.includes(tile)) {
    return reply('SHAPE', waitTiles.length ? `这张${label(tile)}不在你的听口；可胡${waitTiles.map(label).join('、')}。` : '当前牌形还未凑成四组加一对（或已启用的七对），暂时不能胡。', extra);
  }
  if (game.phase === 'claim' && !game.claim.eligibleSeats.includes(seat)) return reply('NOT_ELIGIBLE', '本次弃牌没有你的可用接牌操作，请等待下一次机会。', extra);
  return reply('AVAILABLE', game.claim?.kind === 'robKong' ? '这张补杠牌可以抢杠胡；只有胡或过，所有回应后一起结算。' : fromHand ? '这张牌可以自摸胡牌。' : '这张弃牌可以接胡；所有有资格的玩家回应后一起结算。', extra);
}

function log(game, event) { game.history.push({ revision: game.revision, ...event }); }
function finish(game, reason = 'wallExhausted') {
  if (game.phase === 'finished') return;
  game.phase = 'finished'; game.turnStep = null; game.claim = null; game.lastDraw = null;
  game.finishReason = reason;
  for (const discarded of game.discards) discarded.claimable = false;
  settleDragons(game);
  log(game, { type: 'finish', reason, message: reason === 'allPlayersHu' ? '三家都已胡牌，本局结束，积分已结算。' : '牌墙已摸完，本局结束，积分已结算。' });
}
function startDraw(game, seat, kind = 'normal') {
  game.currentSeat = seat; game.phase = 'turn'; game.turnStep = 'draw';
  game.drawKind = kind; game.lastDraw = null; game.claim = null;
}
function kongSourceFromEvent(event, seat) {
  if (event?.seat !== seat || !['mingGang', 'anGang', 'buGang', 'addGang'].includes(event.type)) return null;
  if (event.type === 'mingGang'
    ? !Number.isInteger(event.fromSeat) || event.fromSeat < 0 || event.fromSeat > 2 || event.fromSeat === seat
    : event.fromSeat !== null) return null;
  return { type: event.type, fromSeat: event.fromSeat };
}

function replacementKongSource(game, seat) {
  const draw = game.lastDraw;
  if (draw?.seat !== seat || draw.source !== 'replacement') return null;
  if (Object.hasOwn(draw, 'kongSource')) return kongSourceFromEvent({ ...draw.kongSource, seat }, seat);
  // Older schema-3 saves did not retain provenance. Only the adjacent, matching
  // kong/draw pair proves which kong caused this draw; never reuse an older kong.
  const drawn = game.history.at(-1), kong = game.history.at(-2);
  if (drawn?.type !== 'draw' || drawn.seat !== seat || drawn.source !== 'replacement'
    || !Number.isSafeInteger(drawn.revision) || drawn.revision < 0 || kong?.revision !== drawn.revision) return null;
  return kongSourceFromEvent(kong, seat);
}

function draw(game) {
  if (!game.wall.length) return finish(game);
  const seat = game.currentSeat; const source = game.drawKind;
  const player = game.players[seat];
  if (source === 'normal' && game.rules.repeatHuLock === 'untilNaturalDraw') player.huLockActive = false;
  const tile = game.wall.shift();
  player.hand.push(tile); player.hand.sort((a, b) => a - b);
  const latest = game.history.at(-1);
  const kongSource = source === 'replacement' && latest?.revision === game.revision ? kongSourceFromEvent(latest, seat) : null;
  game.lastDraw = { seat, tile, source, ...(kongSource ? { kongSource } : {}) };
  game.phase = 'turn'; game.turnStep = 'discard';
  log(game, { type: 'draw', seat, source, message: `${seat + 1}号位${source === 'replacement' ? '杠后补牌' : source === 'continuation' ? '胡后补摸' : '摸了一张牌'}。` });
}

/** Confirmed fan table: 1,2,4,8,10,12,14,16, then +2 per fan. */
export function fanToPoints(fan) {
  if (!Number.isSafeInteger(fan) || fan < 1) throw new Error('番数无效');
  return fan <= 4 ? 2 ** (fan - 1) : 2 * fan;
}

function scoreHu(game, seat, bigSingle, pattern, robKongBonus = 0) {
  const player = game.players[seat];
  // The winning tile is now in winPile, not in hand. River references never join these counts.
  const handAndWins = [...player.hand, ...player.winPile.map(item => item.tile)];
  const owned = [...handAndWins, ...meldTiles(player)];
  const rawCopyFanBonus = countsOf(owned).reduce((sum, count) => sum + (count === 4 ? 1 : count === 5 ? 2 : count === 6 ? game.rules.sixCopyFan : count === 7 ? 4 : count === 8 ? 5 : count > 8 ? game.rules.sevenPlusCopyFan : 0), 0);
  const special = game.rules.specialHuPatterns === true;
  // The first qualifying seven-pairs win freezes its full tier, including an existing pure suit.
  const sevenPairsFixed = special && pattern?.kind === 'sevenPairs';
  const copyFanBonus = sevenPairsFixed ? 0 : rawCopyFanBonus;
  const patternBonuses = [];
  if (sevenPairsFixed) {
    patternBonuses.push({ type: 'sevenPairs', fan: pattern.sevenPairsFan });
    if (pattern.pureSuit) patternBonuses.push({ type: 'pureSuit', fan: 2 });
  } else if (special) {
    if (bigSingle) patternBonuses.push({ type: 'bigSingle', fan: 2 });
    else if (pattern?.allTriplets) patternBonuses.push({ type: 'allTriplets', fan: 2 });
    if (pattern?.pureSuit) patternBonuses.push({ type: 'pureSuit', fan: 2 });
  }
  const fan = (sevenPairsFixed ? pattern.fixedFan : game.rules.baseFan + copyFanBonus + patternBonuses.reduce((sum, item) => sum + item.fan, 0)) + robKongBonus;
  if (robKongBonus) patternBonuses.push({ type: 'robKong', fan: robKongBonus });
  const fanPoints = fanToPoints(fan);
  const scoringRadishes = game.players.flatMap(other => other.radishes);
  const currentWin = player.winPile.at(-1).tile;
  const currentWinningHand = [...player.hand, currentWin];
  const radishOwned = [...(game.rules.radishCountsWinPile ? handAndWins : currentWinningHand), ...(game.rules.radishCountsMelds ? meldTiles(player) : [])];
  const matchCounts = countsOf(radishOwned);
  const radishCounts = countsOf(scoringRadishes);
  const radishBonus = matchCounts.reduce((sum, count, tile) => sum + count * radishCounts[tile], 0);
  // Dragons settle once at game end, never on an individual hu.
  const dragonBonus = 0;
  const combined = fanPoints + radishBonus;
  const bigSinglePoints = bigSingle && !special ? 50 : 0;
  const total = bigSingle && !special ? (game.rules.bigSingleOverlap === 'exclusive' ? 50 : combined + 50) : combined;
  return { base: game.rules.baseFan, fan, fanPoints, copyFanBonus, radishBonus, dragonBonus, bigSingle, bigSinglePoints,
    ...(robKongBonus ? { robKongBonus } : {}),
    overlapPolicy: special ? 'fan' : game.rules.bigSingleOverlap, total,
    ...(special ? { patternBonuses, sevenPairsFixed, specialHuPattern: pattern?.kind === 'standard' ? null : pattern?.kind ?? null } : {}) };
}
function transfer(game, seat, payerSeats, amount) {
  const payments = payerSeats.map(payer => ({ seat: payer, delta: -amount }));
  payments.push({ seat, delta: amount * payerSeats.length });
  for (const payment of payments) game.players[payment.seat].score += payment.delta;
  return payments;
}

/** Award only an actual stable ready shape, never a speculative claim or a read. */
function awardBigSingleReady(game, seat) {
  const player = game.players[seat];
  if (game.rules.bigSingleReadyPayment !== true || game.rules.specialHuPatterns !== true || player.bigSingleReadyPaid === true
    || player.melds.length !== 4 || player.hand.length !== 1
    || getWaitTiles(player.hand, player.melds, game.rules).length === 0) return;
  player.bigSingleReadyPaid = true;
  const payments = transfer(game, seat, [0, 1, 2].filter(other => other !== seat), 50);
  log(game, { type: 'bigSingleReady', seat, points: 50, payments,
    message: `${seat + 1}号位大单吊听牌，另外两家各付50分，本局仅收取一次，后续胡牌分另算。` });
}

/** End-of-game transfers are independently guarded so serialization/retries cannot re-charge them. */
function settleDragons(game) {
  if (game.dragonSettlement.settled) return;
  const sharedRadishes = game.players.flatMap(player => player.radishes);
  const entries = game.players.map(player => {
    const owned = [...player.hand,
      ...(game.rules.dragonCountsMelds ? meldTiles(player) : []),
      ...(game.rules.dragonCountsWinPile ? player.winPile.map(win => win.tile) : []),
      ...(game.rules.dragonCountsSharedRadishes ? sharedRadishes : [])];
    const dragons = countsOf(owned).flatMap((count, tile) => count >= 6
      ? [{ tile, count, points: game.rules.dragonPoints[Math.min(8, count)] }] : []);
    return { seat: player.seat, dragons, points: dragons.reduce((sum, dragon) => sum + dragon.points, 0) };
  }).filter(entry => entry.dragons.length);
  game.dragonSettlement = { settled: true, entries: [] };
  for (const entry of entries) {
    const payments = transfer(game, entry.seat, [0, 1, 2].filter(seat => seat !== entry.seat), entry.points);
    const settled = { ...entry, payments };
    game.dragonSettlement.entries.push(settled);
    log(game, { type: 'dragonSettlement', ...clone(settled),
      message: `${entry.seat + 1}号位终局神龙结算：${entry.dragons.map(dragon => `${label(dragon.tile)}${dragon.count}张`).join('、')}，另外两家各付${entry.points}分。` });
  }
}

/** Prepare every simultaneous winner before scoring or deciding that the hand is over. */
function awardHuBatch(game, winners, tile, source, fromSeat = null, discardIndex = null) {
  const selfDraw = source === 'selfDraw';
  const replacementKong = selfDraw ? replacementKongSource(game, winners[0]) : null;
  // Snapshot before the simultaneous batch. Only the specifically confirmed repeat-selfdraw case changes.
  const priorHuSeats = game.players.filter(player => player.huCount > 0).map(player => player.seat);
  const prepared = winners.map((seat, index) => {
    const player = game.players[seat];
    const waits = huWaits(game, seat, tile, selfDraw, source === 'kongDiscard' || source === 'robKong');
    if (!waits) throw new Error('当前不能胡牌');
    const bigSingle = player.hand.length - (selfDraw ? 1 : 0) === 1;
    const wasRepeat = player.huCount > 0;
    const winningHand = selfDraw ? [...player.hand] : [...player.hand, tile];
    let pattern = null;
    const repeatedSpecial = wasRepeat && ['sevenPairs', 'bigSingle'].includes(player.firstHuPattern?.kind);
    if (game.rules.specialHuPatterns === true) {
      pattern = repeatedSpecial ? player.firstHuPattern : classifyHuPattern(winningHand, player.melds, game.rules);
      // A standard first win can later become the player's first qualifying special win.
      if (!player.firstHuPattern || (!repeatedSpecial && pattern.kind !== 'standard')) player.firstHuPattern = clone(pattern);
    }
    const newRadishes = [];
    if (!game.firstHuRadishesRevealed) {
      game.firstHuRadishesRevealed = true;
      // Missing field means an older save whose kong radishes were already revealed.
      const radishCount = 6 + (game.pendingKongRadishes ?? 0);
      game.pendingKongRadishes = 0;
      for (let i = 0; i < radishCount && game.wall.length; i++) newRadishes.push(game.wall.pop());
      player.radishes.push(...newRadishes);
    }
    if (selfDraw) {
      removeTile(player.hand, tile);
      game.retiredTiles.push({ seat, tile });
    }
    player.winPile.push({ tile, source, virtual: !selfDraw && index > 0, ...(discardIndex === null ? {} : { discardIndex }) });
    player.huCount++;
    player.lockedWaits = game.rules.specialHuPatterns === true ? contextualWaitTiles(game, player, player.hand) : waits;
    player.huLockActive = true;
    return { seat, newRadishes, bigSingle, pattern, wasRepeat };
  });
  for (const { seat, newRadishes, bigSingle, pattern, wasRepeat } of prepared) {
    // Seven-pairs never adds the rob-kong event bonus, on either its first or repeat win.
    const robKongBonus = source === 'robKong' && pattern?.kind !== 'sevenPairs' ? 1 : 0;
    const score = scoreHu(game, seat, bigSingle, pattern, robKongBonus);
    const repeatSelfDrawWithOneUnhu = selfDraw && !bigSingle && priorHuSeats.length === 2 && priorHuSeats.includes(seat);
    const finalFirstHu = game.rules.finalHuPaymentExceptions === true && !priorHuSeats.includes(seat) && game.players.every(player => player.huCount > 0);
    // A discard after a kong is still a discard: only its actual source pays.
    const payerSeats = source === 'kongDiscard' || source === 'robKong' ? [fromSeat]
      : replacementKong ? (replacementKong.type === 'mingGang' ? [replacementKong.fromSeat] : [0, 1, 2].filter(other => other !== seat))
      : finalFirstHu && selfDraw ? [0, 1, 2].filter(other => other !== seat)
      : selfDraw && game.lastDraw?.source !== 'replacement' && game.rules.selfDrawOnlyUnwon === true ? [0, 1, 2].filter(other => other !== seat && !priorHuSeats.includes(other))
      : repeatSelfDrawWithOneUnhu ? [0, 1, 2].filter(other => !priorHuSeats.includes(other))
      : source === 'discard' && !bigSingle ? [fromSeat] : [0, 1, 2].filter(other => other !== seat);
    const payments = transfer(game, seat, payerSeats, score.total);
    game.players[seat].lastScoreBreakdown = clone(score);
    const payerLabel = payerSeats.length === 0 ? '无未胡付款方，本次不收取胡牌分' : payerSeats.length === 1 ? `${payerSeats[0] + 1}号位付${score.total}分` : `另外两家各付${score.total}分`;
    const sourceLabel = source === 'robKong' ? `${bigSingle ? '大单钓·' : ''}抢杠胡（仅补杠者付款）`
      : source === 'kongDiscard' ? `${bigSingle ? '大单钓·' : ''}杠后接炮（仅出牌者付款）`
      : replacementKong?.type === 'mingGang' ? `${bigSingle ? '大单钓·' : ''}明杠后补摸胡（仅杠牌出牌者付款）`
      : bigSingle ? '大单钓' : selfDraw ? '自摸' : '接炮';
    log(game, { type: 'hu', seat, tile, source, fromSeat, ...(replacementKong ? { kongSource: clone(replacementKong) } : {}), points: score.total, score, payments, newRadishes,
      message: `${seat + 1}号位${sourceLabel}${label(tile)}，${payerLabel}，本次收入${score.total * payerSeats.length}分${newRadishes.length ? `，翻出${newRadishes.length}张萝卜` : ''}。` });
  }
}
function continueAfterHu(game, seat) {
  if (game.players.every(player => player.huCount > 0)) finish(game, 'allPlayersHu');
  else startDraw(game, seat, 'continuation');
}

function kong(game, seat, type, tile, fromSeat = null) {
  const player = game.players[seat];
  let concealed = type === 'anGang';
  let kongSize = 4;
  if (type === 'buGang' || type === 'addGang') {
    removeTile(player.hand, tile);
    const meld = player.melds.find(item => item.tile === tile && (type === 'buGang' ? item.type === 'peng' : canExtendKong(item)));
    concealed = meld.type === 'anGang';
    if (type === 'buGang') meld.type = 'buGang';
    meld.tiles.push(tile);
    kongSize = meld.tiles.length;
    if (type === 'addGang') meld.extended = true;
  } else {
    removeTile(player.hand, tile, type === 'mingGang' ? 3 : 4);
    player.melds.push({ type, tile, tiles: Array(4).fill(tile), ...(fromSeat === null ? {} : { fromSeat }) });
  }
  // Keep the kong event immediately before its replacement draw for provenance.
  awardBigSingleReady(game, seat);
  const amount = type === 'anGang' || type === 'mingGang' ? 2 : 1;
  const payerSeats = type === 'mingGang' ? [fromSeat] : [0, 1, 2].filter(other => other !== seat);
  const payments = transfer(game, seat, payerSeats, amount);
  const radishDeferred = !game.firstHuRadishesRevealed;
  let radish;
  if (radishDeferred) game.pendingKongRadishes = (game.pendingKongRadishes ?? 0) + 1;
  else { radish = game.wall.pop(); player.radishes.push(radish); }
  player.kongCount++; player.pendingKongDiscard = true;
  game.claim = null; game.lastDraw = null;
  log(game, { type, seat, ...(concealed ? {} : { tile }), fromSeat, ...(radishDeferred ? { radishDeferred: true, pendingKongRadishes: game.pendingKongRadishes } : { radish }), points: amount, payments,
    message: `${seat + 1}号位${{ anGang: '暗杠', buGang: '补杠', mingGang: '明杠', addGang: `加杠至${kongSize}张` }[type]}，${payerSeats.length === 1 ? '出牌方' : '另外两家各'}付${amount}分，${radishDeferred ? `累计待翻萝卜${game.pendingKongRadishes}张，首胡时一起翻` : `翻出萝卜${label(radish)}`}。` });
  startDraw(game, seat, 'replacement');
}

/** An upgrade offers only the new tile. The original meld and all kong effects stay untouched. */
function offerKongUpgrade(game, seat, type, tile) {
  const player = game.players[seat];
  const afterKong = game.lastDraw?.seat === seat && game.lastDraw.source === 'replacement';
  // A won player's ordinary draw is protected, just like its ordinary discard.
  if (player.huCount && !afterKong) return kong(game, seat, type, tile);
  const options = {};
  for (const other of [1, 2].map(offset => (seat + offset) % 3)) {
    // Rob-kong is its own repeat-win exception. It never offers peng or mingGang.
    if (huWaits(game, other, tile, false, true)) options[other] = [{ type: 'hu' }];
  }
  const eligibleSeats = Object.keys(options).map(Number);
  if (!eligibleSeats.length) return kong(game, seat, type, tile);
  removeTile(player.hand, tile);
  player.pendingKongDiscard = false;
  game.discards.push({ seat, tile, claimable: true, afterKong, robKong: true });
  game.lastDraw = null; game.phase = 'claim'; game.turnStep = null;
  game.claim = { kind: 'robKong', kongType: type, discardIndex: game.discards.length - 1,
    discardSeat: seat, tile, eligibleSeats, options, responses: {} };
  log(game, { type: 'robKongAttempt', seat, tile, kongType: type, afterKong,
    message: `${seat + 1}号位尝试补杠${label(tile)}，等待其他玩家抢杠胡或过。` });
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
    awardHuBatch(game, winners, discarded.tile, claim.kind === 'robKong' ? 'robKong' : discarded.afterKong ? 'kongDiscard' : 'discard', discarded.seat, claim.discardIndex);
    continueAfterHu(game, winners[0]);
    return;
  }
  if (claim.kind === 'robKong') {
    // Move the offered physical tile into its original meld only once everyone passed.
    discarded.claimedBy = discarded.seat; discarded.claimedAs = claim.kongType;
    game.players[discarded.seat].hand.push(discarded.tile);
    game.players[discarded.seat].hand.sort((a, b) => a - b);
    kong(game, discarded.seat, claim.kongType, discarded.tile);
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
    message: `${seat + 1}号位${automatic ? '摸后自动打出' : '打出'}${label(tile)}${discarded.afterKong ? '（杠后出牌，接胡仅出牌者付款）' : ''}。` });
  awardBigSingleReady(game, seat);
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
    if (game.rules.autoDiscardAfterHu === false) return;
    if (getLegalActions(game, seat).some(action => action.type === 'hu' || action.type.endsWith('Gang'))) return;
    if (game.lastDraw?.seat !== seat) throw new Error('胡后缺少摸牌记录');
    discard(game, seat, game.lastDraw.tile, true);
  }
  throw new Error('自动轮转超出牌墙上限');
}

export function applyAction(game, seat, action) {
  if (game.schemaVersion !== 3) throw new Error('旧牌局需要使用原版本规则');
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
  } else if (['buGang', 'addGang'].includes(action.type)) offerKongUpgrade(next, seat, action.type, action.tile);
  else if (action.type === 'anGang') kong(next, seat, action.type, action.tile);
  settleAutomatic(next);
  assertGameInvariants(next);
  return next;
}

export function getPlayerView(game, seat) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 2) throw new Error('座位无效');
  const me = game.players[seat];
  return {
    schemaVersion: 3, phase: game.phase, turnStep: game.turnStep, currentSeat: game.currentSeat, dealerSeat: game.dealerSeat ?? 0,
    wallCount: game.wall.length, revision: game.revision, rules: clone(game.rules), mySeat: seat,
    sharedRadishes: game.players.flatMap(player => player.radishes), firstHuRadishesRevealed: game.firstHuRadishesRevealed, pendingKongRadishes: game.pendingKongRadishes ?? 0,
    dragonSettlement: clone(game.dragonSettlement),
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
      ...(game.claim.kind === 'robKong' ? { kind: 'robKong', kongType: game.claim.kongType } : {}),
      eligibleSeats: [...game.claim.eligibleSeats], respondedSeats: Object.keys(game.claim.responses).map(Number) } : null,
    legalActions: getLegalActions(game, seat), huDiagnostic: getHuDiagnostic(game, seat), scoreBreakdown: clone(me.lastScoreBreakdown),
    waitTiles: contextualWaitTiles(game, me, beforeDrawHand(game, seat)),
    ...(game.rules.specialHuPatterns === true ? { specialHuPattern: clone(me.firstHuPattern ?? null) } : {}),
    lockedWaits: [...me.lockedWaits], huLockActive: me.huLockActive,
    drawnTile: game.lastDraw?.seat === seat ? game.lastDraw.tile : null, finishReason: game.finishReason,
  };
}

/** Logical win piles reference existing physical tiles, and are never extra physical copies. */
export function assertGameInvariants(game) {
  if (game.dealerSeat !== undefined && (!Number.isInteger(game.dealerSeat) || game.dealerSeat < 0 || game.dealerSeat > 2)) throw new Error('庄家座位无效');
  if (game.schemaVersion !== 3 || typeof game.firstHuRadishesRevealed !== 'boolean'
    || typeof game.dragonSettlement?.settled !== 'boolean' || !Array.isArray(game.dragonSettlement.entries)) throw new Error('牌局版本状态无效');
  if (game.pendingKongRadishes !== undefined && (!Number.isSafeInteger(game.pendingKongRadishes) || game.pendingKongRadishes < 0
    || game.pendingKongRadishes > game.players.reduce((sum, player) => sum + player.kongCount, 0)
    || (game.firstHuRadishesRevealed && game.pendingKongRadishes !== 0))) throw new Error('待翻萝卜状态无效');
  if (game.lastDraw && Object.hasOwn(game.lastDraw, 'kongSource')
    && (game.lastDraw.source !== 'replacement' || !kongSourceFromEvent({ ...game.lastDraw.kongSource, seat: game.lastDraw.seat }, game.lastDraw.seat))) throw new Error('杠后补摸来源无效');
  if (game.claim?.kind === 'robKong') {
    const claim = game.claim, offered = game.discards[claim.discardIndex];
    const player = game.players[claim.discardSeat];
    if (game.phase !== 'claim' || !['buGang', 'addGang'].includes(claim.kongType)
      || !offered?.robKong || offered.tile !== claim.tile || offered.seat !== claim.discardSeat
      || !offered.claimable || offered.claimedBy !== undefined || game.lastDraw !== null
      || !player?.melds.some(meld => meld.tile === claim.tile && (claim.kongType === 'buGang' ? meld.type === 'peng' : canExtendKong(meld)))
      || !claim.eligibleSeats.length || claim.eligibleSeats.some(seat => ![0, 1, 2].includes(seat) || seat === claim.discardSeat
        || claim.options[seat]?.length !== 1 || claim.options[seat][0].type !== 'hu')
      || Object.entries(claim.responses).some(([seat, response]) => !claim.eligibleSeats.includes(Number(seat)) || !['hu', 'pass'].includes(response.type))) throw new Error('抢杠状态无效');
  }
  const tiles = [...game.wall, ...game.retiredTiles.map(item => item.tile),
    ...game.discards.filter(item => item.claimedBy === undefined).map(item => item.tile),
    ...game.players.flatMap(player => [...player.hand, ...meldTiles(player), ...player.radishes])];
  if (tiles.length !== 144 || !tiles.every(isTile) || countsOf(tiles).some(count => count !== 8)) throw new Error('牌张守恒检查失败');
  if (game.players.length !== 3 || game.players.reduce((sum, player) => sum + player.score, 0) !== 0) throw new Error('积分守恒检查失败');
  for (const player of game.players) {
    if (player.bigSingleReadyPaid !== undefined && typeof player.bigSingleReadyPaid !== 'boolean') throw new Error('大单吊听牌收分状态无效');
    if (!Number.isSafeInteger(player.score) || player.melds.length > 4 || !Number.isSafeInteger(player.huCount) || player.huCount < 0) throw new Error('玩家状态无效');
    if (player.firstHuPattern != null) {
      const pattern = player.firstHuPattern;
      if (!player.huCount || !['standard', 'sevenPairs', 'bigSingle'].includes(pattern.kind)
        || typeof pattern.pureSuit !== 'boolean' || typeof pattern.allTriplets !== 'boolean'
        || !Array.isArray(pattern.waitTiles) || !pattern.waitTiles.every(isTile)
        || !sameSet(pattern.waitTiles, sorted(new Set(pattern.waitTiles)))
        || (pattern.kind === 'standard' ? pattern.waitTiles.length !== 0 : pattern.waitTiles.length === 0)
        || (pattern.kind === 'sevenPairs'
          ? !Number.isSafeInteger(pattern.sevenPairsFan) || pattern.sevenPairsFan < 3
            || pattern.fixedFan !== pattern.sevenPairsFan + (pattern.pureSuit ? 2 : 0)
          : pattern.fixedFan !== null)) throw new Error('首胡牌型状态无效');
    }
    for (const meld of player.melds) {
      if (!['peng', 'mingGang', 'anGang', 'buGang'].includes(meld.type) || !isTile(meld.tile) || !meld.tiles.every(tile => tile === meld.tile)
        || (meld.type === 'peng' ? meld.tiles.length !== 3 : (meld.tiles.length < 4 || meld.tiles.length > 8))) throw new Error('副露状态无效');
    }
    for (const win of player.winPile) {
      if (!isTile(win.tile) || !['selfDraw', 'discard', 'kongDiscard', 'robKong'].includes(win.source) || typeof win.virtual !== 'boolean') throw new Error('胡牌堆状态无效');
      if (win.source !== 'selfDraw' && (!Number.isInteger(win.discardIndex) || game.discards[win.discardIndex]?.tile !== win.tile)) throw new Error('胡牌引用无效');
      if (win.source === 'selfDraw' && win.virtual) throw new Error('自摸不能是虚拟牌');
    }
    const base = (4 - player.melds.length) * 3 + 1;
    const extra = game.phase === 'turn' && game.turnStep === 'discard' && game.currentSeat === player.seat ? 1 : 0;
    if (player.hand.length !== base + extra) throw new Error(`手牌数量检查失败：${player.seat}`);
  }
  return true;
}
