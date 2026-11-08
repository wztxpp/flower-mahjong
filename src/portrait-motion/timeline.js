// 多帧立绘的纯时间轴：只返回离散闭眼程度、局部发摆控制和绘制时钟，不加载图片或持有DOM。
// Pure multi-frame portrait timing: returns discrete eyelid closure, local hair controls and draw timing, without images or DOM ownership.
// 闭眼程度对应经过审查的真实供体帧，不是透明度；0必须显示原图。接入边界见 PORTRAIT-MOTION.md。
// Closure selects reviewed donor artwork, never opacity; zero must show the original. See PORTRAIT-MOTION.md for integration boundaries.
export const MOTION_FRAME_MS = 1000 / 30;
export const BLINK_MIN_REST_MS = 3600;
export const BLINK_MAX_REST_MS = 5800;

// 每阶段至少50ms，使60Hz的RAF配合30fps累计时钟有机会绘制每个真实形态；睁开略慢于闭合。
// Each stage lasts at least 50ms so a 60Hz RAF with an accumulated 30fps clock can draw every real shape; reopening is slightly slower.
export const BLINK_STEPS = Object.freeze([
  Object.freeze({ closure: 0.2, durationMs: 50 }),
  Object.freeze({ closure: 0.5, durationMs: 50 }),
  Object.freeze({ closure: 0.8, durationMs: 50 }),
  Object.freeze({ closure: 1, durationMs: 50 }),
  Object.freeze({ closure: 0.8, durationMs: 53 }),
  Object.freeze({ closure: 0.5, durationMs: 53 }),
  Object.freeze({ closure: 0.2, durationMs: 54 }),
]);
export const BLINK_DURATION_MS = BLINK_STEPS.reduce((total, step) => total + step.durationMs, 0);

// 相同角色/绝对座位始终得到同一相位，不依赖随机数、服务器状态或页面重渲染次数。
// The same role/absolute seat always gets the same phase, independently of randomness, server state or rerender count.
export function portraitPhase(key) {
  let hash = 2166136261;
  for (const character of String(key)) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  }
  return (hash % 10000) / 10000;
}

// 输入一次眨眼开始后的毫秒数，返回真实帧对应的闭合程度；结束、负数或无效时间都回到原图。
// Given milliseconds since one blink began, return a real-frame closure level; finished, negative and invalid times return to original art.
export function blinkClosureAt(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= BLINK_DURATION_MS) return 0;
  let endMs = 0;
  for (const step of BLINK_STEPS) {
    endMs += step.durationMs;
    if (elapsedMs < endMs) return step.closure;
  }
  return 0;
}

// 休息时间不包含360ms眨眼本身；座位相位同时错开周期起点，避免同桌人物同时眨眼。
// Rest excludes the 360ms blink itself; seat phase also offsets the cycle so table portraits do not all blink together.
export function blinkTimingFor(phaseKey, durationMs = BLINK_DURATION_MS) {
  const phase = portraitPhase(phaseKey);
  const restMs = BLINK_MIN_REST_MS + phase * (BLINK_MAX_REST_MS - BLINK_MIN_REST_MS);
  const periodMs = restMs + durationMs;
  return { restMs, periodMs, offsetMs: phase * periodMs };
}

// v2清单明确给出帧ID和各自时长；只返回一个完整供体帧，休息和null项均表示透明原图。
// A v2 manifest supplies explicit frame IDs and durations; select one whole donor frame, with rests and null entries meaning transparent original art.
// renderer先验证清单。本函数仍拒绝无效时间，便于诊断调用不产生非法状态。
// The renderer validates the manifest first. Invalid time still returns neutral for safe diagnostic calls.
export function blinkFrameAt(timeMs, phaseKey, sequence) {
  if (!Number.isFinite(timeMs) || timeMs < 0 || !Array.isArray(sequence) || sequence.length === 0) return null;
  const durationMs = sequence.reduce((total, step) => total + step.durationMs, 0);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  const timing = blinkTimingFor(phaseKey, durationMs);
  const localMs = (timeMs + timing.offsetMs) % timing.periodMs;
  let endMs = 0;
  for (const step of sequence) {
    endMs += step.durationMs;
    if (localMs < endMs) return step.frameId;
  }
  return null;
}

// 绝对时钟取样不累积动画状态；暂停后无需补播旧帧。头发值只是供体状态控制，不证明像素观感。
// Absolute-clock sampling accumulates no animation state and needs no catch-up after pauses. Hair values select donor states, not proof of visual quality.
export function motionAt(timeMs, phaseKey) {
  if (!Number.isFinite(timeMs) || timeMs < 0) return { blink: 0, hair: 0 };
  const phase = portraitPhase(phaseKey);
  const timing = blinkTimingFor(phaseKey);
  const localMs = (timeMs + timing.offsetMs) % timing.periodMs;
  const hairPeriodMs = 5200 + phase * 1000;
  return {
    blink: blinkClosureAt(localMs),
    hair: Math.sin((timeMs % hairPeriodMs) / hairPeriodMs * Math.PI * 2 + phase * Math.PI * 2),
  };
}

// scheduledTimeMs是上次消耗的30fps时间格，不是实际RAF到达时间。返回新值，调用者自行保存。
// scheduledTimeMs is the last consumed 30fps slot, not the last RAF arrival. The caller owns the returned updated value.
// 保留不足一帧的余量，修复60Hz下每次清零余量只剩20fps的问题；长时间跳跃只绘一次，不追赶积压。
// Preserve sub-frame remainder instead of resetting to RAF time, which fell to 20fps at 60Hz in the previous 24fps gate; a large jump draws once without replaying a backlog.
export function advanceFrameClock(timeMs, scheduledTimeMs = null) {
  const hasPreviousTime = Number.isFinite(scheduledTimeMs) && scheduledTimeMs >= 0;
  if (!Number.isFinite(timeMs) || timeMs < 0) {
    return { shouldDraw: false, scheduledTimeMs: hasPreviousTime ? scheduledTimeMs : null };
  }
  if (!hasPreviousTime || timeMs < scheduledTimeMs) {
    return { shouldDraw: true, scheduledTimeMs: timeMs };
  }
  const elapsedMs = timeMs - scheduledTimeMs;
  // 浮点毫秒在60/120Hz边界会有极小舍入误差；该容差远小于可见帧，不允许真正提前绘制。
  // Fractional milliseconds have tiny rounding errors at 60/120Hz boundaries; this tolerance is far below a visible frame and permits no meaningful early draw.
  const elapsedFrames = Math.floor((elapsedMs + 0.000001) / MOTION_FRAME_MS);
  if (elapsedFrames < 1) return { shouldDraw: false, scheduledTimeMs };
  return {
    shouldDraw: true,
    scheduledTimeMs: scheduledTimeMs + elapsedFrames * MOTION_FRAME_MS,
  };
}
