// 真实协调协议测试：独立页面共享锁和存储，逐事件返回明确结果而非 void 成功桩。
// Protocol tests: independent pages share locks/storage and return explicit per-event outcomes, never void-success stubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SharedPlaybackCoordinator } from '../src/shared-playback.js';
import { CharacterAudio } from '../src/character-audio.js';

// 注入浏览器设施，不依赖实际扬声器；每个锁名具有独立FIFO。
// Inject browser facilities without speakers; each lock name has its own FIFO.
function browser() {
  const values = new Map();
  const tails = new Map();
  return {
    storage: { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
    locks: { request(key, callback) {
      const pending = (tails.get(key) || Promise.resolve()).then(callback);
      tails.set(key, pending.catch(() => {}));
      return pending;
    } },
    ledger: () => JSON.parse([...values.values()][0]),
  };
}
function snapshot(count, revision = count) {
  return { id: 'synthetic-room', you: 0, revision, game: { id: 'round', history:
    Array.from({ length: count }, (_, index) => ({ type: 'discard', seat: 0, tile: index % 18, privateSentinel: 'never-store' })),
  } };
}
function event(index) { return { eventKey: `synthetic-room:round:${index}` }; }
function player(shared, pageId, calls, extra = {}) {
  return new SharedPlaybackCoordinator({ ...shared, pageId, retryWindowMs: 55,
    play: async (events) => { calls.push(...events.map((entry) => `${pageId}:${entry.index}`));
      return { events: events.map((entry) => ({ eventKey: entry.eventKey, status: 'success' })) }; }, ...extra });
}

test('later baseline B reconstructs missing 1 before 2 while A receives both late', async () => {
  const shared = browser(); const calls = [];
  const a = player(shared, 'a', calls); const b = player(shared, 'b', calls);
  await a.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  await b.registerSnapshot(snapshot(1), { baseline: true, eligible: true });
  const newer = b.registerSnapshot(snapshot(2), { eligible: true });
  await b.playThrough(newer, [event(1)]);
  const delayed = a.registerSnapshot(snapshot(2), { eligible: true });
  await a.playThrough(delayed, [event(0), event(1)]);
  assert.deepEqual(calls, ['b:0', 'b:1']);
  assert.equal(JSON.stringify(shared.ledger()).includes('never-store'), false);
});

test('actual failed CharacterAudio fetch is recovered by healthy sibling before later event', async () => {
  const shared = browser(); const calls = [];
  // 使用真实音频类的 fetch/decode/onended 路径，证明 success 必须来自正常结束。
  // Exercise real audio fetch/decode/onended: success must originate from natural completion.
  function audio(pageId, fail) {
    const media = new CharacterAudio({ fetchAudio: async () => {
      if (fail) throw new Error('download failure');
      return { ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: async () => ({ duration: 0.01 }) };
    } });
    media.unlocked = true;
    media.context = { state: 'running', destination: {}, close() {}, decodeAudioData: async (bytes) => bytes,
      createBufferSource: () => ({ connect() {}, disconnect() {}, stop() {}, start() {
        calls.push(pageId); queueMicrotask(() => this.onended?.());
      } }),
    };
    return media;
  }
  const failedAudio = audio('a', true); const healthyAudio = audio('b', false);
  const a = player(shared, 'a', calls, { play: (events) => failedAudio.enqueueOrdered(events) });
  const b = player(shared, 'b', calls, { play: (events) => healthyAudio.enqueueOrdered(events) });
  await a.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  await b.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  const receiptA = await a.registerSnapshot(snapshot(2), { eligible: true });
  const receiptB = await b.registerSnapshot(snapshot(2), { eligible: true });
  await Promise.all([a.playThrough(receiptA, [event(1)]), b.playThrough(receiptB, [event(1)])]);
  assert.deepEqual(calls, ['b', 'b']);
  assert.equal(shared.ledger().outcomes[0].status, 'success');
  failedAudio.dispose(); healthyAudio.dispose();
});

test('failed head has bounded terminal failure; late sibling never plays it after event 2', async () => {
  const shared = browser(); const calls = [];
  const a = player(shared, 'a', calls, { play: async (events) => {
    calls.push(events[0].index);
    return { events: [{ eventKey: events[0].eventKey, status: events[0].index === 0 ? 'failed' : 'success' }] };
  } });
  await a.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  await a.playThrough(a.registerSnapshot(snapshot(2), { eligible: true }), [event(1)]);
  assert.deepEqual(calls, [0, 1]);
  assert.deepEqual(shared.ledger().outcomes[0].status, 'failed');
  assert.equal(shared.ledger().outcomes[0].terminal, true);
  const b = player(shared, 'b', calls);
  await b.playThrough(b.registerSnapshot(snapshot(2), { eligible: true }), [event(1)]);
  assert.deepEqual(calls, [0, 1]);
});

test('mute at receipt never revives locally, but eligible sibling can play both', async () => {
  const shared = browser(); const calls = [];
  const a = player(shared, 'a', calls); const b = player(shared, 'b', calls);
  await a.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  await b.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  const muted = a.registerSnapshot(snapshot(2), { eligible: false });
  await a.playThrough(muted, [event(0), event(1)]);
  await b.playThrough(b.registerSnapshot(snapshot(2), { eligible: true }), [event(1)]);
  await a.playThrough(a.registerSnapshot(snapshot(3), { eligible: true }), [event(2)]);
  assert.deepEqual(calls, ['b:0', 'b:1', 'a:2']);
});

test('cancel stops this page and invalidates queued tickets without taking sibling eligibility', async () => {
  const shared = browser(); const calls = []; let stopped = 0;
  const a = player(shared, 'a', calls, { cancelAudio: () => stopped++ });
  const b = player(shared, 'b', calls);
  await a.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  await b.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  const old = await a.registerSnapshot(snapshot(1), { eligible: true });
  a.cancel();
  await a.playThrough(old, [event(0)]);
  await b.playThrough(b.registerSnapshot(snapshot(1), { eligible: true }), [event(0)]);
  assert.equal(stopped, 1); assert.deepEqual(calls, ['b:0']);
});

test('legacy boundary advances floor, stale snapshots cannot roll it backward', async () => {
  const shared = browser(); const calls = []; const a = player(shared, 'a', calls);
  await a.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  await a.registerSnapshot(snapshot(2), { baseline: true, legacy: true, eligible: true });
  assert.equal(await a.registerSnapshot(snapshot(1), { eligible: true }), null);
  await a.playThrough(a.registerSnapshot(snapshot(3), { eligible: true }), [event(2)]);
  assert.deepEqual(calls, ['a:2']);
});

test('storage denial explicitly degrades, while void results never become success', async () => {
  const modes = []; const calls = [];
  const a = player({ locks: browser().locks, storage: { getItem() { throw new Error('denied'); } } }, 'a', calls,
    { onDegraded: (mode) => modes.push(mode), play: async () => undefined });
  await a.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  await a.playThrough(a.registerSnapshot(snapshot(1), { eligible: true }), [event(0)]);
  assert.deepEqual(modes, ['page-local']);
  assert.equal([...a.localRecords.values()][0].outcomes[0].status, 'failed');
});

test('same-history unmute cannot revive muted receipt; later new event still speaks', async () => {
  const shared = browser(); const calls = []; const a = player(shared, 'a', calls);
  await a.registerSnapshot(snapshot(0), { baseline: true, eligible: false });
  const muted = await a.registerSnapshot(snapshot(2), { eligible: false });
  await a.playThrough(muted, [event(0), event(1)]);
  const unmuted = await a.registerSnapshot(snapshot(2, 3), { eligible: true });
  await a.playThrough(unmuted, [event(0), event(1)]);
  await a.playThrough(a.registerSnapshot(snapshot(3, 4), { eligible: true }), [event(2)]);
  assert.deepEqual(calls, ['a:2']);
});

test('explicit skip excludes local backlog but preserves healthy sibling opportunity', async () => {
  const shared = browser(); const calls = []; const a = player(shared, 'a', calls); const b = player(shared, 'b', calls);
  await a.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  await b.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  const skipped = await a.registerSnapshot(snapshot(2), { eligible: true, skip: true });
  await a.playThrough(skipped, [event(1)]);
  await b.playThrough(b.registerSnapshot(snapshot(2), { eligible: true }), [event(1)]);
  assert.deepEqual(calls, ['b:0', 'b:1']);
});

test('ordinary long-gap receipt preserves established shared prefix', async () => {
  const shared = browser(); const calls = []; let time = 0;
  const a = player(shared, 'a', calls, { now: () => time });
  await a.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  const queued = await a.registerSnapshot(snapshot(2), { eligible: true });
  time = 60000;
  await a.registerSnapshot(snapshot(2, 3), { eligible: true });
  await a.playThrough(queued, [event(1)]);
  assert.deepEqual(calls, ['a:0', 'a:1']);
});

test('two winners retain first success and recover only failed second winner', async () => {
  const shared = browser(); const calls = [];
  const winSnapshot = snapshot(2);
  winSnapshot.game.history = [0, 1].map((seat) => ({ type: 'hu', source: 'discard', seat, tile: 3 }));
  const a = player(shared, 'a', calls, { play: async (events) => {
    calls.push(`a:${events[0].index}`);
    return { events: [{ eventKey: events[0].eventKey, status: events[0].index === 0 ? 'success' : 'failed' }] };
  } });
  const b = player(shared, 'b', calls);
  await a.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  await b.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  const receiptA = await a.registerSnapshot(winSnapshot, { eligible: true });
  const receiptB = await b.registerSnapshot(winSnapshot, { eligible: true });
  await Promise.all([a.playThrough(receiptA, [event(0), event(1)]), b.playThrough(receiptB, [event(0), event(1)])]);
  assert.deepEqual(calls, ['a:0', 'a:1', 'b:1']);
});

test('twenty muted events share one receipt deadline rather than twenty sequential waits', async () => {
  const shared = browser(); const calls = []; let time = 0;
  const a = player(shared, 'a', calls, { now: () => time });
  await a.registerSnapshot(snapshot(0), { baseline: true, eligible: false });
  await a.registerSnapshot(snapshot(20), { eligible: false });
  // 一次推进越过整批截止时间；如果每条单独创建截止，此测试会永远等待而被测试超时捕获。
  // One clock advance expires the whole batch; per-event deadlines would hang and be caught by the test timeout.
  time = 100;
  await a.playThrough(a.registerSnapshot(snapshot(21), { eligible: true }), [event(20)]);
  assert.deepEqual(calls, ['a:20']);
  assert.equal(Object.values(shared.ledger().outcomes).filter((outcome) => outcome.status === 'skipped').length, 20);
});

test('cancel during audio then new game registration cannot overwrite new-game ledger', async () => {
  const shared = browser(); const calls = []; let finish; let began;
  const started = new Promise((resolve) => { began = resolve; });
  const a = player(shared, 'a', calls, { play: (events) => new Promise((resolve) => {
    finish = () => resolve({ events: [{ eventKey: events[0].eventKey, status: 'cancelled' }] }); began();
  }), cancelAudio: () => finish?.() });
  await a.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  const pending = a.playThrough(a.registerSnapshot(snapshot(1), { eligible: true }), [event(0)]);
  await started;
  a.cancel();
  const next = snapshot(0, 2); next.game.id = 'new-round';
  await a.registerSnapshot(next, { baseline: true, eligible: true });
  await pending;
  assert.equal(shared.ledger().gameId, 'new-round');
  assert.deepEqual(shared.ledger().outcomes, {});
});

test('no WebLocks fallback serializes registrations and audio without self-deadlock', async () => {
  const calls = []; const modes = [];
  const a = player({ storage: browser().storage, locks: null }, 'a', calls, { onDegraded: (mode) => modes.push(mode) });
  // 不等待基线就连续收取两次快照，符合真实 App 同一轮微任务的调用方式。
  // Receive successive snapshots without awaiting the baseline, matching App calls within one microtask turn.
  const baseline = a.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  const first = a.registerSnapshot(snapshot(1), { eligible: true });
  const second = a.registerSnapshot(snapshot(2), { eligible: true });
  await Promise.all([baseline, a.playThrough(first, [event(0)]), a.playThrough(second, [event(1)])]);
  assert.deepEqual(calls, ['a:0', 'a:1']);
  assert.deepEqual(modes, ['page-local']);
});

test('cancelled asynchronous baseline cannot swallow a later live suffix', async () => {
  const calls = []; const a = player({ storage: null, locks: null }, 'a', calls);
  const baseline = a.registerSnapshot(snapshot(1), { baseline: true, legacy: true, eligible: true });
  // 同步取消先于基线锁回调；旧历史归取消，新后缀仍属于后续有效票据。
  // Synchronous cancellation precedes the baseline lock callback; only old history is cancelled, not the next valid suffix.
  a.cancel();
  const next = a.registerSnapshot(snapshot(2), { eligible: true });
  await baseline;
  await a.playThrough(next, [event(1)]);
  assert.deepEqual(calls, ['a:1']);
});

test('new tab after expired leases cannot erase foreground offline page received backlog', async () => {
  const shared = browser(); const calls = []; let time = 0;
  const a = player(shared, 'a', calls, { now: () => time });
  const b = player(shared, 'b', calls, { now: () => time });
  await a.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  const queued = await a.registerSnapshot(snapshot(1), { eligible: true });
  // A保持前台，但网络停止一分钟；B首次打开时已有更新历史，不能假设A已离开。
  // A remains foreground through a minute-long transport gap; B's newer baseline cannot assume A has departed.
  time = 60000;
  await b.registerSnapshot(snapshot(2), { baseline: true, eligible: true });
  assert.equal(shared.ledger().floor, 0);
  await a.playThrough(queued, [event(0)]);
  await b.playThrough(b.registerSnapshot(snapshot(3), { eligible: true }), [event(2)]);
  assert.deepEqual(calls, ['a:0', 'b:1', 'b:2']);
});

test('reopen baseline alone is silent and later live event recovers only nonterminal prefix', async () => {
  const shared = browser(); const calls = []; let time = 0;
  const a = player(shared, 'a', calls, { now: () => time });
  await a.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  await a.playThrough(a.registerSnapshot(snapshot(1), { eligible: true }), [event(0)]);
  await a.registerSnapshot(snapshot(2), { eligible: true });
  a.cancel();
  // 无可靠的“所有页已关闭”信号，保守保留未完成项；新页仅基线不自动播放。
  // Without a reliable all-pages-closed signal, retain unfinished entries conservatively; baseline registration itself never plays.
  time = 60000;
  const reopened = player(shared, 'reopened', calls, { now: () => time });
  await reopened.registerSnapshot(snapshot(2), { baseline: true, eligible: true });
  assert.deepEqual(calls, ['a:0']);
  await reopened.playThrough(reopened.registerSnapshot(snapshot(3), { eligible: true }), [event(2)]);
  assert.deepEqual(calls, ['a:0', 'reopened:1', 'reopened:2']);
});

test('forty hidden shared-prefix voices are counted outside the local batch and cancelled immediately', async () => {
  const shared = browser(); const counts = []; const calls = [];
  const earlier = player(shared, 'earlier', calls);
  await earlier.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  let finish; let started;
  const began = new Promise((resolve) => { started = resolve; });
  const later = player(shared, 'later', calls, {
    onPendingPrefix: (count) => counts.push(count),
    play: (events) => new Promise((resolve) => {
      finish = () => resolve({ events: [{ eventKey: events[0].eventKey, status: 'cancelled' }] });
      started();
    }),
    cancelAudio: () => finish?.(),
  });
  await later.registerSnapshot(snapshot(40), { baseline: true, eligible: true });
  const pending = later.playThrough(later.registerSnapshot(snapshot(41), { eligible: true }), [event(40)]);
  await began;
  assert.equal(counts.at(-1), 40);
  later.cancel();
  assert.equal(counts.at(-1), 0);
  await pending;
  assert.equal(counts.at(-1), 0);
});

test('shared prefix count decreases after outcomes and excludes current double-win batch', async () => {
  const shared = browser(); const counts = []; const calls = [];
  const a = player(shared, 'a', calls, { onPendingPrefix: (count) => counts.push(count) });
  await a.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  await a.playThrough(a.registerSnapshot(snapshot(4), { eligible: true }), [event(2), event(3)]);
  assert.equal(counts[0], 2);
  assert.ok(counts.includes(1));
  assert.equal(counts.at(-1), 0);
});

test('late old-generation completion cannot clear new room prefix count', async () => {
  const shared = browser(); const counts = []; const calls = []; const completions = new Map();
  const a = player(shared, 'a', calls, {
    onPendingPrefix: (count) => counts.push(count),
    play: (events) => new Promise((resolve) => completions.set(events[0].eventKey,
      () => resolve({ events: [{ eventKey: events[0].eventKey, status: 'cancelled' }] }))),
  });
  await a.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  const old = a.playThrough(a.registerSnapshot(snapshot(2), { eligible: true }), [event(1)]);
  for (let turn = 0; turn < 30; turn++) await Promise.resolve();
  assert.equal(counts.at(-1), 1);
  a.cancel();
  const nextBase = snapshot(0); nextBase.id = 'other-room';
  await a.registerSnapshot(nextBase, { baseline: true, eligible: true });
  const next = snapshot(3); next.id = 'other-room';
  const fresh = a.playThrough(a.registerSnapshot(next, { eligible: true }), [{ eventKey: 'other-room:round:2' }]);
  for (let turn = 0; turn < 30; turn++) await Promise.resolve();
  assert.equal(counts.at(-1), 2);
  completions.get('synthetic-room:round:0')();
  await old;
  assert.equal(counts.at(-1), 2);
  a.cancel();
  completions.get('other-room:round:0')();
  await fresh;
  assert.equal(counts.at(-1), 0);
});

test('initial locked sibling baseline can recover earlier prefix after unlock and next live event', async () => {
  const shared = browser(); const calls = []; let time = 0;
  const a = player(shared, 'a', calls, { now: () => time });
  const b = player(shared, 'b', calls, { now: () => time });
  await a.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  const lockedBaseline = await b.registerSnapshot(snapshot(1), { baseline: true, eligible: false });
  await b.playThrough(lockedBaseline, [event(0)]);
  assert.deepEqual(calls, []);
  // B解锁后先收到事件2；A传输延迟20秒，B应代播1→2而不能把1永久标记为skipped。
  // B unlocks and receives event 2 while A is delayed for 20 seconds; B must recover 1→2, not permanently skip 1.
  time = 20000;
  await b.playThrough(b.registerSnapshot(snapshot(2), { eligible: true }), [event(1)]);
  await a.playThrough(a.registerSnapshot(snapshot(2), { eligible: true }), [event(0), event(1)]);
  assert.deepEqual(calls, ['b:0', 'b:1']);
  assert.equal(shared.ledger().outcomes[0].status, 'success');
});

test('muted suffix received after first locked baseline remains denied after unlock', async () => {
  const shared = browser(); const calls = []; let time = 0;
  const a = player(shared, 'a', calls, { now: () => time });
  const b = player(shared, 'b', calls, { now: () => time });
  await a.registerSnapshot(snapshot(0), { baseline: true, eligible: true });
  await b.registerSnapshot(snapshot(1), { baseline: true, eligible: false });
  await b.registerSnapshot(snapshot(2), { eligible: false });
  time = 20000;
  await b.playThrough(b.registerSnapshot(snapshot(3), { eligible: true }), [event(2)]);
  assert.deepEqual(calls, ['b:0', 'b:2']);
  assert.equal(shared.ledger().outcomes[1].status, 'skipped');
});
