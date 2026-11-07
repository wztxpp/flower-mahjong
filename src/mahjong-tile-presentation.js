// 牌面与报牌的只读展示目录；MahjongTile 和声音层共用编号/名称，规则引擎不依赖本模块。
// Read-only tile art/voice catalog shared by MahjongTile and audio; rule engines never depend on it.
// 目录含全部已制作牌种，不表示任何模式已开放；合法动作仍由该模式自己的引擎决定。
// Available media does not enable a game mode; only its own engine can authorize an action.
import { CHENGDU_TILE_SET } from '../shared/tile-sets.js';
import {
  MAHJONG_PHOTO_URL,
  MAHJONG_PHOTO_WIDTH,
  MAHJONG_PHOTO_HEIGHT,
  photoFaceTransform,
} from './mahjong-photo-faces.js';
import {
  MAHJONG_WAN_URL,
  MAHJONG_WAN_WIDTH,
  MAHJONG_WAN_HEIGHT,
  wanFaceTransform,
} from './mahjong-wan-faces.js';

// 按花色显式选择原图及已有语音前缀，不改变0–17的任何图集坐标或资源路径。
// Select atlas and voice prefix by suit, preserving every old 0–17 crop and asset path.
const originalAtlas = Object.freeze({
  url: MAHJONG_PHOTO_URL,
  width: MAHJONG_PHOTO_WIDTH,
  height: MAHJONG_PHOTO_HEIGHT,
  transform: photoFaceTransform,
});
const suitMedia = Object.freeze({
  bamboo: Object.freeze({ ...originalAtlas, voicePrefix: 'tiao' }),
  dots: Object.freeze({ ...originalAtlas, voicePrefix: 'tong' }),
  characters: Object.freeze({
    url: MAHJONG_WAN_URL,
    width: MAHJONG_WAN_WIDTH,
    height: MAHJONG_WAN_HEIGHT,
    transform: wanFaceTransform,
    voicePrefix: 'wan',
  }),
});

// 一次构造不可变展示记录，避免调用者更改共享标签；身份目录只有牌种，不引入成都玩法。
// Build immutable presentation records once so callers cannot alter shared labels; identities add no Chengdu rules.
const presentations = Object.freeze(CHENGDU_TILE_SET.tiles.map((identity) => {
  const media = suitMedia[identity.suit];
  return Object.freeze({
    tile: identity.tile,
    label: identity.label,
    url: media.url,
    width: media.width,
    height: media.height,
    transform: media.transform(identity.tile),
    voiceClip: `${media.voicePrefix}-${identity.rank}`,
  });
}));

// 输入牌种整数，输出共享只读展示记录；隐藏/非法输入返回null，不把null或字符串转成牌种。
// Return a shared read-only record for an integer identity; hidden/invalid values stay null without coercion.
export function tilePresentation(tile) {
  if (!Number.isInteger(tile) || tile < 0 || tile >= presentations.length) return null;
  return presentations[tile];
}
