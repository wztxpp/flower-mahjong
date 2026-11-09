// 独立整图协议拒绝拼接/错源；像素审查另有浏览器证据，纯模型只证明几何和隔离。
// Whole-image protocol rejects mixed sources. Browser evidence covers appearance; these tests prove geometry and isolation only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { realisticFigureModel, realisticFigurePlacement, realisticChairPlacement } from '../src/realistic-character-figure.js';
const fixture = () => ({ figure: { approved: true, schemaVersion: 2, sourceMode: 'singleFullBody',
  url: '/characters/realistic/star/left-full-body.png', sourceSize: [1024, 1536], sourceSha256: 'a'.repeat(64),
  contentBounds: [70, 14, 920, 1496], handContacts: { left: [822, 711], right: [565, 719] },
  seatAnchor: [403, 886], footBounds: [606, 1275, 222, 232],
  frontOfTablePolygons: [[[500, 650], [850, 650], [850, 740], [500, 740]]] } });
test('whole figure requires one approved source and bounded same-source masks', () => {
  assert.ok(realisticFigureModel(fixture()));
  for (const mutate of [
    (f) => { f.approved = false; }, (f) => { f.schemaVersion = 1; },
    (f) => { f.sourceMode = 'layered'; }, (f) => { f.sourceSha256 = 'unknown'; },
    (f) => { f.lowerBodyUrl = '/different.png'; }, (f) => { f.upperRect = [0, 0, 1024, 900]; },
    (f) => { f.footBounds = [[10, 10, 20, 20]]; },
    (f) => { f.handContacts.left = [2000, 500]; }, (f) => { f.frontOfTablePolygons[0][0] = [-1, 0]; },
  ]) { const view = fixture(); mutate(view.figure); assert.equal(realisticFigureModel(view), null); }
  const relaxed = fixture(); relaxed.figure.frontOfTablePolygons = [];
  assert.deepEqual(realisticFigureModel(relaxed).clipPolygons, [], 'Hands resting below the table do not require invented foreground parts');
});
test('all body points and mask pixels share one proportional transform', () => {
  const figure = realisticFigureModel(fixture());
  for (const position of ['left', 'right', 'north']) {
    const layout = realisticFigurePlacement(figure, position);
    assert.ok(layout.scale > 0);
    assert.equal(parseFloat(layout.style.width) / parseFloat(layout.style.height), 1024 / 1536);
    const footY = layout.y + (figure.footBounds[1] + figure.footBounds[3]) * layout.scale;
    const seatY = layout.y + figure.seatAnchor[1] * layout.scale;
    assert.ok(footY > seatY);
    assert.equal(Object.keys(layout).sort().join(','), 'scale,style,x,y', 'No independent hand, lower-body or foot translation');
  }
});
test('generated chairs use the same pelvis and floor without stretching', () => {
  const figure = realisticFigureModel(fixture());
  const urls = new Set();
  for (const orientation of ['front', 'left', 'right']) {
    const chair = realisticChairPlacement(figure, orientation);
    urls.add(chair.url);
    const width = parseFloat(chair.style.width) / 100 * 1024;
    const height = parseFloat(chair.style.height) / 100 * 1536;
    assert.ok(Math.abs(width / height - 2 / 3) < 1e-10);
  }
  assert.equal(urls.size, 3, 'Independent orientations, no image mirroring');
});
