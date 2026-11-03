import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../server/store.js';
import { FileStore, apiMiddleware } from '../server/node.js';
import { createGame, assertGameInvariants } from '../shared/game.js';

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
    get: () => api.request(`/api/rooms/${roomId}`, { token }),
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

test('draw, discard, and pass rotate through all three clients without revealing drawn tiles', async t => {
  const api = await table(t, { seed: 0 });
  // This reproducible deal lets seat 1 claim the first 8 (九条), so passing is
  // exercised rather than merely assumed to have occurred during random play.
  const first = await api.host.action(api.state.revision, { type: 'discard', tile: 8 });
  assert.equal(first.status, 200);
  assert.equal(first.body.state.game.phase, 'claim');
  const claim = await passClaims(api.clients);
  assert.ok(claim.passes > 0);
  let states = claim.states;
  assert.equal(states[0].game.currentSeat, 1);
  for (const seat of [1, 2, 0]) {
    assert.equal(states[seat].game.currentSeat, seat);
    assert.equal(states[seat].game.turnStep, 'draw');
    assert.deepEqual(states[seat].game.legalActions, [{ type: 'draw' }]);
    const wallBefore = states[seat].game.wallCount;
    const previousRevision = states[seat].revision;
    const drawn = await api.clients[seat].action(previousRevision, { type: 'draw' });
    assert.equal(drawn.status, 200, JSON.stringify(drawn.body));
    states = await snapshots(api.clients);
    assert.equal(states[seat].revision, previousRevision + 1);
    assert.equal(states[seat].game.wallCount, wallBefore - 1);
    assert.equal(typeof states[seat].game.drawnTile, 'number');
    states.forEach((state, index) => {
      if (index !== seat) assert.equal(state.game.drawnTile, null);
      const latest = state.game.history.at(-1);
      assert.equal(latest.type, 'draw');
      assert.equal('tile' in latest, false);
    });
    const discard = states[seat].game.legalActions.find(action => action.type === 'discard');
    const discarded = await api.clients[seat].action(states[seat].revision, discard);
    assert.equal(discarded.status, 200);
    states = (await passClaims(api.clients)).states;
    assert.equal(states[0].game.currentSeat, (seat + 1) % 3);
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
  assert.equal((await first.clients[1].action(before[1].revision, { type: 'draw' })).status, 200);
  before = await snapshots(first.clients);
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
