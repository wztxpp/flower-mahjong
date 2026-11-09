// 实物家具、牌区角点和版本绑定；图片更换必须重新标定，不沿用旧矩形。
// Bind actual furniture bytes to calibrated playable corners; a new PNG requires a fresh registration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import catalog from '../public/furniture/catalog.json' with { type: 'json' };
test('four generated furniture sources have real alpha and exact registered bytes', () => {
  const hashes = new Set();
  for (const item of [catalog.table, ...Object.values(catalog.chairs)]) {
    assert.equal(item.approved, true);
    const bytes = readFileSync(new URL(`../public${item.url}`, import.meta.url));
    assert.equal(bytes[25], 6);
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], item.sourceSize);
    const sha = createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha, item.sourceSha256); hashes.add(sha);
  }
  assert.equal(hashes.size, 4);
  const corners = catalog.table.feltQuad;
  assert.ok(corners.TR[0] - corners.TL[0] < corners.BR[0] - corners.BL[0]);
  for (const [x, y] of Object.values(corners)) {
    assert.ok(x >= 0 && y >= 0 && x < catalog.table.sourceSize[0] && y < catalog.table.sourceSize[1]);
  }
});
