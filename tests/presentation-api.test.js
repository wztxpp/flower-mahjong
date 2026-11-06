// 三个独立凭证通过真实 Request/Response 验证持久播放屏障、并发与隐私。
// Three independent credentials exercise persisted playback gates, concurrency and privacy through real Request/Response.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError } from '../server/api.js';
import { MemoryStore } from '../server/store.js';
import { createGame, applyAction, continuePresentedGame } from '../shared/game.js';
import { postHuKongGame } from './fixtures/post-hu-kong.js';
import { createGame as createV2Game } from '../shared/v2-game.js';

// 建立隔离的三人桌；固定种子只写测试存储，不提供客户端改牌接口。
// Build an isolated table; seeded games enter only test storage, never a client-facing state-edit endpoint.
async function table(game = createGame({ seed: 'presentation-api' }), presentationAtStart = false) {
  const store = new MemoryStore();
  let api = createApi(store);
  const tokens = [];
  // 请求使用各自的座位秘密；重建处理器模拟 Worker 重启并保留 JSON 存储。
  // Requests use independent seat secrets; replacing the handler simulates restart over persisted JSON.
  async function request(path, seat, body, headers = {}) {
    const response = await api(new Request('https://table.test/api/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(seat === undefined ? {} : { authorization: 'Bearer ' + tokens[seat] }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    return { status: response.status, ...(await response.json()) };
  }
  const created = await request('rooms', undefined, { name: '东' });
  tokens.push(created.token);
  const id = created.roomId;
  for (const name of ['南', '西']) {
    const joined = await request('rooms/' + id + '/join', undefined, { name });
    tokens.push(joined.token);
  }
  let current = await request('rooms/' + id, 0);
  await request('rooms/' + id + '/start', 0, { revision: current.state.revision, presentation: presentationAtStart });
  const room = await store.get(id);
  room.game = game;
  await store.compareAndSwap(room, room.revision);
  return {
    store, id, request,
    restart() { api = createApi(store); },
    get: (seat = 0, since) => request('rooms/' + id + (since === undefined ? '' : '?since=' + since), seat),
    action: (seat, revision, action, presentation = true) =>
      request('rooms/' + id + '/action', seat, { revision, action, presentation }),
    ack: (seat, gate, extra = {}) => request('rooms/' + id + '/presentation', seat, {
      presentationId: gate.id, gameId: gate.gameId, ...extra,
    }),
    leave: (seat) => request('rooms/' + id + '/leave', seat, {}),
  };
}

// 提交庄家真实可出的牌；所有断言都从已提交视图读取屏障。
// Discard a real dealer tile and obtain the gate only from the committed response.
async function pause(table) {
  const { state } = await table.get();
  const action = state.game.legalActions.find((action) => action.type === 'discard');
  assert.ok(action);
  const result = await table.action(0, state.revision, action);
  assert.equal(result.status, 200);
  assert.ok(result.state.presentation);
  return result.state;
}

test('three viewers wait for the slowest; receipts are private, idempotent and restart-safe', async () => {
  const api = await table();
  const state = await pause(api);
  const gate = state.presentation;
  assert.deepEqual(gate.requiredSeats, [0, 1, 2]);
  assert.ok(gate.remainingMs > 39000 && gate.remainingMs <= 40000);
  const frozen = (await api.store.get(api.id)).game;
  for (const seat of [0, 1, 2]) {
    const view = (await api.get(seat)).state;
    assert.deepEqual(view.game.legalActions, []);
    assert.equal(view.game.players[(seat + 1) % 3].hand, undefined);
    assert.equal(JSON.stringify(view).includes('tokenHash'), false);
    assert.equal(JSON.stringify(view).includes('discardIndex'), false);
  }
  const first = await api.ack(0, gate);
  assert.deepEqual(first.state.presentation.completedSeats, [0]);
  const duplicate = await api.ack(0, gate);
  assert.equal(duplicate.state.revision, first.state.revision);
  const changed = await api.get(1, state.revision);
  assert.ok(changed.state);
  await api.ack(1, gate);
  assert.deepEqual((await api.store.get(api.id)).game, frozen);
  // 旧客户端也不能在屏障期间抢先提交行动。
  // Old clients cannot bypass the gate by omitting the opt-in.
  const blocked = await api.action(2, (await api.get(2)).state.revision, { type: 'pass' }, false);
  assert.equal(blocked.code, 'PRESENTATION_PENDING');
  api.restart();
  const final = await api.ack(2, gate);
  assert.equal(final.status, 200);
  assert.deepEqual((await api.store.get(api.id)).game, continuePresentedGame(frozen));
  const replay = await api.ack(2, gate);
  assert.equal(replay.state.revision, final.state.revision);
});

test('simultaneous acknowledgments merge via CAS and continue only once', async () => {
  const api = await table();
  const state = await pause(api);
  const frozen = (await api.store.get(api.id)).game;
  const results = await Promise.all([0, 1, 2].map((seat) => api.ack(seat, state.presentation)));
  assert.deepEqual(results.map((result) => result.status), [200, 200, 200]);
  assert.deepEqual((await api.store.get(api.id)).game, continuePresentedGame(frozen));
});

test('lazy expiry on GET recovers without choosing claims, and stale receipts cannot release a newer gate', async () => {
  const api = await table();
  const state = await pause(api);
  let room = await api.store.get(api.id);
  const frozen = structuredClone(room.game);
  const oldGate = state.presentation;
  room.presentation.id = 'newer-presentation';
  room.presentation.expiresAt = Date.now() - 1;
  await api.store.compareAndSwap(room, room.revision);
  await api.ack(0, oldGate);
  assert.deepEqual((await api.store.get(api.id)).game, frozen);
  const result = await api.get(1, room.revision);
  assert.ok(result.state);
  room = await api.store.get(api.id);
  assert.deepEqual(room.game, continuePresentedGame(frozen));
  // 引擎续行只开放原本的回应窗口，不能替玩家选择过牌。
  // Continuation opens the normal response window rather than selecting a pass for anyone.
  if (room.game.phase === 'claim') assert.deepEqual(room.game.claim.responses, {});
});

test('detached viewers are removed without auto-passing', async () => {
  const api = await table();
  const state = await pause(api);
  await api.ack(0, state.presentation);
  await api.ack(1, state.presentation);
  const frozen = (await api.store.get(api.id)).game;
  assert.equal((await api.leave(2)).status, 200);
  assert.deepEqual((await api.store.get(api.id)).game, continuePresentedGame(frozen));
  assert.equal((await api.ack(2, state.presentation)).code, 'SEAT_DETACHED');
});

test('no opt-in and schema-two clients preserve synchronous behavior', async () => {
  for (const game of [createGame({ seed: 'legacy-opt-out' }), createV2Game({ seed: 'v2-opt-out' })]) {
    const api = await table(game);
    const state = (await api.get()).state;
    const action = state.game.legalActions.find((action) => action.type === 'discard');
    const result = await api.action(0, state.revision, action, game.schemaVersion === 2);
    assert.equal(result.status, 200);
    assert.equal(result.state.presentation, null);
    assert.equal((await api.store.get(api.id)).game.presentation, undefined);
    if (game.schemaVersion === 3)
      assert.deepEqual((await api.store.get(api.id)).game, applyAction(game, 0, action));
  }
});

// 断线不是自动过牌；在屏障创建时未在线的人无需确认，之后重连也不扩大快照。
// Offline is not an automatic pass; viewers absent at gate creation are not added when they reconnect.
test('offline snapshot excludes absent members and ignores unauthorized or mismatched receipts', async () => {
  const api = await table();
  const room = await api.store.get(api.id);
  room.seats[2].lastSeen = Date.now() - 31000;
  await api.store.compareAndSwap(room, room.revision);
  const state = await pause(api);
  assert.deepEqual(state.presentation.requiredSeats, [0, 1]);
  const frozen = (await api.store.get(api.id)).game;
  const unauthorized = await api.request('rooms/' + api.id + '/presentation', undefined, {
    presentationId: state.presentation.id, gameId: state.presentation.gameId,
  });
  assert.equal(unauthorized.status, 401);
  const mismatch = await api.ack(0, { ...state.presentation, gameId: 'old-game' });
  assert.deepEqual(mismatch.state.presentation.completedSeats, []);
  await api.get(2);
  await api.ack(2, state.presentation);
  assert.deepEqual((await api.store.get(api.id)).game, frozen);
  await api.ack(0, state.presentation);
  await api.ack(1, state.presentation);
  assert.deepEqual((await api.store.get(api.id)).game, continuePresentedGame(frozen));
});

test('expired action request recovers the gate but never replays its stale game move', async () => {
  const api = await table();
  const state = await pause(api);
  const room = await api.store.get(api.id);
  const frozen = structuredClone(room.game);
  room.presentation.expiresAt = Date.now() - 1;
  await api.store.compareAndSwap(room, room.revision);
  const result = await api.action(0, state.revision, { type: 'pass' });
  assert.equal(result.code, 'STALE_STATE');
  assert.deepEqual((await api.store.get(api.id)).game, continuePresentedGame(frozen));
});

// 一次明确启用后，本局混用旧客户端也必须继续分步；规则快照本身不改变。
// Once enabled, mixed old clients must keep pacing this game without changing its rules snapshot.
test('game-scoped opt-in persists for later actions from older clients', async () => {
  const api = await table();
  const first = await pause(api);
  for (const seat of [0, 1, 2]) await api.ack(seat, first.presentation);
  assert.equal((await api.store.get(api.id)).gameMeta.presentationEnabled, true);
  // 回应窗口仍由真人选过，然后找到下一位的出牌；每次只提交当前可用动作。
  // Explicitly pass any claim window, then find the next discard; submit only presently legal actions.
  for (let attempt = 0; attempt < 10; attempt++) {
    for (const seat of [0, 1, 2]) {
      const state = (await api.get(seat)).state;
      const action = state.game.legalActions.find((item) => item.type === 'discard') ||
        state.game.legalActions.find((item) => item.type === 'pass');
      if (!action) continue;
      const result = await api.action(seat, state.revision, action, false);
      assert.equal(result.status, 200);
      if (result.state.presentation) {
        assert.notEqual(result.state.presentation.id, first.presentation.id);
        return;
      }
    }
  }
  assert.fail('Expected another presentation gate after the explicit responses');
});

test('start opt-in paces even the first old-client action', async () => {
  const api = await table(createGame({ seed: 'start-opt-in' }), true);
  const state = (await api.get()).state;
  const action = state.game.legalActions.find((item) => item.type === 'discard');
  const result = await api.action(0, state.revision, action, false);
  assert.equal(result.status, 200);
  assert.ok(result.state.presentation);
  assert.equal((await api.store.get(api.id)).gameMeta.presentationEnabled, true);
});

// 同座位的两个真实请求并发抢播放权；失败者与无身份旧标签页都不能提前完成。
// Two concurrent same-seat requests compete for playback; neither the loser nor an identity-less old tab can finish early.
test('same-seat begin race grants one owner and rejects other completion receipts', async () => {
  const api = await table();
  const state = await pause(api);
  const gate = state.presentation;
  const tabs = ['tab-a', 'tab-b'];
  const claims = await Promise.all(tabs.map((clientId) =>
    api.ack(0, gate, { phase: 'begin', clientId })));
  assert.deepEqual(claims.map((result) => result.status), [200, 200]);
  const room = await api.store.get(api.id);
  const owner = room.presentation.owners[0];
  const other = tabs.find((tab) => tab !== owner);
  assert.ok(tabs.includes(owner));
  assert.deepEqual(room.presentation.completedSeats, []);
  const frozen = structuredClone(room.game);
  await api.ack(1, gate);
  await api.ack(2, gate);
  await api.ack(0, gate, { phase: 'complete', clientId: other });
  await api.ack(0, gate);
  assert.deepEqual((await api.store.get(api.id)).game, frozen);
  assert.deepEqual((await api.get()).state.presentation.owners, { 0: owner });
  api.restart();
  const result = await api.ack(0, gate, { phase: 'complete', clientId: owner });
  assert.equal(result.status, 200);
  assert.deepEqual((await api.store.get(api.id)).game, continuePresentedGame(frozen));

  // 逐一真人回应直到下一次出牌；新屏障不能继承旧标签页 owner。
  // Explicitly respond until the next discard; the new gate must not inherit old owners.
  for (let attempt = 0; attempt < 10; attempt++) {
    for (const seat of [0, 1, 2]) {
      const current = (await api.get(seat)).state;
      const action = current.game.legalActions.find((item) => item.type === 'discard') ||
        current.game.legalActions.find((item) => item.type === 'pass');
      if (!action) continue;
      const next = await api.action(seat, current.revision, action);
      if (!next.state.presentation) continue;
      assert.deepEqual(next.state.presentation.owners, {});
      const revision = next.state.revision;
      const stale = await api.ack(0, gate, { phase: 'begin', clientId: owner });
      assert.equal(stale.state.revision, revision);
      assert.deepEqual(stale.state.presentation.owners, {});
      return;
    }
  }
  assert.fail('Expected a new presentation gate');
});

test('begin does not expire a gate and completion requires a valid handshake identity', async () => {
  const api = await table();
  const state = await pause(api);
  const room = await api.store.get(api.id);
  room.presentation.expiresAt = Date.now() - 1;
  await api.store.compareAndSwap(room, room.revision);
  for (const extra of [
    { phase: 'begin' }, { phase: 'unknown', clientId: 'tab' },
    { phase: 'begin', clientId: 'bad space' }, { clientId: 'x'.repeat(65) },
  ]) assert.equal((await api.ack(0, state.presentation, extra)).status, 400);
  const unclaimed = await api.ack(0, state.presentation, { clientId: 'unclaimed-tab' });
  assert.equal(unclaimed.state.revision, room.revision);
  const claimed = await api.ack(0, state.presentation, { phase: 'begin', clientId: 'owner-tab' });
  assert.deepEqual(claimed.state.presentation.owners, { 0: 'owner-tab' });
  assert.deepEqual(claimed.state.presentation.completedSeats, []);
  assert.deepEqual((await api.store.get(api.id)).game, room.game);
});

// 隐藏标签页在真正播放前交还所有权，不确认完成；同座位另一标签页随后可安全取得播放权。
// A hidden tab relinquishes ownership before playback without completing; another tab can safely take over.
test('owner release preserves the barrier, rejects strangers and safely races a new begin', async () => {
  const api = await table();
  const state = await pause(api);
  const gate = state.presentation;
  await api.ack(0, gate, { phase: 'begin', clientId: 'hidden-tab' });
  await api.ack(1, gate, { phase: 'begin', clientId: 'other-seat' });
  let room = await api.store.get(api.id);
  const frozen = structuredClone(room.game);
  assert.equal((await api.ack(0, gate, { phase: 'release' })).status, 400);
  const stranger = await api.ack(0, gate, { phase: 'release', clientId: 'stranger' });
  assert.equal(stranger.state.revision, room.revision);
  const released = await api.ack(0, gate, { phase: 'release', clientId: 'hidden-tab' });
  assert.deepEqual(released.state.presentation.owners, { 1: 'other-seat' });
  assert.deepEqual(released.state.presentation.completedSeats, []);
  const duplicate = await api.ack(0, gate, { phase: 'release', clientId: 'hidden-tab' });
  assert.equal(duplicate.state.revision, released.state.revision);

  // 旧 release 与新 begin 的到达次序任意；旧请求绝不能撤销新 owner。
  // The old release and new begin may arrive in either order; the old request must not remove the new owner.
  await Promise.all([
    api.ack(0, gate, { phase: 'release', clientId: 'hidden-tab' }),
    api.ack(0, gate, { phase: 'begin', clientId: 'visible-tab' }),
  ]);
  room = await api.store.get(api.id);
  assert.deepEqual(room.presentation.owners, { 0: 'visible-tab', 1: 'other-seat' });
  assert.deepEqual(room.game, frozen);
  await api.ack(0, gate, { clientId: 'visible-tab' });
  room = await api.store.get(api.id);
  const completedRelease = await api.ack(0, gate, { phase: 'release', clientId: 'visible-tab' });
  assert.equal(completedRelease.state.revision, room.revision);
  assert.equal(completedRelease.state.presentation.owners[0], 'visible-tab');

  // 使用另一个屏障 ID 模拟后续同座位 owner，旧屏障 release 不能越界影响新一段。
  // A later gate may reuse a tab identity; a stale gate release still must not affect that new segment.
  room.presentation.id = 'next-gate';
  room.presentation.completedSeats = [];
  room.presentation.expiresAt = Date.now() - 1;
  await api.store.compareAndSwap(room, room.revision);
  const stale = await api.ack(0, gate, { phase: 'release', clientId: 'visible-tab' });
  assert.equal(stale.state.revision, room.revision);
  assert.equal(stale.state.presentation.owners[0], 'visible-tab');
  // 当前屏障即使超时，release 仍只交还 owner，不自动续行。
  // Even on an expired current gate, release only relinquishes ownership without continuation.
  const expiredRelease = await api.ack(0, { ...gate, id: 'next-gate' }, {
    phase: 'release', clientId: 'visible-tab',
  });
  assert.deepEqual(expiredRelease.state.presentation.owners, { 1: 'other-seat' });
  assert.deepEqual((await api.store.get(api.id)).game, frozen);
});

// 场景：没有活跃遥测时不伪造认领或完成；短发现期限后读取恢复，且不自动判过。
// Scenario: missing live telemetry needs no fake ownership; a read after short discovery resumes without auto-passing.
test('a background-only unowned gate recovers on the bounded polling deadline', async () => {
  const api = await table();
  const state = await pause(api);
  const room = await api.store.get(api.id);
  const frozen = structuredClone(room.game);
  assert.deepEqual(room.presentation.owners, {});
  assert.deepEqual(room.presentation.completedSeats, []);
  assert.ok(room.presentation.discoveryExpiresAt - Date.now() <= 1500);
  const waiting = await api.get(0);
  assert.equal(waiting.state.presentation.id, state.presentation.id);
  assert.deepEqual((await api.store.get(api.id)).game, frozen);
  room.presentation.discoveryExpiresAt = Date.now() - 1;
  await api.store.compareAndSwap(room, room.revision);
  await api.get(0);
  const recovered = (await api.store.get(api.id)).game;
  assert.deepEqual(recovered, continuePresentedGame(frozen));
  if (recovered.phase === 'claim') assert.deepEqual(recovered.claim.responses, {});
});

// 测试遥测是标签页能力而非玩家身份；始终与现有座位凭证一起发送。
// Test telemetry describes tab capabilities, never player identity, and accompanies existing seat credentials.
function presenceHeaders(gameId, clientId, { visible = true, ready = true, audio = 'ready' } = {}) {
  return {
    'X-Presentation-Client': clientId,
    'X-Presentation-Visible': String(visible),
    'X-Presentation-Audio': audio,
    'X-Presentation-Game': gameId,
    'X-Presentation-Ready': String(ready),
  };
}
async function reportPresence(api, seat, clientId, options) {
  const gameId = (await api.store.get(api.id)).gameMeta.id;
  return api.request('rooms/' + api.id, seat, undefined, presenceHeaders(gameId, clientId, options));
}

test('foreground election prefers ready audio and hidden duplicate cannot suppress or own it', async () => {
  const api = await table();
  await reportPresence(api, 0, 'silent-foreground', { audio: 'silent' });
  await reportPresence(api, 0, 'voiced-foreground');
  await reportPresence(api, 0, 'hidden-duplicate', { visible: false });
  await reportPresence(api, 2, 'hidden-only', { visible: false });
  const state = await pause(api);
  assert.deepEqual(state.presentation.requiredSeats, [0, 1]);
  assert.equal(state.presentation.preferredClients[0], 'voiced-foreground');
  assert.equal(JSON.stringify(state).includes('presentationClients'), false);
  await api.ack(0, state.presentation, { phase: 'begin', clientId: 'silent-foreground' });
  await api.ack(0, state.presentation, { phase: 'begin', clientId: 'hidden-duplicate' });
  assert.deepEqual((await api.store.get(api.id)).presentation.owners, {});
  await api.ack(0, state.presentation, { phase: 'begin', clientId: 'voiced-foreground' });
  await api.ack(1, state.presentation);
  const done = await api.ack(0, state.presentation, { clientId: 'voiced-foreground' });
  assert.equal(done.state.presentation, null);
});

test('ownerless lease disappearance recovers quickly but owned media survives hidden reports and expired leases', async () => {
  const api = await table();
  await reportPresence(api, 0, 'owner');
  await reportPresence(api, 1, 'vanished');
  const state = await pause(api);
  await api.ack(0, state.presentation, { phase: 'begin', clientId: 'owner' });
  const frozen = (await api.store.get(api.id)).game;
  await reportPresence(api, 0, 'duplicate', { visible: false });
  let room = await api.store.get(api.id);
  room.presentation.discoveryExpiresAt = Date.now() - 1;
  for (const person of room.seats)
    for (const client of person.presentationClients || []) client.at = Date.now() - 6000;
  await api.store.compareAndSwap(room, room.revision);
  const current = (await api.get()).state;
  assert.deepEqual(current.presentation.requiredSeats, [0]);
  assert.equal(current.presentation.owners[0], 'owner');
  assert.deepEqual((await api.store.get(api.id)).game, frozen);
  await api.ack(0, state.presentation, { clientId: 'owner' });
  assert.equal((await api.get()).state.presentation, null);
});

test('legacy discovery is 1500ms and action telemetry is atomic without self-staling', async () => {
  const api = await table();
  const initial = (await api.get()).state;
  const action = initial.game.legalActions.find((item) => item.type === 'discard');
  const result = await api.request('rooms/' + api.id + '/action', 0, {
    revision: initial.revision, action, presentation: true,
  }, presenceHeaders(initial.game.id, 'actor'));
  assert.equal(result.status, 200);
  assert.equal(result.state.presentation.preferredClients[0], 'actor');
  let room = await api.store.get(api.id);
  assert.ok(room.presentation.discoveryExpiresAt - Date.now() <= 1500);
  room.presentation.discoveryExpiresAt = Date.now() - 1;
  await api.store.compareAndSwap(room, room.revision);
  const current = (await api.get()).state;
  assert.deepEqual(current.presentation.requiredSeats, [0]);
  await api.ack(0, current.presentation, { phase: 'begin', clientId: 'actor' });
  await api.ack(0, current.presentation, { clientId: 'actor' });
  assert.equal((await api.get()).state.presentation, null);
});

test('concurrent tab presence retains both records and coalesces unchanged reports', async () => {
  const api = await table();
  const responses = await Promise.all([
    reportPresence(api, 0, 'foreground'), reportPresence(api, 0, 'background', { visible: false }),
  ]);
  assert.deepEqual(responses.map((result) => result.status), [200, 200]);
  const room = await api.store.get(api.id);
  assert.equal(room.seats[0].presentationClients.length, 2);
  const unchanged = await reportPresence(api, 0, 'foreground');
  assert.equal(unchanged.state.revision, room.revision);
  const state = await pause(api);
  assert.equal(state.presentation.preferredClients[0], 'foreground');
});

// 释放时先合并后台遥测，再选择另一个前台标签页；release 不应推进已经提交的动作。
// Release merges hidden telemetry first, then selects another foreground tab without advancing the committed move.
test('release telemetry immediately elects the surviving foreground candidate without settling', async () => {
  const api = await table();
  await reportPresence(api, 0, 'a-owner');
  await reportPresence(api, 0, 'b-foreground', { audio: 'silent' });
  const state = await pause(api);
  await api.ack(0, state.presentation, { phase: 'begin', clientId: 'a-owner' });
  const frozen = (await api.store.get(api.id)).game;
  const result = await api.request('rooms/' + api.id + '/presentation', 0, {
    presentationId: state.presentation.id, gameId: state.game.id,
    phase: 'release', clientId: 'a-owner',
  }, presenceHeaders(state.game.id, 'a-owner', { visible: false }));
  assert.equal(result.state.presentation.preferredClients[0], 'b-foreground');
  assert.deepEqual(result.state.presentation.owners, {});
  assert.deepEqual((await api.store.get(api.id)).game, frozen);
});

// 慢音频结束的 ready:false 属于旧 gate；紧接着的自动弃牌仍是前台页面应播放的新事件。
// Slow audio completion reports ready:false for its old gate; the following automatic discard is still a new foreground event.
test('gate-scoped readiness keeps the foreground eligible for the next automatic presentation', async () => {
  const game = postHuKongGame({ type: 'anGang' });
  game.rules.autoDiscardAfterHu = true;
  // 调换牌墙中的两张既有实体牌，确保补摸不胡且自动出牌，保持守恒。
  // Swap two existing wall tiles to produce a nonwinning automatic discard while preserving conservation.
  const index = game.wall.indexOf(6);
  [game.wall[0], game.wall[index]] = [game.wall[index], game.wall[0]];
  const api = await table(game);
  await reportPresence(api, 0, 'foreground');
  let state = (await api.get()).state;
  state = (await api.action(0, state.revision, { type: 'anGang', tile: 0 })).state;
  const oldGate = state.presentation;
  await api.ack(0, oldGate, { phase: 'begin', clientId: 'foreground' });
  await api.ack(1, oldGate);
  await api.ack(2, oldGate);
  const room = await api.store.get(api.id);
  room.seats[0].presentationClients[0].at = Date.now() - 6000;
  await api.store.compareAndSwap(room, room.revision);
  const result = await api.request('rooms/' + api.id + '/presentation', 0, {
    presentationId: oldGate.id, gameId: oldGate.gameId,
    clientId: 'foreground', phase: 'complete',
  }, {
    ...presenceHeaders(oldGate.gameId, 'foreground', { ready: false }),
    'X-Presentation-Gate': oldGate.id,
  });
  assert.equal(result.state.game.presentation.stage, 'discard');
  assert.notEqual(result.state.presentation.id, oldGate.id);
  assert.equal(result.state.presentation.preferredClients[0], 'foreground');
  const nextGate = result.state.presentation;
  const baselineOnly = await api.request('rooms/' + api.id, 0, undefined, {
    ...presenceHeaders(oldGate.gameId, 'foreground', { ready: false }),
    'X-Presentation-Gate': nextGate.id,
  });
  assert.equal(baselineOnly.state.presentation.preferredClients[0], undefined);
  assert.equal(baselineOnly.state.presentation.requiredSeats.includes(0), false);
});

// 遥测只提升房间 revision；现代请求证明同局同引擎版本后仍可执行，旧局/旧牌面不可执行。
// Presence bumps only room revision; modern proof permits the same game state, never another game or stale engine state.
test('modern game proof tolerates presence-only revisions but rejects stale game identity and moves', async () => {
  const api = await table();
  const state = (await api.get()).state;
  const action = state.game.legalActions.find((item) => item.type === 'discard');
  await reportPresence(api, 1, 'new-tab');
  const body = {
    revision: state.revision, gameId: state.game.id, gameRevision: state.game.revision,
    presentation: true, action,
  };
  const path = 'rooms/' + api.id + '/action';
  assert.equal((await api.request(path, 0, { ...body, gameId: 'different-game' })).code, 'STALE_STATE');
  assert.equal((await api.request(path, 0, { ...body, gameRevision: state.game.revision - 1 })).code, 'STALE_STATE');
  assert.equal((await api.request(path, 0, { ...body, presentation: false })).code, 'STALE_STATE');
  const result = await api.request(path, 0, body);
  assert.equal(result.status, 200);
  assert.ok(result.state.presentation);
  assert.equal((await api.request(path, 0, body)).code, 'STALE_STATE');
});

// 当前房间版本不能替代请求已经提供但错误/不完整的局证明。
// A current room revision cannot substitute for supplied but stale or incomplete game proof.
test('current room revision never bypasses stale or partial explicit game proof', async () => {
  const api = await table();
  const state = (await api.get()).state;
  const action = state.game.legalActions.find((item) => item.type === 'discard');
  const base = { revision: state.revision, presentation: true, action };
  for (const proof of [
    { gameId: 'wrong-game', gameRevision: state.game.revision },
    { gameId: state.game.id, gameRevision: state.game.revision - 1 },
    { gameId: state.game.id },
    { gameRevision: state.game.revision },
    { gameId: state.game.id, gameRevision: null },
  ]) {
    const result = await api.request('rooms/' + api.id + '/action', 0, { ...base, ...proof });
    assert.equal(result.code, 'STALE_STATE');
    assert.equal((await api.store.get(api.id)).revision, state.revision);
  }
  assert.equal((await api.request('rooms/' + api.id + '/action', 0, base)).status, 200);
});

// 在动作 CAS 的最后一刻插入真实租约读取，稳定制造读取后竞争，不依赖计时碰运气。
// Insert a real lease GET immediately before action CAS, deterministically reproducing the read-to-commit race.
async function raceActionCommit(api, intervene) {
  const compareAndSwap = api.store.compareAndSwap.bind(api.store);
  let attempts = 0;
  api.store.compareAndSwap = async (candidate, revision) => {
    const current = await api.store.get(api.id);
    if (candidate.game?.revision > current.game?.revision) {
      attempts++;
      await intervene({ current, candidate, attempts, compareAndSwap });
    }
    return compareAndSwap(candidate, revision);
  };
  return () => attempts;
}

// 使用当前画面的完整 proof；请求故意不自动刷新，让测试真正覆盖服务器重读重算。
// Use complete proof from the current view without refreshing the request, exercising server-side reread/recomputation.
async function actionBody(api, modern = true) {
  const state = (await api.get()).state;
  return {
    revision: state.revision,
    action: state.game.legalActions.find((item) => item.type === 'discard'),
    presentation: true,
    ...(modern ? { gameId: state.game.id, gameRevision: state.game.revision } : {}),
  };
}

test('modern action retries a real lease GET committed between its read and CAS exactly once', async () => {
  const api = await table();
  const body = await actionBody(api);
  const before = (await api.store.get(api.id)).game;
  const attempts = await raceActionCommit(api, async ({ attempts }) => {
    if (attempts === 1) assert.equal((await reportPresence(api, 1, 'racing-tab')).status, 200);
  });
  const result = await api.request('rooms/' + api.id + '/action', 0, body);
  assert.equal(result.status, 200);
  assert.equal(attempts(), 2);
  const saved = await api.store.get(api.id);
  assert.equal(saved.game.revision, before.revision + 1);
  assert.equal(saved.game.discards.length, before.discards.length + 1);
  assert.equal(saved.seats[1].presentationClients[0].clientId, 'racing-tab');
});

test('action retry rejects every nontelemetry change even with unchanged engine revision', async () => {
  const changes = {
    newGame: (room) => { room.gameMeta.id = 'replacement-game'; },
    gameContents: (room) => { room.game.rules.testMarker = true; },
    detach: (room) => { room.seats[1].detached = true; },
    profile: (room) => { room.seats[1].playerHash = 'other-profile'; },
    host: (room) => { room.hostSeat = 1; },
    occupant: (room) => { room.seats[1].tokenHash = 'replacement-occupant'; },
    lifecycle: (room) => { (room.lifecycleLog ||= []).push({ type: 'resume', seat: 1 }); },
    metadata: (room) => { room.gameMeta.finishedAt = 123; },
    roomGate: (room) => { room.presentation = { id: 'new-gate', gameId: room.gameMeta.id }; },
    engineGate: (room) => { room.game.presentation = { stage: 'kong', seat: 0 }; },
    archive: (room) => { (room.archivedGames ||= []).push({ id: 'another-game' }); },
    actualAction: (room) => {
      room.game = applyAction(room.game, 0, { type: 'discard', tile: room.game.players[0].hand[0] });
    },
  };
  for (const [label, change] of Object.entries(changes)) {
    const api = await table();
    const body = await actionBody(api);
    const attempts = await raceActionCommit(api, async ({ current, compareAndSwap }) => {
      const revision = current.revision;
      change(current);
      current.revision++;
      assert.equal(await compareAndSwap(current, revision), true);
    });
    const result = await api.request('rooms/' + api.id + '/action', 0, body);
    assert.equal(result.code, 'STALE_STATE', label);
    assert.equal(attempts(), 1, label);
    assert.equal((await api.store.get(api.id)).game.revision, body.gameRevision + (label === 'actualAction' ? 1 : 0), label);
  }
});

test('legacy CAS remains strict, telemetry retries stop after four, and storage errors are never retried', async () => {
  for (const modern of [false, true]) {
    const api = await table();
    const body = await actionBody(api, modern);
    const attempts = await raceActionCommit(api, async ({ attempts }) => {
      await reportPresence(api, 1, 'racing-tab-' + attempts);
    });
    const result = await api.request('rooms/' + api.id + '/action', 0, body);
    assert.equal(result.code, 'STALE_STATE');
    assert.equal(attempts(), modern ? 4 : 1);
    assert.equal((await api.store.get(api.id)).game.discards.length, 0);
  }
  const api = await table();
  const body = await actionBody(api);
  const attempts = await raceActionCommit(api, async () => { throw new Error('uncertain storage result'); });
  const result = await api.request('rooms/' + api.id + '/action', 0, body);
  assert.equal(result.code, 'SERVER_ERROR');
  assert.equal(attempts(), 1);
});

// 持久层提交后抛异常表示结果不确定，绝不能重算并二次提交同一动作。
// A persistence exception after the write is uncertain, so the action must never be recomputed or submitted again.
test('commit-then-throw never retries and profile linking occurs once across a safe retry', async () => {
  const uncertain = await table();
  const body = await actionBody(uncertain);
  const attempts = await raceActionCommit(uncertain, async ({ candidate, current, compareAndSwap }) => {
    assert.equal(await compareAndSwap(candidate, current.revision), true);
    throw new Error('persistence response lost after commit');
  });
  const result = await uncertain.request('rooms/' + uncertain.id + '/action', 0, body);
  assert.equal(result.code, 'SERVER_ERROR');
  assert.equal(attempts(), 1);
  assert.equal((await uncertain.store.get(uncertain.id)).game.discards.length, 1);

  const api = await table();
  const profile = await api.request('profile', undefined, {});
  const action = await actionBody(api);
  const linkProfileRoom = api.store.linkProfileRoom.bind(api.store);
  let links = 0;
  api.store.linkProfileRoom = async (...args) => { links++; return linkProfileRoom(...args); };
  await raceActionCommit(api, async ({ attempts }) => {
    if (attempts === 1) await reportPresence(api, 1, 'profile-race');
  });
  const accepted = await api.request('rooms/' + api.id + '/action', 0, action, {
    'x-player-token': profile.playerToken,
  });
  assert.equal(accepted.status, 200);
  assert.equal(links, 1);
  const saved = await api.store.get(api.id);
  assert.ok(saved.seats[0].playerHash);
  assert.equal(saved.gameMeta.participants[0].playerHash, saved.seats[0].playerHash);
});

// 存储抛出的同名 STALE_STATE 不是 CAS=false 的证明，也可能已经提交，因此不能重试。
// A storage-thrown STALE_STATE is not proof of CAS=false and may follow a write, so it must not be retried.
test('a storage-thrown STALE_STATE is never mistaken for an explicit failed CAS', async () => {
  const api = await table();
  const body = await actionBody(api);
  const attempts = await raceActionCommit(api, async () => {
    await reportPresence(api, 1, 'uncertain-error-race');
    throw new ApiError(409, 'STALE_STATE', 'storage outcome uncertain');
  });
  const result = await api.request('rooms/' + api.id + '/action', 0, body);
  assert.equal(result.code, 'STALE_STATE');
  assert.equal(attempts(), 1);
});

// 非布尔返回即使是假值也不能证明 CAS 未写入；真实提交后返回异常值也不得重复动作。
// Nonboolean results, even falsy ones, cannot prove a failed CAS; malformed responses after a write must not replay it.
test('nonboolean CAS results are uncertain storage errors and never retry', async () => {
  for (const invalid of [undefined, null, 0, '', 1, 'true', {}]) {
    const api = await table();
    const body = await actionBody(api);
    const compareAndSwap = api.store.compareAndSwap.bind(api.store);
    let attempts = 0;
    api.store.compareAndSwap = async (candidate, revision) => {
      attempts++;
      await compareAndSwap(candidate, revision);
      return invalid;
    };
    const result = await api.request('rooms/' + api.id + '/action', 0, body);
    assert.equal(result.code, 'SERVER_ERROR');
    assert.equal(attempts, 1);
    assert.equal((await api.store.get(api.id)).game.discards.length, 1);
  }
});
