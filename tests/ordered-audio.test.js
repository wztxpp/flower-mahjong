// 验证真实 CharacterAudio 的保序入口；只替换浏览器音频设备与网络，不替换队列逻辑。
// Exercise the real ordered CharacterAudio API, substituting only browser audio and networking.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CharacterAudio, clipsForEvent } from '../src/character-audio.js';

// 可控音源不会自动结束，让测试明确检查每个完成屏障、取消和串行顺序。
// Controllable sources do not auto-end, exposing completion barriers, cancellation and serial order.
function fixture(options = {}) {
  const played = [];
  const sources = [];
  const context = {
    state: 'running', sampleRate: 24000, destination: {},
    resume: async () => {}, close() {}, createBuffer: () => 'silent',
    decodeAudioData: async (bytes) => bytes,
    createBufferSource() {
      const source = {
        connect() {},
        start() { played.push(this.buffer); },
        stop() { this.stopped = true; },
        disconnect() { this.disconnected = true; },
      };
      sources.push(source);
      return source;
    },
  };
  const engine = new CharacterAudio({
    createContext: () => context,
    fetchAudio: async (url) => ({
      ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: async () => url,
    }),
    ...options,
  });
  return { engine, context, played, sources };
}
// 推进微任务和模拟网络，保留播放结束由断言显式控制。
// Flush microtasks and simulated networking while keeping playback completion explicit.
const tick = () => new Promise((resolve) => setImmediate(resolve));
const events = (...urls) => urls.map((url) => ({ type: 'discard', eventKey: `game:${url}`, urls: [url] }));

// 两批同时入队，不挑最新或胡牌；前批完成不能释放后批的独立 Promise。
// Concurrent batches retain all events without latest/win selection and settle independently.
test('ordered batches retain every event and wait for actual ends', async () => {
  const { engine, sources, played } = fixture();
  await engine.unlock();
  let firstDone = false;
  let secondDone = false;
  const first = engine.enqueueOrdered([
    ...events('discard'), { type: 'hu', urls: ['hu', 'extra'] }, ...events('peng'),
  ]).then(() => { firstDone = true; });
  const second = engine.enqueueOrdered(events('gang')).then(() => { secondDone = true; });
  for (const [index, url] of ['discard', 'hu', 'extra', 'peng', 'gang'].entries()) {
    await tick();
    assert.equal(played.at(-1), url);
    assert.equal(firstDone, index === 4);
    assert.equal(secondDone, false);
    sources.at(-1).onended();
  }
  await Promise.all([first, second]);
  assert.deepEqual(played, ['silent', 'discard', 'hu', 'extra', 'peng', 'gang']);
  engine.dispose();
});

// 冷下载超过旧 650ms 窗口仍正常开始；后批也不因排队六秒而过期。
// Cold downloads beyond 650ms still play, and queued batches do not expire after six seconds.
test('ordered cold loading and queue age have no legacy expiry', async () => {
  let now = 0;
  let finish;
  const { engine, sources, played } = fixture({ now: () => now });
  await engine.unlock();
  const originalFetch = engine.fetchAudio;
  engine.fetchAudio = async (url) => {
    if (url === 'cold') await new Promise((resolve) => { finish = resolve; });
    return originalFetch(url);
  };
  const first = engine.enqueueOrdered(events('cold'));
  const second = engine.enqueueOrdered(events('queued'));
  await tick();
  now = 900;
  finish();
  await tick();
  assert.equal(played.at(-1), 'cold');
  now = 10000;
  sources.at(-1).onended();
  await first;
  await tick();
  assert.equal(played.at(-1), 'queued');
  sources.at(-1).onended();
  await second;
  engine.dispose();
});

// 双胡使用实际路径；任一赢家下载失败都只跳自己，不能吞掉另一位。
// Two winners use actual clip paths; either failed download skips only that winner.
test('ordered double wins isolate failure in either winner', async () => {
  for (const failedSeat of [0, 1, null]) {
    const { engine, sources, played } = fixture();
    await engine.unlock();
    const winners = [0, 1].map((seat) => {
      const event = { type: 'hu', seat, source: 'discard' };
      return { ...event, eventKey: `room:game:${seat}`, urls: clipsForEvent(event) };
    });
    const originalFetch = engine.fetchAudio;
    engine.fetchAudio = (url) => {
      if (failedSeat !== null && url === winners[failedSeat].urls[0]) throw new Error('missing');
      return originalFetch(url);
    };
    const completion = engine.enqueueOrdered(winners);
    for (const winner of winners.filter((event) => event.seat !== failedSeat)) {
      await tick();
      assert.equal(played.at(-1), winner.urls[0]);
      sources.at(-1).onended();
    }
    assert.deepEqual(await completion, {
      events: winners.map((event) => ({
        eventKey: event.eventKey,
        status: event.seat === failedSeat ? 'failed' : 'success',
      })),
    });
    assert.equal(played.length, failedSeat === null ? 3 : 2);
    engine.dispose();
  }
});

// 失败仅作用于该片段；解码、启动失败之后仍可播放同批后段和下一批。
// Decode/start failures affect only one clip; remaining clips and later batches still play.
test('ordered decoding and start failures continue later clips', async () => {
  for (const failure of ['decode', 'start']) {
    const { engine, context, sources, played } = fixture();
    await engine.unlock();
    if (failure === 'decode') context.decodeAudioData = async (bytes) => {
      if (bytes === 'bad') throw new Error('decode failed');
      return bytes;
    };
    else {
      const create = context.createBufferSource;
      context.createBufferSource = () => {
        const source = create();
        const start = source.start;
        source.start = function () {
          if (this.buffer === 'bad') throw new Error('start failed');
          start.call(this);
        };
        return source;
      };
    }
    const completion = engine.enqueueOrdered(events('bad', 'good'));
    await tick();
    assert.equal(played.at(-1), 'good');
    sources.at(-1).onended();
    assert.deepEqual(await completion, { events: [
      { eventKey: 'game:bad', status: 'failed' },
      { eventKey: 'game:good', status: 'success' },
    ] });
    assert.equal(engine.running, false);
    engine.dispose();
  }
});

// 取消不依赖 onended；清理旧代后立即排新批，不能因旧消费者锁而悬挂。
// Cancellation never relies on onended; immediately queued replacement work cannot hang on an old consumer lock.
test('ordered clear settles every batch and immediately accepts a new generation', async () => {
  for (const loading of [false, true]) {
    const { engine, sources, played } = fixture();
    await engine.unlock();
    const originalFetch = engine.fetchAudio;
    engine.fetchAudio = (url) => loading && url === 'old' ? new Promise(() => {}) : originalFetch(url);
    const old = engine.enqueueOrdered(events('old', 'never'));
    const queued = engine.enqueueOrdered(events('also-never'));
    await tick();
    const oldSource = sources.at(-1);
    engine.clear();
    const fresh = engine.enqueueOrdered(events('fresh'));
    assert.deepEqual(await old, { events: [
      { eventKey: 'game:old', status: 'cancelled' },
      { eventKey: 'game:never', status: 'cancelled' },
    ] });
    assert.deepEqual(await queued, { events: [
      { eventKey: 'game:also-never', status: 'cancelled' },
    ] });
    await tick();
    assert.equal(played.at(-1), 'fresh');
    assert.ok(!played.includes('never') && !played.includes('also-never'));
    if (!loading) {
      assert.equal(oldSource.stopped, true);
      assert.equal(oldSource.disconnected, true);
    }
    sources.at(-1).onended();
    await fresh;
    assert.equal(engine.running, false);
    engine.dispose();
  }
});

// 静音、锁定、销毁都取消整批，恢复后不重播当时被跳过的事件。
// Mute, lock and disposal cancel whole batches; recovery never replays skipped input.
test('ordered mute lock and dispose cancel without replay', async () => {
  for (const action of ['mute', 'lock', 'dispose']) {
    const { engine, context, played } = fixture();
    assert.equal((await engine.enqueueOrdered(events('before-unlock'))).events[0].status, 'skipped');
    await engine.unlock();
    const completion = engine.enqueueOrdered(events('active', 'queued'));
    await tick();
    if (action === 'mute') engine.setMuted(true);
    if (action === 'lock') { context.state = 'suspended'; context.onstatechange(); }
    if (action === 'dispose') engine.dispose();
    assert.deepEqual((await completion).events.map((event) => event.status), ['cancelled', 'cancelled']);
    assert.equal((await engine.enqueueOrdered(events('disabled'))).events[0].status, 'skipped');
    if (action !== 'dispose') {
      engine.setMuted(false);
      context.state = 'running';
      await engine.unlock();
    }
    await tick();
    assert.ok(!played.includes('queued') && !played.includes('disabled') && !played.includes('before-unlock'));
    engine.dispose();
  }
});

// 下载和播放看门狗仍有上限，超时后继续下一段，不把整批永久锁住。
// Download and playback watchdogs remain bounded and continue the next clip without locking the batch.
test('ordered download and playback watchdogs allow progress', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { engine, sources, played } = fixture();
  await engine.unlock();
  const originalFetch = engine.fetchAudio;
  engine.fetchAudio = (url) => url === 'hung' ? new Promise(() => {}) : originalFetch(url);
  const completion = engine.enqueueOrdered(events('hung', 'playing', 'last'));
  await tick();
  t.mock.timers.tick(4000);
  await tick();
  assert.equal(played.at(-1), 'playing');
  const source = sources.at(-1);
  t.mock.timers.tick(15000);
  await tick();
  assert.equal(source.stopped, true);
  assert.equal(source.disconnected, true);
  assert.equal(played.at(-1), 'last');
  sources.at(-1).onended();
  assert.deepEqual(await completion, { events: [
    { eventKey: 'game:hung', status: 'failed' },
    { eventKey: 'game:playing', status: 'failed' },
    { eventKey: 'game:last', status: 'success' },
  ] });
  engine.dispose();
});

// 报告区分无声事件和完整成功；多片段中任一失败都不能误记已播。
// Distinguish silent events from complete success; a failed clip prevents whole-event success.
test('ordered reports exact identities, silent skips and partial event failures', async () => {
  const { engine, sources } = fixture();
  await engine.unlock();
  const originalFetch = engine.fetchAudio;
  engine.fetchAudio = (url) => url === 'bad' ? Promise.reject(new Error('missing')) : originalFetch(url);
  const completion = engine.enqueueOrdered([
    { eventKey: 'room:round:7', urls: [] },
    { eventKey: 'room:round:8', urls: ['bad', 'good'] },
    { eventKey: 'room:round:9', urls: ['good'] },
  ]);
  await tick();
  sources.at(-1).onended();
  await tick();
  sources.at(-1).onended();
  assert.deepEqual(await completion, { events: [
    { eventKey: 'room:round:7', status: 'skipped' },
    { eventKey: 'room:round:8', status: 'failed' },
    { eventKey: 'room:round:9', status: 'success' },
  ] });
  engine.dispose();
});

// 后段取消不抹掉前段成功，报告返回后也不会被旧 Promise 修改。
// Cancelling later speech preserves earlier success and stale promises cannot mutate returned reports.
test('ordered cancellation preserves already finished events', async () => {
  const { engine, sources } = fixture();
  await engine.unlock();
  const completion = engine.enqueueOrdered(events('done', 'cancelled', 'pending'));
  await tick();
  sources.at(-1).onended();
  await tick();
  engine.clear();
  const report = await completion;
  assert.deepEqual(report, { events: [
    { eventKey: 'game:done', status: 'success' },
    { eventKey: 'game:cancelled', status: 'cancelled' },
    { eventKey: 'game:pending', status: 'cancelled' },
  ] });
  const saved = JSON.stringify(report);
  await tick();
  assert.equal(JSON.stringify(report), saved);
  engine.dispose();
});

// 通用队列限长淘汰整批保序任务时也应完成取消结果，不留下永不完成的 Promise。
// General queue eviction must settle ordered batches as cancelled instead of leaving hung promises.
test('general queue eviction settles pending ordered batches', async () => {
  const { engine } = fixture();
  await engine.unlock();
  const active = engine.enqueueOrdered(events('active'));
  const pending = engine.enqueueOrdered(events('evicted'));
  engine.enqueue(Array.from({ length: 13 }, (_, index) => `ordinary-${index}`));
  assert.deepEqual(await pending, { events: [{ eventKey: 'game:evicted', status: 'cancelled' }] });
  engine.clear();
  await active;
  engine.dispose();
});

// 新结果只属于 ordered API；旧现场的正常/取消 Promise 仍保持 void 契约。
// Outcome reporting belongs only to ordered API; legacy live completion/cancellation remains void.
test('legacy live completion remains void when cancelled or naturally ended', async () => {
  const { engine, sources } = fixture();
  await engine.unlock();
  const cancelled = engine.enqueueLive(events('cancel'));
  await tick();
  engine.clear();
  assert.equal(await cancelled, undefined);
  const completed = engine.enqueueLive(events('complete'));
  await tick();
  sources.at(-1).onended();
  assert.equal(await completed, undefined);
  engine.dispose();
});
