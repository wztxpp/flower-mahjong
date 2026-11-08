// 纯函数待机：只计算已审计参数的候选值，不读取牌局、不加载动作/表情/旧物理文件。
// Pure idle math produces candidates for audited parameters, without game state, motions, expressions or old physics.
// 绑定仍须同时经过目录白名单和真实 Core 参数核对；参见 LIVE2D-RUNTIME 文档。
// Bindings must pass both the catalog allowlist and the real Core parameter inventory; see the runtime guide.
export const IDLE_CYCLE_SECONDS = 8;
const FULL_TURN = Math.PI * 2;
const BLINK_CENTERS = Object.freeze([1.5, 3.75, 6.25]);
const BLINK_HALF_WIDTH = 0.14;
const BLINK_CLOSED_HALF_WIDTH = 0.035;

// 将角色+绝对座位的稳定键映射到八秒周期；不使用随机数或当前时间，重建可重现。
// Hash a stable character-plus-absolute-seat key into the eight-second cycle, without randomness or wall-clock time.
export function idlePhaseForKey(key = '') {
  let hash = 2166136261;
  for (const character of String(key)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  // 追加雪崩混合，让仅末尾座位数字不同的键也有明显相位差，而不是几百分之一秒。
  // Final avalanche mixing gives adjacent seat suffixes meaningful phase separation rather than a few hundredths of a second.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296 * IDLE_CYCLE_SECONDS;
}

// 同一周期中的三个平滑眨眼，两眼共享一个开合值；周期边界始终睁眼。
// Three smooth blinks share one opening value for both eyes, with open eyes at the cycle boundary.
export function blinkOpeningAt(cycleSeconds) {
  const wrapped = ((cycleSeconds % IDLE_CYCLE_SECONDS) + IDLE_CYCLE_SECONDS) % IDLE_CYCLE_SECONDS;
  for (const center of BLINK_CENTERS) {
    const distance = Math.abs(wrapped - center);
    // 短全闭平台保证 24/30fps 下也能采到完整闭眼，不依赖恰好命中一个时刻。
    // A brief fully-closed plateau guarantees a complete blink at 24/30fps without hitting one exact instant.
    if (distance <= BLINK_CLOSED_HALF_WIDTH) return 0;
    if (distance < BLINK_HALF_WIDTH) {
      const progress = (distance - BLINK_CLOSED_HALF_WIDTH) / (BLINK_HALF_WIDTH - BLINK_CLOSED_HALF_WIDTH);
      return (1 - Math.cos(Math.PI * progress)) / 2;
    }
  }
  return 1;
}

// 返回标准角度单位及归一化呼吸/发丝值；左右发丝有不同滞后，不添加前发或嘴部运动。
// Return standard angle units and normalized breath/hair values; side hair lags independently, without front-hair or mouth motion.
export function sampleIdleMotion(elapsedSeconds, phaseSeconds = 0) {
  const elapsed = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
  const phase = Number.isFinite(phaseSeconds) ? phaseSeconds : 0;
  const cycle = ((elapsed + phase) % IDLE_CYCLE_SECONDS + IDLE_CYCLE_SECONDS) % IDLE_CYCLE_SECONDS;
  const angle = cycle / IDLE_CYCLE_SECONDS * FULL_TURN;
  const eyeOpening = blinkOpeningAt(cycle);
  return {
    ParamAngleX: 3.8 * Math.sin(angle),
    ParamAngleY: 2.2 * Math.sin(angle + 0.65),
    ParamAngleZ: 1.5 * Math.sin(angle - 0.4),
    ParamBodyAngleX: 1.25 * Math.sin(angle - 0.25),
    ParamBodyAngleY: 0.85 * Math.sin(angle + 0.35),
    ParamBodyAngleZ: 0.75 * Math.sin(angle - 0.55),
    ParamBreath: 0.5 + 0.17 * Math.sin(angle),
    ParamEyeLOpen: eyeOpening,
    ParamEyeROpen: eyeOpening,
    ParamHairSideL: 0.78 * Math.sin(angle - 0.36) + 0.04 * Math.sin(2 * angle - 0.5),
    ParamHairSideR: 0.74 * Math.sin(angle - 0.57) + 0.04 * Math.sin(2 * angle - 0.75),
    ParamHairBack: 0.08 * Math.sin(angle - 0.72),
  };
}

// 将官方 ID 包装对象转为确切字符串；绝不调用会为缺失 ID 生成虚拟索引的 getParameterIndex。
// Convert an official ID wrapper into its exact string; never use getParameterIndex, which fabricates indexes for missing IDs.
function parameterIdText(id) {
  const text = id?.getString?.();
  return typeof text === 'string' ? text : text?.s ?? '';
}

// 白名单与真实参数取交集并保存范围；存在某个 ID 本身不代表审核允许驱动它。
// Intersect explicit authorization with real parameters and retain ranges; existence alone never authorizes animation.
export function collectVerifiedBindings(model, verifiedBindings = []) {
  const allowed = new Set(Array.isArray(verifiedBindings) ? verifiedBindings : []);
  const supported = sampleIdleMotion(0);
  const bindings = [];
  for (let index = 0; index < model.getParameterCount(); index += 1) {
    const id = parameterIdText(model.getParameterId(index));
    if (!allowed.has(id) || !Object.hasOwn(supported, id)) continue;
    const minimum = model.getParameterMinimumValue(index);
    const maximum = model.getParameterMaximumValue(index);
    const defaultValue = model.getParameterDefaultValue(index);
    if (![minimum, maximum, defaultValue].every(Number.isFinite) || maximum < minimum) continue;
    bindings.push({ id, index, minimum, maximum, defaultValue });
  }
  return bindings;
}

// 只写已核验索引；角度相对默认值、眨眼从默认睁眼值闭合、侧发按已验范围足幅摆动。
// Write verified indexes only: angles offset defaults, blinks close from their default, and side hair uses a visible share of audited model ranges.
export function applyIdleMotion(model, bindings, elapsedSeconds, phaseSeconds) {
  const sample = sampleIdleMotion(elapsedSeconds, phaseSeconds);
  for (const binding of bindings) {
    const { id, index, minimum, maximum, defaultValue } = binding;
    let value = defaultValue + sample[id];
    if (id === 'ParamBreath') value = minimum + (maximum - minimum) * sample[id];
    if (id === 'ParamEyeLOpen' || id === 'ParamEyeROpen') {
      value = minimum + (defaultValue - minimum) * sample[id];
    }
    if (id.startsWith('ParamHair')) value = defaultValue + (maximum - minimum) / 2 * sample[id];
    model.setParameterValueByIndex(index, Math.max(minimum, Math.min(maximum, value)));
  }
}
