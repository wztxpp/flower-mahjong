// 七对首胡与胡后非听口摸牌均走真实引擎；只使用守恒合成牌，不读取生产记录。
// Build a real first seven-pairs win and a nonwinning continuation from conserved synthetic tiles, never production records.
import { applyPresentedAction, continuePresentedGame, assertGameInvariants } from '../../shared/game.js';
import { variableFixture } from './variable-table.js';

export const sevenPairShapes = {
  ordinary: [0, 0, 2, 2, 4, 4, 6, 6, 9, 9, 11, 11, 13, 13],
  quadruple: [0, 0, 0, 0, 2, 2, 4, 4, 6, 6, 9, 9, 11, 11],
  twoQuadruples: [0, 0, 0, 0, 2, 2, 2, 2, 4, 4, 9, 9, 11, 11],
  sextuple: [0, 0, 0, 0, 0, 0, 2, 2, 4, 4, 9, 9, 11, 11],
  pure: [0, 0, 0, 0, 2, 2, 4, 4, 5, 5, 6, 6, 7, 7],
};

// 返回胡牌展示段或其后实际摸到17的操作窗；首次胡会真实写入牌型快照与结算。
// Return the hu presentation boundary or the subsequent actual draw of 17; the first hu records its pattern and settlement.
export function sevenPairsAfterHu({ shape = 'quadruple', boundary = false } = {}) {
  const hand = sevenPairShapes[shape];
  let game = variableFixture({ playerCount: 3, deckCount: 2,
    hands: [hand], drawTile: hand.at(-1), head: [17, 16],
    rules: { autoDiscardAfterHu: false },
  });
  game = applyPresentedAction(game, 0, { type: 'hu' });
  if (!boundary) game = continuePresentedGame(JSON.parse(JSON.stringify(game)));
  assertGameInvariants(game);
  return game;
}
