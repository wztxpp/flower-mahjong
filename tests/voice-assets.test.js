// 实际音频、头像和清单的完整性；不生成或上传资产。
// Integrity of actual voice files, portraits and manifests; no assets are generated or uploaded.
// 阅读说明见 docs/TESTING-READING-GUIDE.md；固定种子与凭证仅为测试，不应移入真实用户数据。
// See docs/TESTING-READING-GUIDE.md; seeded data and test credentials must stay separate from real user data.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { LEGACY_CHARACTER_IDS } from "../shared/character-assignment.js";
import { CHARACTERS, clipsForEvent } from "../src/character-audio.js";
const root = new URL("../public/", import.meta.url);
// 运行时声线绑定与原始来源清单分开：人物可以换配音，但清单不改名、不冒充重新生成或试听认证。
// Runtime voice assignment is separate from original provenance: recasting never renames sources or claims regeneration/listening.
test("runtime voice IDs resolve original manifest entries and preserve provenance labels", () => {
  const manifest = JSON.parse(readFileSync(new URL("voices/manifest.json", root), "utf8"));
  assert.equal(manifest.voices.sweet.label, "萝莉音");
  assert.equal(manifest.voices.sunny.label, "阳光少女音");
  assert.equal(manifest.quality.subjectiveListeningCompleted, false);
  assert.equal(new Set(CHARACTERS.map((character) => character.voiceId)).size, 7);
  for (const character of CHARACTERS) {
    const voice = manifest.voices[character.voiceId];
    assert.ok(voice, character.voiceId);
    assert.deepEqual(
      clipsForEvent({ type: "hu", source: "selfDraw", seat: 0 }, [character.id, "elegant", "landlord"]),
      [voice.clips.zimo.src],
    );
  }
});
// 场景：花牌仍使用原161条各不相同的叫牌音频；成麻新增63条不替换这些资源
// Scenario: flower calls retain 161 distinct generated calls alongside the wan extension
test("flower calls retain 161 distinct generated calls alongside the wan extension", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hashes = new Set();
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  for (const character of CHARACTERS) {
    const seat = 0;
    const mapping = [character.id, ...CHARACTERS.filter((other) => other.id !== character.id).slice(0, 2).map((other) => other.id)];
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
    const paths = new Set(events.flatMap((event) => clipsForEvent(event, mapping)));
    assert.equal(paths.size, 23);
    assert.equal(
      readdirSync(new URL(`voices/${character.voiceId}/`, root)).filter(
        (file) => file.endsWith(".mp3"),
      ).length,
      LEGACY_CHARACTER_IDS.includes(character.voiceId) ? 33 : 32,
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
    161,
    "Every character call must be its own generated file",
  );
});
// 场景：七个不同的 PNG 头像随语音角色一同发布
// Scenario: seven distinct PNG portraits ship with the voice characters
test("seven distinct PNG portraits ship with the voice characters", () => {
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
  assert.equal(hashes.size, 7);
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
  assert.equal(manifest.clipCount, 224);
  assert.equal(manifest.expectedClipCount, 224);
  assert.equal(manifest.storedClipCount, 227);
  assert.equal(manifest.legacyClipCount, 3);
  // 逐项覆盖 CHARACTERS；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in CHARACTERS with the same checks, preserving the listed order.
  for (const character of CHARACTERS) {
    const voice = manifest.voices[character.id];
    assert.equal(Object.keys(voice.clips).length, 32);
    assert.equal(voice.clips.hu, undefined);
    assert.equal(voice.clips.qianggang.text, "抢杠");
    if (LEGACY_CHARACTER_IDS.includes(character.id)) {
      assert.equal(voice.legacyClips.hu.src, `/voices/${character.id}/hu.mp3`);
    } else {
      assert.equal(Object.keys(voice.legacyClips || {}).length, 0);
    }
    // 逐项覆盖 [...Object.values(voice.clips),...Object.values(voice.legacyClips || {})]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in [...Object.values(voice.clips),...Object.values(voice.legacyClips || {})] with the same checks, preserving the listed order.
    for (const clip of [
      ...Object.values(voice.clips),
      ...Object.values(voice.legacyClips || {}),
    ]) {
      const bytes = readFileSync(new URL(clip.src.slice(1), root));
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        clip.sha256,
      );
    }
  }
});

// 场景：新增角色及重绘立绘不能改写原有72条语音的字节。
// Scenario: roster expansion and portrait restyling must not rewrite any of the original 72 voices.
test("original 72 voice files remain byte-for-byte unchanged", () => {
  const baseline = JSON.parse(readFileSync(new URL("fixtures/original-voice-hashes.json", import.meta.url), "utf8"));
  assert.equal(Object.keys(baseline.hashes).length, 72);
  for (const [path, expectedHash] of Object.entries(baseline.hashes)) {
    const bytes = readFileSync(new URL(path.slice(1), root));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash, path);
  }
});

// 场景：立绘来源清单与真实PNG字节、尺寸和alpha格式一致，不接受改后未更新的资源。
// Scenario: portrait provenance matches PNG bytes, dimensions and alpha format, rejecting stale manifest entries.
test("portrait manifest matches seven transparent production PNGs", () => {
  const manifest = JSON.parse(readFileSync(new URL("characters/seven-character-manifest.json", root), "utf8"));
  assert.deepEqual(manifest.files.map((entry) => entry.id).sort(), CHARACTERS.map((character) => character.id).sort());
  for (const entry of manifest.files) {
    const bytes = readFileSync(new URL(entry.path.slice(1), root));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1024, 1536]);
    assert.equal(bytes[25], 6, `${entry.id}: PNG must retain RGBA color type`);
    assert.ok(entry.fully_transparent_fraction > 0, `${entry.id}: alpha audit must report transparent pixels`);
  }
});

// 万牌扩展须保持七角色全部164条既有MP3，不仅原三角色72条。
// Wan extension preserves all164 preexisting MP3 files across seven personas, not just the first72.
test('wan extension preserves all 164 existing seven-character recordings', () => {
  const baseline = JSON.parse(readFileSync(new URL('fixtures/pre-wan-voice-hashes.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(baseline.hashes).length, 164);
  for (const [path, expectedHash] of Object.entries(baseline.hashes)) {
    const bytes = readFileSync(new URL(path.slice(1), root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash, path);
  }
});

// 63条新录音必须有对应成品、独立哈希、参考来源及原样ASR；数量增加不能冒充质量审听。
// All63 calls need actual files, unique hashes, reference provenance and raw ASR; counts do not certify listening.
test('all seven personas have nine audited original wan calls', () => {
  const manifest = JSON.parse(readFileSync(new URL('voices/manifest.json', root), 'utf8'));
  const audit = JSON.parse(readFileSync(new URL('../docs/voice-wan-audit.json', import.meta.url), 'utf8'));
  const hashes = new Set(Object.values(audit.originalAudioHashes));
  assert.equal(hashes.size, 164);
  assert.equal(Object.keys(audit.recordings).length, 63);
  assert.equal(audit.subjectiveListeningCompleted, false);
  assert.equal(audit.paidServiceUsed, false);
  assert.equal(audit.realPersonVoiceSampleUsed, false);
  assert.equal(audit.originalAudioPreserved, true);
  assert.equal(manifest.quality.wanExtension.clipCount, 63);
  for (const character of CHARACTERS) {
    const voice = manifest.voices[character.id];
    assert.equal(audit.contextualChecks[character.id].calls.length, 9);
    assert.equal(audit.contextualChecks[character.id].initialPrompt, null);
    assert.equal(typeof audit.contextualChecks[character.id].transcript, 'string');
    for (let rank = 1; rank <= 9; rank += 1) {
      const call = `wan-${rank}`;
      const expectedText = `${'一二三四五六七八九'[rank - 1]}万`;
      const clip = voice.clips[call];
      const recording = audit.recordings[`${character.id}/${call}`];
      const bytes = readFileSync(new URL(clip.src.slice(1), root));
      const hash = createHash('sha256').update(bytes).digest('hex');
      assert.equal(clip.text, expectedText);
      assert.equal(clip.src, `/voices/${character.id}/${call}.mp3`);
      assert.equal(clip.sha256, hash);
      assert.equal(recording.sha256, hash);
      assert.equal(recording.text, expectedText);
      assert.equal(recording.identity.modelInputText, `${expectedText}。`);
      assert.equal(recording.identity.voice, character.id);
      assert.equal(recording.identity.call, call);
      assert.equal(recording.identity.referenceSha256, recording.reference.sha256);
      assert.equal(recording.identity.modelRevision, '5d83992436eae1d760afd27aff78a71d676296fc');
      assert.equal(recording.mp3DecodeChecked, true);
      assert.ok(recording.durationSeconds >= 0.2 && recording.durationSeconds <= 6.5);
      assert.ok(recording.decodedRms >= 0.001);
      assert.ok(recording.mp3ClippingFraction <= 0.001);
      assert.equal(typeof recording.transcript, 'string');
      assert.equal(hashes.has(hash), false, `${character.id}/${call}: duplicate audio`);
      hashes.add(hash);
      if (recording.reference.sourceClips) {
        for (const source of recording.reference.sourceClips) {
          assert.equal(source.sha256, voice.clips[source.call].sha256);
        }
      } else {
        assert.equal(recording.reference.sha256, voice.reference.sha256);
      }
    }
  }
  assert.equal(hashes.size, 227);
});
