// 横屏桌的独立CSS/模板合同；真实App行为在ui.test.js，像素与触屏仍需隔离浏览器验收。
// Independent landscape CSS/template contracts; ui.test.js covers App behavior, not browser pixels or physical touch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileStyle } from '@vue/compiler-sfc';

// 直接读取维护中的源码，避免复制一份会与实际组件脱节的布局模型。
// Read maintained source directly instead of duplicating a layout model that could drift.
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const style = compileStyle({ source: source('src/landscape-table.css'), filename: 'landscape-table.css', id: 'landscape' });
const app = parse(source('src/App.vue')).descriptor;

// 深度遍历真实模板元素，保留v-if与事件指令供边界断言使用。
// Traverse actual template elements, retaining conditions and event directives for boundary assertions.
function elements(node) {
  return [node, ...(node.children || []).flatMap(elements)].filter((entry) => entry.type === 1);
}

// 读取指定选择器的声明值，仅用于CSS合同，不将源码尺寸称为浏览器测量。
// Read a selector's declarations as a CSS contract, never as measured browser geometry.
function declarations(selector) {
  let result;
  style.rawResult.root.walkRules((rule) => {
    if (rule.selector === selector) {
      result = Object.fromEntries(rule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value]));
    }
  });
  assert.ok(result, `Missing rule: ${selector}`);
  return result;
}

test('every landscape CSS selector is rooted in its independent presentation class', () => {
  assert.deepEqual(style.errors, []);
  let count = 0;
  style.rawResult.root.walkRules((rule) => {
    for (const selector of rule.selectors) {
      assert.match(selector, /^\.is-landscape-table(?:[\s.:#[]|$)/, selector);
      assert.doesNotMatch(selector, /is-realistic-table/, selector);
      count++;
    }
  });
  assert.ok(count > 0);
  // 不允许全局字体/动画/导入逃离根类隔离。
  // Forbid global fonts, animations or imports from escaping root-class isolation.
  style.rawResult.root.walkAtRules((rule) => assert.equal(rule.name, 'media'));
  const main = source('src/main.js');
  assert.ok(main.indexOf("import './landscape-table.css'") > main.indexOf("import './realistic-table.css'"));
});

test('compact landscape layout requires orientation and width while details restore the document', () => {
  const root = '.is-landscape-table:not(.landscape-details-open)';
  const compact = declarations(root);
  assert.equal(compact.height, '100dvh');
  assert.match(compact.padding, /safe-area-inset/);
  style.rawResult.root.walkRules((rule) => {
    if (rule.selector === root) {
      assert.equal(rule.parent.name, 'media');
      assert.match(rule.parent.params, /orientation:\s*landscape/);
      assert.match(rule.parent.params, /min-width:\s*560px/);
    }
  });
  assert.equal(declarations('.is-landscape-table.landscape-details-open .site-header').position, 'sticky');
});

test('landscape selectable tiles and header controls declare at least 44px touch targets', () => {
  const prefix = '.is-landscape-table:not(.landscape-details-open)';
  const tiles = declarations(`${prefix} .character-hand-table .mahjong-tile`);
  const header = declarations(`${prefix} .header-actions .text-button`);
  assert.ok(parseFloat(tiles.width) >= 44);
  assert.ok(parseFloat(tiles['min-width']) >= 44);
  assert.ok(parseFloat(tiles.height) >= 44);
  assert.ok(parseFloat(header['min-width']) >= 44);
  assert.ok(parseFloat(header['min-height']) >= 44);
  assert.ok(parseFloat(declarations('.is-landscape-table .landscape-details-toggle')['min-height']) >= 44);
});

test('landscape never mounts the realistic scene or teleports its private controls', () => {
  const nodes = elements(app.template.ast);
  const realistic = nodes.find((node) => node.tag === 'RealisticTable');
  assert.ok(realistic);
  assert.equal(realistic.props.find((prop) => prop.name === 'if').exp.content, "game && tablePresentation === 'realistic'");
  const teleport = nodes.find((node) => node.tag === 'Teleport');
  assert.match(teleport.props.find((prop) => prop.name === 'bind' && prop.arg.content === 'disabled').exp.content, /tablePresentation !== 'realistic'/);
  const chengdu = nodes.find((node) => node.tag === 'ChengduTable');
  assert.equal(chengdu.props.find((prop) => prop.name === 'bind' && prop.arg.content === 'realistic').exp.content, "tablePresentation === 'realistic'");
  const details = nodes.find((node) => node.props.some((prop) => prop.name === 'class' && prop.value?.content.includes('landscape-details-toggle')));
  assert.equal(details.props.find((prop) => prop.name === 'on' && prop.arg.content === 'click').exp.content, 'landscapeDetailsOpen = !landscapeDetailsOpen');
  assert.equal(details.props.find((prop) => prop.name === 'if').exp.content, "game && tablePresentation === 'landscape'");
});

// 观众无私有操作区；接牌/抢杠牌面只在原页脚，因此必须在折叠规则后重新显示。
// Spectators lack private controls; claim/rob-kong faces exist only in original footers, which must override collapsing.
test('landscape spectator claim footers override the compact footer collapse for both games', () => {
  const selector = '.is-landscape-table.is-spectator:not(.landscape-details-open) :is(.table-info-footer:has(.claim-strip), .chengdu-table-footer:has(.chengdu-claim))';
  assert.equal(declarations(selector).display, 'block');
  const rules = [];
  style.rawResult.root.walkRules((rule) => rules.push(rule));
  const visibleIndex = rules.findIndex((rule) => rule.selector === selector);
  const hiddenIndex = rules.findIndex((rule) => rule.selector.includes('.table-info-footer') && rule.nodes.some((node) => node.prop === 'display' && node.value === 'none'));
  assert.ok(hiddenIndex >= 0 && visibleIndex > hiddenIndex);
});

// 新增状态、牌河来源与终局入口只属于横屏，结算仍调用已有入口而非另起流程。
// New status, river ownership and terminal entry are landscape-only; settlement reuses its established handler.
test('landscape supplemental controls remain view-only and reuse existing settlement', () => {
  const nodes = elements(app.template.ast);
  for (const className of ['landscape-status', 'landscape-river-owner']) {
    const node = nodes.find((entry) => entry.props.some((prop) => prop.name === 'class' && prop.value?.content.split(' ').includes(className)));
    assert.match(node.props.find((prop) => prop.name === 'if').exp.content, /tablePresentation === 'landscape'/);
  }
  // 原页脚折叠时，紧凑状态继续轻声播报回合变化；不抢焦点。
  // When the original footer collapses, compact status still announces turn changes politely without taking focus.
  const status = nodes.find((node) => node.props.some((prop) => prop.name === 'class' && prop.value?.content.includes('landscape-status')));
  const announcement = elements(status).find((node) => node.props.some((prop) => prop.name === 'role' && prop.value?.content === 'status'));
  assert.equal(announcement.props.find((prop) => prop.name === 'aria-live').value.content, 'polite');
  assert.equal(announcement.props.find((prop) => prop.name === 'aria-atomic').value.content, 'true');
  const entry = nodes.find((node) => node.props.some((prop) => prop.name === 'if' && prop.exp.content.includes("tablePresentation === 'landscape' && phase === 'finished'")));
  assert.equal(entry.props.find((prop) => prop.name === 'on' && prop.arg.content === 'click').exp.content, 'openNextRound');
});
