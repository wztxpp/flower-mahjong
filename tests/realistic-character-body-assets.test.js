// 完整坐姿的构建门：核对实物PNG、尺寸、hash与未改动的上身坐标，候选预览不能混入正式目录。
// Full-body build gate checks real PNG bytes, dimensions, hashes and unchanged upper coordinates, excluding preview candidates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { REALISTIC_CHARACTER_IDS, realisticCharacterView } from '../src/realistic-character-catalog.js';
import { realisticPovModel } from '../src/realistic-character-body.js';
import { realisticFigureModel } from '../src/realistic-character-figure.js';
function png(url, size, sha) {
  assert.doesNotMatch(url, /body-review|candidate|inspection|green|\.\./);
  const bytes = readFileSync(new URL(`../public${url}`, import.meta.url));
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], size);
  assert.equal(bytes[25], 6, 'Character layers retain real PNG alpha');
  if (sha) assert.equal(createHash('sha256').update(bytes).digest('hex'), sha);
}
test('all eighteen production figures use complete independently registered PNGs', () => {
  const hashes = new Set();
  for (const id of REALISTIC_CHARACTER_IDS) for (const position of ['front', 'left', 'right']) {
    const view = realisticCharacterView(id, position);
    const figure = realisticFigureModel(view);
    assert.ok(figure, `${id}/${position}`);
    assert.equal(view.body, undefined, 'Old upper/lower combinations are no longer active');
    assert.equal(view.motion, null); assert.equal(view.action, null);
    png(figure.url, figure.sourceSize, figure.sourceSha256);
    hashes.add(figure.sourceSha256);
  }
  assert.equal(hashes.size, 18);
});
test('six independently approved identities have correctly scoped first-person layers', () => {
  const available = [];
  for (const id of REALISTIC_CHARACTER_IDS) {
    const view = realisticCharacterView(id, 'south');
    const pov = realisticPovModel(view);
    if (!pov) continue;
    png(pov.url, pov.sourceSize, view.pov.sha256);
    available.push(id);
    assert.match(pov.url, new RegExp(`/${id}/self-pov\\.png$`));
  }
  assert.deepEqual(available, REALISTIC_CHARACTER_IDS);
  assert.equal(realisticPovModel(realisticCharacterView('sweet', 'south')).coverage, 'lower-shins-and-worn-footwear-only');
  assert.equal(realisticPovModel(realisticCharacterView('sweet', 'south')).displayWidth, 400);
  assert.equal(realisticPovModel(realisticCharacterView('honest', 'south')).displayWidth, 820);
  assert.equal(realisticPovModel(realisticCharacterView('sunny', 'south')), null);
});
