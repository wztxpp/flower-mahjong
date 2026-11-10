// 通过真实HTTP处理器和磁盘重启验证禁用动作不能绕过规则、重复请求不能改账。
// Real HTTP handlers and disk restart verify that rejected locks cannot be bypassed or alter the ledger on retry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../server/api.js';
import { MemoryStore } from '../server/store.js';
import { FileStore } from '../server/node.js';
import { variableFixture, meld } from './fixtures/variable-table.js';
import { postHuWinClaim } from './fixtures/post-hu-win.js';
import { assertGameInvariants } from '../shared/game.js';
import { oldContinuationClaim } from './fixtures/kong-hu-continuation.js';

// 只把合成局存入隔离测试桌；不使用真实房间号、凭证或外部网络。
// Inject only synthetic games into isolated test rooms; no real rooms, credentials or external networking.
async function table(game, store = new MemoryStore()) {
  let api = createApi(store);
  const tokens = [];
  async function request(path, seat, body) {
    const response = await api(new Request('https://lock.test/api/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: seat === undefined ? {} : { authorization: 'Bearer ' + tokens[seat] },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    return { status: response.status, ...(await response.json()) };
  }
  const created = await request('rooms', undefined, { name: '锁手测试甲' });
  tokens.push(created.token);
  const id = created.roomId;
  for (const name of ['锁手测试乙', '锁手测试丙']) {
    const joined = await request(`rooms/${id}/join`, undefined, { name }); tokens.push(joined.token);
  }
  const current = await request(`rooms/${id}`, 0);
  await request(`rooms/${id}/start`, 0, { revision: current.state.revision });
  const room = await store.get(id); room.game = game;
  await store.compareAndSwap(room, room.revision);
  return { id, request, getStore: () => store,
    restart(nextStore) { store = nextStore; api = createApi(store); },
    get: seat => request(`rooms/${id}`, seat),
    action: (seat, revision, action) => request(`rooms/${id}/action`, seat, { revision, action }),
  };
}

// 为保存兼容样本补一个已知公开旧弃牌；调整实体配额与索引，不改待决回应内容。
// Add a known historical public discard to a compatibility save, adjusting physical copies/indexes without touching responses.
function olderClaim() {
  const game = postHuWinClaim({ kind: 'robKong' });
  const tile = game.claim.tile;
  const index = game.wall.indexOf(tile); assert.notEqual(index, -1);
  game.wall.splice(index, 1);
  game.discards.unshift({ seat: 0, tile, claimable: false, afterKong: false });
  game.claim.discardIndex++;
  game.history.unshift({ type: 'discard', seat: 0, tile, revision: 0 });
  assertGameInvariants(game);
  return game;
}

test('HTTP rejects held-tile post-hu upgrades repeatedly without changing saved hand, scores or history', async () => {
  const game = variableFixture({ playerCount: 3, deckCount: 2, drawTile: 14,
    hands: [[3, 4, 5, 5, 11, 12, 13, 14]], melds: [[meld(11, 4, 'buGang'), meld(1)]],
    huCounts: [2], rules: { specialHuPatterns: false, autoDiscardAfterHu: false } });
  const scope = await table(game);
  const { state } = await scope.get(0);
  assert.deepEqual(state.game.legalActions, [{ type: 'pass' }]);
  const before = await scope.getStore().get(scope.id);
  for (let attempt = 0; attempt < 2; attempt++) {
    const rejected = await scope.action(0, state.revision, { type: 'addGang', tile: 11 });
    assert.equal(rejected.status, 422);
    const after = await scope.getStore().get(scope.id);
    assert.deepEqual(after.game, before.game); assert.equal(after.revision, before.revision);
  }
  const accepted = await scope.action(0, state.revision, { type: 'pass' });
  assert.equal(accepted.status, 200);
  assert.deepEqual((await scope.getStore().get(scope.id)).game.players[0].hand, [3, 4, 5, 5, 11, 12, 13]);
});

test('FileStore restart filters a saved rob-kong hu, keeps its committed history, and permits pass to close it', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'flower-lock-test-'));
  try {
    const game = olderClaim();
    const scope = await table(game, new FileStore(directory));
    scope.restart(new FileStore(directory));
    const { state } = await scope.get(0);
    assert.deepEqual(state.game.legalActions, [{ type: 'pass' }]);
    assert.equal(state.game.huDiagnostic.code, 'SELF_DISCARD_LOCK');
    const before = await scope.getStore().get(scope.id);
    assert.deepEqual(before.game, game);
    const rejected = await scope.action(0, state.revision, { type: 'hu' });
    assert.equal(rejected.status, 422);
    assert.deepEqual((await scope.getStore().get(scope.id)).game, before.game);
    const other = (await scope.get(1)).state;
    assert.equal(other.game.players[0].hand, undefined);
    assert.equal(other.game.claim.options, undefined);
    assert.equal(other.game.claim.responses, undefined);
    const latest = (await scope.get(0)).state;
    const accepted = await scope.action(0, latest.revision, { type: 'pass' });
    assert.equal(accepted.status, 200);
    const after = (await scope.getStore().get(scope.id)).game;
    assert.equal(after.players[0].huCount, before.game.players[0].huCount);
    assert.deepEqual(after.rules, before.game.rules);
    assert.deepEqual(after.history.slice(0, before.game.history.length), before.game.history);
    assertGameInvariants(after);
    const replay = await scope.action(0, latest.revision, { type: 'pass' });
    assert.equal(replay.status, 409);
    assert.deepEqual((await scope.getStore().get(scope.id)).game, after);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

// 修正前保存的胡后续摸弃牌，重启后不能被旧客户端直接提交胡；读取和拒绝均不改旧账。
// After disk restart, an old client cannot hu a saved continuation discard; reads/rejections do not rewrite old ledgers.
test('FileStore restart rejects stale post-kong continuation claims over HTTP without rewriting history', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'flower-kong-continuation-'));
  try {
    const game = oldContinuationClaim({ repeatedResponder: true });
    const scope = await table(game, new FileStore(directory));
    scope.restart(new FileStore(directory));
    const { state } = await scope.get(2);
    assert.deepEqual(state.game.legalActions, [{ type: 'pass' }]);
    assert.equal(state.game.huDiagnostic.code, 'PROTECTED_DISCARD');
    const before = await scope.getStore().get(scope.id);
    assert.deepEqual(before.game, game);
    for (let attempt = 0; attempt < 2; attempt++) {
      const rejected = await scope.action(2, state.revision, { type: 'hu' });
      assert.equal(rejected.status, 422);
      assert.deepEqual(await scope.getStore().get(scope.id), before);
    }
    for (const seat of [2, 1]) {
      const current = (await scope.get(seat)).state;
      const accepted = await scope.action(seat, current.revision, { type: 'pass' });
      assert.equal(accepted.status, 200);
    }
    const after = (await scope.getStore().get(scope.id)).game;
    assert.equal(after.history.filter(event => event.type === 'hu').length, 1);
    assert.deepEqual(after.history.slice(0, before.game.history.length), before.game.history);
    assert.deepEqual(after.rules, before.game.rules);
    assertGameInvariants(after);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
