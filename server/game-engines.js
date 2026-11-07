/**
 * 服务端模式适配边界：HTTP 不再按 schemaVersion 猜动作、展示续进或观战算法。
 * Server mode boundary: HTTP never guesses action, presentation or spectator algorithms from schemaVersion alone.
 * 先选已保存模式，再选该模式的保存版本；缺模式只兼容花麻将，读取从不补写默认字段。
 * Resolve saved mode first, then its saved version; only missing mode means Flower, with no read-time backfill.
 * 成都仅登记自己的生产版本；开发草稿与花麻将版本均不能替代正式存档。
 * Chengdu registers its own production version; drafts and Flower versions cannot substitute for production saves.
 */
import * as flower from '../shared/game.js';
import * as flowerV2 from '../shared/v2-game.js';
import * as flowerLegacy from '../shared/legacy-game.js';
import { FLOWER_GAME_MODE, gameModeDefinition, savedGameMode } from '../shared/game-modes.js';
import { isTileInSet } from '../shared/tile-sets.js';
import {
  isBigSingleReadyPoints, MAX_BIG_SINGLE_READY_POINTS, DEFAULT_BIG_SINGLE_READY_POINTS,
  DEFAULT_PLAYER_COUNT, DEFAULT_DECK_COUNT, DEFAULT_DRAGON_START_COUNT,
  MIN_DRAGON_START_COUNT, MAX_DRAGON_START_COUNT,
  isPlayerCount, isDeckCount, isDragonStartCount,
} from '../shared/start-options.js';
import { flowerPublicEvents, flowerSpectatorGameView } from './flower-visibility.js';
import * as chengdu from '../shared/chengdu-engine.js';
import { shuffledChengduWall } from './chengdu-shuffle.js';
import { nameEvent } from '../shared/event-names.js';
import { validateChengduRoomSettings } from '../shared/chengdu-room-settings.js';

// 适配层错误带稳定 HTTP 映射，但不依赖路由模块，避免 API 与规则互相循环导入。
// Adapter errors carry a stable HTTP mapping without importing the router or creating an API/rules dependency cycle.
export class GameModeError extends Error {
  // 只携带公开业务说明，不把原始存档或凭证附加到错误对象。
  // Carry public error details only, never raw saves or credentials.
  constructor(status, code, message) {
    super(message);
    this.name = 'GameModeError';
    this.status = status;
    this.code = code;
  }
}

// 只用于模式/协议校验；实际麻将非法动作仍由路由统一映射为 ILLEGAL_ACTION。
// Used for mode/protocol validation only; illegal Mahjong actions retain the router's ILLEGAL_ACTION mapping.
function fail(status, code, message) {
  throw new GameModeError(status, code, message);
}

// 仅接受已知开局选项并分别校验布尔/金额类型；省略选项保留新局默认值。
// Accept known start options and validate boolean/amount types separately; omission preserves new-game defaults.
function flowerStartRules(options) {
  // 未传选项时让新局默认值处理；不能用此入口重写正在进行的局。
  // Missing options defer to new-game defaults; this entry cannot rewrite an active game.
  if (options === undefined) return {};
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some(
      (key) => !['autoDiscardAfterHu', 'bigSingleReadyPoints'].includes(key),
    ) ||
    (Object.hasOwn(options, 'autoDiscardAfterHu') &&
      typeof options.autoDiscardAfterHu !== 'boolean')
  ) {
    fail(400, 'BAD_START_OPTIONS', '开局选项无效，请重新检查');
  }
  // 与前端共用金额边界；服务端仍独立验证，不能只相信数字输入框。
  // Share amount bounds with the client but validate independently on the server.
  if (
    Object.hasOwn(options, 'bigSingleReadyPoints') &&
    !isBigSingleReadyPoints(options.bigSingleReadyPoints)
  ) {
    fail(
      400,
      'BAD_START_OPTIONS',
      `大单吊喜钱须为 0–${MAX_BIG_SINGLE_READY_POINTS} 的整数（每家支付的虚拟积分）`,
    );
  }
  return { ...options };
}

// 配置只在建桌时校验和保存；旧桌读取时不补字段，下一局也不能通过 options 改人数。
// Validate and save configuration only at room creation; never backfill old rooms or resize through start options.
function flowerRoomSettings(input) {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some((key) => !['playerCount', 'deckCount', 'dragonStartCount', 'autoDiscardAfterHu', 'bigSingleReadyPoints'].includes(key))))
    fail(400, 'BAD_ROOM_SETTINGS', '牌桌配置无效，请重新检查');
  const settings = {
    playerCount: DEFAULT_PLAYER_COUNT,
    deckCount: DEFAULT_DECK_COUNT,
    dragonStartCount: DEFAULT_DRAGON_START_COUNT,
    autoDiscardAfterHu: true,
    bigSingleReadyPoints: DEFAULT_BIG_SINGLE_READY_POINTS,
    ...input,
  };
  if (!isPlayerCount(settings.playerCount))
    fail(400, 'BAD_ROOM_SETTINGS', '人数须为三人或四人');
  if (!isDeckCount(settings.deckCount))
    fail(400, 'BAD_ROOM_SETTINGS', '副数须为 1–5，每次增加半副');
  if (!isDragonStartCount(settings.dragonStartCount))
    fail(400, 'BAD_ROOM_SETTINGS', `神龙起算须为 ${MIN_DRAGON_START_COUNT}–${MAX_DRAGON_START_COUNT} 的整数`);
  // 显式 false 和 0 都必须保留；仅省略字段才使用创建默认值。
  // Preserve explicit false and zero; only omitted fields receive creation defaults.
  if (typeof settings.autoDiscardAfterHu !== 'boolean')
    fail(400, 'BAD_ROOM_SETTINGS', '胡后自动打出须为布尔值');
  if (!isBigSingleReadyPoints(settings.bigSingleReadyPoints))
    fail(400, 'BAD_ROOM_SETTINGS', `大单吊喜钱须为 0–${MAX_BIG_SINGLE_READY_POINTS} 的整数（每家支付的虚拟积分）`);
  return settings;
}

// 花麻将保留旧 type/tile 白名单和忽略额外动作字段的行为；不把成都的换牌数组混入旧协议。
// Preserve Flower's type/tile allowlist and ignored-extra-field behavior; Chengdu exchange arrays need their own parser.
function parseFlowerAction(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.type !== 'string') {
    fail(400, 'BAD_ACTION', '操作格式不正确');
  }
  const action = { type: input.type };
  if (input.tile !== undefined) {
    if (!isTileInSet(input.tile, gameModeDefinition(FLOWER_GAME_MODE).tileSet)) {
      fail(400, 'BAD_TILE', '牌的编号不正确');
    }
    action.tile = input.tile;
  }
  return action;
}

// 换座者没有前任私有信息权限；每种引擎须提供自己的投影，路由不能靠猜字段来遮牌。
// Replacements lack predecessor-private access; each engine owns its projection instead of the router guessing private fields.
// 花麻将复制既有按座位视图后保持原遮蔽语义，包括旧暗杠与特殊听牌字段。
// Flower preserves its previous masking after a seat view, including historical concealed kongs and special waits.
function flowerFormerParticipantView(engine, game, seat) {
  const view = engine.getPlayerView(game, seat);
  for (const player of view.players) {
    delete player.hand;
    player.melds = player.melds.map((meld) =>
      meld.type === 'anGang' &&
      !(game.schemaVersion === 3 && game.rules.publicConcealedKongs === true)
        ? {
            type: 'anGang',
            tile: null,
            tiles: Array(meld.tiles.length).fill(null),
            hidden: true,
            ...(meld.extended ? { extended: true } : {}),
          }
        : meld,
    );
  }
  view.drawnTile = null;
  view.legalActions = [];
  view.scoreBreakdown = null;
  view.waitTiles = [];
  view.lockedWaits = [];
  view.huLockActive = false;
  view.huDiagnostic = null;
  if (view.specialHuPattern !== undefined) view.specialHuPattern = null;
  return view;
}

// 适配器仅引用现有独立引擎，不复制/合并规则；冻结注册防止请求改变全局分发。
// Adapters reference independent existing engines without copying/merging rules; frozen registrations cannot change per request.
function flowerEngine(engine, schemaVersion) {
  return Object.freeze({
    gameMode: FLOWER_GAME_MODE,
    schemaVersion,
    tileSet: gameModeDefinition(FLOWER_GAME_MODE).tileSet,
    apply: engine.applyAction,
    view: engine.getPlayerView,
    formerParticipantView: (game, seat) => flowerFormerParticipantView(engine, game, seat),
    spectatorView: flowerSpectatorGameView,
    publicEvents: flowerPublicEvents,
    parseAction: parseFlowerAction,
    // 能力按适配器登记，而非“所有 schema 3 都是花麻将”；冻结旧版绝不借用新版续进。
    // Register capabilities, never assume every schema three means Flower; frozen engines never borrow current continuation.
    presentation: schemaVersion === 3 ? Object.freeze({
      apply: engine.applyPresentedAction,
      continue: engine.continuePresentedGame,
    }) : null,
  });
}

// 新局配置只摘取花麻将已定义字段；缺旧配置仍返回 null，不从默认值伪造历史。
// Snapshot only defined Flower configuration; missing old configuration yields null, never fabricated defaults.
function flowerGameConfiguration(room) {
  if (room.game?.rules?.playerCount === undefined) return null;
  return {
    playerCount: room.game.rules.playerCount,
    deckCount: room.game.rules.deckCount,
    dragonStartCount: room.game.rules.dragonStartCount,
    // 仅记录建房时已固定的新增字段；旧房缺字段不伪造创建快照。
    // Record newly fixed fields only when saved at room creation; do not invent legacy creation snapshots.
    ...(Object.hasOwn(room.settings || {}, 'autoDiscardAfterHu') ? {
      autoDiscardAfterHu: room.game.rules.autoDiscardAfterHu,
    } : {}),
    ...(Object.hasOwn(room.settings || {}, 'bigSingleReadyPoints') ? {
      bigSingleReadyPoints: room.game.rules.bigSingleReadyPoints,
    } : {}),
  };
}

const FLOWER_ENGINES = Object.freeze({
  1: flowerEngine(flowerLegacy, 1),
  2: flowerEngine(flowerV2, 2),
  3: flowerEngine(flower, 3),
});
const FLOWER_MODE = Object.freeze({
  id: FLOWER_GAME_MODE,
  legacySchemaVersion: 1,
  engines: FLOWER_ENGINES,
  currentEngine: FLOWER_ENGINES[3],
  roomSettings: flowerRoomSettings,
  startRules: flowerStartRules,
  gameConfiguration: flowerGameConfiguration,
  createGame: flower.createGame,
  dealerForNextGame: flower.dealerForNextGame,
});

// 成都注册自己的生产版本；开发准备/回合版本永远不是这个适配器的可恢复存档。
// Chengdu registers its own production version; preparation/turn drafts are never resumable through this adapter.
const CHENGDU_ENGINE = Object.freeze({
  gameMode: 'chengdu', schemaVersion: 2,
  tileSet: gameModeDefinition('chengdu').tileSet,
  apply: chengdu.applyAction,
  view: chengdu.getPlayerView,
  spectatorView: chengdu.getSpectatorView,
  formerParticipantView: chengdu.getFormerParticipantView,
  publicEvents: (game, seat, names) => chengdu.publicEvents(game, seat).map((event) => nameEvent(event, names || [])),
  // 请求结构错误统一返回400；真实动作是否合法仍由 applyAction 返回422。
  // Malformed requests return 400; applyAction retains 422 for well-formed but illegal decisions.
  parseAction(input) {
    try { return chengdu.parseAction(input); }
    catch (error) { fail(400, 'BAD_ACTION', error.message); }
  },
  presentation: null,
  presentationPresence: false,
  actionGameProof: true,
  playerSummary(player) {
    return { huCount: player.won ? 1 : (player.huCount || 0),
      kongCount: player.melds?.filter((meld) => ['anGang', 'mingGang', 'buGang'].includes(meld.type)).length ?? player.kongCount ?? 0 };
  },
});
const CHENGDU_ROOM_MODE = Object.freeze({
  id: 'chengdu', engines: Object.freeze({ 2: CHENGDU_ENGINE }), currentEngine: CHENGDU_ENGINE,
  roomSettings(input) {
    try { return validateChengduRoomSettings(input); }
    catch (error) { fail(400, 'BAD_ROOM_SETTINGS', error.message); }
  },
  // 建桌配置已固定，开局只允许省略或空选项，不接受客户端规则/洗牌/换牌序号。
  // Creation settings are fixed; starts accept absent/empty options, never client rules, walls or exchange counters.
  startRules(input) {
    if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length))
      fail(400, 'BAD_START_OPTIONS', '成都玩法已在建桌时固定，不能在开局时更改');
    return {};
  },
  createGame: chengdu.createGame,
  dealerForNextGame: chengdu.dealerForNextGame,
  gameConfiguration(room) {
    const { endCondition, exchangeThree, selfDraw, fanCap } = room.game.rules;
    return { playerCount: 4, dingque: true, endCondition, exchangeThree, selfDraw, fanCap };
  },
  // 只准备候选对象，不原地修改room；失败/并发输掉的开局不会推进换牌轮回。
  // Prepare a candidate without mutating room; failed/losing starts never advance the exchange cycle.
  startGame({ room, rules }) {
    const settings = validateChengduRoomSettings(rules);
    const game = chengdu.createGame({
      options: { endCondition: settings.endCondition, exchangeThree: settings.exchangeThree, dingque: true },
      scoring: { selfDraw: settings.selfDraw, fanCap: settings.fanCap },
      dealerSeat: room.game ? chengdu.dealerForNextGame(room.game) : 0,
      exchangeOrdinal: room.chengduExchangeOrdinal ?? 0,
      wall: shuffledChengduWall(),
    });
    return { game, roomUpdates: { chengduExchangeOrdinal: game.nextExchangeOrdinal } };
  },
});
const REGISTERED_MODES = Object.freeze({ [FLOWER_GAME_MODE]: FLOWER_MODE, chengdu: CHENGDU_ROOM_MODE });

// null/拼错的模式与已知但未就绪的模式分别报错；都不能回退花麻将或写入房间。
// Distinguish malformed/unknown modes from known unavailable modes; neither may fall back to Flower or create a room.
function registeredMode(gameMode) {
  const definition = gameModeDefinition(gameMode);
  if (!definition) {
    fail(409, 'UNSUPPORTED_GAME_MODE', '这桌使用了不支持的麻将模式，请刷新页面后重试');
  }
  const mode = REGISTERED_MODES[gameMode];
  if (!mode) {
    fail(409, 'GAME_MODE_UNAVAILABLE', `${definition.label}尚未开放，规则确认并完成验证后才能开局`);
  }
  return mode;
}

// 房间模式只在建房固定；当前局若声明另一模式则拒绝，避免续局意外换规则。
// Room mode is fixed at creation; reject a mismatching saved game rather than silently switching rules next round.
export function modeForRoom(room) {
  const gameMode = savedGameMode(room);
  const mode = registeredMode(gameMode);
  if (room.game && savedGameMode(room.game) !== gameMode) {
    fail(409, 'GAME_MODE_MISMATCH', '房间与牌局的麻将模式不一致，无法继续操作');
  }
  return mode;
}

// 版本只能在所属模式内解析；花麻将缺版本仍为 v1，字符串/未知版本继续显式拒绝。
// Resolve versions only within their mode; missing Flower versions remain v1, and strings/unknown versions are rejected.
export function engineFor(game, { archived = false } = {}) {
  const mode = registeredMode(savedGameMode(game));
  // 每种模式独立选择已登记版本，数字相同也不能跨模式借用引擎。
  // Resolve only registered versions within the mode; equal numbers never authorize cross-mode reuse.

  const schemaVersion = game.schemaVersion === undefined ? mode.legacySchemaVersion : game.schemaVersion;
  if (!Number.isInteger(schemaVersion) || !Object.hasOwn(mode.engines, schemaVersion)) {
    fail(409, 'UNSUPPORTED_GAME_VERSION', '这桌使用了更新的规则版本，请刷新页面后重试');
  }
  // 摘要仅由历史层显式声明；HTTP读取永远验证完整生产局，禁止草稿和损坏存档先产生副作用。
  // Only history explicitly declares summaries; HTTP reads always validate complete production saves before side effects.
  if (mode.id === 'chengdu') {
    if (game.runtimeKind !== 'production' || game.rulesVersion !== 'chengdu-1' ||
      Object.hasOwn(game, 'developmentOnly') || Object.hasOwn(game, 'developmentStage'))
      fail(409, 'INVALID_GAME_STATE', '成都开发存档不能作为正式牌局读取');
    if (!archived) {
      try { chengdu.assertGameInvariants(game); }
      catch { fail(409, 'INVALID_GAME_STATE', '成都牌局存档无效，无法继续操作'); }
    }
  }
  return mode.engines[schemaVersion];
}
