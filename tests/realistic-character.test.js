// 写实人物目录专项：守住真实原画身份、无镜像回退和公开事件纯选帧。
// Focused actor tests protect original-art identity, nonmirrored fallback and public-event-only frame selection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

test('all eighteen approved complete sources have independent bytes and disable stale donors', () => {
  const sourceHashes = new Set();
  for (const id of REALISTIC_CHARACTER_IDS) for (const position of ['front', 'left', 'right']) {
    const view = realisticCharacterView(id, position);
    const figure = view.figure;
    assert.ok(figure, `${id}/${position}`);
    assert.equal(figure.sourceMode, 'singleFullBody');
    const bytes = readFileSync(new URL(`../public${figure.url}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), figure.sourceSha256);
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], figure.sourceSize);
    assert.equal(view.motion, undefined); assert.equal(view.action, undefined);
    assert.equal(view.pov, undefined); assert.equal(view.body, undefined);
    sourceHashes.add(figure.sourceSha256);
  }
  assert.equal(sourceHashes.size, 18);
});
