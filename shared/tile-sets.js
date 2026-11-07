/**
 * 牌种目录只描述牌面身份，不决定副数、发牌、胡牌、付款或素材文件。
 * Tile catalogs describe identities only, not copy budgets, dealing, winning, payment or artwork.
 * 旧花麻将仍是条/筒 0–17；成都目录只追加万 18–26，不改写任何旧牌编号。
 * Flower retains bamboo/dots 0–17; Chengdu adds characters 18–26 without renumbering old tiles.
 */

// 花色顺序是持久化协议；显示名称和图片可更新，数字身份不能随美术顺序改变。
// Suit order is a persistence contract: labels/artwork may change, numeric identities may not.
const SUITS = Object.freeze([
  Object.freeze({ id: 'bamboo', label: '条' }),
  Object.freeze({ id: 'dots', label: '筒' }),
  Object.freeze({ id: 'characters', label: '万' }),
]);

// 一次创建并深冻结目录，防止某个调用者改变全局牌面映射；此处不生成实体牌墙。
// Build and deeply freeze each catalog once; callers cannot mutate global identity mappings or a physical wall.
function createTileSet(id, suitCount) {
  const tiles = Array.from({ length: suitCount * 9 }, (_, tile) => {
    const suit = SUITS[Math.floor(tile / 9)];
    const rank = tile % 9 + 1;
    return Object.freeze({ tile, suit: suit.id, rank, label: `${rank}${suit.label}` });
  });
  return Object.freeze({ id, tileCount: tiles.length, tiles: Object.freeze(tiles) });
}

export const FLOWER_TILE_SET = createTileSet('bambooDots', 2);
export const CHENGDU_TILE_SET = createTileSet('threeSuits', 3);

// 只验证某个模式的牌种范围；合法牌种不等于本次可以执行的动作，后者仍由引擎决定。
// Validate a mode-specific identity range, not action legality, which remains the engine's responsibility.
export function isTileInSet(tile, tileSet) {
  return Number.isInteger(tile) && tile >= 0 && tile < tileSet.tileCount;
}
