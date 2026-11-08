// 用可预测RGBA测试夹具验证打包像素，不生成或修改用户美术；临时文件由测试自己清理。
// Predictable RGBA fixtures verify packing without creating/editing user art; tests clean only their temporary files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { packMotionAtlases } from '../scripts/portraits/pack-motion-atlas.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'portrait-atlas-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pixels = Buffer.alloc(128 * 96 * 4);
  for (let row = 0; row < 96; row += 1) for (let column = 0; column < 128; column += 1) {
    const offset = (row * 128 + column) * 4;
    pixels.set([column, row, (row + column) % 256, 255], offset);
  }
  const bytes = await sharp(pixels, { raw: { width: 128, height: 96, channels: 4 } }).png().toBuffer();
  const source = join(directory, 'donor.png');
  await writeFile(source, bytes);
  const frames = ['eye20', 'eye50', 'hairLeft'].map((id) => ({ id, url: `/portrait-motion/sweet/${id}.png`, sha256: sha(bytes), width: 128, height: 96 }));
  const descriptor = { schemaVersion: 2, id: 'sweet', sourceUrl: '/characters/sweet-scene-base.png', sourceSha256: 'a'.repeat(64), width: 1254, height: 1050,
    frames,
    eyes: [{ targetRect: [400, 300, 20, 15], maskPolygon: [[400, 300], [420, 300], [420, 315]], sourceRects: { eye20: [10.25, 11.5, 20.125, 15.25], eye50: [32.75, 10.25, 18.5, 15] } },
      { targetRect: [500, 300, 20, 15], maskPolygon: [[500, 300], [520, 300], [520, 315]], sourceRects: { eye20: [60.25, 12.5, 20.125, 15.25], eye50: [85.5, 10.25, 18.5, 15] } }],
    hairRegions: [{ rect: [300, 300, 30, 60], maskPolygon: [[300, 300], [330, 300], [330, 360]], sourceRects: { hairLeft: [3.5, 30.25, 30, 50] } }],
    blinkSequence: [{ frameId: null, durationMs: 50 }, { frameId: 'eye20', durationMs: 50 }, { frameId: 'eye50', durationMs: 50 }],
    hairSequence: [{ frameId: 'hairLeft', position: -1 }, { frameId: null, position: 0 }], hairInterpolation: 'discrete',
  };
  return { directory, bytes, pixels, source, request: { descriptor, frameFiles: Object.fromEntries(frames.map((frame) => [frame.id, source])), outputDirectory: join(directory, 'packed'), publicPrefix: '/portrait-motion/sweet' } };
}

test('atlas packing preserves source bytes, exact donor RGBA, fractional crops and shared URL identity', async (t) => {
  const { request, source, bytes, pixels } = await fixture(t);
  const before = structuredClone(request.descriptor);
  const { descriptor, report } = await packMotionAtlases(request);
  assert.deepEqual(request.descriptor, before);
  assert.deepEqual(await readFile(source), bytes);
  assert.equal(report.crops.length, 5);
  assert.equal(report.atlases.length, 1);
  assert.equal(new Set(descriptor.frames.map((frame) => frame.url)).size, 1);
  assert.deepEqual(descriptor.blinkSequence, before.blinkSequence);
  assert.deepEqual(descriptor.hairSequence, before.hairSequence);
  const png = await readFile(join(request.outputDirectory, report.atlases[0].name));
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(sha(png), descriptor.frames[0].sha256);
  for (const crop of report.crops) {
    const [left, top, width, height] = crop.sourceExtract;
    const [x, y] = crop.atlasExtract;
    assert.equal(crop.rgbaIdentical, true);
    for (let row = 0; row < height; row += 1) {
      assert.deepEqual(data.subarray(((y + row) * info.width + x) * 4, ((y + row) * info.width + x + width) * 4),
        pixels.subarray(((top + row) * 128 + left) * 4, ((top + row) * 128 + left + width) * 4));
    }
    assert.equal(crop.atlasSourceRect[0] - x, crop.sourceRect[0] - left);
    assert.equal(crop.atlasSourceRect[1] - y, crop.sourceRect[1] - top);
    assert.deepEqual(descriptor[crop.kind][crop.regionIndex].sourceRects[crop.frameId], crop.atlasSourceRect);
  }
});

test('atlas bytes are deterministic and bounded pages preserve all crops from one frame together', async (t) => {
  const { request, directory } = await fixture(t);
  request.maxSize = 64;
  const one = await packMotionAtlases(request);
  const two = await packMotionAtlases({ ...request, outputDirectory: join(directory, 'again') });
  assert.deepEqual(one.report.atlases, two.report.atlases);
  assert.ok(one.report.atlases.length > 1);
  assert.ok(one.report.atlases.every((atlas) => atlas.width <= 64 && atlas.height <= 64));
  for (const frame of one.descriptor.frames) {
    const paths = new Set(one.report.crops.filter((crop) => crop.frameId === frame.id).map((crop) => crop.atlas));
    assert.equal(paths.size, 1);
  }
});

// 连续发场不伪装成图集供体；只打包真实眼形并原样保留几何契约。
// Continuous hair fields are not atlas donors; pack only real eyelid shapes and preserve the geometry contract.
test('geometry mode packs only eye donors while preserving original-texture field parameters', async (t) => {
  const { request } = await fixture(t);
  request.descriptor.hairMode = 'geometry';
  request.descriptor.frames = request.descriptor.frames.filter((frame) => frame.id !== 'hairLeft');
  delete request.descriptor.hairSequence;
  delete request.descriptor.hairInterpolation;
  delete request.descriptor.hairRegions[0].sourceRects;
  request.descriptor.hairRegions[0].geometry = { amplitudeX: 10, envelope: 'vertical' };
  const hair = structuredClone(request.descriptor.hairRegions);
  const result = await packMotionAtlases(request);
  assert.deepEqual(result.descriptor.hairRegions, hair);
  assert.equal(result.report.crops.length, 4);
  assert.ok(result.report.crops.every((crop) => crop.kind === 'eyes'));
  assert.equal(result.descriptor.hairMode, 'geometry');
  request.descriptor.hairRegions[0].sourceRects = {};
  await assert.rejects(packMotionAtlases(request), /Geometry hair/);
});

test('invalid hashes, dimensions, identities, bounds and source references fail before output', async (t) => {
  const { request } = await fixture(t);
  for (const mutate of [
    (value) => { value.descriptor.frames[0].sha256 = 'f'.repeat(64); },
    (value) => { value.descriptor.frames[0].width = 127; },
    (value) => { value.descriptor.frames[0].id = '../evil'; },
    (value) => { value.descriptor.frames[0].id = 'under_score'; },
    (value) => { value.descriptor.frames[0].id = 'a'.repeat(33); },
    (value) => { value.descriptor.frames[0].height = 4000001; },
    (value) => { value.descriptor.frames = Array(17).fill(value.descriptor.frames[0]); },
    (value) => { value.descriptor.frames[1].id = value.descriptor.frames[0].id; },
    (value) => { value.descriptor.eyes[0].sourceRects.eye20 = [-1, 0, 20, 20]; },
    (value) => { value.descriptor.eyes[0].sourceRects.eye20 = [110, 0, 20, 20]; },
    (value) => { value.descriptor.eyes[0].sourceRects.missing = [0, 0, 20, 20]; },
    (value) => { value.publicPrefix = '/arbitrary'; },
    (value) => { value.maxSize = 8192; },
    (value) => { value.gutter = 0; },
  ]) {
    const invalid = structuredClone(request);
    mutate(invalid);
    await assert.rejects(packMotionAtlases(invalid));
  }
});
