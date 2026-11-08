// 多帧时间轴的确定性单测：验证形态顺序、休息范围和RAF余量，不把数值测试冒充真实图片验收。
// Deterministic multi-frame timeline tests cover shape order, rest bounds and RAF remainder, without claiming real-image acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceFrameClock, blinkClosureAt, blinkTimingFor, motionAt, portraitPhase,
  BLINK_DURATION_MS, BLINK_MIN_REST_MS, BLINK_MAX_REST_MS, BLINK_STEPS, MOTION_FRAME_MS,
} from '../src/portrait-motion/timeline.js';

const characterIds = ['sweet', 'sunny', 'landlord', 'honest', 'wealthy', 'star', 'elegant'];

// 本测试逐一核对真实供体的离散状态，禁止用两端alpha或连续伪造眼形替代中间帧。
// Check each discrete real-donor state, preventing endpoint alpha blends or synthesized continuous eye shapes from replacing the intermediate artwork.
test('blink uses five discrete shapes over 360ms with a slightly slower reopening', () => {
  assert.equal(BLINK_DURATION_MS, 360);
  assert.deepEqual(BLINK_STEPS.map((step) => step.closure), [0.2, 0.5, 0.8, 1, 0.8, 0.5, 0.2]);
  assert.ok(BLINK_STEPS.slice(4).reduce((total, step) => total + step.durationMs, 0) >
    BLINK_STEPS.slice(0, 3).reduce((total, step) => total + step.durationMs, 0));
  let startMs = 0;
  for (const step of BLINK_STEPS) {
    assert.equal(blinkClosureAt(startMs), step.closure);
    assert.equal(blinkClosureAt(startMs + step.durationMs - 0.001), step.closure);
    startMs += step.durationMs;
  }
  assert.equal(blinkClosureAt(startMs), 0);
  for (const timeMs of [-1, NaN, Infinity, undefined, null, '50', 10000]) {
    assert.equal(blinkClosureAt(timeMs), 0);
  }
  assert.ok(Object.isFrozen(BLINK_STEPS));
  assert.ok(BLINK_STEPS.every(Object.isFrozen));
});

// 同一角色/座位重复调用一致；七角色四座的相位不同，并把眨眼后的静止间隔限制在约定范围。
// Repeated role/seat sampling is stable; all seven roles across four seats differ in phase and keep the agreed post-blink rest range.
test('role and seat offsets are stable and rests stay between 3.6 and 5.8 seconds', () => {
  const phases = new Set();
  for (const id of characterIds) {
    for (let seat = 0; seat < 4; seat += 1) {
      const key = `${id}:${seat}`;
      const phase = portraitPhase(key);
      phases.add(phase);
      assert.equal(portraitPhase(key), phase);
      assert.ok(phase >= 0 && phase < 1);
      const timing = blinkTimingFor(key);
      assert.deepEqual(blinkTimingFor(key), timing);
      assert.ok(timing.restMs >= BLINK_MIN_REST_MS && timing.restMs <= BLINK_MAX_REST_MS);
      assert.equal(timing.periodMs, timing.restMs + BLINK_DURATION_MS);
      assert.equal(timing.offsetMs, phase * timing.periodMs);
      const nextStartMs = timing.periodMs - timing.offsetMs;
      assert.equal(motionAt(nextStartMs + 25, key).blink, 0.2);
      assert.equal(motionAt(nextStartMs + 175, key).blink, 1);
      assert.equal(motionAt(nextStartMs + BLINK_DURATION_MS + 1, key).blink, 0);
      assert.equal(motionAt(nextStartMs + timing.periodMs - 1, key).blink, 0);
    }
  }
  assert.equal(phases.size, characterIds.length * 4);
});

// 时间轴对异常时钟回到静止原图；合法时间的眼形只来自五态，头发控制始终有限且有界。
// Invalid clocks return still-original controls; valid eye values stay in the five-state set and hair controls remain finite and bounded.
test('timeline samples are stateless, bounded and neutral for invalid clocks', () => {
  for (const timeMs of [-1, NaN, Infinity, -Infinity, undefined, null, '1000']) {
    assert.deepEqual(motionAt(timeMs, 'sweet:2'), { blink: 0, hair: 0 });
  }
  const closures = new Set([0, 0.2, 0.5, 0.8, 1]);
  for (let timeMs = 0; timeMs <= 60000; timeMs += 13) {
    const sample = motionAt(timeMs, 'sweet:2');
    assert.ok(closures.has(sample.blink));
    assert.ok(Number.isFinite(sample.hair) && sample.hair >= -1 && sample.hair <= 1);
    assert.deepEqual(motionAt(timeMs, 'sweet:2'), sample);
  }
});

// 60/120Hz下完整一分钟都达到30fps时间格；首帧立即绘制，所以统计含t=0的一帧。
// A full minute at 60/120Hz consumes 30fps slots; the count includes the immediately drawn frame at t=0.
test('accumulated RAF clock reaches 30fps rather than degrading to 20fps', () => {
  for (const refreshRate of [60, 120, 144]) {
    let scheduledTimeMs = null;
    const drawnAt = [];
    for (let tick = 0; tick <= refreshRate * 60; tick += 1) {
      const timeMs = tick * 1000 / refreshRate;
      const result = advanceFrameClock(timeMs, scheduledTimeMs);
      scheduledTimeMs = result.scheduledTimeMs;
      if (result.shouldDraw) drawnAt.push(timeMs);
    }
    assert.equal(drawnAt.length, 30 * 60 + 1, `${refreshRate}Hz`);
    assert.ok(Math.abs(scheduledTimeMs - 60000) < 0.000001);
    assert.ok(drawnAt.every((timeMs, index) => index === 0 || timeMs > drawnAt[index - 1]));
  }
});

// 长暂停或慢帧只选当前时间格；恢复、重置、倒退和无效时钟均不会触发补播循环或污染下次判断。
// Long pauses and slow frames select only the current slot; resume, reset, backward and invalid clocks never trigger a catch-up loop or poison the next decision.
test('frame clock retains remainder and handles suspension, restarts and invalid input', () => {
  assert.deepEqual(advanceFrameClock(0), { shouldDraw: true, scheduledTimeMs: 0 });
  assert.deepEqual(advanceFrameClock(10, 0), { shouldDraw: false, scheduledTimeMs: 0 });
  const first = advanceFrameClock(50, 0);
  assert.equal(first.shouldDraw, true);
  assert.equal(first.scheduledTimeMs, MOTION_FRAME_MS);
  const second = advanceFrameClock(100, first.scheduledTimeMs);
  assert.equal(second.shouldDraw, true);
  assert.equal(second.scheduledTimeMs, MOTION_FRAME_MS * 3);
  const resumed = advanceFrameClock(60050, second.scheduledTimeMs);
  assert.equal(resumed.shouldDraw, true);
  assert.ok(60050 - resumed.scheduledTimeMs < MOTION_FRAME_MS);
  assert.equal(advanceFrameClock(60050, resumed.scheduledTimeMs).shouldDraw, false);
  assert.deepEqual(advanceFrameClock(12, resumed.scheduledTimeMs), { shouldDraw: true, scheduledTimeMs: 12 });
  assert.deepEqual(advanceFrameClock(60050, null), { shouldDraw: true, scheduledTimeMs: 60050 });
  for (const timeMs of [-1, NaN, Infinity, null, undefined, '50']) {
    assert.deepEqual(advanceFrameClock(timeMs, 100), { shouldDraw: false, scheduledTimeMs: 100 });
    assert.deepEqual(advanceFrameClock(timeMs), { shouldDraw: false, scheduledTimeMs: null });
  }
});

// 真实60Hz取样模型串起RAF门槛和时间轴，覆盖所有角色/座位；这是帧选择测试，不是浏览器像素证明。
// A realistic 60Hz sampling model combines the RAF gate and timeline for every role/seat; this proves frame selection, not browser pixels.
test('all seven real eye stages can be visited in order through a 60Hz RAF gate', () => {
  for (const id of characterIds) {
    for (let seat = 0; seat < 4; seat += 1) {
      const key = `${id}:${seat}`;
      const timing = blinkTimingFor(key);
      const blinkStartMs = timing.periodMs - timing.offsetMs;
      let scheduledTimeMs = null;
      const stages = [];
      for (let tick = 0; tick < 600; tick += 1) {
        const timeMs = tick * 1000 / 60;
        const result = advanceFrameClock(timeMs, scheduledTimeMs);
        scheduledTimeMs = result.scheduledTimeMs;
        if (!result.shouldDraw || timeMs < blinkStartMs || timeMs >= blinkStartMs + BLINK_DURATION_MS) continue;
        const closure = motionAt(timeMs, key).blink;
        if (stages.at(-1) !== closure) stages.push(closure);
      }
      assert.deepEqual(stages, BLINK_STEPS.map((step) => step.closure), key);
    }
  }
});
