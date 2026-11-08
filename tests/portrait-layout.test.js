// 验证真实模板里的桌面/主角/手牌层级，不用脆弱的HTML关闭标签正则或重复画一套测试页面。
// Verify real template table/character/hand ancestry, without brittle closing-tag regexes or a duplicate test page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@vue/compiler-sfc';

// 只读遍历编译器的原模板AST；静态class选择结构，动态身份/动作仍由真实组件测试覆盖。
// Walk the compiler's source-template AST read-only; static classes select structure, while component tests cover dynamic identity/actions.
function findByClass(node, className) {
  const classes = node.props?.find((property) => property.type === 6 && property.name === 'class')?.value?.content || '';
  if (classes.split(/\s+/).includes(className)) return node;
  for (const child of node.children || []) {
    const match = findByClass(child, className);
    if (match) return match;
  }
  return null;
}

for (const [file, boardClass, handClass] of [
  ['App.vue', 'table-surface', 'hand-panel'],
  ['ChengduTable.vue', 'chengdu-board', 'chengdu-hand-panel'],
]) {
  test(`${file} keeps the private hand on the table and a separate character frame below it`, () => {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    const { descriptor, errors } = parse(source);
    assert.deepEqual(errors, []);
    const board = findByClass(descriptor.template.ast, boardClass);
    assert.ok(board, 'the table container exists');
    const ownArea = findByClass(board, 'own-player-area');
    assert.ok(ownArea, 'the character/hand area is inside the same table');
    const display = findByClass(ownArea, 'own-character-display');
    const image = findByClass(display, 'own-character-scene');
    const hand = findByClass(ownArea, handClass);
    assert.ok(display && image && hand);
    assert.equal(display.tag, 'figure', 'standalone art has its own semantic frame');
    // 名片在模板中删除而非仅用CSS遮住；角色图组件及其可访问替代文本继续保留。
    // Remove nameplates from markup instead of hiding them with CSS; retain artwork and its accessible alternative text.
    assert.equal(display.children.some((node) => node.tag === 'figcaption'), false, 'own art has no role caption');
    const opponentPortrait = findByClass(board, 'character-portrait');
    assert.deepEqual(opponentPortrait.children.filter((node) => node.type === 1).map((node) => node.tag), ['CharacterArtwork'], 'opponent art has no role-name overlay');
    const handIndex = ownArea.children.indexOf(hand);
    const displayIndex = ownArea.children.indexOf(display);
    assert.ok(handIndex >= 0 && displayIndex > handIndex, 'the actual image frame follows the hand in normal flow');
    assert.equal(findByClass(hand, 'own-character-scene'), null, 'art cannot return inside hand controls as a background');
    assert.ok(findByClass(display, 'own-character-art'), 'image motion is clipped only within its own frame');
    assert.ok(findByClass(hand, 'character-hand-table'), 'real tiles sit on the shared felt layer');
    assert.ok(ownArea.props.some((property) => property.type === 7 && property.name === 'if'), 'private area retains its conditional guard');
  });
}

// 帧高和文档流是用户反馈后的新契约，不能只改img大小而仍保留短外框或全区绝对定位。
// Frame height and normal flow are the corrected contract, not larger images in short frames or area-wide absolute positioning.
test('portrait frames are tall at desktop and mobile widths without own-background positioning', () => {
  const css = readFileSync(new URL('../src/tabletop.css', import.meta.url), 'utf8');
  const current = css.slice(css.indexOf('/* 对手用更高的独立画框'));
  assert.match(current, /\.character-portrait\s*\{[^}]*height: clamp\(240px, 25vw, 340px\)/);
  assert.match(current, /@media \(max-width: 640px\)\s*\{\s*\.character-portrait \{ height: clamp\(180px, 48vw, 240px\)/);
  assert.match(current, /\.own-character-art\s*\{[^}]*aspect-ratio: 1254 \/ 1050;[^}]*overflow: clip;/);
  assert.match(current, /\.own-character-scene\s*\{[^}]*position: static;[^}]*width: 100%;[^}]*height: 100%;/);
  assert.doesNotMatch(current, /has-character-scene|position: absolute|z-index:/);
});
