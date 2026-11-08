// 稳定布局结构回归：编译真实模板/CSS，保护空槽、完整记录与键盘入口；像素/scrollTop由隔离浏览器验收。
// Stable-layout structural regressions compile real templates/CSS and protect empty slots, complete records and keyboard access; isolated browser QA measures pixels/scrollTop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileStyle, compileTemplate } from '@vue/compiler-sfc';

// 只遍历模板AST，不执行网络/牌局，也不复制生产计算逻辑。
// Walk source-template AST only, without running transport/games or duplicating production calculations.
function elements(node) {
  return [node, ...(node.children || []).flatMap(elements)].filter((entry) => entry.type === 1);
}
function attribute(node, name) {
  return node.props?.find((property) => property.type === 6 && property.name === name);
}
function binding(node, name) {
  return node.props?.find((property) => property.type === 7 && property.name === 'bind' && property.arg?.content === name);
}
function hasClass(node, name) {
  return (attribute(node, 'class')?.value?.content || '').split(/\s+/).includes(name);
}
function find(root, name) {
  const result = elements(root).find((node) => hasClass(node, name));
  assert.ok(result, `${name} exists`);
  return result;
}
const sources = Object.fromEntries(['App.vue', 'ChengduTable.vue'].map((file) => [file, readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')]));
const descriptors = Object.fromEntries(Object.entries(sources).map(([file, source]) => [file, parse(source).descriptor]));

for (const [file, descriptor] of Object.entries(descriptors)) {
  test(`${file} compiles and exposes every stable viewport to keyboard and assistive technology`, () => {
    const result = compileTemplate({ source: descriptor.template.content, filename: file, id: file });
    assert.deepEqual(result.errors, []);
    const scrollable = elements(descriptor.template.ast).filter((node) => hasClass(node, 'stable-scroll') || attribute(node, 'data-stable-scroll') || binding(node, 'class')?.exp?.content.includes('stable-scroll'));
    assert.ok(scrollable.length >= 10, 'all main variable-content zones are covered');
    for (const node of scrollable) {
      const focus = attribute(node, 'tabindex')?.value?.content || binding(node, 'tabindex')?.exp?.content;
      assert.ok(focus === '0' || focus === 'game ? 0 : undefined', `${node.loc.source.slice(0, 90)} can receive keyboard focus`);
      const named = ['aria-label', 'aria-labelledby'].some((name) => attribute(node, name) || binding(node, name));
      assert.ok(named || attribute(node, 'role')?.value?.content === 'status', 'scroll regions have a name or retain live status semantics');
    }
  });
}

// 移除说明与角色名片，原图、语音按钮及玩家昵称仍保留；角色目录不被删改。
// Remove descriptions and role nameplates while preserving art, voice controls, player nicknames and the character catalog.
test('boxed labels and role nameplates disappear while player identity, portraits and voice controls remain', () => {
  const root = descriptors['App.vue'].template.ast;
  assert.equal(elements(root).some((node) => hasClass(node, 'table-watermark')), false);
  assert.equal(elements(root).some((node) => hasClass(node, 'own-character-label')), false);
  const portrait = find(root, 'character-portrait');
  assert.doesNotMatch(portrait.loc.source, /characterForPlayer\([^)]*\)\.(?:name|style)/);
  assert.ok(elements(portrait).some((node) => node.tag === 'CharacterArtwork'));
  assert.match(find(root, 'voice-toggle').loc.source, /@click="toggleVoice"/);
  assert.match(find(root, 'own-seat-summary').loc.source, /me.name/);
  assert.ok(elements(find(root, 'own-character-display')).some((node) => node.tag === 'CharacterArtwork'));
  assert.doesNotMatch(find(root, 'own-character-display').loc.source, /figcaption|\.(?:name|style)/);
});

// 条件内容留在稳定父槽内；v-if不得重新挂到这些父槽导致空闲时又塌缩。
// Conditional contents stay inside stable parents; moving v-if onto these parents would collapse their idle space again.
for (const [file, names] of [
  ['App.vue', ['claim-slot', 'own-public-cards', 'hand-feedback', 'room-notices']],
  ['ChengduTable.vue', ['chengdu-public-cards', 'chengdu-claim-slot', 'chengdu-hand-note', 'chengdu-waits']],
]) {
  test(`${file} keeps empty content slots mounted throughout the game`, () => {
    for (const name of names) {
      const node = find(descriptors[file].template.ast, name);
      assert.equal(node.props.some((property) => property.type === 7 && ['if', 'else-if', 'show'].includes(property.name)), false, name);
    }
  });
}

// 样式编译器的AST比字符串拆分更能正确处理媒体查询；只要求有限固定视窗，不锁住任意像素选择。
// The style compiler AST handles media queries correctly; require finite fixed viewports rather than incidental pixel choices.
test('desktop and narrow overrides use fixed heights instead of only growth limits', () => {
  const tabletop = readFileSync(new URL('../src/tabletop.css', import.meta.url), 'utf8');
  const styles = [tabletop, descriptors['ChengduTable.vue'].styles[0].content];
  const required = new Set(['.table-surface .discard-tiles', '.opponent-public-cards', '.table-surface .shared-radish-pool', '.own-player-area .own-public-cards', '.own-player-area .action-row', '.hand-feedback', '.room-sidebar .history-list', '.room-sidebar .round-ledger', '.room-sidebar .table-ledger', '.chengdu-play-heading', '.chengdu-river', '.chengdu-public-cards', '.chengdu-action-bar', '.chengdu-details .chengdu-history', '.chengdu-details .chengdu-ledger']);
  for (const source of styles) {
    const compiled = compileStyle({ source, filename: 'stable.css', id: 'stable' });
    assert.deepEqual(compiled.errors, []);
    compiled.rawResult.root.walkRules((rule) => {
      if (!required.has(rule.selector)) return;
      if (rule.nodes.some((node) => node.prop === 'height' && /^\d+(?:\.\d+)?(?:px|rem)$/.test(node.value))) required.delete(rule.selector);
    });
  }
  assert.deepEqual([...required], []);
  assert.match(tabletop, /\.stable-scroll, \[data-stable-scroll\]\s*\{[^}]*overflow: auto;[^}]*scrollbar-gutter: stable;/);
  assert.match(tabletop, /\.stable-scroll:focus-visible, \[data-stable-scroll\]:focus-visible/);
});

// 牌河完整遍历原始记录；没有用slice裁短，也没有用整页滚动补偿掩盖重排。
// Rivers iterate all original records, without slicing history or masking reflow with document-scroll compensation.
test('river records and private visibility bindings remain intact without document scroll compensation', () => {
  const flower = find(descriptors['App.vue'].template.ast, 'discard-tiles').loc.source;
  const chengdu = find(descriptors['ChengduTable.vue'].template.ast, 'chengdu-river').loc.source;
  assert.match(flower, /v-for="discard in discardsFor\(player.seat\)"/);
  assert.match(flower, /:key="discard.index"/);
  assert.match(chengdu, /game.discards \|\| \[\]/);
  assert.doesNotMatch(`${flower}\n${chengdu}`, /\.slice\(/);
  assert.match(sources['App.vue'], /:back="win.hidden"/);
  assert.match(sources['App.vue'], /:back="tile == null"/);
  assert.match(sources['ChengduTable.vue'], /:back="tile == null"/);
  for (const source of Object.values(sources)) assert.doesNotMatch(source, /(?:window|document)\.(?:scrollTo|scrollBy)|scrollIntoView\(/);
});

// 只去掉可见标题/数量，不能把牌河归属、座位映射、牌面容量或键盘入口一起删掉。
// Remove visible river headings/counts only, never ownership, seat mapping, tile capacity or keyboard access.
test('both modes keep named full-capacity rivers without visible headings or record counts', () => {
  const flower = descriptors['App.vue'].template.ast;
  const chengdu = descriptors['ChengduTable.vue'].template.ast;
  assert.equal(elements(flower).some((node) => hasClass(node, 'discard-label')), false);
  assert.match(binding(find(flower, 'discard-group'), 'data-river-seat').exp.content, /^player\.seat$/);
  assert.match(binding(find(flower, 'discard-tiles'), 'aria-label').exp.content, /seatLabel\(player.seat\).*全部记录/);
  const chengduRiver = find(chengdu, 'chengdu-river');
  assert.match(binding(chengduRiver, 'aria-label').exp.content, /nameFor\(player.seat\).*全部记录/);
  assert.ok(chengduRiver.children.filter((node) => node.type === 1).every((node) => node.tag === 'MahjongTile'));
  for (const root of [flower, chengdu]) {
    const river = find(root, root === flower ? 'discard-tiles' : 'chengdu-river');
    assert.equal(attribute(river, 'tabindex').value.content, '0');
    assert.doesNotMatch(river.loc.source, /条记录|<h[1-6]\b/);
  }
  const capacities = new Map();
  for (const source of [readFileSync(new URL('../src/tabletop.css', import.meta.url), 'utf8'), descriptors['ChengduTable.vue'].styles[0].content]) {
    const compiled = compileStyle({ source, filename: 'river.css', id: 'river' });
    assert.deepEqual(compiled.errors, []);
    compiled.rawResult.root.walkRules((rule) => {
      if (!['.table-surface .discard-tiles', '.chengdu-river'].includes(rule.selector)) return;
      const height = rule.nodes.find((node) => node.prop === 'height')?.value;
      if (height) capacities.set(`${rule.parent.type === 'atrule' ? rule.parent.params : 'base'}:${rule.selector}`, height);
    });
  }
  assert.equal(capacities.get('base:.table-surface .discard-tiles'), '156px');
  assert.equal(capacities.get('(max-width: 640px):.table-surface .discard-tiles'), '144px');
  assert.equal(capacities.get('base:.chengdu-river'), '150px');
});

// 普通接牌仅显示来源和牌，冗长等待句保留在具名区域描述；不靠增高槽或缩牌来消除手机小滚条。
// Ordinary claims show source/tile only, with waiting prose in the named region description; no taller slot or smaller tiles hide phone overflow.
test('Chengdu player and spectator claims keep accessible waiting guidance without a repeated visible sentence', () => {
  const slots = elements(descriptors['ChengduTable.vue'].template.ast).filter((node) => hasClass(node, 'chengdu-claim-slot'));
  assert.equal(slots.length, 2);
  for (const slot of slots) {
    assert.match(binding(slot, 'aria-description').exp.content, /game.claim \? '等待所有有资格的牌友回应' : undefined/);
    const claim = find(slot, 'chengdu-claim');
    assert.doesNotMatch(claim.loc.source, /等待所有有资格/);
    assert.match(claim.loc.source, /nameFor\(game.claim.fromSeat\)/);
    assert.match(claim.loc.source, /game.claim.source === 'robKong'/);
    assert.match(claim.loc.source, /:tile="game.claim.tile" small/);
  }
  assert.match(descriptors['ChengduTable.vue'].styles[0].content, /\.chengdu-claim-slot \{ height: 64px; \}/);
});

// 只给明确单行横向区取消竖沟槽，不能顺手去掉牌河/公开牌/历史的稳定滚动条占位。
// Remove vertical gutters only from explicit single-row horizontal zones, preserving stable gutters for rivers, public cards and history.
test('horizontal viewports avoid phantom end gutters without changing vertical scroll contracts', () => {
  const source = readFileSync(new URL('../src/tabletop.css', import.meta.url), 'utf8');
  const compiled = compileStyle({ source, filename: 'tabletop.css', id: 'stable' });
  assert.deepEqual(compiled.errors, []);
  const automaticGutters = [];
  compiled.rawResult.root.walkRules((rule) => {
    if (rule.nodes.some((node) => node.prop === 'scrollbar-gutter' && node.value === 'auto')) {
      automaticGutters.push(...rule.selectors);
      assert.deepEqual(rule.nodes.filter((node) => node.type === 'decl').map((node) => node.prop), ['scrollbar-gutter'], 'the override cannot change height, overflow or content');
    }
  });
  assert.deepEqual(automaticGutters.sort(), [
    '.hand-scroll.stable-scroll', '.chengdu-hand.stable-scroll', '.meld-tiles.stable-scroll',
    '.opponent-hand.stable-scroll', '.header-actions.stable-scroll', '.action-row[data-stable-scroll]',
    '.chengdu-action-bar.stable-scroll',
  ].sort());
  assert.match(source, /\.stable-scroll, \[data-stable-scroll\]\s*\{[^}]*overflow: auto;[^}]*scrollbar-gutter: stable;/);
});

// 只让首元素吸收正的剩余空间；不能用尾部自动边距重新居中，也不能用end挤掉溢出的首按钮。
// Only the first element absorbs positive spare space: a trailing auto margin would recenter, and end alignment would lose the overflow origin.
for (const [file, prefix] of [['App.vue', '.own-player-area .action-row'], ['ChengduTable.vue', '.chengdu-action-bar']]) {
  test(`${file} right-aligns fitting actions while preserving the overflow origin`, () => {
    const source = file === 'App.vue' ? readFileSync(new URL('../src/tabletop.css', import.meta.url), 'utf8') : descriptors[file].styles[0].content;
    const compiled = compileStyle({ source, filename: 'actions.css', id: 'stable' });
    assert.deepEqual(compiled.errors, []);
    const rules = new Map();
    compiled.rawResult.root.walkRules((rule) => {
      if (rule.selector.startsWith(prefix) && rule.parent.type !== 'atrule') {
        rules.set(rule.selector, Object.fromEntries(rule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value])));
      }
    });
    const row = rules.get(prefix);
    assert.equal(row['justify-content'], 'flex-start', 'overflow cannot align into negative/unreachable coordinates');
    assert.equal(row['flex-wrap'], 'nowrap');
    assert.equal(row.height, '68px');
    assert.equal(rules.get(`${prefix} > ${file === 'App.vue' ? '*' : 'button'}`)['flex-shrink'], '0');
    assert.deepEqual(rules.get(`${prefix} > :first-child`), { 'margin-inline-start': 'auto' });
    assert.equal(rules.get(`${prefix} > :last-child`), undefined, 'no trailing auto margin can recenter the group');
    const actionRow = find(descriptors[file].template.ast, file === 'App.vue' ? 'action-row' : 'chengdu-action-bar');
    assert.ok(actionRow.children.filter((node) => node.type === 1).every((node) => ['button', 'span'].includes(node.tag)), 'edge selectors address actions/status, not a wrapper');
    if (file === 'App.vue') {
      assert.match(actionRow.loc.source, /:disabled="!canDiscard \|\| busy \|\| offline \|\| syncing"/);
      assert.match(actionRow.loc.source, /v-if="busy"/);
      assert.match(actionRow.loc.source, /等待牌友/);
    }
  });
}

// 减少的是重复标题/教程与套框，不是状态、牌、动作、可访问名称或信息页脚。
// Remove repeated headings/tutorials and nested boxes, never states, tiles, actions, accessible names or the information footer.
test('compact play areas remove repeated titles while preserving meaningful state and shared tiles', () => {
  const flower = descriptors['App.vue'].template.ast;
  const chengdu = descriptors['ChengduTable.vue'].template.ast;
  assert.equal(elements(flower).some((node) => hasClass(node, 'hand-info-row')), false);
  assert.equal(elements(flower).some((node) => hasClass(node, 'shared-radish-heading')), false);
  const hand = find(flower, 'hand-panel');
  assert.match(binding(hand, 'aria-description').exp.content, /postHu.*statusDetail/);
  assert.match(find(flower, 'waits-info').loc.source, /v-if="isMyTurn"[\s\S]*轮到你了/);
  assert.doesNotMatch(hand.loc.source, /class="(?:frozen-hand-pill|section-kicker|muted-hand-caption)"/);
  const pool = find(flower, 'shared-radish-pool');
  assert.match(binding(pool, 'aria-label').exp.content, /全桌共享萝卜.*sharedRadishes.length/);
  assert.ok(attribute(pool, 'aria-description'));
  assert.ok(!elements(pool).some((node) => /^h[1-6]$/.test(node.tag) || node.tag === 'p'));
  assert.match(find(pool, 'shared-radish-tiles').loc.source, /v-for="\(tile, tileIndex\) in sharedRadishes"/);
  assert.match(find(pool, 'shared-radish-status').loc.source, /game.pendingKongRadishes/);
  assert.match(find(pool, 'shared-radish-status').loc.source, /sharedRadishIncrementLabel\(latestSharedRadishes\)/);
  assert.ok(!elements(find(chengdu, 'chengdu-play-heading')).some((node) => /^h[1-6]$/.test(node.tag)));
  assert.equal(elements(chengdu).some((node) => hasClass(node, 'chengdu-turn-note')), false);
  const chengduHand = find(chengdu, 'chengdu-hand-panel');
  assert.ok(attribute(chengduHand, 'aria-label'));
  assert.ok(!elements(chengduHand).some((node) => /^h[1-6]$/.test(node.tag)));
  assert.match(find(chengduHand, 'chengdu-hand-note').loc.source, /selectedIndices.length/);
  assert.match(find(chengduHand, 'chengdu-hand-note').loc.source, /me.dingqueSuit/);
  assert.match(find(chengduHand, 'chengdu-hand-note').loc.source, /game.currentSeat === mySeat/);
  assert.ok(find(flower, 'table-info-footer'));
  assert.ok(find(chengdu, 'chengdu-table-footer'));
});

// 大厅页脚复用own-player-area身份卡，紧凑的无框外观只能命中已开局的牌区。
// The lobby footer reuses own-player-area for its identity card; compact borderless decoration must affect active table areas only.
test('compact own-area decoration excludes the lobby identity card', () => {
  const source = readFileSync(new URL('../src/tabletop.css', import.meta.url), 'utf8');
  const compiled = compileStyle({ source, filename: 'compact-scope.css', id: 'compact-scope' });
  assert.deepEqual(compiled.errors, []);
  let activeRule;
  compiled.rawResult.root.walkRules((rule) => {
    assert.notEqual(rule.selector, '.table-surface > .own-player-area', 'a broad selector would also restyle the lobby footer');
    if (rule.selector === '.table-surface:not(.lobby-table) > .own-player-area') activeRule = rule;
  });
  assert.ok(activeRule, 'borderless own-area styling explicitly excludes lobby tables');
  const declarations = Object.fromEntries(activeRule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value]));
  assert.equal(declarations['border-color'], 'transparent');
  const footer = find(descriptors['App.vue'].template.ast, 'table-info-footer');
  assert.match(binding(footer, 'class').exp.content, /'own-player-area': !game/);
});

// 为常规折叠内容保留响应式高度并缩小重复留白；不能改为随内容增长或隐藏溢出。
// Reserve responsive space for normal collapsed feedback and compact duplicate spacing, never auto-grow or hide overflow.
test('Flower feedback reserves compact fixed space at desktop and narrow widths', () => {
  const source = readFileSync(new URL('../src/tabletop.css', import.meta.url), 'utf8');
  const compiled = compileStyle({ source, filename: 'feedback.css', id: 'feedback' });
  assert.deepEqual(compiled.errors, []);
  const heights = [];
  const spacing = new Map();
  compiled.rawResult.root.walkRules((rule) => {
    const declarations = Object.fromEntries(rule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value]));
    if (rule.selector === '.hand-feedback') {
      heights.push([rule.parent.type === 'atrule' ? rule.parent.params : 'base', declarations.height]);
      assert.equal(declarations.overflow, undefined, 'native overflow contract remains inherited');
    }
    if (rule.selector.startsWith('.hand-feedback >')) spacing.set(rule.selector, declarations);
  });
  assert.deepEqual(heights, [['base', '80px'], ['(max-width: 640px)', '120px'], ['(max-width: 360px)', '140px']]);
  assert.deepEqual(spacing.get('.hand-feedback > .hu-diagnostic'), { 'margin-top': '0', 'padding-top': '6px' });
  assert.deepEqual(spacing.get('.hand-feedback > .own-score-detail'), { 'margin-top': '6px', 'padding-top': '6px' });
  const feedback = find(descriptors['App.vue'].template.ast, 'hand-feedback');
  assert.ok(elements(feedback).some((node) => node.tag === 'details' && hasClass(node, 'hu-diagnostic')));
  assert.match(find(feedback, 'own-score-detail').loc.source, /scoreSummary\(lastOwnScore, lastOwnHu\?\.payments\)/);
});

// 普通四人名单与手机标题/状态有独立容量；保留固定高度及原生溢出，而非裁掉内容。
// Ordinary four-player lists and phone headings/statuses get distinct capacities, retaining fixed heights and native overflow rather than clipping.
test('ordinary ledgers and Chengdu phone text reserve sufficient fixed capacity', () => {
  const tabletop = compileStyle({ source: readFileSync(new URL('../src/tabletop.css', import.meta.url), 'utf8'), filename: 'capacity.css', id: 'capacity' });
  const chengdu = compileStyle({ source: descriptors['ChengduTable.vue'].styles[0].content, filename: 'chengdu-capacity.css', id: 'chengdu-capacity' });
  assert.deepEqual([...tabletop.errors, ...chengdu.errors], []);
  const capacities = new Map();
  for (const compiled of [tabletop, chengdu]) compiled.rawResult.root.walkRules((rule) => {
    if (!['.room-sidebar .round-ledger', '.room-sidebar .table-ledger', '.opponent-public-cards', '.table-surface .shared-radish-pool', '.chengdu-play-heading', '.chengdu-status'].includes(rule.selector)) return;
    const declarations = Object.fromEntries(rule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value]));
    if (!declarations.height) return;
    assert.ok(!declarations.overflow || declarations.overflow === 'auto', 'capacity rules cannot hide overflow');
    capacities.set(`${rule.parent.type === 'atrule' ? rule.parent.params : 'base'}:${rule.selector}`, declarations.height);
  });
  assert.equal(capacities.get('base:.room-sidebar .round-ledger'), '200px');
  assert.equal(capacities.get('base:.room-sidebar .table-ledger'), '288px');
  assert.equal(capacities.get('base:.opponent-public-cards'), '96px');
  assert.equal(capacities.get('(max-width: 640px):.opponent-public-cards'), '98px');
  assert.equal(capacities.get('base:.table-surface .shared-radish-pool'), '72px');
  assert.equal(capacities.get('(max-width: 640px):.table-surface .shared-radish-pool'), '108px');
  assert.equal(capacities.get('base:.chengdu-play-heading'), '48px');
  assert.equal(capacities.get('base:.chengdu-status'), '66px');
  assert.equal(capacities.get('(max-width: 560px):.chengdu-play-heading'), '72px');
  assert.equal(capacities.get('(max-width: 560px):.chengdu-status'), '88px');
});

// 只解除极窄局内body下限；大厅原320px下限和可滚动内容均保持，不使用overflow隐藏问题。
// Release only the tiny in-game body's width floor; preserve the lobby floor and accessible overflow instead of hiding the problem.
test('the narrowest in-game page fits its scrollbar-reduced client width without changing the lobby', () => {
  const source = readFileSync(new URL('../src/tabletop.css', import.meta.url), 'utf8');
  const compiled = compileStyle({ source, filename: 'narrow-body.css', id: 'narrow-body' });
  assert.deepEqual(compiled.errors, []);
  const rules = [];
  compiled.rawResult.root.walkRules((rule) => {
    if (rule.selector !== 'body:has(.app-shell.in-game)') return;
    assert.equal(rule.parent.type, 'atrule');
    assert.equal(rule.parent.params, '(max-width: 360px)');
    rules.push(Object.fromEntries(rule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value])));
  });
  assert.deepEqual(rules, [{ 'min-width': '0' }]);
  assert.match(readFileSync(new URL('../src/style.css', import.meta.url), 'utf8'), /body\s*\{[^}]*min-width: 320px;/);
});

// 320px实测四回应仅多5px；只减少三处按钮间隙，不改变按钮padding、字体、触控尺寸或滚动权限。
// Four responses exceed the measured320px layout by only5px; reduce three gaps, not button padding, text, touch dimensions or scrolling.
test('tiny Flower action rows compact only gaps so four ordinary responses fit', () => {
  const source = readFileSync(new URL('../src/tabletop.css', import.meta.url), 'utf8');
  const compiled = compileStyle({ source, filename: 'flower-actions.css', id: 'flower-actions' });
  assert.deepEqual(compiled.errors, []);
  const compact = [];
  compiled.rawResult.root.walkRules((rule) => {
    if (rule.selector !== '.own-player-area .action-row' || rule.parent.type !== 'atrule') return;
    assert.equal(rule.parent.params, '(max-width: 360px)');
    compact.push(Object.fromEntries(rule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value])));
  });
  assert.deepEqual(compact, [{ gap: '3px' }]);
  const actionRow = find(descriptors['App.vue'].template.ast, 'action-row');
  assert.ok(attribute(actionRow, 'data-stable-scroll'));
  assert.equal(attribute(actionRow, 'tabindex').value.content, '0');
});

// 只收手机成都动作的间距/行内留白，不能为了消除常规四回应滚动而缩小字或44px触控高度。
// Compact phone Chengdu gaps/inline padding only, not text size or44px touch height, so ordinary four-response groups fit.
test('phone Chengdu action rows compact gaps and side padding while preserving touch height and overflow', () => {
  const compiled = compileStyle({ source: descriptors['ChengduTable.vue'].styles[0].content, filename: 'chengdu-actions.css', id: 'chengdu-actions' });
  assert.deepEqual(compiled.errors, []);
  const compact = [];
  const gaps = [];
  let minimumHeight;
  compiled.rawResult.root.walkRules((rule) => {
    const declarations = Object.fromEntries(rule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value]));
    if (rule.selector === '.chengdu-action-bar button') minimumHeight = declarations['min-height'];
    if (rule.selector === '.chengdu-action-bar' && rule.parent.type === 'atrule') gaps.push([rule.parent.params, declarations]);
    if (rule.selector === '.chengdu-action-bar > button' && rule.parent.type === 'atrule') {
      assert.equal(rule.parent.params, '(max-width: 360px)');
      compact.push(declarations);
    }
  });
  assert.equal(minimumHeight, '44px');
  assert.deepEqual(compact, [{ 'padding-inline': '10px' }]);
  assert.deepEqual(gaps, [['(max-width: 560px)', { gap: '6px' }], ['(max-width: 360px)', { gap: '5px' }]]);
  assert.ok(hasClass(find(descriptors['ChengduTable.vue'].template.ast, 'chengdu-action-bar'), 'stable-scroll'));
});

// 页脚使用真实DOM顺序，不能只用CSS搬动外观；唯一的本人摘要继续受观众权限保护。
// Footers use actual DOM order, not CSS-only rearrangement; the unique own summary keeps its spectator guard.
test('Flower groups status, finish controls and own identity after the entire main table', () => {
  const root = descriptors['App.vue'].template.ast;
  const board = find(root, 'table-surface');
  const footer = find(board, 'table-info-footer');
  const ownArea = find(board, 'own-player-area');
  assert.equal(footer.tag, 'footer');
  assert.ok(footer.loc.start.offset > ownArea.loc.end.offset, 'footer follows hand and portrait');
  for (const name of ['game-status', 'finished-banner', 'own-seat-summary']) {
    assert.equal(elements(root).filter((node) => hasClass(node, name)).length, 1, `${name} is not duplicated`);
    assert.ok(find(footer, name));
    assert.equal(elements(find(board, 'playing-center')).some((node) => hasClass(node, name)), false, `${name} no longer interrupts public tiles`);
  }
  assert.equal(find(footer, 'own-seat-summary').props.find((property) => property.name === 'if').exp.content, '!isSpectator');
  assert.equal(binding(footer, 'class').exp.content, "{ 'own-player-area': !game }", 'lobby keeps its identity styling and position');
  assert.match(find(footer, 'finished-banner').loc.source, /@click="mutate\(null, true\)"/);
  assert.match(find(footer, 'finished-banner').loc.source, /@click="newTable"/);
  assert.match(find(footer, 'game-status').loc.source, /game.wallCount/);
  const claim = find(find(ownArea, 'hand-panel'), 'claim-slot');
  assert.ok(claim.loc.start.offset > find(ownArea, 'hand-scroll').loc.end.offset);
  assert.ok(claim.loc.end.offset < find(ownArea, 'action-row').loc.start.offset, 'claim stays beside real actions');
  assert.ok(find(footer, 'claim-slot'), 'public-only viewers retain the claim in their footer');
});

// 成都账本与私有牌区完整保留，状态/终局到末端；换三张/定缺/碰杠胡的动作处理不迁移。
// Chengdu ledgers/private zones remain intact before the status/finish footer; action handlers stay with their hand controls.
test('Chengdu finishes with status/results and keeps claim information next to hand actions', () => {
  const root = descriptors['ChengduTable.vue'].template.ast;
  const table = find(root, 'chengdu-play');
  const footer = find(table, 'chengdu-table-footer');
  assert.equal(footer.tag, 'footer');
  assert.ok(footer.loc.start.offset > find(table, 'chengdu-details').loc.end.offset);
  for (const name of ['chengdu-status', 'chengdu-finish']) {
    assert.equal(elements(root).filter((node) => hasClass(node, name)).length, 1);
    assert.ok(find(footer, name));
  }
  const hand = find(table, 'chengdu-hand-panel');
  const claim = find(hand, 'chengdu-claim-slot');
  assert.ok(claim.loc.start.offset > find(hand, 'chengdu-hand').loc.end.offset);
  assert.ok(claim.loc.end.offset < find(hand, 'chengdu-action-bar').loc.start.offset);
  assert.ok(find(footer, 'chengdu-claim-slot'));
  assert.match(find(footer, 'chengdu-finish').loc.source, /@click="emit\('start'\)"/);
  assert.match(find(footer, 'chengdu-finish').loc.source, /game.settlement\?\.payments/);
});

// 手机终局说明先占整行；只改结束态页脚首段，不影响进行中固定槽或按钮事件。
// Phone finish text occupies its own row; scope only the first finished-footer span, leaving active slots and handlers untouched.
test('phone footer finish text gets a full row above end-of-round controls', () => {
  const source = readFileSync(new URL('../src/tabletop.css', import.meta.url), 'utf8');
  const compiled = compileStyle({ source, filename: 'finish-footer.css', id: 'finish-footer' });
  assert.deepEqual(compiled.errors, []);
  const rules = [];
  compiled.rawResult.root.walkRules((rule) => {
    if (rule.selector !== '.table-info-footer > .finished-banner > span:first-of-type') return;
    assert.equal(rule.parent.type, 'atrule');
    assert.equal(rule.parent.params, '(max-width: 640px)');
    rules.push(Object.fromEntries(rule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value])));
  });
  assert.deepEqual(rules, [{ flex: '1 1 calc(100% - 38px)' }]);
  const banner = find(descriptors['App.vue'].template.ast, 'finished-banner');
  const firstSpan = banner.children.find((node) => node.type === 1 && node.tag === 'span');
  assert.match(firstSpan.loc.source, /finishText/);
  assert.equal(banner.props.find((property) => property.name === 'if').exp.content, "phase === 'finished'");
});
