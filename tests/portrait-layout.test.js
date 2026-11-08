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
  test(`${file} keeps the private hand above its own character inside the actual table`, () => {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    const { descriptor, errors } = parse(source);
    assert.deepEqual(errors, []);
    const board = findByClass(descriptor.template.ast, boardClass);
    assert.ok(board, 'the table container exists');
    const ownArea = findByClass(board, 'own-player-area');
    assert.ok(ownArea, 'the character/hand area is inside the same table');
    const image = findByClass(ownArea, 'own-character-scene');
    const hand = findByClass(ownArea, handClass);
    assert.ok(image && hand);
    assert.ok(ownArea.children.indexOf(image) < ownArea.children.indexOf(hand), 'decorative image precedes the interactive hand layer');
    assert.ok(findByClass(hand, 'character-hand-table'), 'real tiles sit on the shared felt layer');
    assert.ok(ownArea.props.some((property) => property.type === 7 && property.name === 'if'), 'private area retains its conditional guard');
  });
}
