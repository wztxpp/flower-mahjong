// 编译实际SFC并SSR验证牌面边界；几何断言检查实体连接，不能替代浏览器像素验收。
// Compile real SFCs and SSR-test face boundaries; geometry assertions check connected solids, not browser pixels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as Vue from 'vue';
import { renderToString } from '@vue/server-renderer';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';

// 不替换MahjongTile或图集；只把编译模块的import接到真实依赖，以便离线测试。
// Never stub MahjongTile or the atlas; only connect compiled imports to real dependencies for offline tests.
async function loadComponent(filename) {
  const source = readFileSync(filename, 'utf8');
  const { descriptor } = parse(source);
  const script = compileScript(descriptor, { id: filename });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: filename,
    compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  const modules = { vue: Vue };
  for (const [, specifier] of `${script.content}\n${template.code}`.matchAll(/import\s+[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g)) {
    if (modules[specifier]) continue;
    const target = resolve(dirname(filename), specifier);
    modules[specifier] = target.endsWith('.vue')
      ? { default: await loadComponent(target) }
      : await import(pathToFileURL(target).href);
  }
  const rewrite = (code) => code
    .replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
      (_, names, specifier) => `const {${names.replace(/\s+as\s+/g, ':')}} = modules[${JSON.stringify(specifier)}];`)
    .replace(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g,
      (_, name, specifier) => `const ${name} = modules[${JSON.stringify(specifier)}].default;`);
  const component = new Function('modules', rewrite(script.content).replace('export default', 'return'))(modules);
  component.render = new Function('modules', `${rewrite(template.code).replace('export function render', 'function render')}\nreturn render;`)(modules);
  return component;
}
const filename = resolve(new URL('../src/RealisticTableTile.vue', import.meta.url).pathname);
const component = await loadComponent(filename);
const render = (props) => renderToString(Vue.createSSRApp(component, props));
const source = readFileSync(filename, 'utf8');

test('rounded solid has closed top/bottom and 48 joined side/bevel facets', async () => {
  const html = await render({ tile: 0 });
  assert.equal((html.match(/class="realistic-tile-shell-panel"/g) || []).length, 48);
  assert.match(html, /realistic-tile-bottom/);
  assert.match(html, /realistic-tile-face/);
  assert.doesNotMatch(html, /NaN|Infinity|undefinedpx/);
  // 每片都有真实3D变换，不允许退回只有四张方侧壁或二维阴影的“厚度”。
  // Every facet has a real 3D transform, preventing regression to four square walls or shadow-only depth.
  const matrices = [...html.matchAll(/matrix3d\(([^)]+)\)/g)].map((match) => match[1].split(',').map(Number));
  assert.equal(matrices.length, 48);
  for (const matrix of matrices) {
    assert.equal(matrix.length, 16);
    assert.ok(matrix.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...matrix.slice(0, 3)) - 1) < 1e-6);
    assert.ok(Math.abs(Math.hypot(...matrix.slice(4, 7)) - 1) < 1e-6);
  }
  assert.match(source, /const TILE_DEPTH = 0\.42/);
  assert.match(source, /const BEVEL_RADIUS = 0\.035/);
  assert.match(source, /TILE_DEPTH - BEVEL_RADIUS/);
});

test('concealed tiles never resolve atlas identities whether flat or standing', async () => {
  for (const upright of [false, true]) {
    const first = await render({ tile: 0, back: true, upright });
    const other = await render({ tile: 26, back: true, upright });
    assert.equal(first, other, 'Concealed identity cannot change markup or accessible text');
    assert.doesNotMatch(first, /tile-photo-face|<image/);
    assert.equal((first.match(/class="back-pattern"/g) || []).length, 1);
    assert.match(first, /背面牌/);
    if (upright) {
      assert.match(first, /realistic-tile-bottom"(?! aria-hidden)/);
      assert.match(first, /realistic-tile-face" aria-hidden="true"/);
    }
  }
});

test('public tile still uses canonical atlas, while bottom decoration has no second face', async () => {
  const html = await render({ tile: 0, small: true });
  assert.equal((html.match(/class="tile-photo-face"/g) || []).length, 1);
  assert.match(html, /realistic-tile-bottom" aria-hidden="true"/);
  assert.match(html, /tile-small/);
  assert.doesNotMatch(html, /is-upright/);
});

test('upright rotates the whole shell, keeps the table contact and preserves depth', () => {
  const css = source.split('<style scoped>')[1];
  assert.match(css, /\.is-upright \.realistic-tile-body\s*\{\s*transform: rotateX\(-90deg\)/);
  assert.match(css, /transform-origin: center bottom/);
  assert.match(css, /\.realistic-tile-bottom\s*\{\s*transform: rotateY\(180deg\)/);
  assert.ok((css.match(/transform-style: preserve-3d/g) || []).length >= 3);
  assert.doesNotMatch(css, /(?:^|[;{])\s*(?:filter|opacity|overflow)\s*:/m);
  assert.match(css, /backface-visibility: hidden/);
});

// 读取实际模块级几何，不另写一个“正确但没被生产使用”的网格生成器。
// Read the shipped module geometry, rather than testing a separate correct-but-unused generator.
const geometry = new Function(`${source.match(/<script>([\s\S]*?)<\/script>/)[1]}; return { shellPanels, TILE_DEPTH };`)();
function resolveLength(expression, width, height, percentageBase) {
  // 输入只有本组件输出的长度表达式；先严格校验字符再执行算术，绝不处理外部内容。
  // Inputs are this component's own length expressions; validate characters before arithmetic, never process external content.
  const arithmetic = expression
    .replace(/var\(--realistic-tile-width,\s*36px\)/g, String(width))
    .replace(/var\(--realistic-tile-height,\s*50px\)/g, String(height))
    .replace(/calc\(/g, '(')
    .replace(/([\d.]+)%/g, (_, percent) => String(Number(percent) * percentageBase / 100))
    .replace(/px/g, '');
  assert.match(arithmetic, /^[\d.\s()+*\-/]+$/);
  return new Function(`return (${arithmetic});`)();
}

test('all facet vertices stay inside the tile at mobile and desktop sizes, flat or upright', () => {
  for (const height of [18, 26, 42, 50, 56]) {
    for (const ratio of [0.6, 0.72, 0.8]) {
      const width = height * ratio;
      for (const panel of geometry.shellPanels) {
        // X/Y必须从父级定位，transform中的百分比会相对分片尺寸，是实际立牌长杆回归的原因。
        // X/Y must use parent positioning; percentages inside transforms reference facet dimensions and caused visible standing rods.
        assert.doesNotMatch(panel.transform, /%/);
        const left = resolveLength(panel.left, width, height, width);
        const top = resolveLength(panel.top, width, height, height);
        const panelWidth = resolveLength(panel.width, width, height, width);
        const panelHeight = resolveLength(panel.height, width, height, height);
        const depth = resolveLength(panel.transform.match(/translate3d\(0px, 0px, (calc\([^)]+\)[^)]*\))\)/)[1], width, height, height);
        const matrix = panel.transform.match(/matrix3d\(([^)]+)\)/)[1].split(',').map(Number);
        const clip = panel.clipPath
          ? [...panel.clipPath.matchAll(/([\d.]+)%\s+(0|100%)/g)].map((match) => [Number(match[1]) / 100, match[2] === '0' ? 0 : 1])
          : [[0, 0], [1, 0], [1, 1], [0, 1]];
        assert.equal(clip.length, 4);
        for (const [horizontal, vertical] of clip) {
          const x = left + horizontal * panelWidth * matrix[0] + vertical * panelHeight * matrix[4];
          const y = top + horizontal * panelWidth * matrix[1] + vertical * panelHeight * matrix[5];
          const z = depth + horizontal * panelWidth * matrix[2] + vertical * panelHeight * matrix[6];
          const epsilon = 0.0001;
          assert.ok(x >= -epsilon && x <= width + epsilon, `x=${x}, width=${width}`);
          assert.ok(y >= -epsilon && y <= height + epsilon, `y=${y}, height=${height}`);
          assert.ok(z >= -epsilon && z <= height * geometry.TILE_DEPTH + epsilon, `z=${z}`);
          // 绕底边-90度后，屏幕局部Y=牌高+原Z，站高=牌高-原Y。
          // After -90 degrees about the bottom edge, local Y=height+old Z and standing Z=height-old Y.
          const standingY = height + z;
          const standingZ = height - y;
          assert.ok(standingY >= height - epsilon && standingY <= height * (1 + geometry.TILE_DEPTH) + epsilon);
          assert.ok(standingZ >= -epsilon && standingZ <= height + epsilon);
        }
      }
    }
  }
});
