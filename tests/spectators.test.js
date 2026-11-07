// 观战权限和名字归属：真实 API 路由及守恒游戏夹具，不读取外部玩家或生产数据。
// Spectator authorization and name attribution use real API routes and conserved fixtures, never production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../server/api.js';
import { MemoryStore } from '../server/store.js';
import { FileStore } from '../server/node.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGame, applyPresentedAction, assertGameInvariants } from '../shared/game.js';
import { createGame as createV2Game } from '../shared/v2-game.js';
import { createGame as createLegacyGame } from '../shared/legacy-game.js';
import { postHuKongGame } from './fixtures/post-hu-kong.js';
import { postHuWinClaim } from './fixtures/post-hu-win.js';
import { spectatorGameView } from '../server/spectators.js';
import { nameEvent } from '../shared/event-names.js';
import { archiveFinishedGame, newGameMetadata, recordsForProfile } from '../server/history.js';

// 所有身份由真实接口发放；直接写存储仅用于安装明确的合成游戏场景。
// Real endpoints issue every credential; direct store writes only install explicit synthetic scenarios.
async function table(store = new MemoryStore()) {
  let api = createApi(store);
  const request = async (path, body, token, headers = {}) => {
    const response = await api(new Request(`https://spectator.test/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  const host = (await request('rooms', { name: '东家' })).body;
  const roomPath = `rooms/${host.roomId}`;
  return { store, host, roomPath, request,
    reload(nextStore) { api = createApi(nextStore); },
    async fill() {
      await request(`${roomPath}/join`, { name: '南家' });
      await request(`${roomPath}/join`, { name: '西家' });
    },
    async install(game) {
      const room = await store.get(host.roomId);
      room.game = game;
      room.gameMeta = newGameMetadata(room, 'synthetic-round', 1);
      assert.equal(await store.compareAndSwap(room, room.revision), true);
    },
  };
}

// 同时核对所有重复公开引用，不能只检查 game.players.hand 后就宣称隐私通过。
// Inspect every duplicate public reference, not merely game.players.hand.
function assertPrivate(view, stored) {
  assert.equal(view.viewerRole, 'spectator');
  assert.equal(view.you, null);
  assert.equal(view.game.mySeat, null);
  assert.deepEqual(view.game.legalActions, []);
  assert.equal(view.game.drawnTile, null);
  assert.deepEqual(view.game.waitTiles, []);
  assert.equal(view.game.huDiagnostic, null);
  assert.equal(view.game.wall, undefined);
  assert.equal(view.presentation, null);
  for (const player of [...view.game.players, ...view.seats.filter(Boolean)]) {
    assert.equal(player.hand, undefined);
    assert.equal(player.tokenHash, undefined);
    assert.equal(player.playerHash, undefined);
    assert.ok((player.winPile || []).filter((win) => win.source === 'selfDraw').every((win) => win.hidden && win.tile === null));
    assert.equal(player.lastScoreBreakdown?.handCounts, undefined);
  }
  assert.ok(view.game.retiredTiles.every((entry) => entry.hidden && entry.tile === null));
  const serialized = JSON.stringify(view);
  assert.ok(!serialized.includes(stored.spectatorKey));
  for (const seat of stored.seats.filter(Boolean)) assert.ok(!serialized.includes(seat.tokenHash));
  assert.ok(!serialized.includes('private-probe'));
}

test('spectators enter lobby and full live rooms without seats, profile records, host or presence writes', async () => {
  const app = await table();
  const before = await app.store.get(app.host.roomId);
  const first = await app.request(`${app.roomPath}/spectate`, {});
  assert.equal(first.status, 201);
  assert.equal(first.body.state.you, null);
  assert.deepEqual(await app.store.get(app.host.roomId), before);
  assert.equal(app.store.profiles.size, 0);
  await app.fill();
  await app.install(applyPresentedAction(postHuKongGame({ winningDraw: true }), 0, { type: 'hu' }));
  const saved = await app.store.get(app.host.roomId);
  saved.game.players[0].lastScoreBreakdown.handCounts = 'private-probe';
  saved.game.history.at(-1).futureSecret = 'private-probe';
  saved.presentation = { id: 'private-probe', owners: { private: 'private-probe' } };
  await app.store.compareAndSwap(saved, saved.revision);
  const second = await app.request(`${app.roomPath}/spectate`, {});
  assert.notEqual(first.body.token, second.body.token);
  assertPrivate(second.body.state, saved);
  for (const suffix of ['', '/resume']) {
    const response = await app.request(`${app.roomPath}${suffix}`, suffix ? {} : undefined, first.body.token);
    assert.equal(response.status, 200);
    assertPrivate(response.body.state, saved);
  }
  const unchanged = await app.request(`${app.roomPath}?since=${saved.revision}`, undefined, first.body.token);
  assert.equal(unchanged.body.unchanged, true);
  assert.deepEqual(await app.store.get(app.host.roomId), saved);
  assert.equal(first.headers.get('cache-control'), 'private, no-store');
});

test('spectator credentials reject every player mutation, forged tokens, cross-room use and cross-origin admission', async () => {
  const app = await table();
  const observer = (await app.request(`${app.roomPath}/spectate`, {})).body;
  const saved = await app.store.get(app.host.roomId);
  for (const operation of ['join', 'start', 'action', 'presentation']) {
    const result = await app.request(`${app.roomPath}/${operation}`, {
      name: '冒名玩家', seat: 0, revision: saved.revision, action: { type: 'draw' },
    }, observer.token);
    assert.equal(result.status, 403, operation);
    assert.equal(result.body.code, 'SPECTATOR_READ_ONLY');
  }
  for (const token of [undefined, 'a'.repeat(64), observer.token.replace(/.$/, observer.token.endsWith('0') ? '1' : '0')]) {
    assert.equal((await app.request(app.roomPath, undefined, token)).status, 401);
  }
  const other = (await app.request('rooms', { name: '另一桌' })).body;
  assert.equal((await app.request(`rooms/${other.roomId}`, undefined, observer.token)).status, 401);
  assert.equal((await app.request(`${app.roomPath}/spectate`, {}, undefined, { origin: 'https://foreign.test' })).status, 403);
  assert.equal((await app.request('profile/history', undefined, observer.token)).status, 401);
  assert.equal((await app.request(`${app.roomPath}/leave`, {}, observer.token)).status, 200);
  assert.deepEqual(await app.store.get(app.host.roomId), saved);
  assert.equal((await app.request(app.roomPath, undefined, app.host.token)).body.state.you, 0);
});

test('legacy saved rooms admit concurrent observers with one bounded key migration and survive storage reload', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'mahjong-spectator-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = await table(new FileStore(directory));
  const saved = await app.store.get(app.host.roomId);
  delete saved.spectatorKey;
  await app.store.compareAndSwap(saved, saved.revision);
  const viewers = await Promise.all([0, 1, 2].map(() => app.request(`${app.roomPath}/spectate`, {})));
  assert.ok(viewers.every((result) => result.status === 201));
  const migrated = await app.store.get(app.host.roomId);
  assert.equal(migrated.revision, saved.revision + 1);
  assert.deepEqual(migrated.seats, saved.seats);
  assert.equal(migrated.hostSeat, saved.hostSeat);
  app.reload(new FileStore(directory));
  for (const viewer of viewers) assert.equal((await app.request(app.roomPath, undefined, viewer.body.token)).status, 200);
});

for (const [version, factory] of [[1, createLegacyGame], [2, createV2Game], [3, createGame]]) {
  test(`schema ${version} observer projection hides all hands and draws without changing the engine state`, async () => {
    const app = await table();
    await app.fill();
    const game = factory({ seed: `spectator-${version}` });
    await app.install(game);
    const saved = await app.store.get(app.host.roomId);
    const response = await app.request(`${app.roomPath}/spectate`, {});
    assert.equal(response.status, 201);
    assertPrivate(response.body.state, saved);
    assert.deepEqual(await app.store.get(app.host.roomId), saved);
    assert.equal(response.body.state.game.schemaVersion, version);
    assert.equal(response.body.state.game.players.length, 3);
  });
}

test('spectators cannot read old opt-out self-draws, private claim options, concealed kongs or unknown score fields', () => {
  const game = applyPresentedAction(postHuKongGame({ winningDraw: true }), 0, { type: 'hu' });
  delete game.rules.hideSelfDrawWins;
  delete game.rules.publicConcealedKongs;
  for (const version of [1, 2, 3]) {
    const old = { ...game, schemaVersion: version };
    const before = structuredClone(old);
    const view = spectatorGameView(old);
    assert.ok(view.players[0].winPile.every((win) => win.hidden));
    assert.equal(view.history.find((event) => event.type === 'hu').tile, null);
    assert.ok(!view.history.find((event) => event.type === 'hu').message.includes('1筒'));
    assert.deepEqual(old, before);
  }
  const kong = postHuKongGame({ type: 'addGang' });
  delete kong.rules.publicConcealedKongs;
  assert.ok(spectatorGameView(kong).players[0].melds[0].tiles.every((tile) => tile === null));
  const claim = spectatorGameView(postHuWinClaim({ multiple: true }));
  assert.equal(claim.claim.options, undefined);
  assert.equal(claim.claim.responses, undefined);
  assert.equal(claim.claim.eligibleSeats, undefined);
  assert.equal(claim.claim.respondedSeats, undefined);
  assertGameInvariants(game);
});

test('finished spectators reveal public winning tiles but never hands or credential metadata', async () => {
  const app = await table();
  await app.fill();
  const game = applyPresentedAction(postHuKongGame({ winningDraw: true }), 0, { type: 'hu' });
  // 只验证终局展示策略，真实终局转换由引擎测试覆盖；不把展示夹具当成合法动作链。
  // Test the finished display policy only; engine suites cover actual terminal transitions.
  game.phase = 'finished';
  await app.install(game);
  const view = (await app.request(`${app.roomPath}/spectate`, {})).body.state;
  assert.equal(view.game.players[0].winPile.at(-1).tile, game.players[0].winPile.at(-1).tile);
  assert.equal(view.game.history.find((event) => event.type === 'hu').tile, game.history.find((event) => event.type === 'hu').tile);
  assert.ok(view.game.players.every((player) => !Object.hasOwn(player, 'hand')));
  assert.equal(view.game.scoreBreakdown, null);
  assert.deepEqual(view.game.legalActions, []);
});

test('game log names resolve all participants once, including a fourth seat and literal name content', () => {
  const event = { message: '4号位接炮，1号位付10分，2号位与3号位过。' };
  const names = ['一号位与2号位$&', '<img src=x>', '牌友丙', '牌友丁'];
  assert.equal(nameEvent(event, names).message, '牌友丁接炮，一号位与2号位$&付10分，<img src=x>与牌友丙过。');
  assert.equal(event.message, '4号位接炮，1号位付10分，2号位与3号位过。');
  assert.equal(nameEvent({ message: '9号位离席' }, names).message, '9号位离席');
});

test('live and archived logs keep each game participant snapshot after a seat replacement', async () => {
  const app = await table();
  await app.fill();
  const game = createGame({ seed: 'stable-names' });
  game.phase = 'finished';
  game.history = [{ type: 'hu', seat: 1, fromSeat: 0, source: 'discard', message: '2号位接炮，1号位付款。' }];
  await app.install(game);
  const room = await app.store.get(app.host.roomId);
  room.gameMeta.participants[0].playerHash = 'profile-old';
  room.archivedGames = [archiveFinishedGame(room)];
  room.seats[0] = { ...room.seats[0], name: '后来的人', tokenHash: 'replacement-token' };
  const record = recordsForProfile(room, 'profile-old')[0];
  assert.equal(record.events[0].message, '南家接炮，东家付款。');
  await app.store.compareAndSwap(room, room.revision);
  const view = (await app.request(`${app.roomPath}/spectate`, {})).body.state;
  assert.equal(view.game.history[0].message, '南家接炮，东家付款。');
  assert.equal(view.game.participantNames[0], '东家');
  assert.equal(view.seats[0].name, '后来的人');
  assert.equal(view.seats[0].isCurrentParticipant, false);
  assert.deepEqual((await app.store.get(app.host.roomId)).game.history, game.history);
});

test('leave lifecycle stores the departing name before the seat is released', async () => {
  const app = await table();
  const result = await app.request(`${app.roomPath}/leave`, {}, app.host.token);
  assert.equal(result.status, 200);
  const room = await app.store.get(app.host.roomId);
  assert.equal(room.seats[0], null);
  assert.equal(room.lifecycleLog[0].message, '东家离开牌桌。');
  assert.equal(room.lifecycleLog[0].name, '东家');
});

// 在投影层注入未来扩展字段，仅验证防泄漏，不用于发动任何牌局动作。
// Inject future fields at the projection boundary only; never use this data for game actions.
test('spectator allowlists remove nested metadata and preserve a fourth public seat', () => {
  const game = createGame({ seed: 'projection-extension' });
  game.players.push({ ...structuredClone(game.players[2]), seat: 3 });
  game.history.push({ type: 'hu', seat: 1, source: 'discard', tile: 2,
    message: '2号位接炮，4号位付款。',
    payments: [{ seat: 3, delta: -1, secret: 'private-probe' }],
    kongSource: { type: 'mingGang', fromSeat: 3, secret: 'private-probe' },
    score: { total: 1, handCounts: 'private-probe' },
    futureSecret: 'private-probe',
  });
  game.dragonSettlement = { settled: false, secret: 'private-probe', entries: [] };
  const view = spectatorGameView(game);
  assert.equal(view.players.length, 4);
  assert.equal(view.players[3].seat, 3);
  assert.equal(view.players[3].hand, undefined);
  assert.ok(!JSON.stringify(view).includes('private-probe'));
});

test('spectator reads preserve unknown-engine and bearer-format rejection', async () => {
  const app = await table();
  const observer = (await app.request(`${app.roomPath}/spectate`, {})).body;
  assert.equal((await app.request(app.roomPath, undefined, undefined, { authorization: observer.token })).status, 401);
  const room = await app.store.get(app.host.roomId);
  room.game = { schemaVersion: 999 };
  await app.store.compareAndSwap(room, room.revision);
  const result = await app.request(app.roomPath, undefined, observer.token);
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'UNSUPPORTED_GAME_VERSION');
});

// 联合回归用真实三/四人开局、七角色分配与独立观战能力，避免仅拼接第四席掩盖协议冲突。
// Combined regressions use genuine three/four-player starts, seven-role assignments and independent viewer capabilities.
for (const playerCount of [3, 4]) {
  test(`${playerCount}-seat integration keeps assigned characters consistent and spectators read-only`, async () => {
    const store = new MemoryStore();
    const api = createApi(store);
    const request = async (path, body, token) => {
      const response = await api(new Request(`https://integrated.test/api/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }));
      return { status: response.status, ...await response.json() };
    };
    const preferences = ['wealthy', 'landlord', 'honest', 'star'];
    const settings = { playerCount, deckCount: 2.5, dragonStartCount: 9 };
    const host = await request('rooms', { name: '整合玩家0', settings, preferredCharacter: preferences[0] });
    assert.equal(host.status, 201);
    const path = `rooms/${host.roomId}`;
    const viewer = await request(`${path}/spectate`, {});
    assert.equal(viewer.status, 201);
    assert.equal(viewer.state.seats.filter(Boolean).length, 1);
    assert.deepEqual(viewer.state.settings, settings);
    const tokens = [host.token];
    let current = host.state;
    for (let seat = 1; seat < playerCount; seat++) {
      const joined = await request(`${path}/join`, { name: `整合玩家${seat}`, preferredCharacter: preferences[seat] });
      assert.equal(joined.status, 201);
      tokens.push(joined.token);
      current = joined.state;
    }
    const started = await request(`${path}/start`, { revision: current.revision }, tokens[0]);
    assert.equal(started.status, 200);
    const characters = preferences.slice(0, playerCount);
    assert.deepEqual(started.state.game.characters, characters);
    const saved = await store.get(host.roomId);
    const observed = await request(path, undefined, viewer.token);
    assertPrivate(observed.state, saved);
    assert.equal(observed.state.game.players.length, playerCount);
    assert.deepEqual(observed.state.game.characters, characters);
    assert.deepEqual(observed.state.game.participantNames, tokens.map((_, seat) => `整合玩家${seat}`));
    for (const operation of ['start', 'action', 'presentation', 'join']) {
      const denied = await request(`${path}/${operation}`, {
        revision: saved.revision, seat: playerCount - 1, name: '不可顶替', action: { type: 'discard', tile: 0 },
      }, viewer.token);
      assert.equal(denied.status, 403, operation);
      assert.equal(denied.code, 'SPECTATOR_READ_ONLY');
    }
    assert.deepEqual(await store.get(host.roomId), saved);
    for (let seat = 0; seat < playerCount; seat++) {
      const player = (await request(path, undefined, tokens[seat])).state;
      assert.equal(player.you, seat);
      assert.deepEqual(player.game.characters, characters);
      assert.deepEqual(player.game.players[seat].hand, saved.game.players[seat].hand);
      for (const opponent of player.game.players.filter((other) => other.seat !== seat)) {
        assert.equal(opponent.hand, undefined);
      }
    }
    // 用真实动作更新第四席也可见的公开日志；观众轮询只读取，不代替玩家完成展示或行动。
    // A genuine action updates public logs; spectator polling reads without completing player presentation or actions.
    const latest = (await request(path, undefined, tokens[0])).state;
    const discard = latest.game.legalActions.find((action) => action.type === 'discard');
    assert.ok(discard);
    const moved = await request(`${path}/action`, { revision: latest.revision, action: discard }, tokens[0]);
    assert.equal(moved.status, 200);
    const afterMove = await store.get(host.roomId);
    const refreshed = (await request(path, undefined, viewer.token)).state;
    assertPrivate(refreshed, afterMove);
    assert.match(refreshed.game.history.findLast((event) => event.type === 'discard').message, /整合玩家0/);
    assert.deepEqual(refreshed.game.characters, characters);
    assert.deepEqual(await store.get(host.roomId), afterMove);
    assertGameInvariants(afterMove.game);
  });
}
