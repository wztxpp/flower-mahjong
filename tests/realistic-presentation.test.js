// 只检查既有音频分组之外的视觉附着：不改变音频事件对象、分组数量或原历史。
// Verify visual attachment beside existing audio groups, preserving audio objects, grouping and source history.
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachRealisticVisualBatches, realisticVisualEvents } from '../src/realistic-presentation.js';

const event = (index, type, extra = {}) => ({ eventKey: `room:game:${index}`, type, seat: 0, tile: 7, ...extra });
test('visual prefixes and silent tail retain history order without regrouping audio', () => {
  const events = [event(0, 'draw'), event(1, 'discard'), event(2, 'draw'), event(3, 'hu'), event(4, 'hu', { seat: 1 }), event(5, 'draw')];
  const groups = [[events[1]], [events[3], events[4]]];
  const original = structuredClone({ events, groups });
  const batches = attachRealisticVisualBatches(events, groups);
  assert.equal(batches.length, 2);
  assert.equal(batches[0].events, groups[0]);
  assert.equal(batches[1].events, groups[1]);
  assert.deepEqual(batches.map((batch) => batch.visualEvents.map((entry) => entry.type)), [['draw', 'discard'], ['draw', 'hu', 'hu']]);
  assert.deepEqual(batches.map((batch) => batch.trailingVisualEvents.map((entry) => entry.eventKey)), [[], ['room:game:5']]);
  assert.deepEqual({ events, groups }, original);
});
test('draw-only snapshots keep a visual-only job while nonvisual history needs none', () => {
  const batches = attachRealisticVisualBatches([event(0, 'draw')], []);
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].events, []);
  assert.equal(batches[0].visualEvents[0].type, 'draw');
  assert.deepEqual(attachRealisticVisualBatches([event(0, 'exchangeCompleted')], []), []);
});
test('visual event allowlist hides draws and private extensions without guessing pending kongs', () => {
  const events = realisticVisualEvents([
    event(0, 'draw', { secret: 'private', urls: ['private'] }),
    event(1, 'hu', { hidden: true }), event(2, 'discard'), event(3, 'robKong'),
  ]);
  assert.deepEqual(events.map(({ tile, hidden }) => [tile, hidden]), [[null, true], [null, true], [7, false]]);
  assert.equal(JSON.stringify(events).includes('private'), false);
});
