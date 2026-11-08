// Node 与浏览器共用的真实官方 Core 检查，只读模型参数/网格；结果明确不代表 GPU 绘制。
// Shared Node/browser audit of actual official Core parameters/meshes; results explicitly do not prove GPU rendering.
import { applyIdleMotion, collectVerifiedBindings } from '../../src/live2d/idle-motion.js';

export function auditCoreModel(Core, bytes, verifiedBindings) {
  const moc = Core.Moc.fromArrayBuffer(bytes);
  if (!moc) throw new Error('Official Core rejected MOC bytes');
  let model;
  try {
    const consistency = moc.hasMocConsistency(bytes);
    if (consistency !== 1) throw new Error('MOC consistency failed');
    model = Core.Model.fromMoc(moc);
    if (!model || !model.drawables.count) throw new Error('Core produced no drawables');
    const parameters = model.parameters;
    const defaults = Array.from(parameters.defaultValues);
    // 适配器只把 Core 的真实数组交给同一网页待机函数，没有替换模型运算。
    // The adapter exposes real Core arrays to the same web idle function, without replacing model computation.
    const adapter = {
      getParameterCount: () => parameters.count,
      getParameterId: (index) => ({ getString: () => parameters.ids[index] }),
      getParameterMinimumValue: (index) => parameters.minimumValues[index],
      getParameterMaximumValue: (index) => parameters.maximumValues[index],
      getParameterDefaultValue: (index) => parameters.defaultValues[index],
      setParameterValueByIndex: (index, value) => { parameters.values[index] = value; },
    };
    const bindings = collectVerifiedBindings(adapter, verifiedBindings);
    if (bindings.length !== new Set(verifiedBindings).size) throw new Error('An audited parameter is missing or unsupported');
    const snapshot = () => ({
      positions: model.drawables.vertexPositions.map((values) => Array.from(values)),
      opacities: Array.from(model.drawables.opacities),
    });
    const assertFinite = () => {
      for (const values of [...model.drawables.vertexPositions, model.drawables.opacities]) {
        if (Array.from(values).some((value) => !Number.isFinite(value))) throw new Error('Nonfinite Core output');
      }
      for (const masks of model.drawables.masks) {
        if (Array.from(masks).some((index) => !Number.isInteger(index) || index < 0 || index >= model.drawables.count)) {
          throw new Error('Invalid drawable mask reference');
        }
      }
    };
    const changed = (first, second) => first.positions.some((values, drawable) =>
      Math.abs(first.opacities[drawable] - second.opacities[drawable]) > 1e-6 ||
      values.some((value, index) => Math.abs(value - second.positions[drawable][index]) > 1e-7));
    parameters.values.set(defaults);
    model.update();
    const neutral = snapshot();
    const bindingResults = [];
    for (const binding of bindings) {
      let hasChange = false;
      for (const value of [binding.minimum, binding.maximum]) {
        parameters.values.set(defaults);
        parameters.values[binding.index] = value;
        model.update();
        assertFinite();
        hasChange ||= changed(neutral, snapshot());
      }
      if (!hasChange) throw new Error(`Parameter has no real geometry/opacity binding: ${binding.id}`);
      bindingResults.push(binding.id);
    }
    // 用同一纯函数跑完整八秒，覆盖三次眨眼与参数组合；仅验证有限输出，不冒称像素正确。
    // Run the same pure function for a full eight seconds, covering blinks/combinations; finite output is not pixel correctness.
    let changedFrames = 0;
    for (let index = 0; index < 192; index += 1) {
      parameters.values.set(defaults);
      applyIdleMotion(adapter, bindings, index / 24, 0);
      model.update();
      assertFinite();
      if (changed(neutral, snapshot())) changedFrames += 1;
    }
    if (bindings.length && changedFrames === 0) throw new Error('Idle sequence did not change any model output');
    return {
      coreVersion: Core.Version.csmGetVersion(),
      mocVersion: Core.Version.csmGetMocVersion(bytes),
      consistency,
      drawableCount: model.drawables.count,
      verifiedBindings: bindingResults,
      finiteFrames: 192,
      changedFrames,
      webglVerified: false,
    };
  } finally {
    model?.release();
    moc._release();
  }
}
