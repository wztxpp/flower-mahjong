/**
 * 成都准备房间合同：真实 API、隔离存储、固定配置和安全开局闸门，不运行未完成玩法。
 * Chengdu preparation-room contract: real API, isolated stores, fixed settings and fail-closed starts, never unfinished gameplay.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../server/api.js';
import { MemoryStore } from '../server/store.js';
import { FileStore } from '../server/node.js';
import { validateChengduRoomSettings, isChengduRoomSettings } from '../shared/chengdu-room-settings.js';

const SETTINGS = Object.freeze({ playerCount: 4, dingque: true, endCondition: 'bloodBattle', exchangeThree: false, selfDraw: 'addBase', fanCap: 4 });

// HTTP 请求始终经过身份/CAS校验，辅助函数不会伪造玩家或绕过路由。
// Requests always pass authentication/CAS; this helper does not forge occupants or bypass routes.
function harness(store = new MemoryStore()) {
  const api = createApi(store);
  return {
    store,
    async request(path, body, token) {
      const response = await api(new Request(`http://chengdu.test/api${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }));
      return { status: response.status, ...await response.json() };
    },
  };
}

// 通过真实创建/加入收集四份凭证；不把“房间已准备”冒充“牌局已开始”。
// Collect four credentials through create/join, never confuse a ready room with a started game.
async function roomWithFour(app) {
  const created = await app.request('/rooms', { name: '房主', gameMode: 'chengdu', settings: SETTINGS, preferredCharacter: 'sweet' });
  assert.equal(created.status, 201);
  const path = `/rooms/${created.roomId}`;
  const tokens = [created.token];
  let state = created.state;
  for (const seat of [1, 2, 3]) {
    const result = await app.request(`${path}/join`, { name: `牌友${seat}` });
    assert.equal(result.status, 201);
    tokens.push(result.token);
    state = result.state;
  }
  return { path, id: created.roomId, state, tokens };
}

// 枚举2×2×2×3种明确选择，输入和输出独立，false 不得被误替换为默认true。
// Enumerate all 24 choices; copies are independent and false never becomes an assumed true default.
test('all 24 Chengdu room configurations are explicit, copied and fixed to four seats', () => {
  for (const endCondition of ['firstWin', 'bloodBattle']) {
    for (const exchangeThree of [true, false]) {
      for (const selfDraw of ['addBase', 'addFan']) {
        for (const fanCap of [4, 5, 6]) {
          const input = { endCondition, exchangeThree, selfDraw, fanCap };
          const before = structuredClone(input);
          assert.deepEqual(validateChengduRoomSettings(input), { playerCount: 4, dingque: true, ...input });
          assert.deepEqual(input, before);
          assert.equal(isChengduRoomSettings(input), true);
        }
      }
    }
  }
  for (const key of ['endCondition', 'exchangeThree', 'selfDraw', 'fanCap']) {
    const input = { ...SETTINGS };
    delete input[key];
    assert.equal(isChengduRoomSettings(input), false);
  }
});

// 未知/跨玩法字段、关闭定缺、非四人及错误类型必须在创建座位前失败。
// Reject unknown/cross-mode keys, disabled dingque, non-four seats and wrong types before creating seats.
test('invalid Chengdu settings reject before room, profile or game writes', async () => {
  const app = harness();
  const invalid = [undefined, null, [], {},
    ...[3, 5, '4', null].map(playerCount => ({ ...SETTINGS, playerCount })),
    { ...SETTINGS, dingque: false }, { ...SETTINGS, fanCap: '4' }, { ...SETTINGS, fanCap: 7 },
    { ...SETTINGS, selfDraw: 'other' }, { ...SETTINGS, exchangeThree: 'false' },
    { ...SETTINGS, deckCount: 2 }, { ...SETTINGS, dragonStartCount: 6 },
    { ...SETTINGS, autoDiscardAfterHu: true }, { ...SETTINGS, approved: true },
  ];
  for (const settings of invalid) {
    const result = await app.request('/rooms', { name: '验证', gameMode: 'chengdu', settings });
    assert.equal(result.status, 400);
    assert.equal(result.code, 'BAD_ROOM_SETTINGS');
    assert.equal(app.store.rooms.size, 0);
    assert.equal(app.store.profiles.size, 0);
  }
});

// 满员开局走独立成都版本；未知选项与非房主仍在写入前拒绝。
// Full rooms start the independent version; unknown options/nonhosts still reject before writes.
test('four-seat Chengdu room preserves settings and starts only with the fixed configuration', async () => {
  const app = harness();
  const room = await roomWithFour(app);
  assert.equal(room.state.gameMode, 'chengdu');
  assert.equal(room.state.rulesVersion, 2);
  assert.equal(room.state.game, null);
  const before = await app.store.get(room.id);
  for (const options of [{ approved: true }, { endCondition: 'firstWin', fanCap: 6 }]) {
    const result = await app.request(`${room.path}/start`, { revision: room.state.revision, options }, room.tokens[0]);
    assert.equal(result.code, 'BAD_START_OPTIONS');
    assert.deepEqual(await app.store.get(room.id), before);
  }
  assert.equal((await app.request(`${room.path}/start`, { revision: room.state.revision }, room.tokens[1])).code, 'HOST_ONLY');
  const result = await app.request(`${room.path}/start`, { revision: room.state.revision, options: {} }, room.tokens[0]);
  assert.equal(result.status, 200);
  assert.equal(result.state.game.gameMode, 'chengdu');
  assert.equal(result.state.game.phase, 'dingque');
  assert.deepEqual(result.state.settings, SETTINGS);
});

// 观战共用独立只读凭证，不占座、不提供动作；离开观战也不影响玩家。
// Spectating reuses separate read-only credentials without seats/actions; spectator departure cannot affect occupants.
test('Chengdu preparation spectators share public choices, remain read-only and leave without effects', async () => {
  const app = harness();
  const room = await roomWithFour(app);
  const watcher = await app.request(`${room.path}/spectate`, {});
  assert.equal(watcher.status, 201);
  assert.equal(watcher.state.viewerRole, 'spectator');
  assert.equal(watcher.state.you, null);
  assert.equal(watcher.state.game, null);
  assert.deepEqual(watcher.state.settings, SETTINGS);
  const before = await app.store.get(room.id);
  for (const operation of ['start', 'action', 'presentation']) {
    const result = await app.request(`${room.path}/${operation}`, { revision: room.state.revision, action: { type: 'exchangeThree', tiles: [0, 0, 0] } }, watcher.token);
    assert.equal(result.code, 'SPECTATOR_READ_ONLY');
  }
  await app.request(`${room.path}/leave`, {}, watcher.token);
  assert.deepEqual(await app.store.get(room.id), before);
});

// 重启/重连/房主离开仍是同一个准备房间，不发牌，不向配置追补花麻将字段。
// Restart/resume/host departure retain the same preparation room without dealing or backfilling Flower settings.
test('Chengdu configuration survives FileStore restart, resume and host replacement', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'chengdu-room-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = harness(new FileStore(directory));
  const room = await roomWithFour(first);
  const restarted = harness(new FileStore(directory));
  const resumed = await restarted.request(`${room.path}/resume`, {}, room.tokens[2]);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.state.you, 2);
  assert.deepEqual(resumed.state.settings, SETTINGS);
  await restarted.request(`${room.path}/leave`, {}, room.tokens[0]);
  const replacement = await restarted.request(`${room.path}/join`, { name: '新牌友', gameMode: 'flower', settings: { playerCount: 3 } });
  assert.equal(replacement.status, 201);
  assert.equal(replacement.state.gameMode, 'chengdu');
  assert.deepEqual(replacement.state.settings, SETTINGS);
  assert.equal(replacement.state.hostSeat, 1);
  assert.equal(replacement.state.game, null);
  assert.equal(replacement.state.rulesVersion, 2);
});
