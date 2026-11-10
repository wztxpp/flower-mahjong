// 万牌纸色专项：验证原始像素变换、九张共用图集及SVG/Canvas一致参数，不涉及规则。
// Wan paper regression: pixel correction, nine shared crops and SVG/Canvas parameters, never game rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeWanPaper, createWanDisplayAtlas, paintWanFace,
  WAN_PAPER_RGB, WAN_PAPER_START, WAN_PAPER_END, WAN_FACE_CROPS,
} from '../src/mahjong-wan-faces.js';

// 原图九张左上纸色采样均偏蓝白；统一后保留黑红墨迹与透明通道。
// Actual upper-left paper samples from all nine source crops skew blue-white; correction preserves ink and alpha.
test('wan correction unifies all nine sampled papers and preserves saturated ink and alpha', () => {
  const papers = [[252,253,255], [253,255,255], [249,250,255], [250,252,253], [249,250,255], [248,249,254], [247,248,254], [244,249,253], [245,250,254]];
  const pixels = new Uint8ClampedArray(papers.flatMap((paper) => [...paper, 255]));
  assert.equal(normalizeWanPaper(pixels), pixels);
  for (let i = 0; i < papers.length; i++) {
    assert.deepEqual([...pixels.slice(i * 4, i * 4 + 4)], [...WAN_PAPER_RGB, 255]);
  }
  const ink = new Uint8ClampedArray([180, 20, 40, 255, 12, 16, 22, 128, 255, 245, 223, 0]);
  const before = [...ink];
  normalizeWanPaper(ink);
  assert.deepEqual([...ink.slice(0, 8)], before.slice(0, 8));
  assert.equal(ink[11], 0);
});

// 过渡区线性混合，阈值以内不动；防止整张加滤镜导致黑红墨迹泛灰。
// Linear transition and unchanged below-threshold pixels prevent global tinting from washing out ink.
test('wan correction clamps paper weights and blends intermediate gray', () => {
  assert.equal(WAN_PAPER_START, 200);
  assert.equal(WAN_PAPER_END, 240);
  const pixels = new Uint8ClampedArray([200, 220, 255, 255, 220, 220, 220, 128, 240, 240, 240, 255]);
  normalizeWanPaper(pixels);
  assert.deepEqual([...pixels], [200, 220, 255, 255, 238, 233, 222, 128, 255, 245, 223, 255]);
});

// Canvas只创建临时显示副本，原图对象不改；每个万牌等级仍使用用户原图对应矩形。
// Canvas creates a temporary display copy without mutating the source; each rank retains its original crop.
test('display atlas and painter reuse all nine original crops without touching source', () => {
  const image = Object.freeze({ source: 'original' });
  const data = { data: new Uint8ClampedArray([255, 255, 255, 255]) };
  const draws = [];
  const context = {
    drawImage: (...args) => draws.push(args),
    getImageData: () => data,
    putImageData: (result) => assert.equal(result, data),
    save() {}, restore() {}, clearRect() {}, fillRect() {}, strokeRect() {},
  };
  const canvas = { getContext: () => context };
  assert.equal(createWanDisplayAtlas(image, () => canvas), canvas);
  assert.deepEqual([canvas.width, canvas.height], [571, 109]);
  assert.equal(draws[0][0], image);
  assert.deepEqual([...data.data], [255, 245, 223, 255]);
  for (let rank = 1; rank <= 9; rank++) {
    assert.equal(paintWanFace(context, 60, 80, { suit: 'wan', rank }, canvas), true);
    assert.deepEqual(draws.at(-1), [canvas, ...WAN_FACE_CROPS[rank - 1], 0, 0, 60, 80]);
  }
  for (const tile of [null, {}, { suit: 'dots', rank: 1 }, { suit: 'wan', rank: 0 }, { suit: 'wan', rank: 10 }]) {
    assert.equal(paintWanFace(context, 60, 80, tile, canvas), false);
  }
  assert.throws(() => createWanDisplayAtlas(image, () => ({ getContext: () => null })), /unavailable/);
});

// SVG不建立异步图集，不在背牌或条筒上挂滤镜；实例ID与sRGB保证牌区互不影响。
// SVG adds no async atlas or correction to hidden/bamboo/dot tiles; instance IDs and sRGB isolate tile areas.
test('classic tile gates an instance-local sRGB filter to wan faces only', () => {
  const component = readFileSync(new URL('../src/MahjongTile.vue', import.meta.url), 'utf8');
  assert.match(component, /face\.value\?\.url === MAHJONG_WAN_URL/);
  assert.match(component, /wan-paper-\$\{useId\(\)\}/);
  assert.match(component, /<defs v-if="isWanFace">/);
  assert.match(component, /color-interpolation-filters="sRGB"/);
  assert.match(component, /:filter="isWanFace \?/);
  assert.match(component, /255 \/ \(WAN_PAPER_END - WAN_PAPER_START\)/);
  assert.equal((component.match(/mode="darken"/g) ?? []).length, 2);
});
