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

// 只移除红框内说明，角色名、原图、语音按钮与本人身份不能随之消失。
// Remove only the boxed descriptions; character names, original art, voice controls and own identity remain.
test('boxed voice labels and watermark disappear while names, portraits and voice controls remain', () => {
  const root = descriptors['App.vue'].template.ast;
  assert.equal(elements(root).some((node) => hasClass(node, 'table-watermark')), false);
  assert.equal(elements(root).some((node) => hasClass(node, 'own-character-label')), false);
  const portrait = find(root, 'character-portrait');
  assert.match(portrait.loc.source, /characterForPlayer\(player.seat, !isSpectator\)\.name/);
  assert.doesNotMatch(portrait.loc.source, /\.style/);
  assert.ok(elements(portrait).some((node) => node.tag === 'CharacterArtwork'));
  assert.match(find(root, 'voice-toggle').loc.source, /@click="toggleVoice"/);
  assert.match(find(root, 'own-seat-summary').loc.source, /me.name/);
  assert.match(find(root, 'own-character-display').loc.source, /characterForPlayer\(mySeat, true\)\.name/);
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
  const required = new Set(['.table-surface .discard-tiles', '.opponent-public-cards', '.table-surface .shared-radish-pool', '.own-player-area .own-public-cards', '.own-player-area .action-row', '.hand-feedback', '.room-sidebar .history-list', '.room-sidebar .table-ledger, .room-sidebar .round-ledger', '.chengdu-play-heading', '.chengdu-river', '.chengdu-public-cards', '.chengdu-action-bar', '.chengdu-details .chengdu-history', '.chengdu-details .chengdu-ledger']);
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
