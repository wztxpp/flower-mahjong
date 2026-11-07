// 隔离请求覆盖建桌配置、三/四座生命周期和历史快照；不访问生产牌局。
// Isolated requests cover table configuration, three/four-seat lifecycles and history snapshots, never production.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../server/node.js';
import { createApi } from '../server/api.js';
import { MemoryStore } from '../server/store.js';
import { createGame, assertGameInvariants } from '../shared/game.js';
import { archiveFinishedGame, recordsForProfile } from '../server/history.js';

// 使用标准 Request 直接调用完整路由；每个场景独立存储及限流状态。
// Exercise the complete router with standard Requests and isolated storage/throttling per scenario.
function harness(store = new MemoryStore()) {
  const api = createApi(store);
  return {
    store,
    async request(path, body, token) {
      const response = await api(new Request(`http://local.test/api${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }));
      return { status: response.status, ...await response.json() };
    },
  };
}

// 通过实际建桌/入座路由获得独立凭证，测试不会直接设置座位身份。
// Obtain separate credentials through real creation/join routes rather than injecting occupant identities.
async function occupiedTable(api, settings) {
  const created = await api.request('/rooms', { name: '东家', ...(settings ? { settings } : {}) });
  assert.equal(created.status, 201);
  const tokens = [created.token];
  let state = created.state;
  for (let seat = 1; seat < state.seats.length; seat++) {
    const joined = await api.request(`/rooms/${created.roomId}/join`, { name: `客人${seat}`, seat });
    assert.equal(joined.status, 201);
    tokens.push(joined.token);
    state = joined.state;
  }
  return { id: created.roomId, tokens, state };
}

// 两种人数乘九种副数；每种实体牌均匀且计数守恒，房间与引擎快照一致。
// Two player counts times nine deck counts: uniform physical copies, conservation and matching snapshots.
for (const playerCount of [3, 4]) {
  for (let deckCount = 1; deckCount <= 5; deckCount += 0.5) {
    test(`${playerCount} players / ${deckCount} decks persists and deals exact configuration`, async () => {
      const api = harness();
      const settings = { playerCount, deckCount, dragonStartCount: 6 };
      const table = await occupiedTable(api, settings);
      const started = await api.request(`/rooms/${table.id}/start`, { revision: table.state.revision }, table.tokens[0]);
      assert.equal(started.status, 200);
      assert.deepEqual(started.state.settings, settings);
      const room = await api.store.get(table.id);
      assert.equal(room.seats.length, playerCount);
      assert.equal(room.game.players.length, playerCount);
      for (const [key, value] of Object.entries(settings)) assert.equal(room.game.rules[key], value);
      assert.equal(room.game.rules.exponentialDragon, true);
      assert.equal(room.game.rules.extendedCopyFan, true);
      assert.deepEqual(room.gameMeta.config, settings);
      const tiles = [...room.game.wall, ...room.game.players.flatMap((player) => player.hand)];
      assert.equal(tiles.length, deckCount * 72);
      for (let tile = 0; tile < 18; tile++) assert.equal(tiles.filter((value) => value === tile).length, deckCount * 4);
      assertGameInvariants(room.game);
    });
  }
}

test('creation validates configuration strictly and defaults only omitted fields', async () => {
  const api = harness();
  const created = await api.request('/rooms', { name: '默认桌' });
  assert.deepEqual(created.state.settings, { playerCount: 3, deckCount: 2, dragonStartCount: 6 });
  const invalid = [null, [], 'bad', { extra: true }, ...[2, 5, '4', null, 3.5].map((playerCount) => ({ playerCount })),
    ...[0.5, 5.5, 1.25, '2', null].map((deckCount) => ({ deckCount })),
    ...[0, 21, 1.5, '6', null].map((dragonStartCount) => ({ dragonStartCount }))];
  for (const settings of invalid) {
    const result = await api.request('/rooms', { name: '无效桌', settings });
    assert.equal(result.status, 400, JSON.stringify(settings));
    assert.equal(result.code, 'BAD_ROOM_SETTINGS');
  }
  for (const dragonStartCount of [1, 20]) {
    const result = await api.request('/rooms', { name: `起算${dragonStartCount}`, settings: { deckCount: 1, dragonStartCount } });
    assert.equal(result.status, 201);
    assert.equal(result.state.settings.dragonStartCount, dragonStartCount);
  }
});

test('four seats require full occupancy, protect tokens, reconnect and preserve next-round configuration', async () => {
  const api = harness();
  const settings = { playerCount: 4, deckCount: 2.5, dragonStartCount: 7 };
  const created = await api.request('/rooms', { name: '房主', settings });
  const path = `/rooms/${created.roomId}`;
  let result = await api.request(`${path}/start`, { revision: 0 }, created.token);
  assert.equal(result.code, 'NOT_FULL');
  for (const seat of [-1, 4, 1.5, '3']) {
    result = await api.request(`${path}/join`, { name: '无效座位', seat });
    assert.equal(result.code, 'ROOM_FULL');
  }
  const tokens = [created.token];
  for (const seat of [1, 2, 3]) {
    result = await api.request(`${path}/join`, { name: `玩家${seat}`, seat });
    assert.equal(result.status, 201);
    tokens.push(result.token);
  }
  assert.equal((await api.request(`${path}/join`, { name: '第五人' })).code, 'ROOM_FULL');
  assert.equal((await api.request(`${path}/start`, { revision: result.state.revision, options: { playerCount: 3 } }, created.token)).code, 'BAD_START_OPTIONS');
  result = await api.request(`${path}/start`, { revision: result.state.revision }, created.token);
  assert.equal(result.status, 200);
  const before = await api.store.get(created.roomId);
  assert.equal((await api.request(path, undefined, 'not-a-token')).status, 401);
  assert.equal((await api.request(`${path}/leave`, {}, tokens[3])).detached, true);
  result = await api.request(`${path}/resume`, {}, tokens[3]);
  assert.equal(result.state.you, 3);
  assert.deepEqual(result.state.game.players[3].hand, before.game.players[3].hand);
  assert.equal(result.state.game.players[0].hand, undefined);
  // 仅用合成终局夹具缩短测试；下一局仍通过房主路由和版本检查产生。
  // A synthetic finish fixture shortens the test; the next round still uses host authorization and revision checks.
  const finished = await api.store.get(created.roomId);
  finished.game.phase = 'finished';
  finished.game.dealerSeat = 3;
  finished.game.history.push({ type: 'hu', seat: 3, revision: 0, message: '测试首胡' });
  finished.game.players.forEach((player) => { player.score = 0; });
  finished.gameMeta.finishedAt = Date.now();
  finished.gameMeta.participants[3].playerHash = 'test-profile';
  assert.equal(await api.store.compareAndSwap(finished, finished.revision), true);
  const archive = archiveFinishedGame(finished);
  assert.deepEqual(archive.game.config, settings);
  assert.equal(archive.game.wall, undefined);
  assert.equal(archive.game.players[3].hand, undefined);
  result = await api.request(`${path}/start`, { revision: finished.revision }, created.token);
  assert.equal(result.status, 200);
  assert.equal(result.state.game.dealerSeat, 3);
  const next = await api.store.get(created.roomId);
  assert.deepEqual(next.settings, settings);
  assert.deepEqual(next.gameMeta.config, settings);
  assert.deepEqual(recordsForProfile(next, 'test-profile')[0].config, settings);
  assert.deepEqual(next.archivedGames[0].game.config, settings);
});

test('saved unconfigured rooms keep current rules and historical records unchanged', async () => {
  const api = harness();
  const table = await occupiedTable(api);
  const saved = await api.store.get(table.id);
  delete saved.settings;
  saved.game = createGame({ seed: 19 });
  for (const key of ['playerCount', 'deckCount', 'dragonStartCount', 'exponentialDragon', 'extendedCopyFan']) delete saved.game.rules[key];
  const originalGame = structuredClone(saved.game);
  assert.equal(await api.store.compareAndSwap(saved, saved.revision), true);
  const reloaded = harness(new MemoryStore([saved]));
  const read = await reloaded.request(`/rooms/${table.id}`, undefined, table.tokens[0]);
  assert.equal(read.status, 200);
  assert.equal(Object.hasOwn(read.state, 'settings'), false);
  const unchanged = await reloaded.store.get(table.id);
  assert.deepEqual(unchanged.game, originalGame);
  assert.equal(Object.hasOwn(unchanged, 'settings'), false);
  unchanged.game.phase = 'finished';
  assert.equal(await reloaded.store.compareAndSwap(unchanged, unchanged.revision), true);
  const started = await reloaded.request(`/rooms/${table.id}/start`, { revision: unchanged.revision }, table.tokens[0]);
  assert.equal(started.status, 200);
  const next = await reloaded.store.get(table.id);
  assert.equal(Object.hasOwn(next, 'settings'), false);
  assert.equal(Object.hasOwn(next.archivedGames[0].game, 'config'), false);
  assert.equal(Object.hasOwn(next.archivedGames[0].meta, 'config'), false);
  assert.deepEqual(next.gameMeta.config, { playerCount: 3, deckCount: 2, dragonStartCount: 6 });
  assert.equal(next.game.rules.exponentialDragon, true);
});

// 真正重建文件存储与 API，确认第四座凭证、私人手牌、角色和配置均从磁盘恢复。
// Recreate the file store and API to verify fourth-seat credentials, private hand, character and settings survive disk reload.
test('FileStore restores fourth-seat identity and immutable table configuration', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'mahjong-variable-room-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settings = { playerCount: 4, deckCount: 1.5, dragonStartCount: 20 };
  const api = harness(new FileStore(directory));
  const table = await occupiedTable(api, settings);
  const path = `/rooms/${table.id}`;
  const started = await api.request(`${path}/start`, { revision: table.state.revision }, table.tokens[0]);
  assert.equal(started.status, 200);
  const original = await api.store.get(table.id);
  assert.equal(new Set(original.gameMeta.characters).size, 4);
  const left = await api.request(`${path}/leave`, {}, table.tokens[3]);
  assert.equal(left.detached, true);

  // 新实例不复用内存对象；先拒绝伪造凭证，再仅凭原第四座凭证重连。
  // A fresh instance reuses no memory objects; reject a forged credential before reconnecting with the original fourth-seat secret.
  const restarted = harness(new FileStore(directory));
  assert.equal((await restarted.request(`${path}/resume`, {}, 'forged-seat-token')).status, 401);
  const resumed = await restarted.request(`${path}/resume`, {}, table.tokens[3]);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.state.you, 3);
  assert.deepEqual(resumed.state.settings, settings);
  assert.deepEqual(resumed.state.game.players[3].hand, original.game.players[3].hand);
  for (const seat of [0, 1, 2]) assert.equal(resumed.state.game.players[seat].hand, undefined);
  assert.equal(resumed.state.seats[3].characterId, original.gameMeta.characters[3]);
  assert.deepEqual(resumed.state.game.characters, original.gameMeta.characters);
  const restored = await restarted.store.get(table.id);
  assert.deepEqual(restored.game, original.game);
  assert.deepEqual(restored.gameMeta.config, settings);
  assert.equal(restored.seats[3].tokenHash, original.seats[3].tokenHash);
  assert.equal(restored.seats[3].detached, false);
  assert.equal((await restarted.request(`${path}/join`, { name: '不能替换第四座', seat: 3 })).code, 'STARTED');
  // 再次重建确认恢复本身也已持久化，不只是响应中的临时状态。
  // Reload once more to confirm resume was persisted rather than merely reflected in the response.
  const secondReload = new FileStore(directory);
  const persisted = await secondReload.get(table.id);
  assert.deepEqual(persisted.settings, settings);
  assert.equal(persisted.seats[3].detached, false);
  assert.deepEqual(persisted.gameMeta.characters, original.gameMeta.characters);
});
