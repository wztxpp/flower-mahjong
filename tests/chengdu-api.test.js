/**
 * 成都生产适配验收：真实本机HTTP、四份凭证、合成牌与独立存储；不访问线上牌局。
 * Chengdu production integration: loopback HTTP, four credentials, synthetic games and isolated stores, never live rooms.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiMiddleware, FileStore } from '../server/node.js';
import { MemoryStore } from '../server/store.js';
import * as engine from '../shared/chengdu-engine.js';
import { engineFor } from '../server/game-engines.js';
import { secureIndex, shuffledChengduWall } from '../server/chengdu-shuffle.js';

const SETTINGS = { endCondition: 'bloodBattle', exchangeThree: true, selfDraw: 'addBase', fanCap: 4 };

// 每个测试独占服务与存储；HTTP客户端只能提交原协议，不增加种子/改牌测试后门。
// Each test owns its server/store; clients use the real protocol without seed or hand-editing backdoors.
async function harness(t, store = new MemoryStore()) {
  const server = createServer(apiMiddleware(store));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { store, async request(path, body, token, profile) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(profile ? { 'x-player-token': profile } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, ...await response.json() };
  } };
}

// 真实创建四个个人档案并入座，角色与历史由原生命周期保存。
// Create four real profiles/seats; existing lifecycle code owns characters and history.
async function table(app, settings = SETTINGS) {
  const profiles = [];
  for (let seat = 0; seat < 4; seat++) profiles.push((await app.request('/profile', {})).playerToken);
  const created = await app.request('/rooms', { name: '房主', gameMode: 'chengdu', settings }, undefined, profiles[0]);
  assert.equal(created.status, 201);
  const result = { path: `/rooms/${created.roomId}`, id: created.roomId, tokens: [created.token], profiles, state: created.state };
  for (let seat = 1; seat < 4; seat++) {
    const joined = await app.request(`${result.path}/join`, { name: `玩家${seat}` }, undefined, profiles[seat]);
    assert.equal(joined.status, 201);
    result.tokens.push(joined.token);
    result.state = joined.state;
  }
  return result;
}

// 每次都从合法视图选择测试意图；生产代码没有代选逻辑。
// Tests choose intent from current legal views; production has no autoplay logic.
async function act(app, room, seat, action) {
  const current = await app.request(room.path, undefined, room.tokens[seat], room.profiles[seat]);
  assert.equal(current.status, 200);
  const result = await app.request(`${room.path}/action`, { revision: current.state.revision, action }, room.tokens[seat], room.profiles[seat]);
  assert.equal(result.status, 200, JSON.stringify(result));
  return result.state;
}

// 测试明确选过以保证遍历整副牌墙；定缺选手中最少花色，交换选合法第一组。
// Explicit test passes guarantee full wall traversal; choose the least-held suit and first legal exchange.
async function finish(app, room) {
  for (let step = 0; step < 700; step++) {
    const saved = await app.store.get(room.id);
    engine.assertGameInvariants(saved.game);
    if (saved.game.phase === 'finished') return saved;
    let choice;
    for (let seat = 0; seat < 4 && !choice; seat++) {
      const view = (await app.request(room.path, undefined, room.tokens[seat], room.profiles[seat])).state.game;
      let action = view.legalActions.find(action => action.type === 'pass') ?? view.legalActions.find(action => action.type === 'discard') ?? view.legalActions[0];
      if (view.phase === 'dingque' && action) {
        const suits = ['bamboo', 'dots', 'characters'];
        const counts = suits.map((_, index) => view.players[seat].hand.filter(tile => Math.floor(tile / 9) === index).length);
        action = { type: 'dingque', suit: suits[counts.indexOf(Math.min(...counts))] };
      }
      if (action) choice = { seat, action };
    }
    assert.ok(choice, 'Active game must expose a decision');
    await act(app, room, choice.seat, choice.action);
  }
  assert.fail('Game did not finish in bounded decisions');
}

test('secure shuffle rejects biased tail, preserves all copies and has no insecure fallback', () => {
  const values = [0xffffffff, 0xfffffffe, 7];
  const source = { getRandomValues(array) { array[0] = values.shift(); return array; } };
  assert.equal(secureIndex(3, source), 2);
  assert.equal(values.length, 1);
  const wall = shuffledChengduWall();
  assert.equal(wall.length, 108);
  for (let tile = 0; tile < 27; tile++) assert.equal(wall.filter(value => value === tile).length, 4);
  assert.throws(() => shuffledChengduWall({}), TypeError);
});

for (const endCondition of ['firstWin', 'bloodBattle']) {
  test(`${endCondition}: four-player HTTP full draw, profiles, privacy, archives and exchange cycle`, async t => {
    const app = await harness(t);
    const room = await table(app, { ...SETTINGS, endCondition });
    assert.equal(room.state.rulesVersion, 2);
    const blocked = await app.request(`${room.path}/start`, { revision: room.state.revision }, room.tokens[1], room.profiles[1]);
    assert.equal(blocked.code, 'HOST_ONLY');
    const changed = await app.request(`${room.path}/start`, { revision: room.state.revision, options: { fanCap: 6 } }, room.tokens[0], room.profiles[0]);
    assert.equal(changed.code, 'BAD_START_OPTIONS');
    const started = await app.request(`${room.path}/start`, { revision: room.state.revision, presentationMode: 'local', options: {} }, room.tokens[0], room.profiles[0]);
    assert.equal(started.status, 200);
    assert.equal(started.state.game.phase, 'exchange');
    assert.equal(started.state.presentation, null);
    assert.equal(started.state.presentationMode, undefined);
    let saved = await app.store.get(room.id);
    assert.equal(saved.chengduExchangeOrdinal, 1);
    assert.equal(saved.game.preparation.exchangePlan.direction, 'clockwise');
    assert.equal(saved.gameMeta.characters.length, 4);
    assert.equal(new Set(saved.gameMeta.characters).size, 4);
    assert.equal(engineFor(saved.game).presentation, null);
    const watcher = await app.request(`${room.path}/spectate`, {});
    assert.equal(watcher.status, 201);
    const selected = started.state.game.legalActions[0];
    const body = { revision: started.state.revision, action: selected };
    const accepted = await app.request(`${room.path}/action`, body, room.tokens[0], room.profiles[0]);
    assert.equal(accepted.status, 200);
    const duplicate = await app.request(`${room.path}/action`, body, room.tokens[0], room.profiles[0]);
    assert.equal(duplicate.code, 'STALE_STATE');
    const other = await app.request(room.path, undefined, room.tokens[1], room.profiles[1]);
    const spectator = await app.request(room.path, undefined, watcher.token);
    for (const state of [other.state, spectator.state]) {
      assert.equal(state.game.players[0].hand, undefined);
      assert.equal(state.game.preparation.exchangeSelections, undefined);
      assert.equal(state.game.drawnTile ?? null, null);
    }
    assert.deepEqual(spectator.state.game.legalActions, []);
    for (const operation of ['start', 'action', 'presentation']) {
      assert.equal((await app.request(`${room.path}/${operation}`, { revision: accepted.state.revision, action: selected }, watcher.token)).code, 'SPECTATOR_READ_ONLY');
    }
    // 进行中离席保留座位与私人牌，重连不会推进交换序号。
    // Active departure preserves the seat/private game; resume never advances the exchange ordinal.
    await app.request(`${room.path}/leave`, {}, room.tokens[2], room.profiles[2]);
    const detachedGame = (await app.store.get(room.id)).game;
    assert.equal((await app.request(`${room.path}/join`, { name: '不能替换' })).code, 'STARTED');
    assert.equal((await app.request(`${room.path}/resume`, {}, room.tokens[2], room.profiles[2])).status, 200);
    assert.deepEqual((await app.store.get(room.id)).game, detachedGame);
    saved = await finish(app, room);
    assert.equal(saved.game.finishReason, 'wallExhausted');
    assert.equal(saved.game.drawSettlement.status, 'settled');
    assert.equal(saved.game.players.reduce((sum, player) => sum + player.score, 0), 0);
    assert.ok(saved.gameMeta.finishedAt);
    const oldId = saved.gameMeta.id;
    const nextDealer = engine.dealerForNextGame(saved.game);
    const startBody = { revision: saved.revision, options: {} };
    const starts = await Promise.all([0, 1].map(() => app.request(`${room.path}/start`, startBody, room.tokens[0], room.profiles[0])));
    assert.deepEqual(starts.map(result => result.status).sort(), [200, 409]);
    saved = await app.store.get(room.id);
    assert.equal(saved.chengduExchangeOrdinal, 2);
    assert.equal(saved.game.preparation.exchangePlan.direction, 'opposite');
    assert.equal(saved.game.dealerSeat, nextDealer);
    assert.equal(saved.archivedGames.length, 1);
    assert.equal(saved.archivedGames[0].meta.id, oldId);
    assert.equal(saved.archivedGames[0].game.wall, undefined);
    const history = await app.request('/profile/history', undefined, undefined, room.profiles[0]);
    assert.equal(history.status, 200);
    assert.ok(JSON.stringify(history).includes(oldId));
    assert.equal(JSON.stringify(history).includes('exchangeSelections'), false);
    // 第三/四局继续真实动作到终局，证明轮回回到顺时针而不是只验证前两项。
    // Complete real rounds three/four to prove the full cycle returns clockwise rather than checking only two entries.
    if (endCondition === 'firstWin') {
      for (const [ordinal, direction] of [[3, 'counterclockwise'], [4, 'clockwise']]) {
        const previous = await finish(app, room);
        const next = await app.request(`${room.path}/start`, { revision: previous.revision }, room.tokens[0], room.profiles[0]);
        assert.equal(next.status, 200);
        const saved = await app.store.get(room.id);
        assert.equal(saved.chengduExchangeOrdinal, ordinal);
        assert.equal(saved.game.preparation.exchangePlan.direction, direction);
      }
    }
  });
}

// 文件重启读取相同权威局；准备决定和游标都不能由重连重新计算。
// File restart restores identical authority; neither preparation decisions nor the counter are recomputed on resume.
test('FileStore reload preserves choices, mode, settings and disabled exchange cursor', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chengdu-http-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = await harness(t, new FileStore(directory));
  const room = await table(app, { ...SETTINGS, exchangeThree: false });
  const started = await app.request(`${room.path}/start`, { revision: room.state.revision }, room.tokens[0], room.profiles[0]);
  assert.equal(started.status, 200);
  await act(app, room, 0, { type: 'dingque', suit: 'characters' });
  const before = await app.store.get(room.id);
  assert.equal(before.chengduExchangeOrdinal, 0);
  const restarted = await harness(t, new FileStore(directory));
  const resumed = await restarted.request(`${room.path}/resume`, {}, room.tokens[0], room.profiles[0]);
  assert.equal(resumed.status, 200);
  const after = await restarted.store.get(room.id);
  assert.deepEqual(after.game, before.game);
  assert.deepEqual(after.gameMeta, before.gameMeta);
  assert.equal(after.chengduExchangeOrdinal, 0);
  const completed = await finish(restarted, room);
  const next = await restarted.request(`${room.path}/start`, { revision: completed.revision }, room.tokens[0], room.profiles[0]);
  assert.equal(next.status, 200);
  assert.equal((await restarted.store.get(room.id)).chengduExchangeOrdinal, 0);
});

// 根据显式起手从每种四张预算扣除，剩余牌按编号填充；只有测试能传此合成牌墙。
// Debit explicit opening hands from four-copy budgets and fill remaining tiles; only tests supply this synthetic wall.
function openingWall(hands) {
  const counts = Array(27).fill(4);
  for (const hand of hands) for (const tile of hand || []) assert.ok(--counts[tile] >= 0);
  const rest = counts.flatMap((count, tile) => Array(count).fill(tile));
  const allHands = Array.from({ length: 4 }, (_, seat) => hands[seat] || rest.splice(0, 13));
  return [...allHands[0].slice(0, 13), ...allHands.slice(1).flat(), allHands[0][13], ...rest];
}

// 在真实开局生成元信息后，仅替换隔离store中的合成发牌输入；之后全部操作都经HTTP。
// After real start metadata, replace only the isolated store's synthetic deal; all subsequent decisions use HTTP.
async function installOpening(app, room, hands, suits = []) {
  const started = await app.request(`${room.path}/start`, { revision: room.state.revision }, room.tokens[0], room.profiles[0]);
  assert.equal(started.status, 200);
  const saved = await app.store.get(room.id);
  saved.game = engine.createGame({ wall: openingWall(hands), dealerSeat: 0, exchangeOrdinal: 0,
    options: { endCondition: saved.settings.endCondition, exchangeThree: false }, scoring: { selfDraw: saved.settings.selfDraw, fanCap: saved.settings.fanCap } });
  assert.equal(await app.store.compareAndSwap(saved, saved.revision), true);
  for (let seat = 0; seat < 4; seat++) await act(app, room, seat, { type: 'dingque', suit: suits[seat] || 'bamboo' });
}

for (const endCondition of ['firstWin', 'bloodBattle']) {
  test(`${endCondition}: HTTP self-draw retirement, public counts, replacement privacy and next-game history`, async t => {
    const app = await harness(t);
    const room = await table(app, { ...SETTINGS, endCondition, exchangeThree: false });
    await installOpening(app, room, [[9, 10, 11, 12, 13, 14, 18, 19, 20, 21, 22, 23, 26, 26]]);
    let state = await act(app, room, 0, { type: 'hu' });
    assert.equal(state.seats[0].huCount, 1);
    assert.equal(Object.hasOwn((await app.store.get(room.id)).game.players[0], 'huCount'), false);
    if (endCondition === 'bloodBattle') {
      assert.equal(state.game.phase, 'turn');
      assert.equal(state.game.currentSeat, 3);
      const other = await app.request(room.path, undefined, room.tokens[1], room.profiles[1]);
      assert.equal(other.state.game.players[0].won.hidden, true);
      assert.equal(other.state.game.players[0].won.tile, null);
      assert.equal(other.state.game.history.find(event => event.type === 'hu').hidden, true);
      assert.deepEqual(engine.getLegalActions((await app.store.get(room.id)).game, 0), []);
      await finish(app, room);
    }
    const completed = await app.store.get(room.id);
    const historical = await app.request('/profile/history', undefined, undefined, room.profiles[0]);
    assert.equal(historical.status, 200);
    assert.ok(JSON.stringify(historical).includes('"huCount":1'));
    await app.request(`${room.path}/leave`, {}, room.tokens[0], room.profiles[0]);
    const replacement = await app.request(`${room.path}/join`, { name: '新房客' });
    assert.equal(replacement.status, 201);
    assert.equal(replacement.state.game.mySeat, null);
    assert.ok(replacement.state.game.players.every(player => player.hand === undefined));
    assert.deepEqual(replacement.state.game.legalActions, []);
    assert.equal(replacement.state.seats[0].huCount, 0);
    state = (await app.request(room.path, undefined, room.tokens[1], room.profiles[1])).state;
    assert.equal(state.hostSeat, 1);
    const next = await app.request(`${room.path}/start`, { revision: state.revision }, room.tokens[1], room.profiles[1]);
    assert.equal(next.status, 200);
    const archived = (await app.store.get(room.id)).archivedGames[0];
    assert.equal(archived.game.players[0].huCount, 1);
    assert.equal(archived.meta.id, completed.gameMeta.id);
    assert.equal((await app.request('/profile/history', undefined, undefined, room.profiles[0])).status, 200);
  });
}

test('HTTP simultaneous discard wins resolve together and keep the discarder as next dealer', async t => {
  const app = await harness(t);
  const room = await table(app, { ...SETTINGS, endCondition: 'firstWin', exchangeThree: false });
  const waiting = [9, 10, 11, 12, 13, 14, 18, 19, 20, 21, 22, 23, 26];
  await installOpening(app, room, [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17, 26], waiting, waiting], ['characters']);
  await act(app, room, 0, { type: 'discard', tile: 26 });
  const window = (await app.store.get(room.id)).game.claim;
  for (const seat of window.eligibleSeats) {
    const legal = engine.getLegalActions((await app.store.get(room.id)).game, seat);
    await act(app, room, seat, legal.find(action => action.type === 'hu') || { type: 'pass' });
  }
  const finished = await app.store.get(room.id);
  assert.equal(finished.game.phase, 'finished');
  assert.equal(finished.game.history.filter(event => event.type === 'hu').length, 2);
  assert.equal(engine.dealerForNextGame(finished.game), 0);
  assert.equal(finished.game.players.reduce((sum, player) => sum + player.score, 0), 0);
});

// 新局暗杠牌面按已确认政策公开；其他暗手与补摸牌仍只归本人，读取不会额外算杠分。
// Confirmed production policy publishes established concealed-kong faces; other hands/replacement draws remain private and reads never repay kongs.
test('HTTP concealed kong preserves replacement-draw privacy, scores and strict action parsing', async t => {
  const app = await harness(t);
  const room = await table(app, { ...SETTINGS, exchangeThree: false });
  await installOpening(app, room, [[9, 9, 9, 9, 10, 11, 12, 13, 14, 15, 18, 19, 20, 26]]);
  const before = await app.store.get(room.id);
  for (const action of [{ type: 'anGang', tile: 9, approved: true }, { type: 'discard', tile: 27 }, { type: 'dingque', suit: 'invalid' }]) {
    const rejected = await app.request(`${room.path}/action`, { revision: before.revision, action }, room.tokens[0], room.profiles[0]);
    assert.equal(rejected.code, 'BAD_ACTION');
    assert.deepEqual((await app.store.get(room.id)).game, before.game);
  }
  const state = await act(app, room, 0, { type: 'anGang', tile: 9 });
  assert.equal(state.game.players[0].score, 6);
  assert.equal(state.game.players[0].melds[0].tile, 9);
  const saved = await app.store.get(room.id);
  const spectator = await app.request(`${room.path}/spectate`, {});
  assert.equal(spectator.state.game.players[0].melds[0].tile, 9);
  assert.equal(spectator.state.game.drawnTile, null);
  assert.equal(spectator.state.game.players[0].hand, undefined);
  const draw = spectator.state.game.history.findLast(event => event.type === 'draw');
  assert.equal(draw.tile, null);
  assert.equal(draw.hidden, true);
  assert.deepEqual((await app.store.get(room.id)).game, saved.game);
});

// 保存的实验局与伪造的正式外壳在鉴权之外也必须先拒绝，不能创建观战密钥或触碰座位。
// Draft saves and forged production headers reject before spectator-key issuance or occupancy side effects.
test('draft and corrupted production saves reject every route without writes', async t => {
  const app = await harness(t);
  const room = await table(app, { ...SETTINGS, exchangeThree: false });
  await app.request(`${room.path}/start`, { revision: room.state.revision }, room.tokens[0], room.profiles[0]);
  const pristine = await app.store.get(room.id);
  for (const corrupt of [
    game => { game.developmentOnly = true; },
    game => { game.runtimeKind = 'draft'; },
    game => { game.wall.pop(); },
    game => { game.playPolicy.turnDirection = 'clockwise'; },
  ]) {
    const saved = structuredClone(pristine);
    corrupt(saved.game);
    delete saved.spectatorKey;
    await app.store.compareAndSwap(saved, saved.revision);
    const before = await app.store.get(room.id);
    for (const operation of ['', '/join', '/spectate', '/resume', '/leave', '/start', '/action']) {
      const result = await app.request(`${room.path}${operation}`, operation ? { name: '测试', revision: saved.revision, action: { type: 'dingque', suit: 'bamboo' } } : undefined,
        room.tokens[0], room.profiles[0]);
      assert.equal(result.code, 'INVALID_GAME_STATE');
      assert.deepEqual(await app.store.get(room.id), before);
    }
  }
});

for (const type of ['peng', 'mingGang']) {
  test(`HTTP ${type} claim waits for all responders and preserves public meld/score provenance`, async t => {
    const app = await harness(t);
    const room = await table(app, { ...SETTINGS, exchangeThree: false });
    const source = [9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13];
    const claimant = type === 'peng' ? [9, 9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 18, 19] : [9, 9, 9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 18];
    await installOpening(app, room, [source, claimant], ['dots']);
    await act(app, room, 0, { type: 'discard', tile: 9 });
    const window = (await app.store.get(room.id)).game.claim;
    assert.ok(window.eligibleSeats.includes(1));
    for (const seat of window.eligibleSeats) await act(app, room, seat, seat === 1 ? { type, tile: 9 } : { type: 'pass' });
    const saved = await app.store.get(room.id);
    assert.equal(saved.game.currentSeat, 1);
    assert.equal(saved.game.players[1].melds[0].type, type);
    assert.equal(saved.game.players[1].melds[0].fromSeat, 0);
    assert.equal(saved.game.players[1].score, type === 'mingGang' ? 2 : 0);
    assert.equal(saved.game.players[0].score, type === 'mingGang' ? -2 : 0);
    if (type === 'peng') assert.ok(engine.getLegalActions(saved.game, 1).every(action => action.type === 'discard'));
  });
}

// 成都真实客户端携带局证明但不携带花麻将播放字段；缺半份/过期证明不能因房间版本正确而被接受。
// Real Chengdu clients send game proofs without Flower playback fields; partial/stale proofs cannot hide behind a current room revision.
test('Chengdu action proofs work without presentation flags and incomplete/stale proofs never write', async t => {
  const app = await harness(t);
  const room = await table(app, { ...SETTINGS, exchangeThree: false });
  const started = await app.request(`${room.path}/start`, { revision: room.state.revision }, room.tokens[0], room.profiles[0]);
  assert.equal(started.status, 200);
  const proof = { gameId: started.state.game.id, gameRevision: started.state.game.revision };
  const before = await app.store.get(room.id);
  const action = { type: 'dingque', suit: 'characters' };
  for (const invalid of [
    { gameId: proof.gameId }, { gameRevision: proof.gameRevision },
    { ...proof, gameId: 'another-game' }, { ...proof, gameRevision: proof.gameRevision + 1 },
    { ...proof, gameRevision: String(proof.gameRevision) },
  ]) {
    const result = await app.request(`${room.path}/action`, { revision: before.revision, ...invalid, action }, room.tokens[0], room.profiles[0]);
    assert.equal(result.code, 'STALE_STATE');
    assert.deepEqual(await app.store.get(room.id), before);
  }
  const result = await app.request(`${room.path}/action`, { revision: before.revision, ...proof, action }, room.tokens[0], room.profiles[0]);
  assert.equal(result.status, 200);
  assert.equal(result.state.game.revision, proof.gameRevision + 1);
  const committed = await app.store.get(room.id);
  const duplicate = await app.request(`${room.path}/action`, { revision: committed.revision, ...proof, action }, room.tokens[0], room.profiles[0]);
  assert.equal(duplicate.code, 'STALE_STATE');
  assert.deepEqual(await app.store.get(room.id), committed);
  for (const schemaVersion of [1, 2, 3]) assert.equal(engineFor({ gameMode: 'flower', schemaVersion }).actionGameProof, undefined);
});
