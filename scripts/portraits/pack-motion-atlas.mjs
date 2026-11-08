// 将已经生成的局部供体像素确定性打包为PNG，不生成/修饰图像内容。
// Deterministically serialize existing donor pixels into PNG atlases, without generating or retouching artwork.
// 输入JSON显式指定descriptor、frameFiles、outputDirectory与publicPrefix；只读原文件。
// Input JSON explicitly supplies descriptor, frameFiles, outputDirectory and publicPrefix; originals are read-only.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (message) => { throw new Error(message); };
const validId = (value) => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9-]{0,31}$/.test(value);

// 读取8位、无自定义ICC的PNG为RGBA。拒绝会隐式换色/降位深的输入，保留每个源采样像素。
// Decode only 8-bit PNG without custom ICC; reject implicit color/depth conversions and preserve source samples.
async function readSource(path, frame) {
  const input = await readFile(path);
  if (hash(input) !== frame.sha256) fail(`Source hash mismatch: ${frame.id}`);
  const metadata = await sharp(input).metadata();
  if (metadata.format !== 'png' || metadata.depth !== 'uchar' || metadata.icc ||
    metadata.width !== frame.width || metadata.height !== frame.height || (metadata.pages || 1) !== 1 ||
    !['srgb', 'rgb'].includes(metadata.space)) fail(`Unsupported source PNG: ${frame.id}`);
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4 || info.width !== frame.width || info.height !== frame.height) fail(`Unexpected decoded source: ${frame.id}`);
  return { data, width: info.width, height: info.height, hash: frame.sha256 };
}

// 确认小数供体框在源图内；整数外包框额外保留采样上下文，不放大或重采样。
// Validate fractional donors in bounds, then retain integer surrounding sampling context without resizing.
function sourceExtract(rect, source, gutter) {
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite) || rect[0] < 0 || rect[1] < 0 ||
    rect[2] <= 0 || rect[3] <= 0 || rect[0] + rect[2] > source.width || rect[1] + rect[3] > source.height) fail('Invalid source rectangle');
  const left = Math.max(0, Math.floor(rect[0]) - gutter);
  const top = Math.max(0, Math.floor(rect[1]) - gutter);
  const right = Math.min(source.width, Math.ceil(rect[0] + rect[2]) + gutter);
  const bottom = Math.min(source.height, Math.ceil(rect[1] + rect[3]) + gutter);
  return [left, top, right - left, bottom - top];
}

// 简单按帧打包：同一frame的所有眼/发供体必须在同张atlas，以保持frames表的唯一URL。
// Shelf-pack frame groups: all crops of one frame share an atlas, preserving a single frame URL.
function placeFrame(crops, page, maxSize) {
  let x = page.x;
  let y = page.y;
  let rowHeight = page.rowHeight;
  const placements = [];
  for (const crop of crops) {
    const [, , width, height] = crop.extract;
    if (width > maxSize || height > maxSize) fail('A donor crop exceeds the atlas bound');
    if (x + width > maxSize) { x = 0; y += rowHeight + 2; rowHeight = 0; }
    if (y + height > maxSize) return null;
    placements.push({ crop, x, y });
    x += width + 2;
    rowHeight = Math.max(rowHeight, height);
  }
  return { x, y, rowHeight, placements };
}

// 逐行复制RGBA和逐行核验，来源/目标均是完整整数像素；透明背景只存在于块间空隙。
// Copy and verify integer RGBA rows; transparent background exists only between packed crops.
function copyCrop(source, crop, target, targetWidth, x, y) {
  const [left, top, width, height] = crop.extract;
  for (let row = 0; row < height; row += 1) {
    const start = ((top + row) * source.width + left) * 4;
    source.data.copy(target, ((y + row) * targetWidth + x) * 4, start, start + width * 4);
  }
}
function verifyCrop(source, crop, target, targetWidth, x, y) {
  const [left, top, width, height] = crop.extract;
  for (let row = 0; row < height; row += 1) {
    const start = ((top + row) * source.width + left) * 4;
    const destination = ((y + row) * targetWidth + x) * 4;
    if (!source.data.subarray(start, start + width * 4).equals(target.subarray(destination, destination + width * 4))) fail('Packed PNG pixels changed');
  }
}

// 入口返回最终manifest与追溯报告，校验完成后才落盘；不覆写输入图或自动发布资产。
// Return final manifest/provenance; validate before writing outputs, never overwrite input art or publish assets.
export async function packMotionAtlases({ descriptor, frameFiles, outputDirectory, publicPrefix, maxSize = 2048, gutter = 2 }) {
  if (descriptor?.schemaVersion !== 2 || !validId(descriptor.id) || !Array.isArray(descriptor.frames) ||
    descriptor.frames.length < 2 || descriptor.frames.length > 16 || !Number.isInteger(maxSize) || maxSize < 64 || maxSize > 4096 ||
    !Number.isInteger(gutter) || gutter < 2 || gutter > 8 || typeof outputDirectory !== 'string' ||
    !new RegExp(`^/portrait-motion/${descriptor.id}$`).test(publicPrefix)) fail('Invalid pack request');
  const manifest = structuredClone(descriptor);
  const sources = new Map();
  const frames = [...manifest.frames].sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const seenIds = new Set();
  const cropsByFrame = new Map();
  for (const frame of frames) {
    if (!validId(frame.id) || seenIds.has(frame.id) || !Number.isInteger(frame.width) || !Number.isInteger(frame.height) ||
      frame.width <= 0 || frame.height <= 0 || frame.width * frame.height > 4000000 ||
      typeof frameFiles?.[frame.id] !== 'string' || !/^[a-f0-9]{64}$/.test(frame.sha256)) fail('Invalid frame/source mapping');
    seenIds.add(frame.id);
    const path = resolve(frameFiles[frame.id]);
    const cacheKey = `${path}:${frame.sha256}:${frame.width}:${frame.height}`;
    if (!sources.has(cacheKey)) sources.set(cacheKey, await readSource(path, frame));
    cropsByFrame.set(frame.id, { source: sources.get(cacheKey), path, crops: [] });
  }
  for (const [kind, regions] of [['eyes', manifest.eyes], ['hairRegions', manifest.hairRegions]]) {
    if (!Array.isArray(regions) || regions.length > 8) fail('Invalid region array');
    // 连续几何发区只采样原图，没有生成供体可打包；参数原样保留，由运行时/字段验收验证。
    // Continuous geometry hair samples original art and has no donor to pack; preserve parameters for runtime/field validation.
    if (kind === 'hairRegions' && manifest.hairMode === 'geometry') {
      if (regions.some((region) => Object.hasOwn(region, 'sourceRects'))) fail('Geometry hair cannot contain donor rectangles');
      continue;
    }
    for (const [index, region] of regions.entries()) {
      if (!region.sourceRects || typeof region.sourceRects !== 'object' || Array.isArray(region.sourceRects)) fail('Invalid sourceRects');
      for (const frameId of Object.keys(region.sourceRects).sort()) {
        const group = cropsByFrame.get(frameId);
        if (!group) fail(`Unknown frame reference: ${frameId}`);
        const rect = region.sourceRects[frameId];
        group.crops.push({ kind, index, frameId, originalRect: [...rect], extract: sourceExtract(rect, group.source, gutter), region });
      }
    }
  }
  const pages = [];
  for (const frame of frames) {
    const group = cropsByFrame.get(frame.id);
    if (!group.crops.length) fail(`Unreferenced frame: ${frame.id}`);
    let page = pages.at(-1);
    let placement = page && placeFrame(group.crops, page, maxSize);
    if (!placement) {
      page = { x: 0, y: 0, rowHeight: 0, placements: [], frameIds: [] };
      placement = placeFrame(group.crops, page, maxSize);
      if (!placement) fail('One frame cannot fit a bounded atlas');
      pages.push(page);
    }
    Object.assign(page, { x: placement.x, y: placement.y, rowHeight: placement.rowHeight });
    page.placements.push(...placement.placements);
    page.frameIds.push(frame.id);
  }
  const outputs = [];
  const report = { schemaVersion: 1, character: descriptor.id, scope: 'Lossless existing-pixel ROI packing, not new image generation', gutter, sourceFiles: [], atlases: [], crops: [] };
  for (const frame of frames) {
    const group = cropsByFrame.get(frame.id);
    report.sourceFiles.push({ frameId: frame.id, path: group.path, sha256: frame.sha256, width: frame.width, height: frame.height });
  }
  for (const [pageIndex, page] of pages.entries()) {
    const width = Math.max(...page.placements.map(({ crop, x }) => x + crop.extract[2]));
    const height = Math.max(...page.placements.map(({ crop, y }) => y + crop.extract[3]));
    // 与运行时单图预算一致；边长上限不能默许超过四百万像素的解码图。
    // Match the runtime image budget; a side limit cannot silently allow a decoded image above four million pixels.
    if (width * height > 4000000) fail('Packed atlas exceeds runtime pixel budget; reduce maxSize');
    const pixels = Buffer.alloc(width * height * 4);
    for (const { crop, x, y } of page.placements) copyCrop(cropsByFrame.get(crop.frameId).source, crop, pixels, width, x, y);
    const bytes = await sharp(pixels, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9, palette: false }).toBuffer();
    const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer();
    if (!pixels.equals(decoded)) fail('Atlas encode/decode mismatch');
    const name = `motion-atlas-${String(pageIndex).padStart(2, '0')}.png`;
    const digest = hash(bytes);
    for (const frameId of page.frameIds) Object.assign(manifest.frames.find((frame) => frame.id === frameId), { url: `${publicPrefix}/${name}`, sha256: digest, width, height });
    for (const { crop, x, y } of page.placements) {
      verifyCrop(cropsByFrame.get(crop.frameId).source, crop, decoded, width, x, y);
      const rect = [x + crop.originalRect[0] - crop.extract[0], y + crop.originalRect[1] - crop.extract[1], crop.originalRect[2], crop.originalRect[3]];
      crop.region.sourceRects[crop.frameId] = rect;
      report.crops.push({ frameId: crop.frameId, kind: crop.kind, regionIndex: crop.index, sourceRect: crop.originalRect, sourceExtract: crop.extract, atlas: name, atlasExtract: [x, y, crop.extract[2], crop.extract[3]], atlasSourceRect: rect, rgbaIdentical: true });
    }
    report.atlases.push({ name, width, height, bytes: bytes.length, sha256: digest, frameIds: page.frameIds });
    outputs.push({ name, bytes });
  }
  // 写入目标必须与所有源图路径不同，预防错误参数覆写生成原件。
  // Output paths must differ from every source path, preventing accidental replacement of generated originals.
  const destination = resolve(outputDirectory);
  const sourcePaths = new Set([...cropsByFrame.values()].map((group) => group.path));
  for (const name of [...outputs.map((item) => item.name), 'descriptor.json', 'atlas-report.json']) if (sourcePaths.has(resolve(destination, name))) fail('Output would overwrite a source');
  await mkdir(destination, { recursive: true });
  for (const output of outputs) await writeFile(resolve(destination, output.name), output.bytes);
  await writeFile(resolve(destination, 'descriptor.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(resolve(destination, 'atlas-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return { descriptor: manifest, report };
}

// CLI只接受一个显式请求JSON，不扫描目录、不下载素材、不修改正式catalog。
// CLI takes one explicit request JSON; it does not scan directories, download art or mutate production catalogs.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/portraits/pack-motion-atlas.mjs request.json');
  const result = await packMotionAtlases(JSON.parse(await readFile(resolve(process.argv[2]), 'utf8')));
  console.log(JSON.stringify(result.report));
}
