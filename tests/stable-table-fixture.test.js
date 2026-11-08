// 诊断夹具的隔离边界与纯比较回归；浏览器像素结果必须由可见按钮另行实测。
// Fixture isolation/pure-comparison regressions; actual pixel results require the visible browser audit separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { stableTableSnapshot, STABLE_TABLE_CASES, STABLE_TABLE_COMPAT_CASES, STABLE_TABLE_STAGES, STABLE_TABLE_MANUAL_STAGES } from './helpers/stable-table-fixtures.js';
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
  // 预览替换脚本长度会移动样式的源码坐标；只比较真实内容和样式属性，不能把loc偏移当作CSS变更。
  // Replacing the preview script shifts source locations; compare actual content/style attributes rather than treating loc offsets as CSS changes.
  const styleContract = (styles) => styles.map(({ content, attrs, scoped }) => ({ content, attrs, scoped }));
  assert.deepEqual(styleContract(after.styles), styleContract(before.styles));
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

// 320px只为手动溢出检查，不改变已经固定的桌面/窄屏自动矩阵。
// 320px is for manual overflow inspection only, without changing the established automatic desktop/narrow matrix.
test('manual preview offers 320px while the automatic matrix retains its two widths', () => {
  const html = source('tests/browser/stable-table-preview.html');
  const widthSelector = html.match(/<select id="fixture-width">([\s\S]*?)<\/select>/)?.[1];
  assert.ok(widthSelector);
  const widths = [...widthSelector.matchAll(/<option value="(\d+)">/g)].map((match) => Number(match[1]));
  assert.deepEqual(widths, [1280, 390, 320]);
  assert.match(source('tests/browser/stable-table-preview.js'), /for \(const width of \[1280, 390\]\)/);
});

// 手牌可拆成四组012与33对子；每种暗杠恰有四张，动作字段沿用引擎协议但不运行引擎。
// The hand forms four 012 sequences and a 33 pair; each concealed kong has four tiles. Validate protocol fields without executing the engine.
test('manual Flower self-draw fixture exposes three concealed kongs, hu and discards outside the automatic matrix', () => {
  assert.deepEqual(STABLE_TABLE_MANUAL_STAGES[0], ['many-actions', '多暗杠与胡牌动作（花麻将手动）']);
  assert.equal(STABLE_TABLE_STAGES.length, 14);
  assert.equal(STABLE_TABLE_STAGES.some(([id]) => id === 'many-actions'), false);
  for (const caseId of ['flower-3', 'flower-4']) {
    const { state } = stableTableSnapshot(caseId, 'many-actions');
    const game = state.game;
    assert.equal(game.currentSeat, 0);
    assert.equal(game.phase, 'turn');
    assert.equal(game.turnStep, 'discard');
    assert.equal(game.drawnTile, 3);
    assert.equal(game.rules.preHuActionChoice, true);
    assert.equal(game.players[0].huCount, 0);
    assert.deepEqual(game.players[0].melds, []);
    assert.deepEqual(game.players[0].hand, [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3]);
    assert.deepEqual(game.legalActions, [0, 1, 2, 3].map((tile) => ({ type: 'discard', tile }))
      .concat({ type: 'hu' }, [0, 1, 2].map((tile) => ({ type: 'anGang', tile }))));
    assert.ok(game.players.slice(1).every((player) => !Object.hasOwn(player, 'hand')));
    assert.equal(game.discards.length, 0);
  }
  for (const caseId of ['chengdu-4', ...STABLE_TABLE_COMPAT_CASES]) {
    assert.throws(() => stableTableSnapshot(caseId, 'many-actions'), /requires current Flower player view/);
  }
});

// 普通夹具覆盖截图缺失的付款方与加番小字；长诊断供展开后内部滚动验收。
// Normal feedback includes screenshot payer/bonus text; long diagnostics exercise expanded local scrolling.
test('manual feedback fixtures include real score inputs without entering the automatic matrix', () => {
  for (const stage of ['normal-feedback', 'long-feedback']) {
    assert.equal(STABLE_TABLE_STAGES.some(([id]) => id === stage), false);
    for (const caseId of ['flower-3', 'flower-4']) {
      const { game } = stableTableSnapshot(caseId, stage).state;
      assert.equal(game.huDiagnostic.canHu, false);
      assert.equal(game.scoreBreakdown.copyFanBonus, 1);
      assert.deepEqual(game.scoreBreakdown.patternBonuses, [{ type: 'kongReplacement', fan: 1 }]);
      assert.equal(game.history.at(-1).type, 'hu');
      assert.equal(game.history.at(-1).payments.filter((payment) => payment.delta < 0).length, 2);
      assert.equal(game.discards.length, 0);
      assert.deepEqual(game.legalActions, []);
      assert.ok(game.players.slice(1).every((player) => !Object.hasOwn(player, 'hand')));
    }
    for (const caseId of ['chengdu-4', ...STABLE_TABLE_COMPAT_CASES]) {
      assert.throws(() => stableTableSnapshot(caseId, stage), /requires current Flower player view/);
    }
  }
  assert.ok(stableTableSnapshot('flower-3', 'long-feedback').state.game.huDiagnostic.message.length > 500);
});

// 成都准备文字和收到的三张牌此前未进普通容量验收；仅补纯视图，仍禁止网络和实际动作。
// Preparation instructions/received tiles were absent from ordinary-capacity checks; add view-only cases without network or real actions.
test('manual Chengdu preparation fixtures cover instructions and private receipt without growth stress', () => {
  for (const stage of ['chengdu-exchange', 'chengdu-dingque']) {
    assert.ok(STABLE_TABLE_MANUAL_STAGES.some(([id]) => id === stage));
    assert.equal(STABLE_TABLE_STAGES.some(([id]) => id === stage), false);
    const { state } = stableTableSnapshot('chengdu-4', stage);
    const game = state.game;
    assert.equal(state.phase, 'playing');
    assert.equal(game.phase, stage === 'chengdu-exchange' ? 'exchange' : 'dingque');
    assert.equal(game.turnStep, null);
    assert.equal(game.rules.exchangeThree, true);
    assert.equal(game.preparation.exchangeDirection, 'clockwise');
    assert.equal(game.history.length, 0);
    assert.equal(game.discards.length, 0);
    assert.equal(state.tableScores.length, 4);
    assert.ok(game.players.every((player) => !player.dingqueSubmitted && player.dingqueSuit === null && player.melds.length === 0 && !player.won));
    assert.ok(game.players.slice(1).every((player) => !Object.hasOwn(player, 'hand') && !Object.hasOwn(player, 'receivedExchange')));
    assert.doesNotMatch(JSON.stringify(state), /token|credential|authorization|profileHash/i);
    for (const caseId of [...STABLE_TABLE_CASES, ...STABLE_TABLE_COMPAT_CASES].filter((id) => id !== 'chengdu-4')) {
      assert.throws(() => stableTableSnapshot(caseId, stage), /requires current Chengdu player view/);
    }
  }
  const exchange = stableTableSnapshot('chengdu-4', 'chengdu-exchange').state.game;
  assert.deepEqual(exchange.legalActions, [{ type: 'exchangeThree', tiles: [0, 0, 1] }]);
  assert.equal(exchange.preparation.myExchange, null);
  assert.equal(exchange.preparation.receivedExchange, undefined);
  const dingque = stableTableSnapshot('chengdu-4', 'chengdu-dingque').state.game;
  assert.deepEqual(dingque.legalActions, ['bamboo', 'dots', 'characters'].map((suit) => ({ type: 'dingque', suit })));
  assert.deepEqual(dingque.preparation.receivedExchange, { fromSeat: 3, tiles: [0, 0, 1] });
  assert.deepEqual(dingque.preparation.exchangeSubmittedSeats, [0, 1, 2, 3]);
  assert.equal(STABLE_TABLE_STAGES.length, 14);
});

// 终局属于明确生命周期切换，不加入局中等高矩阵；它只显示按钮，不执行再开或伪造积分。
// Finish is an explicit lifecycle transition outside the in-game stability matrix; show controls without restarting or inventing scores.
test('manual finished views expose footer controls for both modes and compatibility audiences', () => {
  assert.ok(STABLE_TABLE_MANUAL_STAGES.some(([id]) => id === 'finished'));
  assert.equal(STABLE_TABLE_STAGES.some(([id]) => id === 'finished'), false);
  for (const caseId of [...STABLE_TABLE_CASES, ...STABLE_TABLE_COMPAT_CASES]) {
    const { state } = stableTableSnapshot(caseId, 'finished');
    assert.equal(state.phase, 'finished');
    assert.equal(state.game.phase, 'finished');
    assert.equal(state.game.turnStep, null);
    assert.equal(state.game.wallCount, 0);
    assert.equal(state.game.finishReason, 'wallExhausted');
    assert.deepEqual(state.game.legalActions, []);
    assert.equal(state.game.claim, null);
    assert.equal(state.tableScores.length, state.game.players.length);
    assert.ok(state.game.players.every((player) => player.score === 0));
    assert.equal(state.game.players.filter((player) => Object.hasOwn(player, 'hand')).length, caseId.endsWith('spectator') ? 0 : 1);
  }
});

// 普通公开牌仍保留完整十八张/人牌河，但不混入极长副露、十二次胡或六十条历史。
// Ordinary public cards retain eighteen discards per seat without mixing in extreme melds, twelve wins or sixty history events.
test('ordinary-public isolates normal public-card capacity from long-content stress', () => {
  assert.ok(STABLE_TABLE_MANUAL_STAGES.some(([id]) => id === 'ordinary-public'));
  assert.equal(STABLE_TABLE_STAGES.some(([id]) => id === 'ordinary-public'), false);
  for (const caseId of [...STABLE_TABLE_CASES, ...STABLE_TABLE_COMPAT_CASES]) {
    const { state } = stableTableSnapshot(caseId, 'ordinary-public');
    const game = state.game;
    const chengdu = caseId.startsWith('chengdu');
    assert.equal(game.phase, 'turn');
    assert.equal(game.history.length, 0);
    assert.equal(state.tableScores.length, game.players.length);
    assert.equal(game.sharedRadishes.length, chengdu ? 0 : 13);
    for (const player of game.players) {
      assert.equal(player.melds.length, 1);
      assert.equal(player.melds[0].type, 'peng');
      assert.equal(player.melds[0].tiles.length, 3);
      assert.equal(player.winPile.length, chengdu ? 0 : 1);
      assert.equal(player.huCount, chengdu ? 0 : 1);
      assert.equal(player.won, null);
      assert.equal(game.discards.filter((discard) => discard.seat === player.seat).length, 18);
      if (player.seat !== 0 || caseId.endsWith('spectator')) {
        assert.equal(Object.hasOwn(player, 'hand'), false);
        assert.ok(player.winPile.every((win) => win.tile === null && win.hidden));
      }
    }
  }
});

// 七角色选择只改变本座公开角色映射；不制造私有数据、动作或网络通道。
// Seven-role previews change only seat zero's public role mapping, never private data, actions or network access.
test('manual hand previews isolate short lists, rob-kong responses and safe role selection', () => {
  const roles = ['sweet', 'elegant', 'sunny', 'landlord', 'honest', 'wealthy', 'star'];
  for (const caseId of ['flower-3', 'flower-4', 'chengdu-4']) {
    for (const role of roles) {
      const short = stableTableSnapshot(caseId, 'short-hand', role).state;
      assert.deepEqual(short.game.players[0].hand, [0, 1, 9, 17]);
      assert.equal(short.game.drawnTile, 17, 'the displayed draw is a real member of the short hand');
      assert.equal(short.game.currentSeat, 0); assert.equal(short.game.characters[0], role); assert.equal(short.seats[0].characterId, role);
      assert.deepEqual(short.game.characters.slice(1), ['elegant', 'sunny', 'landlord'].slice(0, short.game.players.length - 1));
      const claim = stableTableSnapshot(caseId, 'rob-kong', role).state;
      assert.equal(claim.game.currentSeat, 1); assert.equal(claim.game.phase, 'claim');
      assert.equal(claim.game.claim.kind, 'robKong'); assert.equal(claim.game.claim.source, 'robKong');
      assert.deepEqual(claim.game.legalActions, [{ type: 'hu' }, { type: 'pass' }]);
      assert.ok(claim.game.players.slice(1).every((player) => !Object.hasOwn(player, 'hand')));
    }
  }
  assert.throws(() => stableTableSnapshot('flower-3', 'empty', 'red; color:blue'), /Unknown fixture character/);
  assert.equal(STABLE_TABLE_STAGES.length, 14);
  assert.match(source('tests/browser/stable-table-preview.html'), /id="fixture-character"/);
  const frame = source('tests/browser/stable-table-frame.js');
  assert.match(frame, /if \(caseId !== currentCase\) \{ app.unmount\(\); app = createApp\(App\); app.mount\('#app'\); \}/);
  assert.match(frame, /setSnapshot\(snapshot\)/);
});

// 终局预览只开放既有本地弹层函数；不能为浏览器测试重新启用生产网络或游戏动作。
// Terminal preview exposes only existing local modal functions, never production network or gameplay actions.
test('terminal preview registers actual keyboard handling while retaining all original isolation guards', () => {
  const transformed = parse(transformStableTableApp(source('src/App.vue'))).descriptor.scriptSetup.content;
  assert.match(transformed, /window\.addEventListener\('keydown', onKey\)/);
  assert.match(transformed, /window\.removeEventListener\('keydown', onKey\)/);
  assert.match(transformed, /async openSummary\(\) \{ openNextRound\(\)/);
  assert.match(transformed, /async closeSummary\(\) \{ closeModal\(\)/);
  assert.match(transformed, /async pollSummary\(\)/);
  assert.doesNotMatch(transformed, /onMounted\(\s*\(/);
  const frame = source('tests/browser/stable-table-frame.js');
  assert.match(frame, /#app \[data-next-round-trigger\], #app \.next-round-dialog \.modal-close/);
  assert.match(frame, /event\.stopImmediatePropagation\(\)/);
  assert.match(frame, /View-only fixture network boundary/);
  assert.match(frame, /#app \.next-round-dialog \[data-next-round-return\]/);
  assert.doesNotMatch(frame, /\.mutate\(|\.startNextRound\(|\.newTable\(/);
  const html = source('tests/browser/stable-table-preview.html');
  for (const control of ['load', 'finish', 'open', 'close', 'poll', 'new-game', 'measure']) assert.ok(html.includes(`id="fixture-summary-${control}"`));
  for (const height of [760, 560, 420]) assert.ok(html.includes(`value="${height}"`));
});

test('terminal summary fixture variants never leak into active stages and retain unavailable versus zero semantics', async () => {
  const { terminalSummaryFixture } = await import('./helpers/round-summary-fixtures.js');
  for (const caseId of [...STABLE_TABLE_CASES, ...STABLE_TABLE_COMPAT_CASES]) {
    const active = stableTableSnapshot(caseId, 'empty').state;
    assert.equal(active.game.roundSummary, undefined);
    const finished = stableTableSnapshot(caseId, 'finished').state;
    assert.equal(finished.game.roundSummary.players.length, finished.game.players.length);
    assert.equal(terminalSummaryFixture(finished, 'absent'), null);
    const missing = terminalSummaryFixture(finished, 'missing');
    assert.ok(missing.players.every((player) => player.finalHand === null && player.huCount === null && player.roundScore === null && player.tableScore === null));
    const long = terminalSummaryFixture(finished, 'long');
    assert.equal(long.players.reduce((sum, player) => sum + player.roundScore, 0), 0);
    assert.equal(long.players.reduce((sum, player) => sum + player.tableScore, 0), 0);
    assert.doesNotMatch(JSON.stringify(long), /token|credential|profileHash/i);
  }
  assert.throws(() => terminalSummaryFixture({}, 'untrusted'), /Unknown summary fixture variant/);
});
