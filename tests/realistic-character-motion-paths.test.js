// 独立侧面素材只能显式启用自己的来源路径；旧图、角色和视角边界不放宽。
// Independent views explicitly opt into their own source paths; original, character and perspective boundaries remain strict.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PORTRAIT_MOTION_CHARACTERS } from '../src/portrait-motion/catalog.js';
import { validateMotionDescriptor } from '../src/portrait-motion/renderer.js';

function sideDescriptor() {
  const descriptor = structuredClone(PORTRAIT_MOTION_CHARACTERS.sweet);
  descriptor.realisticView = 'left';
  descriptor.sourceUrl = '/characters/realistic/sweet/left-base.png';
  for (const frame of descriptor.frames) frame.url = '/characters/realistic/sweet/left-eyes.png';
  return descriptor;
}
test('original descriptors remain strict and independently sourced views opt in', () => {
  assert.equal(validateMotionDescriptor(PORTRAIT_MOTION_CHARACTERS.sweet), true);
  assert.equal(validateMotionDescriptor(sideDescriptor()), true);
  const missingMarker = sideDescriptor();
  delete missingMarker.realisticView;
  assert.equal(validateMotionDescriptor(missingMarker), false);
});
test('source and donor cannot cross character, perspective or origin', () => {
  for (const sourceUrl of ['/characters/realistic/star/left-base.png', '/characters/realistic/sweet/right-base.png', 'https://example.org/sweet.png']) {
    assert.equal(validateMotionDescriptor({ ...sideDescriptor(), sourceUrl }), false);
  }
  for (const url of ['/characters/realistic/star/left-eyes.png', '/characters/realistic/sweet/right-eyes.png', '/characters/realistic/sweet/left-../eyes.png']) {
    const descriptor = sideDescriptor();
    descriptor.frames[0].url = url;
    assert.equal(validateMotionDescriptor(descriptor), false);
  }
});
test('visual excluded identity and unknown perspective cannot opt in', () => {
  assert.equal(validateMotionDescriptor({ ...sideDescriptor(), realisticView: 'rear' }), false);
  const descriptor = sideDescriptor();
  descriptor.id = 'sunny';
  descriptor.sourceUrl = '/characters/realistic/sunny/left-base.png';
  for (const frame of descriptor.frames) frame.url = '/characters/realistic/sunny/left-eyes.png';
  assert.equal(validateMotionDescriptor(descriptor), false);
});
