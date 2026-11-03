/** Pure, dependency-free engine for the documented provisional Zigong variant. */
export const TILE_COUNT = 18;
export const DEFAULT_RULES = Object.freeze({
  sevenPairs: true,
  baseHuPoints: 1,
  dragonPoints: Object.freeze({ 6: 10, 7: 20, 8: 40 }),
  multipleWinners: true,
  radishCountsMelds: true,
  dragonCountsMelds: true,
  stackDragonBonus: true,
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
  const rules = { ...DEFAULT_RULES, ...input, dragonPoints: { ...DEFAULT_RULES.dragonPoints, ...(input.dragonPoints || {}) } };
  for (const key of ['sevenPairs', 'multipleWinners', 'radishCountsMelds', 'dragonCountsMelds', 'stackDragonBonus', 'allowChangedWaitDuringLock', 'preserveWaitsOnPostHuKong']) {
    if (typeof rules[key] !== 'boolean') throw new Error(`规则 ${key} 必须为布尔值`);
  }
  if (!Number.isSafeInteger(rules.baseHuPoints) || rules.baseHuPoints < 0 || rules.baseHuPoints > 100000) throw new Error('基础分无效');
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
    seat, hand: [], melds: [], radishes: [], score: 0, huCount: 0,
    lockedWaits: [], huLockActive: false, pendingKongDiscard: false,
  }));
  for (let i = 0; i < 13; i++) for (const player of players) player.hand.push(wall.shift());
  const initialTile = wall.shift();
  players[0].hand.push(initialTile);
  for (const player of players) player.hand.sort((a, b) => a - b);
  const game = {
    phase: 'turn', turnStep: 'discard', currentSeat: 0,
    wall, players, discards: [], retiredTiles: [], history: [], revision: 0,
    rules, claim: null, drawKind: 'normal',
    lastDraw: { seat: 0, tile: initialTile, source: 'initial' },
    finishReason: null,
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
  const complete = fromHand ? player.hand : [...base, tile];
  if (!isWinningHand(complete, player.melds.length, game.rules)) return null;
  const waits = getWaitTiles(base, player.melds, game.rules);
  if (player.huLockActive) {
    if (!game.rules.allowChangedWaitDuringLock || waits.some(wait => player.lockedWaits.includes(wait))) return null;
  }
  return waits;
}

function beforeDrawHand(game, seat) {
  const hand = [...game.players[seat].hand];
  if (game.lastDraw?.seat === seat) removeTile(hand, game.lastDraw.tile);
  return hand;
}

function canKong(game, seat, type, tile) {
  const player = game.players[seat];
  if (game.wall.length < 2) return false; // One radish and one replacement must be available.
  if (!player.huCount || !game.rules.preserveWaitsOnPostHuKong) return true;
  const before = getWaitTiles(beforeDrawHand(game, seat), player.melds, game.rules);
  const hand = [...player.hand];
  const melds = clone(player.melds);
  if (type === 'anGang') {
    removeTile(hand, tile, 4);
    melds.push({ type, tile, tiles: [tile, tile, tile, tile] });
  } else if (type === 'buGang') {
    removeTile(hand, tile);
    const meld = melds.find(item => item.type === 'peng' && item.tile === tile);
    if (!meld) return false;
    meld.type = 'buGang'; meld.tiles.push(tile);
  } else {
    removeTile(hand, tile, 3);
    melds.push({ type, tile, tiles: [tile, tile, tile, tile] });
  }
  const after = getWaitTiles(hand, melds, game.rules);
  return before.length > 0 && sameSet(before, after);
}

function claimOptions(game, seat, discarded) {
  const player = game.players[seat];
  const counts = countsOf(player.hand);
  const actions = [];
  const canDiscardHu = !game.players[discarded.seat].huCount || discarded.afterKong;
  if (canDiscardHu && huWaits(game, seat, discarded.tile, false)) actions.push({ type: 'hu' });
  if (player.melds.length < 4 && counts[discarded.tile] >= 3 && canKong(game, seat, 'mingGang', discarded.tile)) actions.push({ type: 'mingGang', tile: discarded.tile });
  if (player.melds.length < 4 && counts[discarded.tile] >= 2) actions.push({ type: 'peng', tile: discarded.tile });
  return actions;
}

export function getLegalActions(game, seat) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 2 || game.phase === 'finished') return [];
  if (game.phase === 'claim') {
    if (!game.claim?.eligibleSeats.includes(seat) || game.claim.responses[seat]) return [];
    return [...clone(game.claim.options[seat]), { type: 'pass' }];
  }
  if (game.phase !== 'turn' || game.currentSeat !== seat) return [];
  if (game.turnStep === 'draw') return game.wall.length ? [{ type: 'draw' }] : [];
  const player = game.players[seat];
  const actions = sorted(new Set(player.hand)).map(tile => ({ type: 'discard', tile }));
  if (game.lastDraw?.seat === seat && huWaits(game, seat, game.lastDraw.tile, true)) actions.push({ type: 'hu' });
  const counts = countsOf(player.hand);
  for (let tile = 0; tile < TILE_COUNT; tile++) {
    if (player.melds.length < 4 && counts[tile] >= 4 && canKong(game, seat, 'anGang', tile)) actions.push({ type: 'anGang', tile });
    if (counts[tile] && player.melds.some(meld => meld.type === 'peng' && meld.tile === tile) && canKong(game, seat, 'buGang', tile)) actions.push({ type: 'buGang', tile });
  }
  return actions;
}

function log(game, event) {
  game.history.push({ revision: game.revision, ...event });
}

function finish(game) {
  game.phase = 'finished'; game.turnStep = null; game.claim = null; game.lastDraw = null;
  game.finishReason = 'wallExhausted';
  for (const discarded of game.discards) discarded.claimable = false;
  log(game, { type: 'finish', message: '牌墙已摸完，本局结束，积分已结算。' });
}

function startDraw(game, seat, kind = 'normal') {
  game.currentSeat = seat; game.phase = 'turn'; game.turnStep = 'draw';
  game.drawKind = kind; game.lastDraw = null; game.claim = null;
  if (!game.wall.length) finish(game);
}

function draw(game, seat, source = 'normal') {
  if (!game.wall.length) return finish(game);
  const player = game.players[seat];
  if (source === 'normal' && game.drawKind === 'normal' && game.rules.repeatHuLock === 'untilNaturalDraw') player.huLockActive = false;
  const tile = game.wall.shift();
  player.hand.push(tile); player.hand.sort((a, b) => a - b);
  game.lastDraw = { seat, tile, source };
  game.phase = 'turn'; game.turnStep = 'discard'; game.currentSeat = seat;
  log(game, { type: 'draw', seat, source, message: `${seat + 1}号位${source === 'replacement' ? '杠后补牌' : '摸了一张牌'}。` });
}

function scoreHu(game, seat, winningHand) {
  const player = game.players[seat];
  const owned = [...winningHand, ...meldTiles(player)];
  const matchCounts = countsOf(game.rules.radishCountsMelds ? owned : winningHand);
  const radishCounts = countsOf(player.radishes);
  const allCounts = countsOf([...(game.rules.dragonCountsMelds ? owned : winningHand), ...player.radishes]);
  const radishBonus = matchCounts.reduce((sum, count, tile) => sum + count * radishCounts[tile], 0);
  const dragonBonus = allCounts.reduce((sum, count) => sum + (count >= 6 ? game.rules.dragonPoints[Math.min(8, count)] : 0), 0);
  const ordinary = game.rules.baseHuPoints + radishBonus;
  const total = game.rules.stackDragonBonus ? ordinary + dragonBonus : Math.max(ordinary, dragonBonus);
  return { base: game.rules.baseHuPoints, radishBonus, dragonBonus, total };
}

function awardHu(game, seat, tile, source, fromSeat = null) {
  const player = game.players[seat];
  const selfDraw = source === 'selfDraw';
  const waits = huWaits(game, seat, tile, selfDraw);
  if (!waits) throw new Error('当前不能胡牌');
  const newRadishes = [];
  if (player.huCount === 0) {
    for (let i = 0; i < 6 && game.wall.length; i++) newRadishes.push(game.wall.pop());
    player.radishes.push(...newRadishes);
  }
  const winningHand = selfDraw ? [...player.hand] : [...player.hand, tile];
  const score = scoreHu(game, seat, winningHand);
  const payerSeats = source === 'discard' ? [fromSeat] : [0, 1, 2].filter(other => other !== seat);
  const payments = payerSeats.map(payer => ({ seat: payer, delta: -score.total }));
  payments.push({ seat, delta: score.total * payerSeats.length });
  for (const payment of payments) game.players[payment.seat].score += payment.delta;
  player.huCount++; player.lockedWaits = waits; player.huLockActive = true;
  if (selfDraw) {
    removeTile(player.hand, tile);
    game.retiredTiles.push({ seat, tile });
  }
  const sourceLabel = source === 'selfDraw' ? '自摸' : source === 'kongDiscard' ? '杠后接炮（按自摸）' : '接炮';
  log(game, { type: 'hu', seat, tile, source, fromSeat, points: score.total, score, payments, newRadishes,
    message: `${seat + 1}号位${sourceLabel}${label(tile)}，每家应付${score.total}分，本次收入${score.total * payerSeats.length}分${newRadishes.length ? `，翻出${newRadishes.length}张萝卜` : ''}。` });
}

function kong(game, seat, type, tile, fromSeat = null) {
  const player = game.players[seat];
  if (type === 'buGang') {
    removeTile(player.hand, tile);
    const meld = player.melds.find(item => item.type === 'peng' && item.tile === tile);
    meld.type = 'buGang'; meld.tiles.push(tile);
  } else {
    removeTile(player.hand, tile, type === 'mingGang' ? 3 : 4);
    player.melds.push({ type, tile, tiles: [tile, tile, tile, tile], ...(fromSeat === null ? {} : { fromSeat }) });
  }
  const radish = game.wall.pop();
  player.radishes.push(radish); player.pendingKongDiscard = true;
  game.claim = null; game.lastDraw = null;
  log(game, { type, seat, ...(type === 'anGang' ? {} : { tile }), radish,
    message: `${seat + 1}号位${{ anGang: '暗杠', buGang: '补杠', mingGang: '明杠' }[type]}，翻出萝卜${label(radish)}。` });
  draw(game, seat, 'replacement');
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
    for (const seat of winners) awardHu(game, seat, discarded.tile, discarded.afterKong ? 'kongDiscard' : 'discard', discarded.seat);
    discarded.huSeats = winners;
    startDraw(game, winners[0], 'continuation');
    return;
  }
  const caller = order.find(seat => ['peng', 'mingGang'].includes(claim.responses[seat]?.type));
  if (caller === undefined) {
    startDraw(game, (discarded.seat + 1) % 3);
    return;
  }
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

export function applyAction(game, seat, action) {
  if (!action || typeof action !== 'object' || Array.isArray(action) || typeof action.type !== 'string') throw new Error('操作格式无效');
  if (Object.keys(action).some(key => !['type', 'tile'].includes(key))) throw new Error('操作包含未知字段');
  const matched = getLegalActions(game, seat).find(legal => legal.type === action.type && legal.tile === action.tile);
  if (!matched) throw new Error('当前不能执行这项操作，请刷新牌桌');
  const next = clone(game);
  next.revision++;
  if (next.phase === 'claim') {
    next.claim.responses[seat] = clone(matched);
    // Do not reveal a pending choice until every eligible player has responded.
    resolveClaims(next);
  } else if (action.type === 'draw') draw(next, seat);
  else if (action.type === 'discard') {
    const player = next.players[seat];
    removeTile(player.hand, action.tile);
    const discarded = { seat, tile: action.tile, claimable: false, afterKong: player.pendingKongDiscard };
    player.pendingKongDiscard = false;
    next.discards.push(discarded); next.lastDraw = null;
    log(next, { type: 'discard', seat, tile: action.tile, afterKong: discarded.afterKong, message: `${seat + 1}号位打出${label(action.tile)}${discarded.afterKong ? '（杠后出牌，可按自摸接胡）' : ''}。` });
    const options = {};
    for (const other of [0, 1, 2].filter(other => other !== seat)) {
      const available = claimOptions(next, other, discarded);
      if (available.length) options[other] = available;
    }
    const eligibleSeats = Object.keys(options).map(Number);
    if (eligibleSeats.length) {
      discarded.claimable = true; next.phase = 'claim'; next.turnStep = null;
      next.claim = { discardIndex: next.discards.length - 1, discardSeat: seat, tile: action.tile, eligibleSeats, options, responses: {} };
    } else startDraw(next, (seat + 1) % 3);
  } else if (action.type === 'hu') {
    awardHu(next, seat, next.lastDraw.tile, 'selfDraw');
    startDraw(next, seat, 'continuation');
  } else if (action.type === 'anGang' || action.type === 'buGang') kong(next, seat, action.type, action.tile);
  assertGameInvariants(next);
  return next;
}

export function getPlayerView(game, seat) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 2) throw new Error('座位无效');
  const me = game.players[seat];
  const view = {
    phase: game.phase, turnStep: game.turnStep, currentSeat: game.currentSeat,
    wallCount: game.wall.length, revision: game.revision, rules: clone(game.rules), mySeat: seat,
    players: game.players.map((player, index) => ({
      seat: index, ...(index === seat ? { hand: [...player.hand] } : {}), handCount: player.hand.length,
      melds: player.melds.map(meld => meld.type === 'anGang' && index !== seat
        ? { type: 'anGang', tile: null, tiles: [null, null, null, null], hidden: true }
        : clone(meld)),
      radishes: [...player.radishes], score: player.score, huCount: player.huCount,
    })),
    discards: clone(game.discards), retiredTiles: clone(game.retiredTiles), history: clone(game.history),
    claim: game.claim ? { discardSeat: game.claim.discardSeat, tile: game.claim.tile,
      eligibleSeats: [...game.claim.eligibleSeats], respondedSeats: Object.keys(game.claim.responses).map(Number) } : null,
    legalActions: getLegalActions(game, seat),
    waitTiles: getWaitTiles(beforeDrawHand(game, seat), me.melds, game.rules),
    lockedWaits: [...me.lockedWaits], huLockActive: me.huLockActive,
    drawnTile: game.lastDraw?.seat === seat ? game.lastDraw.tile : null,
    finishReason: game.finishReason,
  };
  return view;
}

/** Counts physical tiles, excluding a claimed discard's historical duplicate. */
export function assertGameInvariants(game) {
  const tiles = [...game.wall, ...game.retiredTiles.map(item => item.tile),
    ...game.discards.filter(item => item.claimedBy === undefined).map(item => item.tile),
    ...game.players.flatMap(player => [...player.hand, ...meldTiles(player), ...player.radishes])];
  if (tiles.length !== 144 || !tiles.every(isTile) || countsOf(tiles).some(count => count !== 8)) throw new Error('牌张守恒检查失败');
  if (game.players.length !== 3 || game.players.reduce((sum, player) => sum + player.score, 0) !== 0) throw new Error('积分守恒检查失败');
  for (const player of game.players) {
    if (!Number.isSafeInteger(player.score) || player.melds.length > 4) throw new Error('玩家状态无效');
    const base = (4 - player.melds.length) * 3 + 1;
    const extra = game.phase === 'turn' && game.turnStep === 'discard' && game.currentSeat === player.seat ? 1 : 0;
    // A wall-ending hu has already returned the winner to a waiting hand.
    // A final unclaimed discard also leaves all hands at their waiting size.
    if (player.hand.length !== base + extra) throw new Error(`手牌数量检查失败：${player.seat}`);
  }
  return true;
}
