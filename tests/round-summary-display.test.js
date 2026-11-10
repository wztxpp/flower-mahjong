import * as WanPaperModule from '../src/mahjong-wan-faces.js';
// 只验证终局显示适配，不运行浏览器、网络或另造客户端计分；服务端真实摘要与展示夹具分别验证。
// Test only terminal display adaptation, with no browser/network/client scoring; cover actual server summaries and view fixtures separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Vue from 'vue';
import { renderToString } from 'vue/server-renderer';
import { parse, compileScript, compileStyle } from '@vue/compiler-sfc';
import * as flower from '../shared/game.js';
import { engineFor } from '../server/game-engines.js';
import * as RoundSummaryModule from '../src/round-summary.js';
import * as TilePresentation from '../src/mahjong-tile-presentation.js';
import { roundSummaryView, roundScoreText, roundScoreTone, roundMeldLabel, roundWinLabel } from '../src/round-summary.js';
import { terminalSummaryFixture } from './helpers/round-summary-fixtures.js';
import { stableTableSnapshot } from './helpers/stable-table-fixtures.js';

// 标准输入总是新的合成视图；null/0/负数保持各自含义，不受其他测试更改。
// Each standard input is a new view-only fixture; null, zero and negative values retain distinct semantics.
function stateFixture(caseId = 'flower-3', variant = 'normal') {
  const { state } = stableTableSnapshot(caseId, 'finished');
  state.game.roundSummary = terminalSummaryFixture(state, variant);
  return state;
}

// 编译实际脚本和模板，只替换编译产物的依赖入口；不复制组件逻辑或伪造牌面。
// Compile actual setup/template code, replacing only generated imports rather than duplicating components or tiles.
function displayComponent(filename, dependencies = {}) {
  const { descriptor, errors } = parse(readFileSync(new URL(`../src/${filename}`, import.meta.url), 'utf8'));
  assert.deepEqual(errors, []);
  const script = compileScript(descriptor, { id: filename, inlineTemplate: true });
  const modules = { vue: Vue, ...dependencies };
  const loaded = script.content
    .replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
      (_, bindings, module) => `const {${bindings.replace(/\s+as\s+/g, ':')}} = modules[${JSON.stringify(module)}];`)
    .replace(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g,
      (_, binding, module) => `const ${binding} = modules[${JSON.stringify(module)}];`);
  return new Function('modules', loaded.replace('export default', 'return'))(modules);
}

// 从实际SSR输出的HTML树查找类名，避免依赖空白、属性顺序或Vue注释标记。
// Find classes in the actual SSR HTML tree without depending on whitespace, attribute order or Vue comments.
function renderedElements(node, className) {
  const classes = node.props?.find((property) => property.type === 6 && property.name === 'class')?.value?.content.split(/\s+/) || [];
  const children = (node.children || []).flatMap((child) => renderedElements(child, className));
  return classes.includes(className) ? [node, ...children] : children;
}

test('terminal display requires both finished gates and a matching explicit server summary', () => {
  const state = stateFixture();
  assert.equal(roundSummaryView(null), null);
  for (const path of ['room', 'game', 'summary', 'mode']) {
    const changed = structuredClone(state);
    if (path === 'room') changed.phase = 'playing';
    if (path === 'game') changed.game.phase = 'turn';
    if (path === 'summary') delete changed.game.roundSummary;
    if (path === 'mode') changed.game.roundSummary.gameMode = 'chengdu';
    assert.equal(roundSummaryView(changed), null);
  }
  state.game.roundSummary.players = [];
  assert.equal(roundSummaryView(state), null);
});

test('display preserves authoritative zero, negative scores, tile zero, and copied terminal zones', () => {
  const state = stateFixture();
  const before = structuredClone(state);
  const view = roundSummaryView(state);
  assert.equal(view.players[0].finalHand[0], 0);
  assert.equal(view.players[0].roundScore, 24);
  assert.equal(view.players[0].tableScore, 48);
  assert.equal(view.players[2].huCount, 0);
  assert.equal(view.players[2].dragons.count, 0);
  assert.equal(view.players[1].roundScore, -12);
  assert.equal(view.players[0].dragons.details[0].pointsPerOpponent, 10);
  view.players[0].finalHand.reverse();
  view.players[1].melds[0].tiles[0] = 17;
  view.players[0].wins[0].tile = 17;
  assert.deepEqual(state, before);
  for (const [number, label] of [[null, '未记录'], [undefined, '未记录'], [NaN, '未记录'], [Infinity, '未记录'], ['0', '未记录'], [0, '0'], [-12, '-12'], [24, '+24']]) {
    assert.equal(roundScoreText(number), label);
  }
  assert.equal(roundScoreTone(null), 'neutral');
  assert.equal(roundScoreTone(0), 'neutral');
  assert.equal(roundScoreTone(-12), 'negative');
  assert.equal(roundScoreTone(24), 'positive');
});

test('missing records never fall back to player zones, current occupants, history length or table scores', () => {
  const state = stateFixture('flower-3', 'missing');
  state.game.players[0].huCount = 999;
  state.game.players[0].score = 999;
  state.tableScores[0].totalScore = 999;
  state.game.history = [{ type: 'hu', seat: 0, tile: 0 }];
  const view = roundSummaryView(state);
  for (const player of view.players) {
    assert.equal(player.huCount, null);
    assert.equal(player.roundScore, null);
    assert.equal(player.tableScore, null);
    assert.equal(player.finalHand, null);
    assert.equal(player.melds, null);
    assert.equal(player.wins, null);
    assert.equal(player.dragons.count, null);
  }
  assert.equal(roundSummaryView(stateFixture('flower-3', 'absent')), null);
  assert.equal(roundSummaryView(stateFixture('flower-legacy-1')).players[0].dragons.status, 'unavailable');
  assert.equal(roundSummaryView(stateFixture('flower-legacy-2')).players[0].dragons.status, 'unavailable');
});

test('Chengdu marks dragons inapplicable and preserves winning references without growing the hand', () => {
  const state = stateFixture('chengdu-4');
  const view = roundSummaryView(state);
  assert.equal(view.players[0].dragons.status, 'notApplicable');
  assert.equal(view.players[0].dragons.count, null);
  assert.deepEqual(view.players[0].finalHand, state.game.roundSummary.players[0].finalHand);
  assert.match(roundWinLabel(view.players[0].wins[0]), /自摸 · 已含在手牌/);
  assert.equal(roundWinLabel(view.players[1].wins[0]), '接炮');
  assert.equal(roundWinLabel({ source: 'robKong', virtual: true }), '抢杠 · 共胡');
  assert.equal(roundWinLabel({ source: 'kongDiscard' }), '杠后接炮');
  assert.equal(roundMeldLabel('anGang'), '暗杠');
  assert.equal(roundMeldLabel('unknown'), '副露');
});

test('invalid tile zones and duplicate seats fail closed rather than inventing a smaller valid hand', () => {
  const state = stateFixture();
  const first = state.game.roundSummary.players[0];
  first.finalHand = [0, null, 3];
  first.huCount = -1;
  first.roundScore = Infinity;
  state.game.roundSummary.players.push(structuredClone(first), { seat: -1 });
  const view = roundSummaryView(state);
  assert.equal(view.players.length, 3);
  assert.equal(view.players[0].finalHand, null);
  assert.equal(view.players[0].huCount, null);
  assert.equal(view.players[0].roundScore, null);
});

test('actual completed engine summary preserves pointsPerOpponent and exact terminal hands through display normalization', () => {
  let game = flower.createGame({ seed: 45, rules: { dragonStartCount: 1 } });
  // 只执行服务器已有合法动作，直到真实终局；神龙细节不是用显示夹具编造的预期字段。
  // Execute existing allowlisted actions to a real finish; dragon fields come from actual server settlement rather than a display fixture.
  for (let step = 0; game.phase !== 'finished' && step < 1000; step++) {
    const choices = game.players.flatMap((_, seat) => flower.getLegalActions(game, seat).map((action) => ({ seat, action })));
    const choice = choices.find(({ action }) => action.type === 'hu') ?? choices.find(({ action }) => action.type === 'pass') ?? choices.find(({ action }) => action.type === 'discard') ?? choices[0];
    assert.ok(choice);
    game = flower.applyAction(game, choice.seat, choice.action);
    flower.assertGameInvariants(game);
  }
  assert.equal(game.phase, 'finished');
  const summary = engineFor(game).roundSummary(game);
  const view = roundSummaryView({ phase: 'finished', game: { ...game, roundSummary: summary } });
  assert.ok(summary.players.some((player) => player.dragons.details.length));
  for (const [seat, player] of view.players.entries()) {
    assert.deepEqual(player.finalHand, game.players[seat].hand);
    assert.equal(player.huCount, game.players[seat].huCount);
    assert.deepEqual(player.dragons.details, summary.players[seat].dragons.details);
    assert.ok(player.dragons.details.every((detail) => typeof detail.pointsPerOpponent === 'number'));
    assert.equal(player.tableScore, null, 'Engine-only summary has no room identity total to guess');
  }
});

test('overview keeps one vertical viewport, wrapped zones and keyboard-reachable native details', () => {
  const component = readFileSync(new URL('../src/RoundSummary.vue', import.meta.url), 'utf8');
  assert.match(component, /data-round-summary-scroll/);
  assert.match(component, /\.round-summary \{[^}]*overflow-y: auto;[^}]*overflow-x: hidden;/);
  assert.match(component, /\.round-tile-run \{[^}]*flex-wrap: wrap;/);
  assert.doesNotMatch(component, /overflow-x: auto|round-tile-scroll/);
  assert.match(component, /<summary tabindex="0">/);
  assert.match(component, /结束时手牌/);
  assert.match(component, /每家付 \{\{ dragon.pointsPerOpponent \}\} 分/);
  assert.match(component, /本局净分/);
  assert.match(component, /本桌累计/);
});

// flex-basis沿父容器主轴解释：同一张牌在横向手牌/副露与纵向胡牌记录中都必须采用自身宽高。
// Flex basis follows the parent's main axis: row hands/melds and column wins must both use the tile's own dimensions.
test('summary tile dimensions remain intrinsic across row and column containers at desktop and phone breakpoints', () => {
  const source = readFileSync(new URL('../src/RoundSummary.vue', import.meta.url), 'utf8');
  const { descriptor } = parse(source);
  const style = compileStyle({ source: descriptor.styles[0].content, filename: 'RoundSummary.vue', id: 'summary-sizing', scoped: true });
  assert.deepEqual(style.errors, []);
  for (const viewportWidth of [1280, 601, 600, 390, 320]) {
    const dimensions = {};
    let flex = { grow: '0', shrink: '1', basis: 'auto' };
    style.rawResult.root.walkRules((rule) => {
      if (rule.selector !== '.round-tile-run[data-v-summary-sizing] .mahjong-tile') return;
      // 读取同一选择器的媒体覆盖顺序；未知查询要显式补测试，不能静默当作桌面规则。
      // Apply responsive overrides in source order; new query shapes must be covered explicitly rather than treated as base rules.
      if (rule.parent.type === 'atrule') {
        assert.equal(rule.parent.name, 'media');
        const maximum = rule.parent.params.match(/^\(\s*max-width\s*:\s*(\d+)px\s*\)$/);
        assert.ok(maximum, rule.parent.params);
        if (viewportWidth > Number(maximum[1])) return;
      }
      rule.walkDecls((declaration) => {
        const { prop, value } = declaration;
        if (prop === 'width' || prop === 'height') dimensions[prop] = value;
        if (prop === 'flex') {
          const values = value === 'none' ? ['0', '0', 'auto'] : value.split(/\s+/);
          flex = { grow: values[0], shrink: values[1], basis: values[2] };
        }
        if (prop === 'flex-grow') flex.grow = value;
        if (prop === 'flex-shrink') flex.shrink = value;
        if (prop === 'flex-basis') flex.basis = value;
      });
    });
    assert.deepEqual(dimensions, viewportWidth <= 600 ? { width: '24px', height: '33px' } : { width: '26px', height: '36px' });
    assert.deepEqual(flex, { grow: '0', shrink: '0', basis: 'auto' }, `${viewportWidth}px: neither axis may replace width/height or squeeze a tile`);
  }
});

// 使用真实RoundSummary与MahjongTile渲染两玩法及长记录，确认三类牌仍共用尺寸作用域且不漏牌。
// Render both real components for both modes and long records, preserving the shared sizing scope and every tile.
test('actual summary components keep every hand, meld and winning reference inside the shared tile sizing scope', async () => {
  const Tile = displayComponent('MahjongTile.vue', { './mahjong-wan-faces.js': WanPaperModule, './mahjong-tile-presentation.js': TilePresentation });
  const Summary = displayComponent('RoundSummary.vue', { './MahjongTile.vue': Tile, './round-summary.js': RoundSummaryModule });
  for (const [caseId, variant] of [['flower-3', 'normal'], ['chengdu-4', 'normal'], ['flower-3', 'long'], ['flower-3', 'missing']]) {
    const summary = roundSummaryView(stateFixture(caseId, variant));
    const before = structuredClone(summary);
    const html = await renderToString(Vue.createSSRApp(Summary, { summary }));
    const { descriptor, errors } = parse(`<template>${html}</template>`);
    assert.deepEqual(errors, []);
    const players = renderedElements(descriptor.template.ast, 'round-player');
    assert.equal(players.length, summary.players.length);
    for (const [index, player] of summary.players.entries()) {
      const expected = (player.finalHand?.length || 0)
        + (player.melds || []).reduce((total, meld) => total + (meld.tiles?.length || 0), 0)
        + (player.wins || []).filter((win) => win.tile !== null).length;
      const tiles = renderedElements(players[index], 'mahjong-tile');
      const scopedTiles = renderedElements(players[index], 'round-tile-run')
        .flatMap((run) => renderedElements(run, 'mahjong-tile'));
      assert.equal(tiles.length, expected, `${caseId}/${variant}: player ${index} has all recorded tiles`);
      assert.deepEqual(scopedTiles, tiles, 'hand, meld and win tiles share the same sizing ancestor');
      const wins = renderedElements(players[index], 'round-win');
      assert.equal(wins.length, player.wins?.length || 0);
      for (const win of wins) {
        assert.equal(renderedElements(win, 'mahjong-tile').length, 1);
        assert.equal(renderedElements(win, 'round-win-label').length, 1);
      }
    }
    assert.deepEqual(summary, before, 'rendering must not mutate authoritative display data');
  }
});

// 以渐变最暗端测普通小字号对比度；这只是数值检查，实际浏览器外观由独立验收覆盖。
// Check small-text contrast against the darkest gradient endpoint; actual browser appearance is verified separately.
test('summary text palette meets AA normal-text contrast on the darkest modal background', () => {
  const luminance = (hex) => {
    const channels = hex.match(/[a-f\d]{2}/g).map((value) => parseInt(value, 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  for (const color of ['6d624d', '775f32', '276548', 'a34237', '665f4d']) {
    assert.ok((luminance('eee2c5') + 0.05) / (luminance(color) + 0.05) >= 4.5, color);
  }
});
