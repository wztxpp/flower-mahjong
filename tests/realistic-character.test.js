// 写实人物目录专项：守住真实原画身份、无镜像回退和公开事件纯选帧。
// Focused actor tests protect original-art identity, nonmirrored fallback and public-event-only frame selection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateMotionDescriptor } from '../src/portrait-motion/renderer.js';
import { REALISTIC_CHARACTER_IDS, REALISTIC_CHARACTERS, realisticCharacterView,
  realisticViewForPosition } from '../src/realistic-character-catalog.js';

test('six visual identities retain pink neighbor and exclude yellow twin-tail girl', () => {
  assert.deepEqual(REALISTIC_CHARACTER_IDS, ['sweet', 'elegant', 'landlord', 'honest', 'wealthy', 'star']);
  const provenance = JSON.parse(readFileSync(new URL('../public/characters/portrait-reactions-manifest.json', import.meta.url)));
  for (const id of REALISTIC_CHARACTER_IDS) {
    const descriptor = REALISTIC_CHARACTERS[id];
    assert.equal(descriptor.handedness, 'right');
    assert.equal(descriptor.sourceUrl, `/characters/${id}-scene-base.png`);
    assert.ok(existsSync(new URL(`../public${descriptor.sourceUrl}`, import.meta.url)));
    assert.ok(Object.isFrozen(descriptor));
  }
  assert.equal(provenance.files.find((file) => file.characterId === 'sweet' && file.reaction === 'base').sourceFilename, '01-pink-neighbor-normal.png');
});

test('seat views are independent and unapproved or unknown assets fail closed', () => {
  assert.equal(realisticViewForPosition('left'), 'left');
  assert.equal(realisticViewForPosition('right'), 'right');
  assert.equal(realisticViewForPosition('north'), 'front');
  assert.equal(realisticViewForPosition('south'), 'front');
  assert.equal(realisticCharacterView('__proto__', 'left'), null);
  assert.equal(realisticCharacterView('sunny', 'left'), null);
  for (const id of REALISTIC_CHARACTER_IDS) {
    for (const position of ['left', 'right', 'north']) {
      const approved = realisticCharacterView(id, position);
      if (approved) {
        assert.equal(approved.approved, true);
        assert.ok(existsSync(new URL(`../public${approved.baseUrl}`, import.meta.url)));
      }
    }
  }
});

test('all eighteen approved bases and local donor atlases match their exact provenance', () => {
  const sourceHashes = new Set();
  for (const id of REALISTIC_CHARACTER_IDS) {
    for (const position of ['front', 'left', 'right']) {
      const view = realisticCharacterView(id, position);
      assert.ok(view, `${id}/${position}`);
      assert.equal(validateMotionDescriptor(view.motion), true);
      const files = [{ url: view.baseUrl, sha256: view.motion.sourceSha256, width: view.width, height: view.height }, ...view.motion.frames];
      for (const file of files) {
        const bytes = readFileSync(new URL(`../public${file.url}`, import.meta.url));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
        assert.equal(bytes.readUInt32BE(16), file.width);
        assert.equal(bytes.readUInt32BE(20), file.height);
      }
      sourceHashes.add(view.motion.sourceSha256);
      assert.equal(view.motion.realisticView, position);
      assert.deepEqual(view.motion.frames.map((frame) => frame.id).sort(), ['closed', 'half']);
    }
  }
  // 三视角必须是独立源文件；字节差异不代替人工左右饰物审查。
  // Views must use independent source files; distinct bytes do not replace human accessory-side review.
  assert.equal(sourceHashes.size, 18);
});

test('component has explicit fallback and cleanup, not mirroring or floating CSS', () => {
  const source = readFileSync(new URL('../src/RealisticCharacter.vue', import.meta.url), 'utf8');
  const artwork = readFileSync(new URL('../src/RealisticCharacterArtwork.vue', import.meta.url), 'utf8');
  assert.match(source, /original-fallback/);
  assert.match(source, /CharacterArtwork/);
  assert.match(artwork, /controller\.dispose/);
  assert.match(artwork, /observer\?\.disconnect/);
  assert.match(artwork, /prefers-reduced-motion/);
  assert.doesNotMatch(source, /scaleX\s*\(\s*-1|rotateY\s*\(\s*180|@keyframes/);
  assert.match(source, /v-if="view"/);
  assert.match(source, /v-else-if="included"/);
  assert.doesNotMatch(source, /reaction !== 'base'/);
});
