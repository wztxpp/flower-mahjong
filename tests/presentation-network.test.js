// 真实 HTTP 路由的只读竞争回归；所有房间均在独立内存中，不访问线上。
// Read-contention regressions use real HTTP routing with isolated memory rooms, never production.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError } from '../server/api.js';
import { MemoryStore } from '../server/store.js';

// 三人凭证和可控心跳用于在确定位置插入并发写，不依赖睡眠或真实网络。
// Three credentials and controlled heartbeat timestamps inject deterministic races without timers/network.
async function table() {
  const store = new MemoryStore();
  const handle = createApi(store);
  const tokens = [];
  async function request(path, seat, body, headers = {}) {
    const response = await handle(new Request(`https://isolated.test/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(seat === undefined ? {} : { authorization: `Bearer ${tokens[seat]}` }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    return { status: response.status, ...await response.json() };
  }
  const created = await request('rooms', undefined, { name: '甲' });
  const id = created.roomId;
  tokens.push(created.token);
  for (const name of ['乙', '丙']) tokens.push((await request(`rooms/${id}/join`, undefined, { name })).token);
  const room = await store.get(id);
  room.seats[0].lastSeen = Date.now() - 11000;
  await store.compareAndSwap(room, room.revision);
  return { store, id, request, get: (headers = {}) => request(`rooms/${id}`, 0, undefined, headers) };
}

// 注入另一个成功房间提交，模拟动作/遥测先于本次 heartbeat 完成。
// Commit another room revision before this read's heartbeat, simulating action/telemetry contention.
async function advance(store, id, change = () => {}) {
  const room = await store.get(id);
  const revision = room.revision;
  change(room);
  room.revision++;
  assert.equal(await store.compareAndSwap(room, revision), true);
}

test('GET retries a heartbeat revision race and returns the newly authenticated snapshot', async () => {
  const api = await table();
  const touch = api.store.touch.bind(api.store);
  let attempts = 0;
  api.store.touch = async (...args) => {
    if (++attempts === 1) await advance(api.store, api.id, (room) => { room.hostSeat = 1; });
    return touch(...args);
  };
  const result = await api.get();
  assert.equal(result.status, 200);
  assert.equal(result.state.hostSeat, 1);
  assert.equal(result.state.revision, (await api.store.get(api.id)).revision);
  assert.equal(attempts, 2);
});

test('sustained heartbeat contention is bounded and returns a fresh read instead of 409', async () => {
  const api = await table();
  const touch = api.store.touch.bind(api.store);
  let attempts = 0;
  api.store.touch = async (...args) => {
    attempts++;
    await advance(api.store, api.id);
    return touch(...args);
  };
  const result = await api.get();
  assert.equal(result.status, 200);
  assert.equal(attempts, 4);
  assert.equal(result.state.revision, (await api.store.get(api.id)).revision);
});

for (const scenario of ['detach', 'replace', 'delete', 'profile']) {
  test(`heartbeat retry reauthenticates after concurrent ${scenario}`, async () => {
    const api = await table();
    const profile = scenario === 'profile' ? await api.request('profile', undefined, {}) : null;
    let attempts = 0;
    api.store.touch = async () => {
      attempts++;
      if (scenario === 'delete') api.store.rooms.delete(api.id);
      else await advance(api.store, api.id, (room) => {
        if (scenario === 'detach') room.seats[0].detached = true;
        if (scenario === 'replace') room.seats[0].tokenHash = 'replacement-secret-hash';
        if (scenario === 'profile') room.seats[0].playerHash = 'different-profile';
      });
      return false;
    };
    const result = await api.get(profile ? { 'X-Player-Token': profile.playerToken } : {});
    assert.equal(result.status, { detach: 409, replace: 401, delete: 404, profile: 403 }[scenario]);
    if (scenario === 'detach') assert.equal(result.code, 'SEAT_DETACHED');
    assert.equal(attempts, 1);
  });
}

for (const failure of ['throw', 'undefined', 'commit-then-throw']) {
  test(`uncertain heartbeat ${failure} never retries`, async () => {
    const api = await table();
    const touch = api.store.touch.bind(api.store);
    let attempts = 0;
    api.store.touch = async (...args) => {
      attempts++;
      if (failure === 'undefined') return undefined;
      if (failure === 'commit-then-throw') await touch(...args);
      throw new ApiError(409, 'STALE_STATE', 'storage failure, not a proven conflict');
    };
    const result = await api.get();
    assert.equal(result.status, failure === 'undefined' ? 500 : 409);
    assert.equal(attempts, 1);
  });
}

// 活跃局报告页面租约才能触发展示 CAS；旧屏障行为仍由原 presentation-api 套件验证。
// Active-game presence triggers presentation CAS; the existing suite retains legacy gate behavior coverage.
async function activeTable() {
  const api = await table();
  const state = (await api.get()).state;
  assert.equal((await api.request(`rooms/${api.id}/start`, 0, { revision: state.revision })).status, 200);
  const gameId = (await api.get()).state.game.id;
  const headers = {
    'X-Presentation-Client': 'network-test',
    'X-Presentation-Visible': 'true',
    'X-Presentation-Audio': 'ready',
    'X-Presentation-Ready': 'true',
    'X-Presentation-Game': gameId,
  };
  return { ...api, headers };
}

test('GET exhausting telemetry CAS returns the last authenticated snapshot', async () => {
  const api = await activeTable();
  const compareAndSwap = api.store.compareAndSwap.bind(api.store);
  let attempts = 0;
  api.store.compareAndSwap = async (candidate, revision) => {
    attempts++;
    const other = await api.store.get(api.id);
    other.revision++;
    await compareAndSwap(other, revision);
    return false;
  };
  const result = await api.get(api.headers);
  assert.equal(result.status, 200);
  assert.equal(attempts, 6);
  assert.equal(result.state.revision, (await api.store.get(api.id)).revision);
});

for (const committed of [false, true]) {
  test(`telemetry storage-thrown STALE_STATE is uncertain (committed=${committed})`, async () => {
    const api = await activeTable();
    const compareAndSwap = api.store.compareAndSwap.bind(api.store);
    let attempts = 0;
    api.store.compareAndSwap = async (...args) => {
      attempts++;
      if (committed) await compareAndSwap(...args);
      throw new ApiError(409, 'STALE_STATE', 'uncertain storage result');
    };
    assert.equal((await api.get(api.headers)).status, 409);
    assert.equal(attempts, 1);
  });
}

// 本地模式仍使用真实规则动作；测试夹具只替换隔离存储的初始牌局。
// Local mode still uses real legal moves; fixtures replace only the isolated store's initial game.
import { createGame, applyAction, getLegalActions, continuePresentedGame } from '../shared/game.js';
import { postHuKongGame } from './fixtures/post-hu-kong.js';
import { postHuWinClaim } from './fixtures/post-hu-win.js';
async function localTable(game = createGame({ seed: 'local-network' }), mode = 'local') {
  const api = await table();
  const before = (await api.get()).state;
  const started = await api.request(`rooms/${api.id}/start`, 0, {
    revision: before.revision, presentation: true, ...(mode ? { presentationMode: mode } : {}),
  });
  assert.equal(started.status, 200);
  const room = await api.store.get(api.id);
  room.game = game;
  await api.store.compareAndSwap(room, room.revision);
  return {
    ...api,
    async action(seat, action, requestedMode = mode) {
      const state = (await api.request(`rooms/${api.id}`, seat)).state;
      return api.request(`rooms/${api.id}/action`, seat, {
        revision: state.revision, gameId: state.game.id, gameRevision: state.game.revision,
        presentation: true, ...(requestedMode ? { presentationMode: requestedMode } : {}), action,
      });
    },
    ack(seat, gate, phase = 'complete') {
      return api.request(`rooms/${api.id}/presentation`, seat, {
        presentationId: gate.id, gameId: gate.gameId, phase,
      });
    },
  };
}

// 可控墙钟只影响当前测试，避免用真实睡眠测试650/2800/4500毫秒边界。
// A scoped wall clock tests exact segment boundaries without real sleeps.
function clock(t) {
  const original = Date.now;
  let now = original();
  Date.now = () => now;
  t.after(() => { Date.now = original; });
  return { set: (value) => { now = value; }, now: () => now };
}

test('local discard deadline ignores all media receipts, mute and missing viewers', async (t) => {
  const time = clock(t);
  const api = await localTable();
  const state = (await api.get()).state;
  assert.equal(state.presentationMode, 'local');
  const action = state.game.legalActions.find((item) => item.type === 'discard');
  const paused = await api.action(0, action);
  const gate = paused.state.presentation;
  assert.equal(gate.mode, 'local');
  assert.equal(gate.expiresAt - time.now(), 650);
  assert.deepEqual(gate.requiredSeats, []);
  const frozen = (await api.store.get(api.id)).game;
  for (const seat of [0, 1, 2]) assert.equal((await api.ack(seat, gate)).state.presentation.id, gate.id);
  const headers = {
    'X-Presentation-Client': 'muted-client', 'X-Presentation-Visible': 'false',
    'X-Presentation-Audio': 'silent', 'X-Presentation-Ready': 'false',
    'X-Presentation-Game': gate.gameId,
  };
  time.set(gate.expiresAt - 1);
  assert.equal((await api.get(headers)).state.presentation.id, gate.id);
  assert.equal((await api.store.get(api.id)).seats[0].presentationClients, undefined);
  time.set(gate.expiresAt);
  assert.equal((await api.ack(0, gate)).state.presentation.id, gate.id, 'receipt never advances local mode');
  assert.equal((await api.get(headers)).status, 200);
  assert.deepEqual((await api.store.get(api.id)).game, continuePresentedGame(frozen));
});

test('single hu uses 2800ms and late reads advance only one segment with a fresh deadline', async (t) => {
  const time = clock(t);
  const api = await localTable(postHuKongGame({ winningDraw: true }));
  const result = await api.action(0, { type: 'hu' });
  const gate = result.state.presentation;
  assert.equal(gate.expiresAt - time.now(), 2800);
  const frozen = (await api.store.get(api.id)).game;
  time.set(gate.expiresAt + 100000);
  const resumed = await api.get();
  assert.deepEqual((await api.store.get(api.id)).game, continuePresentedGame(frozen));
  if (resumed.state.presentation) {
    assert.equal(resumed.state.presentation.expiresAt, time.now() + 650);
    assert.notEqual(resumed.state.presentation.id, gate.id);
  }
});

test('local mode retains all real claim decisions and gives a double hu batch 4500ms', async (t) => {
  const time = clock(t);
  const api = await localTable(postHuWinClaim({ multiple: true }));
  const first = await api.action(0, { type: 'hu' });
  assert.equal(first.state.presentation, null);
  const pendingClaim = (await api.store.get(api.id)).game;
  time.set(time.now() + 100000);
  await api.get();
  assert.deepEqual((await api.store.get(api.id)).game, pendingClaim, 'deadline never supplies a missing claim');
  const second = await api.action(2, { type: 'hu' });
  assert.equal(second.status, 200);
  assert.equal(second.state.presentation.expiresAt - time.now(), 4500);
  assert.equal(second.state.presentation.mode, 'local');
});

test('legacy gates must drain before an action can enable local mode and old receipts are inert', async () => {
  const api = await localTable(createGame({ seed: 'legacy-to-local' }), null);
  let state = (await api.get()).state;
  const discard = state.game.legalActions.find((item) => item.type === 'discard');
  const paused = await api.action(0, discard);
  const oldGate = paused.state.presentation;
  assert.equal(oldGate.mode, undefined);
  const blocked = await api.action(0, discard, 'local');
  assert.equal(blocked.code, 'PRESENTATION_PENDING');
  assert.equal((await api.store.get(api.id)).gameMeta.presentationMode, undefined);
  for (const seat of [0, 1, 2]) await api.ack(seat, oldGate);
  const room = await api.store.get(api.id);
  let actor;
  let action;
  for (let seat = 0; seat < 3; seat++) {
    const actions = getLegalActions(room.game, seat);
    if (actions.length) { actor = seat; action = actions[0]; break; }
  }
  assert.ok(action);
  const enabled = await api.action(actor, action, 'local');
  assert.equal(enabled.status, 200);
  assert.equal(enabled.state.presentationMode, 'local');
  state = enabled.state;
  assert.equal((await api.ack(0, oldGate)).state.revision, state.revision);
});

test('local capability is per game and next-round start explicitly selects its mode', async () => {
  const api = await localTable();
  const room = await api.store.get(api.id);
  let game = room.game;
  for (let moves = 0; game.phase !== 'finished'; moves++) {
    assert.ok(moves < 1000);
    let selected;
    for (let seat = 0; seat < 3; seat++) {
      const actions = getLegalActions(game, seat);
      if (actions.length) { selected = { seat, action: actions.find((item) => item.type === 'hu') || actions[0] }; break; }
    }
    assert.ok(selected);
    game = applyAction(game, selected.seat, selected.action);
  }
  room.game = game;
  await api.store.compareAndSwap(room, room.revision);
  const finished = (await api.get()).state;
  assert.equal(finished.presentationMode, 'local');
  const next = await api.request(`rooms/${api.id}/start`, 0, {
    revision: finished.revision, presentation: true, presentationMode: 'local',
  });
  assert.equal(next.status, 200);
  assert.equal(next.state.presentationMode, 'local');
  assert.notEqual(next.state.game.id, finished.game.id);
  assert.equal((await api.store.get(api.id)).archivedGames.length, 1);
});

test('telemetry retry exhaustion rechecks a last-attempt departure before returning a view', async () => {
  const api = await activeTable();
  const compareAndSwap = api.store.compareAndSwap.bind(api.store);
  let attempts = 0;
  api.store.compareAndSwap = async (candidate, revision) => {
    attempts++;
    const other = await api.store.get(api.id);
    other.revision++;
    if (attempts === 6) other.seats[0].detached = true;
    await compareAndSwap(other, revision);
    return false;
  };
  const result = await api.get(api.headers);
  assert.equal(result.status, 409);
  assert.equal(result.code, 'SEAT_DETACHED');
  assert.equal(attempts, 6);
});

test('GET profile binding retries a proven CAS conflict without losing the new room snapshot', async () => {
  const api = await table();
  const profile = await api.request('profile', undefined, {});
  const compareAndSwap = api.store.compareAndSwap.bind(api.store);
  let attempts = 0;
  api.store.compareAndSwap = async (candidate, revision) => {
    if (++attempts === 1) {
      const other = await api.store.get(api.id);
      other.revision++;
      other.hostSeat = 1;
      await compareAndSwap(other, revision);
    }
    return compareAndSwap(candidate, revision);
  };
  const result = await api.get({ 'X-Player-Token': profile.playerToken });
  assert.equal(result.status, 200);
  assert.equal(result.state.hostSeat, 1);
  assert.equal(attempts, 2);
  assert.ok((await api.store.get(api.id)).seats[0].playerHash);
});

test('leave does not retry an uncertain storage-thrown STALE_STATE', async () => {
  const api = await table();
  let attempts = 0;
  api.store.compareAndSwap = async () => {
    attempts++;
    throw new ApiError(409, 'STALE_STATE', 'uncertain leave write');
  };
  assert.equal((await api.request(`rooms/${api.id}/leave`, 0, {})).status, 409);
  assert.equal(attempts, 1);
});
