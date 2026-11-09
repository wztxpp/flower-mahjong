// 使用与真实CSS相同的单应矩阵验证梯形和近沿锚点；不把纯数学检查称为浏览器像素验收。
// Verify trapezoid and near-edge anchors against the actual CSS homography without claiming browser pixel acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REALISTIC_ROOM_SCENE, projectRealisticTablePoint, realisticTableProjectionTransform, realisticSceneCamera, clampRealisticScenePan, realisticPrivateTileSize, REALISTIC_TABLE_ART } from '../src/realistic-table-perspective.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);
test('seated table has a narrower far edge and one continuous projective plane', () => {
  for (const [point, expected] of [
    [{ x: 0, y: 0 }, { x: 318, y: 273 }],
    [{ x: 1000, y: 0 }, { x: 1038, y: 273 }],
    [{ x: 0, y: 1000 }, { x: 135, y: 749 }],
    [{ x: 1000, y: 1000 }, { x: 1222, y: 749 }],
  ]) {
    const actual = projectRealisticTablePoint(point);
    close(actual.x, expected.x);
    close(actual.y, expected.y);
  }
  const far = projectRealisticTablePoint({ x: 500, y: 0 });
  const near = projectRealisticTablePoint({ x: 500, y: 1000 });
  assert.ok(Math.abs(far.x - near.x) < 1, 'Measured PNG rounding remains under one source pixel');
  assert.ok(near.y > far.y);
  const values = realisticTableProjectionTransform().slice(9, -1).split(',').map(Number);
  assert.equal(values.length, 16);
  for (let x = 0; x <= 1000; x += 125) {
    for (let y = 0; y <= 1000; y += 125) {
      const denominator = values[3] * x + values[7] * y + values[15];
      const point = projectRealisticTablePoint({ x, y });
      close((values[0] * x + values[4] * y + values[12]) / denominator, point.x);
      close((values[1] * x + values[5] * y + values[13]) / denominator, point.y);
      assert.ok(denominator > 0, 'No plane crosses the projective horizon');
    }
  }
});

test('camera moves the projected table and near controls together while retaining real under-table reach', () => {
  assert.deepEqual(REALISTIC_ROOM_SCENE, { width: 1360, height: 1700, focusHeight: 950 });
  const foot = { x: 680, y: 1655 };
  for (const [width, height] of [[320, 560], [390, 660], [1185, 620], [1440, 760]]) {
    for (const zoom of [1, 2]) {
      const camera = realisticSceneCamera(width, height, zoom);
      const nearRack = projectRealisticTablePoint({ x: 500, y: 1000 });
      assert.ok(camera.y + (nearRack.y - 20) * camera.scale <= height - 52 + 1e-6, 'Zoom keeps the rack reachable without laying it over rivers');
      const pan = clampRealisticScenePan({ x: 0, y: -1e6 }, width, height, zoom);
      const moved = realisticSceneCamera(width, height, zoom, pan);
      close(moved.y - camera.y, pan.y);
      const anchor = projectRealisticTablePoint({ x: 500, y: 1000 });
      close(moved.y + anchor.y * moved.scale - camera.y - anchor.y * camera.scale, pan.y);
      assert.ok(moved.y + foot.y * moved.scale <= height, 'The table feet can be brought into view');
    }
  }
});

// 同一实体高度在四个查看方向都朝上，不随玩家旋转变成左右厚度。
// A shared physical elevation lifts toward screen-up in every seat, never rotating into sideways thickness.
test('solid elevation agrees with CSS in all four directions and calibrated image corners', () => {
  const matrix = realisticTableProjectionTransform().slice(9, -1).split(',').map(Number);
  for (const angle of [0, 90, 180, 270]) {
    const radians = angle * Math.PI / 180;
    const x = 500 + 100 * Math.cos(radians) - 220 * Math.sin(radians);
    const y = 500 + 100 * Math.sin(radians) + 220 * Math.cos(radians);
    const base = projectRealisticTablePoint({ x, y });
    const face = projectRealisticTablePoint({ x, y, z: 9 });
    close(face.x, base.x);
    assert.ok(face.y < base.y);
    close((matrix[1] * x + matrix[5] * y + matrix[9] * 9 + matrix[13]) / (matrix[7] * y + 1), face.y);
  }
  for (const [name, x, y] of [['TL', 0, 0], ['TR', 1000, 0], ['BR', 1000, 1000], ['BL', 0, 1000]]) {
    const point = projectRealisticTablePoint({ x, y });
    close(point.x, REALISTIC_TABLE_ART.feltQuad[name][0] + REALISTIC_TABLE_ART.sceneOffset[0]);
    close(point.y, REALISTIC_TABLE_ART.feltQuad[name][1] + REALISTIC_TABLE_ART.sceneOffset[1]);
  }
});
test('private rack scales with the same camera across viewers and resolutions', () => {
  for (const [width, height] of [[320, 560], [390, 760], [784, 560], [1280, 760]]) {
    const a = realisticSceneCamera(width, height, 1).scale;
    const b = realisticSceneCamera(width, height, 2).scale;
    const small = realisticPrivateTileSize(a), large = realisticPrivateTileSize(b);
    assert.ok(large.width > small.width);
    close(large.width, Math.max(18, 50 * b));
    close(small.width / small.height, .72);
    for (let viewer = 0; viewer < 4; viewer++) assert.deepEqual(realisticPrivateTileSize(a), small);
  }
});
