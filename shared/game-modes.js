/**
 * 前后端可共用的模式目录；模式与引擎版本是两个维度，不能用 schemaVersion 推断模式。
 * Shared mode definitions: a mode and its engine version are separate dimensions, never inferred from one another.
 * 目录声明不代表可开局；房间策略与可运行引擎都必须由服务端明确登记。
 * Catalog membership does not enable play; the server explicitly registers room policy separately from runnable engines.
 */
import { FLOWER_TILE_SET, CHENGDU_TILE_SET } from './tile-sets.js';

export const FLOWER_GAME_MODE = 'flower';
export const CHENGDU_GAME_MODE = 'chengdu';
export const GAME_MODES = Object.freeze([
  Object.freeze({ id: FLOWER_GAME_MODE, label: '花麻将', tileSet: FLOWER_TILE_SET }),
  Object.freeze({ id: CHENGDU_GAME_MODE, label: '成都麻将', tileSet: CHENGDU_TILE_SET }),
]);

// 仅“没保存字段”是旧花麻将；null、空串和未知值必须保留给调用层拒绝，不能猜测或回填。
// Only an absent field means legacy Flower; preserve null/empty/unknown values for rejection, never guess or backfill.
export function savedGameMode(snapshot) {
  return snapshot.gameMode === undefined ? FLOWER_GAME_MODE : snapshot.gameMode;
}

// 返回冻结定义或 undefined；不创建状态、不默认选第一种模式，也不触发任何引擎。
// Return a frozen definition or undefined without creating state, choosing the first mode, or invoking an engine.
export function gameModeDefinition(gameMode) {
  return GAME_MODES.find((definition) => definition.id === gameMode);
}
