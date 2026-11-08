// 立绘单元契约：公开事件映射、三响、独立定时器、过期回调及原始资产字节。
// Portrait contracts cover public event mapping, triple wins, independent/stale timers and original asset bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  CHARACTER_PORTRAITS, CharacterPortraitReactions, PORTRAIT_REACTION_MS,
  portraitForCharacter, portraitReactionsForEvents, warmCharacterPortraits,
} from '../src/character-portraits.js';

// 模拟计时器只由测试显式触发，包括已经被取消却晚到的回调。
// Tests explicitly fire fake timers, including callbacks arriving after cancellation.
function controller() {
  const timers = [];
  let state = {};
  const reactions = new CharacterPortraitReactions({
    onChange: (value) => { state = value; },
    setTimer: (callback, delay) => {
      const timer = { callback, delay, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => { if (timer) timer.cancelled = true; },
  });
  return { reactions, timers, state: () => state };
}

test('discard and kong-discard mark the real source; self-draw and robbery mark only the winner', () => {
  for (const source of ['discard', 'kongDiscard']) {
    assert.deepEqual(portraitReactionsForEvents([{ type: 'hu', seat: 2, fromSeat: 0, source }]),
      { 0: 'discardLoss', 2: 'win' });
  }
  for (const source of ['selfDraw', 'robKong']) {
    assert.deepEqual(portraitReactionsForEvents([{ type: 'hu', seat: 2, fromSeat: 0, source,
      payments: [{ from: 0, to: 2 }, { from: 1, to: 2 }] }]), { 2: 'win' });
  }
});

test('four-seat triple wins keep every winner and do not depend on concealed tile identities', () => {
  const events = [1, 2, 3].map((seat) => ({ type: 'hu', seat, fromSeat: 0, source: 'discard' }));
  for (const event of events) Object.defineProperty(event, 'tile', {
    get() { assert.fail('portrait mapping must not inspect tile identities'); },
  });
  assert.deepEqual(portraitReactionsForEvents(events, 4), { 0: 'discardLoss', 1: 'win', 2: 'win', 3: 'win' });
  assert.deepEqual(portraitReactionsForEvents([{ type: 'hu', seat: 0, hidden: true, source: 'selfDraw' }]), { 0: 'win' });
});

test('uncommitted requests, invalid seats, scores and unknown sources never produce reactions', () => {
  const events = [
    { type: 'respond', action: 'hu', seat: 0 }, { type: 'claim', responses: { 0: 'hu' } },
    { type: 'discard', seat: 1, tile: 0 }, { type: 'drawSettlement', payments: [{ from: 1, to: 0 }] },
    ...[-1, 3, 6, '0', null].map((seat) => ({ type: 'hu', seat, source: 'selfDraw' })),
    { type: 'hu', seat: 0, source: 'unknown' },
  ];
  assert.deepEqual(portraitReactionsForEvents(events), {});
  assert.deepEqual(portraitReactionsForEvents([{ type: 'hu', seat: 0, fromSeat: 3, source: 'discard' }]), { 0: 'win' });
  assert.deepEqual(portraitReactionsForEvents([], 7), {});
});

test('new reactions replace the same seat and stale timers cannot clear them or another seat', () => {
  const scope = controller();
  scope.reactions.present([{ type: 'hu', seat: 0, source: 'selfDraw' }], 3);
  const firstTimer = scope.timers[0];
  scope.reactions.present([{ type: 'hu', seat: 1, source: 'discard', fromSeat: 0 }], 3);
  assert.equal(firstTimer.cancelled, true);
  assert.deepEqual(scope.state(), { 0: 'discardLoss', 1: 'win' });
  firstTimer.callback();
  assert.deepEqual(scope.state(), { 0: 'discardLoss', 1: 'win' });
  scope.timers[1].callback();
  assert.deepEqual(scope.state(), { 1: 'win' });
  scope.timers[2].callback();
  assert.deepEqual(scope.state(), {});
  assert.ok(scope.timers.every((timer) => timer.delay === PORTRAIT_REACTION_MS));
});

test('ordinary events and another winner preserve existing reactions; reset invalidates all timers', () => {
  const scope = controller();
  scope.reactions.present([{ type: 'hu', seat: 0, source: 'selfDraw' }], 3);
  scope.reactions.present([{ type: 'discard', seat: 1, tile: 3 }], 3);
  assert.equal(scope.timers.length, 1);
  scope.reactions.present([{ type: 'hu', seat: 2, source: 'selfDraw' }], 3);
  assert.deepEqual(scope.state(), { 0: 'win', 2: 'win' });
  scope.reactions.reset();
  assert.deepEqual(scope.state(), {});
  assert.ok(scope.timers.every((timer) => timer.cancelled));
  scope.reactions.present([{ type: 'hu', seat: 0, source: 'selfDraw' }], 3);
  scope.timers[0].callback();
  assert.deepEqual(scope.state(), { 0: 'win' });
});

test('supplied portraits use new base paths and unsupported characters or reactions retain base art', () => {
  for (const [id, portraits] of Object.entries(CHARACTER_PORTRAITS)) {
    const character = { id, portrait: `/characters/${id}.png` };
    for (const reaction of ['win', 'discardLoss']) assert.equal(portraitForCharacter(character, reaction), portraits[reaction]);
    for (const reaction of [undefined, 'base', 'constructor', 'toString']) assert.equal(portraitForCharacter(character, reaction), portraits.base);
  }
  assert.equal(portraitForCharacter({ id: 'unknown', portrait: '/old.png' }, 'win'), '/old.png');
});

test('image warming is bounded to assigned variants and reuses page cache', () => {
  const cache = new Map();
  const createImage = () => ({});
  warmCharacterPortraits(['sweet', 'sweet', 'elegant', 'unknown'], cache, createImage);
  assert.equal(cache.size, 4);
  assert.ok([...cache.values()].every((image) => /-(win|discard-loss)\.png$/.test(image.src)));
  warmCharacterPortraits(['sweet', 'elegant'], cache, () => assert.fail('already warmed'));
  assert.equal(cache.size, 4);
});

test('all current user-supplied portrait files exactly match their provenance hashes', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/characters/portrait-reactions-manifest.json', import.meta.url)));
  assert.equal(manifest.files.length, Object.keys(CHARACTER_PORTRAITS).length * 3);
  const paths = new Set();
  for (const file of manifest.files) {
    const bytes = readFileSync(new URL(`../public${file.path}`, import.meta.url));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    assert.equal(bytes.length, file.bytes);
    assert.equal(bytes.readUInt32BE(16), 1254);
    assert.equal(bytes.readUInt32BE(20), 1050);
    assert.deepEqual(file.dimensions, [1254, 1050]);
    assert.match(file.path, /-scene-(base|win|discard-loss)\.png$/);
    assert.equal(CHARACTER_PORTRAITS[file.characterId][file.reaction], file.path);
    paths.add(file.path);
  }
  assert.equal(paths.size, manifest.files.length);
});
