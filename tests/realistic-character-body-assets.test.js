// 完整坐姿的构建门：核对实物PNG、尺寸、hash与未改动的上身坐标，候选预览不能混入正式目录。
// Full-body build gate checks real PNG bytes, dimensions, hashes and unchanged upper coordinates, excluding preview candidates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { REALISTIC_CHARACTER_IDS, realisticCharacterView } from '../src/realistic-character-catalog.js';
import { realisticBodyModel, realisticPovModel } from '../src/realistic-character-body.js';
const audit = JSON.parse(readFileSync(new URL('../public/characters/realistic/full-body-audit.json', import.meta.url)));
function png(url, size, sha) {
  assert.doesNotMatch(url, /body-review|candidate|inspection|green|\.\./);
  const bytes = readFileSync(new URL(`../public${url}`, import.meta.url));
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], size);
  assert.equal(bytes[25], 6, 'Character layers retain real PNG alpha');
  if (sha) assert.equal(createHash('sha256').update(bytes).digest('hex'), sha);
}
test('all eighteen approved seated layers match PNG provenance and preserve upper motion coordinates', () => {
  let count = 0;
  for (const id of REALISTIC_CHARACTER_IDS) for (const position of ['front', 'left', 'right']) {
    const view = realisticCharacterView(id, position);
    const body = realisticBodyModel(view);
    assert.ok(body, `${id}/${position}`);
    assert.equal(audit[id][position].approved, true);
    assert.deepEqual(view.body.upperRect.slice(2), [view.width, view.height]);
    assert.equal(view.motion.sourceUrl, view.baseUrl);
    png(body.lowerBodyUrl, body.lowerSourceSize, audit[id][position].lowerSha256);
    for (const patch of body.sleevePatches) png(patch.url, patch.sourceSize);
    count += 1;
  }
  assert.equal(count, 18);
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
