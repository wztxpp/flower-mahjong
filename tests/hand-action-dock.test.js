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
]) test(`${name} mounts its dock only for actual buttons without hiding out-of-turn actions`, () => {
  const dock = find(descriptor.template.ast, 'hand-action-dock');
  const hand = find(descriptor.template.ast, handClass);
  const actions = find(dock, actionsClass);
  assert.ok(dock.loc.end.offset < hand.loc.start.offset);
  assert.ok(find(dock, 'hand-turn-prompt'));
  assert.equal(dock.props.find((entry) => entry.type === 7 && entry.name === 'if')?.exp.content, 'hasHandActions');
  assert.equal(actions.props.some((entry) => entry.type === 7 && ['if', 'show'].includes(entry.name)), false);
  assert.match(actions.loc.source, /tabindex="0"/);
  assert.match(actions.loc.source, /aria-label=/);
  assert.equal(actions.props.some((entry) => entry.type === 7 && ['if', 'show'].includes(entry.name)), false, 'own-turn cue never gates the action run');
  assert.equal(nodes(dock).some((entry) => /^h[1-6]$/.test(entry.tag)), false, 'no replacement heading or frame clutter');
});

test('frameless rack and intrinsic-width lists preserve safe centering in both modes', () => {
  assert.deepEqual(tabletop.errors, []); assert.deepEqual(chengduStyle.errors, []);
  const rack = lastRule(tabletop, '.own-player-area .character-hand-table');
  assert.deepEqual(rack, { background: 'transparent', border: '0', 'border-radius': '0', 'box-shadow': 'none' });
  for (const [compiled, selector] of [[tabletop, '.own-player-area .my-hand'], [chengduStyle, '.chengdu-hand-tiles']]) {
    const list = {};
    compiled.rawResult.root.walkRules((rule) => { if (rule.selector === selector && rule.parent.type !== 'atrule') Object.assign(list, properties(rule)); });
    assert.equal(list.width, 'max-content'); assert.equal(list['min-width'], '0'); assert.equal(list['margin-inline'], 'auto');
    assert.notEqual(list['justify-content'], 'center', 'overflow cannot be centered into negative coordinates');
  }
  const handStyle = {};
  chengduStyle.rawResult.root.walkRules((rule) => { if (rule.selector === '.chengdu-own-area .chengdu-hand') Object.assign(handStyle, properties(rule)); });
  assert.equal(handStyle.display, 'block');
  assert.equal(handStyle.height, '114px');
  const phone = lastRule(tabletop, '.own-player-area .hand-scroll', '(max-width: 640px)');
  assert.equal(phone.height, '100px'); assert.equal(phone.padding, '28px 4px 6px', 'balance selection clearance, tile shadows and native scrollbar capacity inside the unchanged hand height');
});

// 浮层必须真正脱离流且无替代占位；数值只是样式合同，重叠/影子仍由浏览器量测。
// Require real out-of-flow controls with no substitute spacer; numeric contracts do not replace browser overlap/shadow measurements.
test('dock reuses existing edge space without any replacement flow height', () => {
  const dock = lastRule(tabletop, '.own-player-area .hand-action-dock');
  assert.equal(dock.position, 'absolute');
  assert.equal(dock.bottom, 'calc(100% - 24px)');
  assert.equal(dock.height, '54px');
  assert.equal(dock['inset-inline'], '0');
  assert.equal(dock['pointer-events'], 'none');
  const wrapper = lastRule(tabletop, '.own-player-area .hand-interaction-area');
  assert.deepEqual(wrapper, { position: 'relative', 'min-width': '0' });
  assert.equal(lastRule(tabletop, '.own-public-slot').height, '80px');
  const publicCards = lastRule(tabletop, '.own-player-area .own-public-slot > .own-public-cards');
  assert.equal(publicCards.height, '50px');
  assert.equal(publicCards.padding, '0 4px 6px');
  const run = lastRule(tabletop, '.own-player-area .hand-action-dock > .action-row,\n.own-player-area .hand-action-dock > .chengdu-action-bar');
  assert.equal(run.height, '54px');
  assert.equal(run.padding, '0');
  assert.equal(run['pointer-events'], 'auto');
  const buttons = lastRule(tabletop, '.own-player-area .hand-action-dock .button');
  assert.equal(buttons['min-height'], '44px');
  assert.equal(buttons['min-width'], '44px');
  assert.equal(buttons.height, '44px');
  const turnCue = lastRule(tabletop, '.hand-action-dock .hand-turn-prompt');
  assert.equal(turnCue.height, '44px'); assert.equal(turnCue['max-height'], '44px');
  assert.equal(turnCue.display, 'flex'); assert.equal(turnCue['align-items'], 'center');
  assert.equal(turnCue['line-height'], '1', 'inline cue baselines cannot add vertical overflow above the horizontal scrollbar');
  assert.equal(lastRule(tabletop, '.own-player-area .hand-action-dock .button:focus-visible')['outline-offset'], '-3px');
  assert.equal(lastRule(tabletop, '.own-player-area .character-hand-table .tile-selected').transform, 'translateY(-2px)');
  assert.equal(lastRule(tabletop, '.own-player-area .character-hand-table .tile-interactive:hover:not(:disabled)').transform, 'translateY(-2px)');
  assert.equal(lastRule(tabletop, '.own-player-area .character-hand-table .tile-selected::after').bottom, '3px', 'the selection dot remains inside the tile rather than in the scrollbar');
  assert.equal(lastRule(tabletop, '.own-player-area .character-hand-table .tile-interactive:focus-visible')['outline-offset'], '-3px');
  assert.equal(lastRule(chengduStyle, '.chengdu-hand-note-content').height, '24px');
  assert.equal(lastRule(chengduStyle, '.chengdu-own-area .chengdu-hand').padding, '34px 4px 6px');
  assert.doesNotMatch(source('src/tabletop.css'), /scrollbar-width:\s*none/);
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
