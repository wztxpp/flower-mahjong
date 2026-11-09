// 已授权公开帧的实桌飞牌：目标区域和隐私优先于装饰，播放生命周期由App与组件专项验证。
// Flights from authorized public frames prioritize destination/privacy; App and component suites verify playback lifecycle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { realisticFlightForEvent } from '../src/realistic-table-events.js';
import { realisticSeatLayout, realisticZoneCenter } from '../src/realistic-table-layout.js';

const model = { seats: realisticSeatLayout([0, 1, 2, 3].map((seat) => ({ seat })), 0) };
test('draw never exposes identity and all real kong types route into the actor left meld zone', () => {
  const seat = model.seats.find((entry) => entry.seat === 2);
  const draw = realisticFlightForEvent({ type: 'draw', seat: 2, tile: 5 }, 'draw', model);
  assert.equal(draw.tile, null);
  assert.equal(draw.hidden, true);
  assert.deepEqual(draw.from, realisticZoneCenter(seat, 'wall'));
  assert.deepEqual(draw.to, realisticZoneCenter(seat, 'hand'));
  for (const type of ['peng', 'anGang', 'mingGang', 'buGang', 'addGang']) {
    const flight = realisticFlightForEvent({ type, seat: 2, tile: 5 }, type, model);
    assert.deepEqual(flight.to, realisticZoneCenter(seat, 'melds'));
  }
});
test('hu uses right winning zone and hidden public events never leak into animation props', () => {
  const seat = model.seats.find((entry) => entry.seat === 0);
  const flight = realisticFlightForEvent({ type: 'hu', seat: 0, fromSeat: 2, source: 'discard', hidden: true, tile: 7, secret: 'discarded' }, 'hu', model);
  assert.equal(flight.tile, null);
  assert.equal('secret' in flight, false);
  assert.deepEqual(flight.to, realisticZoneCenter(seat, 'wins'));
  assert.equal(realisticFlightForEvent({ type: 'robKong', seat: 0 }, 'x', model), null);
  assert.equal(realisticFlightForEvent({ type: 'discard', seat: 7 }, 'x', model), null);
});
