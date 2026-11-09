// 两种显示模式共用的成都状态：按原阶段/权限合同验证，不调用或修改规则引擎。
// Verify the shared Chengdu status against original phase/visibility contracts without invoking or modifying rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chengduTableStatus } from '../src/chengdu-table-status.js';

function state() {
  return { seats: [{ seat: 0, name: '甲' }, { seat: 1, name: '乙' }], game: {
    phase: 'turn', mySeat: 0, currentSeat: 1, players: [{ seat: 0 }, { seat: 1 }], legalActions: [],
  } };
}
test('Chengdu actual phases never fall back to a lobby message during play', () => {
  const view = state();
  assert.equal(chengduTableStatus(view), '等待乙出牌');
  view.game.currentSeat = 0;
  assert.match(chengduTableStatus(view), /^轮到你/);
  view.game.phase = 'exchange';
  assert.match(chengduTableStatus(view), /同一花色的三张牌/);
  view.game.preparation = { myExchange: [0, 0, 1] };
  assert.match(chengduTableStatus(view), /^换牌已提交/);
  view.game.phase = 'dingque';
  assert.match(chengduTableStatus(view), /^定缺：/);
  view.game.players[0].dingqueSubmitted = true;
  assert.match(chengduTableStatus(view), /^定缺已提交/);
  assert.match(chengduTableStatus(view, true), /正在同步/);
});
test('Chengdu claims, retired winners, finish and spectators retain their distinct messages', () => {
  const view = state();
  view.game.phase = 'claim';
  assert.equal(chengduTableStatus(view), '等待牌友回应');
  view.game.legalActions = [{ type: 'hu' }];
  assert.equal(chengduTableStatus(view), '这张牌，等你回应');
  view.game.claim = { hasResponded: true };
  assert.match(chengduTableStatus(view), /^回应已提交/);
  view.game.players[0].won = { source: 'discard' };
  assert.match(chengduTableStatus(view), /^你已胡牌/);
  view.game.mySeat = null;
  assert.equal(chengduTableStatus(view), '等待牌友回应');
  view.game.phase = 'exchange';
  assert.equal(chengduTableStatus(view), '等待四家选择换牌');
  view.game.phase = 'dingque';
  assert.equal(chengduTableStatus(view), '等待四家定缺');
  view.game.phase = 'finished';
  view.game.finishReason = 'wallExhausted';
  assert.equal(chengduTableStatus(view), '牌墙已尽，本局流局结算完成');
});
