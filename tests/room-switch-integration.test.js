import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApi } from '../server/api.js';
import { MemoryStore, D1Store } from '../server/store.js';
import { FileStore, apiMiddleware } from '../server/node.js';
import { createGame, assertGameInvariants } from '../shared/game.js';
import { createGame as createLegacyGame, assertGameInvariants as assertLegacyInvariants } from '../shared/legacy-game.js';

// These independently written contract tests never connect to production. Direct
// state writes below are explicit synthetic fixtures, not public API abilities.
function harness(store = new MemoryStore(), handler = createApi(store)) {
  return {
    store,
    async request(path, { body, token, profile, method = body === undefined ? 'GET' : 'POST' } = {}) {
      const response = await handler(new Request(`http://recovery.test${path}`, {
        method,
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(profile ? { 'x-player-token': profile } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }));
      return { status: response.status, body: await response.json(), headers: response.headers };
    },
  };
}
function successful(answer, status = 200) {
  assert.equal(answer.status, status, JSON.stringify(answer.body));
  return answer.body;
}
function denied(answer, status = 401) {
  assert.equal(answer.status, status, JSON.stringify(answer.body));
  assert.equal(typeof answer.body.error, 'string');
}
async function identity(api) {
  const body = successful(await api.request('/api/profile', { body: {} }), 201);
  assert.match(body.playerToken, /^[a-f0-9]{64}$/);
  return body.playerToken;
}
async function createRoom(api, name = '独立东家', profile) {
  const body = successful(await api.request('/api/rooms', { body: { name }, profile }), 201);
  return { ...body, profile, seat: body.state.you };
}
async function joinRoom(api, roomId, name, profile) {
  const body = successful(await api.request(`/api/rooms/${roomId}/join`, { body: { name }, profile }), 201);
  return { ...body, profile, seat: body.state.you };
}
const roomPath = (person, operation = '') => `/api/rooms/${person.roomId}${operation ? `/${operation}` : ''}`;
const credentials = person => ({ token: person.token, profile: person.profile });
async function snapshot(api, person) { return successful(await api.request(roomPath(person), credentials(person))).state; }
async function history(api, person) { return successful(await api.request('/api/profile/history', { profile: typeof person === 'string' ? person : person.profile })); }
async function leave(api, person, revision) {
  return api.request(roomPath(person, 'leave'), { ...credentials(person), body: { revision: revision ?? (await api.store.get(person.roomId)).revision } });
}
async function resume(api, person) { return api.request(roomPath(person, 'resume'), { ...credentials(person), body: {} }); }
async function action(api, person, revision, value) {
  return api.request(roomPath(person, 'action'), { ...credentials(person), body: { revision, action: value } });
}
async function table(api, { start = true, names = ['独立东家', '独立南家', '独立西家'], profiles } = {}) {
  profiles ??= await Promise.all([0, 1, 2].map(() => identity(api)));
  const host = await createRoom(api, names[0], profiles[0]);
  const people = [host];
  for (let seat = 1; seat < 3; seat++) people.push(await joinRoom(api, host.roomId, names[seat], profiles[seat]));
  if (start) successful(await api.request(roomPath(host, 'start'), { ...credentials(host), body: { revision: 2 } }));
  return { roomId: host.roomId, people, host };
}
function noPrivateData(value, secrets = []) {
  const text = JSON.stringify(value);
  for (const secret of secrets) assert.equal(text.includes(secret), false, 'secret credential leaked');
  function walk(item) {
    if (!item || typeof item !== 'object') return;
    for (const [key, nested] of Object.entries(item)) {
      assert.equal(['token', 'tokenHash', 'playerToken', 'playerHash', 'profileHash', 'wall', 'hand', 'lastDraw', 'drawnTile'].includes(key), false, `private ${key} field leaked`);
      walk(nested);
    }
  }
  walk(value);
}

// Exhaust the wall using a conservation-valid fixture, then finish via legal
// HTTP/API actions. This tests real settlement rather than fabricating records.
async function finishTable(api, people, scores = [8, -3, -5]) {
  const room = await api.store.get(people[0].roomId);
  const game = createGame({ seed: 'room-recovery-finish' });
  game.players.forEach((player, seat) => { player.score = scores[seat]; });
  game.retiredTiles.push(...game.wall.map(tile => ({ seat: 0, tile })));
  game.wall = [];
  assertGameInvariants(game);
  room.game = game;
  assert.equal(await api.store.compareAndSwap(room, room.revision), true);
  let state = await snapshot(api, people[0]);
  const discard = state.game.legalActions.find(candidate => candidate.type === 'discard');
  assert.ok(discard);
  successful(await action(api, people[0], state.revision, discard));
  for (let attempts = 0; attempts < 3; attempts++) {
    state = await snapshot(api, people[0]);
    if (state.phase === 'finished') return state;
    assert.equal(state.game.phase, 'claim');
    let passed = false;
    for (const person of people) {
      const own = await snapshot(api, person);
      if (own.game.legalActions.some(candidate => candidate.type === 'pass')) {
        successful(await action(api, person, own.revision, { type: 'pass' }));
        passed = true;
        break;
      }
    }
    assert.equal(passed, true);
  }
  assert.fail('synthetic wall exhaustion did not finish');
}

test('recovery: identity history requires its own credential and same names stay isolated', async () => {
  const api = harness();
  const own = await identity(api), stranger = await identity(api);
  assert.notEqual(own, stranger);
  for (const profile of [undefined, 'bad', '0'.repeat(64), 'A'.repeat(64)]) denied(await api.request('/api/profile/history', { profile }));
  const first = await table(api, { profiles: [own, await identity(api), await identity(api)], names: ['相同名字', '甲南', '甲西'] });
  const second = await table(api, { profiles: [stranger, await identity(api), await identity(api)], names: ['相同名字', '乙南', '乙西'] });
  const mine = await history(api, own), theirs = await history(api, stranger);
  assert.deepEqual(mine.records.map(record => record.roomId), [first.roomId]);
  assert.deepEqual(theirs.records.map(record => record.roomId), [second.roomId]);
  assert.equal(mine.summary.settledGames, 0);
  assert.equal(mine.summary.totalScore, 0);
  noPrivateData(mine, [...first.people, ...second.people].flatMap(person => [person.token, person.profile]));
  assert.match((await api.request('/api/profile/history', { profile: own })).headers.get('cache-control'), /no-store/);
});

test('recovery: lobby exit frees only its own seat, transfers host, and invalidates old seat credentials', async () => {
  const api = harness();
  const { people, host, roomId } = await table(api, { start: false });
  const unrelated = await table(api);
  const unrelatedBefore = await api.store.get(unrelated.roomId);
  successful(await leave(api, host));
  let stored = await api.store.get(roomId);
  assert.equal(stored.seats[0], null);
  assert.equal(stored.hostSeat, 1);
  for (const operation of ['', 'resume']) {
    denied(await api.request(roomPath(host, operation), { ...credentials(host), ...(operation ? { body: { revision: stored.revision } } : {}) }));
  }
  successful(await leave(api, host)); // repeated leave is deliberately idempotent
  const replacement = await joinRoom(api, roomId, '替补东家', await identity(api));
  assert.equal(replacement.seat, 0);
  denied(await api.request(roomPath(replacement, 'resume'), { token: host.token, profile: replacement.profile, body: {} }));
  assert.equal((await snapshot(api, replacement)).you, 0);
  const replacementBefore = await api.store.get(roomId);
  successful(await leave(api, host, 0));
  assert.deepEqual(await api.store.get(roomId), replacementBefore, 'old leave changed replacement occupant');
  assert.deepEqual(await api.store.get(unrelated.roomId), unrelatedBefore);
  for (const person of [people[1], people[2], replacement]) successful(await leave(api, person));
  stored = await api.store.get(roomId);
  assert.deepEqual(stored.seats, [null, null, null]);
  assert.equal(stored.hostSeat, null);
  for (const person of people) assert.deepEqual((await history(api, person)).records, []);
});

test('recovery: active exit preserves every game byte, blocks detached actions, and resumes only the exact seat', async () => {
  const api = harness();
  const { people, host, roomId } = await table(api);
  const other = await table(api);
  const before = await api.store.get(roomId), elsewhere = await api.store.get(other.roomId);
  const left = successful(await leave(api, host));
  assert.equal(left.detached, true);
  let after = await api.store.get(roomId);
  assert.equal(JSON.stringify(after.game), JSON.stringify(before.game));
  assert.equal(after.seats[0].tokenHash, before.seats[0].tokenHash);
  assert.equal(after.hostSeat, 1);
  assert.deepEqual(await api.store.get(other.roomId), elsewhere);
  denied(await api.request(roomPath(host), credentials(host)), 409);
  denied(await action(api, host, after.revision, { type: 'discard', tile: before.game.players[0].hand[0] }), 409);
  denied(await api.request(roomPath(host, 'start'), { ...credentials(host), body: { revision: after.revision } }), 409);
  denied(await api.request(roomPath(host, 'resume'), { token: other.host.token, profile: host.profile, body: {} }));
  denied(await api.request(roomPath(host, 'resume'), { token: host.token, profile: other.host.profile, body: {} }), 403);
  assert.equal((await history(api, host)).records[0].status, 'detached');
  const restored = successful(await resume(api, host)).state;
  assert.equal(restored.you, 0);
  assert.deepEqual(restored.game.players[0].hand, before.game.players[0].hand);
  assert.equal(restored.game.players.filter(player => Array.isArray(player.hand)).length, 1);
  assert.equal(JSON.stringify((await api.store.get(roomId)).game), JSON.stringify(before.game));
  for (const person of people) successful(await leave(api, person));
  after = await api.store.get(roomId);
  assert.equal(after.hostSeat, null);
  assert.equal(JSON.stringify(after.game), JSON.stringify(before.game));
  const oneBack = successful(await resume(api, people[2])).state;
  assert.equal(oneBack.hostSeat, 2);
  assert.equal(oneBack.you, 2);
});

test('recovery: duplicate leave and concurrent start use revision CAS without partial game corruption', async () => {
  const api = harness();
  const { host, roomId } = await table(api, { start: false });
  const replies = await Promise.all([
    leave(api, host, 2),
    api.request(roomPath(host, 'start'), { ...credentials(host), body: { revision: 2 } }),
  ]);
  assert.equal(replies[0].status, 200, 'leave intent must win or safely retry after start');
  assert.ok([200, 409].includes(replies[1].status));
  const room = await api.store.get(roomId);
  assert.equal(room.revision, replies[1].status === 200 ? 4 : 3);
  if (room.game) {
    assertGameInvariants(room.game);
    assert.equal(room.seats[0].detached, true);
    const before = JSON.stringify(room.game);
    const duplicate = await Promise.all([leave(api, host, room.revision), leave(api, host, room.revision)]);
    assert.deepEqual(duplicate.map(reply => reply.status).sort(), [200, 200]);
    assert.equal((await api.store.get(roomId)).revision, room.revision);
    assert.equal(JSON.stringify((await api.store.get(roomId)).game), before);
  } else {
    assert.equal(room.seats[0], null);
    assert.equal(room.hostSeat, 1);
  }
});

test('recovery: delayed authenticated heartbeat cannot revive a detached or replaced seat', async () => {
  for (const start of [false, true]) {
    const api = harness();
    const { host, roomId } = await table(api, { start });
    const room = await api.store.get(roomId);
    room.seats[0].lastSeen = Date.now() - 60000;
    assert.equal(await api.store.compareAndSwap(room, room.revision), true);
    let entered, release;
    const waiting = new Promise(resolve => { entered = resolve; });
    const resumeTouch = new Promise(resolve => { release = resolve; });
    const touch = api.store.touch.bind(api.store);
    api.store.touch = async (...args) => { entered(); await resumeTouch; return touch(...args); };
    const poll = api.request(roomPath(host), credentials(host));
    await waiting;
    successful(await leave(api, host));
    if (!start) {
      const replacement = await joinRoom(api, roomId, '后来的新东家', await identity(api));
      const stored = await api.store.get(roomId);
      stored.seats[replacement.seat].lastSeen = 12345;
      assert.equal(await api.store.compareAndSwap(stored, stored.revision), true);
    }
    const expected = await api.store.get(roomId);
    release();
    await poll;
    assert.deepEqual(await api.store.get(roomId), expected, 'late old heartbeat changed detached/replacement state');
  }
});

test('recovery: records settle exactly once, survive new games, and never move to replacement players', async () => {
  const api = harness();
  const { people, host, roomId } = await table(api);
  const started = (await history(api, host)).records;
  assert.equal(started.length, 1);
  assert.equal(started[0].status, 'playing');
  assert.ok(started[0].events.some(event => event.type === 'start'));
  const state = await finishTable(api, people);
  for (let pass = 0; pass < 3; pass++) {
    for (const person of people) await snapshot(api, person);
    const mine = await history(api, host);
    assert.equal(mine.records.length, 1);
    assert.equal(mine.records[0].status, 'finished');
    assert.equal(mine.records[0].gameId, started[0].gameId);
    assert.equal(mine.records[0].score, 8);
    assert.equal(mine.summary.settledGames, 1);
    assert.equal(mine.summary.totalScore, 8);
    assert.equal(mine.records[0].events.filter(event => event.type === 'finish').length, 1);
  }
  successful(await leave(api, people[2], state.revision));
  const newcomer = await joinRoom(api, roomId, '独立替补', await identity(api));
  assert.equal((await history(api, newcomer)).records.length, 0, 'new seat inherited prior owner game');
  const last = (await history(api, people[2])).records[0];
  assert.equal(last.score, -5);
  const revision = (await api.store.get(roomId)).revision;
  const starts = await Promise.all([0, 1].map(() => api.request(roomPath(host, 'start'), { ...credentials(host), body: { revision } })));
  assert.deepEqual(starts.map(answer => answer.status).sort(), [200, 409]);
  const mine = await history(api, host);
  assert.equal(mine.records.length, 2);
  assert.equal(new Set(mine.records.map(record => record.gameId)).size, 2);
  assert.equal(mine.summary.totalScore, 8);
  assert.equal(mine.summary.settledGames, 1);
  assert.equal((await history(api, newcomer)).records.length, 1);
  assert.deepEqual((await history(api, people[2])).records, [last]);
  noPrivateData(mine, people.flatMap(person => [person.token, person.profile]));
});

test('recovery: old rooms migrate only the credential-proven current game, never a name match', async () => {
  const api = harness();
  const legacy = await table(api, { profiles: [undefined, undefined, undefined], names: ['历史同名', '旧南', '旧西'] });
  const sameName = await table(api, { profiles: [undefined, undefined, undefined], names: ['历史同名', '另一南', '另一西'] });
  const before = await api.store.get(legacy.roomId), untouched = await api.store.get(sameName.roomId);
  const own = await identity(api), attacker = await identity(api);
  assert.deepEqual((await history(api, own)).records, []);
  denied(await api.request(roomPath(legacy.host), { token: sameName.host.token, profile: own }));
  assert.deepEqual((await history(api, own)).records, []);
  const migrated = successful(await api.request(roomPath(legacy.host), { token: legacy.host.token, profile: own })).state;
  assert.equal(migrated.you, 0);
  assert.equal(JSON.stringify((await api.store.get(legacy.roomId)).game), JSON.stringify(before.game));
  assert.deepEqual(await api.store.get(sameName.roomId), untouched);
  const records = (await history(api, own)).records;
  assert.equal(records.length, 1);
  assert.equal(records[0].roomId, legacy.roomId);
  denied(await api.request(roomPath(legacy.host), { token: legacy.host.token, profile: attacker }), 403);
  assert.deepEqual((await history(api, attacker)).records, []);
});

test('recovery: real HTTP identity history and detached seats survive a FileStore reload', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mahjong-recovery-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new FileStore(dir);
  const server = createServer(apiMiddleware(store));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = harness(store, request => fetch(`${origin}${new URL(request.url).pathname}`, { method: request.method, headers: request.headers, ...(request.method === 'GET' ? {} : { body: request.body, duplex: 'half' }) }));
  const first = await table(api);
  await finishTable(api, first.people, [11, -4, -7]);
  const firstHistory = await history(api, first.host);
  successful(await api.request(roomPath(first.host, 'start'), { ...credentials(first.host), body: { revision: (await store.get(first.roomId)).revision } }));
  successful(await leave(api, first.host));
  const before = await store.get(first.roomId);
  const reopened = harness(new FileStore(dir));
  const recovered = await history(reopened, first.host);
  assert.equal(recovered.summary.totalScore, 11);
  assert.equal(recovered.summary.settledGames, 1);
  assert.equal(recovered.records.length, 2);
  assert.ok(recovered.records.some(record => record.gameId === firstHistory.records[0].gameId));
  assert.deepEqual(await reopened.store.get(first.roomId), before);
  denied(await reopened.request(roomPath(first.host), credentials(first.host)), 409);
  const back = successful(await resume(reopened, first.host)).state;
  assert.equal(back.you, 0);
  assert.deepEqual(back.game.players[0].hand, before.game.players[0].hand);
  const persisted = await readFile(join(dir, 'rooms.json'), 'utf8');
  for (const person of first.people) {
    assert.equal(persisted.includes(person.token), false);
    assert.equal(persisted.includes(person.profile), false);
  }
});

function sqliteD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE mahjong_rooms (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE mahjong_profiles (token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
    CREATE TABLE mahjong_player_rooms (player_hash TEXT NOT NULL, room_id TEXT NOT NULL, PRIMARY KEY (player_hash, room_id));
  `);
  const statements = [];
  return {
    sqlite, statements, close: () => sqlite.close(),
    prepare(sql) {
      return { bind(...values) { return {
        async first() { statements.push({ sql, values, kind: 'read' }); return sqlite.prepare(sql).get(...values) || null; },
        async all() { statements.push({ sql, values, kind: 'read' }); return { results: sqlite.prepare(sql).all(...values), success: true }; },
        async run() { statements.push({ sql, values, kind: 'write' }); return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
      }; } };
    },
  };
}

test('recovery D1: independent workers settle once and keep profile history after handler restart', async () => {
  const db = sqliteD1();
  try {
    const primary = harness(new D1Store(db)), secondary = harness(new D1Store(db));
    const { host, people, roomId } = await table(primary);
    await finishTable(primary, people, [15, -6, -9]);
    const before = await history(primary, host);
    const current = await primary.store.get(roomId);
    const starts = await Promise.all([primary, secondary].map(api => api.request(roomPath(host, 'start'), { ...credentials(host), body: { revision: current.revision } })));
    assert.deepEqual(starts.map(answer => answer.status).sort(), [200, 409]);
    const latest = await primary.store.get(roomId);
    const leaves = await Promise.all([primary, secondary].map(api => leave(api, host, latest.revision)));
    assert.deepEqual(leaves.map(answer => answer.status).sort(), [200, 200]);
    assert.equal((await primary.store.get(roomId)).revision, latest.revision + 1);
    const reloaded = harness(new D1Store(db));
    const mine = await history(reloaded, host);
    assert.equal(mine.summary.settledGames, 1);
    assert.equal(mine.summary.totalScore, 15);
    assert.equal(mine.records.length, 2);
    assert.equal(new Set(mine.records.map(record => record.gameId)).size, 2);
    assert.ok(mine.records.some(record => record.gameId === before.records[0].gameId && record.status === 'finished'));
    assert.ok(mine.records.some(record => record.status === 'detached'));
    assert.equal(JSON.stringify((await reloaded.store.get(roomId)).game), JSON.stringify(latest.game));
    const restoredTotals = successful(await resume(reloaded, host)).state.tableScores;
    assert.deepEqual(restoredTotals.map(row => row.totalScore), [15, -6, -9]);
    noPrivateData(restoredTotals, people.flatMap(person => [person.token, person.profile]));
    noPrivateData(await history(reloaded, host), people.flatMap(person => [person.token, person.profile]));
    const data = db.sqlite.prepare('SELECT state FROM mahjong_rooms').all().map(row => row.state).join('');
    for (const person of people) {
      assert.equal(data.includes(person.token), false);
      assert.equal(data.includes(person.profile), false);
    }
  } finally { db.close(); }
});

test('recovery D1: stale worker heartbeat cannot overwrite a leave or a new occupant', async () => {
  const db = sqliteD1();
  try {
    for (const start of [false, true]) {
      const api = harness(new D1Store(db)), worker = harness(new D1Store(db));
      const { host, roomId } = await table(api, { start });
      const room = await api.store.get(roomId);
      room.seats[0].lastSeen = Date.now() - 60000;
      assert.equal(await api.store.compareAndSwap(room, room.revision), true);
      let entered, release;
      const waiting = new Promise(resolve => { entered = resolve; });
      const paused = new Promise(resolve => { release = resolve; });
      const touch = worker.store.touch.bind(worker.store);
      worker.store.touch = async (...args) => { entered(); await paused; return touch(...args); };
      const oldPoll = worker.request(roomPath(host), credentials(host));
      await waiting;
      successful(await leave(api, host));
      if (!start) await joinRoom(api, roomId, 'D1新东家', await identity(api));
      const expected = await api.store.get(roomId);
      release();
      await oldPoll;
      assert.deepEqual(await api.store.get(roomId), expected);
      assert.ok(db.statements.some(statement => /json_set/.test(statement.sql) && /revision = \?/.test(statement.sql) && /tokenHash/.test(JSON.stringify(statement.values))));
    }
  } finally { db.close(); }
});

test('recovery D1: profile index alone never grants another identity historical access', async () => {
  const db = sqliteD1();
  try {
    const api = harness(new D1Store(db));
    const { host } = await table(api);
    const attacker = await identity(api);
    // Model an orphan/retried index operation. Ownership must still be checked
    // against the immutable game participant rather than trusting the index.
    const attackerHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(attacker))), byte => byte.toString(16).padStart(2, '0')).join('');
    await api.store.linkProfileRoom(attackerHash, host.roomId);
    assert.deepEqual((await history(api, attacker)).records, []);
    assert.equal((await history(api, host)).records.length, 1);
    denied(await api.request(roomPath(host), { token: host.token, profile: attacker }), 403);
  } finally { db.close(); }
});


test('recovery: legacy rules retain private state exactly through detach and explicit resume', async () => {
  const api = harness();
  const { host, roomId } = await table(api);
  const room = await api.store.get(roomId);
  room.game = createLegacyGame({ seed: 'legacy-room-recovery' });
  delete room.game.schemaVersion;
  assertLegacyInvariants(room.game);
  const bytes = JSON.stringify(room.game);
  assert.equal(await api.store.compareAndSwap(room, room.revision), true);
  successful(await leave(api, host));
  assert.equal(JSON.stringify((await api.store.get(roomId)).game), bytes);
  const restored = successful(await resume(api, host)).state;
  assert.equal(restored.game.schemaVersion, 1);
  assert.equal(JSON.stringify((await api.store.get(roomId)).game), bytes);
  assert.deepEqual(restored.game.players[0].hand, room.game.players[0].hand);
  assert.equal(restored.game.players.filter(player => Array.isArray(player.hand)).length, 1);
  assert.equal((await history(api, host)).records[0].rulesVersion, 1);
});

test('recovery: history redacts private draw payloads and remains after the room expiry window', async () => {
  const api = harness();
  const { host, roomId } = await table(api);
  const room = await api.store.get(roomId);
  room.game.history.push({ type: 'draw', seat: 1, tile: 16, drawnTile: 16, hand: [16, 16], tokenHash: 'PRIVATE_TEST_HASH', message: 'PRIVATE_TEST_DRAW_EIGHT_CIRCLES' });
  room.updatedAt = Date.now() - 8 * 86400000;
  assert.equal(await api.store.compareAndSwap(room, room.revision), true);
  const mine = await history(api, host);
  assert.equal(mine.records.length, 1);
  const draw = mine.records[0].events.find(event => event.type === 'draw');
  assert.ok(draw);
  assert.equal('tile' in draw, false);
  noPrivateData(mine, [host.token, host.profile, 'PRIVATE_TEST_HASH', 'PRIVATE_TEST_DRAW_EIGHT_CIRCLES']);
});

test('recovery: an invalid identity token cannot silently create or join an anonymous seat', async () => {
  const api = harness();
  const room = await createRoom(api, '身份检查', await identity(api));
  const before = await api.store.get(room.roomId);
  for (const profile of ['bad', '0'.repeat(64)]) {
    denied(await api.request('/api/rooms', { profile, body: { name: '不应建成' } }));
    denied(await api.request(`/api/rooms/${room.roomId}/join`, { profile, body: { name: '不应落座' } }));
  }
  assert.deepEqual(await api.store.get(room.roomId), before);
  assert.equal(api.store.rooms.size, 1);
});


test('recovery: a replacement seat cannot inherit concealed kongs or private wait metadata', async () => {
  const api = harness();
  const { people, roomId } = await table(api);
  await finishTable(api, people);
  const room = await api.store.get(roomId);
  const old = room.game.players[2];
  const tile = Array.from({ length: 18 }, (_, value) => value).find(value => room.game.retiredTiles.filter(item => item.tile === value).length >= 4);
  assert.notEqual(tile, undefined);
  room.game.retiredTiles.push(...old.hand.splice(0, 3).map(value => ({ seat: 2, tile: value })));
  for (let count = 0; count < 4; count++) room.game.retiredTiles.splice(room.game.retiredTiles.findIndex(item => item.tile === tile), 1);
  old.melds.push({ type: 'anGang', tile, tiles: [tile, tile, tile, tile] });
  old.lockedWaits = [8, 17]; old.huLockActive = true;
  old.huCount = 1;
  old.firstHuPattern = {kind:'sevenPairs',pureSuit:false,allTriplets:false,waitTiles:[0,2,4,6,8,15,17],fixedFan:3,sevenPairsFan:3};
  assertGameInvariants(room.game);
  assert.equal(await api.store.compareAndSwap(room, room.revision), true);
  successful(await leave(api, people[2]));
  const newcomer = await joinRoom(api, roomId, '不可看旧暗牌', await identity(api));
  const view = await snapshot(api, newcomer);
  assert.equal(view.game.players.some(player => Array.isArray(player.hand)), false);
  const kong = view.game.players[2].melds[0];
  assert.equal(kong.tile, null, 'new occupant learned old concealed-kong tile');
  assert.deepEqual(kong.tiles, [null, null, null, null]);
  assert.deepEqual(view.seats[2].melds, []);
  assert.equal(view.seats[2].score, 0);
  assert.equal(view.seats[2].isCurrentParticipant, false);
  assert.ok(!view.game.waitTiles?.length, 'new occupant learned old waiting tiles');
  assert.ok(!view.game.lockedWaits?.length, 'new occupant learned old hu lock');
  assert.equal(view.game.specialHuPattern, null, 'new occupant learned old special-hand waits');
  assert.equal(Boolean(view.game.huLockActive), false);
  assert.equal((await history(api, newcomer)).records.length, 0);
});

test('recovery: deployed identity transport uses profile bearer and seat bearer plus POST body', async () => {
  const api = harness();
  const own = await identity(api), wrong = await identity(api);
  const profileRead = successful(await api.request('/api/profile/history', { token: own }));
  assert.deepEqual(profileRead.records, []);
  const create = successful(await api.request('/api/rooms', { body: { name: '正文绑定东家', profileToken: own } }), 201);
  const resume = successful(await api.request(`/api/rooms/${create.roomId}/resume`, { token: create.token, body: { profileToken: own } })).state;
  assert.equal(resume.you, 0);
  denied(await api.request(`/api/rooms/${create.roomId}/resume`, { token: create.token, body: { profileToken: wrong } }), 403);
  denied(await api.request('/api/profile/history', { token: create.token }));
  assert.equal((await api.request(`/api/rooms/${create.roomId}`, { token: create.token })).status, 200, 'normal room polls need no profile token');
  successful(await api.request(`/api/rooms/${create.roomId}/leave`, { token: create.token, body: { profileToken: own } }));
  const persisted = JSON.stringify(await api.store.get(create.roomId));
  assert.equal(persisted.includes(own), false);
  assert.equal(persisted.includes(create.token), false);
});

test('recovery: browser-generated profile registration is retry-safe across independent D1 workers', async () => {
  const db = sqliteD1();
  try {
    const clients = [harness(new D1Store(db)), harness(new D1Store(db))];
    const playerToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    const answers = await Promise.all(clients.map(api => api.request('/api/profile', { body: { playerToken } })));
    assert.deepEqual(answers.map(answer => answer.status).sort(), [200, 201]);
    assert.ok(answers.every(answer => answer.body.playerToken === playerToken));
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM mahjong_profiles').get().count, 1);
    assert.deepEqual(successful(await clients[1].request('/api/profile/history', { token: playerToken })).records, []);
    for (const invalid of ['', 'short', 'A'.repeat(64), 1]) {
      denied(await clients[0].request('/api/profile', { body: { playerToken: invalid } }), 400);
    }
  } finally { db.close(); }
});


test('recovery: repeated detached leave can bind only that old seat to its newly registered identity', async () => {
  const api = harness();
  const { host, roomId } = await table(api, { profiles: [undefined, undefined, undefined] });
  successful(await leave(api, host));
  const before = await api.store.get(roomId);
  const profile = await identity(api);
  assert.deepEqual((await history(api, profile)).records, []);
  successful(await api.request(roomPath(host, 'leave'), { token: host.token, body: { profileToken: profile } }));
  const after = await api.store.get(roomId);
  assert.equal(JSON.stringify(after.game), JSON.stringify(before.game));
  assert.equal(after.seats[0].detached, true);
  const mine = await history(api, profile);
  assert.equal(mine.records.length, 1);
  assert.equal(mine.records[0].roomId, roomId);
  assert.equal(mine.records[0].seat, 0);
  assert.equal(mine.records[0].status, 'detached');
  const stranger = await identity(api);
  denied(await api.request(roomPath(host, 'leave'), { token: host.token, body: { profileToken: stranger } }), 403);
  assert.deepEqual((await history(api, stranger)).records, []);
});

test('recovery: a previously detached seat can be released once the game is finished', async () => {
  const api = harness();
  const { people, roomId } = await table(api);
  // Preserve the valid current game and finish it first. Marking the participant
  // detached models a departure that preceded another player's final action.
  await finishTable(api, people);
  const room = await api.store.get(roomId);
  room.seats[2].detached = true; room.seats[2].lastSeen = 0;
  assert.equal(await api.store.compareAndSwap(room, room.revision), true);
  const before = await history(api, people[2]);
  const answer = successful(await leave(api, people[2]));
  assert.equal(answer.detached, false);
  assert.equal((await api.store.get(roomId)).seats[2], null);
  assert.equal(JSON.stringify((await api.store.get(roomId)).game), JSON.stringify(room.game));
  assert.equal((await history(api, people[2])).summary.totalScore, before.summary.totalScore);
  const replacement = await joinRoom(api, roomId, '结算后新玩家', await identity(api));
  assert.equal(replacement.seat, 2);
});

test('recovery: retries create only one departure/resume log and never log a phantom game start', async () => {
  const api = harness();
  const { host, roomId } = await table(api);
  const before = await api.store.get(roomId);
  const repeated = await Promise.all([leave(api, host), leave(api, host)]);
  assert.ok(repeated.every(answer => answer.status === 200));
  let stored = await api.store.get(roomId);
  assert.equal(stored.lifecycleLog.filter(event => event.type === 'leave').length, 1);
  assert.equal(stored.game.history.filter(event => event.type === 'start').length, 1);
  assert.equal(JSON.stringify(stored.game), JSON.stringify(before.game));
  successful(await resume(api, host));
  const resumedRevision = (await api.store.get(roomId)).revision;
  successful(await resume(api, host));
  stored = await api.store.get(roomId);
  assert.equal(stored.revision, resumedRevision);
  assert.deepEqual(stored.lifecycleLog.map(event => event.type), ['leave', 'resume']);
  assert.equal(JSON.stringify(stored.game), JSON.stringify(before.game));
  assert.equal((await history(api, host)).records.length, 1);
  noPrivateData(stored.lifecycleLog, [host.token, host.profile]);
});

test('table totals persist through FileStore restart, another game, repeated reads and same-name replacement', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'flower-total-score-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const api = harness(new FileStore(dir));
  const { host, people, roomId } = await table(api);
  let state = await snapshot(api, host);
  assert.deepEqual(state.tableScores.map(row => row.totalScore), [0, 0, 0]);
  assert.equal(state.game.rules.turnDirection, 'counterclockwise');
  assert.equal(state.game.rules.allowPungUpgrade, false);
  state = await finishTable(api, people, [8, -3, -5]);
  assert.deepEqual(state.tableScores.map(row => row.totalScore), [8, -3, -5]);
  assert.deepEqual(state.tableScores.map(row => row.settledScore), [8, -3, -5]);
  assert.deepEqual(state.tableScores.map(row => row.provisionalScore), [0, 0, 0]);
  successful(await api.request(roomPath(host, 'start'), { ...credentials(host), body: { revision: state.revision } }));
  let saved = await api.store.get(roomId);
  saved.game.players.forEach((player, index) => { player.score = [2, -1, -1][index]; });
  assert.equal(await api.store.compareAndSwap(saved, saved.revision), true);
  const restored = harness(new FileStore(dir));
  for (const person of people) for (let i = 0; i < 2; i++) {
    const fresh = await snapshot(restored, person);
    assert.deepEqual(fresh.tableScores.map(row => row.totalScore), [10, -4, -6]);
    assert.deepEqual(fresh.tableScores.map(row => row.settledScore), [8, -3, -5]);
    assert.deepEqual(fresh.tableScores.map(row => row.provisionalScore), [2, -1, -1]);
    noPrivateData(fresh.tableScores, people.flatMap(player => [player.token, player.profile]));
  }
  state = await finishTable(restored, people, [2, -1, -1]);
  successful(await leave(restored, people[2], state.revision));
  const replacement = await joinRoom(restored, roomId, people[2].state.seats[2].name, await identity(restored));
  const totals = replacement.state.tableScores;
  assert.deepEqual(totals.map(row => row.totalScore), [10, -4, -6, 0]);
  assert.equal(totals[2].seat, null); assert.equal(totals[2].detached, true);
  assert.equal(totals[3].seat, 2);
  assert.equal(totals.reduce((sum, row) => sum + row.totalScore, 0), 0);
  assert.equal((await history(restored, host)).summary.totalScore, 10);
});
