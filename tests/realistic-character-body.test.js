// 全身素材的展示边界：只接受已审查元数据，不用缺腿半身、未批准候选或错误裁切冒充完整坐姿。
// Full-body presentation accepts reviewed metadata only, never treating half-body art, candidates or invalid crops as complete seated artwork.
import test from 'node:test';
import assert from 'node:assert/strict';
import { realisticBodyModel, realisticPovModel } from '../src/realistic-character-body.js';

function view() {
  return { body: { approved: true, canvasSize: [1200, 2000], upperRect: [0, 0, 1200, 1000],
    lowerBodyUrl: '/characters/realistic/example/front-lower.png', lowerSourceSize: [1000, 1600],
    lowerSourceRect: [0, 700, 1000, 900], lowerRect: [0, 900, 1200, 1080] } };
}

test('reviewed body shares one canvas without changing the original upper-art aspect', () => {
  const input = view();
  const before = structuredClone(input);
  const model = realisticBodyModel(input);
  assert.deepEqual(model.upperStyle, { left: '0%', top: '0%', width: '100%', height: '50%' });
  assert.deepEqual(model.lowerStyle, { left: '0%', top: '45%', width: '100%', height: '54%' });
  assert.equal(model.lowerViewBox, '0 700 1000 900');
  assert.equal(model.aspectRatio, '1200 / 2000');
  assert.deepEqual(input, before);
  model.canvasSize[0] = 10;
  assert.equal(input.body.canvasSize[0], 1200);
});

test('missing, unapproved, unsafe or malformed layers leave an honest half-body fallback', () => {
  for (const input of [null, {}, { body: {} }, { body: { ...view().body, approved: false } }]) {
    assert.equal(realisticBodyModel(input), null);
  }
  for (const patch of [
    { canvasSize: [0, 1000] }, { canvasSize: [1200, Infinity] }, { upperRect: [-1, 0, 1200, 1000] },
    { upperRect: [0, 0, 1200, 2100] }, { lowerSourceRect: [0, 700, 1000, 1000] },
    { lowerRect: [0, 900, 1200, 1200] }, { lowerBodyUrl: 'https://outside.example/private.png' },
    { lowerBodyUrl: '/characters/realistic/../unreviewed.png' },
  ]) {
    assert.equal(realisticBodyModel({ body: { ...view().body, ...patch } }), null);
  }
});

// 联合裁切使用原上身局部坐标，不是全画布坐标；返回值不能与批准目录共享可写数组。
// Union clips use upper-art local coordinates rather than full-canvas coordinates, with no mutable aliases into the catalog.
test('upper clip unions normalize local source points without moving the face or mutating metadata', () => {
  const input = view();
  input.body.canvasSize = [1600, 2000];
  input.body.upperRect = [200, 0, 1200, 1000];
  input.body.upperClipPolygons = [
    [[0, 0], [1200, 0], [1200, 700], [0, 700]],
    [[200, 700], [500, 700], [350, 1000]],
  ];
  const original = structuredClone(input);
  const model = realisticBodyModel(input);
  assert.deepEqual(model.upperClipPolygons, ['0,0 1,0 1,0.7 0,0.7', `${1 / 6},0.7 ${5 / 12},0.7 ${7 / 24},1`]);
  assert.equal(model.canvasStyle.width, `${1600 / 1200 * 100}%`);
  assert.equal(model.canvasStyle.marginLeft, `${-200 / 1200 * 100}%`);
  assert.equal(model.upperStyle.left, '12.5%');
  assert.deepEqual(input, original);
  model.upperClipPolygons[0] = 'altered';
  model.lowerSourceSize[0] = 1;
  assert.deepEqual(input, original);
  assert.equal(realisticBodyModel(view()).upperClipPolygons, null);
});

// 拒绝所有越界、非数值或不足三点的裁切；异常资料退回半身，不向SVG插入NaN或用户文本。
// Reject out-of-bounds, nonnumeric and underspecified clips, falling back instead of inserting NaN or arbitrary text into SVG.
test('invalid upper clip metadata rejects the entire composed body', () => {
  const invalid = [
    {}, 'polygon(0 0)', [], [[]], [[[0, 0], [10, 10]]],
    [[[0, 0], [1201, 0], [0, 1000]]], [[[0, 0], [1200, 0], [0, 1001]]],
    [[[-1, 0], [1200, 0], [0, 1000]]], [[[0, 0], [1200, Infinity], [0, 1000]]],
    [[[0, 0], [1200, NaN], [0, 1000]]], [[[0, 0], ['1200', 0], [0, 1000]]],
    [[[0, 0], [1200, 0, 1], [0, 1000]]], [[[0, 0], null, [0, 1000]]],
  ];
  for (const upperClipPolygons of invalid) {
    assert.equal(realisticBodyModel({ body: { ...view().body, upperClipPolygons } }), null);
  }
  const offset = view();
  offset.body.canvasSize = [1600, 2000];
  offset.body.upperRect = [200, 0, 1200, 1000];
  offset.body.upperClipPolygons = [[[0, 0], [1400, 0], [0, 1000]]];
  assert.equal(realisticBodyModel(offset), null, 'canvas-valid but upper-source-invalid points are rejected');
});

// approved必须是显式布尔；允许的本地PNG目录之外任何URL或额外元数据都不能进入展示结果。
// Approval is an explicit boolean; URLs outside the local PNG directory and arbitrary extra metadata never enter the render model.
test('body metadata allowlist excludes executable URLs, invalid scalars and arbitrary output fields', () => {
  const urls = ['javascript:alert(1)', 'data:image/png;base64,AA', '//evil.example/x.png',
    '/characters/realistic/x.svg', '/characters/realistic/x.png?token=secret',
    '/characters/realistic/%2e%2e/x.png', '/characters/realistic/x.png#payload',
    '/characters/realistic/x" onload="alert(1).png'];
  for (const lowerBodyUrl of urls) assert.equal(realisticBodyModel({ body: { ...view().body, lowerBodyUrl } }), null);
  for (const approved of [undefined, null, 'true', 1, {}]) assert.equal(realisticBodyModel({ body: { ...view().body, approved } }), null);
  for (const patch of [{ canvasSize: ['1200', 2000] }, { lowerSourceSize: [1000, -1] },
    { lowerSourceRect: [0, 0, NaN, 900] }, { upperRect: [0, 0, 1200, '1000'] },
    { lowerRect: [0, -1, 1200, 1080] }]) assert.equal(realisticBodyModel({ body: { ...view().body, ...patch } }), null);
  const input = view();
  input.body.onLoad = 'malicious'; input.body.privateToken = 'synthetic-secret'; input.body.style = { background: 'url(external)' };
  const serialized = JSON.stringify(realisticBodyModel(input));
  assert.doesNotMatch(serialized, /malicious|privateToken|synthetic-secret|external/);
});

// 下半身裁切必须保持原比例，不能为塞进全身画布而拉长腿或横向压扁衣裙。
// Lower-body crops must preserve aspect ratio, never stretch legs or squeeze clothing to fill the composed canvas.
test('lower-body composition rejects nonuniform source-to-destination scaling', () => {
  const input = view();
  assert.ok(realisticBodyModel(input));
  input.body.lowerRect = [0, 900, 1100, 1080];
  assert.equal(realisticBodyModel(input), null);
});

// 本人POV是独立的身份绑定资料，不能拿正面全身资料自动充当第一人称腿。
// Self POV is independently approved identity-bound metadata, never inferred from a front-facing body.
test('first-person legs require explicit valid approval and copy only their own crop', () => {
  const input = { ...view(), pov: { approved: true, url: '/characters/realistic/example/pov.png',
    sourceSize: [1000, 1600], contentRect: [100, 400, 800, 1200], secret: 'not-for-output' } };
  const original = structuredClone(input);
  const model = realisticPovModel(input);
  assert.deepEqual(model, { url: input.pov.url, sourceSize: [1000, 1600], viewBox: '100 400 800 1200', aspectRatio: '800 / 1200',
    coverage: 'seated-lap-and-footwear', displayWidth: 820 });
  model.sourceSize[0] = 1;
  assert.deepEqual(input, original);
  for (const absent of [null, {}, view(), { pov: {} }]) assert.equal(realisticPovModel(absent), null);
  for (const patch of [{ approved: false }, { approved: 'true' }, { url: 'https://evil.example/pov.png' },
    { url: '/characters/realistic/../other.png' }, { url: '/characters/realistic/pov.png?secret=x' },
    { sourceSize: [0, 1600] }, { sourceSize: [1000, Infinity] }, { sourceSize: ['1000', 1600] },
    { contentRect: [100, 400, 901, 1200] }, { contentRect: [100, 400, 800, 1201] },
    { contentRect: [-1, 0, 800, 1200] }, { contentRect: [0, 0, 0, 1200] }, { contentRect: [0, 0, 800, NaN] }]) {
    assert.equal(realisticPovModel({ pov: { ...input.pov, ...patch } }), null);
  }
});

// 受限膝下素材单独标范围与比例，任意额外字段不能改变相机尺寸。
// Limited lower-shin artwork has explicit coverage/scale; arbitrary extra metadata cannot change camera sizing.
test('limited self artwork keeps its scoped framing instead of implying a full lap', () => {
  const pov = { approved: true, url: '/characters/realistic/sweet/self-pov.png', sourceSize: [1199, 1312],
    contentRect: [103, 95, 991, 1217], coverage: 'lower-shins-and-worn-footwear-only', displayWidth: 9999 };
  assert.equal(realisticPovModel({ pov }).displayWidth, 400);
  assert.equal(realisticPovModel({ pov }).coverage, pov.coverage);
});

// 袖底补片只能来自明确透明源的有界区域，目标为原上身坐标，不得越界或变形。
// Sleeve-bottom patches require bounded transparent-source crops and original-upper targets without distortion.
test('sleeve repairs preserve bounded upper coordinates and original upper dimensions', () => {
  const input = view();
  input.width = 1200; input.height = 1000;
  input.body.sleevePatches = { sourceUrl: '/characters/realistic/example/sleeve.png', sourceSize: [600, 800],
    patches: [{ sourceRect: [100, 700, 200, 80], targetRect: [20, 900, 200, 80] }] };
  const model = realisticBodyModel(input);
  assert.equal(model.sleevePatches[0].viewBox, '100 700 200 80');
  assert.equal(model.sleevePatches[0].style.top, '45%');
  for (const patch of [{ sourceRect: [100, 750, 200, 80] }, { targetRect: [20, 950, 200, 80] },
    { targetRect: [20, 900, 100, 80] }]) {
    const bad = structuredClone(input); Object.assign(bad.body.sleevePatches.patches[0], patch);
    assert.equal(realisticBodyModel(bad), null);
  }
  const bad = structuredClone(input); bad.body.sleevePatches.sourceUrl = 'https://outside.example/sleeve.png';
  assert.equal(realisticBodyModel(bad), null);
  assert.equal(realisticBodyModel({ ...input, width: 1250 }), null);
  assert.equal(realisticBodyModel({ ...input, height: 1100 }), null);
});

// 允许实际像素取整误差但拒绝变形；不合法椅锚点只撤椅，不能把已批准人物一起隐藏。
// Permit output pixel rounding without distortion; invalid chair anchors remove the chair, not the approved actor.
test('integer rounding keeps lower-body aspect tolerance and chair anchors never create negative height', () => {
  const rounded = view();
  rounded.body.lowerRect[3] += 1;
  assert.ok(realisticBodyModel(rounded));
  rounded.body.lowerRect[3] += 1;
  assert.equal(realisticBodyModel(rounded), null);
  const seated = view();
  seated.body.seatAnchor = [600, 1000];
  seated.body.footAnchors = [[400, 1800], [800, 1900]];
  assert.equal(realisticBodyModel(seated).chairStyle.height, '45%');
  for (const footAnchors of [[], [[400, 999]], [[400, 1000]], [[400, Infinity]], [[400, -1]]]) {
    const model = realisticBodyModel({ body: { ...seated.body, footAnchors } });
    assert.ok(model);
    assert.equal(model.chairStyle, null);
  }
});
