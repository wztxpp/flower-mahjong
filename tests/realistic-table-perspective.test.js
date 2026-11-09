// 使用与真实CSS相同的单应矩阵验证梯形和近沿锚点；不把纯数学检查称为浏览器像素验收。
// Verify trapezoid and near-edge anchors against the actual CSS homography without claiming browser pixel acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REALISTIC_ROOM_SCENE, projectRealisticTablePoint, realisticTableProjectionTransform, realisticSceneCamera, clampRealisticScenePan } from '../src/realistic-table-perspective.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);
test('seated table has a narrower far edge and one continuous projective plane', () => {
  for (const [point, expected] of [
    [{ x: 0, y: 0 }, { x: 310, y: 260 }],
    [{ x: 1000, y: 0 }, { x: 1050, y: 260 }],
    [{ x: 0, y: 1000 }, { x: 90, y: 830 }],
    [{ x: 1000, y: 1000 }, { x: 1270, y: 830 }],
  ]) {
    const actual = projectRealisticTablePoint(point);
    close(actual.x, expected.x);
    close(actual.y, expected.y);
  }
  const far = projectRealisticTablePoint({ x: 500, y: 0 });
  const near = projectRealisticTablePoint({ x: 500, y: 1000 });
  close(far.x, near.x);
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
      const pan = clampRealisticScenePan({ x: 0, y: -1e6 }, width, height, zoom);
      const moved = realisticSceneCamera(width, height, zoom, pan);
      close(moved.y - camera.y, pan.y);
      const anchor = projectRealisticTablePoint({ x: 500, y: 1000 });
      close(moved.y + anchor.y * moved.scale - camera.y - anchor.y * camera.scale, pan.y);
      assert.ok(moved.y + foot.y * moved.scale <= height, 'The table feet can be brought into view');
    }
  }
});
