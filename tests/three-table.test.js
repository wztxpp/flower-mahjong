// 三维适配与生命周期使用合成公开视图；不读真实房间，不依赖GPU驱动。
// Adapter/lifecycle tests use synthetic public views, never real rooms or GPU drivers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Three from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildThreeTableModel, tileGrid, TABLE_ZONES } from '../src/three-table/adapter.js';
import { createSceneLifetime, createFrameGate } from '../src/three-table/lifecycle.js';
import { realisticCharacterView } from '../src/realistic-character-catalog.js';
import { REALISTIC_FLIGHT_DURATION_MS, REALISTIC_FLIGHT_STAGGER_MS } from '../src/realistic-presentation.js';
import * as photo from '../src/mahjong-photo-faces.js';
import * as wan from '../src/mahjong-wan-faces.js';

function state(count = 3, mode = 'flower') {
  return { id: 'synthetic-room', you: 0, gameMode: mode, game: {
    id: 'synthetic-game', gameMode: mode, schemaVersion: 3, phase: 'turn', mySeat: 0,
    wallCount: 70, sharedRadishes: [0, 8, 17], pendingKongRadishes: 2, discards: [],
    players: Array.from({ length: count }, (_, seat) => ({ seat, hand: [seat, 8, 17], handCount: 3, score: 0, huCount: 0, melds: [], winPile: [], radishes: [] })),
  } };
}

test('Three adapter excludes walls and preserves hidden-identity noninterference', () => {
  for (const count of [3, 4]) {
    const first = state(count);
    first.game.players[1].melds = [{ type: 'anGang', hidden: true, tiles: [2, 2, 2, 2] }];
    const second = structuredClone(first);
    second.game.players[1].hand = [10, 11, 12];
    second.game.players[1].melds[0].tiles = [15, 15, 15, 15];
    assert.deepEqual(buildThreeTableModel(first), buildThreeTableModel(second));
    const model = buildThreeTableModel(first);
    assert.equal(model.seats.length, count);
    assert.equal('walls' in model, false);
    assert.equal(model.wallCount, 70);
    assert.equal(model.seats.find((seat) => seat.seat === 0).hand[0].hidden, false);
    assert.equal(model.seats.find((seat) => seat.seat === 1).hand.every((tile) => tile.hidden && tile.tile === null), true);
  }
});

test('spectator never inherits private hand; Chengdu keeps wan and personal radishes stay personal', () => {
  const view = state(4, 'chengdu');
  view.game.players[0].hand = [18, 26];
  assert.equal(buildThreeTableModel(view).seats[0].hand[1].tile, 26);
  view.viewerRole = 'spectator';
  assert.equal(buildThreeTableModel(view).seats.every((seat) => seat.hand.every((tile) => tile.hidden)), true);
  const legacy = state();
  legacy.game.schemaVersion = 2;
  legacy.game.players[1].radishes = [7];
  const model = buildThreeTableModel(legacy);
  assert.equal(model.radishMode, 'personal');
  assert.deepEqual(model.radishes, []);
  assert.equal(model.seats.find((seat) => seat.seat === 1).personalRadishes[0].tile, 7);
});

test('unbounded public zones fit all tiles without truncation or overlap across zone boundaries', () => {
  for (const area of Object.values(TABLE_ZONES)) for (const count of [0, 1, 18, 36, 144, 360]) {
    const positions = tileGrid(count, area);
    assert.equal(positions.length, count);
    for (const point of positions) {
      assert.ok(point.scale > 0);
      assert.ok(point.x - 0.24 * point.scale >= area.x - area.width / 2 - 1e-9);
      assert.ok(point.x + 0.24 * point.scale <= area.x + area.width / 2 + 1e-9);
      assert.ok(point.z - 0.345 * point.scale >= area.z - area.depth / 2 - 1e-9);
      assert.ok(point.z + 0.345 * point.scale <= area.z + area.depth / 2 + 1e-9);
    }
  }
});

test('mount baseline, FIFO sequence, room/game identity and reset never replay stale frames', () => {
  const gate = createFrameGate(8);
  const model = { roomId: 'room', gameId: 'game' };
  const frame = { sequence: 8, roomId: 'room', gameId: 'game', events: [{ eventKey: 'one' }] };
  assert.equal(gate(frame, model), null);
  assert.equal(gate({ ...frame, sequence: 9, roomId: 'old' }, model), null);
  assert.deepEqual(gate({ ...frame, sequence: 10 }, model), frame.events);
  assert.deepEqual(gate({ ...frame, sequence: 11, reset: true }, model), []);
  assert.equal(gate({ ...frame, sequence: 10 }, model), null);
});

test('lifetime cleanup is reverse ordered, idempotent and rejects late allocations', () => {
  const lifetime = createSceneLifetime();
  const order = [];
  lifetime.add(() => order.push(1));
  lifetime.add(() => order.push(2));
  lifetime.dispose();
  lifetime.dispose();
  lifetime.add(() => order.push(3));
  assert.deepEqual(order, [2, 1, 3]);
  assert.equal(lifetime.disposed, true);
});

// 用真实Three几何/材质搭配无GPU的宿主，执行真实renderer初始化、更新、飞牌和释放。
// Execute actual renderer setup/update/flights/disposal using real Three resources and a GPU-free host.
function rendererHarness({ failSetup = false, failRender = false } = {}) {
  const counters = { disposed: 0, removed: 0, cancelled: 0, observer: 0, controls: 0, failed: 0, geometry: 0, material: 0, texture: 0 };
  const callbacks = new Map();
  const images = [];
  let frame;
  let scene;
  class FakeRenderer {
    constructor() {
      this.shadowMap = {};
      this.domElement = { setAttribute() {}, remove() { counters.removed++; }, addEventListener(name, callback) { callbacks.set(name, callback); }, removeEventListener(name) { callbacks.delete(name); } };
    }
    setPixelRatio() { if (failSetup) throw new Error('setup failed'); }
    setSize() {}
    render(value) { if (failRender) throw new Error('render failed'); scene = value; }
    dispose() { counters.disposed++; }
  }
  class FakeControls {
    constructor() { this.target = new Three.Vector3(); }
    update() {}
    dispose() { counters.controls++; }
  }
  const context = { fillRect() {}, fillText() {}, drawImage() {} };
  const document = { hidden: false, createElement: () => ({ getContext: () => context }) };
  class Image { constructor() { images.push(this); } }
  class ResizeObserver { observe() {} disconnect() { counters.observer++; } }
  const globals = { THREE: { ...Three, WebGLRenderer: FakeRenderer }, OrbitControls: FakeControls, RoundedBoxGeometry,
    ...photo, ...wan, realisticCharacterView, TABLE_ZONES, tileGrid, createSceneLifetime,
    REALISTIC_FLIGHT_DURATION_MS, REALISTIC_FLIGHT_STAGGER_MS, document, Image, ResizeObserver,
    requestAnimationFrame: (callback) => { frame = callback; return 3; }, cancelAnimationFrame: () => { counters.cancelled++; } };
  const source = fs.readFileSync(new URL('../src/three-table/renderer.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('export function', 'function');
  const createRenderer = new Function(...Object.keys(globals), `${source}\nreturn createThreeTableRenderer;`)(...Object.values(globals));
  const host = { appendChild() {}, getBoundingClientRect: () => ({ width: 1000, height: 700 }) };
  const api = () => createRenderer(host, { onFailure: () => counters.failed++ });
  return { api, counters, images, callbacks, tick: () => frame(performance.now() + 100), scene: () => scene };
}

test('real renderer disposes its canvas, listeners, observer, RAF, resources and late images', () => {
  const harness = rendererHarness();
  const renderer = harness.api();
  renderer.update(buildThreeTableModel(state()), () => null, false);
  harness.tick();
  const resources = new Set();
  harness.scene().traverse((object) => {
    if (object.geometry) resources.add(object.geometry);
    if (object.material) { resources.add(object.material); if (object.material.map) resources.add(object.material.map); }
  });
  let disposed = 0;
  for (const resource of resources) resource.addEventListener('dispose', () => disposed++);
  renderer.present([{ type: 'draw', eventKey: 'draw', seat: 1, tile: 4 }]);
  harness.tick();
  const flight = harness.scene().children.at(-1).children[0];
  assert.equal(flight.children.length, 2, 'draw event ignores accidental identity and creates no face mesh');
  renderer.present([{ type: 'anGang', eventKey: 'kong', seat: 1, tile: 4, hidden: true }]);
  harness.tick();
  assert.equal(harness.scene().children.at(-1).children[0].children.length, 2, 'hidden dominates public-looking event identity');
  renderer.setFocus(true);
  renderer.setFocus(false);
  renderer.dispose();
  renderer.dispose();
  assert.equal(disposed, resources.size);
  assert.equal(harness.counters.disposed, 1);
  assert.equal(harness.counters.removed, 1);
  assert.equal(harness.counters.cancelled, 1);
  assert.equal(harness.counters.observer, 1);
  assert.equal(harness.counters.controls, 1);
  assert.equal(harness.callbacks.size, 0);
  assert.equal(harness.images.every((image) => image.onload === null && image.onerror === null), true);
});

test('partial setup and render failures dispose before requesting classic fallback', () => {
  const setup = rendererHarness({ failSetup: true });
  assert.throws(setup.api, /setup failed/);
  assert.equal(setup.counters.disposed, 1);
  const render = rendererHarness({ failRender: true });
  render.api();
  render.tick();
  assert.equal(render.counters.disposed, 1);
  assert.equal(render.counters.failed, 1);
});

test('context loss triggers classic fallback without changing authoritative state', () => {
  const harness = rendererHarness();
  const renderer = harness.api();
  let prevented = false;
  harness.callbacks.get('webglcontextlost')({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(harness.counters.failed, 1);
  renderer.dispose();
});
