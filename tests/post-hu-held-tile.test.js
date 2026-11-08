// 用户截图回归：胡后345筒不能靠取出3筒补/加杠而换成456筒，听口相同也不行。
// Reproduce the screenshot: upgrading a held three-dot cannot replace locked 345 with 456 after hu, even with identical waits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, applyPresentedAction, continuePresentedGame, getLegalActions,
  getPlayerView, getWaitTiles, assertGameInvariants } from '../shared/game.js';
import { variableFixture, meld } from './fixtures/variable-table.js';
import { postHuKongGame } from './fixtures/post-hu-kong.js';

const lockedHand = [3, 4, 5, 5, 11, 12, 13];

// 不包含真实用户资料；每种牌/所有牌区由既有守恒夹具分配，三副牌容纳各扩杠上限样本。
// No real user data: the conserved fixture allocates every physical zone, with three decks for all extension examples.
function heldUpgrade({ count = 4, draw = 14, huCount = 2, source = 'normal', automatic = false,
  preserveWaits = true, head = [] } = {}) {
  const game = variableFixture({ playerCount: 3, deckCount: 3,
    hands: [[...lockedHand, draw]], melds: [[meld(11, count, count === 3 ? 'peng' : 'buGang'), meld(1)]],
    huCounts: [huCount], drawTile: draw, head,
    rules: { specialHuPatterns: false, autoDiscardAfterHu: automatic, preserveWaitsOnPostHuKong: preserveWaits },
  });
  game.lastDraw.source = source;
  return game;
}

for (const count of [3, 4, 5, 6, 7]) {
  for (const source of ['normal', 'continuation', 'replacement']) {
    test(`post-hu held three-dot cannot upgrade a ${count}-tile meld after a different ${source} draw`, () => {
      const game = heldUpgrade({ count, source });
      const type = count === 3 ? 'buGang' : 'addGang';
      // 修复前前后听口都为3/6条，原检测误放行，且必杠使玩家只能选择这个非法换牌。
      // Before the fix both shapes wait on three/six bamboo, so the old check wrongly made this swap mandatory.
      assert.deepEqual(getWaitTiles(lockedHand, game.players[0].melds, game.rules), [2, 5]);
      const afterMelds = structuredClone(game.players[0].melds);
      afterMelds[0].type = 'buGang'; afterMelds[0].tiles.push(11);
      assert.deepEqual(getWaitTiles([3, 4, 5, 5, 12, 13, 14], afterMelds, game.rules), [2, 5]);
      const before = structuredClone(game);
      assert.deepEqual(getLegalActions(game, 0), [{ type: 'pass' }]);
      assert.deepEqual(getPlayerView(game, 0).legalActions, [{ type: 'pass' }]);
      for (const apply of [applyAction, applyPresentedAction]) {
        assert.throws(() => apply(game, 0, { type, tile: 11 }), /当前不能执行/);
        assert.deepEqual(game, before);
      }
      const next = applyPresentedAction(JSON.parse(JSON.stringify(game)), 0, { type: 'pass' });
      assert.deepEqual(next.players[0].hand, lockedHand);
      assert.deepEqual(next.players[0].melds, game.players[0].melds);
      assert.equal(next.discards.at(-1).tile, 14);
      assertGameInvariants(next);
    });
  }
}

test('held-tile locking is independent of the old wait-preservation flag and auto-discard setting', () => {
  for (const preserveWaits of [true, false, undefined]) for (const automatic of [true, false]) {
    const game = heldUpgrade({ preserveWaits, automatic });
    if (preserveWaits === undefined) delete game.rules.preserveWaitsOnPostHuKong;
    assert.deepEqual(getLegalActions(game, 0), [automatic ? { type: 'discard', tile: 14 } : { type: 'pass' }]);
    assert.throws(() => applyAction(game, 0, { type: 'addGang', tile: 11 }), /当前不能执行/);
  }
});

for (const type of ['buGang', 'addGang', 'anGang']) for (const source of ['normal', 'continuation', 'replacement']) {
  test(`legal post-hu ${type} remains available with its matching ${source} draw`, () => {
    const game = postHuKongGame({ type });
    game.lastDraw.source = source;
    const action = { type, tile: game.lastDraw.tile };
    assert.deepEqual(getLegalActions(game, 0), [action]);
    const next = applyPresentedAction(game, 0, action);
    assert.equal(next.history.at(-1).type, type);
    assert.equal(next.presentation.stage, 'kong');
    assertGameInvariants(next);
  });
}

test('unwon players keep previously held-tile upgrades after their required post-peng discard', () => {
  for (const count of [3, 4]) {
    const game = heldUpgrade({ count, huCount: 0 });
    const type = count === 3 ? 'buGang' : 'addGang';
    assert.ok(getLegalActions(game, 0).some(action => action.type === type && action.tile === 11));
    const next = applyPresentedAction(game, 0, { type, tile: 11 });
    assertGameInvariants(next);
    assert.ok(next.players[0].hand.includes(14));
  }
});

test('replacement draws permit a real same-tile chain but never a later different-draw hand exchange', () => {
  let game = heldUpgrade({ count: 3, draw: 11, head: [11, 14] });
  game = applyPresentedAction(game, 0, { type: 'buGang', tile: 11 });
  assert.deepEqual(game.players[0].hand, lockedHand);
  game = continuePresentedGame(game);
  assert.equal(game.lastDraw.tile, 11);
  assert.equal(game.lastDraw.source, 'replacement');
  assert.deepEqual(getLegalActions(game, 0), [{ type: 'addGang', tile: 11 }]);
  game = applyPresentedAction(game, 0, { type: 'addGang', tile: 11 });
  assert.deepEqual(game.players[0].hand, lockedHand);
  game = continuePresentedGame(game);
  assert.equal(game.lastDraw.tile, 14);
  assert.deepEqual(getLegalActions(game, 0), [{ type: 'pass' }]);
  assert.deepEqual(game.players[0].melds[0].tiles, Array(5).fill(11));
  assertGameInvariants(game);
});

test('missing or another-seat lastDraw cannot authorize a post-hu held-tile upgrade', () => {
  for (const lastDraw of [null, { seat: 1, tile: 11, source: 'normal' }]) {
    const game = heldUpgrade({ draw: 11 }); game.lastDraw = lastDraw;
    const before = structuredClone(game);
    assert.ok(!getLegalActions(game, 0).some(action => ['buGang', 'addGang'].includes(action.type)));
    assert.throws(() => applyAction(game, 0, { type: 'addGang', tile: 11 }));
    assert.deepEqual(game, before);
  }
});
