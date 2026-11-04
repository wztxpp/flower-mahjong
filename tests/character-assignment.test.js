import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHARACTER_IDS, assignCharacters, gameCharacters, preferredCharacter } from '../shared/character-assignment.js';
import { createApi } from '../server/api.js';
import { MemoryStore } from '../server/store.js';
import { FileStore } from '../server/node.js';
import { createGame as createLegacyGame } from '../shared/legacy-game.js';

function assertDistinct(characters) {
  assert.deepEqual([...characters].sort(), [...CHARACTER_IDS].sort());
}

// Enumerate every RNG branch rather than using a flaky statistical test.
function outcomes(preferences, choices = [], weight = 1, results = new Map()) {
  let cursor = 0;
  try {
    const assignment = assignCharacters(preferences, size => {
      if (cursor === choices.length) throw { branchSize: size };
      return choices[cursor++];
    });
    const key = assignment.join(',');
    results.set(key, (results.get(key) || 0) + weight);
  } catch (branch) {
    if (!branch.branchSize) throw branch;
    for (let choice = 0; choice < branch.branchSize; choice++) {
      outcomes(preferences, [...choices, choice], weight / branch.branchSize, results);
    }
  }
  return results;
}

function apiHarness(store = new MemoryStore()) {
  const api = createApi(store);
  return {
    store,
    async request(path, { token, method = 'GET', body } = {}) {
      const response = await api(new Request(`http://localhost${path}`, {
        method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }));
      return { status: response.status, ...(await response.json()) };
    },
  };
}

async function table(api, preferences = ['sweet', 'sweet', 'elegant']) {
  const host = await api.request('/api/rooms', { method: 'POST', body: { name: '东家', preferredCharacter: preferences[0] } });
  assert.equal(host.status, 201);
  const clients = [host];
  for (const seat of [1, 2]) {
    const result = await api.request(`/api/rooms/${host.roomId}/join`, { method: 'POST', body: { name: `${seat}号玩家`, preferredCharacter: preferences[seat] } });
    assert.equal(result.status, 201);
    clients.push(result);
  }
  const path = `/api/rooms/${host.roomId}`;
  return { path, clients, host, state: clients[2].state };
}

function assertPrivate(state, room, seat, clients) {
  const json = JSON.stringify(state);
  for (const client of clients) assert.equal(json.includes(client.token), false);
  for (const person of room.seats.filter(Boolean)) assert.equal(json.includes(person.tokenHash), false);
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      assert.equal(['token', 'tokenHash', 'playerHash', 'wall', 'lastDraw', 'participants'].includes(key), false, key);
      visit(entry);
    }
  };
  visit(state);
  for (const person of state.seats.filter(Boolean)) assert.equal('hand' in person, false);
  for (const player of state.game.players) assert.equal('hand' in player, player.seat === seat);
}

test('character preference validation accepts only stable IDs or no selection', () => {
  assert.equal(preferredCharacter(), null);
  assert.equal(preferredCharacter(null), null);
  for (const id of CHARACTER_IDS) assert.equal(preferredCharacter(id), id);
  for (const invalid of ['', 'random', 'Sweet', ' sweet ', 0, false, [], {}, '__proto__']) {
    assert.throws(() => preferredCharacter(invalid), TypeError);
  }
  assert.throws(() => assignCharacters([]), TypeError);
  assert.throws(() => assignCharacters(['sweet', null, 'unknown']), TypeError);
  assert.throws(() => assignCharacters([null, null, null], () => 3), RangeError);
});

test('all 64 preference combinations stay unique and honor uncontested requests', () => {
  const options = [null, ...CHARACTER_IDS];
  for (const first of options) for (const second of options) for (const third of options) {
    const preferences = [first, second, third];
    const possibilities = outcomes(preferences);
    assert.ok(Math.abs([...possibilities.values()].reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12);
    for (const key of possibilities.keys()) {
      const assigned = key.split(',');
      assertDistinct(assigned);
      for (const character of CHARACTER_IDS) {
        const candidates = preferences.flatMap((value, seat) => value === character ? [seat] : []);
        if (candidates.length) assert.ok(candidates.includes(assigned.indexOf(character)), `${preferences}: ${key}`);
      }
    }
  }
});

test('random players and three-way conflicts yield all six equally likely assignments', () => {
  for (const preferences of [[null, null, null], ...CHARACTER_IDS.map(id => [id, id, id])]) {
    const possibilities = outcomes(preferences);
    assert.equal(possibilities.size, 6);
    for (const probability of possibilities.values()) assert.ok(Math.abs(probability - 1 / 6) < 1e-12);
  }
});

test('two-way conflicts give each requester equal odds without taking another requested role', () => {
  for (const preferences of [['sweet', 'sweet', 'elegant'], ['sweet', 'elegant', 'sweet'], ['elegant', 'sweet', 'sweet']]) {
    const possibilities = outcomes(preferences);
    assert.equal(possibilities.size, 2);
    for (const [key, probability] of possibilities) {
      assert.equal(probability, 0.5);
      assert.equal(key.split(',')[preferences.indexOf('elegant')], 'elegant');
    }
  }
  const possibilities = outcomes(['sunny', 'sunny', null]);
  assert.equal(possibilities.size, 4);
  for (const probability of possibilities.values()) assert.equal(probability, 0.25);
});

test('safe game mapping rejects malformed data and never exposes a mutable source array', () => {
  for (const invalid of [undefined, null, {}, [], ['sweet', 'sweet', 'sunny'], ['sweet', 'elegant', { secret: true }]]) {
    assert.deepEqual(gameCharacters(invalid), CHARACTER_IDS);
  }
  const mapping = ['sunny', 'sweet', 'elegant'];
  const result = gameCharacters(mapping);
  assert.deepEqual(result, mapping);
  result[0] = 'changed';
  assert.equal(mapping[0], 'sunny');
});

test('create/join reject invalid preferences without reserving seats or exposing client fields', async () => {
  const api = apiHarness();
  const invalidValues = ['', 'random', 'Sweet', 1, true, [], {}, { tokenHash: 'secret' }];
  for (const preferredCharacter of invalidValues) {
    const result = await api.request('/api/rooms', { method: 'POST', body: { name: '无效', preferredCharacter } });
    assert.equal(result.status, 400);
    assert.equal(result.code, 'BAD_CHARACTER');
  }
  assert.equal(api.store.rooms.size, 0);
  const host = await api.request('/api/rooms', { method: 'POST', body: { name: '东家', characterId: 'sunny', characters: ['sunny', 'sunny', 'sunny'] } });
  assert.equal(host.status, 201);
  assert.equal(host.state.seats[0].preferredCharacter, null);
  assert.equal(host.state.seats[0].characterId, null);
  for (const preferredCharacter of invalidValues) {
    const result = await api.request(`/api/rooms/${host.roomId}/join`, { method: 'POST', body: { name: '无效', preferredCharacter } });
    assert.equal(result.status, 400);
    assert.equal(result.code, 'BAD_CHARACTER');
  }
  assert.equal((await api.store.get(host.roomId)).seats.filter(Boolean).length, 1);
  const joined = await api.request(`/api/rooms/${host.roomId}/join`, { method: 'POST', body: { name: '随机', preferredCharacter: null } });
  assert.equal(joined.status, 201);
  assert.equal(joined.state.seats[1].preferredCharacter, null);
  assert.equal(joined.state.seats[1].characterId, null);
});

test('assignment waits for start and is authoritative, private, and stable through actions/reconnect', async () => {
  const api = apiHarness();
  const { path, clients, host, state: lobby } = await table(api);
  assert.equal(lobby.game, null);
  assert.deepEqual(lobby.seats.map(person => person.preferredCharacter), ['sweet', 'sweet', 'elegant']);
  assert.deepEqual(lobby.seats.map(person => person.characterId), [null, null, null]);
  const storedLobby = await api.store.get(host.roomId);
  assert.equal(storedLobby.gameMeta, undefined);
  const started = await api.request(`${path}/start`, { method: 'POST', token: host.token, body: { revision: lobby.revision, characters: ['sunny', 'sunny', 'sunny'] } });
  assert.equal(started.status, 200);
  const characters = started.state.game.characters;
  assertDistinct(characters);
  assert.equal(characters[2], 'elegant');
  assert.ok([0, 1].includes(characters.indexOf('sweet')));
  const stored = await api.store.get(host.roomId);
  assert.deepEqual(stored.gameMeta.characters, characters);
  for (let seat = 0; seat < clients.length; seat++) {
    const view = await api.request(path, { token: clients[seat].token });
    assert.deepEqual(view.state.game.characters, characters);
    assert.deepEqual(view.state.seats.map(person => person.characterId), characters);
    assertPrivate(view.state, stored, seat, clients);
  }
  const actingSeat = started.state.game.currentSeat;
  const acting = await api.request(path, { token: clients[actingSeat].token });
  const action = acting.state.game.legalActions.find(action => action.type === 'discard');
  assert.ok(action, 'the new game should allow a discard');
  const moved = await api.request(`${path}/action`, { method: 'POST', token: clients[actingSeat].token,
    body: { revision: acting.state.revision, action: { type: 'discard', tile: acting.state.game.players[actingSeat].hand[0] }, preferredCharacter: 'sunny', characters: ['sunny', 'sunny', 'sunny'] } });
  assert.equal(moved.status, 200, JSON.stringify(moved));
  assert.deepEqual(moved.state.game.characters, characters);
  const left = await api.request(`${path}/leave`, { method: 'POST', token: clients[1].token, body: {} });
  assert.equal(left.detached, true);
  const resumed = await api.request(`${path}/resume`, { method: 'POST', token: clients[1].token, body: {} });
  assert.equal(resumed.status, 200);
  assert.deepEqual(resumed.state.game.characters, characters);
  assert.equal(resumed.state.seats[1].preferredCharacter, 'sweet');
  assert.equal(resumed.state.seats[1].characterId, characters[1]);
  assert.equal(resumed.state.game.id, started.state.game.id);
});

test('a released lobby seat does not reserve its preferred character', async () => {
  const api = apiHarness();
  const { path, clients, host } = await table(api, ['sweet', 'elegant', 'sunny']);
  await api.request(`${path}/leave`, { method: 'POST', token: clients[1].token, body: {} });
  const replacement = await api.request(`${path}/join`, { method: 'POST', body: { name: '新玩家', preferredCharacter: 'sweet' } });
  assert.equal(replacement.status, 201);
  assert.equal(replacement.state.you, 1);
  assert.equal(replacement.state.seats[1].preferredCharacter, 'sweet');
  const started = await api.request(`${path}/start`, { method: 'POST', token: host.token, body: { revision: replacement.state.revision } });
  assert.equal(started.status, 200);
  assertDistinct(started.state.game.characters);
  assert.equal(started.state.game.characters[2], 'sunny');
  assert.ok([0, 1].includes(started.state.game.characters.indexOf('sweet')));
});

test('finished-game replacements do not inherit old characters and the next game uses current preferences', async () => {
  const api = apiHarness();
  const { path, clients, host, state } = await table(api, ['sweet', 'elegant', 'sunny']);
  const started = await api.request(`${path}/start`, { method: 'POST', token: host.token, body: { revision: state.revision } });
  const room = await api.store.get(host.roomId);
  room.game.phase = 'finished';
  await api.store.compareAndSwap(room, room.revision);
  await api.request(`${path}/leave`, { method: 'POST', token: clients[1].token, body: {} });
  const replacement = await api.request(`${path}/join`, { method: 'POST', body: { name: '新玩家', preferredCharacter: 'sweet' } });
  assert.equal(replacement.status, 201);
  assert.equal(replacement.state.seats[1].characterId, null);
  assert.equal(replacement.state.seats[1].isCurrentParticipant, false);
  assert.deepEqual(replacement.state.game.characters, started.state.game.characters);
  assert.ok(replacement.state.game.players.every(player => !('hand' in player)));
  const restarted = await api.request(`${path}/start`, { method: 'POST', token: host.token, body: { revision: replacement.state.revision } });
  assert.equal(restarted.status, 200);
  assert.notEqual(restarted.state.game.id, started.state.game.id);
  assertDistinct(restarted.state.game.characters);
  assert.equal(restarted.state.game.characters[2], 'sunny');
  assert.equal(restarted.state.seats[1].isCurrentParticipant, true);
  const persisted = await api.store.get(host.roomId);
  assert.deepEqual(persisted.archivedGames[0].meta.characters, started.state.game.characters);
});

test('legacy live games receive only a view fallback without changing stored rules or state', async () => {
  const api = apiHarness();
  const { path, clients, host } = await table(api, [null, null, null]);
  const room = await api.store.get(host.roomId);
  room.game = createLegacyGame({ seed: 42 });
  for (const person of room.seats) delete person.preferredCharacter;
  await api.store.compareAndSwap(room, room.revision);
  const original = await api.store.get(host.roomId);
  for (let seat = 0; seat < 3; seat++) {
    const view = await api.request(path, { token: clients[seat].token });
    assert.equal(view.status, 200);
    assert.deepEqual(view.state.game.characters, CHARACTER_IDS);
    assert.deepEqual(view.state.seats.map(person => person.characterId), CHARACTER_IDS);
    assert.deepEqual(view.state.seats.map(person => person.preferredCharacter), [null, null, null]);
    assert.equal(view.state.game.schemaVersion, 1);
    assertPrivate(view.state, room, seat, clients);
  }
  assert.deepEqual(await api.store.get(host.roomId), original);
});

test('concurrent starts commit only one assignment and stale retries cannot reroll it', async () => {
  const api = apiHarness();
  const { path, host, state } = await table(api, [null, null, null]);
  const request = () => api.request(`${path}/start`, { method: 'POST', token: host.token, body: { revision: state.revision } });
  const responses = await Promise.all([request(), request()]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const winner = responses.find(response => response.status === 200);
  const retry = await request();
  assert.equal(retry.status, 409);
  assert.equal(retry.code, 'STALE_STATE');
  const view = await api.request(path, { token: host.token });
  assert.deepEqual(view.state.game.characters, winner.state.game.characters);
  assert.equal(view.state.game.id, winner.state.game.id);
});

test('preferences and character mapping survive a real file-store restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mahjong-characters-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const api = apiHarness(new FileStore(directory));
  const { path, host, clients, state } = await table(api, ['sunny', 'sweet', 'elegant']);
  const started = await api.request(`${path}/start`, { method: 'POST', token: host.token, body: { revision: state.revision } });
  assert.equal(started.status, 200);
  const restarted = apiHarness(new FileStore(directory));
  for (let seat = 0; seat < 3; seat++) {
    const view = await restarted.request(path, { token: clients[seat].token });
    assert.equal(view.status, 200);
    assert.deepEqual(view.state.game.characters, ['sunny', 'sweet', 'elegant']);
    assert.deepEqual(view.state.seats.map(person => person.preferredCharacter), ['sunny', 'sweet', 'elegant']);
    assert.deepEqual(view.state.seats.map(person => person.characterId), ['sunny', 'sweet', 'elegant']);
    assert.equal(view.state.game.id, started.state.game.id);
  }
});
