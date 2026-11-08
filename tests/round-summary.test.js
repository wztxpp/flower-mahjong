/**
 * 终局摘要验收：真实引擎动作、版本分发、原参与者累计，以及玩家/观战/替补/重连的隐私边界。
 * Finished-summary acceptance uses real engine actions, registry dispatch, original-participant totals and all viewer lifecycles.
 * 所有牌局与凭证由隔离测试生成；没有生产请求，也没有用终局手牌重算胡数或神龙。
 * Games and credentials are synthetic and isolated; no production requests or final-hand reconstruction of hu/dragons.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as legacy from '../shared/legacy-game.js';
import * as v2 from '../shared/v2-game.js';
import * as flower from '../shared/game.js';
import * as chengdu from '../shared/chengdu-engine.js';
import { engineFor } from '../server/game-engines.js';
import { roundSummaryForRoom, newGameMetadata, archiveFinishedGame, ensureGameMetadata, tableScores } from '../server/history.js';
import { createApi } from '../server/api.js';
import { MemoryStore } from '../server/store.js';
import { FileStore } from '../server/node.js';

const CHENGDU_OPTIONS = { endCondition: 'firstWin', exchangeThree: false };
const CHENGDU_SCORING = { selfDraw: 'addBase', fanCap: 4 };
const WAITING_HAND = [9, 10, 11, 12, 13, 14, 18, 19, 20, 21, 22, 23, 26];

// 从每种四张的真实预算扣除给定手牌，顺序构建108张牌墙，避免胡牌夹具凭空加牌。
// Debit prescribed hands from four-copy budgets before building the full wall; never invent physical winning tiles.
function chengduGame({ source = 'selfDraw', options = CHENGDU_OPTIONS } = {}) {
  const hands = source === 'selfDraw'
    ? [[...WAITING_HAND, 26], [], [], []]
    : [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17, 26], [...WAITING_HAND], [], []];
  const counts = Array(27).fill(4);
  for (const tile of hands.flat()) assert.ok(--counts[tile] >= 0);
  for (const [seat, hand] of hands.entries()) {
    while (hand.length < (seat === 0 ? 14 : 13)) {
      const tile = counts.findIndex((count, value) => count > 0 && !hand.includes(value));
      const nextTile = tile < 0 ? counts.findIndex((count) => count > 0) : tile;
      hand.push(nextTile);
      counts[nextTile]--;
    }
  }
  const extra = hands[0].pop();
  const wall = [...hands.flat(), extra, ...counts.flatMap((count, tile) => Array(count).fill(tile))];
  let game = chengdu.createGame({ wall, dealerSeat: 0, options,
    scoring: CHENGDU_SCORING, exchangeOrdinal: 0 });
  for (let seat = 0; seat < 4; seat++) game = chengdu.applyAction(game, seat, {
    type: 'dingque', suit: source === 'discard' && seat === 0 ? 'characters' : 'bamboo',
  });
  if (source === 'discard') game = chengdu.applyAction(game, 0, { type: 'discard', tile: 26 });
  return game;
}

// 选择真实白名单动作直到结束，同时保留最后一步，供HTTP验证“动作返回即终局摘要”。
// Play real allowlisted decisions to completion and retain the last step for HTTP terminal-action verification.
function finish(engine, initial, { preferHu = true } = {}) {
  let game = initial;
  for (let step = 0; step < 1000; step++) {
    const choices = game.players.flatMap((_, seat) => engine.getLegalActions(game, seat)
      .map((action) => ({ seat, action })));
    const choice = (preferHu ? choices.find(({ action }) => action.type === 'hu') : null) ??
      choices.find(({ action }) => action.type === 'pass') ??
      choices.find(({ action }) => action.type === 'discard') ?? choices[0];
    assert.ok(choice, `No legal decision in ${game.phase}`);
    const next = engine.applyAction(game, choice.seat, choice.action);
    engine.assertGameInvariants(next);
    if (next.phase === 'finished') return { before: game, choice, game: next };
    game = next;
  }
  assert.fail('Synthetic game did not finish');
}

const SCENARIOS = [
  { label: 'Flower v1 absent schema', engine: legacy, create: () => legacy.createGame({ seed: 45 }) },
  { label: 'Flower v2', engine: v2, create: () => v2.createGame({ seed: 45 }) },
  { label: 'Flower v3 three seats', engine: flower, create: () => flower.createGame({ seed: 45, rules: { dragonStartCount: 1 } }) },
  { label: 'Flower v3 four seats', engine: flower, create: () => flower.createGame({ seed: 45,
    rules: { playerCount: 4, dragonStartCount: 1 } }) },
  { label: 'Chengdu self draw', engine: chengdu, create: () => chengduGame() },
  { label: 'Chengdu discard', engine: chengdu, create: () => chengduGame({ source: 'discard' }) },
];

for (const scenario of SCENARIOS) {
  test(`${scenario.label}: exact authoritative zones/counts/score, immutable finished-only projection`, () => {
    const initial = scenario.create();
    assert.equal(engineFor(initial).roundSummary(initial), null);
    const { game } = finish(scenario.engine, initial);
    const before = structuredClone(game);
    const summary = engineFor(game).roundSummary(game);
    assert.equal(summary.gameMode, game.gameMode ?? 'flower');
    assert.equal(summary.players.length, game.players.length);
    assert.equal(summary.players.reduce((sum, player) => sum + player.roundScore, 0), 0);
    for (const [seat, player] of summary.players.entries()) {
      assert.deepEqual(player.finalHand, game.players[seat].hand);
      assert.equal(player.roundScore, game.players[seat].score);
      assert.equal(player.huCount, game.gameMode === 'chengdu' ? Number(Boolean(game.players[seat].won)) : game.players[seat].huCount);
      if (game.gameMode === 'chengdu') {
        assert.equal(player.dragons.status, 'notApplicable');
        assert.equal(player.dragons.count, null);
        assert.equal(player.wins.length, player.huCount);
        if (player.wins.length) assert.equal(player.wins[0].inHand, game.players[seat].won.source === 'selfDraw');
      } else {
        assert.equal(player.wins.length, player.huCount);
        assert.ok(player.wins.every((win) => win.inHand === false));
        if (game.schemaVersion === 3) {
          const actual = game.dragonSettlement.entries.find((entry) => entry.seat === seat);
          assert.equal(player.dragons.status, 'settled');
          assert.equal(player.dragons.count, actual?.dragons.length ?? 0);
          assert.equal(player.dragons.pointsPerOpponent, actual?.points ?? 0);
          assert.deepEqual(player.dragons.details, (actual?.dragons ?? []).map(({ tile, count, points }) => ({ tile, count, pointsPerOpponent: points })));
          assert.deepEqual(player.dragons.payments, actual?.payments ?? []);
        } else {
          assert.equal(player.dragons.status, 'unavailable');
          assert.equal(player.dragons.count, null);
          assert.equal(player.dragons.details, null);
        }
      }
    }
    assert.deepEqual(game, before);
    summary.players[0].finalHand[0] = 999;
    assert.deepEqual(game, before, 'Summary arrays must never mutate persisted game');
  });
}

test('summary allowlist drops private extensions and never rebuilds missing legacy dragon/hu records', () => {
  const { game } = finish(flower, SCENARIOS[2].create());
  game.players[0].secret = 'private-summary-probe';
  game.players[0].lastScoreBreakdown = { secret: 'private-summary-probe' };
  game.dragonSettlement.entries[0].secret = 'private-summary-probe';
  game.dragonSettlement.entries[0].dragons[0].secret = 'private-summary-probe';
  game.dragonSettlement.entries[0].payments[0].secret = 'private-summary-probe';
  assert.equal(JSON.stringify(engineFor(game).roundSummary(game)).includes('private-summary-probe'), false);
  delete game.players[0].huCount;
  delete game.players[0].winPile;
  delete game.dragonSettlement;
  const summary = engineFor(game).roundSummary(game);
  assert.equal(summary.players[0].huCount, null);
  assert.equal(summary.players[0].wins, null);
  assert.equal(summary.players[0].dragons.status, 'unavailable');
  for (const mode of ['unknown', null]) assert.throws(() => engineFor({ ...game, gameMode: mode }));
});

// 所有凭证通过真实API创建；仅在测试存储中安装真实引擎生成的前一步牌局。
// Issue credentials through real API endpoints; install only a real-engine penultimate state in the isolated test store.
async function table(game, store = new MemoryStore()) {
  let api = createApi(store);
  const request = async (path, body, token) => {
    const response = await api(new Request(`https://round-summary.test/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    return { status: response.status, ...await response.json() };
  };
  const isChengdu = game.gameMode === 'chengdu';
  const created = await request('/rooms', { name: '本局东家',
    ...(isChengdu ? { gameMode: 'chengdu', settings: { ...CHENGDU_OPTIONS, ...CHENGDU_SCORING } }
      : { settings: { playerCount: game.players.length } }),
  });
  assert.equal(created.status, 201);
  const path = `/rooms/${created.roomId}`;
  const tokens = [created.token];
  for (let seat = 1; seat < game.players.length; seat++) {
    const joined = await request(`${path}/join`, { name: `本局玩家${seat}` });
    assert.equal(joined.status, 201);
    tokens.push(joined.token);
  }
  const room = await store.get(created.roomId);
  room.game = game;
  room.gameMeta = newGameMetadata(room, 'current-synthetic-round', 1);
  await store.compareAndSwap(room, room.revision);
  return { store, request, path, tokens, id: created.roomId,
    reload(nextStore) { api = createApi(nextStore); },
  };
}

for (const scenario of [SCENARIOS[0], SCENARIOS[1], SCENARIOS[3], SCENARIOS[4], SCENARIOS[5]]) {
  test(`${scenario.label}: terminal action, all players, spectator, replacement, reconnect and new-round privacy`, async () => {
    const { before, choice, game } = finish(scenario.engine, scenario.create());
    const app = await table(before);
    const room = await app.store.get(app.id);
    // 另存一局真实完成局作为累计来源；同ID副本验证既有去重，不额外累计本局。
    // Store a real completed game for totals; a repeated ID tests existing deduplication without adding the current game twice.
    const archive = archiveFinishedGame({ ...room, game, gameMeta: { ...room.gameMeta, id: 'prior-synthetic-round' } });
    room.archivedGames = [archive, structuredClone(archive)];
    await app.store.compareAndSwap(room, room.revision);
    const spectator = await app.request(`${app.path}/spectate`, {});
    for (const token of [...app.tokens, spectator.token]) {
      const response = await app.request(`${app.path}?phase=finished`, undefined, token);
      assert.equal(response.status, 200);
      assert.equal(response.state.game.roundSummary, undefined);
      for (const player of response.state.game.players) {
        if (player.seat !== response.state.you) assert.equal(player.hand, undefined);
      }
    }
    const current = await app.request(app.path, undefined, app.tokens[choice.seat]);
    const ended = await app.request(`${app.path}/action`, { revision: current.state.revision, action: choice.action }, app.tokens[choice.seat]);
    assert.equal(ended.status, 200, JSON.stringify(ended));
    assert.equal(ended.state.game.phase, 'finished');
    const summary = ended.state.game.roundSummary;
    assert.deepEqual(summary.players.map((player) => player.roundScore), game.players.map((player) => player.score));
    assert.deepEqual(summary.players.map((player) => player.tableScore), game.players.map((player) => player.score * 2));
    for (const token of [...app.tokens, spectator.token]) {
      for (const suffix of ['', '/resume']) {
        const response = await app.request(`${app.path}${suffix}`, suffix ? {} : undefined, token);
        assert.equal(response.status, 200);
        assert.deepEqual(response.state.game.roundSummary, summary);
        assert.equal(response.state.game.wall, undefined);
        for (const player of response.state.game.players) {
          if (player.seat !== response.state.you) assert.equal(player.hand, undefined, 'Existing hand projection stays unchanged');
        }
      }
    }
    await app.request(`${app.path}/leave`, {}, app.tokens[1]);
    const replacement = await app.request(`${app.path}/join`, { name: '本局玩家1' });
    assert.equal(replacement.status, 201);
    assert.deepEqual(replacement.state.game.roundSummary, summary, 'Same-named replacement does not inherit or erase original totals');
    assert.equal(replacement.state.seats[1].score, 0);
    const stored = await app.store.get(app.id);
    assert.equal(stored.game.roundSummary, undefined, 'Public summary is never persisted into authoritative game');
    assert.deepEqual(stored.game, game);
    const next = await app.request(`${app.path}/start`, { revision: replacement.state.revision }, app.tokens[0]);
    assert.equal(next.status, 200);
    assert.equal(next.state.game.roundSummary, undefined);
    for (const token of [replacement.token, spectator.token]) {
      const view = (await app.request(`${app.path}/resume`, {}, token)).state;
      assert.equal(view.game.roundSummary, undefined);
      for (const player of view.game.players) if (player.seat !== view.you) assert.equal(player.hand, undefined);
    }
  });
}

test('missing or estimated legacy identities do not fabricate table totals', () => {
  const { game } = finish(legacy, SCENARIOS[0].create());
  const room = { id: 'legacy-test', game, createdAt: 1, seats: game.players.map((_, seat) => ({ name: `当前${seat}`, tokenHash: `new-${seat}` })) };
  assert.ok(roundSummaryForRoom(room).players.every((player) => player.tableScore === null));
  room.gameMeta = { id: 'estimated', startedAtEstimated: true, participants: room.seats.map((person, seat) => ({ ...person, seat })) };
  assert.ok(roundSummaryForRoom(room).players.every((player) => player.tableScore === null));
});

for (const scenario of [SCENARIOS[3], SCENARIOS[4]]) {
  test(`${scenario.label}: estimated old identity remains unknown after real archive and subsequent round`, async () => {
    const { game: priorGame } = finish(scenario.engine, scenario.create());
    const app = await table(priorGame);
    const room = await app.store.get(app.id);
    // 用原兼容入口补旧身份，再用原归档/开局入口续局；不能靠手填档案绕过回归路径。
    // Backfill through the real legacy helper, then archive/start with existing helpers rather than hand-building history.
    delete room.gameMeta;
    ensureGameMetadata(room);
    assert.equal(room.gameMeta.startedAtEstimated, true);
    assert.ok(roundSummaryForRoom(room).players.every((player) => player.tableScore === null));
    room.archivedGames = [archiveFinishedGame(room)];
    assert.equal(room.archivedGames[0].meta.startedAtEstimated, true);
    room.game = scenario.create();
    room.gameMeta = newGameMetadata(room, 'recorded-following-round', 2);
    assert.equal(room.gameMeta.startedAtEstimated, undefined);
    room.game = finish(scenario.engine, room.game).game;
    const before = structuredClone(room);
    const ledgerBefore = tableScores(room);
    assert.ok(ledgerBefore.some((player) => player.totalScore !== 0), 'Use real nonzero scores so the defect cannot hide behind zero');
    const summary = roundSummaryForRoom(room);
    assert.ok(summary.players.every((player) => player.tableScore === null), 'Archiving cannot turn estimated historic identity into an exact total');
    assert.deepEqual(summary.players.map((player) => player.roundScore), room.game.players.map((player) => player.score));
    assert.deepEqual(tableScores(room), ledgerBefore, 'Do not rewrite the existing general ledger');
    assert.deepEqual(room, before, 'The summary remains read-only');
  });
}

test('estimated duplicate archive follows the original first-record precedence', async () => {
  const { game } = finish(flower, SCENARIOS[3].create());
  const app = await table(game);
  const room = await app.store.get(app.id);
  const recorded = archiveFinishedGame(room);
  recorded.meta.id = 'recorded-prior-round';
  const estimated = structuredClone(recorded);
  estimated.meta.startedAtEstimated = true;
  // 同ID/座位的后置副本不会参与账本；只有实际被计入的估计记录才使摘要累计不可确定。
  // Later copies of the same game/seat are ignored by the ledger; only a counted estimated record invalidates the total.
  room.archivedGames = [recorded, estimated];
  assert.deepEqual(roundSummaryForRoom(room).players.map((player) => player.tableScore), game.players.map((player) => player.score * 2));
  room.archivedGames = [estimated, recorded];
  assert.ok(roundSummaryForRoom(room).players.every((player) => player.tableScore === null));
});

test('missing archived score remains unknown rather than inheriting zero from the general ledger', async () => {
  const { game } = finish(flower, SCENARIOS[3].create());
  const app = await table(game);
  const room = await app.store.get(app.id);
  const archive = archiveFinishedGame(room);
  archive.meta.id = 'incomplete-prior-round';
  delete archive.game.players[1].score;
  room.archivedGames = [archive];
  const summary = roundSummaryForRoom(room);
  assert.equal(summary.players[1].tableScore, null);
  assert.equal(summary.players[0].tableScore, game.players[0].score * 2);
  // 若完整旧档先被计入，同ID的残缺副本不会改变既有去重后的累计。
  // If the complete archive was counted first, an incomplete duplicate with the same ID cannot alter that total.
  const complete = archiveFinishedGame(room);
  complete.meta.id = archive.meta.id;
  room.archivedGames.unshift(complete);
  assert.equal(roundSummaryForRoom(room).players[1].tableScore, game.players[1].score * 2);
  // 旧参与者身份缺失时不能证明不属于当前人，因此不把跳过该行后的部分合计说成完整累计。
  // Missing historical identity cannot be proven unrelated, so never report a partial sum as a complete total.
  delete complete.meta.participants[1].tokenHash;
  assert.ok(roundSummaryForRoom(room).players.every((player) => player.tableScore === null));
});

test('settled zero dragons is distinct from unavailable, without charging or recalculating on read', () => {
  const { game } = finish(flower, flower.createGame({ seed: 45, rules: { dragonStartCount: 20 } }));
  const summary = engineFor(game).roundSummary(game);
  assert.ok(summary.players.every((player) => player.dragons.status === 'settled' && player.dragons.count === 0));
  assert.ok(summary.players.every((player) => player.dragons.pointsPerOpponent === 0 && player.dragons.details.length === 0));
});

test('Chengdu retired winner remains private during blood battle and draw settlement enters final net exactly once', async () => {
  const initial = chengduGame({ options: { endCondition: 'bloodBattle', exchangeThree: false } });
  const won = chengdu.applyAction(initial, 0, { type: 'hu' });
  assert.notEqual(won.phase, 'finished');
  assert.equal(engineFor(won).roundSummary(won), null);
  const app = await table(won);
  const spectator = await app.request(`${app.path}/spectate`, {});
  assert.equal(spectator.state.game.roundSummary, undefined);
  assert.equal(spectator.state.game.players[0].won.tile, null);
  assert.equal(spectator.state.game.players[0].hand, undefined);
  const { game } = finish(chengdu, won, { preferHu: false });
  const summary = engineFor(game).roundSummary(game);
  assert.equal(game.finishReason, 'wallExhausted');
  assert.equal(game.drawSettlement.status, 'settled');
  assert.deepEqual(summary.players.map((player) => player.roundScore), game.players.map((player) => player.score));
  assert.equal(summary.players[0].huCount, 1);
  assert.equal(summary.players[0].wins[0].inHand, true);
});

test('FileStore restart preserves finished-only summary without recharging or storing projection data', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'round-summary-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { game } = finish(flower, SCENARIOS[3].create());
  const store = new FileStore(directory);
  const app = await table(game, store);
  const first = await app.request(`${app.path}/resume`, {}, app.tokens[0]);
  const saved = await store.get(app.id);
  const restored = new FileStore(directory);
  app.reload(restored);
  const resumed = await app.request(`${app.path}/resume`, {}, app.tokens[0]);
  assert.equal(resumed.status, 200);
  assert.deepEqual(resumed.state.game.roundSummary, first.state.game.roundSummary);
  assert.deepEqual((await restored.get(app.id)).game, saved.game);
  assert.equal((await restored.get(app.id)).game.roundSummary, undefined);
});
