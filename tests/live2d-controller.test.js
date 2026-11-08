// 纯生命周期回归，不把测试替身当作 GPU/模型绘制证据。
// Pure lifecycle regressions; renderer doubles are not evidence of GPU/model rendering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PortraitController } from '../src/live2d/portrait-controller.js';
import { LIVE2D_CHARACTERS, live2DCharacterFor } from '../src/live2d/catalog.js';

const descriptor = { id: 'sweet' };
const active = { descriptor, enabled: true, visible: true, foreground: true, reducedMotion: false, reaction: 'base' };
const tick = async () => { for (let index = 0; index < 6; index += 1) await Promise.resolve(); };

function fixture(overrides = {}) {
  const statuses = [];
  const instances = [];
  const controller = new PortraitController({
    onStatus: (status) => statuses.push(status),
    async createRenderer(onError) {
      const instance = {
        loaded: false, starts: 0, stops: 0, releases: 0, onError,
        async load() { this.loaded = true; },
        start() { this.starts += 1; },
        stop() { this.stops += 1; },
        dispose() { this.releases += 1; this.loaded = false; },
        ...overrides,
      };
      instances.push(instance);
      return instance;
    },
  });
  return { controller, statuses, instances };
}

test('only visible foreground base art starts, reactions pause and reuse the same model', async () => {
  const { controller, instances } = fixture();
  for (const hidden of [{ visible: false }, { foreground: false }, { reducedMotion: true }, { reaction: 'win' }, { enabled: false }]) {
    controller.sync({ ...active, ...hidden });
    await tick();
    assert.equal(instances.length, 0);
  }
  controller.sync(active);
  await tick();
  assert.equal(controller.status, 'live2d');
  for (const reaction of ['win', 'discardLoss']) {
    controller.sync({ ...active, reaction });
    assert.equal(controller.status, 'original');
    controller.sync(active);
    assert.equal(controller.status, 'live2d');
  }
  assert.equal(instances.length, 1);
  assert.equal(instances[0].releases, 0);
  controller.dispose();
  assert.equal(instances[0].releases, 1);
});

test('role changes and unmount invalidate pending factories without releasing the current role', async () => {
  const pending = [];
  const controller = new PortraitController({ createRenderer: (onError, isCurrent) => new Promise((resolve) => pending.push({ resolve, isCurrent })) });
  controller.sync(active);
  const second = { ...active, descriptor: { id: 'sunny' } };
  controller.sync(second);
  const old = { releases: 0, dispose() { this.releases += 1; } };
  const current = { loaded: false, releases: 0, async load() { this.loaded = true; }, start() {}, dispose() { this.releases += 1; } };
  assert.equal(pending[0].isCurrent(), false);
  assert.equal(pending[1].isCurrent(), true);
  pending[1].resolve(current);
  pending[0].resolve(old);
  await tick();
  assert.equal(current.releases, 0);
  assert.equal(old.releases, 1);
  assert.equal(controller.status, 'live2d');
  controller.dispose();
  assert.equal(current.releases, 1);
  assert.equal(pending[1].isCurrent(), false);
});

test('load errors and throwing cleanup cannot strand pending state or block fallback', async () => {
  const { controller, instances } = fixture({
    async load() { throw new Error('asset failure'); },
    dispose() { throw new TypeError('deleteProgram(0)'); },
  });
  controller.sync(active);
  await tick();
  assert.equal(controller.failed, true);
  assert.equal(controller.pending, false);
  assert.equal(controller.renderer, null);
  assert.equal(controller.status, 'fallback');
  controller.sync(active);
  await tick();
  assert.equal(instances.length, 1);
  controller.dispose();
});

test('context failure restores original art and a different role can load again', async () => {
  const { controller, instances } = fixture();
  controller.sync(active);
  await tick();
  instances[0].onError(new Error('context lost'));
  assert.equal(controller.status, 'fallback');
  controller.sync({ ...active, descriptor: { id: 'star' } });
  await tick();
  assert.equal(controller.status, 'live2d');
  assert.equal(instances.length, 2);
  controller.dispose();
});

test('catalog never substitutes a different character and unrecovered models remain disabled', () => {
  assert.equal(Object.keys(LIVE2D_CHARACTERS).length, 7);
  assert.equal(live2DCharacterFor('not-a-character'), null);
  for (const [id, entry] of Object.entries(LIVE2D_CHARACTERS)) {
    assert.equal(entry.modelUrl, `/live2d/${id}/character.model3.json`);
    assert.equal(entry.backgroundUrl, `/live2d/${id}/background.png`);
    assert.ok(Object.isFrozen(entry.verifiedBindings));
    if (!entry.available) assert.equal(live2DCharacterFor(id), null);
    assert.ok(!entry.verifiedBindings.includes('ParamHairFront'));
    assert.ok(!entry.verifiedBindings.some((value) => value.includes('Mouth')));
  }
});


// 已开始的模型加载拥有可释放实例，停用立即释放并使其迟到完成失效；重新启用生成新实例。
// A pending model load already owns a disposable instance; disabling releases it and invalidates late completion before re-enabling.
test('disabling aborts an in-flight renderer and re-enabling never adopts its stale result', async () => {
  const pending = [];
  const { controller, instances } = fixture({
    load() { return new Promise((resolve) => pending.push(() => { this.loaded = true; resolve(); })); },
  });
  controller.sync(active);
  await tick();
  assert.equal(instances.length, 1);
  controller.sync({ ...active, enabled: false });
  assert.equal(instances[0].releases, 1);
  assert.equal(controller.pending, false);
  assert.equal(controller.status, 'original');
  controller.sync(active);
  await tick();
  assert.equal(instances.length, 2);
  pending[0]();
  await tick();
  assert.notEqual(controller.status, 'live2d');
  assert.equal(instances[1].releases, 0);
  pending[1]();
  await tick();
  assert.equal(controller.status, 'live2d');
  controller.dispose();
});
