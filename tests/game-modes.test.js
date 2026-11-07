/**
 * 模式基础层回归：目录不是启动权限，模式和版本不能互相推断；三代引擎逐步差分。
 * Mode-foundation regressions: catalog membership is not launch permission; compare all three engines action by action.
 * 固定种子、合成存档与虚拟积分只在进程内使用，不读取或修改真实房间。
 * Seeded synthetic saves and virtual scores remain in-process, without reading or changing real rooms.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as flower from '../shared/game.js';
import * as flowerV2 from '../shared/v2-game.js';
import * as flowerLegacy from '../shared/legacy-game.js';
import { GAME_MODES, savedGameMode, gameModeDefinition } from '../shared/game-modes.js';
import { FLOWER_TILE_SET, CHENGDU_TILE_SET, isTileInSet } from '../shared/tile-sets.js';
import { CHENGDU_END_CONDITIONS, validateChengduOptions } from '../shared/chengdu-options.js';
import { engineFor, modeForRoom, GameModeError } from '../server/game-engines.js';
import { publicEvents } from '../server/history.js';
import { spectatorGameView } from '../server/spectators.js';

// 断言错误类型、HTTP 映射和稳定代码，不能只检查“任意抛错”掩盖错误分发。
// Verify error type, HTTP mapping and stable code rather than accepting an unrelated thrown exception.
function modeError(code, status = 409) {
  return (error) => error instanceof GameModeError && error.code === code && error.status === status;
}

test('tile catalogs preserve all eighteen identities and append nine characters without physical-copy assumptions', () => {
  assert.equal(FLOWER_TILE_SET.tileCount, 18);
  assert.equal(CHENGDU_TILE_SET.tileCount, 27);
  assert.deepEqual(CHENGDU_TILE_SET.tiles.slice(0, 18), FLOWER_TILE_SET.tiles);
  assert.deepEqual(CHENGDU_TILE_SET.tiles.slice(18).map(({ tile, suit, rank }) => [tile, suit, rank]),
    Array.from({ length: 9 }, (_, index) => [18 + index, 'characters', index + 1]));
  for (const tileSet of [FLOWER_TILE_SET, CHENGDU_TILE_SET]) {
    for (const tile of tileSet.tiles) {
      assert.equal(isTileInSet(tile.tile, tileSet), true);
      assert.equal(Object.isFrozen(tile), true);
    }
    assert.equal(Object.isFrozen(tileSet), true);
    assert.equal(Object.isFrozen(tileSet.tiles), true);
    for (const invalid of [-1, tileSet.tileCount, 1.5, '1', null, undefined, NaN, Infinity]) {
      assert.equal(isTileInSet(invalid, tileSet), false);
    }
    assert.equal(Object.hasOwn(tileSet, 'copiesPerTile'), false);
  }
  assert.equal(isTileInSet(18, FLOWER_TILE_SET), false);
  assert.equal(isTileInSet(18, CHENGDU_TILE_SET), true);
});

test('mode catalog is immutable and only an absent saved field means Flower', () => {
  assert.deepEqual(GAME_MODES.map((mode) => mode.id), ['flower', 'chengdu']);
  assert.equal(Object.isFrozen(GAME_MODES), true);
  assert.equal(gameModeDefinition('flower').tileSet, FLOWER_TILE_SET);
  assert.equal(gameModeDefinition('chengdu').tileSet, CHENGDU_TILE_SET);
  assert.equal(gameModeDefinition('toString'), undefined);
  const legacy = { schemaVersion: 3 };
  assert.equal(savedGameMode(legacy), 'flower');
  assert.deepEqual(legacy, { schemaVersion: 3 });
  for (const value of [null, '', false, 'chengdu', 'future']) {
    assert.equal(savedGameMode({ gameMode: value }), value);
  }
  for (const mode of GAME_MODES) assert.equal(Object.isFrozen(mode), true);
});

// 所有已确认的选项组合均有效；默认值、计分和换牌方向故意不在这个协议中。
// Every confirmed choice combination is valid; defaults, scoring and exchange directions intentionally remain outside this contract.
for (const endCondition of CHENGDU_END_CONDITIONS) {
  for (const exchangeThree of [false, true]) {
    test(`Chengdu choices ${endCondition}/${exchangeThree} require dingque without inventing other rules`, () => {
      const input = { endCondition, exchangeThree };
      const before = structuredClone(input);
      const result = validateChengduOptions(input);
      assert.deepEqual(result, { ...input, dingque: true });
      assert.deepEqual(validateChengduOptions({ ...input, dingque: true }), result);
      assert.deepEqual(input, before);
      assert.notEqual(result, input);
      for (const key of ['scoring', 'fanCap', 'exchangeDirection', 'playerCount', 'deckCount']) {
        assert.equal(Object.hasOwn(result, key), false);
      }
    });
  }
}

test('Chengdu choices reject omitted decisions, disabled dingque, wrong types and unconfirmed rule keys', () => {
  const valid = { endCondition: 'firstWin', exchangeThree: false };
  const invalid = [undefined, null, [], '', {}, { endCondition: 'firstWin' }, { exchangeThree: true },
    ...['', 'single', 1, null].map((endCondition) => ({ ...valid, endCondition })),
    ...['false', 0, null, undefined].map((exchangeThree) => ({ ...valid, exchangeThree })),
    ...[false, null, 1, undefined].map((dingque) => ({ ...valid, dingque })),
    { ...valid, fanCap: 4 }, { ...valid, exchangeDirection: 'clockwise' }];
  for (const input of invalid) assert.throws(() => validateChengduOptions(input), TypeError);
});

test('saved versions resolve inside Flower only, including missing-version legacy saves', () => {
  for (const [schemaVersion, original] of [[undefined, flowerLegacy], [1, flowerLegacy], [2, flowerV2], [3, flower]]) {
    for (const gameMode of [undefined, 'flower']) {
      const game = { ...(schemaVersion === undefined ? {} : { schemaVersion }),
        ...(gameMode === undefined ? {} : { gameMode }) };
      const before = structuredClone(game);
      const adapter = engineFor(game);
      assert.equal(adapter.apply, original.applyAction);
      assert.equal(adapter.view, original.getPlayerView);
      assert.equal(adapter.tileSet, FLOWER_TILE_SET);
      assert.equal(adapter.presentation?.apply ?? null, original.applyPresentedAction ?? null);
      assert.equal(adapter.presentation?.continue ?? null, original.continuePresentedGame ?? null);
      assert.equal(Object.isFrozen(adapter), true);
      assert.deepEqual(game, before);
    }
  }
  for (const schemaVersion of [0, 4, '3', null, NaN]) {
    assert.throws(() => engineFor({ schemaVersion }), modeError('UNSUPPORTED_GAME_VERSION'));
  }
});

test('unknown modes and Chengdu drafts never fall back to a matching Flower engine', () => {
  for (const schemaVersion of [undefined, 1, 2, 3, 4]) {
    for (const gameMode of ['', null, false, 'future', 'toString', '__proto__']) {
      assert.throws(() => engineFor({ gameMode, schemaVersion }), modeError('UNSUPPORTED_GAME_MODE'));
    }
    assert.throws(() => engineFor({ gameMode: 'chengdu', schemaVersion }),
      modeError(schemaVersion === 2 ? 'INVALID_GAME_STATE' : 'UNSUPPORTED_GAME_VERSION'));
  }
  const chengdu = modeForRoom({ gameMode: 'chengdu' });
  assert.equal(chengdu.currentEngine.schemaVersion, 2);
  assert.equal(chengdu.currentEngine.presentation, null);
  assert.deepEqual(Object.keys(chengdu.engines), ['2']);
  assert.throws(() => chengdu.startRules({ approved: true }), modeError('BAD_START_OPTIONS', 400));
  assert.throws(() => modeForRoom({ game: { gameMode: 'chengdu', schemaVersion: 3 } }), modeError('GAME_MODE_MISMATCH'));
  assert.throws(() => publicEvents({ gameMode: 'chengdu', schemaVersion: 3, history: [] }), modeError('UNSUPPORTED_GAME_VERSION'));
});

test('Flower input adapter retains legacy action filtering and its own 0–17 tile bounds', () => {
  const adapter = engineFor({ schemaVersion: 3 });
  assert.deepEqual(adapter.parseAction({ type: 'discard', tile: 17, tiles: [18, 19, 20], suit: 'characters' }),
    { type: 'discard', tile: 17 });
  assert.deepEqual(adapter.parseAction({ type: 'pass', tile: undefined }), { type: 'pass' });
  for (const tile of [18, 26, -1, 1.5, '0', null]) {
    assert.throws(() => adapter.parseAction({ type: 'discard', tile }), modeError('BAD_TILE', 400));
  }
  for (const action of [null, undefined, [], '', {}, { type: 1 }]) {
    assert.throws(() => adapter.parseAction(action), modeError('BAD_ACTION', 400));
  }
  assert.deepEqual(adapter.parseAction({ type: 'futureAction' }), { type: 'futureAction' });
});

// 枚举各版完整对局；动作选择依赖明确顺序而非网络或真正随机，逐步检查状态/视图/守恒。
// Replay full games for each version with deterministic selection, checking state, views and invariants after each action.
const variants = [
  { name: 'legacy', original: flowerLegacy, rules: {} },
  { name: 'v2', original: flowerV2, rules: {} },
  { name: 'v3-three', original: flower, rules: { playerCount: 3 } },
  { name: 'v3-four', original: flower, rules: { playerCount: 4, deckCount: 1, autoDiscardAfterHu: false } },
];
for (const { name, original, rules } of variants) {
  for (const explicitMode of [false, true]) {
    for (const seed of [0, 1]) {
      test(`${name} / explicit mode ${explicitMode} / seed ${seed}: adapter exactly replays original engine`, () => {
        let direct = original.createGame({ seed: `mode-${name}-${seed}`, rules });
        if (explicitMode) direct.gameMode = 'flower';
        let routed = structuredClone(direct);
        const adapter = engineFor(routed);
        let step = 0;
        while (direct.phase !== 'finished' && step < 1200) {
          const choices = [];
          for (let seat = 0; seat < direct.players.length; seat++) {
            assert.deepEqual(adapter.view(routed, seat), original.getPlayerView(direct, seat));
            choices.push(...original.getLegalActions(direct, seat).map((action) => ({ seat, action })));
          }
          const selected = choices.find(({ action }) => action.type === 'hu') ??
            choices.find(({ action }) => action.type.endsWith('Gang')) ??
            choices.find(({ action }) => action.type === 'peng') ?? choices[step % choices.length];
          assert.ok(selected, `No action at ${name} step ${step}`);
          const before = structuredClone(routed);
          const input = routed;
          routed = adapter.apply(routed, selected.seat, adapter.parseAction(selected.action));
          direct = original.applyAction(direct, selected.seat, selected.action);
          assert.deepEqual(input, before);
          assert.deepEqual(routed, direct);
          original.assertGameInvariants(routed);
          step++;
        }
        assert.equal(routed.phase, 'finished');
        assert.ok(step > 0 && step < 1200);
        assert.equal(routed.players.reduce((sum, player) => sum + player.score, 0), 0);
        assert.equal(Object.hasOwn(routed, 'gameMode'), explicitMode);
      });
    }
  }
}

test('presentation and public projections remain equivalent through the registered adapter', () => {
  let direct = flower.createGame({ seed: 'mode-presentation' });
  direct.gameMode = 'flower';
  const adapter = engineFor(direct);
  const action = flower.getLegalActions(direct, direct.currentSeat).find((item) => item.type === 'discard');
  let routed = adapter.presentation.apply(direct, direct.currentSeat, action);
  direct = flower.applyPresentedAction(direct, direct.currentSeat, action);
  assert.deepEqual(routed, direct);
  assert.ok(routed.presentation);
  routed = adapter.presentation.continue(routed);
  direct = flower.continuePresentedGame(direct);
  assert.deepEqual(routed, direct);
  assert.deepEqual(adapter.spectatorView(routed), spectatorGameView(direct));
  assert.deepEqual(adapter.publicEvents(routed), publicEvents(direct));
  const replacement = adapter.formerParticipantView(routed, 0);
  assert.ok(replacement.players.every((player) => player.hand === undefined));
  assert.deepEqual(replacement.legalActions, []);
  assert.equal(replacement.drawnTile, null);
  assert.equal(replacement.huDiagnostic, null);
  assert.equal(replacement.scoreBreakdown, null);
});
