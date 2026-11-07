// 展示目录与引擎隔离回归：可显示/播报万牌不等于花麻将可接收万牌或成都可开局。
// Presentation/engine isolation: wan media never authorizes Flower wan actions or enables Chengdu starts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tilePresentation } from '../src/mahjong-tile-presentation.js';
import { CHENGDU_TILE_SET } from '../shared/tile-sets.js';
import { photoFaceTransform, MAHJONG_PHOTO_URL } from '../src/mahjong-photo-faces.js';
import { wanFaceTransform, MAHJONG_WAN_URL } from '../src/mahjong-wan-faces.js';
import { engineFor, modeForRoom } from '../server/game-engines.js';
import { createGame, settleGame } from '../shared/chengdu-game.js';

// 按已存在的身份目录逐项验证图片、标签与语音键，避免三个调用者各自猜测花色。
// Validate art, labels and clip keys against the identity catalog instead of three independent suit guesses.
test('read-only media catalog covers all 27 identities without changing old media mappings', () => {
  for (const identity of CHENGDU_TILE_SET.tiles) {
    const media = tilePresentation(identity.tile);
    const original = identity.tile < 18;
    assert.equal(media.tile, identity.tile);
    assert.equal(media.label, identity.label);
    assert.equal(media.url, original ? MAHJONG_PHOTO_URL : MAHJONG_WAN_URL);
    assert.equal(media.transform, original ? photoFaceTransform(identity.tile) : wanFaceTransform(identity.tile));
    const prefix = { bamboo: 'tiao', dots: 'tong', characters: 'wan' }[identity.suit];
    assert.equal(media.voiceClip, `${prefix}-${identity.rank}`);
    assert.ok(Object.isFrozen(media));
    assert.throws(() => { media.label = 'changed'; }, TypeError);
    assert.equal(tilePresentation(identity.tile).label, identity.label);
  }
});

// 严格边界阻止null、字符串、小数和未来未知编号意外变成可见/可播牌。
// Strict bounds keep nulls, strings, fractions and future unknown identities from becoming visible/audible tiles.
test('media lookup rejects hidden, coerced and out-of-range identities', () => {
  for (const tile of [null, undefined, '', '0', '18', false, true, -1, 1.5, 18.5, 27, NaN, Infinity, {}, []]) {
    assert.equal(tilePresentation(tile), null);
  }
});

// 同一进程装载新媒体后，三个花麻将版本仍拒绝万牌，成都注册/正式开局/结算仍失败关闭。
// After loading new media in the same process, all Flower versions reject wan and Chengdu remains fail-closed.
test('available wan media never expands playable modes or Flower action bounds', () => {
  for (let tile = 18; tile <= 26; tile++) {
    assert.ok(tilePresentation(tile));
    for (const schemaVersion of [1, 2, 3]) {
      const adapter = engineFor({ schemaVersion });
      assert.throws(() => adapter.parseAction({ type: 'discard', tile }),
        (error) => error.code === 'BAD_TILE' && error.status === 400);
    }
  }
  assert.throws(() => modeForRoom({ gameMode: 'chengdu' }).startRules({ approved: true }),
    (error) => error.code === 'BAD_START_OPTIONS');
  for (const operation of [createGame, settleGame]) {
    assert.throws(() => operation({ force: true, approved: true }),
      (error) => error.code === 'CHENGDU_RULES_PENDING');
  }
});
