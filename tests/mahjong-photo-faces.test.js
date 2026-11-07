// 用户图集的牌种映射、完整原图字节、等比裁切与隐藏牌契约。
// User-atlas tile mapping, exact original bytes, proportional cropping and concealed-tile contracts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  MAHJONG_PHOTO_URL,
  MAHJONG_PHOTO_WIDTH,
  MAHJONG_PHOTO_HEIGHT,
  PHOTO_FACE_CROPS,
  PHOTO_FACE_CENTERS,
  photoFaceTransform,
} from '../src/mahjong-photo-faces.js';

// 每种牌必须裁出独立区域，保持圆形且完整落在原图内，矩形边界映射到视窗边界。
// Each face gets a unique in-bounds rectangle with round circles and exact viewport-edge mapping.
test('all eighteen source rectangles map proportionally into the viewport', () => {
  assert.equal(PHOTO_FACE_CROPS.length, 18);
  assert.equal(new Set(PHOTO_FACE_CROPS.map(String)).size, 18);
  for (let tile = 0; tile < 18; tile++) {
    const [left, top, width, height] = PHOTO_FACE_CROPS[tile];
    assert.ok(left >= 0 && top >= 0);
    assert.ok(left + width <= MAHJONG_PHOTO_WIDTH);
    assert.ok(top + height <= MAHJONG_PHOTO_HEIGHT);
    const matrix = photoFaceTransform(tile).slice(7, -1).split(' ').map(Number);
    assert.equal(matrix.length, 6);
    assert.ok(matrix.every(Number.isFinite));
    const [a, b, c, d, e, f] = matrix;
    assert.equal(a, d, 'artwork must not stretch');
    assert.equal(b, 0);
    assert.equal(c, 0);
    assert.ok(Math.abs(a * left + e) < 1e-8);
    assert.ok(Math.abs(d * top + f) < 1e-8);
    assert.ok(Math.abs(a * (left + width) + e - 60) < 1e-8);
    assert.ok(Math.abs(d * (top + height) + f - 80) < 1e-8);
    const [centerX, centerY] = PHOTO_FACE_CENTERS[tile];
    assert.ok(Math.abs(a * centerX + e - 30) < 1e-8);
    assert.ok(Math.abs(d * centerY + f - 40) < 1e-8);
  }
});

// 图片左半是筒、右半是条，但协议顺序相反；行内一至三、四至六、七至九不能混排。
// Image columns put dots before bamboo, opposite protocol suit order; preserve each rank's row/column.
test('source-sheet arrangement maps to bamboo first and dots second protocol IDs', () => {
  for (let tile = 0; tile < 18; tile++) {
    const [x, y] = PHOTO_FACE_CENTERS[tile];
    const rankIndex = tile % 9;
    assert.equal(x > MAHJONG_PHOTO_WIDTH / 2, tile < 9);
    assert.equal(y < 310 ? 0 : y < 590 ? 1 : 2, Math.floor(rankIndex / 3));
    if (rankIndex % 3 !== 0) assert.ok(x > PHOTO_FACE_CENTERS[tile - 1][0]);
  }
});

// 空白、隐藏牌及非法编号不能意外显示一条。
// Blank, hidden and invalid IDs must never accidentally reveal one bamboo.
test('invalid and hidden tile values have no photo face lookup', () => {
  for (const tile of [null, undefined, -1, 18, 0.5, '0', NaN, Infinity]) {
    assert.equal(photoFaceTransform(tile), null);
  }
});

// SHA-256 与 PNG 尺寸共同防止错误文件、重绘、重压缩或热链悄悄替代用户原图。
// The digest and PNG dimensions prevent a wrong file, redraw, recompression or hotlink replacing the user's original.
test('the exact user-supplied PNG is bundled locally', () => {
  assert.equal(MAHJONG_PHOTO_URL, '/assets/tiles/mahjong-faces-20261107.png');
  const photo = readFileSync(new URL(`../public${MAHJONG_PHOTO_URL}`, import.meta.url));
  assert.equal(photo.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(photo.readUInt32BE(16), MAHJONG_PHOTO_WIDTH);
  assert.equal(photo.readUInt32BE(20), MAHJONG_PHOTO_HEIGHT);
  assert.equal(createHash('sha256').update(photo).digest('hex'),
    '9a87bb7164b286fe3fb1600b3348c5153c7380cb63a0b592dd601015b91c3333');
});

// 背面分支优先且保留原生按钮与读屏语义；更换图集不能泄露对手手牌。
// Back rendering takes precedence and native button/accessibility semantics remain; atlas changes cannot expose hands.
test('back tiles never render a face and accessible tile names remain', () => {
  const component = readFileSync(new URL('../src/MahjongTile.vue', import.meta.url), 'utf8');
  assert.match(component, /v-if="back"/);
  assert.match(component, /v-else-if="face"/);
  assert.match(component, /:aria-label="label"/);
  assert.match(component, /:aria-pressed="interactive \? selected : undefined"/);
  // 尺寸现在取自所选图集记录，逐一原图/万牌数值由真实组件渲染测试核对。
  // Dimensions now come from the selected atlas record; compiled-component tests verify each actual source size.
  assert.match(component, /:width="face.width"/);
  assert.match(component, /:height="face.height"/);
  assert.doesNotMatch(component, /circlePositions|bambooPositions/);
});
