// 测试公开投影、纯坐标和旧引擎合法合成局；不接触真实牌局。
// Test public projection and geometry, plus legal synthetic legacy-engine fixtures; never access real games.
import test from 'node:test';
import assert from 'node:assert/strict';
import { realisticSeatLayout, buildRealisticTableModel, fitRealisticTileGrid } from '../src/realistic-table-layout.js';

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

// 穷举本人视角：座位先固定四边，再连同空位旋转；不能只验证每人都在南侧而漏掉相互位置矛盾。
// Enumerate viewpoints by rotating fixed physical seats and the vacancy, catching inconsistent relationships beyond merely placing self south.
const expectedSeatsByView = {
  3: [
    [[0, 'south'], [2, 'right'], [1, 'left']],
    [[1, 'south'], [0, 'right'], [2, 'north']],
    [[2, 'south'], [1, 'north'], [0, 'left']],
  ],
  4: [
    [[0, 'south'], [3, 'right'], [2, 'north'], [1, 'left']],
    [[1, 'south'], [0, 'right'], [3, 'north'], [2, 'left']],
    [[2, 'south'], [1, 'right'], [0, 'north'], [3, 'left']],
    [[3, 'south'], [2, 'right'], [1, 'north'], [0, 'left']],
  ],
};
for (const count of [3, 4]) {
  for (let mySeat = 0; mySeat < count; mySeat++) {
    test(`${count} seats, self ${mySeat}: stable physical order`, () => {
      const state = view(count, mySeat);
      state.game.players.reverse();
      const layout = realisticSeatLayout(state.game.players, mySeat);
      assert.deepEqual(layout.map(({ seat, position }) => [seat, position]), expectedSeatsByView[count][mySeat]);
      assert.equal(layout.filter(({ isSelf }) => isSelf).length, 1);
      assert.equal(layout[0].isSelf, true);
    });
  }
}

// 用户报告的关系是三人真桌的基本互易性：本人左右两家互相对坐，而左家看本人在右。
// Regress the reported three-player reciprocity: the original left/right opponents face each other, and the left player sees the original viewer at right.
test('three-player opposite relation survives changing from the south player to the left player', () => {
  const players = view(3).game.players;
  const southView = new Map(realisticSeatLayout(players, 0).map(({ seat, position }) => [seat, position]));
  const leftView = new Map(realisticSeatLayout(players, 1).map(({ seat, position }) => [seat, position]));
  assert.equal(southView.get(1), 'left');
  assert.equal(southView.get(2), 'right');
  assert.equal(leftView.get(2), 'north');
  assert.equal(leftView.get(0), 'right');
  assert.equal([...leftView.values()].includes('left'), false);
});

test('spectators have no self and invalid seat arrays fail closed', () => {
  assert.equal(realisticSeatLayout(view().game.players).some(({ isSelf }) => isSelf), false);
  for (const players of [null, [], [{ seat: 0 }], [{ seat: 0 }, { seat: 0 }, { seat: 2 }], [{ seat: 0 }, { seat: 1 }, { seat: 4 }]]) {
    assert.deepEqual(realisticSeatLayout(players, 0), []);
  }
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
  model.seats[0].hand[0].tile = 999;
  assert.equal(buildRealisticTableModel(state).seats[0].hand[0].tile, 17);
  const chengdu = view(4);
  chengdu.gameMode = chengdu.game.gameMode = 'chengdu';
  chengdu.game.players[0].hand = [18, 26, 27];
  assert.deepEqual(buildRealisticTableModel(chengdu).seats[0].hand.map(({ tile }) => tile), [18, 26, null]);
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

// 三维桌不再生成墙牌，但余牌数仍是公开权威值；禁止读取暗墙。
// No wall meshes are generated, but the remaining count stays authoritative and concealed walls stay unread.
test('public count survives without wall geometry or concealed reads', () => {
  const state = view();
  Object.defineProperty(state.game, 'wall', { get() { throw Error('private wall accessed'); } });
  const model = buildRealisticTableModel(state);
  assert.equal(model.wallCount, 104);
  for (const key of ['walls', 'drawAnchor', 'wallTailAnchor', 'wallDistribution']) assert.equal(Object.hasOwn(model, key), false);
  for (const value of [undefined, -1, NaN, '104']) {
    state.game.wallCount = value;
    assert.equal(buildRealisticTableModel(state).wallCount, null);
  }
});
