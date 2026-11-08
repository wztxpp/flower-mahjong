// 诊断夹具的隔离边界与纯比较回归；浏览器像素结果必须由可见按钮另行实测。
// Fixture isolation/pure-comparison regressions; actual pixel results require the visible browser audit separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { stableTableSnapshot, STABLE_TABLE_CASES, STABLE_TABLE_COMPAT_CASES, STABLE_TABLE_STAGES } from './helpers/stable-table-fixtures.js';
import { transformStableTableApp } from './helpers/stable-table-transform.js';
import { rejectStableTableApi } from './helpers/stable-table-server-boundary.js';
import { compareStableTable, isStableTableEndVisible } from './helpers/stable-table-browser-audit.js';
import { MAX_VISIBLE_REPORT_BYTES, formatStableTableReport, writeStableTableReport, clearStableTableReport } from './helpers/stable-table-report.js';
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('view-only snapshots cover every case/stage without opponent hands or credentials', () => {
  for (const caseId of [...STABLE_TABLE_CASES, ...STABLE_TABLE_COMPAT_CASES]) for (const [stageId] of STABLE_TABLE_STAGES) {
    const snapshot = stableTableSnapshot(caseId, stageId);
    assert.equal(snapshot.state.phase, 'playing');
    assert.equal(snapshot.state.game.players.filter((player) => Object.hasOwn(player, 'hand')).length, caseId.endsWith('spectator') ? 0 : 1);
    if (!caseId.endsWith('spectator')) assert.equal(snapshot.state.game.players[0].hand.length, 14);
    assert.equal(snapshot.state.game.players.reduce((sum, player) => sum + player.score, 0), 0);
    assert.doesNotMatch(JSON.stringify(snapshot), /token|credential|authorization|profileHash/i);
    assert.ok(snapshot.state.seats.every((seat) => seat.name.startsWith('合成牌友')));
  }
  assert.throws(() => stableTableSnapshot('real-room', 'empty'));
  assert.throws(() => stableTableSnapshot('flower-3', 'unknown'));
});
test('App isolation preserves the real template/styles and removes lifecycle/API behavior', () => {
  const original = source('src/App.vue'); const transformed = transformStableTableApp(original);
  const before = parse(original).descriptor; const after = parse(transformed).descriptor;
  assert.equal(after.template.content, before.template.content);
  assert.deepEqual(after.styles, before.styles);
  assert.doesNotMatch(after.scriptSetup.content, /onMounted\(\s*\(/);
  assert.match(after.scriptSetup.content, /async function api\([^)]*\) \{ throw new Error\("View-only fixture: API disabled"\); \}/);
  assert.match(after.scriptSetup.content, /window\.__stableTableFixture/);
  assert.doesNotThrow(() => compileScript(after, { id: 'stable-table-fixture' }));
  assert.throws(() => transformStableTableApp(original.replace('onMounted(() =>', 'renamedHook(() =>')));
  assert.throws(() => transformStableTableApp(original.replace('async function api(', 'async function renamedApi(')));
});
test('preview disables main config and rejects every API method without importing stores', () => {
  const server = source('tests/browser/stable-table-preview-server.mjs');
  assert.match(server, /configFile: false/);
  assert.match(server, /cors: false/);
  assert.match(server, /middlewares\.use\(rejectStableTableApi\)/);
  assert.doesNotMatch(server, /^import .*server\/|^import .*store|apiMiddleware|MemoryStore|FileStore/m);
  assert.doesNotMatch(source('tests/helpers/stable-table-browser-audit.js'), /\.scrollTo\s*\(/);
  assert.doesNotMatch(source('tests/browser/stable-table-frame.js'), /localStorage\.(?:setItem|removeItem)|sessionStorage/);
});
test('comparison detects anchoring, document growth, missing hands and hand movement', () => {
  const rectangle = { top: 30, bottom: 130, left: 0, right: 300, width: 300, height: 100, documentTop: 400 };
  const baseline = { scrollY: 370, scrollX: 0, documentHeight: 2000, documentWidth: 390,
    regions: { hand: rectangle, handPanel: rectangle } };
  assert.equal(compareStableTable(baseline, structuredClone(baseline)).passed, true);
  for (const key of ['scrollY', 'documentHeight', 'documentWidth']) {
    const changed = structuredClone(baseline); changed[key] += 20;
    assert.equal(compareStableTable(baseline, changed).passed, false);
  }
  const shifted = structuredClone(baseline); shifted.regions.hand.documentTop += 20;
  assert.equal(compareStableTable(baseline, shifted).passed, false);
  shifted.regions.hand = null; assert.equal(compareStableTable(baseline, shifted).passed, false);
});

// 每种HTTP方法/编码路径都必须在next之前返回403；正常静态资源可以继续。
// Every method/encoded API path must return 403 before next; ordinary static resources may continue.
test('API boundary rejects all methods and encoded paths before routing', () => {
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
    for (const url of ['/api', '/api/rooms', '/api/rooms?fixture=true', '/%61pi/rooms', '/api%2Frooms']) {
      let status; let body; let proceeded = false;
      rejectStableTableApi({ method, url }, { writeHead: (value) => { status = value; }, end: (value) => { body = value; } }, () => { proceeded = true; });
      assert.equal(status, 403); assert.equal(proceeded, false); assert.match(body, /View-only fixture/);
    }
  }
  let proceeded = false;
  rejectStableTableApi({ url: '/src/App.vue' }, {}, () => { proceeded = true; });
  assert.equal(proceeded, true);
});

test('public growth includes maximum extended Flower meld and separate old-version views', () => {
  assert.equal(stableTableSnapshot('flower-4', 'public-growth').state.game.players[0].melds[0].tiles.length, 20);
  assert.equal(stableTableSnapshot('flower-legacy-1', 'public-growth').state.game.schemaVersion, 1);
  assert.equal(stableTableSnapshot('flower-legacy-2', 'public-growth').state.game.schemaVersion, 2);
  assert.equal(stableTableSnapshot('flower-spectator', 'claim').state.game.legalActions.length, 0);
});

test('end visibility cannot pass when the last tile is clipped outside actual client bounds', () => {
  const client = { left: 5, right: 300, top: 5, bottom: 105 };
  assert.equal(isStableTableEndVisible(client, { left: 260, right: 295, top: 20, bottom: 90 }, { overflowX: true, overflowY: true }), true);
  assert.equal(isStableTableEndVisible(client, { left: 280, right: 315, top: 20, bottom: 90 }, { overflowX: true, overflowY: false }), false);
  assert.equal(isStableTableEndVisible(client, { left: 260, right: 295, top: 80, bottom: 150 }, { overflowX: false, overflowY: true }), false);
  assert.equal(isStableTableEndVisible(client, null, { overflowX: true, overflowY: false }), false);
});

test('synthetic public/own tile IDs stay in their mode catalog, while hidden tiles remain null', () => {
  for (const caseId of [...STABLE_TABLE_CASES, ...STABLE_TABLE_COMPAT_CASES]) {
    for (const [stageId] of STABLE_TABLE_STAGES) {
      const game = stableTableSnapshot(caseId, stageId).state.game;
      const count = caseId.startsWith('chengdu') ? 27 : 18;
      const tiles = [...game.discards.map((discard) => discard.tile), ...game.sharedRadishes,
        ...game.players.flatMap((player) => [...(player.hand || []), ...player.melds.flatMap((meld) => meld.tiles),
          ...player.winPile.map((win) => win.tile), ...player.radishes, ...(player.won ? [player.won.tile] : [])])];
      assert.ok(tiles.every((tile) => tile === null || Number.isInteger(tile) && tile >= 0 && tile < count), `${caseId}/${stageId}`);
    }
  }
});

// 超大证据不能重新流入可见pre；完整数据仍按原结构保留在独立非执行DOM节点。
// Oversized evidence cannot re-enter visible pre layout; retain complete structured data in a non-executable DOM node.
test('report presentation is bounded while raw JSON retains every sample', () => {
  const report = {
    caseId: 'flower-legacy-1', baseline: { viewport: { width: 390, height: 760 } }, passed: false, resourcesReady: true,
    samples: Array.from({ length: 200 }, (_, index) => ({ stageId: `stage-${index}`, payload: '合成测量'.repeat(100),
      fromBaseline: { passed: false, differences: { documentHeight: 2 } }, fromPrevious: { passed: true, differences: {} } })),
    scrollRetention: [], reachability: { results: [] },
  };
  const result = { passed: false, reports: Array.from({ length: 8 }, () => structuredClone(report)) };
  const before = JSON.stringify(result);
  const { visibleText, rawText } = formatStableTableReport(result);
  assert.ok(Buffer.byteLength(visibleText) <= MAX_VISIBLE_REPORT_BYTES);
  const raw = JSON.parse(rawText); const visible = JSON.parse(visibleText);
  assert.deepEqual(raw.reports, result.reports);
  assert.equal(visible.summary[0].failureCounts.stages, 200);
  assert.equal(visible.summary[0].failedStages.length, 2);
  assert.equal(visible.reports, undefined);
  assert.equal(JSON.stringify(result), before);
});
test('oversized non-audit output stays valid bounded JSON, and new runs clear stale results', () => {
  const result = { passed: false, error: '合成错误'.repeat(30000) };
  const visible = { textContent: 'old success' }; const raw = { textContent: 'old measurements' };
  writeStableTableReport(result, visible, raw);
  assert.ok(Buffer.byteLength(visible.textContent) <= MAX_VISIBLE_REPORT_BYTES);
  assert.equal(JSON.parse(visible.textContent).summaryTruncated, true);
  assert.deepEqual(JSON.parse(raw.textContent), result);
  clearStableTableReport(visible, raw);
  assert.deepEqual(JSON.parse(visible.textContent), { status: 'running', passed: null });
  assert.deepEqual(JSON.parse(raw.textContent), { status: 'running', passed: null });
});
test('browser report uses non-rendering raw JSON and clears output before operations', () => {
  const html = source('tests/browser/stable-table-preview.html');
  assert.match(html, /<script id="fixture-raw-json" type="application\/json">/);
  const browser = source('tests/browser/stable-table-preview.js');
  assert.match(browser, /document\.querySelector\('#fixture-raw-json'\)/);
  assert.match(browser, /clearStableTableReport\(output, rawOutput\);[\s\S]*?await operation\(\)/);
  assert.doesNotMatch(browser, /output\.textContent = JSON\.stringify/);
});
