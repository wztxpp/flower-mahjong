// 实际音频、头像和清单的完整性；不生成或上传资产。
// Integrity of actual voice files, portraits and manifests; no assets are generated or uploaded.
// 阅读说明见 docs/TESTING-READING-GUIDE.md；固定种子与凭证仅为测试，不应移入真实用户数据。
// See docs/TESTING-READING-GUIDE.md; seeded data and test credentials must stay separate from real user data.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { CHARACTERS, clipsForEvent } from "../src/character-audio.js";
const root = new URL("../public/", import.meta.url);
// 场景：发布包包含 69 个当前使用且各不相同的生成叫牌音频，以及三个保留的旧版胡牌资源
// Scenario: release includes 69 active distinct generated calls plus three retained legacy hu assets
test("release includes 69 active distinct generated calls plus three retained legacy hu assets", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hashes = new Set();
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  for (let seat = 0; seat < 3; seat++) {
    const events = [
      ...Array.from(
        {
          length: 18,
        },
        (_, tile) => ({
          type: "discard",
          tile,
          seat,
        }),
      ),
      ...["peng", "anGang"].map((type) => ({
        type,
        seat,
      })),
      ...["selfDraw", "discard", "kongDiscard", "robKong"].map((source) => ({
        type: "hu",
        seat,
        source,
      })),
    ];
    const paths = new Set(events.flatMap((event) => clipsForEvent(event)));
    assert.equal(paths.size, 23);
    assert.equal(
      readdirSync(new URL(`voices/${CHARACTERS[seat].id}/`, root)).filter(
        (file) => file.endsWith(".mp3"),
      ).length,
      24,
    );
    // 逐项覆盖 paths；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in paths with the same checks, preserving the listed order.
    for (const path of paths) {
      const bytes = readFileSync(new URL(path.slice(1), root));
      assert.ok(
        bytes.length > 1024,
        `${path} is too short to be a generated clip`,
      );
      assert.ok(
        bytes.subarray(0, 3).toString() === "ID3" ||
          (bytes[0] === 255 && (bytes[1] & 224) === 224),
        `${path} is not MP3`,
      );
      hashes.add(createHash("sha256").update(bytes).digest("hex"));
    }
  }
  assert.equal(
    hashes.size,
    69,
    "Every character call must be its own generated file",
  );
});
// 场景：三个不同的 PNG 头像随语音角色一同发布
// Scenario: three distinct PNG portraits ship with the voice characters
test("three distinct PNG portraits ship with the voice characters", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hashes = new Set();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 逐项覆盖 CHARACTERS；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in CHARACTERS with the same checks, preserving the listed order.
  for (const character of CHARACTERS) {
    const bytes = readFileSync(new URL(character.portrait.slice(1), root));
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    hashes.add(createHash("sha256").update(bytes).digest("hex"));
  }
  assert.equal(hashes.size, 3);
});
// 场景：清单中的当前叫牌资源匹配运行时路径，并单独保留未使用胡牌音频的来源信息
// Scenario: manifest active calls match runtime paths and retain unused hu provenance separately
test("manifest active calls match runtime paths and retain unused hu provenance separately", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const manifest = JSON.parse(
    readFileSync(new URL("voices/manifest.json", root), "utf8"),
  );
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.equal(manifest.clipCount, 69);
  assert.equal(manifest.expectedClipCount, 69);
  assert.equal(manifest.storedClipCount, 72);
  assert.equal(manifest.legacyClipCount, 3);
  // 逐项覆盖 CHARACTERS；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in CHARACTERS with the same checks, preserving the listed order.
  for (const character of CHARACTERS) {
    const voice = manifest.voices[character.id];
    assert.equal(Object.keys(voice.clips).length, 23);
    assert.equal(voice.clips.hu, undefined);
    assert.equal(voice.clips.qianggang.text, "抢杠");
    assert.equal(voice.legacyClips.hu.src, `/voices/${character.id}/hu.mp3`);
    // 逐项覆盖 [...Object.values(voice.clips),...Object.values(voice.legacyClips)]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in [...Object.values(voice.clips),...Object.values(voice.legacyClips)] with the same checks, preserving the listed order.
    for (const clip of [
      ...Object.values(voice.clips),
      ...Object.values(voice.legacyClips),
    ]) {
      const bytes = readFileSync(new URL(clip.src.slice(1), root));
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        clip.sha256,
      );
    }
  }
});
