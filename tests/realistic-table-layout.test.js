// 测试公开投影、纯坐标和旧引擎合法合成局；不接触真实牌局。
// Test public projection and geometry, plus legal synthetic legacy-engine fixtures; never access real games.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REALISTIC_TABLE_SIZE, realisticSeatLayout, realisticWallCounts, buildRealisticTableModel,
  fitRealisticTable, clampRealisticPan, resetRealisticPan, fitRealisticTileGrid, realisticZoneCenter,
} from '../src/realistic-table-layout.js';

// 每次创建独立视图，便于冻结后证明模型不写回服务器输入。
// Build independent views so freezing proves the model never writes into authoritative inputs.
function view(count = 3, mySeat = 0) {
  return {
    phase: 'playing', you: mySeat, gameMode: 'flower',
    game: {
      gameMode: 'flower', phase: 'turn', mySeat, wallCount: 104,
      players: Array.from({ length: count }, (_, seat) => ({ seat, handCount: 13, hand: [seat, 2], melds: [], winPile: [], radishes: [] })),
      discards: [], sharedRadishes: [], pendingKongRadishes: 0,
    },
  };
}
function freezeDeep(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

// 穷举每个本人座位，固定原桌左右；三人桌不能伪造北家，四人桌保留对家。
// Enumerate every own seat, preserving original left/right; three players never invent north and four retain the opposite seat.
for (const count of [3, 4]) {
  for (let mySeat = 0; mySeat < count; mySeat++) {
    test(`${count} seats, self ${mySeat}: stable physical order`, () => {
      const state = view(count, mySeat);
      state.game.players.reverse();
      const layout = realisticSeatLayout(state.game.players, mySeat);
      assert.deepEqual(layout.map(({ position }) => position), count === 3 ? ['south', 'right', 'left'] : ['south', 'right', 'north', 'left']);
      assert.deepEqual(layout.map(({ seat }) => seat), Array.from({ length: count }, (_, index) => (mySeat - index + count) % count));
      assert.equal(layout.filter(({ isSelf }) => isSelf).length, 1);
      assert.equal(layout[0].isSelf, true);
      assert.equal(layout[0].zones.melds.x < layout[0].zones.wins.x, true);
      assert.equal(layout[0].zones.hand.y > layout[0].zones.wall.y, true);
      assert.equal(layout[0].zones.wall.y > layout[0].zones.river.y, true);
    });
  }
}

test('spectators have no self and invalid seat arrays fail closed', () => {
  assert.equal(realisticSeatLayout(view().game.players).some(({ isSelf }) => isSelf), false);
  for (const players of [null, [], [{ seat: 0 }], [{ seat: 0 }, { seat: 0 }, { seat: 2 }], [{ seat: 0 }, { seat: 1 }, { seat: 4 }]]) {
    assert.deepEqual(realisticSeatLayout(players, 0), []);
  }
});

test('wall segmentation conserves public counts across variable decks and never reads wall identities', () => {
  for (const count of [3, 4]) {
    for (const remaining of [0, 1, 2, 71, 104, 144, 216, 288, 576]) {
      const walls = realisticWallCounts(remaining, count);
      assert.equal(walls.reduce((sum, value) => sum + value, 0), remaining);
      assert.ok(Math.max(...walls) - Math.min(...walls) <= 1);
    }
  }
  assert.deepEqual(realisticWallCounts(undefined, 3), [null, null, null]);
  assert.deepEqual(realisticWallCounts(-1, 4), [null, null, null, null]);
  assert.deepEqual(realisticWallCounts(42, 2), []);
  const state = view();
  Object.defineProperty(state.game, 'wall', { get() { throw Error('private wall accessed'); } });
  assert.equal(buildRealisticTableModel(state).wallCount, 104);
});

test('only own hand is shown; spectator and inconsistent identity remain concealed', () => {
  const state = view();
  const model = buildRealisticTableModel(state);
  assert.deepEqual(model.seats[0].hand.map(({ tile }) => tile), [0, 2]);
  assert.equal(model.seats[1].hand.length, 13);
  assert.ok(model.seats[1].hand.every(({ tile, hidden }) => tile === null && hidden));
  state.you = null;
  assert.ok(buildRealisticTableModel(state).seats.every(({ hand }) => hand.every(({ hidden }) => hidden)));
  state.game.mySeat = null;
  assert.ok(buildRealisticTableModel(state).seats.every(({ isSelf }) => !isSelf));
});

test('hidden meld/win metadata cannot leak, while extended and virtual flags survive', () => {
  const state = view();
  state.game.players[1].melds = [{ type: 'anGang', tiles: [3, 3, 3, 3], tile: 3, hidden: true, extended: true, secret: 'no' }];
  state.game.players[1].winPile = [{ tile: 6, hidden: true, source: 'selfDraw', virtual: true, secret: 'no' }];
  const player = buildRealisticTableModel(state).seats.find(({ seat }) => seat === 1);
  assert.ok(player.melds[0].tiles.every(({ tile, hidden }) => tile === null && hidden));
  assert.equal(player.melds[0].extended, true);
  assert.deepEqual(player.wins, [{ tile: null, hidden: true, source: 'selfDraw', virtual: true }]);
  assert.equal(JSON.stringify(player).includes('secret'), false);
});

test('claimed rivers remove seat zero claims and hu references without filtering an active offered tile', () => {
  const state = view();
  state.game.discards = [
    { seat: 1, tile: 3 }, { seat: 1, tile: 4, claimedBy: 0, claimedAs: 'peng' },
    { seat: 1, tile: 5, huSeats: [0, 2] }, { seat: 1, tile: 6, claimable: true },
  ];
  const river = buildRealisticTableModel(state).seats.find(({ seat }) => seat === 1).discards;
  assert.deepEqual(river.map(({ tile, index }) => [tile, index]), [[3, 0], [6, 3]]);
});

test('personal radishes remain owned while authoritative shared pools remain central', () => {
  const state = view();
  state.game.players[0].radishes = [4, 5];
  assert.equal(buildRealisticTableModel(state).radishMode, 'shared');
  assert.deepEqual(buildRealisticTableModel(state).radishes, []);
  delete state.game.sharedRadishes;
  const legacy = buildRealisticTableModel(state);
  assert.equal(legacy.radishMode, 'personal');
  assert.deepEqual(legacy.radishes, []);
  assert.deepEqual(legacy.seats[0].personalRadishes.map(({ tile }) => tile), [4, 5]);
  assert.equal(legacy.pendingRadishes, null);
  state.game.schemaVersion = 3;
  state.game.pendingKongRadishes = 2;
  assert.deepEqual(buildRealisticTableModel(state).radishes, []);
  assert.equal(buildRealisticTableModel(state).pendingRadishes, 2);
  for (const schemaVersion of [1, 2]) {
    state.game.schemaVersion = schemaVersion;
    state.game.sharedRadishes = [6];
    assert.equal(buildRealisticTableModel(state).radishMode, 'personal');
    assert.deepEqual(buildRealisticTableModel(state).radishes, []);
  }
});

// 用旧引擎真正接受的自摸验证无winPile的v1；牌墙由完整八副配额扣除手牌生成，保持合法守恒。
// Exercise an engine-accepted self draw, including v1 without winPile; debit hands from eight copies to conserve every physical tile.
for (const version of ['legacy', 'v2']) {
  test(`${version} legal engine hu preserves independent count and personal radishes`, async () => {
    const engine = await import(`../shared/${version}-game.js`);
    let game = engine.createGame({ seed: 'realistic-legacy-public-view' });
    const waiting = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
    game.players.forEach((player, seat) => { player.hand = seat === 0 ? [...waiting, 17] : [...waiting]; });
    const counts = Array(18).fill(8);
    game.players.flatMap((player) => player.hand).forEach((tile) => counts[tile]--);
    game.wall = counts.flatMap((count, tile) => Array(count).fill(tile));
    game.phase = 'turn';
    game.currentSeat = 0;
    game.turnStep = 'discard';
    game.lastDraw = { seat: 0, tile: 17, source: 'normal' };
    game.drawKind = 'normal';
    engine.assertGameInvariants(game);
    assert.ok(engine.getLegalActions(game, 0).some((action) => action.type === 'hu'));
    game = engine.applyAction(game, 0, { type: 'hu' });
    engine.assertGameInvariants(game);
    const publicView = engine.getPlayerView(game, 0);
    const model = buildRealisticTableModel({ phase: 'playing', you: 0, game: publicView });
    assert.equal(model.radishMode, 'personal');
    assert.deepEqual(model.radishes, []);
    assert.equal(model.seats[0].huCount, 1);
    assert.ok(model.seats[0].personalRadishes.length > 0);
    for (const seat of model.seats) {
      assert.deepEqual(seat.personalRadishes.map(({ tile }) => tile), publicView.players[seat.seat].radishes);
      assert.equal(seat.huCount, publicView.players[seat.seat].huCount);
    }
    if (version === 'legacy') assert.equal(model.seats[0].wins.length, 0);
  });
}

test('terminal hand reveal requires both finish gates and the existing authoritative summary', () => {
  const state = view();
  state.game.roundSummary = { gameMode: 'flower', players: state.game.players.map(({ seat }) => ({ seat, finalHand: [7, 8] })) };
  state.game.phase = 'finished';
  assert.ok(buildRealisticTableModel(state).seats[1].hand.every(({ hidden }) => hidden));
  state.phase = 'finished';
  assert.deepEqual(buildRealisticTableModel(state).seats[1].hand.map(({ tile }) => tile), [7, 8]);
  state.game.roundSummary.players[1].finalHand = [];
  assert.deepEqual(buildRealisticTableModel(state).seats.find(({ seat }) => seat === 1).hand, []);
  delete state.game.roundSummary;
  assert.ok(buildRealisticTableModel(state).seats[1].hand.every(({ hidden }) => hidden));
});

test('pure model copies all data and preserves unknown counts and valid mode tile ranges', () => {
  const state = view();
  delete state.game.wallCount;
  state.game.players[0].hand = [17, 18, null, -1, '1'];
  freezeDeep(state);
  const model = buildRealisticTableModel(state);
  assert.equal(model.wallCount, null);
  assert.deepEqual(model.seats[0].hand.map(({ tile }) => tile), [17, null, null, null, null]);
  model.seats[0].zones.hand.x = 999;
  assert.notEqual(buildRealisticTableModel(state).seats[0].zones.hand.x, 999);
  const chengdu = view(4);
  chengdu.gameMode = chengdu.game.gameMode = 'chengdu';
  chengdu.game.players[0].hand = [18, 26, 27];
  assert.deepEqual(buildRealisticTableModel(chengdu).seats[0].hand.map(({ tile }) => tile), [18, 26, null]);
});

test('uniform viewport fitting is deterministic and always contains the whole default table', () => {
  assert.deepEqual(REALISTIC_TABLE_SIZE, { width: 1000, height: 1000 });
  for (const [width, height] of [[320, 480], [1440, 900], [800, 800], [0, 0], [15, 15]]) {
    const fit = fitRealisticTable(width, height);
    assert.deepEqual(fit, fitRealisticTable(width, height));
    assert.ok(fit.scale >= 0 && Number.isFinite(fit.scale));
    assert.ok(fit.width <= width && fit.height <= height);
    assert.ok(fit.x >= 0 && fit.y >= 0);
  }
  assert.equal(fitRealisticTable(NaN, Infinity).scale, 0);
});

test('temporary drag clamps in screen pixels and release resets both axes', () => {
  assert.deepEqual(clampRealisticPan({ x: 999, y: -999 }, 320, 480), { x: 80, y: -120 });
  assert.deepEqual(clampRealisticPan({ x: NaN, y: Infinity }, 320, 480), { x: 0, y: 0 });
  assert.deepEqual(resetRealisticPan(), { x: 0, y: 0 });
});

test('every tile in dense rivers fits its zone rather than disappearing under a cap', () => {
  for (const count of [1, 13, 72, 144, 288, 576]) {
    const grid = fitRealisticTileGrid(count, 340, 140);
    assert.ok(grid.columns * grid.rows >= count);
    assert.ok(grid.columns * grid.tileWidth + (grid.columns - 1) * grid.gap <= 340.000001);
    assert.ok(grid.rows * grid.tileHeight + (grid.rows - 1) * grid.gap <= 140.000001);
    assert.ok(grid.tileHeight > 0);
  }
  assert.equal(fitRealisticTileGrid(0, 340, 140).columns, 0);
});

test('rotated animation anchors retain each player local left/right', () => {
  const layout = realisticSeatLayout(view(4).game.players, 0);
  const southMelds = realisticZoneCenter(layout[0], 'melds');
  const southWins = realisticZoneCenter(layout[0], 'wins');
  assert.ok(southMelds.x < southWins.x);
  assert.ok(realisticZoneCenter(layout[1], 'melds').y > realisticZoneCenter(layout[1], 'wins').y);
  assert.equal(realisticZoneCenter(layout[0], 'absent'), null);
});

// 成都保留独立字段语义，不因换皮引入花麻将赢牌/萝卜规则；观战身份高于混入的本人字段。
// Preserve Chengdu's independent fields without importing Flower wins/radishes; spectator role overrides stray own-seat fields.
test('Chengdu won, claimed, winning and absent radish zones keep their own protocol', () => {
  const state = view(4);
  state.gameMode = state.game.gameMode = 'chengdu';
  state.game.players[1].won = { tile: 24, hidden: true, source: 'selfDraw' };
  state.game.players[1].winPile = [{ tile: 8 }];
  state.game.sharedRadishes = [2];
  state.game.pendingKongRadishes = 5;
  state.game.discards = [{ seat: 1, tile: 21, claimed: true }, { seat: 1, tile: 22, claimed: false, winning: true }];
  const model = buildRealisticTableModel(state);
  const player = model.seats.find(({ seat }) => seat === 1);
  assert.deepEqual(player.wins, [{ tile: null, hidden: true, source: 'selfDraw', virtual: false }]);
  assert.deepEqual(player.discards.map(({ tile }) => tile), [22]);
  assert.deepEqual(model.radishes, []);
  assert.equal(model.pendingRadishes, null);
  state.viewerRole = 'spectator';
  assert.ok(buildRealisticTableModel(state).seats.every(({ isSelf, hand }) => !isSelf && hand.every(({ hidden }) => hidden)));
});

// 每个旋转矩形都参与两两碰撞检查，防止本地方位正确却在相邻玩家的拐角堆到一起。
// Check every rotated rectangle pair, preventing locally correct zones from colliding at neighboring players' corners.
test('all rotated public zones remain inside the board without cross-player overlaps', () => {
  for (const count of [3, 4]) {
    const layout = realisticSeatLayout(view(count).game.players, 0);
    const rectangles = layout.flatMap((location) => Object.entries(location.zones).map(([name, zone]) => {
      const center = realisticZoneCenter(location, name);
      const sideways = Math.abs(location.rotation) === 90;
      const width = sideways ? zone.height : zone.width;
      const height = sideways ? zone.width : zone.height;
      return { seat: location.seat, name, left: center.x - width / 2, right: center.x + width / 2,
        top: center.y - height / 2, bottom: center.y + height / 2 };
    }));
    for (const rectangle of rectangles) {
      assert.ok(rectangle.left >= -0.00001 && rectangle.right <= 1000.00001);
      assert.ok(rectangle.top >= -0.00001 && rectangle.bottom <= 1000.00001);
    }
    for (let index = 0; index < rectangles.length; index++) {
      for (const other of rectangles.slice(index + 1)) {
        const rectangle = rectangles[index];
        const overlapWidth = Math.min(rectangle.right, other.right) - Math.max(rectangle.left, other.left);
        const overlapHeight = Math.min(rectangle.bottom, other.bottom) - Math.max(rectangle.top, other.top);
        assert.ok(overlapWidth <= 0.00001 || overlapHeight <= 0.00001,
          `${count} players: ${rectangle.seat}/${rectangle.name} overlaps ${other.seat}/${other.name}`);
      }
    }
  }
});

// 四面墙无论三人/四人都保留初始垛位，公开余牌之和必须与标题完全一致。
// Four walls retain original slots for both player counts, and their public remaining sum must match the heading exactly.
test('three players retain four walls with sequential depletion and fixed empty stacks', () => {
  const state = view(3);
  state.game.dealerSeat = 0;
  const initial = buildRealisticTableModel(state);
  assert.deepEqual(initial.walls.map(({ position }) => position), ['south', 'right', 'north', 'left']);
  assert.equal(initial.wallDistribution, 'sequential-public-counts');
  assert.equal(initial.wallIsApproximate, true);
  assert.deepEqual(initial.walls.map(({ wallCount }) => wallCount), [0, 32, 36, 36]);
  assert.ok(initial.walls.every(({ slots }) => slots.length === 18));
  assert.ok(initial.walls[0].slots.every(({ remainingLayers }) => remainingLayers === 0));
  state.game.wallCount--;
  const drawn = buildRealisticTableModel(state);
  assert.deepEqual(drawn.walls.map(({ wallCount }) => wallCount), [0, 31, 36, 36]);
  assert.deepEqual(drawn.walls.map(({ slots }) => slots.map(({ index }) => index)), initial.walls.map(({ slots }) => slots.map(({ index }) => index)));
  assert.equal(drawn.walls.flatMap(({ slots }) => slots).reduce((sum, { remainingLayers }) => sum + remainingLayers, 0), 103);
  assert.ok(drawn.drawAnchor && drawn.wallTailAnchor);
});

test('Flower radishes remove the reverse tail while natural draws move the front only', () => {
  const state = view();
  state.game.dealerSeat = 0;
  const initial = buildRealisticTableModel(state);
  state.game.sharedRadishes = [1];
  state.game.wallCount = 103;
  const radish = buildRealisticTableModel(state);
  assert.deepEqual(radish.walls.map(({ wallCount }) => wallCount), [0, 32, 36, 35]);
  assert.deepEqual(radish.drawAnchor, initial.drawAnchor);
  assert.equal(radish.walls[3].slots.at(-1).remainingLayers, 1);
  state.game.sharedRadishes.push(2);
  state.game.wallCount = 102;
  assert.equal(buildRealisticTableModel(state).walls[3].slots.at(-1).remainingLayers, 0);
  const beforeDraw = buildRealisticTableModel(state);
  state.game.wallCount = 101;
  const afterDraw = buildRealisticTableModel(state);
  assert.deepEqual(afterDraw.wallTailAnchor, beforeDraw.wallTailAnchor);
  assert.deepEqual(afterDraw.walls.map(({ wallCount }) => wallCount), [0, 31, 36, 34]);
});

test('every supported deck budget conserves tiles and single layers without changing slot indices', () => {
  for (let deckCount = 1; deckCount <= 5; deckCount += 0.5) {
    const state = view(4);
    state.game.rules = { deckCount };
    state.game.dealerSeat = 2;
    const total = deckCount * 72;
    for (const wallCount of [total, total - 1, total - 40, 1, 0]) {
      state.game.wallCount = wallCount;
      const model = buildRealisticTableModel(state);
      assert.equal(model.wallDistribution, 'sequential-public-counts');
      assert.equal(model.walls.reduce((sum, wall) => sum + wall.wallCount, 0), wallCount);
      assert.ok(model.walls.every(({ slots }) => slots.length === Math.ceil(total / 8)));
      assert.ok(model.walls.flatMap(({ slots }) => slots).every(({ remainingLayers }) => [0, 1, 2].includes(remainingLayers)));
      if (!wallCount) { assert.equal(model.drawAnchor, null); assert.equal(model.wallTailAnchor, null); }
    }
  }
});

test('dealer-relative visual break rotates consistently without pretending to know dice or hidden tiles', () => {
  const state = view(4, 0);
  state.game.rules = { deckCount: 2 };
  state.game.wallCount = 143;
  state.game.dealerSeat = 1;
  Object.defineProperty(state.game, 'wall', { get() { throw Error('private wall accessed'); } });
  const model = buildRealisticTableModel(state);
  assert.deepEqual(model.walls.map(({ wallCount }) => wallCount), [36, 36, 36, 35]);
  assert.ok(model.drawAnchor.x < 500);
  assert.equal(model.wallIsApproximate, true);
  assert.equal(JSON.stringify(model.walls).includes('tile'), false);
});

test('Chengdu uses108 tiles, no Flower tail, while legacy Flower defaults144', () => {
  const state = view(4);
  state.gameMode = state.game.gameMode = 'chengdu';
  state.game.rules = { deckCount: 5 };
  state.game.wallCount = 55;
  state.game.sharedRadishes = [1, 2, 3];
  const model = buildRealisticTableModel(state);
  assert.deepEqual(model.walls.map(({ wallCount }) => wallCount), [0, 1, 27, 27]);
  assert.ok(model.walls.every(({ slots }) => slots.length === 14));
  assert.equal(buildRealisticTableModel(view()).walls.reduce((sum, wall) => sum + wall.slots.length, 0), 72);
});

test('missing or impossible public inputs yield honest four-sided fallback, never inferred hidden data', () => {
  for (const deckCount of [null, '2', 0, 1.2, 5.5, Infinity]) {
    const state = view();
    state.game.rules = { deckCount };
    const model = buildRealisticTableModel(state);
    assert.equal(model.wallDistribution, 'equal-count-fallback');
    assert.deepEqual(model.walls.map(({ wallCount }) => wallCount), [26, 26, 26, 26]);
    assert.equal(model.drawAnchor, null);
    assert.equal(model.wallTailAnchor, null);
  }
  const impossible = view();
  impossible.game.wallCount = 145;
  assert.equal(buildRealisticTableModel(impossible).wallDistribution, 'equal-count-fallback');
  impossible.game.wallCount = 140;
  impossible.game.sharedRadishes = Array(5).fill(0);
  assert.equal(buildRealisticTableModel(impossible).wallDistribution, 'equal-count-fallback');
  delete impossible.game.wallCount;
  const unknown = buildRealisticTableModel(impossible);
  assert.equal(unknown.wallDistribution, 'unknown');
  assert.ok(unknown.walls.every(({ wallCount, slots }) => wallCount === null && slots.length === 0));
});

// 两倍缩放后四边均可拖入视窗；释放回中，不要求旧调用提供场景尺寸。
// Every scene edge remains reachable at double zoom; release returns home and legacy callers need no scene dimensions.
test('double-zoom pan reaches all scaled scene edges without changing default travel', () => {
  const width = 900, height = 700;
  const scale = Math.min(width / 1360, height / 1250) * 2;
  const sceneWidth = 1360 * scale, sceneHeight = 1250 * scale;
  const positive = clampRealisticPan({ x: 1e6, y: 1e6 }, width, height, sceneWidth, sceneHeight);
  const negative = clampRealisticPan({ x: -1e6, y: -1e6 }, width, height, sceneWidth, sceneHeight);
  assert.ok((width - sceneWidth) / 2 + positive.x >= 0);
  assert.ok((height - sceneHeight) / 2 + positive.y >= 0);
  assert.ok((width + sceneWidth) / 2 + negative.x <= width);
  assert.ok((height + sceneHeight) / 2 + negative.y <= height);
  assert.deepEqual(clampRealisticPan({ x: 1e6, y: -1e6 }, width, height), { x: 225, y: -175 });
  assert.deepEqual(resetRealisticPan(), { x: 0, y: 0 });
});
