import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../server/store.js';
import { FileStore, apiMiddleware } from '../server/node.js';
import { createGame, assertGameInvariants } from '../shared/v2-game.js';
import { createGame as createLegacyGame, assertGameInvariants as assertLegacyInvariants } from '../shared/legacy-game.js';
import { postHuKongGame } from './fixtures/post-hu-kong.js';

// Every player below owns an independently issued bearer credential and makes
// real HTTP requests. The only direct store writes are explicit game fixtures;
// no client is granted an endpoint that can set the wall, hand, or acting seat.
async function harness(t, store = new MemoryStore()) {
  const server = createServer(apiMiddleware(store));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'GET', body, token, headers = {}, rawBody } = {}) {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        ...(body !== undefined || rawBody !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        ...headers,
      },
      ...(rawBody !== undefined ? { body: rawBody } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  return { origin, request, store };
}

function client(api, roomId, token, seat) {
  return {
    roomId, token, seat,
    get: since => api.request(`/api/rooms/${roomId}${since === undefined ? '' : `?since=${encodeURIComponent(since)}`}`, { token }),
    start: revision => api.request(`/api/rooms/${roomId}/start`, { method: 'POST', token, body: { revision } }),
    action: (revision, action, extra = {}) => api.request(`/api/rooms/${roomId}/action`, {
      method: 'POST', token, body: { revision, action, ...extra },
    }),
  };
}

async function createRoom(api, name = '东家') {
  const result = await api.request('/api/rooms', { method: 'POST', body: { name } });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const { roomId, token, state } = result.body;
  return { roomId, state, host: client(api, roomId, token, state.you) };
}

async function joinRoom(api, roomId, name, seat) {
  return api.request(`/api/rooms/${roomId}/join`, { method: 'POST', body: { name, ...(seat === undefined ? {} : { seat }) } });
}

async function table(t, { store, start = true, seed } = {}) {
  const api = await harness(t, store);
  const { roomId, host } = await createRoom(api);
  const clients = [host];
  for (const name of ['南家', '西家']) {
    const result = await joinRoom(api, roomId, name);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    clients.push(client(api, roomId, result.body.token, result.body.state.you));
  }
  let state = (await host.get()).body.state;
  if (start) {
    const result = await host.start(state.revision);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    state = result.body.state;
  }
  if (seed !== undefined) {
    assert.equal(start, true);
    const room = await api.store.get(roomId);
    room.game = createGame({ seed });
    assert.equal(await api.store.compareAndSwap(room, room.revision), true);
    state = (await host.get()).body.state;
  }
  return { ...api, roomId, host, clients, state };
}

function assertError(result, status, code) {
  assert.equal(result.status, status, JSON.stringify(result.body));
  assert.equal(result.body.code, code);
  assert.equal(typeof result.body.error, 'string');
}

function assertPrivateView(state, seat, tokens = []) {
  assert.equal(state.you, seat);
  const serialized = JSON.stringify(state);
  for (const secret of tokens) assert.equal(serialized.includes(secret), false, 'a bearer token leaked into a snapshot');
  function checkKeys(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      assert.equal(['token', 'tokenHash', 'wall', 'lastDraw'].includes(key), false, `private field ${key} leaked`);
      checkKeys(nested);
    }
  }
  checkKeys(state);
  for (const player of state.seats.filter(Boolean)) assert.equal('hand' in player, false);
  if (!state.game) return;
  assert.equal(state.game.mySeat, seat);
  for (const player of state.game.players) {
    if (player.seat === seat) {
      assert.ok(Array.isArray(player.hand));
      assert.equal(player.hand.length, player.handCount);
    } else {
      assert.equal('hand' in player, false, 'opponent hand leaked');
    }
    assert.equal(typeof player.score, 'number');
    assert.ok(Array.isArray(player.melds));
  }
  if (state.game.currentSeat !== seat || state.game.turnStep !== 'discard') assert.equal(state.game.drawnTile, null);
  for (const event of state.game.history.filter(event => event.type === 'draw')) {
    assert.equal('tile' in event, false, 'draw history revealed a private tile');
    assert.equal('drawnTile' in event, false);
    assert.doesNotMatch(event.message, /[一二三四五六七八九1-9][条筒]/u, 'draw message revealed a private tile');
  }
}

async function snapshots(clients) {
  const results = await Promise.all(clients.map(player => player.get()));
  for (const result of results) assert.equal(result.status, 200, JSON.stringify(result.body));
  const states = results.map(result => result.body.state);
  assert.equal(new Set(states.map(state => state.revision)).size, 1, 'clients disagree on room revision');
  const tokens = clients.map(player => player.token);
  states.forEach((state, seat) => assertPrivateView(state, seat, tokens));
  return states;
}

async function passClaims(clients) {
  let states = await snapshots(clients);
  let passes = 0;
  while (states[0].game.phase === 'claim') {
    const seat = states.findIndex(state => state.game.legalActions.some(action => action.type === 'pass'));
    assert.notEqual(seat, -1, 'claim window has no remaining responder');
    const result = await clients[seat].action(states[seat].revision, { type: 'pass' });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    passes++;
    assert.ok(passes <= 2, 'a claim window requested a repeated response');
    states = await snapshots(clients);
  }
  return { states, passes };
}

function chunkedRequest(api, chunks) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${api.origin}/api/rooms`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(body) }); }
        catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.setTimeout(5000, () => request.destroy(new Error('chunked request timed out')));
    chunks.forEach(chunk => request.write(chunk));
    request.end();
  });
}

test('health and API responses are JSON, non-cacheable, and same-origin protected', async t => {
  const api = await harness(t);
  const healthy = await api.request('/api/health', { headers: { origin: api.origin } });
  assert.equal(healthy.status, 200);
  assert.equal(healthy.body.ok, true);
  assert.equal(healthy.body.version, '0.4.2');
  assert.equal(healthy.body.rulesVersion, 3);
  assert.match(healthy.headers.get('content-type'), /application\/json/);
  assert.match(healthy.headers.get('cache-control'), /no-store/);
  assert.equal(healthy.headers.get('x-content-type-options'), 'nosniff');
  assertError(await api.request('/api/health', { headers: { origin: 'https://attacker.example' } }), 403, 'ORIGIN');
  assertError(await api.request('/api/rooms', { method: 'POST', body: { name: '跨站' }, headers: { origin: 'https://attacker.example' } }), 403, 'ORIGIN');
  assert.equal(api.store.rooms.size, 0);
});

test('HTTPS proxy scheme is honored only when explicit proxy trust is enabled', async t => {
  const previous = process.env.TRUST_PROXY;
  t.after(() => { if (previous === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = previous; });
  const api = await harness(t);
  const secureOrigin = api.origin.replace(/^http:/, 'https:');
  delete process.env.TRUST_PROXY;
  assertError(await api.request('/api/health', { headers: { origin: secureOrigin, 'x-forwarded-proto': 'https' } }), 403, 'ORIGIN');
  process.env.TRUST_PROXY = '1';
  assert.equal((await api.request('/api/health', { headers: { origin: secureOrigin, 'x-forwarded-proto': 'https' } })).status, 200);
  assertError(await api.request('/api/health', { headers: { origin: 'https://attacker.example', 'x-forwarded-proto': 'https' } }), 403, 'ORIGIN');
  assertError(await api.request('/api/health', { headers: { origin: api.origin, 'x-forwarded-proto': 'https' } }), 403, 'ORIGIN');
});

test('names are normalized, bounded, and checked for collisions after normalization', async t => {
  const api = await harness(t);
  for (const name of [undefined, null, 42, {}, '', '   ', 'a'.repeat(17), '甲\u0000乙', '甲\u200b乙']) {
    assertError(await api.request('/api/rooms', { method: 'POST', body: { name } }), 400, 'BAD_NAME');
  }
  const { roomId, state } = await createRoom(api, '  e\u0301  ');
  assert.equal(state.seats[0].name, 'é');
  assertError(await joinRoom(api, roomId, 'é'), 409, 'NAME_TAKEN');
  assertError(await joinRoom(api, roomId, '\n'), 400, 'BAD_NAME');
  const joined = await joinRoom(api, roomId, '😀'.repeat(16));
  assert.equal(joined.status, 201, 'name bounds should count Unicode characters, not UTF-16 code units');
  assert.equal(joined.body.state.seats[1].name, '😀'.repeat(16));
});

test('room credentials are independent, opaque, and stored only as hashes', async t => {
  const api = await harness(t);
  const first = await createRoom(api, '一');
  const second = await createRoom(api, '二');
  assert.match(first.roomId, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.notEqual(first.roomId, second.roomId);
  assert.match(first.host.token, /^[a-f0-9]{64}$/);
  assert.notEqual(first.host.token, second.host.token);
  const stored = await api.store.get(first.roomId);
  assert.notEqual(stored.seats[0].tokenHash, first.host.token);
  assert.equal(JSON.stringify(stored).includes(first.host.token), false);
  assertPrivateView(first.state, 0, [first.host.token]);
  assertError(await api.request(`/api/rooms/${first.roomId}`, { token: second.host.token }), 401, 'UNAUTHORIZED');
});

test('Node clients cannot bypass room creation throttling with a forged Cloudflare IP header', async t => {
  const api = await harness(t);
  for (let i = 0; i < 10; i++) await createRoom(api, `建房${i}`);
  assertError(await api.request('/api/rooms', { method: 'POST', body: { name: '超限' } }), 429, 'RATE_LIMIT');
  assertError(await api.request('/api/rooms', {
    method: 'POST', body: { name: '伪造来源' }, headers: { 'cf-connecting-ip': '198.51.100.42' },
  }), 429, 'RATE_LIMIT');
  assert.equal(api.store.rooms.size, 10);
});

test('malformed and oversized bodies are rejected without creating a room', async t => {
  const api = await harness(t);
  for (const rawBody of ['{', '[]', 'null', '3', '"name"']) {
    assertError(await api.request('/api/rooms', { method: 'POST', rawBody }), 400, 'BAD_JSON');
  }
  assertError(await api.request('/api/rooms', { method: 'POST', body: { name: 'x', padding: 'x'.repeat(2050) } }), 413, 'TOO_LARGE');
  assert.equal(api.store.rooms.size, 0);
});

test('chunked bodies are limited by bytes even without a Content-Length header', async t => {
  const api = await harness(t);
  const unicode = JSON.stringify({ name: '中文', padding: '字'.repeat(800) });
  assert.ok(unicode.length < 2048);
  assert.ok(Buffer.byteLength(unicode) > 2048);
  assertError(await chunkedRequest(api, [unicode.slice(0, 20), unicode.slice(20)]), 413, 'TOO_LARGE');
  assert.equal(api.store.rooms.size, 0);
  const valid = await chunkedRequest(api, ['{"name":', '"分块"}']);
  assert.equal(valid.status, 201);
  assert.equal(valid.body.state.seats[0].name, '分块');
});

test('explicit seat choice cannot overwrite a player or allocate a fourth seat', async t => {
  const api = await harness(t);
  const { roomId, host } = await createRoom(api);
  assertError(await joinRoom(api, roomId, '占东', 0), 409, 'SEAT_TAKEN');
  for (const seat of [-1, 3, 1.5, '1', null]) assertError(await joinRoom(api, roomId, '错误', seat), 409, 'ROOM_FULL');
  const last = await joinRoom(api, roomId, '坐西', 2);
  assert.equal(last.status, 201);
  assert.equal(last.body.state.you, 2);
  const middle = await joinRoom(api, roomId, '坐南', 1);
  assert.equal(middle.status, 201);
  assertError(await joinRoom(api, roomId, '第四位'), 409, 'ROOM_FULL');
  const state = (await host.get()).body.state;
  assert.deepEqual(state.seats.map(seat => seat.name), ['东家', '坐南', '坐西']);
});

test('concurrent joins atomically reserve at most three seats and losing clients can retry safely', async t => {
  const api = await harness(t);
  const { roomId, host } = await createRoom(api);
  const names = Array.from({ length: 8 }, (_, i) => `客人${i}`);
  const attempts = await Promise.all(names.map(name => joinRoom(api, roomId, name)));
  const accepted = attempts.filter(result => result.status === 201);
  assert.ok(accepted.length >= 1 && accepted.length <= 2);
  for (const result of attempts.filter(result => result.status !== 201)) assert.equal(result.status, 409);
  // A CAS conflict may reject an otherwise available seat. Retry only clients
  // that received a definite failure, as the browser join flow would do.
  for (let i = 0; accepted.length < 2 && i < attempts.length; i++) {
    if (attempts[i].status === 201) continue;
    const result = await joinRoom(api, roomId, names[i]);
    if (result.status === 201) accepted.push(result);
  }
  assert.equal(accepted.length, 2);
  assert.equal(new Set(accepted.map(result => result.body.state.you)).size, 2);
  const state = (await host.get()).body.state;
  assert.equal(state.seats.filter(Boolean).length, 3);
  assert.equal(state.revision, 2, 'losing joins must not advance revision');
  const extra = await Promise.all(['额外甲', '额外乙'].map(name => joinRoom(api, roomId, name)));
  extra.forEach(result => assertError(result, 409, 'ROOM_FULL'));
  const peers = accepted.map(result => client(api, roomId, result.body.token, result.body.state.you));
  await snapshots([host, ...peers].sort((a, b) => a.seat - b.seat));
});

test('only the authenticated host can start a full table', async t => {
  const api = await harness(t);
  const { roomId, host } = await createRoom(api);
  assertError(await host.start(0), 409, 'NOT_FULL');
  assertError(await host.action(0, { type: 'draw' }), 409, 'NOT_STARTED');
  const joined = await joinRoom(api, roomId, '南家');
  const guest = client(api, roomId, joined.body.token, 1);
  assertError(await guest.start(1), 403, 'HOST_ONLY');
  assertError(await host.start(1), 409, 'NOT_FULL');
  await joinRoom(api, roomId, '西家');
  assertError(await guest.start(2), 403, 'HOST_ONLY');
  const started = await host.start(2);
  assert.equal(started.status, 200);
  assert.equal(started.body.state.phase, 'playing');
  assert.equal(started.body.state.revision, 3);
  assertError(await host.start(3), 409, 'PLAYING');
  assert.equal((await host.get()).body.state.revision, 3);
});

test('missing, malformed, forged, and other-room tokens cannot read or mutate a room', async t => {
  const api = await table(t);
  for (const token of [undefined, 'bad', '0'.repeat(64), 'A'.repeat(64), `${api.host.token.slice(0, -1)}z`]) {
    assertError(await api.request(`/api/rooms/${api.roomId}`, { token }), 401, 'UNAUTHORIZED');
    assertError(await api.request(`/api/rooms/${api.roomId}/action`, { method: 'POST', token, body: { revision: api.state.revision, action: { type: 'draw' } } }), 401, 'UNAUTHORIZED');
  }
  const elsewhere = await createRoom(api, '别的房间');
  assertError(await api.request(`/api/rooms/${api.roomId}`, { token: elsewhere.host.token }), 401, 'UNAUTHORIZED');
  assert.equal((await api.host.get()).body.state.revision, api.state.revision);
});

test('all three authenticated clients receive only their own hand and can reconnect', async t => {
  const api = await table(t);
  const states = await snapshots(api.clients);
  const authoritative = await api.store.get(api.roomId);
  states.forEach((state, seat) => {
    assert.deepEqual(state.game.players[seat].hand, authoritative.game.players[seat].hand);
    assert.equal(state.game.wallCount, 104);
    assert.equal(state.game.drawnTile, seat === 0 ? authoritative.game.lastDraw.tile : null);
  });
  const reconnected = client(api, api.roomId, api.clients[1].token, 1);
  const response = await reconnected.get();
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.state, states[1]);
});

test('clients cannot use payload seat fields to impersonate another authenticated player', async t => {
  const api = await table(t);
  const tile = api.state.game.players[0].hand[0];
  const before = await api.store.get(api.roomId);
  const forged = await api.clients[1].action(api.state.revision, { type: 'discard', tile, seat: 0 }, { seat: 0, playerSeat: 0, token: api.host.token });
  assertError(forged, 422, 'ILLEGAL_ACTION');
  assertError(await api.clients[2].action(api.state.revision, { type: 'draw' }, { seat: 0 }), 422, 'ILLEGAL_ACTION');
  assertError(await api.host.action(api.state.revision, { type: 'draw' }), 422, 'ILLEGAL_ACTION');
  assertError(await api.host.action(api.state.revision, { type: 'cheat' }), 422, 'ILLEGAL_ACTION');
  assert.deepEqual((await api.store.get(api.roomId)).game, before.game);
  assert.equal((await api.host.get()).body.state.revision, before.revision);
});

test('malformed tile IDs and action shapes fail without altering game state', async t => {
  const api = await table(t);
  const before = await api.store.get(api.roomId);
  for (const tile of [-1, 18, 1.5, '1', null, {}, []]) {
    assertError(await api.host.action(api.state.revision, { type: 'discard', tile }), 400, 'BAD_TILE');
  }
  for (const action of [null, [], {}, { type: 1 }]) {
    assertError(await api.host.action(api.state.revision, action), 400, 'BAD_ACTION');
  }
  assertError(await api.host.action(api.state.revision, { type: 'discard' }), 422, 'ILLEGAL_ACTION');
  const after = await api.store.get(api.roomId);
  assert.deepEqual(after.game, before.game);
  assert.equal(after.revision, before.revision);
});

test('every mutation requires the exact integer revision, and retries cannot apply twice', async t => {
  const api = await table(t);
  const action = { type: 'discard', tile: api.state.game.players[0].hand[0] };
  for (const revision of [undefined, null, '3', -1, 1.5, api.state.revision - 1, api.state.revision + 1]) {
    assertError(await api.host.action(revision, action), 409, 'STALE_STATE');
  }
  const requests = await Promise.all([api.host.action(api.state.revision, action), api.host.action(api.state.revision, action)]);
  assert.deepEqual(requests.map(result => result.status).sort(), [200, 409]);
  assertError(requests.find(result => result.status === 409), 409, 'STALE_STATE');
  assertError(await api.host.action(api.state.revision, action), 409, 'STALE_STATE');
  const states = await snapshots(api.clients);
  assert.equal(states[0].revision, api.state.revision + 1);
  assert.equal(states[0].game.discards.length, 1);
});

test('server draws after all responses and rotates three clients without a manual draw action', async t => {
  const api = await table(t, { seed: 0 });
  const before = (await api.store.get(api.roomId)).game;
  const first = await api.host.action(api.state.revision, { type: 'discard', tile: 8 });
  assert.equal(first.status, 200);
  assert.equal(first.body.state.game.phase, 'claim');
  assert.equal(first.body.state.game.wallCount, before.wall.length, 'no draw while claims are outstanding');
  const claim = await passClaims(api.clients);
  assert.ok(claim.passes > 0);
  let states = claim.states;
  assert.equal(states[0].game.currentSeat, 1);
  assert.equal(states[0].game.wallCount, before.wall.length - 1);
  for (const seat of [1, 2, 0]) {
    assert.equal(states[seat].game.currentSeat, seat);
    assert.equal(states[seat].game.turnStep, 'discard');
    assert.equal(states[seat].game.legalActions.some(action => action.type === 'draw'), false);
    assert.equal(typeof states[seat].game.drawnTile, 'number');
    const previousRevision = states[seat].revision;
    assertError(await api.clients[seat].action(previousRevision, { type: 'draw' }), 422, 'ILLEGAL_ACTION');
    states.forEach((state, index) => {
      if (index !== seat) assert.equal(state.game.drawnTile, null);
      const latest = state.game.history.at(-1);
      assert.equal(latest.type, 'draw');
      assert.equal('tile' in latest, false);
    });
    const wallBefore = states[seat].game.wallCount;
    const discard = states[seat].game.legalActions.find(action => action.type === 'discard');
    const discarded = await api.clients[seat].action(previousRevision, discard);
    assert.equal(discarded.status, 200);
    assert.equal(discarded.body.state.revision, previousRevision + 1);
    states = (await passClaims(api.clients)).states;
    assert.equal(states[0].game.currentSeat, (seat + 1) % 3);
    assert.equal(states[0].game.wallCount, wallBefore - 1);
  }
});

test('open melds are public while private hands and pending claim choices remain hidden', async t => {
  const api = await table(t, { seed: 0 });
  const discarded = await api.host.action(api.state.revision, { type: 'discard', tile: 8 });
  assert.equal(discarded.status, 200);
  let states = await snapshots(api.clients);
  assert.equal(states[1].game.legalActions.some(action => action.type === 'peng'), true);
  assert.equal('options' in states[0].game.claim, false);
  assert.equal('responses' in states[0].game.claim, false);
  const peng = await api.clients[1].action(states[1].revision, { type: 'peng', tile: 8 });
  assert.equal(peng.status, 200, JSON.stringify(peng.body));
  states = (await passClaims(api.clients)).states;
  for (const state of states) {
    const meld = state.game.players[1].melds[0];
    assert.equal(meld.type, 'peng');
    assert.deepEqual(meld.tiles, [8, 8, 8]);
    assert.deepEqual(state.seats[1].melds, state.game.players[1].melds);
    assert.equal(state.game.currentSeat, 1);
    assert.equal(state.game.turnStep, 'discard');
  }
});

test('simultaneous claimants must refresh stale revisions and cannot see each other’s pending choice', async t => {
  const api = await table(t, { seed: 13 });
  const discarded = await api.host.action(api.state.revision, { type: 'discard', tile: 7 });
  assert.equal(discarded.status, 200);
  let states = await snapshots(api.clients);
  assert.deepEqual(states[0].game.claim.eligibleSeats, [1, 2]);
  const revision = states[0].revision;
  const chosen = await api.clients[1].action(revision, { type: 'peng', tile: 7 });
  assert.equal(chosen.status, 200);
  assert.equal(chosen.body.state.game.phase, 'claim');
  assertError(await api.clients[2].action(revision, { type: 'pass' }), 409, 'STALE_STATE');
  states = await snapshots(api.clients);
  for (const state of states) {
    assert.equal('responses' in state.game.claim, false);
    assert.equal('options' in state.game.claim, false);
    assert.deepEqual(state.game.claim.respondedSeats, [1]);
    assert.equal(state.game.history.some(event => event.type === 'peng'), false);
    assert.equal(state.game.players[1].melds.length, 0);
  }
  assert.deepEqual(states[1].game.legalActions, []);
  assertError(await api.clients[1].action(states[1].revision, { type: 'pass' }), 422, 'ILLEGAL_ACTION');
  const resolved = await api.clients[2].action(states[2].revision, { type: 'pass' });
  assert.equal(resolved.status, 200);
  states = await snapshots(api.clients);
  assert.equal(states[0].game.phase, 'turn');
  assert.equal(states[0].game.currentSeat, 1);
  assert.equal(states[0].game.players[1].melds[0].type, 'peng');
});

test('concealed kongs stay concealed and replacement draw history never reveals the tile', async t => {
  const api = await table(t, { seed: 0 });
  assert.ok(api.state.game.legalActions.some(action => action.type === 'anGang' && action.tile === 7));
  const result = await api.host.action(api.state.revision, { type: 'anGang', tile: 7 });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const states = await snapshots(api.clients);
  assert.deepEqual(states[0].game.players[0].melds[0].tiles, [7, 7, 7, 7]);
  for (const state of states.slice(1)) {
    const meld = state.game.players[0].melds[0];
    assert.equal(meld.tile, null);
    assert.equal(meld.hidden, true);
    assert.deepEqual(meld.tiles, [null, null, null, null]);
    assert.deepEqual(state.seats[0].melds, [meld]);
  }
  for (const state of states) {
    assert.equal(state.game.history.at(-1).type, 'draw');
    assert.equal(state.game.history.at(-1).source, 'replacement');
    assert.equal('tile' in state.game.history.at(-1), false);
    assert.equal('tile' in state.game.history.find(event => event.type === 'anGang'), false);
  }
});

test('scores, radishes, and scoring events are public without exposing the winning hand', async t => {
  const api = await table(t, { seed: 0 });
  const room = await api.store.get(api.roomId);
  const game = createGame({ seed: 'scoring' });
  const remaining = Array(18).fill(8);
  const winning = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6];
  game.players[0].hand = winning;
  for (const tile of winning) remaining[tile]--;
  for (const seat of [1, 2]) {
    const hand = [];
    for (let tile = 9; hand.length < 13; tile = (tile + 1) % 18) {
      if (remaining[tile]) { hand.push(tile); remaining[tile]--; }
    }
    game.players[seat].hand = hand.sort((a, b) => a - b);
  }
  game.wall = remaining.flatMap((count, tile) => Array(count).fill(tile));
  game.lastDraw = { seat: 0, tile: 6, source: 'initial' };
  assertGameInvariants(game);
  room.game = game;
  assert.equal(await api.store.compareAndSwap(room, room.revision), true);
  const result = await api.host.action(room.revision, { type: 'hu' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const states = await snapshots(api.clients);
  for (const state of states) {
    assert.equal(state.game.players.reduce((sum, player) => sum + player.score, 0), 0);
    assert.ok(state.game.players[0].score > 0);
    assert.ok(state.game.players[1].score < 0);
    assert.equal(state.game.players[0].huCount, 1);
    assert.equal(state.game.players[0].radishes.length, 6);
    assert.deepEqual(state.seats.map(player => player.score), state.game.players.map(player => player.score));
    const event = state.game.history.find(item => item.type === 'hu');
    assert.ok(event.points > 0);
    assert.equal(event.payments.reduce((sum, payment) => sum + payment.delta, 0), 0);
    assert.equal('hand' in event, false);
  }
  assert.deepEqual(states[0].game.players.map(player => player.score), states[2].game.players.map(player => player.score));
});

test('an active room refuses new joins and cannot be replaced by a guest', async t => {
  const api = await table(t);
  assertError(await joinRoom(api, api.roomId, '后来者'), 409, 'STARTED');
  assertError(await api.clients[1].start(api.state.revision), 403, 'HOST_ONLY');
  assert.equal((await api.host.get()).body.state.revision, api.state.revision);
  await snapshots(api.clients);
});

test('FileStore reload preserves game, revision, and authenticated reconnect without persisting raw bearer tokens', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'flower-mahjong-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = await table(t, { store: new FileStore(directory), seed: 0 });
  const discarded = await first.host.action(first.state.revision, { type: 'discard', tile: 8 });
  assert.equal(discarded.status, 200);
  await passClaims(first.clients);
  let before = await snapshots(first.clients);
  assert.equal(before[1].game.turnStep, 'discard');
  assert.equal(before[1].game.schemaVersion, 2);
  const disk = await readFile(join(directory, 'rooms.json'), 'utf8');
  first.clients.forEach(player => assert.equal(disk.includes(player.token), false));
  assert.ok(disk.includes('tokenHash'));
  const second = await harness(t, new FileStore(directory));
  const reconnected = first.clients.map(player => client(second, player.roomId, player.token, player.seat));
  const after = await snapshots(reconnected);
  for (let seat = 0; seat < 3; seat++) assert.deepEqual(after[seat], before[seat]);
  const discard = after[1].game.legalActions.find(action => action.type === 'discard');
  const resumed = await reconnected[1].action(after[1].revision, discard);
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.equal(resumed.body.state.revision, before[1].revision + 1);
  assertError(await reconnected[1].action(after[1].revision, discard), 409, 'STALE_STATE');
});

class CountingStore extends MemoryStore {
  gets = 0;
  touches = 0;
  async get(id) { this.gets++; return super.get(id); }
  async touch(...args) { this.touches++; return super.touch(...args); }
  resetCounts() { this.gets = 0; this.touches = 0; }
}

test('revision polling authenticates, returns a tiny unchanged envelope, and uses one read with throttled heartbeat', async t => {
  const store = new CountingStore();
  const api = await table(t, { store });
  store.resetCounts();
  const same = await api.host.get(api.state.revision);
  assert.equal(same.status, 200);
  assert.deepEqual(same.body, { unchanged: true, revision: api.state.revision, connections: [true, true, true] });
  assert.equal(store.gets, 1);
  assert.equal(store.touches, 0);
  assert.ok(Buffer.byteLength(JSON.stringify(same.body)) < 100);
  assertError(await api.request(`/api/rooms/${api.roomId}?since=${api.state.revision}`), 401, 'UNAUTHORIZED');
  assertError(await api.request(`/api/rooms/${api.roomId}?since=${api.state.revision}`, { token: '0'.repeat(64) }), 401, 'UNAUTHORIZED');
  for (const since of [api.state.revision - 1, api.state.revision + 1, -1, '3.5', 'NaN', '', 'Infinity']) {
    store.resetCounts();
    const full = await api.host.get(since);
    assert.equal(full.status, 200);
    assert.equal(full.body.unchanged, undefined);
    assert.equal(full.body.state.revision, api.state.revision);
    assertPrivateView(full.body.state, 0, api.clients.map(player => player.token));
    assert.equal(store.gets, 1);
    assert.equal(store.touches, 0);
  }
  const room = store.rooms.get(api.roomId);
  room.seats[0].lastSeen = Date.now() - 11000;
  room.seats[1].lastSeen = Date.now() - 31000;
  store.resetCounts();
  const reconnected = await api.host.get(api.state.revision);
  assert.deepEqual(reconnected.body.connections, [true, false, true]);
  assert.equal(store.gets, 1);
  assert.equal(store.touches, 1);
  await api.host.get(api.state.revision);
  assert.equal(store.gets, 2);
  assert.equal(store.touches, 1, 'a second rapid poll must not write another heartbeat');
  assert.equal(store.rooms.get(api.roomId).revision, api.state.revision, 'heartbeat must not advance game revision');
});

test('mutation response is authoritative and the next conditional poll detects peers without another action GET', async t => {
  const api = await table(t, { seed: 0 });
  const oldRevision = api.state.revision;
  const acted = await api.host.action(oldRevision, { type: 'discard', tile: 8 });
  assert.equal(acted.status, 200);
  assert.equal(acted.body.state.revision, oldRevision + 1);
  const ownPoll = await api.host.get(acted.body.state.revision);
  assert.equal(ownPoll.body.unchanged, true);
  for (const peer of api.clients.slice(1)) {
    const poll = await peer.get(oldRevision);
    assert.equal(poll.body.state.revision, acted.body.state.revision);
    assertPrivateView(poll.body.state, peer.seat, api.clients.map(player => player.token));
  }
});

for (const version of [undefined, 1]) {
  test(`saved legacy schema ${version ?? 'absent'} reconnects byte-for-byte, retains manual draw, and starts v3 only after completion`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'flower-mahjong-legacy-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const api = await table(t, { store: new FileStore(directory) });
    const room = await api.store.get(api.roomId);
    const game = createLegacyGame({ seed: 13 });
    if (version !== undefined) game.schemaVersion = version;
    game.retiredTiles.push({ seat: 0, tile: game.lastDraw.tile });
    game.players[0].hand.splice(game.players[0].hand.indexOf(game.lastDraw.tile), 1);
    game.retiredTiles.push(...game.wall.splice(1).map(tile => ({ seat: 0, tile })));
    game.turnStep = 'draw'; game.lastDraw = null;
    assertLegacyInvariants(game);
    room.game = game;
    assert.equal(await api.store.compareAndSwap(room, room.revision), true);
    const gameBytes = JSON.stringify(game);
    const reloaded = await harness(t, new FileStore(directory));
    const peers = api.clients.map(player => client(reloaded, api.roomId, player.token, player.seat));
    const views = await snapshots(peers);
    for (const view of views) {
      assert.equal(view.game.schemaVersion, 1);
      assert.equal(view.rulesVersion, 1);
    }
    assert.equal(JSON.stringify((await reloaded.store.get(api.roomId)).game), gameBytes, 'read/reconnect migrated or mutated legacy game');
    assert.deepEqual(views[0].game.legalActions, [{ type: 'draw' }]);
    assertError(await peers[0].start(views[0].revision), 409, 'PLAYING');
    const drawn = await peers[0].action(views[0].revision, { type: 'draw' });
    assert.equal(drawn.status, 200);
    assert.equal(drawn.body.state.game.schemaVersion, 1);
    assert.equal(drawn.body.state.game.wallCount, 0);
    const discarded = await peers[0].action(drawn.body.state.revision, drawn.body.state.game.legalActions.find(action => action.type === 'discard'));
    assert.equal(discarded.status, 200);
    const ended = (await passClaims(peers)).states[0];
    assert.equal(ended.game.phase, 'finished');
    assert.equal(ended.game.schemaVersion, 1);
    const restarted = await peers[0].start(ended.revision);
    assert.equal(restarted.status, 200);
    assert.equal(restarted.body.state.game.schemaVersion, 3);
    assert.equal(restarted.body.state.rulesVersion, 3);
    assert.equal(restarted.body.state.game.wallCount, 104);
  });
}

test('unknown saved game version fails closed without altering the stored game', async t => {
  const api = await table(t);
  const room = await api.store.get(api.roomId);
  room.game.schemaVersion = 999;
  assert.equal(await api.store.compareAndSwap(room, room.revision), true);
  const before = JSON.stringify(room.game);
  assertError(await api.host.get(), 409, 'UNSUPPORTED_GAME_VERSION');
  assertError(await api.host.action(room.revision, { type: 'discard', tile: room.game.players[0].hand[0] }), 409, 'UNSUPPORTED_GAME_VERSION');
  assert.equal(JSON.stringify((await api.store.get(api.roomId)).game), before);
});

const WAITING_HAND = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
const WINNING_HAND = [...WAITING_HAND, 17];
const PAIR_CLAIM_HAND = [17, 17, 0, 1, 3, 4, 6, 7, 9, 10, 12, 13, 15];
const KONG_CLAIM_HAND = [17, 17, 17, 0, 1, 3, 4, 6, 7, 9, 10, 12, 13];

// Independent physical accounting deliberately does NOT count logical winPile
// references. A multi-winner tile remains exactly one physical river tile.
function checkPhysicalConservation(game) {
  const physical = [...game.wall, ...game.retiredTiles.map(record => record.tile),
    ...game.discards.filter(record => record.claimedBy === undefined).map(record => record.tile),
    ...game.players.flatMap(player => [...player.hand, ...player.melds.flatMap(meld => meld.tiles), ...player.radishes])];
  assert.equal(physical.length, 144);
  for (let tile = 0; tile < 18; tile++) assert.equal(physical.filter(value => value === tile).length, 8, `physical copies of ${tile}`);
  assert.equal(game.players.reduce((sum, player) => sum + player.score, 0), 0);
  assertGameInvariants(game);
}

function apiFixture({ hands = [WINNING_HAND, WAITING_HAND, WAITING_HAND], melds = [[], [], []],
  wins = [[], [], []], radishes = [[], [], []], currentSeat = 0, drawTile = hands[currentSeat].at(-1),
  head = [], tail = [], kongSeats = [], locks = [[], [], []], wallCount, rules = {} } = {}) {
  const game = createGame({ seed: 'independent-http-fixture', rules });
  game.history = []; game.discards = []; game.retiredTiles = [];
  game.players.forEach((player, seat) => {
    player.hand = [...hands[seat]].sort((a, b) => a - b);
    player.melds = structuredClone(melds[seat]);
    player.winPile = wins[seat].map(tile => ({ tile, source: 'selfDraw', virtual: false }));
    game.retiredTiles.push(...wins[seat].map(tile => ({ seat, tile })));
    player.huCount = wins[seat].length;
    player.radishes = [...radishes[seat]];
    player.pendingKongDiscard = kongSeats.includes(seat);
    player.lockedWaits = [...locks[seat]]; player.huLockActive = locks[seat].length > 0;
  });
  game.currentSeat = currentSeat;
  game.lastDraw = drawTile === null ? null : { seat: currentSeat, tile: drawTile, source: 'normal' };
  const counts = Array(18).fill(8);
  function use(tile) { assert.ok(Number.isInteger(tile) && tile >= 0 && tile < 18); assert.ok(--counts[tile] >= 0, `fixture overused ${tile}`); }
  game.retiredTiles.forEach(record => use(record.tile));
  game.players.forEach(player => [...player.hand, ...player.melds.flatMap(meld => meld.tiles), ...player.radishes].forEach(use));
  [...head, ...tail].forEach(use);
  const rest = counts.flatMap((count, tile) => Array(count).fill(tile));
  if (wallCount !== undefined) {
    assert.ok(wallCount >= head.length + tail.length);
    game.retiredTiles.push(...rest.splice(wallCount - head.length - tail.length).map(tile => ({ seat: 0, tile })));
  }
  game.wall = [...head, ...rest, ...tail];
  checkPhysicalConservation(game);
  return game;
}

async function installFixture(api, game) {
  const room = await api.store.get(api.roomId);
  room.game = game;
  assert.equal(await api.store.compareAndSwap(room, room.revision), true);
  return snapshots(api.clients);
}

async function checkStored(api) {
  const room = await api.store.get(api.roomId);
  checkPhysicalConservation(room.game);
  return room.game;
}

test('duplicate concurrent self-hu is charged once, flips six radishes once, and keeps the public winning pile', async t => {
  const api = await table(t);
  const game = apiFixture({ head: [6, 8], tail: [7, 7, 8, 8, 15, 15] });
  let views = await installFixture(api, game);
  const revision = views[0].revision;
  const answers = await Promise.all([api.host.action(revision, { type: 'hu' }), api.host.action(revision, { type: 'hu' })]);
  assert.deepEqual(answers.map(answer => answer.status).sort(), [200, 409]);
  assertError(answers.find(answer => answer.status === 409), 409, 'STALE_STATE');
  views = await snapshots(api.clients);
  for (const view of views) {
    const player = view.game.players[0];
    assert.equal(player.huCount, 1);
    assert.equal(player.radishes.length, 6);
    assert.deepEqual(player.winPile, [{ tile: 17, source: 'selfDraw', virtual: false }]);
    assert.deepEqual(view.seats[0].winPile, player.winPile);
    assert.equal(view.game.history.filter(event => event.type === 'hu').length, 1);
    assert.deepEqual(view.game.players.map(player => player.score), [2, -1, -1]);
    assert.equal(player.lastScoreBreakdown.fan, 1);
    assert.equal(player.lastScoreBreakdown.total, 1);
    assert.equal(view.game.history.filter(event => event.type === 'discard' && event.automatic).length, 1);
    assert.equal(view.game.history.find(event => event.automatic).tile, 6, 'automatic discard must use continuation draw, not another hand tile');
  }
  assert.deepEqual((await checkStored(api)).players[0].hand, WAITING_HAND);
  assertError(await api.host.action(revision, { type: 'hu' }), 409, 'STALE_STATE');
});

for (const { name, near, far, responses, winner, claimType, expectedScores } of [
  { name: 'farther kong outranks nearer peng', near: PAIR_CLAIM_HAND, far: KONG_CLAIM_HAND, responses: ['peng', 'mingGang'], winner: 2, claimType: 'mingGang', expectedScores: [-2, 0, 2] },
  { name: 'equal peng chooses nearer seat', near: PAIR_CLAIM_HAND, far: PAIR_CLAIM_HAND, responses: ['peng', 'peng'], winner: 1, claimType: 'peng', expectedScores: [0, 0, 0] },
  { name: 'equal kong chooses nearer seat', near: KONG_CLAIM_HAND, far: KONG_CLAIM_HAND, responses: ['mingGang', 'mingGang'], winner: 1, claimType: 'mingGang', expectedScores: [-2, 2, 0] },
]) {
  test(`claim arbitration: ${name}, even when farther response arrives first`, async t => {
    const api = await table(t);
    let views = await installFixture(api, apiFixture({ hands: [WINNING_HAND, near, far], head: [8], tail: [16] }));
    assert.equal((await api.host.action(views[0].revision, { type: 'discard', tile: 17 })).status, 200);
    views = await snapshots(api.clients);
    assert.deepEqual(views[0].game.claim.eligibleSeats, [1, 2]);
    const wallBefore = views[0].game.wallCount;
    const first = await api.clients[2].action(views[2].revision, { type: responses[1], tile: 17 });
    assert.equal(first.status, 200);
    assert.equal(first.body.state.game.phase, 'claim');
    assert.equal(first.body.state.game.wallCount, wallBefore);
    assert.deepEqual(first.body.state.game.players.map(player => player.score), [0, 0, 0]);
    views = await snapshots(api.clients);
    const duplicateFinal = await Promise.all([1, 2].map(() => api.clients[1].action(views[1].revision, { type: responses[0], tile: 17 })));
    assert.deepEqual(duplicateFinal.map(answer => answer.status).sort(), [200, 409]);
    views = await snapshots(api.clients);
    for (const view of views) {
      assert.equal(view.game.currentSeat, winner);
      assert.equal(view.game.players[winner].melds[0].type, claimType);
      assert.equal(view.game.players[3 - winner].melds.length, 0);
      assert.deepEqual(view.game.players.map(player => player.score), expectedScores);
      assert.equal(view.game.players[winner].radishes.length, claimType === 'mingGang' ? 1 : 0);
      assert.equal(view.game.wallCount, wallBefore - (claimType === 'mingGang' ? 2 : 0));
      assert.equal(view.game.history.filter(event => event.type === claimType).length, 1);
    }
    await checkStored(api);
  });
}

test('hu outranks an already submitted kong and does not charge or draw for the losing kong', async t => {
  const api = await table(t);
  let views = await installFixture(api, apiFixture({ hands: [WINNING_HAND, WAITING_HAND, KONG_CLAIM_HAND], head: [8, 8], tail: [7, 7, 8, 8, 15, 15] }));
  assert.equal((await api.host.action(views[0].revision, { type: 'discard', tile: 17 })).status, 200);
  views = await snapshots(api.clients);
  const kong = await api.clients[2].action(views[2].revision, { type: 'mingGang', tile: 17 });
  assert.equal(kong.status, 200);
  assert.equal(kong.body.state.game.phase, 'claim');
  const hu = await api.clients[1].action(kong.body.state.revision, { type: 'hu' });
  assert.equal(hu.status, 200);
  views = await snapshots(api.clients);
  assert.equal(views[0].game.players[1].huCount, 1);
  assert.equal(views[0].game.players[2].melds.length, 0);
  assert.equal(views[0].game.players[2].radishes.length, 0);
  assert.equal(views[0].game.players[2].score, 0);
  assert.equal(views[0].game.history.some(event => event.type === 'mingGang'), false);
  await checkStored(api);
});

for (const type of ['anGang', 'buGang', 'addGang']) {
  test(`${type} immediately pays the exact amount once under concurrent retries`, async t => {
    const api = await table(t);
    const upgrade = type !== 'anGang';
    const hand = upgrade ? [17, 0, 1, 2, 3, 4, 5, 9, 10, 11, 12] : [17, 17, 17, 17, 0, 1, 2, 3, 4, 5, 9, 10, 11, 12];
    const meld = { type: type === 'buGang' ? 'peng' : 'anGang', tile: 17, tiles: Array(type === 'buGang' ? 3 : 4).fill(17) };
    const fixture = apiFixture({ hands: [hand, WAITING_HAND, WAITING_HAND], melds: [upgrade ? [meld] : [], [], []], head: [8], tail: [16] });
    const views = await installFixture(api, fixture);
    const action = { type, tile: 17 };
    const results = await Promise.all([api.host.action(views[0].revision, action), api.host.action(views[0].revision, action)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const after = await snapshots(api.clients);
    const amount = type === 'anGang' ? 2 : 1;
    for (const view of after) {
      assert.deepEqual(view.game.players.map(player => player.score), [amount * 2, -amount, -amount]);
      assert.equal(view.game.players[0].radishes.length, 1);
      assert.equal(view.game.players[0].kongCount, 1);
      assert.equal(view.game.wallCount, fixture.wall.length - 2);
      assert.equal(view.game.players[0].melds[0].tiles.length, type === 'addGang' ? 5 : 4);
      assert.equal(view.game.history.filter(event => event.type === type).length, 1);
    }
    if (type !== 'buGang') for (const view of after.slice(1)) assert.deepEqual(view.game.players[0].melds[0].tiles, Array(type === 'addGang' ? 5 : 4).fill(null));
    await checkStored(api);
  });
}

test('the final simultaneous two-winner batch fully settles before all-three-hu finish, without an extra draw', async t => {
  const api = await table(t);
  const fixture = apiFixture({ wins: [[16], [], []], kongSeats: [0], head: [8], tail: [6, 6, 7, 7, 8, 8, 15, 15, 16, 16, 6, 7] });
  let views = await installFixture(api, fixture);
  const discard = await api.host.action(views[0].revision, { type: 'discard', tile: 17 });
  assert.equal(discard.status, 200);
  views = await snapshots(api.clients);
  const responses = await Promise.all([api.clients[1].action(views[1].revision, { type: 'hu' }), api.clients[2].action(views[2].revision, { type: 'hu' })]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const losingIndex = responses.findIndex(response => response.status === 409);
  views = await snapshots(api.clients);
  assert.equal(views[0].game.phase, 'claim');
  assert.deepEqual(views[0].game.players.map(player => player.huCount), [1, 0, 0], 'no winner settled until all replies arrive');
  assert.equal(views[0].game.wallCount, fixture.wall.length);
  const finalSeat = losingIndex + 1;
  const finals = await Promise.all([api.clients[finalSeat].action(views[finalSeat].revision, { type: 'hu' }), api.clients[finalSeat].action(views[finalSeat].revision, { type: 'hu' })]);
  assert.deepEqual(finals.map(response => response.status).sort(), [200, 409]);
  views = await snapshots(api.clients);
  for (const view of views) {
    assert.equal(view.phase, 'finished');
    assert.equal(view.game.finishReason, 'allPlayersHu');
    assert.deepEqual(view.game.players.map(player => player.huCount), [1, 1, 1]);
    assert.deepEqual(view.game.players.map(player => player.radishes.length), [0, 6, 6]);
    assert.deepEqual(view.game.players.map(player => player.score), [-2, 1, 1]);
    assert.equal(view.game.wallCount, fixture.wall.length - 12);
    assert.equal(view.game.history.filter(event => event.type === 'draw').length, 0);
    assert.deepEqual(view.game.history.slice(-3).map(event => event.type), ['hu', 'hu', 'finish']);
    assert.equal(view.game.players[1].winPile[0].virtual, false);
    assert.equal(view.game.players[2].winPile[0].virtual, true);
    assert.equal(view.game.players[1].winPile[0].tile, 17);
    assert.equal(view.game.players[2].winPile[0].tile, 17);
    assert.deepEqual(view.game.discards[0].huSeats, [1, 2]);
    assert.deepEqual(view.game.legalActions, []);
  }
  await checkStored(api);
  const before = JSON.stringify((await api.store.get(api.roomId)).game);
  assertError(await api.host.action(views[0].revision, { type: 'discard', tile: 0 }), 422, 'ILLEGAL_ACTION');
  assert.equal(JSON.stringify((await api.store.get(api.roomId)).game), before);
});

for (const [fan, expected] of [[1, 1], [2, 2], [3, 4], [4, 8], [5, 10], [6, 12], [7, 14], [10, 20]]) {
  test(`HTTP scoring breakdown maps ${fan} fan to ${expected} points`, async t => {
    const api = await table(t);
    const fixture = apiFixture({ rules: { baseFan: fan }, head: [6, 8], tail: [7, 7, 8, 8, 15, 15] });
    const views = await installFixture(api, fixture);
    const scored = await api.host.action(views[0].revision, { type: 'hu' });
    assert.equal(scored.status, 200);
    const score = scored.body.state.game.players[0].lastScoreBreakdown;
    assert.equal(score.fan, fan);
    assert.equal(score.copyFanBonus, 0);
    assert.equal(score.fanPoints, expected);
    assert.equal(score.radishBonus, 0);
    assert.equal(score.dragonBonus, 0);
    assert.equal(score.total, expected);
    assert.deepEqual(scored.body.state.game.players.map(player => player.score), [expected * 2, -expected, -expected]);
    await checkStored(api);
  });
}

test('four and five identical tiles count across own hand, open meld and historical win pile, excluding opponents', async t => {
  for (const [priorWins, expectedFan, expectedPoints] of [[0, 2, 2], [1, 3, 4]]) {
    const api = await table(t);
    const hand = [0, 1, 2, 6, 7, 8, 9, 10, 11, 17, 17];
    const opponent = [6, ...WAITING_HAND.slice(1)];
    const fixture = apiFixture({ hands: [hand, opponent, opponent], melds: [[{ type: 'peng', tile: 6, tiles: [6, 6, 6] }], [], []],
      wins: [Array(priorWins).fill(6), [], []], head: [15, 15], tail: [3, 3, 4, 4, 5, 5], drawTile: 17 });
    const views = await installFixture(api, fixture);
    const answer = await api.host.action(views[0].revision, { type: 'hu' });
    assert.equal(answer.status, 200);
    const score = answer.body.state.game.players[0].lastScoreBreakdown;
    assert.equal(score.fan, expectedFan);
    assert.equal(score.copyFanBonus, priorWins + 1);
    assert.equal(score.fanPoints, expectedPoints);
    assert.equal(score.total, expectedPoints);
    assert.deepEqual(answer.body.state.game.players.map(player => player.score), [expectedPoints * 2, -expectedPoints, -expectedPoints]);
    await checkStored(api);
  }
});

test('after a win only the drawn tile can be discarded and an available hu suppresses kong', async t => {
  const api = await table(t);
  const hand = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5];
  const fixture = apiFixture({ hands: [hand, WAITING_HAND, WAITING_HAND], wins: [[16], [], []], drawTile: 5 });
  const views = await installFixture(api, fixture);
  const legal = views[0].game.legalActions;
  assert.ok(legal.some(action => action.type === 'hu'));
  assert.equal(legal.some(action => action.type.endsWith('Gang')), false);
  assert.deepEqual(legal.filter(action => action.type === 'discard'), [{ type: 'discard', tile: 5 }]);
  assertError(await api.host.action(views[0].revision, { type: 'discard', tile: 0 }), 422, 'ILLEGAL_ACTION');
  assertError(await api.host.action(views[0].revision, { type: 'anGang', tile: 0 }), 422, 'ILLEGAL_ACTION');
  assertError(await api.host.action(views[0].revision, { type: 'draw' }), 422, 'ILLEGAL_ACTION');
  const passed = await api.host.action(views[0].revision, { type: 'pass' });
  assert.equal(passed.status, 200);
  assert.equal(passed.body.state.game.discards[0].tile, 5);
  await checkStored(api);
});

test('v3 HTTP selfdraw uses all personal radish zones, excludes already-hu payer and rejects duplicate charge', async t => {
  const { DEFAULT_RULES, assertGameInvariants: assertLatest } = await import('../shared/game.js');
  const api = await table(t);
  const hand = [0,1,2,3,4,5,9,10,11,15,16,17,6,6];
  const game = apiFixture({ hands: [hand, WAITING_HAND, WAITING_HAND], wins: [[15,12],[7],[]], radishes: [[],[15,12,12],[]], drawTile: 6, head: [8] });
  game.schemaVersion = 3; game.rules = structuredClone(DEFAULT_RULES); game.firstHuRadishesRevealed = true;
  game.dragonSettlement = { settled: false, entries: [] }; assertLatest(game);
  let views = await installFixture(api,game); const rev = views[0].revision;
  const responses = await Promise.all([api.host.action(rev,{type:'hu'}),api.host.action(rev,{type:'hu'})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  views = await snapshots(api.clients);
  for (const view of views) {
    const event = view.game.history.find(e=>e.type==='hu');
    assert.equal(event.score.radishBonus,4); assert.equal(event.score.fan,1);
    assert.deepEqual(event.payments,[{seat:2,delta:-5},{seat:0,delta:5}]);
    assert.deepEqual(view.game.players.map(p=>p.score),[5,0,-5]);
    assert.equal(view.game.history.filter(e=>e.type==='hu').length,1);
  }
  assertLatest((await api.store.get(api.roomId)).game);
});

test('v3 HTTP exposes and settles locked repeat hu on the reported kong-discard five circles exactly once', async t => {
  const { DEFAULT_RULES, assertGameInvariants: assertLatest } = await import('../shared/game.js');
  const api = await table(t);
  const receiver = [4, 5, 6, 6, 7, 7, 7, 8, 11, 12, 13, 14, 15];
  const source = [2, 3, 5, 6, 7, 8, 8, 8, 10, 14, 14];
  const game = apiFixture({ hands: [source, receiver, WAITING_HAND],
    melds: [[{type:'peng',tile:10,tiles:[10,10,10]}],[],[]],
    wins: [[],[16,10,16,13,16],[]], locks: [[],[10,13,16],[]], drawTile:10, head:[13,0], tail:[16] });
  game.schemaVersion=3; game.rules=structuredClone(DEFAULT_RULES);
  game.firstHuRadishesRevealed=true; game.dragonSettlement={settled:false,entries:[]};
  assertLatest(game);
  let views=await installFixture(api,game);
  let answer=await api.host.action(views[0].revision,{type:'buGang',tile:10});
  assert.equal(answer.status,200);
  while (answer.body.state.game.phase === 'claim' && answer.body.state.game.claim.kind === 'robKong') {
    const claim = answer.body.state.game.claim;
    const seat = claim.eligibleSeats.find(seat => !claim.respondedSeats.includes(seat));
    answer = await api.clients[seat].action(answer.body.state.revision, { type: 'pass' });
    assert.equal(answer.status, 200);
  }
  answer=await api.host.action(answer.body.state.revision,{type:'discard',tile:13});
  assert.equal(answer.status,200);
  views=await snapshots(api.clients);
  assert.equal(views[1].game.huDiagnostic.code,'AVAILABLE');
  assert.ok(views[1].game.legalActions.some(action=>action.type==='hu'));
  assert.equal(views[1].game.discards.at(-1).afterKong,true);
  const revision=views[1].revision;
  const answers=await Promise.all([api.clients[1].action(revision,{type:'hu'}),api.clients[1].action(revision,{type:'hu'})]);
  assert.deepEqual(answers.map(answer=>answer.status).sort(),[200,409]);
  views=await snapshots(api.clients);
  for(const view of views){
    assert.equal(view.game.players[1].huCount,6);
    const events=view.game.history.filter(event=>event.type==='hu');
    assert.equal(events.length,1);
    assert.equal(events[0].tile,13); assert.equal(events[0].source,'kongDiscard');
    assert.deepEqual(events[0].payments,[{seat:0,delta:-events[0].points},{seat:1,delta:events[0].points}]);
    assert.equal(events[0].fromSeat,0);
    assert.equal(view.game.players[2].score,-1,'bystander pays its original kong fee but no kong-discard hu fee');
    assert.match(events[0].message,/仅出牌者付款/);
    assert.doesNotMatch(events[0].message,/按自摸/);
  }
  assertLatest((await api.store.get(api.roomId)).game);
});

test('v3 HTTP seat-three eight-point kong-discard win charges only seat one, survives reconnect and rejects duplicate charges', async t => {
  const { DEFAULT_RULES, assertGameInvariants: assertLatest } = await import('../shared/game.js');
  for (const paymentFlags of ['enabled', 'disabled', 'absent']) {
    const api = await table(t);
    const game = apiFixture({ wins: [[7], [], []], kongSeats: [0], head: [6] });
    game.schemaVersion = 3;
    game.rules = { ...structuredClone(DEFAULT_RULES), baseFan: 4, specialHuPatterns: false };
    for (const key of ['selfDrawOnlyUnwon', 'finalHuPaymentExceptions']) {
      if (paymentFlags === 'absent') delete game.rules[key];
      else game.rules[key] = paymentFlags === 'enabled';
    }
    game.firstHuRadishesRevealed = true;
    game.dragonSettlement = { settled: false, entries: [] };
    assertLatest(game);
    let views = await installFixture(api, game);
    let answer = await api.host.action(views[0].revision, { type: 'discard', tile: 17 });
    assert.equal(answer.status, 200);
    answer = await api.clients[1].action(answer.body.state.revision, { type: 'pass' });
    assert.equal(answer.status, 200);
    const revision = answer.body.state.revision;
    const answers = await Promise.all([api.clients[2].action(revision, { type: 'hu' }), api.clients[2].action(revision, { type: 'hu' })]);
    assert.deepEqual(answers.map(result => result.status).sort(), [200, 409]);
    assertError(answers.find(result => result.status === 409), 409, 'STALE_STATE');
    views = await snapshots(api.clients);
    const reconnected = client(api, api.roomId, api.clients[2].token, 2);
    views.push((await reconnected.get()).body.state);
    for (const view of views) {
      const events = view.game.history.filter(event => event.type === 'hu');
      assert.equal(events.length, 1);
      assert.equal(events[0].seat, 2);
      assert.equal(events[0].tile, 17);
      assert.equal(events[0].source, 'kongDiscard');
      assert.equal(events[0].fromSeat, 0);
      assert.equal(events[0].points, 8);
      assert.deepEqual(events[0].payments, [{ seat: 0, delta: -8 }, { seat: 2, delta: 8 }]);
      assert.deepEqual(view.game.players.map(player => player.score), [-8, 0, 8]);
      assert.match(events[0].message, /仅出牌者付款/);
      assert.doesNotMatch(events[0].message, /按自摸|另外两家/);
    }
    assertLatest((await api.store.get(api.roomId)).game);
  }
});

test('v3 HTTP mandatory post-hu kongs reject old-client pass and discard without mutation and survive reconnect', async t => {
  for (const type of ['anGang', 'buGang', 'addGang']) {
    const api = await table(t);
    const game = postHuKongGame({ type });
    const tile = game.lastDraw.tile;
    const views = await installFixture(api, game);
    const before = await api.store.get(api.roomId);
    assert.deepEqual(views[0].game.legalActions, [{ type, tile }]);
    for (const action of [{ type: 'pass' }, { type: 'discard', tile }]) {
      assertError(await api.host.action(views[0].revision, action), 422, 'ILLEGAL_ACTION');
      assert.deepEqual(await api.store.get(api.roomId), before);
    }
    const restored = client(api, api.roomId, api.host.token, 0);
    const reconnected = (await restored.get()).body.state;
    assert.equal(reconnected.revision, views[0].revision);
    assert.deepEqual(reconnected.game, views[0].game);
    const result = await restored.action(reconnected.revision, { type, tile });
    assert.equal(result.status, 200);
    assert.equal(result.body.state.game.history.filter(event => event.type === type).length, 1);
    assert.equal(result.body.state.game.history.filter(event => event.type === 'draw' && event.source === 'replacement').length, 1);
    assert.ok(result.body.state.game.legalActions.some(action => action.type === 'hu'));
    assert.ok(result.body.state.game.legalActions.some(action => action.type === 'pass'));
  }
});

test('v3 HTTP extends a saved five-tile kong through six, seven and eight exactly once per paid replacement', async t => {
  const { DEFAULT_RULES, assertGameInvariants: assertLatest } = await import('../shared/game.js');
  for (const meldType of ['anGang', 'buGang']) {
    const api = await table(t);
    const noTwo = WAITING_HAND.map(tile => tile === 2 ? 6 : tile);
    const game = apiFixture({ hands: [[2, 3, 4, 5, 6, 7, 8, 10, 11, 17, 17], noTwo, noTwo],
      melds: [[{ type: meldType, tile: 2, tiles: Array(5).fill(2), extended: true }], [], []],
      wins: [[9], [], []], drawTile: 2, head: [2, 2, 9], tail: [15, 16, 8] });
    game.schemaVersion = 3; game.rules = { ...structuredClone(DEFAULT_RULES), specialHuPatterns: false };
    game.firstHuRadishesRevealed = true; game.dragonSettlement = { settled: false, entries: [] };
    game.players[0].kongCount = 2;
    assertLatest(game);
    let views = await installFixture(api, game);
    for (const size of [6, 7, 8]) {
      assert.deepEqual(views[0].game.legalActions, [{ type: 'addGang', tile: 2 }]);
      const revision = views[0].revision;
      const answers = await Promise.all([api.host.action(revision, { type: 'addGang', tile: 2 }), api.host.action(revision, { type: 'addGang', tile: 2 })]);
      assert.deepEqual(answers.map(answer => answer.status).sort(), [200, 409]);
      assertError(answers.find(answer => answer.status === 409), 409, 'STALE_STATE');
      const after = (await api.store.get(api.roomId)).game;
      assertError(await api.host.action(revision, { type: 'addGang', tile: 2 }), 409, 'STALE_STATE');
      assert.deepEqual((await api.store.get(api.roomId)).game, after);
      views = await snapshots(api.clients);
      const count = size - 5;
      for (const view of views) {
        assertPrivateView(view, view.you, api.clients.map(player => player.token));
        assert.deepEqual(view.game.players.map(player => player.score), [count * 2, -count, -count]);
        assert.deepEqual(view.game.players[0].radishes, [8, 16, 15].slice(0, count));
        assert.equal(view.game.players[0].kongCount, 2 + count);
        assert.equal(view.game.wallCount, game.wall.length - count * 2);
        const meld = view.game.players[0].melds[0];
        assert.equal(meld.type, meldType);
        assert.deepEqual(meld.tiles, Array(size).fill(meldType === 'anGang' && view.you !== 0 ? null : 2));
        assert.equal(meld.tile, meldType === 'anGang' && view.you !== 0 ? null : 2);
        const events = view.game.history.filter(event => event.type === 'addGang');
        assert.equal(events.length, count);
        assert.deepEqual(events.at(-1).payments, [{ seat: 1, delta: -1 }, { seat: 2, delta: -1 }, { seat: 0, delta: 2 }]);
        assert.equal(events.at(-1).tile, meldType === 'anGang' ? undefined : 2);
        const replacements = view.game.history.filter(event => event.type === 'draw' && event.source === 'replacement');
        assert.equal(replacements.length, count);
        assert.ok(replacements.every(event => event.tile === undefined));
      }
      assertLatest(after);
      const restored = client(api, api.roomId, api.host.token, 0);
      assert.deepEqual((await restored.get()).body.state.game, views[0].game);
    }
    assert.equal(views[0].game.players[0].melds[0].tiles.length, 8);
    assert.equal(views[0].game.legalActions.some(action => action.type === 'addGang'), false);
    const beforeNinth = (await api.store.get(api.roomId)).game;
    assertError(await api.host.action(views[0].revision, { type: 'addGang', tile: 2 }), 422, 'ILLEGAL_ACTION');
    assert.deepEqual((await api.store.get(api.roomId)).game, beforeNinth);
    const won = await api.host.action(views[0].revision, { type: 'hu' });
    assert.equal(won.status, 200);
    const score = won.body.state.game.history.find(event => event.type === 'hu').score;
    assert.equal(score.copyFanBonus, 5);
    assert.equal(score.fan, 6);
    assertLatest((await api.store.get(api.roomId)).game);
  }
});

test('HTTP saved legacy and v2 games retain the five-tile kong limit rather than routing through v3', async t => {
  const { DEFAULT_RULES: LEGACY_RULES } = await import('../shared/legacy-game.js');
  for (const schemaVersion of [undefined, 1, 2]) {
    const api = await table(t);
    const noTwo = WAITING_HAND.map(tile => tile === 2 ? 6 : tile);
    const game = apiFixture({ hands: [[2, 3, 4, 5, 6, 7, 8, 10, 11, 17, 17], noTwo, noTwo],
      melds: [[{ type: 'anGang', tile: 2, tiles: Array(5).fill(2), extended: true }], [], []], drawTile: 2 });
    if (schemaVersion === undefined) delete game.schemaVersion;
    else game.schemaVersion = schemaVersion;
    if (schemaVersion !== 2) game.rules = structuredClone(LEGACY_RULES);
    const views = await installFixture(api, game);
    assert.equal(views[0].game.schemaVersion, schemaVersion === 2 ? 2 : 1);
    assert.equal(views[0].game.legalActions.some(action => action.type === 'addGang'), false);
    const before = (await api.store.get(api.roomId)).game;
    assertError(await api.host.action(views[0].revision, { type: 'addGang', tile: 2 }), 422, 'ILLEGAL_ACTION');
    assert.deepEqual((await api.store.get(api.roomId)).game, before);
    const restored = client(api, api.roomId, api.host.token, 0);
    assert.deepEqual((await restored.get()).body.state.game, views[0].game);
  }
});

test('v3 HTTP exposed-kong replacement hu charges only its source, survives old-state reconnect and clears on continuation', async t => {
  const { DEFAULT_RULES, assertGameInvariants: assertLatest } = await import('../shared/game.js');
  for (const savedWithoutProvenance of [false, true]) for (const thirdHasHu of [false, true]) {
    const api = await table(t);
    const receiver = [2, 2, 2, 3, 4, 5, 6, 7, 8, 10, 11, 17, 17];
    const game = apiFixture({ hands: [[...WAITING_HAND, 2], receiver, WAITING_HAND],
      wins: [[], [], thirdHasHu ? [16] : []], drawTile: 2, head: [9, 9, 6], tail: [15] });
    game.schemaVersion = 3; game.rules = { ...structuredClone(DEFAULT_RULES), specialHuPatterns: false };
    game.firstHuRadishesRevealed = true; game.dragonSettlement = { settled: false, entries: [] };
    assertLatest(game);
    let views = await installFixture(api, game);
    let result = await api.host.action(views[0].revision, { type: 'discard', tile: 2 });
    assert.equal(result.status, 200);
    result = await api.clients[1].action(result.body.state.revision, { type: 'mingGang', tile: 2 });
    assert.equal(result.status, 200);
    const pending = (await api.store.get(api.roomId)).game;
    assert.deepEqual(pending.lastDraw.kongSource, { type: 'mingGang', fromSeat: 0 });
    assert.equal(pending.lastDraw.tile, 9);
    if (savedWithoutProvenance) {
      delete pending.lastDraw.kongSource;
      await installFixture(api, pending);
    }
    const restored = client(api, api.roomId, api.clients[1].token, 1);
    const reconnected = (await restored.get()).body.state;
    assert.ok(reconnected.game.legalActions.some(action => action.type === 'hu'));
    const scores = reconnected.game.players.map(player => player.score);
    assert.deepEqual(scores, [-2, 2, 0]);
    const revision = reconnected.revision;
    const answers = await Promise.all([restored.action(revision, { type: 'hu' }), restored.action(revision, { type: 'hu' })]);
    assert.deepEqual(answers.map(answer => answer.status).sort(), [200, 409]);
    assertError(answers.find(answer => answer.status === 409), 409, 'STALE_STATE');
    views = await snapshots(api.clients);
    for (const view of views) {
      const events = view.game.history.filter(event => event.type === 'hu');
      assert.equal(events.length, 1);
      const event = events[0];
      assert.equal(event.source, 'selfDraw');
      assert.equal(event.fromSeat, null);
      assert.deepEqual(event.kongSource, { type: 'mingGang', fromSeat: 0 });
      assert.deepEqual(event.payments, [{ seat: 0, delta: -event.points }, { seat: 1, delta: event.points }]);
      assert.deepEqual(view.game.players.map((player, seat) => player.score - scores[seat]), [-event.points, event.points, 0]);
    }
    const continued = (await api.store.get(api.roomId)).game;
    assert.equal(continued.lastDraw.source, 'continuation');
    assert.equal(continued.lastDraw.kongSource, undefined);
    result = await restored.action(views[1].revision, { type: 'hu' });
    assert.equal(result.status, 200);
    const second = result.body.state.game.history.filter(event => event.type === 'hu')[1];
    assert.equal(second.kongSource, undefined);
    assert.deepEqual(second.payments.filter(payment => payment.delta < 0).map(payment => payment.seat), thirdHasHu ? [0] : [0, 2]);
    assertLatest((await api.store.get(api.roomId)).game);
  }
});

test('v3 HTTP own-kong replacement hu charges both opponents even when one has already won', async t => {
  const { assertGameInvariants: assertLatest } = await import('../shared/game.js');
  for (const type of ['anGang', 'buGang', 'addGang']) {
    const api = await table(t);
    const game = postHuKongGame({ type });
    const priorTile = 13;
    game.wall.splice(game.wall.indexOf(priorTile), 1);
    game.retiredTiles.push({ seat: 1, tile: priorTile });
    game.players[1].huCount = 1;
    game.players[1].winPile = [{ tile: priorTile, source: 'selfDraw', virtual: false }];
    assertLatest(game);
    let views = await installFixture(api, game);
    let result = await api.host.action(views[0].revision, { type, tile: game.lastDraw.tile });
    assert.equal(result.status, 200);
    const pending = (await api.store.get(api.roomId)).game;
    assert.deepEqual(pending.lastDraw.kongSource, { type, fromSeat: null });
    const scores = result.body.state.game.players.map(player => player.score);
    const restored = client(api, api.roomId, api.host.token, 0);
    const revision = (await restored.get()).body.state.revision;
    const answers = await Promise.all([restored.action(revision, { type: 'hu' }), restored.action(revision, { type: 'hu' })]);
    assert.deepEqual(answers.map(answer => answer.status).sort(), [200, 409]);
    views = await snapshots(api.clients);
    for (const view of views) {
      const events = view.game.history.filter(event => event.type === 'hu');
      assert.equal(events.length, 1);
      const event = events[0];
      assert.equal(event.source, 'selfDraw');
      assert.deepEqual(event.kongSource, { type, fromSeat: null });
      assert.deepEqual(event.payments, [{ seat: 1, delta: -event.points }, { seat: 2, delta: -event.points }, { seat: 0, delta: event.points * 2 }]);
      assert.deepEqual(view.game.players.map((player, seat) => player.score - scores[seat]), [event.points * 2, -event.points, -event.points]);
    }
    assertLatest((await api.store.get(api.roomId)).game);
  }
});

test('v3 HTTP pending final first-hu after exposed-kong still has one payer and preserves safe provenance in profile history', async t => {
  const { DEFAULT_RULES, assertGameInvariants: assertLatest } = await import('../shared/game.js');
  const api = await table(t);
  const receiver = [3, 4, 5, 6, 7, 8, 9, 10, 11, 17, 17];
  const game = apiFixture({ hands: [WAITING_HAND, receiver, WAITING_HAND],
    melds: [[], [{ type: 'mingGang', tile: 2, tiles: [2, 2, 2, 2], fromSeat: 0 }], []],
    wins: [[16], [], [16]], currentSeat: 1, drawTile: 9, head: [6] });
  game.schemaVersion = 3; game.rules = { ...structuredClone(DEFAULT_RULES), specialHuPatterns: false };
  game.firstHuRadishesRevealed = true; game.dragonSettlement = { settled: false, entries: [] };
  game.drawKind = 'replacement'; game.lastDraw.source = 'replacement';
  game.lastDraw.kongSource = { type: 'mingGang', fromSeat: 0 };
  assertLatest(game);
  let views = await installFixture(api, game);
  const result = await api.clients[1].action(views[1].revision, { type: 'hu' });
  assert.equal(result.status, 200);
  views = await snapshots(api.clients);
  for (const view of views) {
    assert.equal(view.game.finishReason, 'allPlayersHu');
    assert.equal(view.game.wallCount, game.wall.length);
    const event = view.game.history.find(item => item.type === 'hu');
    assert.deepEqual(event.kongSource, { type: 'mingGang', fromSeat: 0 });
    assert.deepEqual(event.payments, [{ seat: 0, delta: -event.points }, { seat: 1, delta: event.points }]);
    assert.equal(view.game.players[2].score, 0);
  }
  const profile = await api.request('/api/profile', { method: 'POST', body: {} });
  assert.equal(profile.status, 201);
  const profileToken = profile.body.playerToken;
  const bound = await api.request(`/api/rooms/${api.roomId}/resume`, { method: 'POST', token: api.clients[1].token, body: { profileToken } });
  assert.equal(bound.status, 200);
  const history = await api.request('/api/profile/history', { token: profileToken });
  assert.equal(history.status, 200);
  assert.equal(history.body.records.length, 1);
  assert.deepEqual(history.body.records[0].events.find(event => event.type === 'hu').kongSource, { type: 'mingGang', fromSeat: 0 });
  const serialized = JSON.stringify(history.body);
  for (const secret of [profileToken, ...api.clients.map(player => player.token)]) assert.equal(serialized.includes(secret), false);
  assert.doesNotMatch(serialized, /"(?:hand|wall|lastDraw|drawnTile|tokenHash|playerHash)":/);
  assertLatest((await api.store.get(api.roomId)).game);
});

test('v3 special seven-pairs repeat exposes expanded waits only to its owner and persists through reconnect', async t => {
  const { DEFAULT_RULES, assertGameInvariants: assertLatest } = await import('../shared/game.js');
  const api = await table(t);
  const hand=[0,0,2,2,4,4,6,6,9,9,11,11,13,13];
  const game=apiFixture({hands:[hand,WAITING_HAND,WAITING_HAND],drawTile:13,head:[2,7],tail:[8,8,8,15,15,15]});
  game.schemaVersion=3;game.rules=structuredClone(DEFAULT_RULES);game.firstHuRadishesRevealed=false;
  game.dragonSettlement={settled:false,entries:[]};assertLatest(game);
  const views=await installFixture(api,game);
  let answer=await api.host.action(views[0].revision,{type:'hu'});
  assert.equal(answer.status,200);
  let snapshotsNow=await snapshots(api.clients);
  assert.deepEqual(snapshotsNow[0].game.waitTiles,[0,2,4,6,9,11,13]);
  assert.equal(snapshotsNow[0].game.specialHuPattern.kind,'sevenPairs');
  assert.equal(snapshotsNow[0].game.drawnTile,2);
  assert.ok(snapshotsNow[0].game.legalActions.some(action=>action.type==='hu'));
  assert.equal(snapshotsNow[1].game.specialHuPattern,null);
  assert.equal(snapshotsNow[2].game.specialHuPattern,null);
  for(const snapshot of snapshotsNow)for(const player of snapshot.game.players)assert.equal(player.firstHuPattern,undefined);
  const reconnected=client(api,api.roomId,api.host.token,0);
  assert.deepEqual((await reconnected.get()).body.state.game.specialHuPattern,snapshotsNow[0].game.specialHuPattern);
  answer=await api.host.action(snapshotsNow[0].revision,{type:'hu'});
  assert.equal(answer.status,200);
  snapshotsNow=await snapshots(api.clients);
  assert.equal(snapshotsNow[0].game.players[0].huCount,2);
  assert.equal(snapshotsNow[0].game.players[0].winPile.at(-1).tile,2);
  assert.equal(snapshotsNow[0].game.players[0].hand.length,13);
  assertLatest((await api.store.get(api.roomId)).game);
});

async function robKongHttpFixture({ sourceWon = false, replacement = false, receiverWon = false, type = 'buGang', currentSeat = 0 } = {}) {
  const { DEFAULT_RULES, assertGameInvariants: assertLatest } = await import('../shared/game.js');
  const hands = [WAITING_HAND, WAITING_HAND, WAITING_HAND].map(hand => [...hand]);
  hands[currentSeat] = [0, 1, 2, 3, 4, 5, 9, 10, 11, 15, 17];
  const melds = [[], [], []];
  melds[currentSeat] = [{ type: type === 'buGang' ? 'peng' : 'buGang', tile: 17, tiles: Array(type === 'buGang' ? 3 : 4).fill(17) }];
  const wins = [[], [], []];
  if (sourceWon) wins[currentSeat] = [15];
  if (receiverWon) wins[(currentSeat + 1) % 3] = [16];
  const game = apiFixture({ hands, melds, wins, currentSeat, drawTile: 17, head: [15, 8], tail: [7] });
  game.schemaVersion = 3; game.rules = { ...structuredClone(DEFAULT_RULES), specialHuPatterns: false };
  game.firstHuRadishesRevealed = true; game.dragonSettlement = { settled: false, entries: [] };
  if (replacement) {
    game.lastDraw.source = 'replacement'; game.drawKind = 'replacement';
    game.lastDraw.kongSource = { type: 'anGang', fromSeat: null };
    game.players[currentSeat].pendingKongDiscard = true;
  }
  if (receiverWon) {
    const receiver = game.players[(currentSeat + 1) % 3];
    receiver.huLockActive = true; receiver.lockedWaits = [17];
  }
  assertLatest(game);
  return game;
}

test('v3 HTTP rob-kong opens a persistent hu-only window without committing fees, radishes or the meld', async t => {
  const { assertGameInvariants: assertLatest } = await import('../shared/game.js');
  for (const type of ['buGang', 'addGang']) {
    const api = await table(t);
    const initial = await robKongHttpFixture({ type });
    const views = await installFixture(api, initial);
    const revision = views[0].revision;
    const answers = await Promise.all([api.host.action(revision, { type, tile: 17 }), api.host.action(revision, { type, tile: 17 })]);
    assert.deepEqual(answers.map(answer => answer.status).sort(), [200, 409]);
    let states = await snapshots(api.clients);
    assert.equal(states[0].game.phase, 'claim');
    assert.deepEqual(states[0].game.legalActions, []);
    for (const seat of [1, 2]) assert.deepEqual(states[seat].game.legalActions.map(action => action.type).sort(), ['hu', 'pass']);
    let stored = (await api.store.get(api.roomId)).game;
    assert.deepEqual(stored.players.map(player => player.score), [0, 0, 0]);
    assert.deepEqual(stored.players[0].melds, initial.players[0].melds);
    assert.deepEqual(stored.players.map(player => player.radishes), [[], [], []]);
    assert.equal(stored.wall.length, initial.wall.length);
    assert.equal(stored.history.filter(event => event.type === type).length, 0);
    assertLatest(stored);
    const restored = client(api, api.roomId, api.clients[1].token, 1);
    assert.deepEqual((await restored.get()).body.state.game, states[1].game);
    for (const action of [{ type: 'peng', tile: 17 }, { type: 'mingGang', tile: 17 }]) {
      assertError(await restored.action(states[1].revision, action), 422, 'ILLEGAL_ACTION');
      assert.deepEqual((await api.store.get(api.roomId)).game, stored);
    }
    const passed = await restored.action(states[1].revision, { type: 'pass' });
    assert.equal(passed.status, 200);
    states = await snapshots(api.clients);
    assert.equal(states[0].game.phase, 'claim');
    assert.deepEqual(states[1].game.legalActions, []);
    assert.equal(states[0].game.wallCount, initial.wall.length);
    const committed = await api.clients[2].action(states[2].revision, { type: 'pass' });
    assert.equal(committed.status, 200);
    stored = (await api.store.get(api.roomId)).game;
    assert.equal(stored.players[0].melds[0].tiles.length, initial.players[0].melds[0].tiles.length + 1);
    assert.deepEqual(stored.players.map(player => player.score), [2, -1, -1]);
    assert.deepEqual(stored.players[0].radishes, [7]);
    assert.equal(stored.wall.length, initial.wall.length - 2);
    assert.equal(stored.history.filter(event => event.type === type).length, 1);
    assert.equal(stored.history.filter(event => event.type === 'draw' && event.source === 'replacement').length, 1);
    assertLatest(stored);
  }
});

test('v3 HTTP rob-kong settles both winners clockwise regardless of response order and charges only the upgrader once', async t => {
  const { assertGameInvariants: assertLatest } = await import('../shared/game.js');
  for (const sourceSeat of [0, 1, 2]) for (const reverse of [false, true]) {
    const api = await table(t);
    const initial = await robKongHttpFixture({ currentSeat: sourceSeat });
    const views = await installFixture(api, initial);
    const opened = await api.clients[sourceSeat].action(views[sourceSeat].revision, { type: 'buGang', tile: 17 });
    assert.equal(opened.status, 200);
    const clockwise = [(sourceSeat + 1) % 3, (sourceSeat + 2) % 3];
    const responseOrder = reverse ? [...clockwise].reverse() : clockwise;
    let revision = opened.body.state.revision;
    const first = await api.clients[responseOrder[0]].action(revision, { type: 'hu' });
    assert.equal(first.status, 200);
    assert.equal(first.body.state.game.history.filter(event => event.type === 'hu').length, 0);
    revision = first.body.state.revision;
    const answers = await Promise.all([api.clients[responseOrder[1]].action(revision, { type: 'hu' }), api.clients[responseOrder[1]].action(revision, { type: 'hu' })]);
    assert.deepEqual(answers.map(answer => answer.status).sort(), [200, 409]);
    const stored = (await api.store.get(api.roomId)).game;
    const events = stored.history.filter(event => event.type === 'hu');
    assert.deepEqual(events.map(event => event.seat), clockwise);
    for (const event of events) {
      assert.equal(event.source, 'robKong');
      assert.equal(event.fromSeat, sourceSeat);
      assert.equal(event.score.fan, 2);
      assert.deepEqual(event.payments, [{ seat: sourceSeat, delta: -event.points }, { seat: event.seat, delta: event.points }]);
    }
    assert.deepEqual(stored.players[sourceSeat].melds, initial.players[sourceSeat].melds);
    assert.equal(stored.players[sourceSeat].kongCount, initial.players[sourceSeat].kongCount);
    assert.deepEqual(stored.players.map(player => player.radishes), [[], [], []]);
    assert.equal(stored.history.some(event => event.type === 'buGang'), false);
    assert.equal(stored.history.some(event => event.type === 'draw' && event.source === 'replacement'), false);
    assert.equal(stored.players[sourceSeat].score, -events.reduce((sum, event) => sum + event.points, 0));
    assertLatest(stored);
    const states = await snapshots(api.clients);
    for (const state of states) assert.deepEqual(state.game.history.filter(event => event.type === 'hu'), events);
    assertError(await api.clients[responseOrder[1]].action(revision, { type: 'hu' }), 409, 'STALE_STATE');
    assert.deepEqual((await api.store.get(api.roomId)).game, stored);
  }
});

test('v3 HTTP already-won upgrader is protected on ordinary draw but replacement upgrade is robbable by locked previous winners', async t => {
  const { assertGameInvariants: assertLatest } = await import('../shared/game.js');
  for (const replacement of [false, true]) {
    const api = await table(t);
    const initial = await robKongHttpFixture({ sourceWon: true, replacement, receiverWon: true });
    const views = await installFixture(api, initial);
    const result = await api.host.action(views[0].revision, { type: 'buGang', tile: 17 });
    assert.equal(result.status, 200);
    const states = await snapshots(api.clients);
    if (!replacement) {
      assert.equal(states[0].game.phase, 'turn');
      assert.equal(states[0].game.players[0].melds[0].tiles.length, 4);
      assert.deepEqual(states[0].game.players.map(player => player.score), [2, -1, -1]);
    } else {
      assert.equal(states[0].game.phase, 'claim');
      for (const seat of [1, 2]) assert.deepEqual(states[seat].game.legalActions.map(action => action.type).sort(), ['hu', 'pass']);
      const passed = await api.clients[2].action(states[2].revision, { type: 'pass' });
      assert.equal(passed.status, 200);
      const won = await api.clients[1].action(passed.body.state.revision, { type: 'hu' });
      assert.equal(won.status, 200);
      const event = won.body.state.game.history.find(item => item.type === 'hu');
      assert.equal(event.source, 'robKong');
      assert.deepEqual(event.payments, [{ seat: 0, delta: -event.points }, { seat: 1, delta: event.points }]);
      assert.equal(won.body.state.game.players[0].melds[0].tiles.length, 3);
    }
    assertLatest((await api.store.get(api.roomId)).game);
  }
});

test('HTTP legacy and v2 upgrades keep their original immediate-commit behavior', async t => {
  const { DEFAULT_RULES: LEGACY_RULES } = await import('../shared/legacy-game.js');
  const { DEFAULT_RULES: V2_RULES } = await import('../shared/v2-game.js');
  for (const schemaVersion of [undefined, 1, 2]) {
    const api = await table(t);
    const game = await robKongHttpFixture();
    if (schemaVersion === undefined) delete game.schemaVersion;
    else game.schemaVersion = schemaVersion;
    game.rules = structuredClone(schemaVersion === 2 ? V2_RULES : LEGACY_RULES);
    const views = await installFixture(api, game);
    const result = await api.host.action(views[0].revision, { type: 'buGang', tile: 17 });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.notEqual(result.body.state.game.claim?.kind, 'robKong');
    assert.equal(result.body.state.game.players[0].melds[0].tiles.length, 4);
    assert.deepEqual(result.body.state.game.players.map(player => player.score), schemaVersion === 2 ? [2, -1, -1] : [0, 0, 0]);
    assert.equal(result.body.state.game.history.filter(event => event.type === 'buGang').length, 1);
  }
});

test('v3 HTTP final rob-kong wins remain atomic and preserve public history without private pending state', async t => {
  const { assertGameInvariants: assertLatest } = await import('../shared/game.js');
  const api = await table(t);
  const initial = await robKongHttpFixture({ sourceWon: true, replacement: true });
  const views = await installFixture(api, initial);
  const opened = await api.host.action(views[0].revision, { type: 'buGang', tile: 17 });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.state.game.claim.kind, 'robKong');
  assert.equal(opened.body.state.game.claim.kongType, 'buGang');
  const first = await api.clients[2].action(opened.body.state.revision, { type: 'hu' });
  assert.equal(first.status, 200);
  assert.equal(first.body.state.game.phase, 'claim');
  const last = await api.clients[1].action(first.body.state.revision, { type: 'hu' });
  assert.equal(last.status, 200);
  assert.equal(last.body.state.game.finishReason, 'allPlayersHu');
  const finished = (await api.store.get(api.roomId)).game;
  assert.equal(finished.wall.length, initial.wall.length);
  assert.deepEqual(finished.history.filter(event => event.type === 'hu').map(event => event.seat), [1, 2]);
  assert.equal(finished.history.some(event => event.type === 'draw'), false);
  assertLatest(finished);
  const profile = await api.request('/api/profile', { method: 'POST', body: {} });
  const profileToken = profile.body.playerToken;
  assert.equal((await api.request(`/api/rooms/${api.roomId}/resume`, { method: 'POST', token: api.host.token, body: { profileToken } })).status, 200);
  const history = await api.request('/api/profile/history', { token: profileToken });
  assert.equal(history.status, 200);
  const wins = history.body.records[0].events.filter(event => event.type === 'hu');
  assert.deepEqual(wins.map(event => event.source), ['robKong', 'robKong']);
  assert.ok(wins.every(event => event.score.robKongBonus === 1));
  const serialized = JSON.stringify(history.body);
  for (const token of [profileToken, ...api.clients.map(player => player.token)]) assert.equal(serialized.includes(token), false);
  assert.doesNotMatch(serialized, /"(?:hand|wall|lastDraw|drawnTile|tokenHash|playerHash|responses|options)":/);
});

async function deferredRadishHttpFixture(options = {}) {
  const game = await robKongHttpFixture(options);
  game.firstHuRadishesRevealed = false;
  game.pendingKongRadishes = 0;
  return game;
}

test('v3 HTTP pre-first-hu kong accrues a public count without revealing or drawing radishes, then first hu flips seven once', async t => {
  const { assertGameInvariants: assertLatest } = await import('../shared/game.js');
  const api = await table(t);
  const initial = await deferredRadishHttpFixture();
  const views = await installFixture(api, initial);
  const opened = await api.host.action(views[0].revision, {type:'buGang',tile:17});
  assert.equal(opened.status,200);
  assert.equal(opened.body.state.game.pendingKongRadishes,0);
  const {states} = await passClaims(api.clients);
  const beforeHu = (await api.store.get(api.roomId)).game;
  assert.equal(beforeHu.pendingKongRadishes,1);
  assert.equal(beforeHu.wall.length,initial.wall.length-1);
  assert.deepEqual(beforeHu.players.map(player=>player.radishes),[[],[],[]]);
  assert.equal(beforeHu.lastDraw.tile,initial.wall[0]);
  const event=beforeHu.history.find(event=>event.type==='buGang');
  assert.equal(event.radishDeferred,true);
  assert.equal(event.pendingKongRadishes,1);
  assert.equal(Object.hasOwn(event,'radish'),false);
  assertLatest(beforeHu);
  for(const state of states) {
    assert.equal(state.game.pendingKongRadishes,1);
    assert.deepEqual(state.game.sharedRadishes,[]);
    assert.equal(state.game.wallCount,initial.wall.length-1);
  }
  const resumed=client(api,api.roomId,api.host.token,0);
  assert.deepEqual((await resumed.get()).body.state.game,states[0].game);
  assert.ok(states[0].game.legalActions.some(action=>action.type==='hu'));
  const answers=await Promise.all([resumed.action(states[0].revision,{type:'hu'}),resumed.action(states[0].revision,{type:'hu'})]);
  assert.deepEqual(answers.map(answer=>answer.status).sort(),[200,409]);
  const after=(await api.store.get(api.roomId)).game;
  assert.equal(after.firstHuRadishesRevealed,true);
  assert.equal(after.pendingKongRadishes,0);
  assert.equal(after.players.flatMap(player=>player.radishes).length,7);
  assert.deepEqual(after.history.find(event=>event.type==='hu').newRadishes,beforeHu.wall.slice(-7).reverse());
  assert.equal(after.history.filter(event=>event.type==='hu').length,1);
  assertLatest(after);
});

test('v3 HTTP first simultaneous hu flips base six plus five pending kongs only once and robbed kong adds nothing', async t => {
  const { assertGameInvariants: assertLatest } = await import('../shared/game.js');
  const api=await table(t);
  const initial=await deferredRadishHttpFixture();
  initial.pendingKongRadishes=5;initial.players[0].kongCount=5;
  const views=await installFixture(api,initial);
  const opened=await api.host.action(views[0].revision,{type:'buGang',tile:17});
  assert.equal(opened.status,200);
  assert.equal(opened.body.state.game.pendingKongRadishes,5);
  const first=await api.clients[2].action(opened.body.state.revision,{type:'hu'});
  assert.equal(first.status,200);
  assert.equal(first.body.state.game.sharedRadishes.length,0);
  const last=await api.clients[1].action(first.body.state.revision,{type:'hu'});
  assert.equal(last.status,200);
  const after=(await api.store.get(api.roomId)).game;
  const hu=after.history.filter(event=>event.type==='hu');
  assert.deepEqual(hu.map(event=>event.seat),[1,2]);
  assert.deepEqual(hu.map(event=>event.newRadishes.length),[11,0]);
  assert.equal(after.pendingKongRadishes,0);
  assert.equal(after.players.flatMap(player=>player.radishes).length,11);
  assert.equal(after.players[0].kongCount,5);
  assert.equal(after.players[0].melds[0].tiles.length,3);
  assert.equal(after.history.some(event=>event.type==='buGang'),false);
  const restored=await snapshots(api.clients);
  for(const state of restored){assert.equal(state.game.sharedRadishes.length,11);assert.equal(state.game.pendingKongRadishes,0);}
  assertLatest(after);
});

test('v3 HTTP old exposed pre-first-hu radishes stay exposed and are not counted again on first hu', async t => {
  const { DEFAULT_RULES, assertGameInvariants: assertLatest }=await import('../shared/game.js');
  const api=await table(t);
  const initial=apiFixture({radishes:[[7,8],[],[]],head:[17,6],tail:[15,15,15,16,16,16]});
  initial.schemaVersion=3;initial.rules=structuredClone(DEFAULT_RULES);
  initial.firstHuRadishesRevealed=false;initial.dragonSettlement={settled:false,entries:[]};
  initial.players[0].kongCount=2;delete initial.pendingKongRadishes;
  assertLatest(initial);
  const views=await installFixture(api,initial);
  assert.deepEqual(views[0].game.sharedRadishes,[7,8]);
  assert.equal(views[0].game.pendingKongRadishes,0);
  const answer=await api.host.action(views[0].revision,{type:'hu'});
  assert.equal(answer.status,200);
  const after=(await api.store.get(api.roomId)).game;
  assert.deepEqual(after.players[0].radishes.slice(0,2),[7,8]);
  assert.equal(after.players.flatMap(player=>player.radishes).length,8);
  assert.equal(after.history.find(event=>event.type==='hu').newRadishes.length,6);
  assert.equal(after.pendingKongRadishes,0);
  assertLatest(after);
});

test('next hand gives dealer to first previous winner while host authorization and archived scores remain intact',async t=>{
 for(const winner of [0,1,2]) {
  const api=await table(t);const room=await api.store.get(api.roomId);
  room.game.phase='finished';room.game.turnStep=null;room.game.finishReason='wallExhausted';
  room.game.history=[{type:'start'},{type:'hu',seat:winner,revision:3,message:'首胡'},{type:'hu',seat:(winner+1)%3,revision:3,message:'双响第二家'}];
  room.game.players[winner].score=9;room.game.players[(winner+1)%3].score=-9;
  await api.store.compareAndSwap(room,room.revision);
  const before=structuredClone(room.game);
  assertError(await api.clients[1].start(room.revision),403,'HOST_ONLY');
  const start=await api.host.start(room.revision);assert.equal(start.status,200,JSON.stringify(start.body));
  assert.equal(start.body.state.game.dealerSeat,winner);assert.equal(start.body.state.game.currentSeat,winner);
  const stored=await api.store.get(api.roomId);assert.equal(stored.hostSeat,0);
  assert.deepEqual(stored.archivedGames.at(-1).game.players.map(p=>p.score),before.players.map(p=>p.score));
  assert.deepEqual(stored.archivedGames.at(-1).game.history,before.history);
  assert.deepEqual(stored.game.players.map(p=>p.hand.length),[0,1,2].map(s=>s===winner?14:13));
  assert.equal(stored.game.lastDraw.seat,winner);
  for(const c of api.clients){const reconnect=await c.get();assert.equal(reconnect.body.state.game.dealerSeat,winner);assert.equal(reconnect.body.state.game.legalActions.length>0,c.seat===winner);}
  assertError(await api.host.start(room.revision),409,'STALE_STATE');
  const revision=(await api.host.get()).body.state.revision;
  assertError(await api.host.start(revision),409,'PLAYING');
 }
});

test('next hand with no previous hu keeps original seat-zero opening; starting legacy finished rounds uses their first hu',async t=>{
 for(const schemaVersion of [undefined,1,2,3]){
  const api=await table(t);let room=await api.store.get(api.roomId);
  room.game.schemaVersion=schemaVersion;room.game.phase='finished';room.game.turnStep=null;room.game.dealerSeat=2;
  room.game.history=[{type:'hu',seat:1,revision:1}];await api.store.compareAndSwap(room,room.revision);
  let result=await api.host.start(room.revision);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.state.game.dealerSeat,1);
  room=await api.store.get(api.roomId);room.game.phase='finished';room.game.turnStep=null;room.game.history=[{type:'finish',reason:'wallExhausted'}];await api.store.compareAndSwap(room,room.revision);
  result=await api.host.start(room.revision);assert.equal(result.status,200);assert.equal(result.body.state.game.dealerSeat,0);
 }
});
