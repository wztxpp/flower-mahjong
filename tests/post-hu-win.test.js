// 验证已胡者能胡必胡，覆盖摸牌来源、存档窗口、多人回应和冻结引擎边界。
// Verify mandatory wins after a prior hu across draw sources, saved claims, multiple responses and frozen engines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, applyPresentedAction, getLegalActions, getPlayerView, assertGameInvariants } from '../shared/game.js';
import { getLegalActions as v2LegalActions } from '../shared/v2-game.js';
import { getLegalActions as legacyLegalActions } from '../shared/legacy-game.js';
import { postHuKongGame } from './fixtures/post-hu-kong.js';
import { postHuWinClaim } from './fixtures/post-hu-win.js';

// 除胡外的每种动作都必须失败，读写入口均不得改变原局或旧规则快照。
// Every alternative must fail without mutating the source state or its saved rules.
function assertHuOnly(game, seat, tile) {
  const before = structuredClone(game);
  assert.deepEqual(getLegalActions(game, seat), [{ type: 'hu' }]);
  assert.deepEqual(getPlayerView(game, seat).legalActions, [{ type: 'hu' }]);
  assert.match(getPlayerView(game, seat).huDiagnostic.message, /能胡就必须胡/);
  for (const type of ['pass', 'discard', 'peng', 'mingGang', 'anGang', 'buGang', 'addGang']) {
    const action = type === 'pass' ? { type } : { type, tile };
    assert.throws(() => applyAction(game, seat, action), /当前不能执行/);
    assert.deepEqual(game, before);
  }
}

// 自动打出只控制无胡无杠，不得使任何来源的可胡牌被过掉；缺字段旧局也立即纠错。
// Auto-discard only governs draws with no win/kong; absent saved flags receive the same authorized correction.
for (const source of ['normal', 'continuation', 'replacement']) {
  for (const automatic of [true, false, undefined]) {
    test(`post-hu ${source} draw is hu-only with auto-discard ${automatic}`, () => {
      const game = postHuKongGame({ winningDraw: true });
      if (automatic === undefined) delete game.rules.autoDiscardAfterHu;
      else game.rules.autoDiscardAfterHu = automatic;
      game.drawKind = source;
      game.lastDraw.source = source;
      const restored = JSON.parse(JSON.stringify(game));
      assertHuOnly(restored, 0, restored.lastDraw.tile);
      const next = applyPresentedAction(restored, 0, { type: 'hu' });
      assert.equal(next.players[0].huCount, 2);
      assert.equal(next.history.filter((event) => event.type === 'hu').length, 1);
      assert.equal(next.presentation.stage, 'hu');
      assert.deepEqual(getLegalActions(next, 0), []);
      assert.throws(() => applyAction(next, 0, { type: 'hu' }));
      assert.deepEqual(next.rules, game.rules);
      assertGameInvariants(next);
    });
  }
}

// 同一入口处理三类接胡；JSON 恢复不能重新出现过牌，已有窗口也不能沿用旧备选动作。
// One allowlist handles all three claims; JSON restoration and saved options cannot restore a pass alternative.
for (const kind of ['discard', 'kongDiscard', 'robKong']) {
  test(`post-hu ${kind} rejects every non-hu action after restoring a saved window`, () => {
    const game = postHuWinClaim({ kind });
    game.claim.options[0].push({ type: 'pass' });
    const restored = JSON.parse(JSON.stringify(game));
    assertHuOnly(restored, 0, restored.claim.tile);
    const next = applyAction(restored, 0, { type: 'hu' });
    assert.equal(next.players[0].huCount, 2);
    assert.equal(next.history.filter((event) => event.type === 'hu').length, 1);
    assert.equal(next.history.find((event) => event.type === 'hu').source, kind);
    assertGameInvariants(next);
  });

  // 两位都必须胡，但仍等双方确认，且回应顺序不改变结算、牌权或实体守恒。
  // Both prior winners must confirm; response order cannot change atomic settlement or physical ownership.
  test(`two mandatory ${kind} winners settle atomically in either response order`, () => {
    const initial = postHuWinClaim({ kind, multiple: true });
    const outcomes = [[0, 2], [2, 0]].map((order) => {
      let game = JSON.parse(JSON.stringify(initial));
      for (const seat of order) assertHuOnly(game, seat, game.claim.tile);
      game = applyAction(game, order[0], { type: 'hu' });
      assert.equal(game.phase, 'claim');
      assert.equal(game.history.filter((event) => event.type === 'hu').length, 0);
      assert.deepEqual(getLegalActions(game, order[0]), []);
      assertHuOnly(game, order[1], game.claim.tile);
      game = applyAction(game, order[1], { type: 'hu' });
      assert.deepEqual(game.players.map((player) => player.huCount), [2, 0, 2]);
      assert.equal(game.history.filter((event) => event.type === 'hu').length, 2);
      assertGameInvariants(game);
      return game;
    });
    assert.deepEqual(outcomes[0], outcomes[1]);
  });
}

// 首次胡仍可放弃；本次纠错只适用于 schema 3 已胡者，不修改冻结版本策略。
// A first win remains optional; the correction applies only to prior winners in schema three.
test('first wins and frozen engines retain their existing optional choices', () => {
  const firstWin = postHuKongGame({ winningDraw: true, huCount: 0 });
  assert.ok(getLegalActions(firstWin, 0).some((action) => action.type === 'discard'));
  const firstClaim = postHuWinClaim({ huCount: 0 });
  assert.deepEqual(getLegalActions(firstClaim, 0), [{ type: 'hu' }, { type: 'pass' }]);
  const priorWinner = postHuKongGame({ winningDraw: true });
  for (const readActions of [v2LegalActions, legacyLegalActions]) {
    const actions = readActions(priorWinner, 0);
    assert.ok(actions.some((action) => action.type === 'discard'));
    assert.ok(actions.some((action) => action.type === 'hu'));
  }
});
