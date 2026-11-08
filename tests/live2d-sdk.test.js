// 真实固定 R5 注册算法回归；仅替换 GL 编译句柄，不声称实际着色器编译或 GPU 成功。
// Regression for actual pinned R5 registration; only GL compilation handles are mocked, not GPU/compilation success.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { validateShaderPrograms } from '../src/live2d/renderer.js';

test('actual pinned R5 leaves three reserved slots unused without making reachable shaders fail', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const context = { atob: globalThis.atob, console, setTimeout, clearTimeout, TextDecoder,
    Uint8Array, ArrayBuffer, Float32Array, Int32Array, Uint16Array, Int16Array, Int8Array, Uint32Array, Float64Array, Math, Date };
  vm.runInNewContext(readFileSync(resolve(root, 'public/vendor/live2d/live2dcubismcore.min.js'), 'utf8'), context);
  const Core = context.Live2DCubismCore;
  for (let index = 0; ; index += 1) {
    try { Core.Version.csmGetVersion(); break; }
    catch (error) {
      if (index >= 150) throw error;
      await new Promise((done) => setTimeout(done, 20));
    }
  }
  const previousCore = globalThis.Live2DCubismCore;
  globalThis.Live2DCubismCore = Core;
  try {
    // 仅在内存转译未修改的官方 TS；不向 vendor 或安装依赖写入测试替身。
    // Transpile unchanged official TS in memory, without writing doubles into vendor/dependency files.
    const cache = new Map();
    const load = (filename) => {
      const file = resolve(filename.endsWith('.ts') ? filename : `${filename}.ts`);
      if (cache.has(file)) return cache.get(file).exports;
      const moduleRecord = { exports: {} };
      cache.set(file, moduleRecord);
      const code = ts.transpileModule(readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText;
      new Function('require', 'module', 'exports', code)((name) => load(resolve(dirname(file), name)), moduleRecord, moduleRecord.exports);
      return moduleRecord.exports;
    };
    const { CubismShader_WebGL, CubismShaderSet } = load(resolve(root, 'vendor/live2d/Framework/src/rendering/cubismshader_webgl.ts'));
    const shader = new CubismShader_WebGL();
    shader.setGl({ getAttribLocation: () => 0, getUniformLocation: () => ({}) });
    let compiledHandles = 0;
    shader.loadShaderProgram = () => ({ testHandle: ++compiledHandles });
    shader._shaderSets = Array.from({ length: shader._shaderCount }, () => new CubismShaderSet());
    shader.registerShader();
    shader.registerBlendShader();
    assert.equal(shader._shaderCount, 251);
    assert.equal(compiledHandles, 242);
    assert.deepEqual(shader._shaderSets.flatMap((entry, index) => entry.shaderProgram ? [] : [index]), [248, 249, 250]);
    assert.equal(validateShaderPrograms(shader), 248);
    shader._shaderSets[247].shaderProgram = 0;
    assert.throws(() => validateShaderPrograms(shader), /shader 247 failed/);
  } finally {
    if (previousCore === undefined) delete globalThis.Live2DCubismCore;
    else globalThis.Live2DCubismCore = previousCore;
  }
});
