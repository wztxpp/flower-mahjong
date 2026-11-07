/**
 * 成都牌型的纯结构检查：27种、每种最多4张；不决定是否能胡、计番或付款。
 * Pure Chengdu shape checks: 27 identities, at most four copies; no win authorization, fan or payments.
 * 动作层还必须校验定缺、来源、过胡与未确认规则，不能用此结果直接结算。
 * Action logic must separately validate dingque, source, passed wins and confirmed rules before settling.
 */
import { CHENGDU_TILE_SET, isTileInSet } from './tile-sets.js';

export const CHENGDU_SUITS = Object.freeze(['bamboo', 'dots', 'characters']);

// 输入只含本人的牌；非法牌、超过四张或不是数组时返回 null，不读取牌墙或对手。
// Count only the supplied own tiles; invalid identities, excess copies or non-arrays return null.
function countTiles(tiles) {
  if (!Array.isArray(tiles)) return null;
  const counts = Array(27).fill(0);
  for (const tile of tiles) {
    if (!isTileInSet(tile, CHENGDU_TILE_SET) || ++counts[tile] > 4) return null;
  }
  return counts;
}

// 递归总取最小剩余牌，尝试刻子和不跨花色的顺子；每次分支都回滚计数。
// Recurse on the lowest remaining tile, trying triplets and same-suit runs, restoring counts after each branch.
function canFormGroups(counts, allowSequences) {
  const first = counts.findIndex((count) => count > 0);
  if (first === -1) return true;
  if (counts[first] >= 3) {
    counts[first] -= 3;
    const complete = canFormGroups(counts, allowSequences);
    counts[first] += 3;
    if (complete) return true;
  }
  if (allowSequences && first % 9 <= 6 && counts[first + 1] > 0 && counts[first + 2] > 0) {
    counts[first]--;
    counts[first + 1]--;
    counts[first + 2]--;
    const complete = canFormGroups(counts, allowSequences);
    counts[first]++;
    counts[first + 1]++;
    counts[first + 2]++;
    if (complete) return true;
  }
  return false;
}

// 枚举将牌并尝试分组；七对独立输出，四张算两对是结构事实而非龙七对计番。
// Try each pair and grouping; report seven pairs separately, without assigning luxury-seven-pair fan.
export function inspectChengduHand(hand, melds = []) {
  const invalid = { standard: false, sevenPairs: false, allTriplets: false, pureSuit: false, roots: 0 };
  if (!Array.isArray(melds) || melds.length > 4) return invalid;
  if (melds.some((meld) => !meld || !['peng', 'mingGang', 'anGang', 'buGang'].includes(meld.type) ||
    !Array.isArray(meld.tiles) || meld.tiles.length !== (meld.type === 'peng' ? 3 : 4) ||
    meld.tiles.some((tile) => tile !== meld.tile))) return invalid;
  const counts = countTiles(hand);
  const allCounts = counts && countTiles([...hand, ...melds.flatMap((meld) => meld.tiles)]);
  if (!allCounts || hand.length !== (4 - melds.length) * 3 + 2) return invalid;
  let standard = false;
  let allTriplets = false;
  for (let pair = 0; pair < counts.length; pair++) {
    if (counts[pair] < 2) continue;
    counts[pair] -= 2;
    standard ||= canFormGroups(counts, true);
    allTriplets ||= canFormGroups(counts, false);
    counts[pair] += 2;
  }
  const sevenPairs = melds.length === 0 && counts.every((count) => count % 2 === 0);
  const suits = new Set(allCounts.flatMap((count, tile) => count ? [Math.floor(tile / 9)] : []));
  return {
    standard,
    sevenPairs,
    allTriplets,
    pureSuit: suits.size === 1,
    roots: allCounts.filter((count) => count === 4).length,
  };
}

// 定缺判断包含副露，避免通过碰杠藏起缺门；此函数只检查所给牌，不决定公开时机。
// Check concealed and melded tiles so a missing-suit violation cannot hide in a meld; disclosure belongs elsewhere.
export function hasDingqueTiles(hand, melds, suit) {
  if (!CHENGDU_SUITS.includes(suit)) throw new TypeError('定缺花色无效');
  return [...hand, ...melds.flatMap((meld) => meld.tiles)]
    .some((tile) => CHENGDU_TILE_SET.tiles[tile]?.suit === suit);
}

// 听口只根据本人牌和明确的七对开关计算；不暗中查看剩余牌墙，不把结构听口当成查叫分。
// Enumerate own-hand structural waits with an explicit seven-pairs choice; never inspect the wall or quote draw penalties.
export function getChengduStructuralWaits(hand, melds, { dingqueSuit, allowSevenPairs }) {
  if (!CHENGDU_SUITS.includes(dingqueSuit) || typeof allowSevenPairs !== 'boolean') {
    throw new TypeError('听口需要明确的定缺与七对策略');
  }
  const ownCounts = Array.isArray(hand) && Array.isArray(melds)
    ? countTiles([...hand, ...melds.flatMap((meld) => meld.tiles ?? [])]) : null;
  if (!ownCounts || hasDingqueTiles(hand, melds, dingqueSuit)) return [];
  return CHENGDU_TILE_SET.tiles.filter(({ tile, suit }) => {
    if (suit === dingqueSuit || ownCounts[tile] >= 4) return false;
    const shape = inspectChengduHand([...hand, tile], melds);
    return shape.standard || (allowSevenPairs && shape.sevenPairs);
  }).map(({ tile }) => tile);
}

// 缺门仍在手中时只能打缺门；清空后才可选择任意牌。这里只返回牌种，不修改手牌或回合。
// While missing-suit tiles remain, only those may be discarded; otherwise allow any held identity, without mutating state.
export function getChengduDiscardTiles(hand, dingqueSuit) {
  if (!countTiles(hand) || !CHENGDU_SUITS.includes(dingqueSuit)) throw new TypeError('出牌需要有效手牌与定缺');
  const missing = hand.filter((tile) => CHENGDU_TILE_SET.tiles[tile].suit === dingqueSuit);
  return [...new Set(missing.length > 0 ? missing : hand)].sort((left, right) => left - right);
}
