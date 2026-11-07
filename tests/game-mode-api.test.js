/**
 * 模式与房间生命周期联合回归：真实路由、独立凭证、归档、持久化与只读观战。
 * Mode/room integration regressions exercise real routes, independent credentials, archives, persistence and read-only spectating.
 * 只使用独立 MemoryStore 或临时 FileStore；不访问生产数据或启用未确认的成都玩法。
 * Use isolated MemoryStore/temporary FileStore only, never production data or unconfirmed Chengdu play.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../server/api.js';
import { MemoryStore } from '../server/store.js';
import { FileStore } from '../server/node.js';
import { createGame, getLegalActions, applyAction, continuePresentedGame } from '../shared/game.js';
import { createGame as createV2Game } from '../shared/v2-game.js';
import { createGame as createLegacyGame } from '../shared/legacy-game.js';
import { newGameMetadata, archiveFinishedGame, recordsForProfile } from '../server/history.js';

// Request 驱动完整输入校验/身份/CAS，测试帮助函数不能直接授予 HTTP 凭证。
// Standard Requests exercise full validation/auth/CAS; helpers never directly assign HTTP credentials.
function harness(store = new MemoryStore()) {
  const handle = createApi(store);
  return {
    store,
    async request(path, body, token) {
      const response = await handle(new Request(`http://mode.test/api${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }));
      return { status: response.status, ...await response.json() };
    },
  };
}

// 每次创建真实房间和三名独立占座者；省略模式与显式 flower 分别测试，不能互相替代。
// Create a real room and three independent occupants; test omitted mode separately from explicit Flower.
async function occupiedRoom(app, explicitMode = false) {
  const created = await app.request('/rooms', { name: '房主', ...(explicitMode ? { gameMode: 'flower' } : {}) });
  assert.equal(created.status, 201);
  const tokens = [created.token];
  let state = created.state;
  for (const seat of [1, 2]) {
    const joined = await app.request(`/rooms/${created.roomId}/join`, { name: `牌友${seat}`, seat });
    assert.equal(joined.status, 201);
    tokens.push(joined.token);
    state = joined.state;
  }
  return { id: created.roomId, tokens, state, path: `/rooms/${created.roomId}` };
}

// 用合法动作走到终局，避免靠改 phase 造一个不守恒的下一局/归档夹具。
// Reach finish through legal actions instead of forging a nonconserving phase-only archive fixture.
function finishGame(game) {
  let step = 0;
  while (game.phase !== 'finished' && step++ < 1200) {
    const choices = game.players.flatMap((player, seat) =>
      getLegalActions(game, seat).map((action) => ({ seat, action })));
    const selected = choices.find(({ action }) => action.type === 'hu') ?? choices[step % choices.length];
    assert.ok(selected);
    game = applyAction(game, selected.seat, selected.action);
  }
  assert.equal(game.phase, 'finished');
  return game;
}

test('unsupported/unimplemented creation modes reject before creating rooms, seats or profile links', async () => {
  const app = harness();
  for (const gameMode of [null, '', false, {}, [], 'future', '__proto__']) {
    const result = await app.request('/rooms', { name: '测试', gameMode });
    assert.equal(result.status, 409);
    assert.equal(result.code, 'UNSUPPORTED_GAME_MODE');
    assert.equal(app.store.rooms.size, 0);
    assert.equal(app.store.profiles.size, 0);
  }
  const nested = await app.request('/rooms', { name: '测试', settings: { gameMode: 'chengdu' } });
  assert.equal(nested.code, 'BAD_ROOM_SETTINGS');
  assert.equal(app.store.rooms.size, 0);
});

for (const explicitMode of [false, true]) {
  test(`creation/start/next game preserve mode presence ${explicitMode} and do not permit start-time switching`, async () => {
    const app = harness();
    const table = await occupiedRoom(app, explicitMode);
    assert.equal(Object.hasOwn(table.state, 'gameMode'), explicitMode);
    const started = await app.request(`${table.path}/start`, {
      revision: table.state.revision,
      // 非建房请求的额外字段不能重选模式，保持旧协议忽略未知顶层字段的策略。
      // Extra fields outside creation cannot select modes; preserve legacy handling of ignored top-level fields.
      gameMode: 'chengdu',
    }, table.tokens[0]);
    assert.equal(started.status, 200);
    let room = await app.store.get(table.id);
    for (const snapshot of [room, room.game, room.gameMeta, started.state, started.state.game]) {
      assert.equal(Object.hasOwn(snapshot, 'gameMode'), explicitMode);
      if (explicitMode) assert.equal(snapshot.gameMode, 'flower');
    }
    assert.equal(room.game.players.length, 3);
    assert.equal(room.game.wall.length, 104);
    assert.equal(room.gameMeta.characters.length, 3);
    assert.equal(new Set(room.gameMeta.characters).size, 3);
    const finished = finishGame(room.game);
    room.game = finished;
    room.gameMeta.finishedAt = Date.now();
    await app.store.compareAndSwap(room, room.revision);
    const next = await app.request(`${table.path}/start`, { revision: room.revision }, table.tokens[0]);
    assert.equal(next.status, 200);
    room = await app.store.get(table.id);
    assert.equal(room.archivedGames.length, 1);
    assert.deepEqual(room.archivedGames[0].game.history, archiveFinishedGame({ ...room, game: finished }).game.history);
    for (const snapshot of [room.game, room.gameMeta, room.archivedGames[0].game, room.archivedGames[0].meta]) {
      assert.equal(Object.hasOwn(snapshot, 'gameMode'), explicitMode);
    }
    assert.equal(room.gameMeta.config.deckCount, 2);
    assert.equal(room.gameMeta.config.bigSingleReadyPoints, 50);
  });

  test(`FileStore restart retains mode presence ${explicitMode}, characters, rules and exact game`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'mahjong-mode-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const app = harness(new FileStore(directory));
    const table = await occupiedRoom(app, explicitMode);
    const started = await app.request(`${table.path}/start`, { revision: table.state.revision }, table.tokens[0]);
    assert.equal(started.status, 200);
    const before = await app.store.get(table.id);
    const restarted = harness(new FileStore(directory));
    const read = await restarted.request(table.path, undefined, table.tokens[0]);
    assert.equal(read.status, 200);
    const after = await restarted.store.get(table.id);
    assert.deepEqual(after.game, before.game);
    assert.deepEqual(after.settings, before.settings);
    assert.deepEqual(after.gameMeta, before.gameMeta);
    assert.equal(Object.hasOwn(after, 'gameMode'), explicitMode);
  });
}

test('explicit Flower mode shares spectator tokens and forbids all player operations for spectators', async () => {
  const app = harness();
  const table = await occupiedRoom(app, true);
  const started = await app.request(`${table.path}/start`, { revision: table.state.revision }, table.tokens[0]);
  assert.equal(started.status, 200);
  const spectator = await app.request(`${table.path}/spectate`, {});
  assert.equal(spectator.status, 201);
  const view = spectator.state;
  assert.equal(view.viewerRole, 'spectator');
  assert.equal(view.gameMode, 'flower');
  assert.equal(view.game.gameMode, 'flower');
  assert.deepEqual(view.game.characters, started.state.game.characters);
  assert.equal(view.game.mySeat, null);
  assert.ok(view.game.players.every((player) => player.hand === undefined));
  assert.deepEqual(view.game.legalActions, []);
  assert.equal(view.game.drawnTile, null);
  const before = await app.store.get(table.id);
  for (const operation of ['action', 'start', 'presentation']) {
    const result = await app.request(`${table.path}/${operation}`, {
      revision: view.revision, action: { type: 'discard', tile: 0 },
    }, spectator.token);
    assert.equal(result.status, 403);
    assert.equal(result.code, 'SPECTATOR_READ_ONLY');
  }
  // 观众自己的离开/恢复是只读会话操作，不误封锁，也不能改变任何座位。
  // A viewer's own leave/resume are read-only session operations, allowed without mutating a player seat.
  assert.equal((await app.request(`${table.path}/leave`, {}, spectator.token)).status, 200);
  assert.equal((await app.request(`${table.path}/resume`, {}, spectator.token)).status, 200);
  assert.deepEqual(await app.store.get(table.id), before);
});

test('explicit Flower actions reject Chengdu tile identities and retain CAS duplicate protection', async () => {
  const app = harness();
  const table = await occupiedRoom(app, true);
  const started = await app.request(`${table.path}/start`, { revision: table.state.revision }, table.tokens[0]);
  const before = await app.store.get(table.id);
  for (const tile of [18, 26]) {
    const rejected = await app.request(`${table.path}/action`, {
      revision: started.state.revision, action: { type: 'discard', tile },
    }, table.tokens[0]);
    assert.equal(rejected.code, 'BAD_TILE');
    assert.equal(rejected.status, 400);
    assert.deepEqual((await app.store.get(table.id)).game, before.game);
  }
  const action = started.state.game.legalActions.find((item) => item.type === 'discard');
  const body = { revision: started.state.revision, action };
  const accepted = await app.request(`${table.path}/action`, body, table.tokens[0]);
  assert.equal(accepted.status, 200);
  const committed = await app.store.get(table.id);
  const duplicate = await app.request(`${table.path}/action`, body, table.tokens[0]);
  assert.equal(duplicate.code, 'STALE_STATE');
  assert.deepEqual((await app.store.get(table.id)).game, committed.game);
});

test('explicit Flower presentation continuation uses the saved adapter and never replaces the game mode', async () => {
  const app = harness();
  const table = await occupiedRoom(app, true);
  const started = await app.request(`${table.path}/start`, {
    revision: table.state.revision, presentationMode: 'local',
  }, table.tokens[0]);
  const action = started.state.game.legalActions.find((item) => item.type === 'discard');
  const result = await app.request(`${table.path}/action`, {
    revision: started.state.revision, presentationMode: 'local', action,
  }, table.tokens[0]);
  assert.equal(result.status, 200);
  const room = await app.store.get(table.id);
  assert.ok(room.game.presentation);
  const expected = continuePresentedGame(room.game);
  room.presentation.expiresAt = 0;
  await app.store.compareAndSwap(room, room.revision);
  const read = await app.request(table.path, undefined, table.tokens[0]);
  assert.equal(read.status, 200);
  assert.deepEqual((await app.store.get(table.id)).game, expected);
  assert.equal(read.state.game.gameMode, 'flower');
});

// 缺字段旧局通过同一房间恢复，不增写模式、规则、角色或计分；版本缺失仍是 v1。
// Restore missing-field legacy games through the same room without adding mode/rules/characters/scores; missing version remains v1.
for (const [version, create] of [[undefined, createLegacyGame], [1, createLegacyGame], [2, createV2Game], [3, createGame]]) {
  test(`legacy schema ${version} reads remain byte-for-byte unchanged through mode dispatch`, async () => {
    const app = harness();
    const table = await occupiedRoom(app);
    const room = await app.store.get(table.id);
    room.game = create({ seed: `mode-old-${version}` });
    if (version === undefined) delete room.game.schemaVersion;
    delete room.settings;
    room.gameMeta = newGameMetadata(room, `old-mode-${version}`, room.createdAt);
    const before = structuredClone(room);
    await app.store.compareAndSwap(room, room.revision);
    const read = await app.request(table.path, undefined, table.tokens[0]);
    assert.equal(read.status, 200);
    const restored = await app.store.get(table.id);
    assert.deepEqual(restored.game, before.game);
    assert.deepEqual(restored.gameMeta, before.gameMeta);
    assert.equal(Object.hasOwn(restored, 'settings'), false);
    assert.equal(Object.hasOwn(read.state, 'gameMode'), false);
    assert.equal(Object.hasOwn(read.state.game, 'gameMode'), false);
  });
}

test('profile and archived records preserve explicit modes without fabricating them on older records', () => {
  for (const explicitMode of [false, true]) {
    const game = finishGame(createGame({ seed: 'mode-record' }));
    if (explicitMode) game.gameMode = 'flower';
    const room = { id: 'ABCDEFGH', createdAt: 1, updatedAt: 2, ...(explicitMode ? { gameMode: 'flower' } : {}),
      game, seats: game.players.map((_, seat) => ({ name: `玩家${seat}`, tokenHash: `seat-${seat}`, playerHash: `profile-${seat}` })) };
    room.gameMeta = newGameMetadata(room, 'record-mode', 1);
    const current = recordsForProfile(room, 'profile-0')[0];
    room.archivedGames = [archiveFinishedGame(room)];
    room.game = null;
    const archived = recordsForProfile(room, 'profile-0')[0];
    for (const record of [current, archived]) {
      assert.equal(Object.hasOwn(record, 'gameMode'), explicitMode);
      if (explicitMode) assert.equal(record.gameMode, 'flower');
    }
    assert.deepEqual(archived.events, current.events);
    assert.equal(archived.score, current.score);
  }
});

// 不支持的存档必须在任何副作用前拒绝，避免先签观战密钥/抢座，最后才发现无法投影。
// Unsupported saves must reject before effects, rather than issuing a watch key/taking a seat before projection fails.
test('unsupported saved modes and versions reject before every room-route write', async () => {
  const cases = [
    { roomMode: 'future', gameMode: 'future', schemaVersion: 3, code: 'UNSUPPORTED_GAME_MODE' },
    { roomMode: 'chengdu', gameMode: 'chengdu', schemaVersion: 1, code: 'UNSUPPORTED_GAME_VERSION' },
    { roomMode: 'chengdu', gameMode: 'chengdu', schemaVersion: 2, code: 'INVALID_GAME_STATE' },
    { roomMode: undefined, gameMode: 'chengdu', schemaVersion: 3, code: 'GAME_MODE_MISMATCH' },
    { roomMode: undefined, gameMode: undefined, schemaVersion: 4, code: 'UNSUPPORTED_GAME_VERSION' },
    { roomMode: 'flower', gameMode: 'flower', schemaVersion: '3', code: 'UNSUPPORTED_GAME_VERSION' },
  ];
  for (const scenario of cases) {
    const app = harness();
    const table = await occupiedRoom(app);
    const room = await app.store.get(table.id);
    room.game = createGame({ seed: 'unsupported-mode' });
    if (scenario.roomMode !== undefined) room.gameMode = scenario.roomMode;
    if (scenario.gameMode !== undefined) room.game.gameMode = scenario.gameMode;
    room.game.schemaVersion = scenario.schemaVersion;
    delete room.spectatorKey;
    await app.store.compareAndSwap(room, room.revision);
    const before = await app.store.get(table.id);
    for (const operation of ['', '/join', '/spectate', '/resume', '/leave', '/start', '/action', '/presentation']) {
      const result = await app.request(`${table.path}${operation}`,
        operation ? { name: '新客人', seat: 1, revision: room.revision } : undefined, table.tokens[0]);
      assert.equal(result.status, 409, operation);
      assert.equal(result.code, scenario.code, operation);
      assert.deepEqual(await app.store.get(table.id), before);
    }
  }
});
