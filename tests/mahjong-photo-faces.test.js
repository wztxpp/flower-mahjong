// 牌面图集、隐藏牌和本地原图资产的映射契约。
// Tile-face atlas mapping, concealed tiles and bundled reference-image contracts.
// 阅读说明见 docs/TESTING-READING-GUIDE.md；固定种子与凭证仅为测试，不应移入真实用户数据。
// See docs/TESTING-READING-GUIDE.md; seeded data and test credentials must stay separate from real user data.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  MAHJONG_PHOTO_URL,
  PHOTO_FACE_CENTERS,
  photoFaceTransform,
} from "../src/mahjong-photo-faces.js";
// 场景：照片牌面图集覆盖全部 18 种不同的条子和筒子
// Scenario: photo face atlas covers all 18 distinct bamboo and dots tiles
test("photo face atlas covers all 18 distinct bamboo and dots tiles", () => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(PHOTO_FACE_CENTERS.length, 18);
  assert.equal(new Set(PHOTO_FACE_CENTERS.map(String)).size, 18);
  for (let tile = 0; tile < 18; tile++) {
    const [u, v] = PHOTO_FACE_CENTERS[tile];
    const matrix = photoFaceTransform(tile).slice(7, -1).split(" ").map(Number);
    assert.equal(matrix.length, 6);
    assert.ok(matrix.every(Number.isFinite));
    const [a, b, c, d, e, f] = matrix;
    const x = u + 0.59 * v;
    const y = -0.45 * u + v;
    assert.ok(Math.abs(a * x + c * y + e - 30) < 1e-8);
    assert.ok(Math.abs(b * x + d * y + f - 40) < 1e-8);
  }
});
// 场景：非法或隐藏牌值不会查到照片牌面
// Scenario: invalid and hidden tile values have no photo face lookup
test("invalid and hidden tile values have no photo face lookup", () => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 逐项覆盖 [null,undefined,-1,18,.5,'0',NaN,Infinity]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [null,undefined,-1,18,.5,'0',NaN,Infinity] with the same checks, preserving the listed order.
  for (const tile of [null, undefined, -1, 18, 0.5, "0", NaN, Infinity]) {
    assert.equal(photoFaceTransform(tile), null);
  }
});
// 场景：原始参考照片原样打包，不使用外部热链
// Scenario: original reference photograph is bundled unchanged, not hotlinked
test("original reference photograph is bundled unchanged, not hotlinked", () => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(MAHJONG_PHOTO_URL, "/assets/tiles/reference-mahjong.jpg");
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const photo = readFileSync(
    new URL("../public/assets/tiles/reference-mahjong.jpg", import.meta.url),
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(photo[0], 0xff);
  assert.equal(photo[1], 0xd8);
  assert.equal(
    createHash("sha256").update(photo).digest("hex"),
    "260bda485e82697b25547d1d60255398c084445cbbd19b3b3da6e1c200ae897b",
  );
});
// 场景：牌背绝不渲染照片牌面，同时保留无障碍牌名
// Scenario: back tiles never render the photo face and accessible tile names remain
test("back tiles never render the photo face and accessible tile names remain", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const component = readFileSync(
    new URL("../src/MahjongTile.vue", import.meta.url),
    "utf8",
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.match(component, /v-if="back"/);
  assert.match(component, /v-else-if="faceTransform"/);
  assert.match(component, /:aria-label="label"/);
  assert.match(
    component,
    /:aria-pressed="interactive \? selected : undefined"/,
  );
  assert.doesNotMatch(component, /circlePositions|bambooPositions/);
});
