// 使用随项目保存的官方 Core 和真实 moc3，不模拟网格；浏览器 GPU 仍需另验。
// Use shipped official Core and actual moc3 bytes without mocked meshes; browser GPU checks remain separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { LIVE2D_CHARACTERS } from '../src/live2d/catalog.js';
import { auditCoreModel } from './helpers/live2d-core-audit.js';

const coreSource = readFileSync(new URL('../public/vendor/live2d/live2dcubismcore.min.js', import.meta.url));
assert.equal(createHash('sha256').update(coreSource).digest('hex'), '8741f739779b5d5210872bd3d7d99f0f1e56e6c87409e7d26d6bb4b80aa1ef47');
const context = { atob: globalThis.atob, console, setTimeout, clearTimeout, TextDecoder,
  Uint8Array, ArrayBuffer, Float32Array, Int32Array, Uint16Array, Int16Array, Int8Array, Uint32Array, Float64Array, Math, Date };
vm.runInNewContext(coreSource.toString('utf8'), context, { filename: 'official-live2d-core.js' });
const Core = context.Live2DCubismCore;
for (let index = 0; ; index += 1) {
  try { Core.Version.csmGetVersion(); break; }
  catch (error) {
    if (index >= 150) throw error;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// 未完成重建的目录保持禁用，不把它们记作模型测试通过；每个可用项必须真的存在。
// Unrestored entries stay disabled and are not counted as passed model tests; every available entry must exist.
for (const descriptor of Object.values(LIVE2D_CHARACTERS)) {
  const modelPath = new URL(`../public${descriptor.modelUrl}`, import.meta.url);
  assert.ok(!descriptor.available || existsSync(modelPath), `${descriptor.id}: enabled model missing`);
  if (!descriptor.available) continue;
  test(`${descriptor.id}: actual official Core loads MOC and verifies audited bindings over 192 frames`, () => {
    const settings = JSON.parse(readFileSync(modelPath, 'utf8'));
    const manifest = JSON.parse(readFileSync(new URL(`../docs/verification/live2d-models/${descriptor.id}.json`, import.meta.url), 'utf8'));
    assert.deepEqual(descriptor.verifiedBindings, manifest.verifiedCoreBindings);
    for (const [relative, evidence] of Object.entries(manifest.runtimeSha256)) {
      const bytes = readFileSync(new URL(relative, modelPath));
      assert.equal(bytes.length, evidence.bytes, `${descriptor.id}/${relative}: byte length`);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), evidence.sha256, `${descriptor.id}/${relative}: audited bytes`);
    }
    assert.equal(settings.Version, 3);
    assert.deepEqual(Object.keys(settings.FileReferences).sort(), ['DisplayInfo', 'Moc', 'Textures']);
    for (const texture of settings.FileReferences.Textures) {
      const bytes = readFileSync(new URL(texture, modelPath));
      assert.ok(bytes.length > 24);
      assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG');
    }
    assert.ok(existsSync(new URL(`../public${descriptor.backgroundUrl}`, import.meta.url)));
    const bytes = readFileSync(new URL(settings.FileReferences.Moc, modelPath));
    const report = auditCoreModel(Core, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), descriptor.verifiedBindings);
    assert.equal(report.consistency, 1);
    assert.equal(report.coreVersion, 100663297);
    assert.equal(report.finiteFrames, 192);
    assert.ok(report.drawableCount > 0);
    assert.ok(report.changedFrames > 0);
    assert.equal(report.webglVerified, false);
  });
}

// 递归核对整个 runtime 清单，既防漏复制也防混入旧模型的额外资产。
// Compare the entire runtime tree recursively, catching incomplete copies and extra stale model assets.
function runtimeFiles(directory, prefix = '') {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`;
    const location = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    assert.equal(entry.isSymbolicLink(), false, `Runtime symlink is not an audited asset: ${relative}`);
    if (entry.isDirectory()) files.push(...runtimeFiles(location, `${relative}/`));
    else files.push(relative);
  }
  return files.sort();
}

// 每份离线放行必须绑定当前 moc3、正式驱动和精确能力；七个角色不能共享同一 moc3 冒充独立角色。
// Each offline approval binds its current moc3, production driver and exact capabilities; distinct roles cannot reuse one moc3 as separate characters.
test('available Live2D roles have distinct audited assets and matching current-driver visual evidence', () => {
  const driverSha256 = createHash('sha256').update(readFileSync(new URL('../src/live2d/idle-motion.js', import.meta.url))).digest('hex');
  const modelHashes = new Set();
  for (const descriptor of Object.values(LIVE2D_CHARACTERS)) {
    if (!descriptor.available) {
      assert.deepEqual(descriptor.verifiedBindings, []);
      continue;
    }
    const evidenceRoot = new URL('../docs/verification/live2d-models/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL(`${descriptor.id}.json`, evidenceRoot), 'utf8'));
    const visual = JSON.parse(readFileSync(new URL(`${descriptor.id}-visual.json`, evidenceRoot), 'utf8'));
    const modelHash = manifest.runtimeSha256['character.moc3'].sha256;
    const modelDirectory = new URL('.', new URL(`../public${descriptor.modelUrl}`, import.meta.url));
    assert.deepEqual(runtimeFiles(modelDirectory), Object.keys(manifest.runtimeSha256).sort());
    assert.equal(manifest.character, descriptor.id);
    assert.equal(manifest.coreConsistency, 1);
    assert.equal(manifest.coreVersion, 100663297);
    assert.equal(manifest.webglVerified, false);
    assert.equal(visual.webglVerified, false);
    assert.equal(visual.status, 'passed_offline_Core_visual_QA_for_tested_idle_and_stress_poses');
    assert.equal(visual.modelSha256, modelHash);
    assert.equal(visual.driverSha256, driverSha256);
    assert.deepEqual(visual.verifiedIdleParameters, manifest.verifiedCoreBindings);
    assert.deepEqual(descriptor.verifiedBindings, manifest.verifiedCoreBindings);
    assert.equal(visual.durationSeconds, 8);
    assert.equal(visual.fps, 24);
    assert.equal(visual.frames, 192);
    assert.deepEqual(visual.closedSamples, ['idle-036', 'idle-090', 'idle-150']);
    assert.equal(modelHashes.has(modelHash), false, `${descriptor.id}: reused moc3`);
    modelHashes.add(modelHash);
  }
  assert.ok(modelHashes.size > 0, 'The model audit must not silently run without any real model.');
});
