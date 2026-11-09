// 右手动作只允许批准的同角色/视角素材；测试不代表图像接缝已验收。
// Right-arm actions admit only approved same-role/view assets; these tests do not certify visual seams.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRealisticAction, realisticHandFrame, REALISTIC_ACTION_FRAME_MS } from '../src/realistic-character-actions.js';
const descriptor = () => ({ approved: true, id: 'honest', view: 'left',
  baseUrl: '/characters/realistic/honest/left-base.png', sheetUrl: '/characters/realistic/honest/left-actions.png',
  width: 100, height: 100, sheetWidth: 200, sheetHeight: 200, featherPx: 5,
  maskPolygon: [[0, 50], [90, 50], [90, 100], [0, 100]],
  frames: [[0, 0], [100, 0], [0, 100], [100, 100]].map(([x, y]) => ({ sourceRect: [x, y, 100, 100] })),
});
test('action descriptor rejects unapproved, cross-role, cross-view and malformed data', () => {
  assert.equal(validateRealisticAction(descriptor()), true);
  assert.equal(validateRealisticAction({ ...descriptor(), approved: false }), false);
  assert.equal(validateRealisticAction({ ...descriptor(), sheetUrl: '/characters/realistic/star/left-actions.png' }), false);
  assert.equal(validateRealisticAction({ ...descriptor(), baseUrl: '/characters/realistic/honest/right-base.png' }), false);
  assert.equal(validateRealisticAction({ ...descriptor(), maskPolygon: [null, [1, 2], [2, 3]] }), false);
  assert.equal(validateRealisticAction({ ...descriptor(), frames: [null, {}, {}, {}] }), false);
  assert.equal(validateRealisticAction({ ...descriptor(), width: 5000, height: 5000 }), false);
});
test('clean-plate mode requires real per-frame arm masks, not a clothing union mask alone', () => {
  const clean = { ...descriptor(), cleanPlateUrl: '/characters/realistic/honest/left-clean-plate.png' };
  assert.equal(validateRealisticAction(clean), false);
  for (const frame of clean.frames) frame.maskPolygon = [[0, 50], [90, 50], [90, 100], [0, 100]];
  assert.equal(validateRealisticAction(clean), true);
  assert.equal(validateRealisticAction({ ...clean, cleanPlateUrl: '/characters/realistic/honest/right-clean-plate.png' }), false);
});
test('same real sequence plays forward or backward and ends without looping', () => {
  assert.equal(realisticHandFrame('discard', 0), 0);
  assert.equal(realisticHandFrame('discard', REALISTIC_ACTION_FRAME_MS), 1);
  assert.equal(realisticHandFrame('draw', 0), 3);
  assert.equal(realisticHandFrame('draw', REALISTIC_ACTION_FRAME_MS * 3), 0);
  assert.equal(realisticHandFrame('discard', REALISTIC_ACTION_FRAME_MS * 4), null);
  for (const type of ['mingGang', 'anGang', 'buGang', 'addGang']) assert.equal(realisticHandFrame(type, 0), 0);
  assert.equal(realisticHandFrame('peek', 0), null);
  assert.equal(realisticHandFrame('discard', -1), null);
  assert.equal(realisticHandFrame('discard', NaN), null);
});
