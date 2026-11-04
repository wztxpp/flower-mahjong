import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {D1Store} from '../server/store.js';
import {createApi} from '../server/api.js';
import {createServer} from 'node:http';
import {apiMiddleware} from '../server/node.js';
import {createGame, assertGameInvariants} from '../shared/v2-game.js';

function sqliteD1() {
  const sqlite = new DatabaseSync(':memory:');
  const statements = [];
  sqlite.exec('CREATE TABLE mahjong_rooms (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  return {
    statements,
    close: () => sqlite.close(),
    prepare(sql) {
      return { bind(...values) { return {
        async first() { statements.push({ kind: 'read', sql }); return sqlite.prepare(sql).get(...values) || null; },
        async run() { statements.push({ kind: 'write', sql }); const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
      }; } };
    },
  };
}

test('D1 SQL adapter enforces revision CAS and concurrent seat limit',async()=>{
 const db=sqliteD1(),store=new D1Store(db),api=createApi(store);
 const request=async(path,data,token)=>{const r=await api(new Request(`https://test.local${path}`,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(data?{body:JSON.stringify(data)}:{})}));return {status:r.status,body:await r.json()};};
 try{
  const created=await request('/api/rooms',{name:'东家'});assert.equal(created.status,201);const{id}=created.body.state;
  const first=await request(`/api/rooms/${id}/join`,{name:'南家'});assert.equal(first.status,201);
  const contenders=await Promise.all(['西家','后来者'].map(name=>request(`/api/rooms/${id}/join`,{name})));
  assert.equal(contenders.filter(r=>r.status===201).length,1);assert.equal(contenders.filter(r=>r.status===409).length,1);
  const room=await store.get(id);assert.equal(room.seats.filter(Boolean).length,3);assert.equal(room.revision,2);
  const old=structuredClone(room);old.revision=3;assert.equal(await store.compareAndSwap(old,1),false);
  const auth=await request(`/api/rooms/${id}`,undefined,created.body.token);assert.equal(auth.status,200);assert.ok((await store.get(id)).seats[0].lastSeen>=room.seats[0].lastSeen);
  const started=await request(`/api/rooms/${id}/start`,{revision:2},created.body.token);assert.equal(started.status,200);assert.equal(started.body.state.game.players.filter(p=>p.hand).length,1);
 }finally{db.close();}
});

test('D1 stores game state without plaintext seat credentials',async()=>{
 const db=sqliteD1(),store=new D1Store(db),api=createApi(store);
 try{const response=await api(new Request('https://test.local/api/rooms',{method:'POST',body:JSON.stringify({name:'测试'})}));const data=await response.json();const record=await store.get(data.roomId);assert.equal(JSON.stringify(record).includes(data.token),false);assert.match(record.seats[0].tokenHash,/^[a-f0-9]{64}$/);}finally{db.close();}
});

test('D1 unchanged polls do exactly one SELECT, throttle json_set heartbeat writes, and retain game bytes', async () => {
  const db = sqliteD1();
  const store = new D1Store(db);
  const api = createApi(store);
  const request = async (path, body, token) => {
    const response = await api(new Request(`https://test.local${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
    return { status: response.status, body: await response.json() };
  };
  try {
    const created = await request('/api/rooms', { name: 'SQL合成东' });
    const id = created.body.roomId;
    const token = created.body.token;
    const before = await store.get(id);
    const gameBytes = JSON.stringify(before.game);
    db.statements.length = 0;
    const same = await request(`/api/rooms/${id}?since=0`, undefined, token);
    assert.deepEqual(same.body, { unchanged: true, revision: 0, connections: [true, false, false] });
    assert.equal(db.statements.length, 1);
    assert.equal(db.statements[0].kind, 'read');
    assert.match(db.statements[0].sql, /^SELECT state/);
    before.seats[0].lastSeen = Date.now() - 11000;
    assert.equal(await store.compareAndSwap(before, before.revision), true);
    db.statements.length = 0;
    const reconnected = await request(`/api/rooms/${id}?since=0`, undefined, token);
    assert.equal(reconnected.status, 200);
    assert.equal(db.statements.filter(statement => statement.kind === 'read').length, 1);
    assert.equal(db.statements.filter(statement => statement.kind === 'write').length, 1);
    assert.match(db.statements.find(statement => statement.kind === 'write').sql, /json_set/);
    db.statements.length = 0;
    await request(`/api/rooms/${id}?since=0`, undefined, token);
    assert.equal(db.statements.length, 1);
    assert.equal(db.statements[0].kind, 'read');
    const after = await store.get(id);
    assert.equal(after.revision, before.revision);
    assert.equal(JSON.stringify(after.game), gameBytes);
    db.statements.length = 0;
    const denied = await request(`/api/rooms/${id}?since=0`, undefined, '0'.repeat(64));
    assert.equal(denied.status, 401);
    assert.equal(db.statements.filter(statement => statement.kind === 'write').length, 0);
  } finally { db.close(); }
});

test('two independent API handlers over D1 and three real HTTP clients apply hu/score/radishes exactly once', async t => {
  const db = sqliteD1();
  const store = new D1Store(db);
  // Separate handlers model two worker isolates with the shared SQL CAS as the
  // only concurrency guard. Requests use real sockets, not direct engine calls.
  const handlers = [apiMiddleware(new D1Store(db)), apiMiddleware(new D1Store(db))];
  let sequence = 0;
  const server = createServer((request, response) => handlers[sequence++ % 2](request, response));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    db.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function request(path, body, token) {
    const response = await fetch(`${origin}${path}`, {
      method: body ? 'POST' : 'GET', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  }
  const created = await request('/api/rooms', { name: 'SQL合成东' });
  assert.equal(created.status, 201);
  const id = created.body.roomId;
  const tokens = [created.body.token];
  for (const name of ['SQL合成南', 'SQL合成西']) {
    const answer = await request(`/api/rooms/${id}/join`, { name });
    assert.equal(answer.status, 201);
    tokens.push(answer.body.token);
  }
  const started = await request(`/api/rooms/${id}/start`, { revision: 2 }, tokens[0]);
  assert.equal(started.status, 200);
  assert.equal(started.body.state.game.schemaVersion, 3);
  const room = await store.get(id);
  const game = createGame({ seed: 'SQL-hu-fixture' });
  const waiting = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
  game.players.forEach((player, seat) => { player.hand = seat === 0 ? [...waiting, 17] : [...waiting]; });
  game.lastDraw = { seat: 0, tile: 17, source: 'initial' };
  const counts = Array(18).fill(8);
  game.players.forEach(player => player.hand.forEach(tile => counts[tile]--));
  const head = [15, 8];
  const tail = [6, 6, 7, 7, 8, 8];
  [...head, ...tail].forEach(tile => counts[tile]--);
  assert.ok(counts.every(count => count >= 0));
  game.wall = [...head, ...counts.flatMap((count, tile) => Array(count).fill(tile)), ...tail];
  assertGameInvariants(game);
  room.game = game;
  assert.equal(await store.compareAndSwap(room, room.revision), true);
  const action = { revision: room.revision, action: { type: 'hu' } };
  const answers = await Promise.all([request(`/api/rooms/${id}/action`, action, tokens[0]), request(`/api/rooms/${id}/action`, action, tokens[0])]);
  assert.deepEqual(answers.map(answer => answer.status).sort(), [200, 409]);
  assert.equal(answers.find(answer => answer.status === 409).body.code, 'STALE_STATE');
  const reconnectHandlers = tokens.map(token => request(`/api/rooms/${id}`, undefined, token));
  const views = await Promise.all(reconnectHandlers);
  for (let seat = 0; seat < 3; seat++) {
    const state = views[seat].body.state;
    assert.equal(state.revision, room.revision + 1);
    assert.equal(state.game.players[0].huCount, 1);
    assert.equal(state.game.players[0].radishes.length, 6);
    assert.deepEqual(state.game.players.map(player => player.score), [2, -1, -1]);
    assert.equal(state.game.players[seat].hand.length, state.game.players[seat].handCount);
    state.game.players.forEach((player, index) => { if (index !== seat) assert.equal('hand' in player, false); });
    assert.equal(state.game.history.filter(event => event.type === 'hu').length, 1);
    for (const token of tokens) assert.equal(JSON.stringify(state).includes(token), false);
  }
  const stored = await store.get(id);
  assertGameInvariants(stored.game);
  assert.equal(stored.revision, room.revision + 1);
  assert.equal(stored.game.players[0].winPile.length, 1);
  assert.equal((await request(`/api/rooms/${id}/action`, action, tokens[0])).status, 409);
});
