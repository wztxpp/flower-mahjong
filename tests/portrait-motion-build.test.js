// 构建包和真实应用依赖图双重保护：旧SDK只能离线保留，不可由生产入口执行或公开分发。
// Protect both built artifacts and the actual app graph: retired SDK stays offline, never executed/distributed from production entry points.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPortraitMotionBuild } from '../scripts/verify-portrait-motion-build.mjs';

// 使用隔离临时构建树验证实际检查器；不读写既有用户数据或真实发布目录。
// Exercise the real checker with isolated temporary output, without touching user data or an actual deployment.
test('build guard rejects retained SDK paths and imported SDK chunks, permitting only Canvas2D output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'portrait-build-'));
  try {
    await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'assets', 'renderer.js'), "canvas.getContext('2d');");
    await assert.doesNotReject(verifyPortraitMotionBuild(directory));
    for (const path of ['live2d', 'vendor/live2d']) {
      await mkdir(join(directory, path), { recursive: true });
      await assert.rejects(verifyPortraitMotionBuild(directory), /assets remain/);
      await rm(join(directory, path), { recursive: true });
    }
    await writeFile(join(directory, 'assets', 'renderer.js'), 'window.Live2DCubismCore = {};');
    await assert.rejects(verifyPortraitMotionBuild(directory), /runtime bundled/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// 无JS引用的模型仍可能被构建复制；覆盖任意深度、client之外和大小写不同的扩展。
// Unreferenced models may still be copied into output; cover arbitrary depth, locations outside client and case variants.
test('build guard rejects model file extensions anywhere in the complete distribution', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'portrait-model-build-'));
  try {
    for (const relative of [
      'client/assets/nested/renamed.moc3',
      'client/portraits/other.model3.json',
      'server/deep/standalone.MOC3',
      'archive/unreferenced.MODEL3.JSON',
    ]) {
      const target = join(directory, relative);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, relative.toLowerCase().endsWith('.json') ? '{}' : Buffer.from([0, 1, 2, 3]));
      await assert.rejects(verifyPortraitMotionBuild(directory), /model bundled/, relative);
      await rm(target);
    }
    await writeFile(join(directory, 'client/assets/nested/catalog.json'), '{}');
    await assert.doesNotReject(verifyPortraitMotionBuild(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('both real gameplay entry points share original-preserving art without any retired SDK dependency', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const seen = new Set();
  async function visit(path) {
    if (seen.has(path)) return;
    seen.add(path);
    assert.ok(!path.includes('/src/live2d/') && !path.endsWith('/Live2DSettings.vue'), path);
    const source = await readFile(path, 'utf8');
    const imports = [...source.matchAll(/(?:from\s*|import\(\s*|import\s*)['"]([^'"]+)['"]/g)].map((match) => match[1]);
    for (const imported of imports) {
      if (imported.startsWith('.') && /\.(?:js|vue|json)$/.test(imported)) await visit(resolve(dirname(path), imported));
    }
  }
  await visit(join(root, 'src/main.js'));
  for (const expected of ['App.vue', 'ChengduTable.vue', 'CharacterArtwork.vue', 'PortraitMotionSettings.vue', 'portrait-motion/renderer.js']) assert.ok(seen.has(join(root, 'src', expected)), expected);
  const component = await readFile(join(root, 'src/CharacterArtwork.vue'), 'utf8');
  assert.doesNotMatch(component, /opacity:|character-artwork-background|backgroundUrl|WebGL|Live2D/);
  const settings = await readFile(join(root, 'src/PortraitMotionSettings.vue'), 'utf8');
  assert.doesNotMatch(settings, /LIVE2D_LICENSE|同意并启用|官方许可/);
  const build = await readFile(join(root, 'scripts/build-mahjong.mjs'), 'utf8');
  assert.match(build, /rm\('dist\/client\/live2d'/);
  assert.match(build, /rm\('dist\/client\/vendor\/live2d'/);
  assert.match(build, /verifyPortraitMotionBuild\('dist\/client'\)/);
  assert.match(build, /verifyPortraitMotionBuild\('dist'\)/);
});
