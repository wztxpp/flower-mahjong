// 新万牌图集契约：保留用户原图、九张有效视窗和旧编号边界，不在此测试玩法。
// Wan atlas contract: original bytes, nine valid viewports and preserved old-ID boundaries, not game rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  MAHJONG_WAN_URL,
  MAHJONG_WAN_WIDTH,
  MAHJONG_WAN_HEIGHT,
  MAHJONG_WAN_SOURCE_SHA256,
  WAN_FACE_CROPS,
  wanFaceTransform,
} from '../src/mahjong-wan-faces.js';

// 哈希与PNG头对应用户571×109原图，防止误提交重画或其他图集。
// Hash and PNG header identify the user's 571×109 original, rejecting redraws or other atlases.
test('wan atlas preserves original user PNG bytes and dimensions', () => {
  const bytes = readFileSync(new URL(`../public${MAHJONG_WAN_URL}`, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), MAHJONG_WAN_SOURCE_SHA256);
  assert.equal(bytes.readUInt32BE(16), MAHJONG_WAN_WIDTH);
  assert.equal(bytes.readUInt32BE(20), MAHJONG_WAN_HEIGHT);
});

// 各窗都位于原图内部、等比且互不重叠；空值不能被数字强转而暴露牌面。
// All crops stay in bounds, proportional and disjoint; null must not coerce to a revealed tile.
test('nine wan faces map IDs 18–26 with proportional, bounded viewports', () => {
  assert.equal(WAN_FACE_CROPS.length, 9);
  for (const [index, [left, top, width, height]] of WAN_FACE_CROPS.entries()) {
    assert.equal(width / height, 3 / 4);
    assert.ok(left >= 0 && top >= 0);
    assert.ok(left + width <= MAHJONG_WAN_WIDTH && top + height <= MAHJONG_WAN_HEIGHT);
    if (index > 0) assert.ok(left >= WAN_FACE_CROPS[index - 1][0] + width);
    assert.match(wanFaceTransform(index + 18), /^matrix\(/);
  }
  for (const tile of [null, undefined, '', '18', -1, 0, 17, 18.5, 27, NaN, Infinity]) {
    assert.equal(wanFaceTransform(tile), null);
  }
});
