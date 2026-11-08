// 无框手牌/角色动作带的结构与配色合同；真实尺寸、选牌抬起和滚动首尾仍由隔离浏览器量测。
// Structural/color contracts for frameless hands and themed docks; isolated browsers measure actual sizes, raised selections and scroll endpoints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileStyle } from '@vue/compiler-sfc';
import { CHARACTERS } from '../src/character-audio.js';
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = parse(source('src/App.vue')).descriptor;
const chengdu = parse(source('src/ChengduTable.vue')).descriptor;
const tabletop = compileStyle({ source: source('src/tabletop.css'), filename: 'tabletop.css', id: 'dock' });
const chengduStyle = compileStyle({ source: chengdu.styles[0].content, filename: 'ChengduTable.vue', id: 'dock' });
function nodes(node) { return [node, ...(node.children || []).flatMap(nodes)].filter((entry) => entry.type === 1); }
function hasClass(node, name) { return node.props.some((entry) => entry.type === 6 && entry.name === 'class' && entry.value.content.split(/\s+/).includes(name)); }
function find(root, name) { const node = nodes(root).find((entry) => hasClass(entry, name)); assert.ok(node, name); return node; }
function properties(rule) { return Object.fromEntries(rule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value])); }
function lastRule(compiled, selector, media = null) {
  let result;
  compiled.rawResult.root.walkRules((rule) => {
    if (rule.selector.replace(/\s+/g, ' ') === selector.replace(/\s+/g, ' ') && (rule.parent.type === 'atrule' ? rule.parent.params : null) === media) result = properties(rule);
  });
  assert.ok(result, selector); return result;
}

for (const [name, descriptor, handClass, actionsClass] of [
  ['Flower', app, 'hand-scroll', 'action-row'], ['Chengdu', chengdu, 'chengdu-hand', 'chengdu-action-bar'],
]) test(`${name} reserves a normal-flow dock before tiles without hiding out-of-turn actions`, () => {
  const dock = find(descriptor.template.ast, 'hand-action-dock');
  const hand = find(descriptor.template.ast, handClass);
  const actions = find(dock, actionsClass);
  assert.ok(dock.loc.end.offset < hand.loc.start.offset);
  assert.ok(find(dock, 'hand-turn-prompt'));
  assert.equal(dock.props.some((entry) => entry.type === 7 && ['if', 'show'].includes(entry.name)), false);
  assert.equal(actions.props.some((entry) => entry.type === 7 && ['if', 'show'].includes(entry.name)), false);
  assert.match(actions.loc.source, /tabindex="0"/);
  assert.match(actions.loc.source, /aria-label=/);
  assert.doesNotMatch(actions.loc.source, /v-(?:if|show)="(?:isMyTurn|.*currentSeat)/);
  assert.equal(nodes(dock).some((entry) => /^h[1-6]$/.test(entry.tag)), false, 'no replacement heading or frame clutter');
});

test('frameless rack and intrinsic-width lists preserve safe centering in both modes', () => {
  assert.deepEqual(tabletop.errors, []); assert.deepEqual(chengduStyle.errors, []);
  const rack = lastRule(tabletop, '.own-player-area .character-hand-table');
  assert.deepEqual(rack, { background: 'transparent', border: '0', 'border-radius': '0', 'box-shadow': 'none' });
  for (const [compiled, selector] of [[tabletop, '.own-player-area .my-hand'], [chengduStyle, '.chengdu-hand-tiles']]) {
    const list = lastRule(compiled, selector);
    assert.equal(list.width, 'max-content'); assert.equal(list['min-width'], '0'); assert.equal(list['margin-inline'], 'auto');
    assert.notEqual(list['justify-content'], 'center', 'overflow cannot be centered into negative coordinates');
  }
  assert.equal(lastRule(chengduStyle, '.chengdu-own-area .chengdu-hand').display, 'block');
  const phone = lastRule(tabletop, '.own-player-area .hand-scroll', '(max-width: 640px)');
  assert.equal(phone.height, '100px'); assert.equal(phone['padding-bottom'], '8px', 'leave scrollbar capacity without removing the selection lift at the top');
});

test('dock capacity is constant per viewport, outside the tile row, with full-width phone actions', () => {
  const desktop = lastRule(tabletop, '.own-player-area .hand-action-dock');
  const phone = lastRule(tabletop, '.own-player-area .hand-action-dock', '(max-width: 640px)');
  assert.equal(desktop.display, 'grid'); assert.equal(desktop.height, '92px'); assert.equal(desktop['grid-template-rows'], '24px 68px');
  assert.equal(phone.height, '132px'); assert.equal(phone['grid-template-rows'], '64px 68px');
  for (const rule of [desktop, phone]) assert.equal(rule.position, undefined, 'the dock cannot cover tiles or leave flow');
  const phoneActions = lastRule(tabletop, '.own-player-area .hand-action-dock > .action-row,\n.own-player-area .hand-action-dock > .chengdu-action-bar', '(max-width: 640px)');
  assert.equal(phoneActions['grid-column'], '1 / -1');
  const buttons = lastRule(tabletop, '.own-player-area .hand-action-dock .button');
  assert.equal(buttons['min-height'], '44px'); assert.equal(buttons['min-width'], '44px');
  assert.ok(lastRule(tabletop, '.own-player-area .hand-action-dock .button:focus-visible').outline);
});

// WCAG相对亮度只检查本文件的固定颜色，不读取或执行任何来自玩家的CSS。
// WCAG relative luminance checks fixed authored colors, never player-supplied CSS.
function luminance(hex) {
  const values = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
}
function contrast(left, right) { const values = [luminance(left), luminance(right)].sort((a, b) => b - a); return (values[0] + .05) / (values[1] + .05); }
test('seven enum palettes and the neutral fallback keep readable action text', () => {
  const base = lastRule(tabletop, '.own-player-area');
  const palettes = new Map();
  tabletop.rawResult.root.walkRules((rule) => {
    const match = rule.selector.match(/^\.own-player-area\.character-(\w+)$/);
    if (match) palettes.set(match[1], properties(rule));
  });
  assert.deepEqual([...palettes.keys()].sort(), CHARACTERS.map((character) => character.id).sort());
  for (const [id, palette] of [['fallback', base], ...palettes]) {
    assert.deepEqual(Object.keys(palette).sort(), ['--hand-accent', '--hand-accent-light', '--hand-accent-ink', '--hand-action-surface'].sort());
    for (const color of Object.values(palette)) assert.match(color, /^#[\da-f]{6}$/);
    for (const background of ['--hand-accent', '--hand-accent-light']) {
      assert.ok(contrast(palette['--hand-accent-ink'], palette[background]) >= 4.5, `${id}: primary text remains readable across both gradient ends`);
    }
    assert.ok(contrast(palette['--hand-accent-light'], palette['--hand-action-surface']) >= 4.5, `${id}: secondary text remains readable`);
  }
  assert.match(find(app.template.ast, 'own-player-area').loc.source, /characterForPlayer\(mySeat, true\).id/);
  assert.match(find(chengdu.template.ast, 'chengdu-own-area').loc.source, /characterForPlayer\(mySeat\).id/);
  assert.doesNotMatch(find(app.template.ast, 'hand-action-dock').loc.source, /:style=/);
  assert.doesNotMatch(find(chengdu.template.ast, 'hand-action-dock').loc.source, /:style=/);
});

test('tiny Flower responses fit by trimming side padding, while hover retains the selected role', () => {
  assert.equal(lastRule(tabletop, '.own-player-area .hand-action-dock > .action-row .button', '(max-width: 360px)')['padding-inline'], '9px');
  assert.equal(lastRule(tabletop, '.own-player-area .hand-action-dock .button.secondary:hover:not(:disabled)').background, 'var(--hand-action-surface)');
});
