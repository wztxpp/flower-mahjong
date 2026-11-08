// 生产打包后的局部动效边界：旧SDK/模型保留为源码历史，但禁止再次公开分发。
// Post-build local-motion boundary: retired SDK/models remain source history but must not be redistributed.
import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// 验证实际产物而非只搜源码；对完整dist递归检查，不只依赖旧目录或JavaScript引用。
// Inspect actual artifacts recursively across the full dist tree, not just old directories or JavaScript references.
// 任何遗漏让构建失败，不把半清理包当作可发布结果。
// Any leftover fails the build instead of shipping a partially cleaned bundle.
export async function verifyPortraitMotionBuild(directory) {
  for (const retired of ['live2d', 'vendor/live2d']) {
    try {
      await access(join(directory, retired));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    throw new Error(`Retired Live2D assets remain: ${retired}`);
  }
  async function visit(path) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const target = join(path, item.name);
      if (item.isDirectory()) await visit(target);
      // 模型即使换名/挪到其他目录且没有JS引用也必须拒绝；不读取二进制内容来猜模型身份。
      // Reject models even when renamed/moved and unreferenced by JavaScript; do not guess model identity from binary contents.
      else if (/\.(?:moc3|model3\.json)$/i.test(item.name)) {
        throw new Error(`Retired Live2D model bundled: ${target}`);
      } else if (/\.(?:js|mjs|html)$/.test(item.name)) {
        const source = await readFile(target, 'utf8');
        if (/Live2DCubismCore|CubismFramework|live2dcubismcore|character\.model3\.json|\/vendor\/live2d\//.test(source)) {
          throw new Error(`Retired Live2D runtime bundled: ${target}`);
        }
      }
    }
  }
  await visit(directory);
}
