// 新局展示隐私回归：真实引擎动作、HTTP 与历史均验证，不改变权威牌区/计分。
// New-game presentation privacy: verify real engine actions, HTTP and records without changing authority/scoring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, applyPresentedAction, continuePresentedGame, getPlayerView, assertGameInvariants } from '../shared/game.js';
import { postHuKongGame } from './fixtures/post-hu-kong.js';
import { recordsForProfile, archiveFinishedGame } from '../server/history.js';
import { createApi } from '../server/api.js';
import { MemoryStore } from '../server/store.js';
import { clipsForEvent } from '../src/character-audio.js';

// 用守恒夹具真正自摸，暂停在已结算、尚未续摸的展示段。
// Execute a real self-draw from a conserved fixture, paused after settlement and before continuation.
function settledWin(rules = {}) {
  const game = postHuKongGame({ winningDraw: true });
  Object.assign(game.rules, rules);
  return applyPresentedAction(game, 0, { type: 'hu' });
}

// 合成参与者仅用于历史授权测试；不存在生产身份或持久化外部数据。
// Synthetic participants exercise historical authorization without production identities or external writes.
function historyRoom(game) {
  const seats = [0, 1, 2].map((seat) => ({ name: `玩家${seat}`, tokenHash: `seat-${seat}`, playerHash: `profile-${seat}` }));
  return { id: 'synthetic', seats, game, createdAt: 1, updatedAt: 2,
    gameMeta: { id: 'test-game', startedAt: 1, participants: seats.map((person, seat) => ({ ...person, seat })) } };
}

test('live self-drawn wins hide every duplicate reference and breakdown, retaining owner data and authority', () => {
  const game = settledWin();
  const event = game.history.find((item) => item.type === 'hu');
  // 模拟未来/旧版计分字段，证明不是只删除目前已知的几个牌数字段。
  // Simulate future/legacy scoring metadata to prove the filter does not merely remove known count fields.
  event.score.handCounts = { privateProbe: 'private-score-marker' };
  event.futurePrivateMetadata = 'private-event-marker';
  game.players[0].lastScoreBreakdown = structuredClone(event.score);
  const authority = structuredClone(game);
  const owner = getPlayerView(game, 0);
  assert.equal(owner.players[0].winPile.at(-1).tile, event.tile);
  assert.deepEqual(owner.history, game.history);
  assert.deepEqual(owner.scoreBreakdown, event.score);
  for (const seat of [1, 2]) {
    const view = getPlayerView(game, seat);
    assert.equal(view.players[0].hand, undefined);
    assert.equal(view.drawnTile, null);
    assert.equal(view.players[0].lastScoreBreakdown.total, event.score.total);
    assert.equal(view.players[0].lastScoreBreakdown.handCounts, undefined);
    assert.ok(view.players[0].winPile.every((win) => win.tile === null && win.hidden));
    assert.ok(view.retiredTiles.every((win) => win.tile === null && win.hidden));
    const hidden = view.history.find((item) => item.type === 'hu');
    assert.equal(hidden.tile, null);
    assert.equal(hidden.score.total, event.score.total);
    assert.equal(hidden.score.handCounts, undefined);
    assert.equal(hidden.hidden, true);
    assert.ok(!hidden.message.includes('1筒'));
    assert.equal(JSON.stringify(view).includes('private-'), false);
    assert.deepEqual(hidden.payments, event.payments);
    assert.deepEqual(clipsForEvent(hidden), clipsForEvent(event));
    const record = recordsForProfile(historyRoom(game), `profile-${seat}`)[0];
    assert.equal(record.events.find((item) => item.type === 'hu').tile, null);
    assert.equal(JSON.stringify(record).includes('private-'), false);
  }
  assert.deepEqual(game, authority);
  assertGameInvariants(game);
});

test('continuation draw is distinct from hidden winning tile; repeated self-draw and finish reveal correctly', () => {
  let game = continuePresentedGame(settledWin());
  assert.equal(game.phase, 'turn');
  assert.equal(getPlayerView(game, 0).drawnTile, game.lastDraw.tile);
  assert.equal(getPlayerView(game, 1).drawnTile, null);
  game = applyPresentedAction(game, 0, { type: 'hu' });
  assert.equal(getPlayerView(game, 2).players[0].winPile.length, 3);
  assert.ok(getPlayerView(game, 2).players[0].winPile.every((win) => win.hidden));
  // 仅切换展示阶段来检查结束投影；权威终局结算另由现有引擎测试覆盖。
  // Switch only the phase to test finished projection; existing engine suites cover authoritative final settlement.
  const finished = { ...game, phase: 'finished' };
  for (const seat of [0, 1, 2]) {
    const view = getPlayerView(finished, seat);
    assert.deepEqual(view.players[0].winPile, game.players[0].winPile);
    assert.deepEqual(view.retiredTiles, game.retiredTiles);
    assert.deepEqual(view.history, game.history);
    assert.deepEqual(recordsForProfile(historyRoom(finished), `profile-${seat}`)[0].events, game.history);
  }
  assert.deepEqual(archiveFinishedGame(historyRoom(finished)).game.history, game.history);
});

test('concealed and extended kong faces are public, while missing/false flags retain saved visibility', () => {
  const game = applyPresentedAction(postHuKongGame({ type: 'anGang' }), 0, { type: 'anGang', tile: 0 });
  for (const seat of [0, 1, 2]) assert.deepEqual(getPlayerView(game, seat).players[0].melds[0].tiles, [0, 0, 0, 0]);
  for (const flag of [false, undefined]) {
    const old = settledWin();
    if (flag === undefined) {
      delete old.rules.hideSelfDrawWins;
      delete old.rules.publicConcealedKongs;
    } else {
      old.rules.hideSelfDrawWins = false;
      old.rules.publicConcealedKongs = false;
    }
    const before = structuredClone(old);
    assert.deepEqual(getPlayerView(old, 1).players[0].winPile, old.players[0].winPile);
    assert.deepEqual(getPlayerView(old, 1).history, old.history);
    // 此夹具已有碰；另一个守恒夹具提供已成立的加长暗杠。
    // This fixture has a peng; a second conserved fixture supplies an established extended concealed kong.
    const kong = postHuKongGame({ type: 'addGang' });
    kong.rules.publicConcealedKongs = flag;
    assert.ok(getPlayerView(kong, 1).players[0].melds[0].tiles.every((tile) => tile === null));
    assert.deepEqual(old, before);
  }
  for (const key of ['hideSelfDrawWins', 'publicConcealedKongs']) {
    assert.throws(() => createGame({ rules: { [key]: 'true' } }), /必须为布尔值/);
  }
});

test('HTTP owner, both opponents and reconnect receive independently filtered room and seat snapshots', async () => {
  const store = new MemoryStore();
  let api = createApi(store);
  const tokens = [];
  const profileTokens = [];
  // 通过真实路由获得独立的座位/个人凭证，模拟服务重启仍使用同一内存存储。
  // Obtain separate seat/profile credentials through real routes; restart the handler over the same store.
  async function request(path, seat, body, profile = false) {
    const response = await api(new Request(`https://privacy.test/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: seat === undefined ? {} : { authorization: `Bearer ${profile ? profileTokens[seat] : tokens[seat]}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    assert.ok([200, 201].includes(response.status), `${path}: ${response.status}`);
    return response.json();
  }
  for (const seat of [0, 1, 2]) profileTokens[seat] = (await request('profile', undefined, {})).token;
  const created = await request('rooms', undefined, { name: '东', profileToken: profileTokens[0] });
  const id = created.roomId;
  tokens[0] = created.token;
  for (const seat of [1, 2]) tokens[seat] = (await request(`rooms/${id}/join`, undefined, { name: `玩家${seat}`, profileToken: profileTokens[seat] })).token;
  const lobby = await request(`rooms/${id}`, 0);
  await request(`rooms/${id}/start`, 0, { revision: lobby.state.revision });
  const room = await store.get(id);
  room.game = settledWin();
  await store.compareAndSwap(room, room.revision);
  api = createApi(store);
  for (const seat of [0, 1, 2]) {
    const { state } = await request(`rooms/${id}`, seat);
    assert.equal(state.game.players[0].winPile.at(-1).tile, seat === 0 ? 9 : null);
    assert.equal(state.seats[0].winPile.at(-1).tile, seat === 0 ? 9 : null);
    const history = await request('profile/history', seat, undefined, true);
    assert.ok(JSON.stringify(history).includes('selfDraw'));
    if (seat !== 0) assert.ok(JSON.stringify(history).includes('牌面隐藏'));
  }
});

test('UI masks tile faces, announcements and win tooltips while still presenting hidden hu events', () => {
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8');
  assert.match(app, /:tile="win.tile" :back="win.hidden"/);
  assert.match(app, /:tile="event.tile" :back="event.hidden"/);
  assert.match(app, /if \(win.hidden\) return '自摸 · 牌面隐藏，终局公开'/);
  assert.match(app, /event.type === 'hu' && \(event.hidden === true/);
});

// 两种展示策略产生完全相同的权威牌区和积分；唯一差别是开局保存的视图开关。
// Both display policies produce identical authority and scores; only the saved view flags differ.
test('visibility snapshots never change authoritative settlement or continuation', () => {
  const current = continuePresentedGame(settledWin());
  const historical = continuePresentedGame(settledWin({ hideSelfDrawWins: false, publicConcealedKongs: false }));
  historical.rules = structuredClone(current.rules);
  assert.deepEqual(current, historical);
});

// 已保存的新策略摸牌记录可能带有旧字段；房间和个人历史都不能从文案或元数据泄露。
// Saved opt-in draw records may contain legacy fields; neither room nor profile history may leak prose/metadata.
test('opponent draw metadata and prose cannot bypass live snapshot privacy', () => {
  const game = settledWin();
  game.history.push({ revision: game.revision, type: 'draw', seat: 0, source: 'continuation',
    tile: 9, message: 'private-draw-marker', privateMetadata: 'private-draw-marker' });
  const before = structuredClone(game);
  for (const seat of [1, 2]) {
    assert.equal(JSON.stringify(getPlayerView(game, seat)).includes('private-draw-marker'), false);
    assert.equal(JSON.stringify(recordsForProfile(historyRoom(game), `profile-${seat}`)).includes('private-draw-marker'), false);
  }
  assert.deepEqual(getPlayerView(game, 0).history, game.history);
  assert.deepEqual(game, before);
});

// 来源番和公开摘要保留，含牌种的未知字段与恶意类型不在白名单内。
// Preserve event-source fan and public summaries, excluding unknown tile fields and malformed types.
test('public score allowlist retains source fan labels but rejects unknown and nested private metadata', async () => {
  const { visibleScoreSummary } = await import('../shared/tile-visibility.js');
  const score = { fan: 4, total: 8, kongReplacementBonus: 1, kongDiscardBonus: 1, robKongBonus: 1,
    bigSingle: false, sevenPairsFixed: false, overlapPolicy: 'fan', specialHuPattern: null,
    patternBonuses: [{ type: 'kongReplacement', fan: 1, tile: 9 }, { type: 'kongDiscard', fan: 1 },
      { type: 'robKong', fan: 1 }, { type: 'private-pattern-marker', fan: 1 }, { type: 'pureSuit', fan: '9筒' }],
    handCounts: [1, 2], waits: [9], futureMetadata: { tile: 9 }, base: '9筒', radishBonus: { tile: 9 } };
  assert.deepEqual(visibleScoreSummary(score), { fan: 4, total: 8, kongReplacementBonus: 1, kongDiscardBonus: 1,
    robKongBonus: 1, bigSingle: false, sevenPairsFixed: false, overlapPolicy: 'fan', specialHuPattern: null,
    patternBonuses: [{ type: 'kongReplacement', fan: 1 }, { type: 'kongDiscard', fan: 1 }, { type: 'robKong', fan: 1 }] });
});
