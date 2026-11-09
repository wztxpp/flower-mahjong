// 写实牌桌的纯展示模型：只消费已显示的房间公开视图，不读取墙牌、历史或推断合法动作。
// Pure realistic-table presentation: consume the displayed room view only, never wall identities, history or action inference.
// 所有坐标是1000平方桌面中的南侧玩家本地坐标；组件绕桌心旋转，不能把局部左右当屏幕左右。
// Coordinates describe the south-facing player's local 1000-square table; components rotate around its center, not screen-side labels.
import { roundSummaryHandsBySeat } from './round-summary.js';

export const REALISTIC_TABLE_SIZE = Object.freeze({ width: 1000, height: 1000 });
const POSITIONS = {
  south: 0,
  right: -90,
  north: 180,
  left: 90,
};
// 四个物理方向按顺时针序号排列；座位号的方向表在整局内固定，空位也占据其中一边。
// Clockwise physical sides have stable indices; absolute seats and vacant sides never move between viewers.
const POSITION_ORDER = ['south', 'right', 'north', 'left'];
const ABSOLUTE_POSITIONS_BY_COUNT = {
  3: ['south', 'left', 'right'],
  4: ['south', 'left', 'north', 'right'],
};

// 每次复制各区以防调用者污染之后的布局；碰杠在本人左下，胡牌在本人右下。
// Copy zones per invocation to prevent shared mutations; melds belong at local lower-left and wins at local lower-right.
function localZones() {
  return {
    hand: { x: 240, y: 910, width: 520, height: 60 },
    wall: { x: 260, y: 750, width: 480, height: 60 },
    river: { x: 390, y: 620, width: 220, height: 120 },
    melds: { x: 180, y: 825, width: 230, height: 75 },
    wins: { x: 590, y: 825, width: 230, height: 75 },
  };
}

// 先把绝对座位固定到四边，再旋转整桌让本人朝南；观众锚定0号位，但不获得本人身份。
// Fix absolute seats to four physical sides before rotating the whole table to self at south; spectators anchor seat zero without owning it.
// 三人桌0号视角为南0/左1/右2/北空。空位随观察角度旋转，不能每次把它重新塞回北面。
// Three-player seat zero sees south0/left1/right2/north vacant. Rotate the vacancy too, rather than forcing it back north for every viewer.
// 这使左、右两家始终对坐；turnDirection只改变行牌顺序，不交换物理座位或牌区归属。
// This keeps the original left/right pair opposite each other; turnDirection changes play order, never physical seats or zone ownership.
// 非法/重复座位拒绝整组，避免两个玩家共享位置；输入与返回对象互不共享可写数据。
// Reject invalid/duplicate seats as a group so two players never share a position; input and output share no mutable state.
export function realisticSeatLayout(players, mySeat = null) {
  if (!Array.isArray(players) || ![3, 4].includes(players.length)) return [];
  const seatNumbers = players.map((player) => player?.seat);
  if (seatNumbers.some((seat) => !Number.isInteger(seat) || seat < 0 || seat >= players.length)) return [];
  if (new Set(seatNumbers).size !== seatNumbers.length) return [];
  seatNumbers.sort((a, b) => a - b);
  const hasOwnSeat = seatNumbers.includes(mySeat);
  const anchorSeat = hasOwnSeat ? mySeat : seatNumbers[0];
  const absolutePositions = ABSOLUTE_POSITIONS_BY_COUNT[players.length];
  const anchorSideIndex = POSITION_ORDER.indexOf(absolutePositions[anchorSeat]);
  return seatNumbers.map((seat) => {
    const absoluteSideIndex = POSITION_ORDER.indexOf(absolutePositions[seat]);
    const relativeSideIndex = (absoluteSideIndex - anchorSideIndex + POSITION_ORDER.length) % POSITION_ORDER.length;
    const position = POSITION_ORDER[relativeSideIndex];
    return { seat, position, rotation: POSITIONS[position], isSelf: hasOwnSeat && seat === mySeat, zones: localZones() };
  }).sort((first, second) => POSITION_ORDER.indexOf(first.position) - POSITION_ORDER.indexOf(second.position));
}

// 缺数量保持未知(null)，不能把缺失响应显示为确知的零；不接受字符串、负数或小数。
// Keep missing counts unknown (null), never turn an absent field into a known zero; reject strings, negatives and fractions.
function publicCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// hidden具有最高优先级，即使异常响应同时带牌种也只输出null；不复制源对象的额外元数据。
// Hidden overrides even an accidentally attached identity; do not copy unknown metadata from source objects.
function displayTile(tile, hidden = false, tileCount = 18) {
  const visible = !hidden && Number.isInteger(tile) && tile >= 0 && tile < tileCount;
  return { tile: visible ? tile : null, hidden: !visible };
}

// 墙只按公开剩余总数均分为展示段，并非真实摸牌顺序或剩余墙段；适用于任何牌副数。
// Divide the public remaining total into display segments, not actual draw order or physical wall segments, for every deck size.
export function realisticWallCounts(wallCount, seatCount) {
  const count = publicCount(wallCount);
  if (![3, 4].includes(seatCount)) return [];
  if (count === null) return Array(seatCount).fill(null);
  return Array.from({ length: seatCount }, (_, index) => Math.floor(count / seatCount) + (index < count % seatCount ? 1 : 0));
}

// 四边实体墙与座位数量独立，三人桌北边仍有墙。只从公开副数、余牌数和已翻萝卜数求剩余区间。
// Four physical wall sides are independent of player count: three-player tables retain the north wall. Only public deck/remaining/radish counts define the interval.
// 庄家所在边作为展示开口，按南→右→北→左绕桌；没有骰子/实际开口协议，始终明确这是视觉约定。
// The dealer's side is the visual break, cycling south→right→north→left. No dice/actual-break protocol exists, so this remains an explicit convention.
export function buildRealisticWalls(game, layout, isChengdu = false) {
  const count = publicCount(game?.wallCount);
  const deckCount = game?.rules?.deckCount;
  const validDeck = typeof deckCount === 'number' && deckCount >= 1 && deckCount <= 5 && Number.isInteger(deckCount * 2);
  const total = isChengdu ? 108 : deckCount === undefined ? 144 : validDeck ? deckCount * 72 : null;
  const positions = ['south', 'right', 'north', 'left'];
  const dealerPosition = layout.find(({ seat }) => seat === game?.dealerSeat)?.position ?? 'south';
  const breakIndex = positions.indexOf(dealerPosition);
  // 没有共享池的旧视图仅当每个玩家都有公开萝卜数组才可重建尾部数量；缺信息不猜零。
  // Older views without a shared pool can reconstruct the tail only when every player has a public radish array; absent data is not guessed as zero.
  const hasPlayerRadishes = Array.isArray(game?.players) && game.players.length > 0 && game.players.every((player) => Array.isArray(player.radishes));
  const tailRemoved = isChengdu ? 0 : Array.isArray(game?.sharedRadishes) ? game.sharedRadishes.length
    : hasPlayerRadishes ? game.players.reduce((sum, player) => sum + player.radishes.length, 0) : null;
  const sequential = count !== null && total !== null && tailRemoved !== null && count + tailRemoved <= total;
  const frontRemoved = sequential ? total - count - tailRemoved : null;
  const fallbackCounts = realisticWallCounts(count, 4);
  const sides = positions.map((position, sideIndex) => {
    const orderIndex = (sideIndex - breakIndex + 4) % 4;
    const sideBudget = sequential ? total / 4 : fallbackCounts[sideIndex];
    const sideStart = sequential ? orderIndex * sideBudget : 0;
    const slots = Array.from({ length: sideBudget === null ? 0 : Math.ceil(sideBudget / 2) }, (_, index) => {
      const start = sideStart + index * 2;
      const end = Math.min(sideStart + sideBudget, start + 2);
      // 固定初始垛位，只扣前端摸入/后端萝卜；一层与空垛保留原index，不能每次把所有墙重新均分。
      // Preserve initial stack positions, removing front draws/back radishes only; single/empty stacks retain indices instead of rebalancing every wall.
      const remainingLayers = sequential ? Math.max(0, Math.min(end, total - tailRemoved) - Math.max(start, frontRemoved)) : end - start;
      return { index, remainingLayers };
    });
    return { position, rotation: POSITIONS[position], zones: { wall: localZones().wall }, slots,
      wallCount: count === null ? null : slots.reduce((sum, slot) => sum + slot.remainingLayers, 0) };
  });
  // 锚点对应当前剩余区间的首/尾垛中心；空墙或降级均分不声称真实摸牌端点。
  // Anchors identify the first/last stack of the current remaining interval; exhausted/fallback walls make no draw-end claim.
  const endpoint = (tileIndex) => {
    const sideBudget = total / 4;
    const orderIndex = Math.floor(tileIndex / sideBudget);
    const side = sides[(breakIndex + orderIndex) % 4];
    const stackIndex = Math.floor((tileIndex % sideBudget) / 2);
    const zone = side.zones.wall;
    const width = zone.width / side.slots.length;
    return realisticZoneCenter({ rotation: side.rotation, zones: { slot: { x: zone.x + stackIndex * width, y: zone.y, width, height: zone.height } } }, 'slot');
  };
  return { walls: sides, wallIsApproximate: true,
    wallDistribution: count === null ? 'unknown' : sequential ? 'sequential-public-counts' : 'equal-count-fallback',
    drawAnchor: sequential && count > 0 ? endpoint(frontRemoved) : null,
    wallTailAnchor: sequential && count > 0 ? endpoint(total - tailRemoved - 1) : null };
}

// 输入完整已显示房间state；只按白名单输出牌区。本人暗手由mySeat/you一致授权，终局摊牌复用既有摘要门。
// Accept the complete displayed room state and allowlist tile zones. Own hands require matching mySeat/you; terminal reveals reuse the summary gate.
// 被碰杠或胡走的弃牌不再占实体牌河，保留原index供高亮；胡牌区仍保留virtual共胡标记，不当成额外实体牌。
// Claimed/multiple-win discards leave the physical river, retaining original indices for highlights; virtual win flags remain references, not extra physical tiles.
export function buildRealisticTableModel(state) {
  const game = state?.game;
  const mySeat = state?.viewerRole !== 'spectator' && (state?.you === undefined || state.you === game?.mySeat) ? game?.mySeat : null;
  const layout = realisticSeatLayout(game?.players, mySeat);
  const wallCount = publicCount(game?.wallCount);
  const finalHands = roundSummaryHandsBySeat(state);
  const isChengdu = (game?.gameMode ?? state?.gameMode) === 'chengdu';
  // 旧版萝卜只属于翻牌者；显式旧schema优先于意外混入的共享字段，缺schema的v1也保留个人归属。
  // Legacy radishes belong to their owner. Explicit legacy schemas override stray shared fields; schema-less v1 retains ownership.
  const legacyRadishes = game?.schemaVersion === 1 || game?.schemaVersion === 2;
  const radishMode = isChengdu ? 'none' : legacyRadishes ? 'personal'
    : game?.schemaVersion === 3 || Array.isArray(game?.sharedRadishes) ? 'shared' : 'personal';
  const tileCount = isChengdu ? 27 : 18;
  const wallModel = buildRealisticWalls(game, layout, isChengdu);
  const seats = layout.map((location) => {
    const player = game.players.find((entry) => entry.seat === location.seat);
    const finalHand = finalHands.get(location.seat);
    const visibleHand = finalHand ?? (location.isSelf && Array.isArray(player.hand) ? player.hand : null);
    const handCount = publicCount(player.handCount);
    const hand = visibleHand
      ? visibleHand.map((tile) => displayTile(tile, false, tileCount))
      : Array.from({ length: handCount ?? 0 }, () => displayTile(null));
    const melds = (player.melds || []).map((meld) => ({
      type: meld.type,
      extended: meld.extended === true,
      tiles: (meld.tiles || []).map((tile) => displayTile(tile, meld.hidden === true, tileCount)),
    }));
    // 成都使用一次性won记录，不借花麻将winPile；自摸引用不向手牌再添一张。
    // Chengdu uses its single won record, never Flower winPile; self-draw references do not add a hand tile.
    const winRecords = isChengdu ? (player.won ? [player.won] : []) : (player.winPile || []);
    const wins = winRecords.map((win) => ({
      ...displayTile(win.tile, win.hidden === true, tileCount),
      source: win.source,
      virtual: win.virtual === true,
    }));
    const discards = (game.discards || []).flatMap((discard, index) => {
      if (discard.seat !== location.seat) return [];
      // 两模式的协议独立：成都winning仍是公开牌河引用，只按claimed移除。
      // Protocols remain separate: Chengdu winning stays a public river reference; only claimed removes it.
      if (isChengdu ? discard.claimed : discard.claimedBy !== undefined || discard.huSeats?.length) return [];
      return [{ ...displayTile(discard.tile, discard.hidden === true, tileCount), index, afterKong: discard.afterKong === true }];
    });
    // 胡次数是独立公开事实，v1没有winPile；不能用牌区长度伪造0次，也不从历史推断未知值。
    // Hu count is independent public data: v1 has no winPile. Never manufacture zero from zone length or infer missing counts from history.
    const huCount = isChengdu ? (player.won ? 1 : 0) : publicCount(player.huCount);
    const personalRadishes = radishMode === 'personal' && Array.isArray(player.radishes)
      ? player.radishes.map((tile) => displayTile(tile, false, tileCount)) : [];
    return { ...location, hand, handCount, melds, wins, huCount, personalRadishes, discards, wallCount: wallModel.walls.find((wall) => wall.position === location.position).wallCount };
  });
  // 中心只展示权威共享池；个人萝卜留在座位，不能合并成改变旧局计分含义的“全桌萝卜”。
  // The center displays only an authoritative shared pool. Personal radishes stay at seats instead of implying shared legacy scoring.
  const radishes = radishMode === 'shared' && Array.isArray(game?.sharedRadishes) ? game.sharedRadishes : [];
  return {
    ...REALISTIC_TABLE_SIZE,
    seats,
    wallCount,
    ...wallModel,
    radishMode,
    radishes: radishes.map((tile) => displayTile(tile, false, tileCount)),
    pendingRadishes: radishMode !== 'shared' ? null : publicCount(game?.pendingKongRadishes),
  };
}

// 非有限/负视窗按零处理；缩放始终等比，默认全部桌面留在可视区，返回屏幕像素偏移。
// Invalid/negative viewports become zero; uniform scaling fits the entire table by default and returns screen-pixel offsets.
function viewportSize(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
export function fitRealisticTable(viewportWidth, viewportHeight, padding = 12) {
  const width = viewportSize(viewportWidth);
  const height = viewportSize(viewportHeight);
  const inset = viewportSize(padding);
  const scale = Math.max(0, Math.min((width - inset * 2) / 1000, (height - inset * 2) / 1000));
  return { scale, x: (width - 1000 * scale) / 2, y: (height - 1000 * scale) / 2, width: 1000 * scale, height: 1000 * scale };
}

// 临时拖动以屏幕像素限在视窗四分之一内；松手/取消/换桌/缩放时调用reset，不保留浏览位置。
// Limit temporary drag in screen pixels to a quarter viewport; reset on release, cancel, table changes or resize, with no persistence.
// 可选场景尺寸是缩放后的屏幕像素；超出视窗时允许拖到四边，省略仍保留原四分之一弹性范围。
// Optional scene dimensions use scaled screen pixels. Oversized scenes can reach every edge; omitted dimensions retain quarter-viewport travel.
export function clampRealisticPan(pan, viewportWidth, viewportHeight, scaledSceneWidth, scaledSceneHeight) {
  const clampAxis = (value, size, sceneSize) => {
    const limit = Math.max(size / 4, (viewportSize(sceneSize) - size) / 2);
    return Math.max(-limit, Math.min(limit, Number.isFinite(value) ? value : 0));
  };
  return {
    x: clampAxis(pan?.x, viewportSize(viewportWidth), scaledSceneWidth),
    y: clampAxis(pan?.y, viewportSize(viewportHeight), scaledSceneHeight),
  };
}
export function resetRealisticPan() {
  return { x: 0, y: 0 };
}

// 按牌区尺寸尝试所有列数，选最大等比牌面；不裁掉长牌河，也不假设固定弃牌上限。
// Try every column count for the zone and choose the largest proportional tiles; never truncate long rivers or assume a discard ceiling.
export function fitRealisticTileGrid(count, width, height, aspectRatio = 0.72, gap = 2) {
  const tileCount = publicCount(count) ?? 0;
  const areaWidth = viewportSize(width);
  const areaHeight = viewportSize(height);
  const ratio = viewportSize(aspectRatio) || 0.72;
  const requestedGap = viewportSize(gap);
  let best = { columns: 0, rows: 0, tileWidth: 0, tileHeight: 0, gap: 0 };
  for (let columns = 1; columns <= tileCount; columns++) {
    const rows = Math.ceil(tileCount / columns);
    // 高数量时连间隙也缩小，避免间隙本身溢出整个牌区。
    // Shrink gaps at high counts so spacing alone cannot overflow the zone.
    const fittedGap = Math.min(requestedGap, areaWidth / (columns * 2), areaHeight / (rows * 2));
    const tileHeight = Math.max(0, Math.min((areaWidth - (columns - 1) * fittedGap) / columns / ratio, (areaHeight - (rows - 1) * fittedGap) / rows));
    if (tileHeight > best.tileHeight) best = { columns, rows, tileWidth: tileHeight * ratio, tileHeight, gap: fittedGap };
  }
  return best;
}

// 给飞牌提供桌面坐标锚点；只旋转局部区域中心，不包含任何动作时序或牌种猜测。
// Supply table-space animation anchors by rotating local zone centers, without event timing or tile-identity guesses.
export function realisticZoneCenter(location, zoneName) {
  const zone = location?.zones?.[zoneName];
  if (!zone || !Number.isFinite(location.rotation)) return null;
  const radians = location.rotation * Math.PI / 180;
  const x = zone.x + zone.width / 2 - 500;
  const y = zone.y + zone.height / 2 - 500;
  return { x: 500 + x * Math.cos(radians) - y * Math.sin(radians), y: 500 + x * Math.sin(radians) + y * Math.cos(radians) };
}
