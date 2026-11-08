<script setup>
// 前端总协调组件：接收输入，读取服务端私有视图，管理房间生命周期与展示；绝不成为第二个规则引擎。
// Frontend coordinator: collect input, read server-filtered views, and manage room lifecycle and presentation; never act as a second rules engine.
// 阅读路线：docs/FRONTEND-READING-GUIDE.md。 / Reading map: docs/FRONTEND-READING-GUIDE.md.
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import MahjongTile from './MahjongTile.vue';
import Icon from './Icon.vue';
import ChengduTable from './ChengduTable.vue';
import { CharacterPortraitReactions, portraitForCharacter, warmCharacterPortraits } from './character-portraits.js';
import CharacterArtwork from './CharacterArtwork.vue';
import PortraitMotionSettings from './PortraitMotionSettings.vue';
import { chengduEventText } from './chengdu-event-text.js';
import { isChengduRoomSettings, CHENGDU_FAN_CAPS } from '../shared/chengdu-room-settings.js';
import { SharedPlaybackCoordinator } from './shared-playback.js';
// 开局选项与服务端共用默认值、上限和校验，避免两端接受不同的输入。
// Share start-option defaults, limits and validation with the server so both sides accept the same inputs.
import {
  DEFAULT_BIG_SINGLE_READY_POINTS,
  MAX_BIG_SINGLE_READY_POINTS,
  isBigSingleReadyPoints,
  DEFAULT_PLAYER_COUNT, DEFAULT_DECK_COUNT, DEFAULT_DRAGON_START_COUNT,
  MIN_DRAGON_START_COUNT, MAX_DRAGON_START_COUNT,
  isPlayerCount, isDeckCount, isDragonStartCount,
} from '../shared/start-options.js';
import {
  ActionVoiceCursor,
  CharacterAudio,
  CHARACTERS,
  characterForSeat,
} from './character-audio.js';

// 存储键是已发布的兼容契约，不能因变量重命名而更改字符串。
// Storage keys are published compatibility contracts; never rename their string values.
const STORAGE_KEY = 'huajian-mahjong-session-v1';
const ROOMS_KEY = 'huajian-mahjong-rooms-v2';
const PROFILE_KEY = 'huajian-mahjong-player-v1';
const DEPARTURES_KEY = 'huajian-mahjong-departures-v1';
// ref 保存会改变的值：脚本中用 .value，模板中 Vue 自动解包。以下状态仅控制声音和临时动画。
// ref stores mutable state: use .value in script; Vue unwraps it in templates. These values control audio and transient animation only.
const voiceStatus = ref('locked');
const voiceMuted = ref(false);
const winningEvents = ref([]);
const winningFlights = ref([]);
// 立绘与飞牌独立到期，普通动作不能提前撤下另一个座位的表情。
// Portraits expire independently from tile flights; ordinary actions cannot clear another seat's reaction.
const portraitReactionsBySeat = ref({});
const portraitImageCache = new Map();
const portraitReactions = new CharacterPortraitReactions({
  onChange: (reactions) => { portraitReactionsBySeat.value = reactions; },
});
let winningTimer;
let winningSafetyTimer;
let winningAnimations = [];
let finishWinningPresentation;
let presentationGeneration = 0;
// 本地音画控制本页输入；turnPresentation 仅保留旧屏障兼容，local模式不等其他座位。
// Local media gates this page’s input; turnPresentation retains legacy barrier compatibility, while local mode never awaits other seats.
const localPresentationBusy = ref(false);
let turnPresentation = null;
// 新模式分别保存最新权威快照和本机正在展示的快照；慢声音只影响本机按钮，不阻挡整桌。
// Keep received authority separate from the displayed frame; slow audio blocks this page's controls, never the table.
let receivedState = null;
let localPresentationGeneration = 0;
let localPresentationQueue = [];
let localPresentationRunning = false;
const localAnnouncement = ref('');
const localPendingPresentationCount = ref(0);
const sharedPendingPrefixCount = ref(0);
// 副页补齐的共享旧前缀不在本页批次中，也必须计入可主动略过的积压。
// Shared prefixes recovered by a sibling are outside its local batches but must count toward explicit backlog skip.
const pendingPresentationCount = computed(() => localPendingPresentationCount.value + sharedPendingPrefixCount.value);
const localCaptionFinishes = new Set();
// 每个页面实例使用独立公开 ID；它不是凭证，只用来防止同座位另一个标签页提前确认。
// Each page has a distinct public ID, not a credential, preventing another tab in the same seat from acknowledging early.
const presentationClientId = crypto.randomUUID();
const voiceCursor = new ActionVoiceCursor();
const characterAudio = new CharacterAudio({
  onStatus: (status) => {
    voiceStatus.value = status;
  },
});
// 同座页面共享的是公开事件的播放进度，既不是规则权威，也不持有暗手牌。
// Sibling pages share public playback progress, never game authority or concealed hands.
const sharedPlayback = new SharedPlaybackCoordinator({
  pageId: presentationClientId,
  onPendingPrefix: (count) => { sharedPendingPrefixCount.value = count; },
  play: (events) => characterAudio.enqueueOrdered(events),
  cancelAudio: () => characterAudio.clear(),
  canPlay: () => !document.hidden && characterAudio.unlocked && !characterAudio.muted &&
    characterAudio.context?.state === 'running',
});
let lastVoiceSync = 0;
let voiceNeedsBaseline = false;
let voiceVisibilityEpoch = 0;
// 表单与页面状态独立于服务端快照；选择手牌并不等于已经打出。
// Form and UI state are separate from server snapshots; selecting a tile does not discard it.
// 建房草稿仅在创建请求时提交；加入已有房间不能覆盖本桌的固定参数。
// Creation drafts are submitted only for a new room; joining cannot overwrite fixed room settings.
// 成都选择先保持空白，由房主明确选择；切回花麻将时保留两份独立草稿。
// Keep Chengdu choices blank until selected; switching modes preserves independent drafts.
const gameModeDraft = ref('flower');
const chengduEndConditionDraft = ref('');
const chengduExchangeThreeDraft = ref('');
const chengduSelfDrawDraft = ref('');
const chengduFanCapDraft = ref('');
const chengduSettingsDraft = computed(() => ({
  playerCount: 4, dingque: true,
  endCondition: chengduEndConditionDraft.value,
  exchangeThree: chengduExchangeThreeDraft.value,
  selfDraw: chengduSelfDrawDraft.value,
  fanCap: chengduFanCapDraft.value,
}));
const validChengduSettings = computed(() => isChengduRoomSettings(chengduSettingsDraft.value));
const playerCountDraft = ref(DEFAULT_PLAYER_COUNT);
const deckCountDraft = ref(DEFAULT_DECK_COUNT);
const dragonStartCountDraft = ref(DEFAULT_DRAGON_START_COUNT);
const deckChoices = Array.from({ length: 9 }, (_, index) => 1 + index * 0.5);
const validTableSettings = computed(() => isPlayerCount(playerCountDraft.value) &&
  isDeckCount(deckCountDraft.value) && isDragonStartCount(dragonStartCountDraft.value));
const preferredCharacter = ref('');
const autoDiscardAfterHu = ref(true);
// 建房（或旧桌下一局）草稿独立于保存的房间和本局规则；0 明确表示不收取。
// Creation (or legacy next-round) drafts stay separate from saved room/game rules; zero explicitly disables payment.
const bigSingleReadyPoints = ref(DEFAULT_BIG_SINGLE_READY_POINTS);
// 数字输入仍可能产生空字符串或非法小数；共用校验器要求范围内的整数，不只依赖 HTML 限制。
// Numeric inputs can still yield empty strings or invalid fractions; shared validation requires an in-range integer rather than relying only on HTML constraints.
const validReadyPoints = computed(() => isBigSingleReadyPoints(bigSingleReadyPoints.value));
// 只校验当前玩法；隐藏的另一模式草稿不阻挡创建，也不被发送。
// Validate the selected mode only; hidden drafts neither block creation nor enter the request.
const validCreationSettings = computed(() => gameModeDraft.value === 'chengdu'
  ? validChengduSettings.value
  : gameModeDraft.value === 'flower' && validTableSettings.value && validReadyPoints.value);
const name = ref('');
const roomCode = ref(roomFromLocation());
const entryMode = ref(roomCode.value ? (spectatorFromLocation() ? 'spectate' : 'join') : 'create');
// session 保存本桌访问凭证；state 保存服务端裁剪后的本人可见快照，不能推测对手手牌。
// session holds room credentials; state holds the server-filtered snapshot for this viewer, never inferred opponent hands.
const session = ref(null);
const state = ref(null);
const busy = ref(false);
const restoring = ref(false);
const offline = ref(false);
const syncing = ref(false);
const error = ref('');
const notice = ref('');
const showRules = ref(false);
const showInvite = ref(false);
const selectedTile = ref(null);
const selectedHandIndex = ref(null);
const copyDone = ref(false);
const modalRef = ref(null);
const inviteInput = ref(null);
const playerToken = ref('');
const personalHistory = ref(null);
const historyLoading = ref(false);
const historyError = ref('');
const storageWarning = ref('');
// 定时器、取消控制器和代数不是展示值，因此不用 ref。epoch 使旧异步任务失去更新当前页面的资格。
// Timers, abort controllers and generations are not rendered, so they need no ref. epoch invalidates old asynchronous work.
let pollTimer;
let noticeTimer;
let copyTimer;
let pollController;
let epoch = 0;
let previousFocus = null;
let profilePromise = null;
let historyGeneration = 0;
let destroyed = false;
let connectingSession = null;
// 分别跟踪可取消请求、缓存座位、在途离席和失败离席，不能把这些集合混为一谈。
// Track cancellable requests, cached seats, in-flight departures and failed departures separately.
const roomControllers = new Set();
const savedRooms = new Map();
const pendingLeaves = new Map();
const failedLeaves = new Map();

// computed 缓存由依赖派生的值；依赖变化后才重新计算，不要在其中发请求或改规则。
// computed caches derived values and recalculates when dependencies change; do not request data or change rules inside it.
const inRoom = computed(() => !!state.value && !!session.value);
const game = computed(() => state.value?.game || null);
// 房间内只认服务端模式，不能被大厅草稿或 schemaVersion 切换；缺模式旧桌仍按花麻将显示。
// In a room, trust only its saved mode, never lobby drafts/schemaVersion; absent legacy modes remain Flower.
const isChengduRoom = computed(() => state.value?.gameMode === 'chengdu');
const isChengduContext = computed(() => inRoom.value ? isChengduRoom.value :
  entryMode.value === 'create' && gameModeDraft.value === 'chengdu');
// 观众没有“本人座位”；null 不可退化为 0，否则会误展示房主按钮和第一席私有面板。
// Spectators have no own seat; null must not become zero and enable host controls or seat-zero private panels.
const isSpectator = computed(() => state.value?.viewerRole === 'spectator');
const mySeat = computed(() => isSpectator.value ? null : state.value?.you ?? game.value?.mySeat ?? 0);
// 旧桌使用开局版本的规则；这些开关只选择兼容展示，不能把旧局静默升级。
// Existing games retain their starting rules; these flags select compatible display rather than silently upgrading a game.
const isLegacy = computed(() => !isChengduRoom.value && !!game.value && (game.value.schemaVersion ?? 1) < 2);
const isLatest = computed(() => !isChengduRoom.value && (!game.value || game.value.schemaVersion >= 3));
const usesSpecialPatterns = computed(
  () => !game.value || game.value.rules?.specialHuPatterns === true,
);
// 规则说明只读本局显式快照；缺字段/false 的旧局不能被大厅的新默认文案覆盖。
// Rule text reads explicit game snapshots; absent/false old flags must not inherit new-lobby wording.
// 这里只选择说明，不计算合法动作；冻结旧引擎仍使用各自专用说明区。
// This selects explanatory text, never legal actions; frozen engines retain their separate rule sections.
const preHuActionChoice = computed(() => !game.value ||
  (isLatest.value && game.value.rules?.preHuActionChoice === true));
const concealedKongAfterPungDiscard = computed(() => !game.value ||
  (isLatest.value && game.value.rules?.concealedKongAfterPungDiscard === true));
const isOlderGame = computed(() => !isChengduRoom.value && !!game.value && !isLatest.value);
const postHu = computed(() => !isLegacy.value && (me.value?.huCount || 0) > 0);
const huDiagnostic = computed(() => (!isLegacy.value ? game.value?.huDiagnostic : null));
const phase = computed(() => state.value?.phase || 'lobby');
// 本局规则优先于房间配置；旧桌只在显示时用3人2副，不写回存档。
// Prefer the active snapshot; display legacy rooms as three players/two decks without mutating them.
// 部分界面夹具或连接中过渡快照可能只含占用座位，不能把占座数当成配置人数。
// Partial/connecting views may list only occupants; occupancy is not the configured table size.
const tablePlayerCount = computed(() => game.value?.rules?.playerCount ??
  state.value?.settings?.playerCount ??
  (isPlayerCount(state.value?.seats?.length) ? state.value.seats.length : DEFAULT_PLAYER_COUNT));
const tableDeckCount = computed(() => game.value?.rules?.deckCount ??
  state.value?.settings?.deckCount ?? DEFAULT_DECK_COUNT);
const tableDragonStartCount = computed(() => game.value?.rules?.dragonStartCount ??
  state.value?.settings?.dragonStartCount ?? DEFAULT_DRAGON_START_COUNT);
const tableCopies = computed(() => tableDeckCount.value * 4);
const exponentialDragon = computed(() => !game.value || game.value.rules?.exponentialDragon === true);
const extendedCopyFan = computed(() => !game.value || game.value.rules?.extendedCopyFan === true);
// 绝对座位来自本桌人数，与角色池数量无关；新占座者不能继承上一局手牌。
// Absolute seats follow table size, not character count; replacement occupants cannot inherit old hands.
const seats = computed(() =>
  Array.from({ length: tablePlayerCount.value }, (_, seat) => {
    const occupant = state.value?.seats?.find((player) => player?.seat === seat);
    const participant =
      (isSpectator.value && game.value) || (occupant && occupant.isCurrentParticipant !== false)
        ? game.value?.players?.find((player) => player.seat === seat)
        : null;
    return {
      seat,
      name: '',
      score: 0,
      handCount: 0,
      huCount: 0,
      melds: [],
      radishes: [],
      winPile: [],
      ...(occupant || {}),
      ...(participant || {}),
      // 观众终局仍看原参赛者的公开牌区，不能让换座者的名字接管上一局。
      // After finish spectators still see the original participants' public zones, never replacement names.
      ...(isSpectator.value && game.value ? {
        name: game.value.participantNames?.[seat] || `牌友 ${seat + 1}`,
        connected: Boolean(occupant?.isCurrentParticipant !== false && occupant?.connected),
        detached: !occupant || occupant.isCurrentParticipant === false || occupant.detached,
      } : {}),
    };
  }),
);
// 终局用本局参与者名单，不让后来换座者继承上一局显示的成绩。
// Use game participants after settlement so replacement occupants do not inherit the displayed previous-game scores.
const scoreSeats = computed(() =>
  phase.value === 'finished' && game.value?.participantNames
    ? game.value.players.map((player) => ({
        ...player,
        name: game.value.participantNames[player.seat] || `牌友 ${player.seat + 1}`,
      }))
    : seats.value,
);
const me = computed(() => seats.value[mySeat.value] || { name: '', melds: [], radishes: [], winPile: [], isCurrentParticipant: false });
const tableScoreRows = computed(() => state.value?.tableScores || []);
// 新规则要求碰后实际打出一张才解锁补杠，不是永久禁止。旧 v3 的 allowPungUpgrade:false 也显示修正后的先出牌要求；其他旧局仍保留原时机说明。
// The corrected rule unlocks pung upgrading after an actual discard, not a permanent ban. Old v3 allowPungUpgrade:false games also show this discard-first rule; other older games retain their timing description.
const pungUpgradeAfterDiscard = computed(
  () =>
    !game.value ||
    (isLatest.value &&
      (game.value.rules?.pungUpgradeAfterDiscard === true ||
        game.value.rules?.allowPungUpgrade === false)),
);
const counterclockwise = computed(
  () => !game.value || game.value.rules?.turnDirection === 'counterclockwise',
);
// 玩家显示左、对（仅四人）、右；观众显示全部绝对座位，不虚构本人席位。
// Players see left/opposite (four seats only)/right; spectators see every absolute seat without an invented own seat.
const opponents = computed(() => isSpectator.value ? seats.value :
  Array.from({ length: tablePlayerCount.value - 1 }, (_, index) =>
    seats.value[(mySeat.value + index + 1) % tablePlayerCount.value],
  ),
);
const riverPlayers = computed(() => {
  if (isSpectator.value) return seats.value;
  return tablePlayerCount.value === 4
    ? [opponents.value[0], opponents.value[1], me.value, opponents.value[2]]
    : [opponents.value[0], me.value, opponents.value[1]];
});
// 公开位置标签仅供玩家布局/读屏；观众没有相对座位，不标记任何对家。
// Position labels serve player layout/accessibility; spectators have no relative/opposite seat.
function opponentPosition(seat) {
  if (isSpectator.value) return '';
  const offset = (seat - mySeat.value + tablePlayerCount.value) % tablePlayerCount.value;
  if (tablePlayerCount.value === 4 && offset === 2) return '对家';
  return offset === 1 ? '左手边' : '右手边';
}
// 终局观战面板保留原参赛者，但落座数量只按当前占用者计算。
// Finished spectator panels retain prior participants, but occupancy counts only current occupants.
const filledSeats = computed(() => (state.value?.seats || []).filter(Boolean).length);
const isHost = computed(() => !isSpectator.value && mySeat.value === (state.value?.hostSeat ?? 0));
// 新桌的两项规则由创建时快照确定；按字段存在判断，绝不把旧桌缺字段视为已固定默认值。
// Creation snapshots fix these choices for new rooms; check field presence rather than inventing fixed defaults for old rooms.
const hasFixedAutoDiscard = computed(() => Object.hasOwn(state.value?.settings || {}, 'autoDiscardAfterHu'));
const hasFixedReadyPoints = computed(() => Object.hasOwn(state.value?.settings || {}, 'bigSingleReadyPoints'));
// 成都开局仍须服务端明确登记正式版本；旧准备服务端的 null 版本不能被前端自行开放。
// Chengdu starts require a registered production version; a legacy preparation server with null version remains gated.
const canStart = computed(() => (!isChengduRoom.value || state.value?.rulesVersion === 2) && isHost.value && ['lobby', 'finished'].includes(phase.value));
const canConfigureStart = computed(() => !isChengduRoom.value && canStart.value &&
  (!hasFixedAutoDiscard.value || !hasFixedReadyPoints.value));
// 已固定的金额不受无关本地草稿影响；只有仍使用旧开局表单的房间需要校验草稿。
// A fixed amount is independent of stale local drafts; validate drafts only for legacy editable rooms.
const validStartOptions = computed(() => isChengduRoom.value || hasFixedReadyPoints.value || validReadyPoints.value);
// ?? 只为缺字段的旧数据补显示默认值，保留有效的 0；不能用 || 把“不收取”误改成 50。
// ?? supplies a display default only for missing fields and preserves valid zero; || would incorrectly turn disabled payment into 50.
const gameBigSingleReadyPoints = computed(
  () => game.value?.rules?.bigSingleReadyPoints ?? DEFAULT_BIG_SINGLE_READY_POINTS,
);
// 必须是当前引擎且已保存的两个开关都明确开启，才展示为已启用；不向旧局追补喜钱。
// Only the current engine with both explicitly saved flags enabled displays this payment as enabled; never retrofit bonuses into older games.
const gameBigSingleReadyEnabled = computed(
  () =>
    isLatest.value &&
    game.value?.rules?.specialHuPatterns === true &&
    game.value?.rules?.bigSingleReadyPayment === true,
);
// 缺失此字段的旧局按原默认开启；新局配置草稿与已开局只读规则分开保存。
// Older games without this field keep the enabled default; next-game drafts stay separate from immutable active-game rules.
const gameAutoDiscardAfterHu = computed(() => game.value?.rules?.autoDiscardAfterHu !== false);
// 按钮来自服务端 legalActions；前端筛选展示，但最终合法性仍由后端验证。
// Buttons come from server legalActions; the client filters presentation while the backend validates legality.
const presentationWaiting = computed(
  () => localPresentationBusy.value || Boolean(state.value?.presentation),
);
const legalActions = computed(() =>
  isSpectator.value || presentationWaiting.value ? [] : game.value?.legalActions || [],
);
// 复制后排序，不就地修改权威手牌；将最后一张同种摸牌移至末尾，仅改变显示顺序。
// Sort a copy rather than mutating authoritative hands; move the last matching drawn tile to the end for display only.
const hand = computed(() => {
  const sortedTiles = [...(me.value?.hand || [])].sort(
    (leftTile, rightTile) => leftTile - rightTile,
  );
  const drawnTile = game.value?.drawnTile;
  if (drawnTile != null) {
    const drawnTileIndex = sortedTiles.lastIndexOf(drawnTile);
    if (drawnTileIndex >= 0) {
      sortedTiles.splice(drawnTileIndex, 1);
      sortedTiles.push(drawnTile);
    }
  }
  return sortedTiles;
});
const discardOptions = computed(() =>
  legalActions.value.filter((action) => action.type === 'discard'),
);
const canDiscard = computed(() =>
  discardOptions.value.some((action) => action.tile === selectedTile.value),
);
const primaryActions = computed(() =>
  legalActions.value.filter(
    (action) =>
      !['discard', 'anGang', 'buGang', 'addGang'].includes(action.type) &&
      (isLegacy.value || action.type !== 'draw'),
  ),
);
const gangActions = computed(() =>
  legalActions.value.filter((action) => ['anGang', 'buGang', 'addGang'].includes(action.type)),
);
const isMyTurn = computed(
  () =>
    !presentationWaiting.value &&
    game.value?.currentSeat === mySeat.value &&
    game.value?.phase === 'turn' &&
    phase.value === 'playing',
);
const currentPlayer = computed(() => seats.value[game.value?.currentSeat]);
// 每份服务端快照只分组一次，避免每个座位的数量、空态和列表随本地 UI 更新反复扫描整条牌河。
// Group once per server snapshot instead of rescanning the entire river for
// each seat's count, empty check and tile list on every local UI update.
const discardsBySeat = computed(() => {
  const groups = seats.value.map(() => []);
  for (const [index, discard] of (game.value?.discards || []).entries()) {
    if (groups[discard.seat])
      groups[discard.seat].push({
        index,
        tile: discard.tile,
        huSeats: discard.huSeats,
        claimedBy: discard.claimedBy,
        claimedAs: discard.claimedAs,
      });
  }
  return groups;
});
// 胡牌反馈是临时派生数据；Set 加速牌河高亮查找，不参与牌数守恒。
// Win feedback is temporary derived data; Set speeds highlight lookup and does not affect physical tile counts.
const winningDiscardIndices = computed(
  () => new Set(winningEvents.value.map((event) => event.discardIndex).filter(Number.isInteger)),
);
const winningAnnouncement = computed(() =>
  winningEvents.value
    .map(
      (event) =>
        `${seatLabel(event.seat)}${winSourceLabel(event)}${event.hidden ? '（牌面隐藏）' : tileLabel(event.tile)}${event.fromSeat != null ? `，来自${seatLabel(event.fromSeat)}` : ''}`,
    )
    .join('；'),
);
// 倒序前复制数组：最新记录在顶部，但不能反转服务端历史数组本身。
// Copy before reversing: newest events appear first without reversing the server history itself.
const history = computed(() => [...(game.value?.history || [])].reverse());
const sharedRadishes = computed(() =>
  [...(game.value?.sharedRadishes || [])].sort((a, b) => a - b),
);
const latestSharedRadishes = computed(() =>
  history.value.find((entry) => entry.newRadishes?.length || entry.radish != null),
);
const lastOwnHu = computed(() =>
  history.value.find((entry) => entry.type === 'hu' && entry.seat === mySeat.value),
);
const lastOwnScore = computed(() => game.value?.scoreBreakdown || me.value?.lastScoreBreakdown);
const pendingKongLabel = computed(() =>
  game.value?.claim?.kongType === 'addGang' ? '加杠' : '补杠',
);
const canHu = computed(() => legalActions.value.some((action) => action.type === 'hu'));
// 只有服务端明确只给“胡”时才提示必胡；不为冻结的旧引擎制造新规则或新动作。
// Describe a forced win only when the server supplies hu alone; do not invent rules/actions for frozen engines.
const mustHu = computed(
  () => isLatest.value && postHu.value && canHu.value &&
    legalActions.value.every((action) => action.type === 'hu'),
);
// 邀请链接仅携带 room，清除其他查询参数和片段，绝不附带个人或座位令牌。
// Invitations contain only room, removing other query parameters and fragments; never append identity or seat tokens.
const shareUrl = computed(() => {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', state.value?.id || session.value?.roomId || '');
  return url.toString();
});
// 按终局、大厅、接牌、本人回合的优先顺序选择提示；分支顺序会影响显示含义。
// Choose status text in priority order: finish, lobby, claim, own turn; branch order affects meaning.
const statusTitle = computed(() => {
  if (presentationWaiting.value)
    return state.value?.presentationMode === 'local'
      ? localPresentationBusy.value ? '本机动作按顺序播放' : '牌桌正在继续'
      : '等待动画与语音结束';
  if (phase.value === 'finished')
    return ['allPlayersHu', 'allThreeHu', 'all_players_hu'].includes(game.value?.finishReason)
      ? '所有玩家都胡了，本局结束'
      : '本局圆满结束';
  if (isChengduRoom.value) return filledSeats.value === 4 ? '四位已落座，等待房主开局' : '成都牌桌，等待朋友落座';
  if (phase.value === 'lobby') return filledSeats.value === tablePlayerCount.value ? '牌友已到齐' : '等牌友，一起开局';
  if (mustHu.value) return '已经胡过，这张必须胡';
  if (game.value?.phase === 'claim' && game.value?.claim?.kind === 'robKong')
    return legalActions.value.length
      ? '可以抢杠，等你回应'
      : `${pendingKongLabel.value}待确认，等待牌友回应`;
  if (game.value?.phase === 'claim')
    return legalActions.value.length ? '这张牌，等你回应' : '等待牌友回应';
  if (isMyTurn.value && postHu.value)
    return canHu.value
      ? '这张可以胡，请你决定'
      : gangActions.value.length
        ? '手牌已固定，请选择杠牌'
        : '手牌已固定，点过继续';
  if (isMyTurn.value)
    return game.value?.turnStep === 'draw'
      ? isLegacy.value
        ? '轮到你摸牌'
        : '正在自动摸牌'
      : '牌已摸好，选一张出手';
  return `等待${currentPlayer.value?.name || '牌友'}${game.value?.turnStep === 'draw' ? '摸牌' : '出牌'}`;
});
// 先解释同步或断线，再解释规则状态；文字只描述服务端状态，不驱动牌局。
// Explain synchronization or disconnection before rule state; text describes server state without driving play.
const statusDetail = computed(() => {
  if (isSpectator.value) return '只读观战，不占座位；仅展示公开牌面和本局动态。';
  if (syncing.value) return '正在确认刚才的操作结果，请稍等。';
  if (offline.value) return '连接暂时中断，正在尝试重新连接';
  if (isChengduRoom.value) return '四家落座后由房主开始，换三张与定缺都由本人选择。';
  if (presentationWaiting.value && state.value?.presentationMode === 'local')
    return localAnnouncement.value || '本机展示结束即可操作，不等待其他设备的声音。';
  if (presentationWaiting.value)
    return localPresentationBusy.value
      ? '本次动作正在展示，结束后才继续判定。'
      : '本机展示已结束，等待其他牌友的动画与语音。';
  if (phase.value === 'playing' && currentPlayer.value?.detached)
    return `${currentPlayer.value.name}已离桌，本局等待该牌友重连；已记积分不会清除。`;
  if (phase.value === 'finished') return finishText.value;
  if (mustHu.value) return '已经胡过，能胡就必须胡；请点击“胡牌”，不能过、出牌、碰或杠。';
  if (game.value?.phase === 'claim' && game.value?.claim?.kind === 'robKong')
    return legalActions.value.length
      ? `本次只能抢杠胡或过，不能碰、杠；所有人过后才形成${pendingKongLabel.value}。`
      : `${pendingKongLabel.value}尚未成立，暂不收杠分、不翻萝卜；等待有资格的牌友回应。`;
  if (game.value?.phase === 'claim')
    return legalActions.value.length
      ? canHu.value
        ? legalActions.value.some((action) => action.type === 'peng')
          ? '这张可胡，也可碰；你可以选择胡、碰或过。'
          : '这张可以胡。胡牌优先于碰、杠。'
        : '请选择可用操作；胡牌优先，明杠其次，再到碰。'
      : '所有需要回应的牌友选择后，继续下一轮。';
  if (phase.value === 'lobby')
    return filledSeats.value === tablePlayerCount.value
      ? isHost.value
        ? '你是房主，随时可以开始。'
        : '请等待房主开始牌局。'
      : `还差 ${tablePlayerCount.value - filledSeats.value} 位牌友，把邀请链接发给他们吧。`;
  if (isMyTurn.value && game.value?.turnStep === 'draw')
    return isLegacy.value ? '本桌沿用旧规则，点击“摸一张”继续。' : '自动发牌，无需点击摸牌。';
  if (isMyTurn.value && postHu.value)
    return gangActions.value.length
      ? '原手牌不能换打；当前必须杠牌，请选择下方可用杠牌。'
      : canHu.value
        ? '原手牌不能换打；不胡就打出刚摸到的这一张。'
        : '原手牌不能换打；点“过”打出新牌。';
  if (isMyTurn.value) return '先点击手牌，再点击“打出”。';
  return '看看牌河，下一手慢慢想。';
});
// 兼容历史终局原因拼写，仅映射文字，不修改结束原因。
// Support historical finish-reason spellings as labels without changing the reason.
const finishText = computed(
  () =>
    ({
      allPlayersHu: '所有玩家均已胡牌，本局结束，积分已结算。',
      allThreeHu: '所有玩家均已胡牌，本局结束，积分已结算。',
      all_players_hu: '所有玩家均已胡牌，本局结束，积分已结算。',
      wallExhausted: '牌墙已空，积分已结算。可以相约再来一桌。',
      wall_exhausted: '牌墙已空，积分已结算。可以相约再来一桌。',
    })[game.value?.finishReason] || '积分已结算，可以相约再来一桌。',
);
// 为页眉提供简短阶段文字，详细等待原因由上面的状态计算负责。
// Provide a short phase label; the status computations above explain detailed waiting reasons.
const statusLabel = computed(() => {
  if (phase.value === 'lobby') return isChengduRoom.value ? '房间准备' : '等待开局';
  return phase.value === 'finished' ? '本局结束' : '正在牌局中';
});

// 按钮先解锁浏览器音频，再切换静音；偏好保存失败不阻断牌局。
// Unlock browser audio or toggle mute; preference storage failure must not stop play.
async function toggleVoice() {
  if (
    voiceStatus.value !== 'ready' ||
    voiceMuted.value ||
    characterAudio.context?.state !== 'running'
  ) {
    voiceMuted.value = false;
    characterAudio.setMuted(false);
    if (await characterAudio.unlock()) characterAudio.warmWins(game.value?.characters);
  } else {
    voiceMuted.value = true;
    // 用户主动静音取消未开始的声音资格；以后取消静音不会补读静音期间或此前积压的声音。
    // Explicit mute revokes queued speech eligibility; unmuting never resurrects muted-period or older queued speech.
    for (const batch of localPresentationQueue) batch.audioEligible = false;
    sharedPlayback.cancel();
    characterAudio.setMuted(true);
  }
  try {
    localStorage.setItem('huajian-voice-muted', String(voiceMuted.value));
  } catch {
    /* 可选偏好保存失败不影响牌局。 / optional preference */
  }
}
// 真实点击或按键才能解锁声音；语音按钮由自己的处理函数负责，避免切换两次。
// A real click or keypress unlocks audio; the voice button handles itself to avoid a double toggle.
function unlockVoice(event) {
  if (event?.target?.closest?.('.voice-toggle')) return;
  if (
    !voiceMuted.value &&
    (voiceStatus.value === 'locked' || characterAudio.context?.state !== 'running')
  )
    characterAudio.unlock().then((ready) => {
      if (ready) characterAudio.warmWins(game.value?.characters);
    });
}
// 正在展示的牌局沿用其角色快照；大厅优先读取落座时保存的角色，不再把偏好当作分配结果。
// A displayed game retains its character snapshot; lobbies prefer the persisted seated identity, not the preference as an assignment.
function characterForPlayer(seat, forOccupant = false) {
  const occupant = state.value?.seats?.find((player) => player?.seat === seat);
  // 旧响应可能还没有characterId；只在权威角色缺失时兼容此前的偏好/绝对座位显示。
  // Older responses may lack characterId; only then retain preference/absolute-seat display fallbacks.
  // 终局补位人的身份面板用新占座角色；原牌局/观战公开区仍显示原参赛角色。
  // A finished-round replacement's identity uses the new occupant; game/spectator panels retain original participants.
  const gameCharacter = forOccupant && occupant?.isCurrentParticipant === false ? null : game.value?.characters?.[seat];
  const character = CHARACTERS.find((character) => character.id === gameCharacter) ||
    CHARACTERS.find((character) => character.id === occupant?.characterId) ||
    CHARACTERS.find((character) => character.id === occupant?.preferredCharacter) ||
    characterForSeat(seat, tablePlayerCount.value);
  // 本人、对手大立绘/头像和成都牌桌共享同一绝对座位的短暂表情。
  // Self, opponent portraits/avatars and Chengdu share one transient reaction per absolute seat.
  return {
    ...character,
    portrait: portraitForCharacter(character, portraitReactionsBySeat.value[seat]),
    // 模型只接收公开展示状态和稳定座位相位，不接收手牌、候选回应或私人身份。
    // Models receive only public presentation state and stable seat phase, never hands, pending claims or private identity.
    portraitReaction: portraitReactionsBySeat.value[seat] || 'base',
    portraitPhaseKey: `${character.id}:${seat}`,
  };
}
// 同时记录牌种和显示下标；再次点击同一张取消选择，同牌种的两张仍可区分。
// Track both tile type and display index; clicking the same instance deselects it, even when tile types repeat.
function selectHand(tile, index) {
  if (selectedHandIndex.value === index) {
    selectedTile.value = null;
    selectedHandIndex.value = null;
  } else {
    selectedTile.value = tile;
    selectedHandIndex.value = index;
  }
}
// 0–8 是条，9–17 是筒；空值表示隐藏牌，不把它误认成一条。
// IDs 0–8 are bamboo and 9–17 dots; null means hidden, not one bamboo.
function tileLabel(tile) {
  return tile == null ? '暗牌' : `${(tile % 9) + 1}${tile < 9 ? '条' : '筒'}`;
}
// 优先显示本局参与者名字，避免换座后历史记录跟着改名。
// Prefer the game participant name so seat replacements do not relabel historical events.
function seatLabel(seat) {
  return game.value?.participantNames?.[seat] || seats.value[seat]?.name || `牌友 ${seat + 1}`;
}
// 按 Unicode 字符取昵称首字；空座用“待”占位。
// Take the first Unicode character of the name, with a waiting-seat fallback.
function initials(player) {
  return [...(player?.name || '待')][0];
}
// 正分显式加号，零与缺省值显示为零；只格式化，不修改分数。
// Show a plus sign for positive points and zero for missing values; format without changing scores.
function scoreLabel(score) {
  return score > 0 ? `+${score}` : `${score || 0}`;
}
// 读取预先分组的公开牌河；缺失座位返回空列表。
// Read the pre-grouped public discard river, falling back to an empty list.
function discardsFor(seat) {
  return discardsBySeat.value[seat] || [];
}
// 把服务端动作转换为按钮文字；加杠张数读取已存在的杠，不把碰当成杠。
// Convert server actions to button labels; extension counts come from an existing kong, not a pung.
function actionLabel(action) {
  const extended =
    action.type === 'addGang'
      ? me.value?.melds?.find(
          (meld) =>
            meld.type !== 'peng' &&
            meld.tile === action.tile &&
            meld.tiles?.length >= 4 &&
            meld.tiles.length < tableCopies.value,
        )
      : null;
  return (
    {
      draw: '摸一张',
      hu: '胡牌',
      pass:
        postHu.value && isMyTurn.value
          ? canHu.value
            ? '不胡 / 过 · 打出新牌'
            : '过 · 打出新牌'
          : '过',
      peng: '碰',
      mingGang: '明杠',
      anGang: `暗杠 · ${tileLabel(action.tile)}`,
      buGang: `补杠 · ${tileLabel(action.tile)}`,
      addGang: `加第 ${(extended?.tiles?.length || 4) + 1} 张 · ${tileLabel(action.tile)}`,
    }[action.type] || action.type
  );
}
// 将公开副露类型和扩展张数转成标签，不参与合法性判定。
// Label a public meld and its extended size without deciding legality.
function meldLabel(meld) {
  const base =
    { peng: '碰', mingGang: '明杠', anGang: '暗杠', buGang: '补杠', addGang: '加杠' }[meld.type] ||
    '副露';
  return `${base}${meld.tiles?.length >= 5 ? ` · ${meld.tiles.length} 张` : ''}`;
}
// 区分自摸、接炮、抢杠及共胡逻辑副本；标签不新增实体牌。
// Distinguish win sources and virtual shared-win copies; labels do not create physical tiles.
function winLabel(win) {
  // 遮牌记录没有牌种，提示与读屏也不能把 null 当作一条。
  // Masked entries have no identity; tooltips and screen readers must not coerce null into one bamboo.
  if (win.hidden) return '自摸 · 牌面隐藏，终局公开';
  return `${tileLabel(win.tile)} · ${win.source === 'selfDraw' ? '自摸' : win.source === 'robKong' ? '抢杠胡' : win.source === 'kongDiscard' ? '杠后接胡' : '接炮'}${win.virtual ? ' · 共胡记牌，不另算实物牌' : ''}`;
}
// 兼容不同版本的服务端计分明细；只解释已经算好的番、萝卜与付款方。
// Describe server-computed fan, radishes and payers across schema versions; do not calculate rules here.
function scoreSummary(score, payments = []) {
  if (!score) return '';
  const payers = paymentSummary({ payments });
  const paidBy = payers ? `；${payers}` : payments.length ? '；本次无付款方，收入 0 分' : '';
  if (score.fan == null)
    return `基础 ${score.base} + 萝卜 ${score.radishBonus} + 神龙 ${score.dragonBonus} = ${score.total} 分 / 家${paidBy}`;
  if (score.bigSingle && score.overlapPolicy === 'exclusive')
    return `大单钓：${score.total} 分 / 付款方（本次不叠加番分、萝卜${isLatest.value ? '；神龙局末另结' : '、神龙'}）${paidBy}`;
  const patterns = (
    score.patternBonuses ||
    // 旧特殊牌型开关关闭时仍可能有本次事件番，按来源字段读取，不重新算分。
    // Older non-pattern scoring may still carry event fan; read its source fields without recalculating scores.
    ['robKong', 'kongDiscard', 'kongReplacement']
      .filter((type) => score[`${type}Bonus`])
      .map((type) => ({ type, fan: score[`${type}Bonus`] }))
  )
    .map((item) =>
      item.type === 'sevenPairs' && score.sevenPairsFixed
        ? `七对固定${item.fan}番`
        : `${{ bigSingle: '大单吊', allTriplets: '对对胡', pureSuit: '清一色', robKong: '抢杠', kongDiscard: '杠后接炮', kongReplacement: '杠上花', sevenPairs: '七对' }[item.type] || item.type} +${item.fan}番`,
    )
    .join('、');
  const prefix = patterns ? `${patterns} · ` : '';
  return `${prefix}${score.fan} 番 ${score.fanPoints} 分 + ${isLatest.value ? '共享萝卜' : '萝卜'} ${score.radishBonus}${isLatest.value ? '' : ` + 神龙 ${score.dragonBonus}`}${score.bigSinglePoints > 0 ? ` + 大单钓 ${score.bigSinglePoints}` : ''} = ${score.total} 分 / 付款方${paidBy}`;
}
// 说明共享池最近一次增量，兼容单张 radish 与多张 newRadishes。
// Describe the latest shared-pool increase, supporting both single radish and newRadishes fields.
function sharedRadishIncrementLabel(entry) {
  return entry
    ? `${entry.type === 'hu' ? '全桌首胡' : `${seatLabel(entry.seat)}杠牌`} +${entry.newRadishes?.length || (entry.radish != null ? 1 : 0)}`
    : '';
}
// 将服务端神龙明细合并为可读文字，不重新结算。
// Join server dragon breakdowns into readable text without settling them again.
function dragonSummary(entry) {
  return (entry.dragons || [])
    .map((dragon) => `${tileLabel(dragon.tile)} ${dragon.count} 张 · ${dragon.points} 分`)
    .join('；');
}
// history 已倒序，find 取到该座位最近一次翻萝卜。
// Because history is reversed, find returns this seat’s most recent radish event.
function latestRadishes(seat) {
  return history.value.find(
    (entry) => entry.seat === seat && (entry.newRadishes?.length || entry.radish != null),
  );
}
// 兼容数组与旧单张字段，缺少事件时增量为零。
// Support both array and legacy single-tile fields, with zero for no event.
function radishIncrement(seat) {
  const entry = latestRadishes(seat);
  return entry ? entry.newRadishes?.length || (entry.radish != null ? 1 : 0) : 0;
}
// 显示该玩家首胡或最近杠所增加的萝卜数量。
// Label the radishes added by this player’s first win or latest kong.
function radishIncrementLabel(seat) {
  const entry = latestRadishes(seat);
  return entry ? `${entry.type === 'hu' ? '首胡' : '上次杠'} +${radishIncrement(seat)}` : '';
}
// 只列 delta 为负的实际付款方；收款方不会重复列为付款。
// List only actual payers with negative delta, not recipients.
function paymentSummary(entry) {
  return (
    entry.payments
      ?.filter((payment) => payment.delta < 0)
      .map((payment) => `${seatLabel(payment.seat)}付${-payment.delta}分`)
      .join(' · ') || ''
  );
}
// 只有正在进行且不在接牌回应阶段，才高亮当前出牌座位。
// Highlight the current turn seat only during active play outside the claim phase.
function isTurn(player) {
  return (
    !presentationWaiting.value &&
    game.value?.currentSeat === player.seat &&
    phase.value === 'playing' &&
    game.value?.phase !== 'claim'
  );
}
// 新提示覆盖旧提示并重启消失计时器，避免旧计时器清掉新文字。
// Replace the toast and restart its expiry so an old timer cannot erase a new message.
function flash(text) {
  notice.value = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice.value = '';
  }, 4200);
}
// 地址中的 room 才决定目标桌；统一大小写并去掉首尾空格。
// The URL room parameter chooses the destination; normalize its case and whitespace.
function roomFromLocation() {
  return (new URLSearchParams(window.location.search).get('room') || '').trim().toUpperCase();
}
// 地址只标记显示模式，不包含任何凭证；是否能读取仍由服务端独立验签。
// The URL marks display mode only, never credentials; the server still verifies read access.
function spectatorFromLocation() {
  return new URLSearchParams(window.location.search).get('view') === 'spectator';
}
// 同一桌的观战与落座凭证分开保存，切换身份不能覆盖仍可重连的玩家凭证。
// Cache spectator and player credentials separately so viewing cannot overwrite a resumable player seat.
function sessionKey(value) {
  return `${value.viewerRole === 'spectator' ? 'watch:' : ''}${value.roomId.toUpperCase()}`;
}
// 这里只检查房间号和令牌的格式，真正的座位权限仍由服务端验证。
// Validate room-code and token shape only; the server still authenticates the seat.
function validSession(value) {
  return (
    !!value &&
    typeof value.roomId === 'string' &&
    /^[A-Z2-9]{8}$/.test(value.roomId.toUpperCase()) &&
    typeof value.token === 'string' &&
    (value.viewerRole === 'spectator'
      ? /^watch\.[a-f0-9]{64}\.[a-f0-9]{64}$/.test(value.token)
      : /^[a-f0-9]{64}$/.test(value.token))
  );
}
// 读取并解析 JSON；隐私模式或损坏数据只产生提示，不让页面崩溃。
// Parse stored JSON; privacy-mode failures or corrupt data produce a warning rather than crashing.
function readStorage(storage, key) {
  try {
    return JSON.parse(window[storage].getItem(key) || 'null');
  } catch {
    storageWarning.value = '浏览器未能读取保存的身份或座位。主页仍可正常使用；请勿清除浏览器数据。';
    return null;
  }
}
// null 表示删除键；存储不可用时保留当前页面可玩，但提示重连风险。
// Null removes the key; storage failure leaves the current page playable but warns about recovery.
function writeStorage(storage, key, value) {
  try {
    if (value == null) window[storage].removeItem(key);
    else window[storage].setItem(key, JSON.stringify(value));
    return true;
  } catch {
    storageWarning.value =
      '浏览器未允许保存身份。当前页面仍可游玩，但关闭后可能无法找回历史积分和座位。';
    return false;
  }
}
// 先恢复未确认离席意图，再恢复每桌凭证与旧活动会话；不直接进入旧桌。
// Restore unconfirmed departures, per-room credentials and the legacy active session without entering a room.
function loadSavedSessions() {
  const departures = readStorage('sessionStorage', DEPARTURES_KEY);
  if (departures && typeof departures === 'object' && !Array.isArray(departures))
    Object.values(departures).forEach((value) => {
      if (validSession(value))
        failedLeaves.set(value.roomId.toUpperCase(), {
          ...value,
          roomId: value.roomId.toUpperCase(),
        });
    });
  const rooms = readStorage('sessionStorage', ROOMS_KEY);
  if (rooms && typeof rooms === 'object' && !Array.isArray(rooms))
    Object.values(rooms).forEach((value) => {
      if (validSession(value))
        savedRooms.set(sessionKey(value), {
          ...value,
          roomId: value.roomId.toUpperCase(),
        });
    });
  const active = readStorage('sessionStorage', STORAGE_KEY);
  if (validSession(active)) {
    const value = { ...active, roomId: active.roomId.toUpperCase() };
    savedRooms.set(sessionKey(value), value);
    return value;
  }
  return null;
}
// 更新当前响应式会话，并保存本标签页的房间凭证映射。
// Update the reactive active session and persist this tab’s room credential map.
function saveSession(value) {
  session.value = value;
  if (value) savedRooms.set(sessionKey(value), value);
  writeStorage('sessionStorage', ROOMS_KEY, Object.fromEntries(savedRooms));
  writeStorage('sessionStorage', STORAGE_KEY, value);
}
// 可选 token 校验防止旧请求删除同一房间的新凭证。
// The optional token guard prevents an old request from deleting newer credentials for the same room.
function forgetSession(roomId, token) {
  const key = token ? [...savedRooms.keys()].find((key) =>
    savedRooms.get(key)?.roomId === roomId && savedRooms.get(key)?.token === token,
  ) : roomId;
  if (!key) return;
  savedRooms.delete(key);
  writeStorage('sessionStorage', ROOMS_KEY, Object.fromEntries(savedRooms));
}
// 按服务端确认的胡牌来源选择展示文字。
// Choose display text from the server-confirmed win source.
function winSourceLabel(event) {
  return (
    { selfDraw: '自摸', robKong: '抢杠胡', kongDiscard: '杠后接胡', discard: '接炮' }[
      event.source
    ] || '胡牌'
  );
}
// 以座位和胡牌区下标匹配短暂高亮，而不是只比较牌种。
// Match transient highlighting by seat and win-pile index, not merely tile type.
function isWinningTile(seat, index) {
  return winningEvents.value.some((event) => event.seat === seat && event.winIndex === index);
}
// 提升展示代数并清空定时器、字幕和飞牌；不会回滚服务端牌局。
// Invalidate presentation callbacks and clear timers, captions and flights without rolling back game state.
function clearPresentation() {
  presentationGeneration++;
  clearTimeout(winningTimer);
  clearTimeout(winningSafetyTimer);
  winningAnimations.forEach((animation) => animation.cancel());
  winningAnimations = [];
  winningEvents.value = [];
  winningFlights.value = [];
  // 清理表示画面已结束或明确取消；卸载、后台和异常都必须释放等待者。
  // Cleanup means visuals ended or were explicitly cancelled; teardown and interruptions release waiters.
  finishWinningPresentation?.();
  finishWinningPresentation = null;
}
// 从已提交事件构建短暂胡牌反馈；最多展示最近两次，并等待 DOM 更新后测量飞牌坐标。
// Build transient feedback from committed wins; keep the latest two and measure flight coordinates after the DOM update.
// 成都组件直接显示权威赢家；花麻将旧飞牌定位与等待不应用到另一模式。
// Chengdu renders confirmed winners directly; Flower flight targeting/waits never apply across modes.
function presentWins(events, snapshot) {
  // 跟随真正显示的事件，而非applyState刚接收的未来队列；不读取隐藏的胡牌牌面。
  // Follow events actually displayed, not future queued receipts in applyState; never inspect hidden winning tiles.
  if (!document.hidden) portraitReactions.present(events, snapshot.game?.players?.length || tablePlayerCount.value);
  if (snapshot.gameMode === 'chengdu') return Promise.resolve();
  const wins = events.filter(
    (event) =>
      event.type === 'hu' && (event.hidden === true ||
        (Number.isInteger(event.tile) && event.tile >= 0 && event.tile < 18)),
  );
  if (!wins.length) return Promise.resolve();
  clearPresentation();
  const completion = new Promise((resolve) => {
    finishWinningPresentation = resolve;
  });
  const generation = presentationGeneration;
  const latestWins = wins.slice(-2);
  winningEvents.value = latestWins.map((event, index) => {
    const pile = snapshot.game.players?.find((player) => player.seat === event.seat)?.winPile || [];
    const following = latestWins
      .slice(index + 1)
      .filter((other) => other.seat === event.seat).length;
    const winIndex = event.winIndex ?? pile.length - following - 1;
    const discardIndex = pile[winIndex]?.discardIndex;
    return { ...event, winIndex, discardIndex };
  });
  // 字幕、高亮及飞牌全部撤下后才算展示结束；与语音完成并行等待，而非只延迟按钮。
  // Finish only after captions, highlights and flights are removed; wait alongside audio, not merely a button delay.
  const captionFinished = new Promise((resolve) => {
    winningTimer = setTimeout(resolve, latestWins.length > 1 ? 4500 : 2800);
  });
  // 浏览器动画异常停滞时明确撤下视觉元素，避免永久等待；正常路径仍等 finished。
  // Explicitly remove stalled visuals after a bounded fallback; normal playback still awaits finished.
  winningSafetyTimer = setTimeout(() => {
    if (generation === presentationGeneration) clearPresentation();
  }, 10000);
  // 等本轮快照渲染完成才能读取牌河与胡牌区的实际屏幕坐标。
  // Wait for snapshot rendering before measuring actual discard and win-pile screen coordinates.
  nextTick(() => {
    // 新动画、后台页或减少动态效果偏好都禁止旧飞牌继续生成。
    // New presentations, hidden pages or reduced-motion preferences prevent old flights from being generated.
    if (
      generation !== presentationGeneration ||
      document.hidden ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    )
      return;
    winningFlights.value = winningEvents.value.flatMap((event) => {
      if (!Number.isInteger(event.discardIndex)) return [];
      const source = document.querySelector?.(`[data-discard-index="${event.discardIndex}"]`);
      const target = document.querySelector?.(
        `[data-win-seat="${event.seat}"][data-win-index="${event.winIndex}"]`,
      );
      if (!source || !target) return [];
      const sourceBounds = source.getBoundingClientRect(),
        targetBounds = target.getBoundingClientRect();
      // 目标在屏幕外时保留同样文字和高亮，不播放跨屏长距离飞牌。
      // Off-screen destinations get the same text and highlights, not a long flight.
      if (
        sourceBounds.bottom < 0 ||
        targetBounds.bottom < 0 ||
        sourceBounds.top > window.innerHeight ||
        targetBounds.top > window.innerHeight
      )
        return [];
      return [
        {
          ...event,
          style: {
            left: `${sourceBounds.left}px`,
            top: `${sourceBounds.top}px`,
            '--win-dx': `${targetBounds.left - sourceBounds.left}px`,
            '--win-dy': `${targetBounds.top - sourceBounds.top}px`,
          },
        },
      ];
    });
  });
  // 飞牌坐标写入后再等一轮 DOM；只等待本次反馈的有限动画，不能等页面无限转圈动画。
  // Wait another DOM patch after flight placement; await only these finite effects, never unrelated infinite spinners.
  nextTick(async () => {
    await nextTick();
    if (generation !== presentationGeneration) return;
    const elements = document.querySelectorAll?.(
      '.win-cue, .winning-flight, .winning-discard, .winning-tile',
    ) || [];
    winningAnimations = [...elements].flatMap((element) => element.getAnimations?.() || []);
    await Promise.all([
      captionFinished,
      Promise.allSettled(winningAnimations.map((animation) => animation.finished)),
    ]);
    if (generation === presentationGeneration) clearPresentation();
  });
  return completion;
}
// 切桌、换局或服务端已恢复推进时，先取消旧音画和计时器，再使旧确认回调失效。
// Cancel old media/timers and invalidate callbacks on room/game changes or authoritative recovery.
function cancelTurnPresentation() {
  localPresentationGeneration++;
  sharedPlayback.cancel();
  localPresentationQueue = [];
  localPendingPresentationCount.value = 0;
  localPresentationRunning = false;
  localAnnouncement.value = '';
  for (const finish of localCaptionFinishes) finish();
  const previous = turnPresentation;
  turnPresentation = null;
  clearTimeout(previous?.timer);
  localPresentationBusy.value = false;
  characterAudio.clear();
  clearPresentation();
}
// 认领请求期间切后台时归还播放权而不是报告完成，给同座位前台页保留真实播放机会。
// If a claim spans hiding, release ownership instead of completing so a foreground sibling can actually play.
async function releasePresentation(pending) {
  if (pending.releasing || !session.value || turnPresentation !== pending) return;
  pending.releasing = true;
  localPresentationBusy.value = false;
  const currentEpoch = epoch;
  const credential = { ...session.value };
  try {
    const data = await api(`/api/rooms/${encodeURIComponent(credential.roomId)}/presentation`, {
      method: 'POST',
      token: credential.token,
      body: {
        presentationId: pending.id,
        gameId: pending.gameId,
        clientId: presentationClientId,
        phase: 'release',
      },
    });
    if (currentEpoch === epoch && turnPresentation === pending) applyState(data.state);
  } catch {
    // 丢包后由相同 ID 的轮询重试释放；不可把不确定的释放改成完成回执。
    // Verified polling retries an uncertain release by ID; never substitute a completion receipt.
  } finally {
    pending.releasing = false;
  }
}
// 只有仍可见、在线且确有新媒体的页面能认领；重连基线与后台页不消费前台页的播放机会。
// Only visible online pages with fresh media may claim; reconnect baselines/hidden tabs cannot consume foreground playback.
function hasFreshPresentation(pending) {
  return !document.hidden && !offline.value &&
    pending.visibilityEpoch === voiceVisibilityEpoch && Date.now() - pending.receivedAt <= 5000 &&
    pending.events.some((event) => event.urls?.length || event.type === 'hu');
}
// 只确认当前会话、当前局的同一展示 ID；失败后由下一次已验证轮询重试，不重放麻将动作。
// Acknowledge only the same presentation in the current session/game; verified polling retries a failed ack, never a move.
async function acknowledgePresentation() {
  const pending = turnPresentation;
  const gate = state.value?.presentation;
  if (
    !pending?.ready || pending.sending || !gate || gate.id !== pending.id ||
    gate.gameId !== pending.gameId || gate.completedSeats?.includes(mySeat.value) ||
    (gate.owners && gate.owners[mySeat.value] !== presentationClientId) ||
    !gate.requiredSeats?.includes(mySeat.value) || !session.value || destroyed
  ) return;
  pending.sending = true;
  const currentEpoch = epoch;
  const credential = { ...session.value };
  const voiceEpoch = voiceVisibilityEpoch;
  try {
    const data = await api(`/api/rooms/${encodeURIComponent(credential.roomId)}/presentation`, {
      method: 'POST',
      token: credential.token,
      body: {
        presentationId: pending.id,
        gameId: pending.gameId,
        clientId: presentationClientId,
      },
    });
    if (currentEpoch === epoch && turnPresentation === pending)
      applyState(data.state, voiceEpoch);
  } catch {
    // 确认请求可按 ID 幂等重试；网络失败不能伪造全桌完成，也不提交 pass。
    // Acks are idempotent by ID; a transport failure neither invents table completion nor submits a pass.
  } finally {
    pending.sending = false;
  }
}
// 先原子认领本座位的播放权，再启动音画；相同座位的第二个标签页只同步牌面。
// Claim playback ownership atomically before starting media; another tab in the same seat only synchronizes the board.
async function beginPresentation(pending) {
  const gate = state.value?.presentation;
  if (
    pending.claiming || pending.releasing || pending.started || !gate || turnPresentation !== pending ||
    gate.id !== pending.id || !session.value
  ) return;
  if (
    !gate.requiredSeats?.includes(mySeat.value) || gate.completedSeats?.includes(mySeat.value)
  ) {
    pending.started = true;
    pending.ready = false;
    localPresentationBusy.value = false;
    return;
  }
  // 其他页面暂时拥有并不等于已经播放；它可能在开始前释放，届时本页仍可接手新事件。
  // A sibling's temporary ownership is not playback; it may release before starting, so retain takeover eligibility.
  if (gate.owners?.[mySeat.value] && gate.owners[mySeat.value] !== presentationClientId) {
    pending.ready = false;
    localPresentationBusy.value = false;
    return;
  }
  // 服务端按各页面独立前台租约选出优先实例；不能靠较早轮询抢过它。
  // The server elects a preferred instance from independent foreground leases; faster polling cannot steal it.
  if (gate.preferredClients?.[mySeat.value] &&
      gate.preferredClients[mySeat.value] !== presentationClientId) {
    localPresentationBusy.value = false;
    return;
  }
  if (!hasFreshPresentation(pending)) {
    localPresentationBusy.value = false;
    if (gate.owners?.[mySeat.value] === presentationClientId) releasePresentation(pending);
    return;
  }
  pending.claiming = true;
  const currentEpoch = epoch;
  const credential = { ...session.value };
  const voiceEpoch = voiceVisibilityEpoch;
  try {
    const data = await api(`/api/rooms/${encodeURIComponent(credential.roomId)}/presentation`, {
      method: 'POST',
      token: credential.token,
      body: {
        presentationId: pending.id,
        gameId: pending.gameId,
        clientId: presentationClientId,
        phase: 'begin',
      },
    });
    if (currentEpoch !== epoch || turnPresentation !== pending) return;
    applyState(data.state, voiceEpoch);
    const latestGate = state.value?.presentation;
    if (turnPresentation !== pending || latestGate?.id !== pending.id) return;
    if (latestGate.owners?.[mySeat.value] !== presentationClientId) {
      pending.ready = false;
      localPresentationBusy.value = false;
      return;
    }
    // 认领期间可能进入后台、断网或换可见性代数；此时明确跳过，不把缓存事件补播出来。
    // Claiming may span hiding, disconnects or visibility changes; explicitly skip instead of replaying queued events.
    if (!hasFreshPresentation(pending)) {
      await releasePresentation(pending);
      return;
    }
    playTurnPresentation(pending, pending.events, state.value);
  } catch {
    // 认领不成功不播放也不确认；下一次验证过的轮询可安全重试同一 ID。
    // Do not play or complete after an uncertain claim; a verified poll can retry the same ID safely.
  } finally {
    pending.claiming = false;
  }
}
// 每个请求附带本页面的展示能力，不代表麻将操作；服务端以独立 clientId 保存，后台副页不能覆盖前台。
// Requests describe this page's presentation capability, never a move; independent client IDs prevent a hidden sibling overwriting foreground state.
function presentationPresenceHeaders() {
  const gameId = state.value?.game?.id;
  const pending = turnPresentation;
  const ready = Boolean(gameId && !offline.value && !voiceNeedsBaseline &&
    (pending && pending.id === state.value?.presentation?.id
      ? (pending.started && localPresentationBusy.value) || hasFreshPresentation(pending)
      : lastVoiceSync > 0 && Date.now() - lastVoiceSync <= 5000));
  const canSpeak = characterAudio.unlocked && !characterAudio.muted &&
    characterAudio.context?.state === 'running';
  return {
    'X-Presentation-Client': presentationClientId,
    'X-Presentation-Visible': String(!document.hidden),
    'X-Presentation-Audio': canSpeak ? 'ready' : 'silent',
    'X-Presentation-Ready': String(ready),
    ...(gameId ? { 'X-Presentation-Game': gameId } : {}),
    // “本段没有新媒体”仅约束本段，不能让慢语音的完成回执把下一段新事件也标成不可播放。
    // Abstaining from this gate must not mark the next fresh event unplayable after a slow voice completes.
    ...(state.value?.presentation?.id ? { 'X-Presentation-Gate': state.value.presentation.id } : {}),
  };
}
// 每个服务端展示 ID 只启动一次；Promise.all 要求音频与画面都结束，重复轮询不会提前确认。
// Start once per server presentation ID; Promise.all requires both media paths, so repeated polls cannot acknowledge early.
function syncTurnPresentation(events, snapshot) {
  const gate = snapshot.presentation;
  if (gate && turnPresentation?.id === gate.id && turnPresentation.gameId === gate.gameId) {
    if (!turnPresentation.started) beginPresentation(turnPresentation);
    acknowledgePresentation();
    return;
  }
  // 普通轻量刷新没有新事件时保留正在播放的兼容旧局反馈。
  // Preserve legacy local playback across ordinary snapshots without new events.
  if (!gate && !turnPresentation?.id && !events.length) return;
  cancelTurnPresentation();
  const pending = {
    id: gate?.id || null,
    gameId: snapshot.game?.id,
    ready: false,
    sending: false,
    started: false,
    events,
    // 重试不能更新事件的可见性/时间基线，否则旧叫牌会被误当作新事件补播。
    // Retries must not refresh event visibility/time baselines, or stale calls could replay as new.
    visibilityEpoch: voiceVisibilityEpoch,
    receivedAt: Date.now(),
  };
  turnPresentation = pending;
  if (gate) {
    localPresentationBusy.value = true;
    beginPresentation(pending);
  } else playTurnPresentation(pending, events, snapshot);
}
// 取得播放权后并行播放；全桌截止时间和每条媒体自身的兜底都先取消媒体再释放等待。
// After ownership, play concurrently; both table and media fallbacks stop effects before releasing their waits.
function playTurnPresentation(pending, events, snapshot) {
  const gate = snapshot.presentation;
  pending.started = true;
  localPresentationBusy.value = events.some((event) => event.urls?.length || event.type === 'hu');
  const completion = Promise.all([
    presentWins(events, snapshot),
    characterAudio.enqueueLive(events),
  ]);
  if (gate) {
    // 服务端返回剩余时间避免客户端时钟偏差；超时先停止音画再确认，不能一边播一边放行。
    // Use server remaining time to avoid clock skew; stop media before timeout acknowledgement, never while still playing.
    const remaining = Number.isFinite(gate.remainingMs) ? Math.max(0, gate.remainingMs) : 40000;
    pending.timer = setTimeout(() => {
      if (turnPresentation !== pending) return;
      characterAudio.clear();
      clearPresentation();
    }, Math.min(40000, remaining));
  }
  completion.finally(() => {
    if (turnPresentation !== pending) return;
    clearTimeout(pending.timer);
    pending.ready = true;
    localPresentationBusy.value = false;
    acknowledgePresentation();
  });
}
// 本地队列只接受游标产生的新事件；不同动作逐条排队，同一弃牌的双胡仍共用原动画。
// Queue only fresh cursor events, one action at a time; simultaneous discard winners retain the shared animation.
function queueLocalPresentation(events, snapshot, receipt = null) {
  const audioEligible = !document.hidden && characterAudio.unlocked && !characterAudio.muted &&
    characterAudio.context?.state === 'running';
  const voiced = events.filter((event) => event.urls?.length || event.type === 'hu');
  const groups = [];
  for (let index = 0; index < voiced.length; index++) {
    const event = { ...voiced[index] };
    if (event.type === 'hu') {
      const pile = snapshot.game.players?.find((player) => player.seat === event.seat)?.winPile || [];
      // 一次慢轮询可能包含多次胡；用后续同座胡的数量定位，不能全部飞向最后一张。
      // A delayed poll may include several wins; count later same-seat wins instead of targeting the final tile every time.
      event.winIndex = pile.length - 1 - voiced.slice(index + 1)
        .filter((later) => later.type === 'hu' && later.seat === event.seat).length;
    }
    const group = groups.at(-1);
    const previous = group?.at(-1);
    const sameWinBatch = previous?.type === 'hu' && event.type === 'hu' &&
      event.source !== 'selfDraw' && previous.source === event.source &&
      previous.tile === event.tile && previous.fromSeat === event.fromSeat && previous.seat !== event.seat &&
      // 四人桌允许一炮三响；立绘保留所有赢家，飞牌仍沿用自己的显示上限。
      // Four-seat triple wins stay in one portrait batch; tile flights retain their separate display limit.
      group.length < (snapshot.game.players?.length || 3) - 1;
    if (sameWinBatch) group.push(event);
    else groups.push([event]);
  }
  // 声音资格在接收时固定，不能等轮到播放时再把用户静音期间的事件变成可发声。
  // Capture audio eligibility on receipt, never promote muted-period events when they later reach the head.
  for (const group of groups) localPresentationQueue.push({ events: group, snapshot, receipt, audioEligible });
  localPendingPresentationCount.value = localPresentationQueue.length + Number(localPresentationRunning);
  if (!localPresentationRunning && !localPresentationQueue.length) state.value = snapshot;
  drainLocalPresentation();
}

// 普通动作即使静音或音频失败也至少显示350毫秒；取消会同时撤下字幕并释放等待。
// Ordinary calls remain visible for at least 350ms even when silent/failed; cancellation releases the caption wait.
function presentLocalAction(events, snapshot) {
  state.value = snapshot;
  localAnnouncement.value = events.map((event) => event.message ||
    `${snapshot.game.players?.find((player) => player.seat === event.seat)?.name || '牌友'}${event.type === 'discard' ? `打出${tileLabel(event.tile)}` : event.type === 'hu' ? '胡牌' : '完成动作'}`).join(' ');
  if (events.some((event) => event.type === 'hu')) return presentWins(events, snapshot);
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      localCaptionFinishes.delete(finish);
      resolve();
    };
    const timer = setTimeout(finish, 350);
    localCaptionFinishes.add(finish);
  });
}

// 每页保留完整画面；声音委托共享顺序协调器，只有真实成功才完成，失败给可发声副页一次接力机会。
// Preserve every page's visuals; the coordinator orders shared audio, records real success and permits bounded sibling recovery.
async function playLocalPresentationBatch(batch, generation) {
  if (generation !== localPresentationGeneration || document.hidden) return;
  const audio = batch.audioEligible
    ? sharedPlayback.playThrough(batch.receipt, batch.events)
    : Promise.resolve();
  await Promise.allSettled([presentLocalAction(batch.events, batch.snapshot), audio]);
}

// 长网络缺口不静默删掉队列；只有玩家明确点击此按钮才略过当前待播，牌局和账本不变。
// Long network gaps never silently drop queued events; only this explicit choice skips playback, not game state or scores.
function skipLocalPlayback() {
  if (!receivedState || receivedState.presentationMode !== 'local') return;
  cancelTurnPresentation();
  portraitReactions.reset();
  state.value = receivedState;
  // 把当前已知历史作为明确略过的新基线，不在下一次轮询偷偷补回来。
  // Explicitly baseline the currently known history so the next poll cannot replay what the user skipped.
  voiceCursor.consumeEvents(receivedState, { silent: true });
  sharedPlayback.registerSnapshot(receivedState, { baseline: true, eligible: false, skip: true });
}

// 单消费者等本段音频和实际动画都完成再取下一段；新快照只能追加，绝不 clear 正在播放的段。
// One consumer waits for both audio and real animations; incoming snapshots append without clearing active playback.
async function drainLocalPresentation() {
  if (localPresentationRunning || !localPresentationQueue.length) return;
  const generation = localPresentationGeneration;
  localPresentationRunning = true;
  localPresentationBusy.value = true;
  try {
    while (localPresentationQueue.length && generation === localPresentationGeneration) {
      const batch = localPresentationQueue.shift();
      localPendingPresentationCount.value = localPresentationQueue.length + 1;
      try {
        await playLocalPresentationBatch(batch, generation);
      } catch {
        // 媒体设施故障只结束本段，不撤销权威事件，也不阻止下一段；离桌代数仍优先。
        // A media facility failure ends only this batch, never its committed event or subsequent batches.
      }
    }
  } finally {
    if (generation === localPresentationGeneration) {
      localPresentationRunning = false;
      localPendingPresentationCount.value = 0;
      localPresentationBusy.value = false;
      localAnnouncement.value = '';
      // 播完后才显示最新合法动作。收到的快照可能已越过当前段，但不能提前开放旧牌面按钮。
      // Reveal the latest legal actions only after playback catches up, never controls for an obsolete board.
      if (receivedState) state.value = receivedState;
    }
  }
}

// 接收权威快照的唯一汇合点：拒绝旧房间及旧版本，再派生语音与展示事件。
// Central snapshot application: reject other rooms and older revisions, then derive audio and presentation events.
function applyState(next, voiceEpoch = voiceVisibilityEpoch) {
  // 切桌后迟到的旧房间快照必须丢弃。
  // Discard snapshots that arrive after switching away from their room.
  if (!next || next.id !== session.value?.roomId) return;
  // 同一房间的低版本响应也不能覆盖新状态。
  // An older revision must not overwrite newer state in the same room.
  const latest = receivedState || state.value;
  if (latest && next.id === latest.id && next.revision < latest.revision) return;
  const now = Date.now();
  const newGame =
    (latest?.game?.id || null) !== (next.game?.id || null) ||
    (next.game?.history?.length || 0) < (latest?.game?.history?.length || 0);
  // local模式同一前台会话的网络延迟不丢队列或游标；只有明确后台/换局会取消。
  // Local foreground transport gaps retain queues/cursors; only explicit visibility/game lifecycle changes cancel them.
  // 旧屏障模式保留已发布的静默重连边界，不把这次可靠队列协议反向套到旧播放器。
  // Legacy barriers retain their published silent-reconnect boundary rather than inheriting the new queue protocol.
  const silent = document.hidden || (next.presentationMode !== 'local' &&
    (offline.value || (lastVoiceSync > 0 && now - lastVoiceSync > 5000)));
  if (newGame || silent) {
    portraitReactions.reset();
    if (next.presentationMode === 'local' || localPresentationRunning) cancelTurnPresentation();
    if (turnPresentation) turnPresentation.events = [];
    characterAudio.clear();
    clearPresentation();
  }
  // 可见性代数防止切后台前发出的请求把旧事件当成现场语音。
  // The visibility epoch prevents pre-visibility-change requests from becoming live audio.
  const wasVoiceBaseline = voiceCursor.gameKey !== `${next.id}:${next.game?.id || 'legacy'}`;
  const events =
    voiceEpoch !== voiceVisibilityEpoch ? [] : voiceCursor.consumeEvents(next, { silent });
  lastVoiceSync = now;
  if (voiceEpoch === voiceVisibilityEpoch) voiceNeedsBaseline = false;
  // 只在首次拿到牌局或换局时用已保存规则初始化草稿；同局轮询不能覆盖房主正在编辑的下一局金额。
  // Initialize the draft from saved rules only on first game load or game change; same-game polling must not overwrite the host’s next-round edits.
  if (next.game && (!state.value?.game || newGame))
    bigSingleReadyPoints.value =
      next.game.rules?.bigSingleReadyPoints ?? DEFAULT_BIG_SINGLE_READY_POINTS;
  receivedState = next;
  if (next.presentationMode === 'local' && turnPresentation) cancelTurnPresentation();
  // 在有声事件之前登记基线；晚入副页不能让自己的较新基线盖掉已有页面尚未播完的前缀。
  // Register baselines before speech; a later sibling baseline cannot erase an existing page's unfinished prefix.
  const registerPlayback = () => next.game?.schemaVersion === 3
    ? sharedPlayback.registerSnapshot(next, {
      baseline: wasVoiceBaseline || silent || next.presentationMode !== 'local',
      legacy: next.presentationMode !== 'local',
      eligible: !silent && !document.hidden && characterAudio.unlocked && !characterAudio.muted &&
        characterAudio.context?.state === 'running',
    }) : null;
  if (next.presentationMode === 'local') {
    queueLocalPresentation(events, next, registerPlayback());
  } else {
    state.value = next;
    syncTurnPresentation(events, next);
    // 旧屏障协调可能取消本页代数；在它之后登记，不能让新基线一创建就失效。
    // Legacy synchronization may cancel this page generation; register afterwards so the new baseline survives.
    registerPlayback();
  }
  if (newGame) {
    characterAudio.warmWins(next.game?.characters);
    // 浏览器才预热静态反应图；SSR/测试不需要Image，缓存不参与任何牌局状态。
    // Only browsers warm static reaction art; SSR needs no Image, and the cache holds no game state.
    if (typeof Image !== 'undefined') warmCharacterPortraits(next.game?.characters, portraitImageCache);
  }
  if (!discardOptions.value.some((action) => action.tile === selectedTile.value)) {
    selectedTile.value = null;
    selectedHandIndex.value = null;
  }
}
// 统一 JSON、身份头、超时和取消；global 与 leave 请求不随切桌一起取消。
// Centralize JSON, identity headers, timeouts and cancellation; global and leave requests survive room changes.
async function api(path, options = {}) {
  const controller = options.controller || new AbortController();
  const token = options.token === undefined ? session.value?.token : options.token;
  const identity = options.playerToken === undefined ? playerToken.value : options.playerToken;
  const body =
    options.body === undefined
      ? undefined
      : {
          ...options.body,
          ...(path.startsWith('/api/rooms') && identity ? { profileToken: identity } : {}),
        };
  // 离席通知不能被切桌取消，否则服务器可能一直保留错误在线状态。
  // Do not cancel departure notifications during a room change, or the server may retain stale attachment state.
  const tracked = options.scope !== 'global' && options.scope !== 'leave';
  if (tracked) roomControllers.add(controller);
  const timer = setTimeout(() => controller.abort(), options.timeout || 12000);
  try {
    const response = await fetch(path, {
      method: options.method || 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(path.startsWith('/api/rooms') ? presentationPresenceHeaders() : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(options.keepalive ? { keepalive: true } : {}),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const failure = new Error(data.error || '这次操作没有完成，请稍后再试。');
      failure.status = response.status;
      failure.code = data.code;
      throw failure;
    }
    return data;
  } finally {
    clearTimeout(timer);
    roomControllers.delete(controller);
  }
}
// 复用一个在途 Promise 建立匿名身份；支持 Web Locks 时避免同浏览器多标签竞争。
// Share one in-flight promise to establish anonymous identity; Web Locks prevent cross-tab races where supported.
async function ensureProfile() {
  if (playerToken.value) return playerToken.value;
  if (profilePromise) return profilePromise;
  profilePromise = (async () => {
    const chooseIdentity = () => {
      const stored = readStorage('localStorage', PROFILE_KEY);
      if (typeof stored === 'string' && /^[a-f0-9]{64}$/.test(stored)) return stored;
      const candidate = Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) =>
        value.toString(16).padStart(2, '0'),
      ).join('');
      // 先保存再注册，让中断请求与其他标签页复用同一身份。
      // Save before registration so interrupted requests and other tabs reuse it.
      writeStorage('localStorage', PROFILE_KEY, candidate);
      return candidate;
    };
    const candidate =
      typeof navigator !== 'undefined' && navigator.locks?.request
        ? await navigator.locks.request('huajian-player-identity', chooseIdentity)
        : chooseIdentity();
    const data = await api('/api/profile', {
      method: 'POST',
      body: { playerToken: candidate },
      token: null,
      playerToken: null,
      scope: 'global',
    });
    if (typeof data.playerToken !== 'string' || !/^[a-f0-9]{64}$/.test(data.playerToken))
      throw new Error('暂时无法建立积分身份，请稍后再试。');
    playerToken.value = data.playerToken;
    writeStorage('localStorage', PROFILE_KEY, data.playerToken);
    return data.playerToken;
  })();
  try {
    return await profilePromise;
  } finally {
    profilePromise = null;
  }
}
// 独立代数只允许最新的记录请求更新页面，卸载后的响应也丢弃。
// An independent generation lets only the latest history request update the page and ignores results after unmount.
async function loadHistory() {
  const generation = ++historyGeneration;
  historyLoading.value = true;
  historyError.value = '';
  try {
    await ensureProfile();
    const data = await api('/api/profile/history', { token: playerToken.value, scope: 'global' });
    if (generation === historyGeneration && !destroyed) personalHistory.value = data;
  } catch (failure) {
    if (generation === historyGeneration && !destroyed)
      historyError.value =
        failure.name === 'AbortError'
          ? '历史记录加载超时，请点刷新重试。'
          : `历史记录暂未加载：${failure.message}`;
  } finally {
    if (generation === historyGeneration) historyLoading.value = false;
  }
}
// 把服务端记录状态映射为已结算或暂未结算的文字。
// Map server record status to settled or provisional display text.
function historyStatus(record) {
  return (
    { finished: '已结算', detached: '已离桌 · 未结算', playing: '进行中 · 未结算' }[
      record.status
    ] || '未结算'
  );
}
// 无效日期不显示；有效时间按浏览器本地时区与中文格式呈现。
// Hide invalid dates; render valid dates in the browser’s local timezone with Chinese formatting.
function historyDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
}
// 切桌的失效屏障：提升 epoch、取消旧读取、清理 UI；保留各桌凭证及待确认离席。
// Room-change invalidation barrier: advance epoch, abort old reads and reset UI while retaining room credentials and pending departures.
function resetRoomContext() {
  portraitReactions.reset();
  cancelTurnPresentation();
  receivedState = null;
  voiceCursor.reset();
  characterAudio.clear();
  clearPresentation();
  lastVoiceSync = 0;
  voiceNeedsBaseline = false;
  epoch++;
  clearTimeout(pollTimer);
  clearTimeout(noticeTimer);
  clearTimeout(copyTimer);
  roomControllers.forEach((controller) => controller.abort());
  roomControllers.clear();
  pollController = null;
  previousFocus = null;
  document.activeElement?.blur?.();
  showRules.value = false;
  showInvite.value = false;
  document.body.style.overflow = '';
  connectingSession = null;
  state.value = null;
  saveSession(null);
  autoDiscardAfterHu.value = true;
  // 切换房间时回到默认草稿，不让上一桌的自定义金额泄漏到新桌。
  // Reset the draft on room changes so another table does not inherit the previous table’s custom amount.
  bigSingleReadyPoints.value = DEFAULT_BIG_SINGLE_READY_POINTS;
  busy.value = false;
  restoring.value = false;
  offline.value = false;
  syncing.value = false;
  error.value = '';
  notice.value = '';
  copyDone.value = false;
  selectedTile.value = null;
  selectedHandIndex.value = null;
  return epoch;
}
// 明确告知服务端离席；进行中的桌可能只标记离席，不能擅自删除可重连凭证。
// Notify the server of departure; active games may only detach the seat, so preserve resumable credentials.
async function notifyLeave(previous) {
  if (!previous?.roomId || !previous?.token) return;
  try {
    await ensureProfile();
    const result = await api(`/api/rooms/${encodeURIComponent(previous.roomId)}/leave`, {
      method: 'POST',
      body: {},
      token: previous.token,
      scope: 'leave',
      keepalive: true,
    });
    if (result.detached === false) forgetSession(previous.roomId, previous.token);
    failedLeaves.delete(previous.roomId);
    persistDepartures();
  } catch (failure) {
    if ([401, 404, 410].includes(failure.status)) {
      failedLeaves.delete(previous.roomId);
      persistDepartures();
      forgetSession(previous.roomId, previous.token);
      return;
    }
    failedLeaves.set(previous.roomId, previous);
    persistDepartures();
    if (failure.code === 'PROFILE_MISMATCH')
      throw new Error(
        '旧桌凭证与此浏览器的积分身份不一致，无法确认离桌。请使用原浏览器身份处理旧桌。',
      );
    throw new Error('已停止旧桌连接，但离桌通知尚未确认。请稍后重试，确认后再进入新桌。');
  }
}
// 把尚未确认的离席意图写入本标签页，刷新后仍可安全继续确认。
// Persist unconfirmed departures for this tab so a refresh can safely continue confirmation.
function persistDepartures() {
  writeStorage(
    'sessionStorage',
    DEPARTURES_KEY,
    failedLeaves.size ? Object.fromEntries(failedLeaves) : null,
  );
}
// 同一房间共用一个离席 Promise；先保存意图，失败仍保留可重试记录。
// Deduplicate departures by room; persist intent first and retain it when confirmation fails.
function queueLeave(previous) {
  if (!previous?.roomId || previous.viewerRole === 'spectator') return Promise.resolve();
  if (pendingLeaves.has(previous.roomId)) return pendingLeaves.get(previous.roomId);
  failedLeaves.set(previous.roomId, previous);
  persistDepartures();
  const pending = notifyLeave(previous).finally(() => {
    if (pendingLeaves.get(previous.roomId) === pending) pendingLeaves.delete(previous.roomId);
  });
  pendingLeaves.set(previous.roomId, pending);
  pending.catch(() => {});
  return pending;
}
// 先等待已在进行的离席，再重试失败项；确认旧桌离席后才允许进入新桌。
// Await current departures, then retry failed ones before entering another room.
async function waitForLeaves() {
  await Promise.all([...pendingLeaves.values()]);
  await Promise.all([...failedLeaves.values()].map(queueLeave));
}
// 只保留可分享房间号，不把座位令牌放进地址；区分替换与新增历史记录。
// Keep only the shareable room code in the URL, never a seat token; distinguish history replacement from push.
function updateRoomUrl(roomId, replace = false) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  if (roomId) url.searchParams.set('room', roomId);
  if (roomId && session.value?.viewerRole === 'spectator') url.searchParams.set('view', 'spectator');
  if (url.toString() !== window.location.href)
    window.history[replace ? 'replaceState' : 'pushState']({}, '', url);
}
// 按地址重建页面：主页永远大厅；明确房间链接且有对应凭证才自动重连。
// Rebuild from the URL: the root always shows the lobby; only an explicit room link with matching credentials resumes.
async function routeFromLocation(initialSession = null) {
  const target = roomFromLocation();
  const previous = session.value || connectingSession || initialSession;
  const currentEpoch = resetRoomContext();
  roomCode.value = target;
  const viewing = spectatorFromLocation();
  entryMode.value = target ? (viewing ? 'spectate' : 'join') : 'create';
  const departure =
    previous && (previous.roomId !== target || (previous.viewerRole === 'spectator') !== viewing)
      ? queueLeave(previous) : Promise.resolve();
  const leaving = Promise.all([departure, ...[...failedLeaves.values()].map(queueLeave)]);
  const credential = target ? savedRooms.get(`${viewing ? 'watch:' : ''}${target}`) : null;
  // 无论缓存了哪张桌或哪个身份，主页都只进入大厅。
  // The root is always a lobby, regardless of any stored room or identity.
  if (!target || !credential) {
    leaving
      .catch((failure) => {
        if (epoch === currentEpoch) error.value = failure.message;
      })
      .finally(() => {
        if (epoch === currentEpoch) loadHistory();
      });
    return;
  }
  restoring.value = true;
  connectingSession = credential;
  if (typeof credential.name === 'string') name.value = credential.name;
  try {
    await leaving;
    await waitForLeaves();
    if (credential.viewerRole !== 'spectator') await ensureProfile();
    if (epoch !== currentEpoch) return;
    if (savedRooms.get(sessionKey(credential))?.token !== credential.token) {
      connectingSession = null;
      loadHistory();
      return;
    }
    const voiceEpoch = voiceVisibilityEpoch;
    const data = await api(`/api/rooms/${encodeURIComponent(target)}/resume`, {
      method: 'POST',
      body: {},
      token: credential.token,
    });
    if (epoch !== currentEpoch) {
      compensateStaleSession(credential);
      return;
    }
    connectingSession = null;
    saveSession(credential);
    applyState(data.state, voiceEpoch);
    if (!state.value) throw new Error('牌桌状态未能恢复，请稍后再试。');
    schedulePoll();
  } catch (failure) {
    if (epoch !== currentEpoch) return;
    connectingSession = null;
    if ([401, 403, 404, 410].includes(failure.status)) forgetSession(target, credential.token);
    saveSession(null);
    error.value =
      failure.name === 'AbortError'
        ? '重连超时，请刷新当前邀请链接重试，或返回大厅。'
        : failure.message;
    loadHistory();
  } finally {
    if (epoch === currentEpoch) restoring.value = false;
  }
}
// 浏览器前进或后退也走同一套切桌清理与重连流程。
// Browser Back and Forward use the same cleanup and resume flow.
function onPopState() {
  routeFromLocation();
}
// 落座响应迟到时，若用户已选择别处，就补发离席；不撤销当前仍想保留的同一座位。
// When a seat response arrives late, leave it unless it is still the desired current seat.
function compensateStaleSession(credential) {
  const desired = session.value || connectingSession;
  if (desired?.roomId === credential?.roomId && desired?.token === credential?.token) return;
  queueLeave(credential).catch(() => {});
}
// 后台页减少轮询，牌局中加快；这些间隔保持原值。
// Poll less often in hidden tabs and faster during play; preserve the existing intervals.
function pollInterval() {
  return document.hidden ? 3000 : phase.value === 'playing' ? 350 : 1000;
}
// 每次只留一个定时器，扣掉本次请求耗时，并保留最短间隔避免忙循环。
// Keep one timer, subtract request duration, and retain a minimum delay to avoid a busy loop.
function schedulePoll(started = performance.now(), immediate = false) {
  clearTimeout(pollTimer);
  if (session.value)
    pollTimer = setTimeout(
      refresh,
      immediate ? 0 : Math.max(80, pollInterval() - (performance.now() - started)),
    );
}
// 读取最新状态但不与操作请求重叠；轻量 unchanged 回复只更新在线标记。
// Fetch state without overlapping mutations; lightweight unchanged replies update connection flags only.
async function refresh() {
  if (!session.value) return;
  if (pollController || busy.value) {
    schedulePoll();
    return;
  }
  clearTimeout(pollTimer);
  const started = performance.now();
  const currentEpoch = epoch;
  const credential = { ...session.value };
  const roomId = credential.roomId;
  const voiceEpoch = voiceVisibilityEpoch;
  const controller = new AbortController();
  pollController = controller;
  try {
    // 只有语音基线有效时才用版本增量；否则请求完整快照重新建立基线。
    // Use a revision hint only with a valid audio baseline; otherwise request a full snapshot.
    const since =
      !voiceNeedsBaseline && (receivedState || state.value)?.id === roomId
        ? `?since=${encodeURIComponent((receivedState || state.value).revision)}`
        : '';
    const data = await api(`/api/rooms/${encodeURIComponent(roomId)}${since}`, { controller });
    if (currentEpoch !== epoch) return;
    // 未变回复不是完整快照，保留手牌等状态，只应用在线标记。
    // An unchanged reply is not a complete snapshot; retain hands and apply only connection flags.
    if (data.unchanged && state.value) {
      lastVoiceSync = Date.now();
      if (Array.isArray(data.connections))
        state.value.seats?.forEach((player) => {
          if (!player) return;
          const connected = data.connections[player.seat];
          if (typeof connected === 'boolean' && player.connected !== connected)
            player.connected = connected;
        });
      if (state.value.presentationMode !== 'local') syncTurnPresentation([], state.value);
    } else applyState(data.state, voiceEpoch);
    if (offline.value) flash('已重新连接，牌局已同步。');
    offline.value = false;
    syncing.value = false;
    restoring.value = false;
    if (error.value.startsWith('暂时无法连接')) error.value = '';
    else if (error.value.startsWith('牌局刚刚有更新')) error.value = '牌局已同步，请重新选择操作。';
    else if (error.value.startsWith('连接中断，操作结果'))
      error.value = '牌局已同步，请查看最新牌面后继续。';
  } catch (failure) {
    if (currentEpoch !== epoch) return;
    if ([401, 403, 404, 410].includes(failure.status) || failure.code === 'SEAT_DETACHED') {
      const message = [404, 410].includes(failure.status)
        ? '这个房间已过期或不存在。可以重新开桌，或输入新的房间号。'
        : credential.viewerRole === 'spectator'
          ? '观战会话已失效，请重新进入观战。'
          : '此座位的会话已失效，请重新加入房间。';
      resetRoomContext();
      if (failure.code !== 'SEAT_DETACHED') forgetSession(roomId, credential.token);
      error.value =
        failure.code === 'SEAT_DETACHED'
          ? '此座位已离桌。可使用这桌的邀请链接明确重连，或返回大厅。'
          : message;
      loadHistory();
    } else if (failure.status === 409) {
      // 已收到服务器响应：正常版本竞争不是断网，也不能清空语音游标或制造“重新连接”。
      // The server replied: ordinary revision contention is not a disconnect and must not reset audio or announce reconnection.
      syncing.value = true;
    } else {
      offline.value = true;
      if (!state.value) error.value = '暂时无法连接牌桌，正在自动重试。';
    }
    restoring.value = false;
  } finally {
    if (pollController === controller) pollController = null;
    if (currentEpoch === epoch) schedulePoll(started);
  }
}
// 切到后台或回来都重置语音基线，防止恢复页面时补播旧动作。
// Reset the audio baseline on visibility changes so returning to the page never replays old actions.
function visibilityChanged() {
  portraitReactions.reset();
  if (state.value?.presentationMode === 'local') {
    cancelTurnPresentation();
    if (receivedState) state.value = receivedState;
  }
  voiceVisibilityEpoch++;
  if (turnPresentation) turnPresentation.events = [];
  characterAudio.clear();
  clearPresentation();
  lastVoiceSync = 0;
  voiceNeedsBaseline = true;
  voiceCursor.reset();
  // 进入后台也尽快送出该页面的租约变化，避免其他座位每步等待不可播放页面。
  // Publish hiding promptly too, so other seats do not wait each step for a page that cannot play.
  if (!pollController && !busy.value) schedulePoll(performance.now(), true);
}
// 校验表单、确认旧桌离席、准备身份，再选择建房、加入或重连；不会盲目重发落座。
// Validate the form, confirm departures and identity, then create, join or resume without blindly retrying seat creation.
async function enterRoom() {
  if (busy.value || restoring.value) return;
  const cleanName = typeof name.value === 'string' ? name.value.trim() : '';
  const code = roomCode.value.trim().toUpperCase();
  const mode = entryMode.value;
  const selectedGameMode = gameModeDraft.value;
  if (mode !== 'spectate' && !cleanName) {
    error.value = '先给自己取个落座名吧。';
    return;
  }
  if (mode !== 'create' && !/^[A-Z2-9]{8}$/.test(code)) {
    error.value = '请输入正确的 8 位房间号。';
    return;
  }
  if (mode === 'create' && selectedGameMode === 'chengdu' && !validChengduSettings.value) {
    error.value = '请选择结束方式、是否换三张、自摸方式和封顶番数。';
    return;
  }
  if (mode === 'create' && !['flower', 'chengdu'].includes(selectedGameMode)) {
    error.value = '请选择支持的麻将玩法。';
    return;
  }
  if (mode === 'create' && selectedGameMode === 'flower' && !validTableSettings.value) {
    error.value = '请选择3或4人、1至5副（半副递增），神龙起算张数为1至20的整数。';
    return;
  }
  if (mode === 'create' && selectedGameMode === 'flower' && !validReadyPoints.value) {
    error.value = `大单吊喜钱须为 0–${MAX_BIG_SINGLE_READY_POINTS} 的整数`;
    return;
  }
  // 先复制建房参数，异步身份准备期间后续输入不会改变已提交意图。
  // Copy settings before asynchronous identity preparation so later edits cannot change the request.
  const settings = selectedGameMode === 'chengdu' ? { ...chengduSettingsDraft.value } : {
    playerCount: playerCountDraft.value,
    deckCount: deckCountDraft.value,
    dragonStartCount: dragonStartCountDraft.value,
    autoDiscardAfterHu: autoDiscardAfterHu.value,
    bigSingleReadyPoints: bigSingleReadyPoints.value,
  };
  const flowerDraft = {
    autoDiscardAfterHu: autoDiscardAfterHu.value,
    bigSingleReadyPoints: bigSingleReadyPoints.value,
  };
  // 花麻将保留原来缺模式的请求合同；只有成都显式携带新模式，加入/观战不带建房快照。
  // Preserve Flower's omitted-mode contract; only Chengdu sends its explicit mode, never on join/spectate.
  const creationPayload = mode === 'create' ? {
    settings,
    ...(selectedGameMode === 'chengdu' ? { gameMode: selectedGameMode } : {}),
  } : {};
  const previous = session.value;
  const currentEpoch = resetRoomContext();
  // 清理旧会话不能清空正在提交的新桌表单；明确失败后仍展示原选择，避免重试误用默认值。
  // Session cleanup must not erase the submitted creation form; explicit failures retain choices instead of retrying with defaults.
  if (mode === 'create') {
    autoDiscardAfterHu.value = flowerDraft.autoDiscardAfterHu;
    bigSingleReadyPoints.value = flowerDraft.bigSingleReadyPoints;
  }
  busy.value = true;
  let credential = mode === 'create' ? null : savedRooms.get(`${mode === 'spectate' ? 'watch:' : ''}${code}`);
  try {
    if (previous) await queueLeave(previous);
    await waitForLeaves();
    if (mode !== 'spectate') await ensureProfile();
    if (currentEpoch !== epoch) return;
    credential = mode === 'create' ? null : savedRooms.get(`${mode === 'spectate' ? 'watch:' : ''}${code}`);
    connectingSession = credential;
    const path =
      mode === 'create'
        ? '/api/rooms'
        : `/api/rooms/${encodeURIComponent(code)}/${credential ? 'resume' : mode === 'spectate' ? 'spectate' : 'join'}`;
    const voiceEpoch = voiceVisibilityEpoch;
    const data = await api(path, {
      method: 'POST',
      body: credential || mode === 'spectate'
        ? {}
        : { name: cleanName, preferredCharacter: preferredCharacter.value || null,
          ...creationPayload },
      token: credential?.token || null,
    });
    const nextSession = credential || { roomId: data.roomId, token: data.token, name: cleanName, viewerRole: data.state.viewerRole || 'player' };
    if (currentEpoch !== epoch) {
      compensateStaleSession(nextSession);
      return;
    }
    connectingSession = null;
    saveSession(nextSession);
    applyState(data.state, voiceEpoch);
    if (!state.value) throw new Error('牌桌状态未能加载，请刷新当前页面重试。');
    updateRoomUrl(nextSession.roomId);
    flash(mode === 'spectate' ? '已进入观战，不占玩家座位。' : mode === 'create' ? '牌桌已准备好，邀请朋友来坐。' : '落座成功，欢迎来到牌桌。');
  } catch (failure) {
    if (currentEpoch === epoch) {
      connectingSession = null;
      if (credential && [401, 403, 404, 410].includes(failure.status))
        forgetSession(code, credential.token);
      error.value = failure.name === 'AbortError' ? '连接超时，请稍后再试。' : failure.message;
    }
  } finally {
    if (currentEpoch === epoch) {
      busy.value = false;
      schedulePoll();
    }
  }
}
// 发送用户选择的合法动作及 revision；冲突或网络不确定时先同步，不猜测成功也不重放操作。
// Send the chosen action with revision; on conflict or uncertain transport, synchronize instead of assuming success or replaying it.
async function mutate(action, start = false) {
  if (isSpectator.value) return;
  if (busy.value || offline.value || syncing.value || presentationWaiting.value || !state.value || !session.value) return;
  if (start && (!canStart.value || filledSeats.value < tablePlayerCount.value)) return;
  // 即使调用者绕过禁用按钮，非法金额也在发请求前返回；服务端仍会独立校验。
  // Reject invalid amounts before a request even if a caller bypasses the disabled button; the server validates independently.
  if (start && !validStartOptions.value) {
    error.value = `大单吊喜钱须为 0–${MAX_BIG_SINGLE_READY_POINTS} 的整数`;
    return;
  }
  // 新桌只提交开局意图，由服务端读取固定规则；旧桌只提交尚未固定字段的草稿快照。
  // New rooms submit only start intent and use server snapshots; legacy rooms send drafts only for unfixed fields.
  const startOptions = start
    ? isChengduRoom.value ? {} : {
        ...(!hasFixedAutoDiscard.value ? { autoDiscardAfterHu: autoDiscardAfterHu.value } : {}),
        ...(!hasFixedReadyPoints.value ? { bigSingleReadyPoints: bigSingleReadyPoints.value } : {}),
      }
    : null;
  busy.value = true;
  error.value = '';
  clearTimeout(pollTimer);
  epoch++;
  pollController?.abort();
  pollController = null;
  const currentEpoch = epoch;
  const credential = { ...session.value };
  const revision = state.value.revision;
  // 页面租约也会提升房间版本；单局身份和引擎版本让服务端区分遥测变化与真正的过期动作。
  // Page leases also change room revision; game identity/revision distinguish telemetry changes from genuinely stale moves.
  const actionGame = start ? {} : {
    gameId: state.value.game?.id,
    gameRevision: state.value.game?.revision,
  };
  const voiceEpoch = voiceVisibilityEpoch;
  let needsSync = false;
  try {
    const data = await api(
      `/api/rooms/${encodeURIComponent(credential.roomId)}/${start ? 'start' : 'action'}`,
      {
        method: 'POST',
        token: credential.token,
        body: {
          revision,
          ...(!isChengduRoom.value ? { presentation: true, presentationMode: 'local' } : {}),
          ...(start ? { options: startOptions } : { action, ...actionGame }),
        },
      },
    );
    if (currentEpoch !== epoch) return;
    applyState(data.state, voiceEpoch);
    selectedTile.value = null;
    selectedHandIndex.value = null;
  } catch (failure) {
    if (currentEpoch !== epoch) return;
    if (failure.code === 'SEAT_DETACHED') {
      resetRoomContext();
      error.value = '此座位已离桌，请重新打开这桌的邀请链接，或返回大厅。';
      loadHistory();
      return;
    }
    // 409 是乐观并发冲突：手里的 revision 过旧，必须先看新牌面。
    // 409 signals optimistic concurrency conflict: the submitted revision is stale and the board must refresh.
    if (failure.status === 409) {
      error.value = '牌局刚刚有更新，正在同步。请稍后重新选择。';
      needsSync = true;
    }
    // 没有 HTTP 状态不代表服务端没有执行；同步确认而不是再次提交。
    // No HTTP status does not prove non-execution; synchronize rather than resubmit.
    else if (!failure.status) {
      offline.value = true;
      error.value = '连接中断，操作结果需要同步确认。请稍等片刻。';
      needsSync = true;
    } else error.value = failure.message;
  } finally {
    if (currentEpoch === epoch) {
      syncing.value = needsSync;
      busy.value = false;
      if (needsSync) await refresh();
      else schedulePoll();
    }
  }
}
// 尝试复制不含凭证的邀请；权限拒绝时展示可手动选择的输入框。
// Copy a credential-free invitation; on clipboard failure show a manually selectable input.
async function copyInvite() {
  const currentEpoch = epoch;
  copyDone.value = false;
  clearTimeout(copyTimer);
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    if (epoch !== currentEpoch) return;
    copyDone.value = true;
    copyTimer = setTimeout(() => {
      copyDone.value = false;
    }, 2500);
  } catch {
    if (epoch !== currentEpoch) return;
    showInvite.value = true;
    await nextTick();
    if (epoch === currentEpoch) {
      inviteInput.value?.focus();
      inviteInput.value?.select();
    }
  }
}
// 先把地址改回主页，再走正常离席流程，不关闭共享后端。
// Navigate to the root and use the normal departure flow without stopping the shared backend.
function newTable() {
  updateRoomUrl(null);
  return routeFromLocation();
}
// Escape 关闭弹窗；Tab 与 Shift+Tab 把焦点留在弹窗可操作控件内。
// Escape closes dialogs; Tab and Shift+Tab trap focus within their interactive controls.
function onKey(event) {
  if (event.key === 'Escape') {
    showRules.value = false;
    showInvite.value = false;
  }
  if (event.key === 'Tab' && (showRules.value || showInvite.value)) {
    const elements = modalRef.value?.querySelectorAll('button, input, [tabindex="0"]');
    if (!elements?.length) return;
    const first = elements[0],
      last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
// watch 用于副作用：弹窗开关变化时管理焦点与滚动；nextTick 等待 Vue 真正更新 DOM。
// watch runs side effects: manage focus and scrolling when dialogs change; nextTick waits for Vue’s DOM update.
watch(
  () => showRules.value || showInvite.value,
  async (open) => {
    const currentEpoch = epoch;
    if (open) {
      previousFocus = document.activeElement;
      document.body.style.overflow = 'hidden';
      await nextTick();
      if (epoch === currentEpoch && (showRules.value || showInvite.value)) {
        if (showInvite.value && !showRules.value) {
          inviteInput.value?.focus();
          inviteInput.value?.select();
        } else modalRef.value?.querySelector('button')?.focus();
      }
    } else {
      document.body.style.overflow = '';
      if (previousFocus?.isConnected !== false) previousFocus?.focus?.();
      previousFocus = null;
    }
  },
);
// 恢复昵称和缓存凭证后仍由当前地址决定入口。
// Restore the name and cached credentials, but let the current URL decide the entry point.
async function initialize() {
  const previous = loadSavedSessions();
  if (typeof previous?.name === 'string') name.value = previous.name;
  await routeFromLocation(previous);
}
// 组件挂载后才能访问页面控件并注册全局事件；初始化读取当前 URL。
// After mount, access page controls and register global events; initialization reads the current URL.
onMounted(() => {
  try {
    voiceMuted.value = localStorage.getItem('huajian-voice-muted') === 'true';
  } catch {
    /* 可选偏好保存失败不影响牌局。 / optional preference */
  }
  characterAudio.setMuted(voiceMuted.value);
  document.addEventListener('pointerdown', unlockVoice);
  document.addEventListener('keydown', unlockVoice);
  document.addEventListener('keydown', onKey);
  window.addEventListener('online', refresh);
  window.addEventListener('popstate', onPopState);
  document.addEventListener('visibilitychange', visibilityChanged);
  initialize();
});
// 卸载时成对移除监听、停止声音与轮询；尽力通知离席但不在销毁期间抛出未处理错误。
// On unmount, remove listeners and stop audio and polling; notify departure best-effort without unhandled teardown errors.
onUnmounted(() => {
  destroyed = true;
  characterAudio.dispose();
  document.removeEventListener('pointerdown', unlockVoice);
  document.removeEventListener('keydown', unlockVoice);
  const previous = session.value;
  resetRoomContext();
  if (previous) queueLeave(previous).catch(() => {});
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('online', refresh);
  window.removeEventListener('popstate', onPopState);
  document.removeEventListener('visibilitychange', visibilityChanged);
});
</script>

<!-- 模板把响应式状态映射为 DOM：冒号绑定属性，@ 绑定事件，双花括号插入转义文字。 / Templates map reactive state to DOM: colon binds attributes, @ binds events, and double braces insert escaped text. -->
<template>
  <div
    class="app-shell"
    :class="{
      'is-spectator': isSpectator,
      'in-game': inRoom && phase !== 'lobby',
      'in-room': inRoom,
      'has-room-route': !!roomCode || restoring || busy,
    }"
  >
    <!-- 全局页眉提供声音、换桌和规则入口；按钮事件只调用上面的处理函数。 / The global header exposes audio, room navigation and rules; button events call the handlers above. -->
    <header class="site-header">
      <div class="brand" :aria-label="isChengduContext ? '花间，成都麻将' : '花间，自贡花麻将'">
        <svg class="brand-mark" viewBox="0 0 42 42" aria-hidden="true">
          <path
            d="M21 5c8-1 7 10 7 10s11-1 10 7-10 6-10 6 1 11-7 10-6-10-6-10-11 1-10-7 10-6 10-6-1-11 6-10Z"
          />
          <circle cx="21.5" cy="21.5" r="3.5" />
        </svg>
        <div class="brand-name">花间 <span>{{ isChengduContext ? '成都麻将' : '自贡花麻将' }}</span></div>
      </div>
      <div class="header-actions">
        <button
          class="text-button voice-toggle"
          :aria-pressed="voiceStatus === 'ready' && !voiceMuted"
          @click="toggleVoice"
          ><Icon name="soundoff" :size="17" />{{
            voiceMuted
              ? '语音已关'
              : voiceStatus === 'ready'
                ? '角色语音已开'
                : voiceStatus === 'unavailable'
                  ? '语音加载失败 · 重试'
                  : '开启角色语音'
          }}</button
        >
        <button
          v-if="pendingPresentationCount >= 8"
          class="text-button"
          @click="skipLocalPlayback"
          >待播 {{ pendingPresentationCount }} 段 · 略过并看最新牌面</button
        >
        <span class="prototype-pill"><span></span> 朋友内测版 · v0.7.0</span>
        <button
          v-if="inRoom || roomCode || restoring || busy"
          class="text-button leave-table-button"
          @click="newTable"
          >返回大厅 / 换桌</button
        >
        <button class="text-button rules-trigger" @click="showRules = true"
          ><Icon name="book" :size="17" /><span>玩法说明</span></button
        >
      </div>
    </header>
    <!-- 全局可选设置同时覆盖两玩法；不阻挡建房、开局或静态角色。 / Optional global settings cover both modes without blocking rooms, play or static art. -->
    <PortraitMotionSettings />

    <!-- 短暂飞牌覆盖层不持有真实牌；稳定 eventKey 区分每次已提交事件。 / Transient flight overlays do not own real tiles; stable eventKey values identify committed events. -->
    <div
      v-for="flight in winningFlights"
      :key="flight.eventKey"
      class="winning-flight"
      :style="flight.style"
      aria-hidden="true"
      ><MahjongTile :tile="flight.tile" small
    /></div>
    <div v-if="notice" class="toast" role="status"
      ><Icon name="check" :size="17" />{{ notice }}</div
    >

    <!-- 没有已验证会话和快照时显示大厅，不以历史缓存决定自动入桌。 / Show the lobby without both a verified session and snapshot; cached history does not auto-enter a room. -->
    <main v-if="!inRoom" class="welcome-layout">
      <section class="welcome-story">
        <p class="eyebrow"><span></span> {{ isChengduContext ? '四人同桌 · 成都麻将' : '三四人同桌 · 自贡味道' }}</p>
        <h1>花开一桌，<br />好牌<span class="gold-text">慢慢来。</span></h1>
        <p class="welcome-description"
          >{{ isChengduContext ? '万条筒齐，先把牌桌备好。' : '只有条筒，也有花样。' }}<br />叫上牌友，把熟悉的热闹搬到线上。</p
        >
        <div class="hero-illustration" :aria-label="isChengduContext ? '万、条、筒麻将牌的装饰插图' : '三张条筒麻将牌的装饰插图'" role="img">
          <div class="illustration-ring ring-one"></div
          ><div class="illustration-ring ring-two"></div>
          <span class="art-flower flower-one">✦</span><span class="art-flower flower-two">✧</span>
          <div class="hero-tile hero-tile-left"><MahjongTile :tile="isChengduContext ? 18 : 11" /></div>
          <div class="hero-tile hero-tile-center"><MahjongTile :tile="0" /></div>
          <div class="hero-tile hero-tile-right"><MahjongTile :tile="13" /></div>
          <div class="illustration-caption"><span></span> 条筒之间，自有乐趣 <span></span></div>
        </div>
        <div class="welcome-features"
          ><span><Icon name="users" :size="17" />三人或四人同桌</span
          ><span><Icon name="soundoff" :size="17" />多位角色，声声有别</span
          ><span><Icon name="shield" :size="17" />仅虚拟积分</span></div
        >
      </section>

      <!-- 落座表单：v-model 双向绑定输入，submit.prevent 阻止浏览器整页刷新。 / Entry form: v-model binds input both ways, and submit.prevent prevents a full-page browser submission. -->
      <section class="entry-card" aria-labelledby="entry-title">
        <div class="card-topline"
          ><span class="small-flower">✳</span><span>留一个位置，给好朋友</span></div
        >
        <h2 id="entry-title">{{ entryMode === 'create' ? '先坐下来吧' : '朋友在等你' }}</h2>
        <p class="card-description">{{
          entryMode === 'create'
            ? '先定好本桌玩法，再邀请朋友来坐。'
            : '输入房间号，就能找到熟悉的牌桌。'
        }}</p>
        <div class="entry-tabs" role="group" aria-label="进入牌桌方式">
          <button
            type="button"
            :aria-pressed="entryMode === 'create'"
            :class="{ active: entryMode === 'create' }"
            :disabled="busy || restoring"
            @click="
              entryMode = 'create';
              error = '';
            "
            ><Icon name="plus" :size="17" />创建牌桌</button
          >
          <button
            type="button"
            :aria-pressed="entryMode === 'join'"
            :class="{ active: entryMode === 'join' }"
            :disabled="busy || restoring"
            @click="
              entryMode = 'join';
              error = '';
            "
            ><Icon name="users" :size="17" />加入牌桌</button
          >
          <button type="button" :aria-pressed="entryMode === 'spectate'"
            :class="{ active: entryMode === 'spectate' }" :disabled="busy || restoring"
            @click="entryMode = 'spectate'; error = ''">进入观战</button>
        </div>
        <p v-if="roomCode && !inRoom" class="invite-destination"
          >{{ restoring ? '正在连接邀请中的牌桌' : '将进入牌桌' }}
          <strong>{{ roomCode }}</strong></p
        >
        <form @submit.prevent="enterRoom">
          <!-- 玩法是建房身份，加入或观战只读目标房间，不允许在这里覆盖已有模式。
               Mode belongs to room creation; joining/spectating reads the target room without overriding its mode. -->
          <div v-if="entryMode === 'create'" class="mode-choice">
            <label class="field-label" for="game-mode">麻将玩法</label>
            <select id="game-mode" v-model="gameModeDraft" :disabled="busy || restoring" aria-describedby="game-mode-help">
              <option value="flower">自贡花麻将</option>
              <option value="chengdu">成都麻将 · 四人牌桌</option>
            </select>
            <p id="game-mode-help" class="table-setting-help">{{ gameModeDraft === 'chengdu' ? '固定四人、万条筒108张，选择本桌玩法后邀请朋友。' : '沿用现有花麻将规则，可选三人或四人。' }}</p>
          </div>
          <p v-if="entryMode === 'spectate'" class="spectator-entry-note">输入朋友分享的房间号即可观战，无需落座名，不占玩家位置。</p>
          <template v-else>
          <label class="field-label" for="player-name"
            >你的落座名 <span>让朋友一眼认出你</span></label
          >
          <input
            id="player-name"
            v-model="name"
            maxlength="16"
            autocomplete="nickname"
            placeholder="比如：自贡小雀神"
            :disabled="busy || restoring"
            required
          />
          <label class="field-label" for="preferred-character"
            >偏好角色 <span>可不选，由牌桌随机分配</span></label
          >
          <select
            id="preferred-character"
            :value="preferredCharacter"
            @change="preferredCharacter = $event.target.value"
            :disabled="busy || restoring"
            ><option value="">随机分配</option
            ><option v-for="character in CHARACTERS" :key="character.id" :value="character.id"
              >{{ character.name }} · {{ character.style }}</option
            ></select
          >
          <div v-if="preferredCharacter" class="preference-preview"
            ><img
              :src="CHARACTERS.find((character) => character.id === preferredCharacter)?.portrait"
              alt="偏好角色立绘预览"
            /><div
              ><strong>{{
                CHARACTERS.find((character) => character.id === preferredCharacter)?.name
              }}</strong
              ><span>{{
                CHARACTERS.find((character) => character.id === preferredCharacter)?.style
              }}</span
              ><small>先选喜欢的风格，落座后角色就固定。</small></div
            ></div
          >
          <p class="character-preference-note"
            >七位角色，{{ isChengduContext ? '成都固定四人同桌' : '支持三人或四人同桌' }}。落座时确定角色，开局保持不变；偏好已被占用时，从剩余角色中分配。</p
          >
          <!-- 固定四人/定缺无需可切换控件，四个未确认默认值的选择使用必填原生下拉框。
               Four seats/dingque are fixed; native required selects collect the four choices without assuming defaults. -->
          <fieldset v-if="entryMode === 'create' && gameModeDraft === 'chengdu'" class="table-settings-fields chengdu-settings-fields"
            :disabled="busy || restoring" aria-describedby="chengdu-settings-help chengdu-settings-pending">
            <legend>成都本桌玩法</legend>
            <p id="chengdu-settings-help" class="table-settings-intro">固定四人 · 万、条、筒共108张 · 必须定缺。创建后同桌沿用。</p>
            <div class="table-settings-grid">
              <div class="table-setting-field">
                <label for="chengdu-end-condition">结束方式</label>
                <select id="chengdu-end-condition" v-model="chengduEndConditionDraft" required>
                  <option disabled value="">请选择结束方式</option>
                  <option value="firstWin">首胡结束</option><option value="bloodBattle">血战到底</option>
                </select>
              </div>
              <div class="table-setting-field">
                <label for="chengdu-exchange-three">换三张</label>
                <select id="chengdu-exchange-three" v-model="chengduExchangeThreeDraft" required>
                  <option disabled value="">请选择是否换三张</option>
                  <option :value="true">开启换三张</option><option :value="false">不换三张</option>
                </select>
              </div>
              <div class="table-setting-field">
                <label for="chengdu-self-draw">自摸方式</label>
                <select id="chengdu-self-draw" v-model="chengduSelfDrawDraft" required aria-describedby="chengdu-self-draw-help">
                  <option disabled value="">请选择自摸方式</option>
                  <option value="addBase">自摸加底</option><option value="addFan">自摸加番</option>
                </select>
                <p id="chengdu-self-draw-help" class="table-setting-help">加底：封顶后加1分；加番：先加1番再封顶。</p>
              </div>
              <div class="table-setting-field">
                <label for="chengdu-fan-cap">封顶番数</label>
                <select id="chengdu-fan-cap" v-model.number="chengduFanCapDraft" required>
                  <option disabled value="">请选择封顶番数</option>
                  <option v-for="cap in CHENGDU_FAN_CAPS" :key="cap" :value="cap">{{ cap }}番封顶</option>
                </select>
              </div>
            </div>
            <p v-if="!validChengduSettings" class="table-setting-help">请完成上面四项选择，再创建准备桌。</p>
            <p id="chengdu-settings-pending" class="chengdu-pending-note">四人到齐后由房主开始；换牌和定缺由各人亲自选择，只使用虚拟积分。</p>
          </fieldset>
          <!-- 所有新桌选项在同一面板内配置，创建时一次提交；保留原生表单语义、键盘操作与错误关联。
               Configure every new-room choice together and submit once at creation; preserve native semantics, keyboard controls and linked errors. -->
          <fieldset v-if="entryMode === 'create' && gameModeDraft === 'flower'" class="table-settings-fields" :disabled="busy || restoring"
            aria-describedby="table-settings-help">
            <legend>本桌玩法</legend>
            <p id="table-settings-help" class="table-settings-intro">创建后固定，同桌每一局沿用。</p>
            <div class="table-settings-grid">
              <div class="table-setting-field">
                <label for="table-player-count">同桌人数</label>
                <select id="table-player-count" v-model.number="playerCountDraft">
                  <option :value="3">三人</option><option :value="4">四人</option>
                </select>
              </div>
              <div class="table-setting-field">
                <label for="table-deck-count">麻将副数</label>
                <select id="table-deck-count" v-model.number="deckCountDraft" aria-describedby="deck-count-help">
                  <option v-for="count in deckChoices" :key="count" :value="count">{{ count }} 副 · {{ count * 72 }} 张</option>
                </select>
              </div>
              <p id="deck-count-help" class="table-setting-help table-setting-wide">一副为条筒 18 种各 4 张，半副各加 2 张。</p>
              <div class="table-setting-field">
                <label for="dragon-start-count">神龙起算张数</label>
                <div class="table-setting-input-unit">
                  <input id="dragon-start-count" v-model.number="dragonStartCountDraft" type="number" inputmode="numeric"
                    :min="MIN_DRAGON_START_COUNT" :max="MAX_DRAGON_START_COUNT" step="1" required
                    :aria-invalid="!isDragonStartCount(dragonStartCountDraft)"
                    :aria-describedby="`dragon-count-help${!isDragonStartCount(dragonStartCountDraft) ? ' dragon-count-error' : ''}${dragonStartCountDraft > deckCountDraft * 4 ? ' dragon-count-warning' : ''}`" />
                  <span aria-hidden="true">张</span>
                </div>
                <p id="dragon-count-help" class="table-setting-help">10 分起，每多一张翻倍。</p>
                <p v-if="!isDragonStartCount(dragonStartCountDraft)" id="dragon-count-error" class="table-setting-error" role="alert">请输入 1–20 的整数。</p>
              </div>
              <div class="table-setting-field">
                <label for="create-ready-points">大单吊喜钱（每家）</label>
                <div class="table-setting-input-unit">
                  <input id="create-ready-points" v-model.number="bigSingleReadyPoints" type="number" inputmode="numeric"
                    min="0" :max="MAX_BIG_SINGLE_READY_POINTS" step="1" required
                    :aria-invalid="!validReadyPoints"
                    :aria-describedby="validReadyPoints ? 'create-ready-help' : 'create-ready-help create-ready-error'" />
                  <span aria-hidden="true">分</span>
                </div>
                <p id="create-ready-help" class="table-setting-help">虚拟积分，0 表示不收取。</p>
                <p v-if="!validReadyPoints" id="create-ready-error" class="table-setting-error" role="alert">请输入 0–{{ MAX_BIG_SINGLE_READY_POINTS }} 的整数。</p>
              </div>
              <p v-if="dragonStartCountDraft > deckCountDraft * 4" id="dragon-count-warning" class="settings-warning table-setting-wide">起算张数超过每种牌数量，本局不会触发神龙。</p>
              <p class="table-setting-help table-setting-wide">听成大单吊时，其他玩家各付喜钱，每人每局仅一次；后续胡牌另算。</p>
              <div class="table-setting-toggle table-setting-wide">
                <label for="create-auto-discard">
                  <span>胡后自动打出 <small>{{ autoDiscardAfterHu ? '已开启' : '已关闭' }}</small></span>
                  <input id="create-auto-discard" v-model="autoDiscardAfterHu" type="checkbox" role="switch"
                    aria-describedby="create-auto-discard-help" />
                </label>
                <p id="create-auto-discard-help" class="table-setting-help">胡后没有胡、杠可选时，自动打出新牌。关闭后需点“过”继续；有合法杠仍必须杠。</p>
              </div>
            </div>
          </fieldset>
          </template>
          <template v-if="entryMode !== 'create'">
            <label class="field-label room-code-label" for="room-code">房间号</label>
            <input
              id="room-code"
              v-model="roomCode"
              maxlength="8"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              class="room-code-input"
              placeholder="输入朋友分享的房间号"
              :disabled="busy || restoring"
              required
            />
          </template>
          <div v-if="error" class="inline-error" role="alert"
            ><Icon name="info" :size="17" /><span>{{ error }}</span></div
          >
          <button class="button primary entry-submit" type="submit" :disabled="busy || restoring || (entryMode === 'create' && !validCreationSettings)"
            ><span v-if="busy || restoring" class="spinner"></span
            ><template v-else
              ><span>{{ entryMode === 'create' ? (gameModeDraft === 'chengdu' ? '创建成都牌桌' : '创建一张牌桌') : entryMode === 'spectate' ? '进入房间观战' : '加入这张牌桌' }}</span
              ><Icon name="arrow" :size="20" /></template
            ><span v-if="busy || restoring">{{
              restoring ? '正在回到牌桌…' : entryMode === 'spectate' ? '正在进入观战…' : '正在为你落座…'
            }}</span></button
          >
        </form>
        <div class="entry-note"
          ><Icon name="info" :size="16" /><p
            >本桌人数到齐，由房主开始。每位牌友使用自己的浏览器加入，不设机器人。</p
          ></div
        >
        <div class="card-bottom"
          ><template v-if="isChengduContext"><span>四人 · 108张</span><i>·</i><span>必须定缺</span><i>·</i><span>仅房间准备</span></template><template v-else><span>条筒1–5副</span><i>·</i><span>全员胡完收桌</span><i>·</i><span>萝卜加分</span></template></div
        >
      </section>
      <!-- 大厅跨桌记录属于匿名个人身份，和当前牌桌总积分是两个不同范围。 / Cross-room lobby history belongs to anonymous identity and is distinct from the current table ledger. -->
      <section class="personal-history" aria-labelledby="personal-history-title">
        <div class="personal-history-heading"
          ><div
            ><p class="eyebrow">我的牌局</p
            ><h2 id="personal-history-title">我的总积分与每局记录</h2></div
          ><button class="text-button" :disabled="historyLoading" @click="loadHistory">{{
            historyLoading ? '加载中…' : '刷新记录'
          }}</button></div
        >
        <p class="identity-note"
          >无需登录，按此浏览器保存的身份记分，不按落座名合并。改名、断线或离桌不会清除已保存记录；清除浏览器数据或换设备后，无法自动找回。</p
        >
        <p v-if="storageWarning" class="history-warning" role="status">{{ storageWarning }}</p>
        <div v-if="historyError" class="history-warning" role="alert">{{ historyError }}</div>
        <div v-if="personalHistory" class="history-summary"
          ><div
            ><span>个人总积分 · 累计已结算</span
            ><strong :class="{ negative: personalHistory.summary.totalScore < 0 }">{{
              scoreLabel(personalHistory.summary.totalScore)
            }}</strong></div
          ><div
            ><span>已结算牌局</span
            ><strong>{{ personalHistory.summary.settledGames }} <small>局</small></strong></div
          ></div
        >
        <p v-if="historyLoading && !personalHistory" class="history-empty" role="status"
          >正在读取你的历史记录…</p
        >
        <p v-else-if="personalHistory && !personalHistory.records.length" class="history-empty"
          >还没有牌局记录。开局后，本人的积分变化会保存在这里。</p
        >
        <ul v-if="personalHistory?.records?.length" class="personal-game-list">
          <li
            v-for="record in personalHistory.records"
            :key="record.gameId"
            class="personal-game-record"
          >
            <div class="personal-game-topline"
              ><div
                ><strong>房间 {{ record.roomId }}</strong
                ><span
                  >{{ record.startedAtEstimated ? '约 ' : '' }}{{ historyDate(record.startedAt) }} ·
                  {{ record.name }}</span
                ></div
              ><span class="record-status" :class="{ settled: record.status === 'finished' }">{{
                historyStatus(record)
              }}</span></div
            >
            <div class="personal-game-result"
              ><span
                >本局{{ record.status === 'finished' ? '结算' : '暂记' }}
                <b>{{ scoreLabel(record.score) }}</b> 分</span
              ><span>已胡 {{ record.huCount || 0 }} 次</span></div
            >
            <p v-if="record.status !== 'finished'" class="provisional-note"
              >已发生的计分已保存，牌局尚未结束，不计入累计已结算积分。</p
            >
            <details
              v-if="record.players?.length || record.events?.length"
              class="personal-game-details"
              ><summary>查看本局记录</summary
              ><div v-if="record.players?.length" class="record-players"
                ><span v-for="player in record.players" :key="player.seat"
                  >{{ player.name }} <b>{{ scoreLabel(player.score) }}</b></span
                ></div
              ><ol v-if="record.events?.length"
                ><li v-for="(event, index) in record.events" :key="index"
                  >{{ record.gameMode === 'chengdu' ? chengduEventText(event, record.players.map((player) => player.name)) : event.message || event.type || '积分记录'
                  }}<span v-if="typeof event.delta === 'number'">
                    · {{ scoreLabel(event.delta) }} 分</span
                  ></li
                ></ol
              ></details
            >
          </li>
        </ul>
        <p class="history-disclaimer">只记录虚拟积分，不含充值、支付或现金输赢。</p>
      </section>
      <footer class="welcome-footer"
        ><span>一桌好朋友，一局好时光。</span
        ><span>规则原型 v0.7.0 · 不含充值、支付或现金输赢</span></footer
      >
    </main>

    <!-- 已在房间时展示桌面；大厅与房间互斥，不创建第二份游戏引擎。 / Render the table when in a room; lobby and room are mutually exclusive and do not create a second game engine. -->
    <main v-else class="room-layout">
      <div class="room-heading">
        <div class="room-title"
          ><span class="eyebrow">{{ isChengduRoom ? '四人成都麻将' : phase === 'lobby' ? '牌桌准备中' : `${tablePlayerCount}人花麻将` }}</span
          ><h1>{{
            phase === 'lobby'
              ? isChengduRoom ? '先坐一桌，玩法准备中。' : '朋友来齐，就开桌。'
              : phase === 'finished'
                ? '好牌好聚，下桌再续。'
                : '此刻，正好一桌。'
          }}</h1></div
        >
        <div class="room-tools"
          ><div class="room-code-badge"
            ><span>房间号</span><strong>{{ state.id }}</strong></div
          ><button class="button invite-button" @click="copyInvite"
            ><Icon :name="copyDone ? 'check' : 'copy'" :size="16" /><span>{{
              copyDone ? '已复制' : '复制邀请'
            }}</span></button
          ></div
        >
      </div>
      <div v-if="isSpectator" class="spectator-banner" role="status"><strong>观战中</strong><span>不占座 · 不能打牌 · 暗手与进行中的自摸牌面不公开</span></div>
      <!-- 成都只展示建房快照；不借用花麻将的喜钱、萝卜、神龙或碰杠规则说明。
           Chengdu displays saved room choices only, never Flower bonus/radish/dragon/kong rules. -->
      <section v-if="isChengduRoom" class="room-settings-recap chengdu-room-recap" aria-labelledby="chengdu-room-title">
        <strong id="chengdu-room-title">成都本桌玩法 · 创建时已确定</strong>
        <span>固定四人 · 万、条、筒共108张 · 必须定缺</span>
        <span>结束方式：{{ state.settings.endCondition === 'firstWin' ? '首胡结束' : '血战到底' }}</span>
        <span>换三张：{{ state.settings.exchangeThree ? '开启' : '关闭' }}</span>
        <span>自摸：{{ state.settings.selfDraw === 'addBase' ? '加底（封顶后加1分）' : '加番（先加1番再封顶）' }}</span>
        <span>{{ state.settings.fanCap }}番封顶</span>
        <p id="chengdu-room-pending" class="chengdu-pending-note">{{ state.rulesVersion === 2 ? '四人到齐后由房主开始；本桌选项每局沿用。' : '此服务端尚未开放成都开局，请等待版本更新。' }}</p>
        <small>角色偏好、邀请和观战共用原房间流程；角色在落座时确定，开局不重抽。</small>
      </section>
      <!-- 兼容提示按本局保存的规则开关出现，更新前端不会改写已开局的规则。 / Compatibility banners follow saved game flags; updating the frontend does not rewrite an active game. -->
      <div v-if="isLatest && game?.rules?.radishCountsWinPile === false" class="legacy-banner"
        ><Icon name="info" :size="15" /><span
          >本局保留 v0.4.0
          萝卜规则，不改旧账。胡牌区参与萝卜计分、自摸付款方修正从下一局生效。</span
        ></div
      >
      <!-- 兼容提示按本局保存的规则开关出现，更新前端不会改写已开局的规则。 / Compatibility banners follow saved game flags; updating the frontend does not rewrite an active game. -->
      <div
        v-if="
          isLatest &&
          game?.rules?.radishCountsWinPile === true &&
          !game?.rules?.finalHuPaymentExceptions
        "
        class="legacy-banner"
        ><Icon name="info" :size="15" /><span
          >本局保留开局时的终局付款规则。终局自摸收两家、接已胡者杠后弃牌只收出牌者的修正，从下一局生效。</span
        ></div
      >
      <div v-if="game && isLatest && !usesSpecialPatterns" class="legacy-banner"
        ><Icon name="info" :size="15" /><span
          >本桌保留开局时的牌型计分，不改旧账。七对特殊听牌、大单吊及清一色、对对胡新加番从下一局生效。</span
        ></div
      >
      <div v-if="isOlderGame" class="legacy-banner"
        ><Icon name="info" :size="15" /><span>{{
          isLegacy
            ? '本桌已开局，继续使用旧规则。新版自动摸牌等改动从新桌生效。'
            : '本桌保留 v0.3.1 旧规则：个人萝卜、胡后听口限制与逐次神龙分不变。v0.4.0 新规则从下一局生效。'
        }}</span
        ><button class="text-button" @click="newTable"
          >离开旧桌，返回大厅换新桌<Icon name="arrow" :size="13" /></button
      ></div>
      <!-- 离席和离线是不同状态：离席仍保留进行中牌局的手牌及账目。 / Detached and offline are distinct: departure still preserves hands and accounting in an active game. -->
      <div
        v-if="phase === 'playing' && seats.some((player) => player.detached)"
        class="connection-banner departed-banner"
        role="status"
        ><Icon name="info" :size="17" /><span
          >有牌友已离桌，原手牌与已发生的计分仍保留。需要该牌友操作时，等待原座位重连。</span
        ></div
      >
      <div v-if="offline" class="connection-banner" role="status"
        ><span class="spinner"></span><span>连接暂时中断，正在自动重连。牌局同步前暂不能操作。</span
        ><button @click="refresh">立即重连</button></div
      >
      <div v-if="error" class="room-error" role="alert"
        ><Icon name="info" :size="17" /><span>{{ error }}</span
        ><button class="icon-button" aria-label="关闭提示" @click="error = ''"
          ><Icon name="close" :size="16" /></button
      ></div>

      <!-- 只有缺少建房快照字段的旧桌保留开局草稿；新桌在这里仅展示已保存规则。 / Only legacy rooms missing creation fields retain editable start drafts; new rooms show saved choices. -->
      <section v-if="canConfigureStart" class="start-options" aria-labelledby="start-options-title">
        <strong id="start-options-title">{{
          phase === 'finished' ? '下一局选项' : '开局选项'
        }}</strong>
        <label v-if="!hasFixedAutoDiscard" for="auto-discard-after-hu"
          ><input
            id="auto-discard-after-hu"
            v-model="autoDiscardAfterHu"
            type="checkbox"
            :disabled="busy || offline || syncing"
            aria-describedby="auto-discard-help"
          /><span>胡后自动打出</span></label
        >
        <p v-if="!hasFixedAutoDiscard" id="auto-discard-help"
          >仅在胡后没有胡、杠可选时自动打出新牌；不勾选则需点“过”继续。有合法杠仍必须杠。开局后不可更改。</p
        >
        <!-- .number 尝试把输入转为数字，computed 再做完整校验；错误提示与 aria-describedby 同步，键盘和读屏都能知道原因。 / .number attempts numeric conversion, then computed performs full validation; the error and aria-describedby stay synchronized for keyboard and screen-reader users. -->
        <div v-if="!hasFixedReadyPoints" class="ready-points-option">
          <label for="big-single-ready-points">大单吊喜钱（每家）</label>
          <div class="ready-points-input"
            ><input
              id="big-single-ready-points"
              v-model.number="bigSingleReadyPoints"
              type="number"
              inputmode="numeric"
              min="0"
              :max="MAX_BIG_SINGLE_READY_POINTS"
              step="1"
              required
              :disabled="busy || offline || syncing"
              :aria-invalid="!validReadyPoints"
              :aria-describedby="
                validReadyPoints ? 'ready-points-help' : 'ready-points-help ready-points-error'
              "
            /><span>虚拟积分 / 家</span></div
          >
          <p id="ready-points-help"
            >听成大单吊的一瞬间，其他玩家各付此分数，每人每局仅一次。默认 50，填 0
            则不收取；开局后不可更改，后续胡牌另算。</p
          >
          <p
            v-if="!validReadyPoints"
            id="ready-points-error"
            class="ready-points-error"
            role="alert"
            >请输入 0–{{ MAX_BIG_SINGLE_READY_POINTS }} 的整数。</p
          >
        </div>
      </section>
      <section v-if="hasFixedAutoDiscard || hasFixedReadyPoints" class="room-settings-recap" aria-label="创建时确定的本桌规则">
        <strong>本桌玩法 · 创建时已确定</strong>
        <span v-if="hasFixedAutoDiscard">胡后自动打出：{{ state.settings.autoDiscardAfterHu ? '开启' : '关闭，需点“过”继续' }}</span>
        <span v-if="hasFixedReadyPoints">大单吊喜钱：{{ state.settings.bigSingleReadyPoints === 0 ? '0 分，不收取' : `每家 ${state.settings.bigSingleReadyPoints} 分` }}</span>
        <small>同桌每一局沿用；如需调整，请返回大厅创建新桌。</small>
      </section>
      <!-- 所有人读取本局保存的喜钱规则，区别未启用、主动设为零与具体金额；不展示房主尚未提交的草稿。 / Everyone sees saved game rules, distinguishing unavailable, explicitly zero and positive amounts; never display the host’s unsubmitted draft here. -->
      <p v-if="game && isLatest" class="game-rule-choice"
        >{{ phase === 'finished' ? '上一局' : '本局' }}大单吊喜钱：<strong>{{
          !gameBigSingleReadyEnabled
            ? '未启用，不补收'
            : gameBigSingleReadyPoints === 0
              ? '0 分，不收取'
              : `另外${tablePlayerCount - 1}家各付 ${gameBigSingleReadyPoints} 分`
        }}</strong>
        · 听牌时结算，每人每局一次</p
      >
      <p v-if="!isChengduRoom && game && !isLegacy" class="game-rule-choice"
        >{{ phase === 'finished' ? '上一局' : '本局' }}胡后自动打出：<strong>{{
          gameAutoDiscardAfterHu ? '已开启' : '已关闭，需点“过”继续'
        }}</strong>
        · 开局时确定</p
      >

      <p v-if="!isChengduRoom" class="game-rule-choice turn-direction-note"
        >行牌方向：<strong>{{
          counterclockwise
            ? (tablePlayerCount === 4 ? '逆时针 · 自己 → 右手边 → 对家 → 左手边' : '逆时针 · 自己 → 右手边 → 左手边')
            : '顺时针 · 本局保留原方向，下一局改为逆时针'
        }}</strong>
        · 同级碰、杠、胡按此顺序，不按点击先后</p
      >

      <p v-if="!isChengduRoom" class="game-rule-choice pung-upgrade-note"
        ><strong>{{
          pungUpgradeAfterDiscard
            ? '碰后先打出一张，之后轮到自己时可以补杠。'
            : '本局保留原补杠时机；下一局碰后须先打出一张，再允许补杠。'
        }}</strong>
        已成立的杠仍可逐张加至本局每种牌的上限（{{ tableCopies }} 张）。</p
      >

      <p v-if="!isChengduRoom" class="game-rule-choice table-settings-summary">
        本桌固定：<strong>{{ tablePlayerCount }}人 · {{ tableDeckCount }}副 · {{ tableDeckCount * 72 }}张</strong>
        · 神龙 <template v-if="exponentialDragon">{{ tableDragonStartCount }}张起10分，每多一张翻倍</template>
        <template v-else>保留旧局6/7/8张分表</template>
      </p>
      <ChengduTable v-if="isChengduRoom && game" :state="state" :blocked="busy || offline || syncing || presentationWaiting" :can-start="canStart" :character-for-player="characterForPlayer" @action="mutate" @start="mutate(null, true)" />
      <div v-else class="play-layout" :class="{ 'four-player-table': !isSpectator && tablePlayerCount === 4 }">
        <section class="table-column" :aria-label="`${tablePlayerCount}人麻将牌桌`">
          <div class="table-surface" :class="{ 'lobby-table': phase === 'lobby' }">
            <div class="table-topline"
              ><span
                ><i :class="{ disconnected: offline }"></i
                >{{ offline ? '重新连接中' : '实时牌桌' }}</span
              ><span
                >{{ filledSeats }}/{{ tablePlayerCount }} 位落座 <span class="table-top-divider">·</span>
                {{ statusLabel }}</span
              ></div
            >
            <!-- 对手数组以本人为基准排列，但 key 与角色都使用服务端绝对座位。 / Opponent layout is viewer-relative, while keys and characters use absolute server seats. -->
            <div class="opponent-row">
              <div
                v-for="player in opponents"
                :key="player.seat"
                class="opponent-seat"
                :class="{ 'seat-current': isTurn(player), 'seat-empty': !player.name, 'opposite-seat': opponentPosition(player.seat) === '对家' }"
              >
                <span v-if="!isSpectator && tablePlayerCount === 4" class="relative-seat-label">{{ opponentPosition(player.seat) }}</span>
                <div
                  v-if="player.name"
                  class="character-portrait"
                  :class="`character-${characterForPlayer(player.seat, !isSpectator).id}`"
                  ><CharacterArtwork :character="characterForPlayer(player.seat, !isSpectator)" /><span
                    >{{ characterForPlayer(player.seat, !isSpectator).name
                    }}<small>{{ characterForPlayer(player.seat, !isSpectator).style }}</small></span
                  ></div
                ><div class="player-topline"
                  ><div class="avatar" :class="`avatar-${player.seat}`"
                    ><img
                      v-if="player.name"
                      :src="characterForPlayer(player.seat, !isSpectator).portrait"
                      :alt="characterForPlayer(player.seat, !isSpectator).name" /><Icon
                      v-else
                      name="plus"
                      :size="20" /></div
                  ><div class="player-identity"
                    ><div class="player-name"
                      >{{ player.name || '虚位以待'
                      }}<span v-if="player.name && player.seat === state.hostSeat" class="host-tag"
                        >房主</span
                      ><span
                        v-if="game && player.seat === (game.dealerSeat ?? 0)"
                        class="host-tag dealer-tag"
                        >庄</span
                      ><span
                        v-if="player.name && player.connected === false"
                        class="connection-tag"
                        >{{ player.detached ? '已离桌' : '离线' }}</span
                      ></div
                    ><span class="player-caption">{{
                      !player.name
                        ? '等待朋友加入'
                        : phase === 'lobby'
                          ? '已落座，等开局'
                          : `${player.handCount} 张手牌 · 已胡 ${player.huCount} 次`
                    }}</span></div
                  ><span v-if="game" class="player-score" :class="{ negative: player.score < 0 }">{{
                    scoreLabel(player.score)
                  }}</span
                  ><span v-else-if="player.name" class="ready-dot"
                    ><Icon name="check" :size="14" /></span
                ></div>
                <!-- 对手只有手牌数量，最多画二十张背面占位；这里没有隐藏在 DOM 中的对手牌面。 / Opponents expose only hand counts, capped at twenty rendered backs; no opponent faces are hidden in the DOM. -->
                <div
                  v-if="game"
                  class="opponent-hand"
                  :aria-label="`${player.name}的手牌，共${player.handCount}张，仅显示背面`"
                  ><MahjongTile
                    v-for="hiddenTileNumber in Math.min(player.handCount, 20)"
                    :key="hiddenTileNumber"
                    back
                    small
                /></div>
                <div v-else class="lobby-seat-decoration"
                  ><span v-if="player.name">已经准备好，把好牌留给你。</span
                  ><span v-else>发一个邀请，留一份热闹。</span></div
                >
                <!-- 公开副露按服务端顺序展示；暗杠中的 null 用背面，不能由前端推算补全。 / Show public melds in server order; null concealed-kong tiles remain backs, never inferred by the client. -->
                <div v-if="game && player.melds.length" class="meld-list opponent-melds"
                  ><div v-for="(meld, meldIndex) in player.melds" :key="meldIndex" class="meld"
                    ><div class="meld-tiles"
                      ><MahjongTile
                        v-for="(tile, tileIndex) in meld.tiles"
                        :key="tileIndex"
                        :tile="tile"
                        :back="tile == null"
                        small /></div
                    ><small>{{ meldLabel(meld) }}</small></div
                  ></div
                >
                <!-- 胡牌区的共胡副本是记录；data 属性让已提交胡牌的飞行动画找到目标元素。 / Shared-win copies are records; data attributes let committed-win animations locate their targets. -->
                <div
                  v-if="game && !isLegacy"
                  class="win-pile"
                  :aria-label="`${player.name}的胡牌区`"
                >
                  <span class="public-zone-label"
                    >胡牌区 <b>{{ player.winPile.length }} 次</b></span
                  >
                  <div class="win-pile-tiles"
                    ><span
                      v-for="(win, winIndex) in player.winPile"
                      :key="winIndex"
                      class="win-pile-tile"
                      :class="{
                        'virtual-win': win.virtual,
                        'winning-tile': isWinningTile(player.seat, winIndex),
                      }"
                      :data-win-seat="player.seat"
                      :data-win-index="winIndex"
                      :title="winLabel(win)"
                      ><MahjongTile :tile="win.tile" :back="win.hidden" small /><span
                        v-if="win.virtual"
                        class="virtual-badge"
                        aria-label="共胡记牌，不另算实物牌"
                        >共胡</span
                      ></span
                    ><span v-if="!player.winPile.length" class="public-zone-empty"
                      >还未胡牌</span
                    ></div
                  >
                </div>
                <div v-if="game && !isLatest && player.radishes.length" class="radish-row"
                  ><span class="radish-label"
                    >萝卜 <b>共 {{ player.radishes.length }} 张</b
                    ><small
                      v-if="!isLegacy && radishIncrement(player.seat)"
                      class="radish-increment"
                      >{{ radishIncrementLabel(player.seat) }}</small
                    ></span
                  ><div class="radish-tiles"
                    ><MahjongTile
                      v-for="(tile, tileIndex) in player.radishes"
                      :key="tileIndex"
                      :tile="tile"
                      small /></div
                ></div>
              </div>
            </div>

            <!-- 开局按钮不仅需要房主，还要求三人齐且无请求、离线或待确认状态。 / Starting requires the host, three occupied seats, and no pending request, offline state or uncertain result. -->
            <div v-if="phase === 'lobby'" class="lobby-center">
              <div class="table-emblem"
                ><svg viewBox="0 0 48 48" aria-hidden="true">
                  <path
                    d="M24 6c9-1 8 11 8 11s12-1 11 8-11 7-11 7 1 12-8 11-7-11-7-11S5 33 6 24s11-7 11-7S16 5 24 6Z"
                  />
                  <circle cx="24.5" cy="24.5" r="4" /></svg
              ></div>
              <h2>{{ statusTitle }}</h2
              ><p>{{ statusDetail }}</p>
              <button
                v-if="isHost"
                class="button gold start-button"
                :aria-describedby="isChengduRoom ? 'chengdu-room-pending' : undefined"
                :disabled="!canStart || filledSeats < tablePlayerCount || busy || offline || syncing || !validStartOptions"
                @click="mutate(null, true)"
                ><span v-if="busy" class="spinner"></span
                ><Icon v-else name="sparkle" :size="18" />{{
                  isChengduRoom && state.rulesVersion !== 2 ? '成都开局暂未开放' : filledSeats < tablePlayerCount ? `等待另外 ${tablePlayerCount - filledSeats} 位牌友` : '人齐了，开始牌局'
                }}</button
              >
              <div v-else class="waiting-host"><span class="pulse-dot"></span>等待房主开始</div>
              <button v-if="filledSeats < tablePlayerCount" class="table-link" @click="copyInvite"
                ><Icon :name="copyDone ? 'check' : 'link'" :size="15" />{{
                  copyDone ? '邀请链接已复制' : '复制链接，邀请朋友'
                }}</button
              >
            </div>
            <div v-else class="playing-center">
              <!-- 读屏用礼貌播报区域接收胡牌文字；装饰动画本身 aria-hidden，不重复朗读。 / A polite live region announces wins to screen readers; decorative animation stays aria-hidden to avoid duplicates. -->
              <div class="win-announcement" role="status" aria-live="polite" aria-atomic="true">{{
                winningAnnouncement
              }}</div>
              <div v-if="winningEvents.length" class="win-cue" aria-hidden="true">
                <div v-for="event in winningEvents" :key="event.eventKey" class="win-cue-entry">
                  <span class="win-cue-source">{{
                    event.fromSeat != null
                      ? `${seatLabel(event.fromSeat)}${event.source === 'robKong' ? '杠牌' : '出牌'}`
                      : '摸牌成胡'
                  }}</span>
                  <MahjongTile :tile="event.tile" :back="event.hidden" small /><span class="win-cue-arrow">→</span>
                  <span
                    ><b>{{ seatLabel(event.seat) }}</b
                    ><strong
                      >{{ winSourceLabel(event) }} · {{ event.hidden ? '牌面隐藏' : tileLabel(event.tile) }}</strong
                    ></span
                  >
                </div>
              </div>
              <div class="game-status" aria-live="polite"
                ><div
                  ><span
                    class="turn-indicator"
                    :class="{ 'your-turn': isMyTurn || legalActions.length }"
                  ></span
                  ><strong>{{ statusTitle }}</strong></div
                ><div class="wall-counter"
                  ><span>余牌</span><b>{{ game.wallCount }}</b
                  ><span>张</span></div
                ></div
              >
              <!-- 接牌阶段展示等待回应的牌；抢杠仍是待确认动作，不能显示成已成立副露。 / During claims, show the tile awaiting responses; a rob-kong proposal is not yet a completed meld. -->
              <div v-if="game.phase === 'claim' && game.claim" class="claim-strip"
                ><MahjongTile :tile="game.claim.tile" small /><span
                  ><b>{{ seatLabel(game.claim.discardSeat) }}</b>
                  {{ game.claim.kind === 'robKong' ? `正在${pendingKongLabel}` : '打出了' }}
                  {{ tileLabel(game.claim.tile) }}</span
                ></div
              >
              <!-- 新版只有一个全桌共享池；旧局的个人萝卜使用各自兼容区块。 / Newer games have one shared pool; older personal radishes remain in compatibility sections. -->
              <section
                v-if="isLatest"
                class="shared-radish-pool"
                aria-labelledby="shared-radish-title"
              >
                <div class="shared-radish-heading"
                  ><h2 id="shared-radish-title">全桌共享萝卜</h2
                  ><span>共 {{ sharedRadishes.length }} 张</span
                  ><small
                    v-if="!game.firstHuRadishesRevealed && game.pendingKongRadishes"
                    class="radish-increment"
                    >首胡待翻 +{{ game.pendingKongRadishes }} 张杠萝卜</small
                  ><small v-if="latestSharedRadishes" class="radish-increment">{{
                    sharedRadishIncrementLabel(latestSharedRadishes)
                  }}</small></div
                >
                <div class="radish-tiles shared-radish-tiles"
                  ><MahjongTile
                    v-for="(tile, tileIndex) in sharedRadishes"
                    :key="tileIndex"
                    :tile="tile"
                    small
                  /><span v-if="!sharedRadishes.length" class="public-zone-empty"
                    >首胡才翻萝卜：6 张基础 +
                    {{ game.pendingKongRadishes || 0 }} 张已成杠累计。</span
                  ></div
                >
                <p>全桌共用这一池，后续胡牌不再加六张。</p>
              </section>
              <!-- 牌河保留被碰杠或胡过的记录；v-memo 的依赖包含认领与高亮，防止缓存旧外观。 / The river retains claimed records; v-memo dependencies include claims and highlights so cached appearance stays current. -->
              <div class="discard-area"
                ><div v-for="player in riverPlayers" :key="player.seat" class="discard-group"
                  :data-river-seat="player.seat"
                  ><div class="discard-label"
                    ><span>{{
                      player.seat === mySeat && me.isCurrentParticipant !== false
                        ? '我的牌河'
                        : `${seatLabel(player.seat)}的牌河`
                    }}</span
                    ><small>{{ discardsFor(player.seat).length }} 条记录</small></div
                  ><div class="discard-tiles"
                    ><template v-if="discardsFor(player.seat).length"
                      ><span
                        v-for="discard in discardsFor(player.seat)"
                        :key="discard.index"
                        v-memo="[
                          discard.tile,
                          discard.claimedBy,
                          discard.claimedAs,
                          discard.huSeats?.join(','),
                          discard.index === game.discards.length - 1,
                          winningDiscardIndices.has(discard.index),
                        ]"
                        class="discard-tile"
                        :data-discard-index="discard.index"
                        :class="{
                          'latest-discard': discard.index === game.discards.length - 1,
                          'winning-discard': winningDiscardIndices.has(discard.index),
                          'claimed-discard': discard.huSeats?.length,
                          'taken-discard': discard.claimedBy != null || discard.huSeats?.length,
                        }"
                        ><MahjongTile :tile="discard.tile" small /><span
                          v-if="discard.huSeats?.length"
                          class="hu-mark"
                          title="胡牌记录，和胡牌区对应同一张实体牌"
                          >胡</span
                        ><span
                          v-else-if="discard.claimedBy != null"
                          class="hu-mark"
                          title="已移入碰杠区，牌河仅保留记录"
                          >{{ discard.claimedAs === 'peng' ? '碰' : '杠' }}</span
                        ></span
                      ></template
                    ><span v-else class="empty-discard">尚未出牌</span></div
                  ></div
                ></div
              >
              <!-- 同桌下一局走 start 请求并保留房间账本；换桌则走离席和大厅路由。 / Another round uses start and preserves the table ledger; changing tables uses departure and lobby routing. -->
              <div v-if="phase === 'finished'" class="finished-banner"
                ><Icon name="trophy" :size="21" /><span>{{ finishText }}</span
                ><button
                  v-if="isHost"
                  class="button gold"
                  :disabled="!canStart || filledSeats < tablePlayerCount || busy || offline || syncing || !validStartOptions"
                  @click="mutate(null, true)"
                  >同桌再来一局<Icon name="arrow" :size="16" /></button
                ><span v-else>等待房主再开一局</span
                ><button class="button" @click="newTable">返回大厅换桌</button></div
              >
              <div v-else class="table-watermark">花间 <span>自贡花麻将</span></div>
            </div>

          <!-- 手牌留在桌面，主角在操作区下方独立占位；不把人物铺到牌或按钮背后。
               Keep cards on the table and give the character its own space below controls, never behind tiles or buttons. -->
          <div v-if="!isSpectator" class="own-player-area"
            :class="`character-${characterForPlayer(mySeat, true).id}`">
            <!-- 自己的座位也使用绝对角色分配；房主与庄家分别标记，二者并不等价。 / The viewer uses the same absolute character assignment; host and dealer badges represent distinct roles. -->

            <div class="own-character-label"
              >{{ characterForPlayer(mySeat, true).name }} · {{ characterForPlayer(mySeat, true).style
              }}<span>{{ phase === 'lobby' || me.isCurrentParticipant === false ? '落座角色，开局保持' : '本局角色，全桌一致' }}</span></div
            ><div class="own-seat-summary"
              ><div class="avatar" :class="`avatar-${mySeat}`"
                ><img
                  :src="characterForPlayer(mySeat, true).portrait"
                  :alt="characterForPlayer(mySeat, true).name" /></div
              ><div class="player-identity"
                ><div class="player-name"
                  >{{ me.name }}<span class="you-tag">我</span
                  ><span v-if="isHost" class="host-tag">房主</span
                  ><span
                    v-if="game && mySeat === (game.dealerSeat ?? 0)"
                    class="host-tag dealer-tag"
                    >庄</span
                  ></div
                ><span class="player-caption">{{
                  phase === 'lobby'
                    ? '你的专属位置已留好'
                    : me.isCurrentParticipant === false
                      ? '已落座，等待下一局'
                      : `已胡 ${me.huCount} 次 · ${me.handCount} 张手牌`
                }}</span></div
              ><span class="own-seat-status" v-if="phase === 'lobby'"
                ><Icon name="check" :size="16" />已落座</span
              ><span v-else class="player-score own-score" :class="{ negative: me.score < 0 }"
                >{{ scoreLabel(me.score) }}<small>分</small></span
              ></div
            >

          <!-- 只有本局参与者才显示私有手牌和动作，新落座的下一局玩家不能操作旧局。 / Only current-game participants see the private hand/actions; newly seated next-round players cannot act in the old round. -->
          <section
            v-if="!isSpectator && game && me.isCurrentParticipant !== false"
            class="hand-panel"
            aria-label="我的手牌与操作"
          >
            <div class="hand-info-row"
              ><div
                ><span class="section-kicker">手牌区</span
                ><span v-if="postHu" class="frozen-hand-pill">胡后固定</span
                ><span v-if="isMyTurn" class="my-turn-pill">轮到你了</span></div
              ><span class="hand-hint">{{ statusDetail }}</span></div
            >
            <div v-if="!isLegacy || me.melds.length || me.radishes.length" class="own-public-cards">
              <div v-if="!isLegacy" class="own-win-pile win-pile" aria-label="我的胡牌区"
                ><span class="public-zone-label"
                  >胡牌区 <b>{{ me.winPile.length }} 次</b></span
                ><div class="win-pile-tiles"
                  ><span
                    v-for="(win, winIndex) in me.winPile"
                    :key="winIndex"
                    class="win-pile-tile"
                    :class="{
                      'virtual-win': win.virtual,
                      'winning-tile': isWinningTile(mySeat, winIndex),
                    }"
                    :data-win-seat="mySeat"
                    :data-win-index="winIndex"
                    :title="winLabel(win)"
                    ><MahjongTile :tile="win.tile" :back="win.hidden" small /><span
                      v-if="win.virtual"
                      class="virtual-badge"
                      aria-label="共胡记牌，不另算实物牌"
                      >共胡</span
                    ></span
                  ><span v-if="!me.winPile.length" class="public-zone-empty"
                    >胡牌后放在这里</span
                  ></div
                ></div
              >
              <div class="own-meld-zone"
                ><span v-if="!isLegacy" class="public-zone-label">碰杠区</span
                ><span v-if="!isLegacy && !me.melds.length" class="public-zone-empty">还未碰杠</span
                ><div v-if="me.melds.length" class="meld-list"
                  ><div v-for="(meld, meldIndex) in me.melds" :key="meldIndex" class="meld"
                    ><div class="meld-tiles"
                      ><MahjongTile
                        v-for="(tile, tileIndex) in meld.tiles"
                        :key="tileIndex"
                        :tile="tile"
                        :back="tile == null"
                        small /></div
                    ><small>{{ meldLabel(meld) }}</small></div
                  ></div
                ></div
              ><div v-if="!isLatest && me.radishes.length" class="radish-row"
                ><span class="radish-label"
                  >我的萝卜 <b>共 {{ me.radishes.length }} 张</b
                  ><small v-if="!isLegacy && radishIncrement(mySeat)" class="radish-increment">{{
                    radishIncrementLabel(mySeat)
                  }}</small></span
                ><div class="radish-tiles"
                  ><MahjongTile
                    v-for="(tile, tileIndex) in me.radishes"
                    :key="tileIndex"
                    :tile="tile"
                    small /></div></div
            ></div>
            <!-- key 同时包含下标和牌种；点击仅选牌，disabled 同时检查胡后锁定、网络状态和服务端可出牌列表。 / Keys combine index and tile type; clicks only select, while disabled checks post-win locking, connectivity and server discard options. -->
            <div class="hand-scroll character-hand-table"
              ><div class="my-hand"
                ><MahjongTile
                  v-for="(tile, tileIndex) in hand"
                  :key="`${tileIndex}-${tile}`"
                  :tile="tile"
                  interactive
                  :selected="selectedHandIndex === tileIndex && selectedTile === tile"
                  :class="{ 'drawn-tile': game.drawnTile != null && tileIndex === hand.length - 1 }"
                  :disabled="
                    postHu ||
                    busy ||
                    offline ||
                    syncing ||
                    !discardOptions.some((action) => action.tile === tile)
                  "
                  @click="selectHand(tile, tileIndex)" /></div
            ></div>
            <!-- 听牌信息来自私有快照；动作按钮提交完整服务端动作，出牌按钮才构造选中的 discard。 / Wait tiles come from the private snapshot; action buttons submit server actions, while discard constructs the selected discard request. -->
            <div class="hand-bottom-row"
              ><div class="waits-info"
                ><template v-if="game.waitTiles?.length"
                  ><span class="wait-label">听牌</span
                  ><span>{{ game.waitTiles.map(tileLabel).join('、') }}</span></template
                ><span v-else class="muted-hand-caption">条筒之间，下一张也许正好。</span
                ><span
                  v-if="!isLatest && (me.huLockActive || game.huLockActive)"
                  class="locked-waits"
                  :title="`原听口：${(game.lockedWaits || []).map(tileLabel).join('、')}`"
                  >本轮再胡需换尽原听口</span
                ></div
              ><div class="action-row"
                ><button
                  v-for="(action, actionIndex) in gangActions"
                  :key="`gang-${actionIndex}`"
                  class="button action-button secondary"
                  :disabled="busy || offline || syncing"
                  @click="mutate(action)"
                  >{{ actionLabel(action) }}</button
                ><button
                  v-for="(action, actionIndex) in primaryActions"
                  :key="`${action.type}-${actionIndex}`"
                  class="button action-button"
                  :class="{
                    'hu-button': action.type === 'hu',
                    primary: ['draw', 'peng', 'mingGang'].includes(action.type),
                    secondary: action.type === 'pass',
                  }"
                  :disabled="busy || offline || syncing"
                  @click="mutate(action)"
                  ><Icon v-if="action.type === 'draw'" name="plus" :size="17" /><Icon
                    v-if="action.type === 'hu'"
                    name="sparkle"
                    :size="17"
                  />{{ actionLabel(action) }}</button
                ><button
                  v-if="discardOptions.length && !postHu"
                  class="button action-button primary discard-button"
                  :disabled="!canDiscard || busy || offline || syncing"
                  @click="mutate({ type: 'discard', tile: selectedTile })"
                  >{{ canDiscard ? `打出 ${tileLabel(selectedTile)}` : '选牌后打出'
                  }}<Icon name="arrow" :size="17" /></button
                ><span v-if="busy" class="action-working"><span class="spinner"></span>同步中</span
                ><span
                  v-else-if="!legalActions.length && phase !== 'finished'"
                  class="waiting-action"
                  ><Icon name="clock" :size="15" />等待牌友</span
                ></div
              ></div
            >
            <p v-if="game.specialHuPattern?.kind === 'sevenPairs'" class="special-hand-note"
              >{{ game.specialHuPattern.pureSuit ? '清七对' : '七对' }}特殊听牌 · 固定
              {{ game.specialHuPattern.fixedFan }}
              番，含初次牌型加番，后续不随胡牌区增加；萝卜另算。</p
            >
            <p v-else-if="game.specialHuPattern?.kind === 'bigSingle'" class="special-hand-note"
              >大单吊特殊听牌 · 原单张与碰杠区牌种均可胡，正常累计加番与萝卜。</p
            >
            <!-- 原生 details 提供可展开诊断；服务端只把本人的胡牌原因发给本人。 / Native details provides expandable diagnostics; the server sends win diagnostics only to their owner. -->
            <details v-if="huDiagnostic" class="hu-diagnostic"
              ><summary
                ><Icon name="info" :size="13" />{{
                  huDiagnostic.canHu ? '当前可以胡牌' : '查看当前胡牌判断'
                }}<span>仅自己可见</span></summary
              ><p>{{ huDiagnostic.message }}</p
              ><small v-if="huDiagnostic.tile != null"
                >判断牌：{{ tileLabel(huDiagnostic.tile)
                }}<template v-if="huDiagnostic.waitTiles?.length">
                  · 当前听口：{{ huDiagnostic.waitTiles.map(tileLabel).join('、') }}</template
                ></small
              ></details
            >
            <div v-if="!isLegacy && lastOwnScore" class="own-score-detail"
              ><span>上次胡牌结算</span
              ><strong>{{ scoreSummary(lastOwnScore, lastOwnHu?.payments) }}</strong
              ><small v-if="lastOwnScore.copyFanBonus"
                >其中三牌区同牌加 {{ lastOwnScore.copyFanBonus }} 番</small
              ></div
            >
          </section>
          <!-- 独立普通流画框自然排在手牌后；保留原图比例及表情，图像不承载交互或私有数据。
               This normal-flow frame follows the hand, preserving source proportions/reactions without carrying input or private data. -->
          <figure v-if="game" class="own-character-display" aria-label="你的角色立绘">
            <div class="own-character-art"><CharacterArtwork class="own-character-scene"
              :character="characterForPlayer(mySeat, true)" /></div>
            <figcaption>{{ characterForPlayer(mySeat, true).name }}<span>{{ characterForPlayer(mySeat, true).style }}</span></figcaption>
          </figure>
          </div>
          </div>
          <p class="table-footnote"
            ><Icon name="shield" :size="13" />只与朋友切磋牌技，所有得分均为虚拟积分。<button
              @click="showRules = true"
              >查看原型规则</button
            ></p
          >
        </section>

        <!-- 侧栏只展示服务端积分与公开事件；历史文字不触发计分。 / The sidebar displays server scores and public events; historical text never triggers scoring. -->
        <aside class="room-sidebar">
          <section v-if="phase === 'lobby'" class="sidebar-card invite-card"
            ><div class="sidebar-title"
              ><span class="sidebar-icon"><Icon name="users" :size="19" /></span
              ><h2>好朋友，坐一桌</h2></div
            ><p>把链接发给朋友，<br />他们输入名字就能落座。</p
            ><div class="invite-code"
              ><span>本桌房间号</span><strong>{{ state.id }}</strong></div
            ><button class="button primary" @click="copyInvite"
              ><Icon :name="copyDone ? 'check' : 'copy'" :size="16" />{{
                copyDone ? '邀请链接已复制' : '复制邀请链接'
              }}</button
            ><span class="quiet-note">每位朋友请使用自己的浏览器或设备</span></section
          >
          <section v-else class="sidebar-card score-card"
            ><div class="sidebar-title"
              ><Icon name="trophy" :size="18" /><h2>{{
                phase === 'finished' ? '上一局结算' : '本局积分'
              }}</h2
              ><span class="subtle-label">虚拟分</span></div
            ><div class="score-list"
              ><div
                v-for="player in scoreSeats"
                :key="player.seat"
                class="score-line"
                :class="{
                  'score-line-me': player.seat === mySeat && me.isCurrentParticipant !== false,
                }"
                ><span class="score-avatar" :class="`avatar-${player.seat}`">{{
                  initials(player)
                }}</span
                ><span
                  >{{ player.name
                  }}<small v-if="player.seat === mySeat && me.isCurrentParticipant !== false"
                    >我</small
                  ></span
                ><strong
                  :class="{
                    'positive-score': player.score > 0,
                    'negative-score': player.score < 0,
                  }"
                  >{{ scoreLabel(player.score) }}</strong
                ></div
              ></div
            ><div class="score-footnote">每次结算自动同步 · 分数总和为 0</div
            ><p v-if="isLatest" class="dragon-settlement-note">{{
              game?.dragonSettlement?.settled
                ? '局末神龙已结算，本局只结一次。'
                : '神龙仅在局末结算，不加入每次胡牌分。'
            }}</p
            ><details
              v-if="
                isLatest && game?.dragonSettlement?.settled && game.dragonSettlement.entries?.length
              "
              class="dragon-settlement-details"
              ><summary>局末神龙明细</summary
              ><ul
                ><li v-for="(entry, index) in game.dragonSettlement.entries" :key="index"
                  ><strong>{{ seatLabel(entry.seat) }}</strong
                  ><span>{{ dragonSummary(entry) }}</span
                  ><span v-if="entry.payments?.length">{{ paymentSummary(entry) }}</span></li
                ></ul
              ></details
            ></section
          >
          <!-- 本桌总分按参与身份而非座位合并，因此 key 用 player.id，离桌者也保留一行。 / Table totals follow participant identity rather than seat, so keys use player.id and departed players keep a row. -->
          <section
            v-if="tableScoreRows.length"
            class="sidebar-card table-total-card"
            aria-labelledby="table-total-title"
          >
            <div class="sidebar-title"
              ><Icon name="trophy" :size="18" /><h2 id="table-total-title">本桌总积分</h2
              ><span class="subtle-label">含本局</span></div
            >
            <div class="score-list"
              ><div
                v-for="player in tableScoreRows"
                :key="player.id"
                class="table-total-line"
                :class="{ 'score-line-me': player.seat === mySeat }"
                ><div
                  ><span
                    >{{ player.name
                    }}<small>{{
                      player.seat === mySeat ? ' · 我' : player.detached ? ' · 已离桌' : ''
                    }}</small></span
                  ><small
                    >已结算 {{ scoreLabel(player.settledScore)
                    }}<template v-if="phase === 'playing' && player.seat != null">
                      · 本局暂记 {{ scoreLabel(player.provisionalScore) }}</template
                    ></small
                  ></div
                ><strong
                  :class="{
                    'positive-score': player.totalScore > 0,
                    'negative-score': player.totalScore < 0,
                  }"
                  >{{ scoreLabel(player.totalScore) }}</strong
                ></div
              ></div
            >
            <p class="score-footnote"
              >同桌再开、刷新、重连不清零。已离桌者保留旧账，新落座者从 0
              开始；个人跨桌总积分见大厅。</p
            >
          </section>
          <!-- 喜钱与杠分用事件类型区分标签，不把听牌结算说成杠分。 / Distinguish ready bonuses from kong payments by event type. -->
          <!-- 历史倒序显示但 key 还原原始下标；v-memo 在条目或规则展示版本变化时才更新。 / History displays newest first but keys reconstruct original indices; v-memo refreshes when the entry or display-rule version changes. -->
          <section v-if="game" class="sidebar-card history-card"
            ><div class="sidebar-title"
              ><Icon name="clock" :size="18" /><h2>牌局动态</h2><span class="live-dot"></span></div
            ><ol class="history-list" aria-label="牌局操作记录"
              ><li
                v-for="(entry, historyIndex) in history"
                :key="`${game.id || 'legacy'}-${history.length - historyIndex - 1}`"
                v-memo="[entry, isLatest]"
                :class="{ 'history-hu': entry.type === 'hu' }"
                ><span class="history-dot"></span
                ><div
                  ><span v-if="entry.type === 'hu'" class="history-badge">好牌 · 胡了</span
                  ><p>{{ entry.message }}</p
                  ><small v-if="entry.type === 'hu' && entry.score">{{
                    scoreSummary(entry.score, entry.payments)
                  }}</small
                  ><small
                    v-if="
                      entry.payments?.length &&
                      entry.type !== 'hu' &&
                      entry.type !== 'dragonSettlement'
                    "
                    class="kong-payment"
                    >{{ entry.type === 'bigSingleReady' ? '听牌喜钱' : '即时杠分' }}：{{
                      paymentSummary(entry)
                    }}</small
                  ><template v-if="entry.type === 'dragonSettlement'"
                    ><small class="dragon-settlement-label">局末神龙 · 本局结算一次</small
                    ><small v-if="entry.dragons?.length" class="dragon-breakdown">{{
                      dragonSummary(entry)
                    }}</small
                    ><small v-if="entry.payments?.length" class="dragon-payment">{{
                      paymentSummary(entry)
                    }}</small></template
                  ><small v-if="entry.newRadishes?.length" class="history-radishes"
                    >{{ isLatest ? '共享池新增' : '本次新增' }}
                    {{ entry.newRadishes.length }} 张萝卜</small
                  ><small v-else-if="entry.radish != null" class="history-radishes"
                    >{{ isLatest ? '共享池新增' : '本次新增' }} 1 张萝卜 ·
                    {{ tileLabel(entry.radish) }}</small
                  ></div
                ></li
              ><li v-if="!history.length" class="history-empty">牌局的第一笔，等你来写。</li></ol
            ></section
          >
          <section v-if="!isChengduRoom" class="sidebar-card rules-card"
            ><div class="sidebar-title"
              ><Icon name="book" :size="18" /><h2>自贡的花样</h2
              ><span class="version-tag">原型</span></div
            ><div class="rule-snippets"
              ><div
                ><span class="rule-number">01</span
                ><div
                  ><strong>{{ tablePlayerCount }}人同桌，{{ tableDeckCount }}副条筒</strong><p>没有万字，每种条筒各{{ tableCopies }}张。</p></div
                ></div
              ><div
                ><span class="rule-number">02</span
                ><div
                  ><strong>{{ isLegacy ? '胡不离桌，好牌继续' : '自动摸牌，胡后固定' }}</strong
                  ><p>{{
                    isLegacy ? '本桌沿用开局时的旧规则。' : '胡后不换手牌，全员都胡即结束。'
                  }}</p></div
                ></div
              ><div
                ><span class="rule-number">03</span
                ><div
                  ><strong>{{ isLatest ? '全桌萝卜，共享一池' : '翻个萝卜，添点花样' }}</strong
                  ><p>{{
                    isLatest ? '每杠添一张，全桌首胡添六张。' : '每杠立即翻一张，各家首胡加六张。'
                  }}</p></div
                ></div
              ></div
            ><button class="rules-more" @click="showRules = true"
              >完整玩法与待核对规则<Icon name="arrow" :size="16" /></button
          ></section>
        </aside>
      </div>
    </main>

    <!-- 模态层只在点击遮罩本身时关闭（.self）；对话框内点击不会冒泡触发关闭。 / The modal closes only when the backdrop itself is clicked (.self), not when dialog content bubbles a click. -->
    <div
      v-if="showRules || showInvite"
      class="modal-backdrop"
      @click.self="
        showRules = false;
        showInvite = false;
      "
    >
      <section
        ref="modalRef"
        class="modal"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="showRules ? 'rules-title' : 'invite-title'"
      >
        <button
          class="icon-button modal-close"
          aria-label="关闭弹窗"
          @click="
            showRules = false;
            showInvite = false;
          "
          ><Icon name="close" :size="21"
        /></button>
        <!-- 规则说明按本局版本分支展示；此处是文字说明，真正计分与合法动作在服务端。 / Rules text follows the current game version; scoring and legal actions are implemented on the server. -->
        <template v-if="showRules && isChengduContext">
          <span class="eyebrow">成都麻将 · 四人牌桌</span>
          <h2 id="rules-title">本桌成都玩法</h2>
          <div class="rules-modal-body">
            <section><h3>固定四人，必须定缺</h3><p>使用万、条、筒各一至九，每种四张，共108张。角色与观战沿用现有房间能力。</p></section>
            <section><h3>建房时选择</h3><p>首胡结束或血战到底、是否换三张、自摸加底或加番、4/5/6番封顶。选项在建房时保存，加入者不能改写。</p></section>
            <section><h3>准备与行牌</h3><p>开启换三张的局按顺时针、对家、逆时针循环，从顺时针开始；须选择同一花色三张。四家都定缺后开始逆时针摸打，必须先打缺门牌，不可吃牌。碰后先出一张，再能暗杠或补杠。</p></section>
            <section><h3>胡牌与结束</h3><p>支持一炮多响。胡过即退出本局；单人胡后由胡家下家摸，一炮多响由炮家摸。首胡模式处理完同一张牌的所有胡牌后结束，血战模式三家胡后结束。无人胡流局也查花猪、查叫、退杠。</p></section>
            <section><h3>虚拟积分</h3><p>平胡1番，对对胡2番，七对、金钩钓、清一色3番；清一色叠加其他牌型加2番，每根加1番。4/5/6番封顶分别为8/16/32分。自摸加底在封顶后加1分，加番在封顶前加1番。暗杠每家2分、补杠每家1分、直杠向放杠者收2分。暗手不公开。</p></section>
          </div>
          <button class="button primary modal-confirm" @click="showRules = false">了解，返回牌桌</button>
        </template>
        <template v-else-if="showRules"
          ><span class="eyebrow">先玩一局，再把细节磨好</span
          ><h2 id="rules-title">自贡花麻将 · 玩法说明</h2
          ><div class="rules-provisional"
            ><Icon name="info" :size="19" /><p>{{
              isOlderGame
                ? '本桌保留开局时的旧规则，原局不会因更新被改写。'
                : '已按这桌的反馈调整。以下标明的特殊计分仍待核对，不代表自贡各地统一打法。'
            }}</p></div
          ><div v-if="isLegacy" class="rules-modal-body"
            ><section class="legacy-rule-note"
              ><h3>本桌旧规则</h3
              ><p
                >这张桌已按旧规则开局，仍需手动摸牌，且不套用新版胡后固定与三家胡完结束。另开新桌即可使用新版。</p
              ></section
            ><section
              ><h3><span>一</span>一张桌，三位牌友</h3
              ><p
                >只用 1–9 条、1–9 筒，每种牌八张，共 144
                张。三人落座后由房主开局。自己的手牌只有自己可见；牌河、萝卜、已亮副露和积分公开。</p
              ></section
            ><section
              ><h3><span>二</span>胡了不停，继续下一手</h3
              ><p
                >首次胡牌可自摸或接炮。胡过后不离桌，胡牌后由自己继续摸牌。当前这轮的连续摸牌与杠后补牌，若仍有原听口未变，不能再次胡牌；原听口全部改变可以提前再胡。轮转一圈后，下次正常摸牌会解除这个限制。</p
              ><p
                >已经胡过的玩家，打出的普通弃牌不能被别人胡；但他杠后打出的那一张牌，其他人可以胡，按自摸方式结算。</p
              ></section
            ><section
              ><h3><span>三</span>萝卜与神龙</h3
              ><p
                >第一次胡牌翻六张萝卜，明杠、暗杠与补杠各从牌墙尾部再翻一张。萝卜与手牌同牌加分；例如手里两张二筒，萝卜也有两张二筒，加四分。</p
              ><p
                >手牌连同萝卜，同一种牌有六张为神龙，加 10 分；七张加 20 分；八张及以上当前按 40
                分计算。</p
              ></section
            ><section class="pending-rules"
              ><h3><span>!</span>当前原型的暂定处理</h3
              ><p
                >基础胡牌 1
                分；自摸由另外两家分别支付，普通接炮由放炮者支付。基础胡型采用四组顺子或刻子加一对，也支持七对。神龙计入已亮副露，同牌最多按
                40 分计算。具体细节以牌局服务端校验为准，下一轮一起核对。</p
              ><p
                >没有倒计时、自动托管或机器人。带本桌房间号的页面刷新可重连原座位，主页只进入大厅；房间连续七天没有操作后会过期。关闭当前标签页会丢失该标签页的座位凭证，请保留页面直至牌局结束。</p
              ></section
            ></div
          ><div v-else-if="!isLatest" class="rules-modal-body"
            ><section class="legacy-rule-note"
              ><h3>本桌旧规则 · v0.3.1</h3
              ><p
                >本局仍按各家的个人萝卜、胡后听口限制与逐次胡牌神龙分结算，不套用 v0.4.0
                的共享萝卜和局末神龙。以下说明仅适用于本局。</p
              ></section
            >
            <section
              ><h3><span>一</span>自动摸牌，胡后固定手牌</h3
              ><p
                >三人，只用条、筒各 1–9，每种八张，共 144
                张。轮到你自动发牌；未胡时选牌打出。胡过后不再换打原手牌，只能胡新牌、合法杠，或过并打出新牌。没有胡、杠可选时自动摸打。</p
              ><p
                >可胡时先选择胡或过，不同时开放杠。别人出牌时，胡优先于明杠，明杠优先于碰。三家都至少胡过一次，或牌墙摸完，本局结束。</p
              ></section
            >
            <section
              ><h3><span>二</span>普通加番，按三个牌区计算</h3
              ><p
                >自己的手牌区、碰杠区、胡牌区合计：同种牌恰好四张加 1 番，恰好五张加 2
                番。没有加番时为 1
                番。胡牌区每胡一次添一张；一炮多响的共胡牌带“共胡”标记，是记牌，不增加实体牌总量。</p
              ><p class="fan-scale"
                >1 番 1 分 · 2 番 2 分 · 3 番 4 分 · 4 番 8 分<br />5 番 10 分 · 6 番 12 分 · 7 番
                14 分，之后每番加 2 分。</p
              ></section
            >
            <section
              ><h3><span>三</span>萝卜累计，杠分即时结算</h3
              ><p
                >每次合法杠立即翻 1 张自己的萝卜；第一次胡牌再加 6
                张，之前的萝卜保留。每次胡牌都重新算番分与自己的萝卜匹配分；萝卜默认匹配本次成胡手牌和碰杠牌，不把此前胡牌重复加入。同牌数量相乘，例如自己的计分牌有两张二筒、萝卜有两张二筒，加
                4 分。</p
              ><p
                >明杠由出牌者付 2 分；暗杠另两家各付 2 分；碰后补杠另两家各付 1
                分；四张杠再加第五张，另两家各付 1
                分。杠分立即结算，独立于之后的胡牌分。胡后杠必须保持原听口。</p
              ></section
            >
            <section
              ><h3><span>四</span>胡牌、听口与付款方</h3
              ><p
                >基础胡型为四组顺子或刻子加一对，也支持七对。普通自摸由另两家各付，普通接炮由出牌方付。胡后连续补摸及杠后补摸，原听口还有重合时不能再胡；全部换口可提前再胡，正常轮转后解除限制。</p
              ><p
                >胡过的人普通出牌不能被接胡；杠后打出的那张仍可接胡，按自摸付款。当前是否可胡及原因，在自己的手牌区可查看，不会公开给牌友。</p
              ></section
            >
            <section class="pending-rules"
              ><h3><span>!</span>仍需一起核对的细节</h3
              ><p
                >大单钓：胡牌前手里只剩一张牌，当前按另两家各付 50
                分，暂不叠加番分、萝卜和神龙。三牌区同种牌六张及以上如何加番尚未确认，当前不额外加同牌番。</p
              ><p
                >沿用的神龙暂定：本次成胡手牌、碰杠牌连同自己的萝卜（不含此前胡牌），同牌六张加 10
                分、七张加 20 分、八张及以上加 40
                分，普通胡牌时另计。以上未定细节不是自贡统一标准，以本桌服务端显示的结算为准。</p
              ><p
                >只有出牌、碰、胡、杠会播放角色语音，可在右上角关闭。自摸、放炮、抢杠各播对应的一条语音，不再追加“胡”。无机器人、无倒计时。正常选牌不会自动代打。带本桌房间号的页面刷新可重连原座位，主页只进入大厅。离桌不清除已有积分记录，也不会自动删除旧桌。只使用虚拟积分。</p
              ></section
            > </div
          ><div v-else class="rules-modal-body latest-rules">
            <section
              ><h3><span>一</span>自动摸牌，胡后可以连续自摸</h3
              ><p
                >{{ tablePlayerCount }}人，只用条、筒各 1–9，每种{{ tableCopies }}张，共{{ tableDeckCount * 72 }}张。首局一号位坐庄，同桌下一局由上一局第一个胡牌的人坐庄并先出牌，房主开局权限不变。未胡时选牌打出；胡后原手牌固定，仍可连续自摸和合法暗杠、补杠、逐张加杠至本局同牌上限，不必等一圈或换尽原听口。已经胡过的玩家能胡就必须胡，只有“胡牌”选项，包括自摸、接炮和抢杠，仍须本人点击确认。<template v-if="!inRoom || hasFixedAutoDiscard">“胡后自动打出”在创建牌桌前选择（默认勾选），创建后同桌每局沿用；</template><template v-else>房主可在每局开局前选择“胡后自动打出”（默认勾选）；</template>没有胡、杠可选时，勾选则自动打出新牌，不勾选则需点“过”才能过回合，局中不能更改。已胡且不能胡这张新牌时，有合法杠必须杠，不能跳过或打出新牌；胡后杠仍须保持原听口。</p
              ><p
                ><template v-if="preHuActionChoice">首次胡牌前，自己摸牌同时可胡又可杠时，可自行选择胡或合法杠，也可出牌；已胡者能胡时只能胡。</template
                ><template v-else>自己摸牌同时可胡又可杠时，不提供杠；未胡者仍可放弃胡并出牌，已胡者只能胡。</template
                >所有玩家都至少胡过一次，或牌墙摸完，本局结束。</p
              ></section
            >
            <section
              ><h3><span>二</span>接牌时，按实际选择回应</h3
              ><p
                ><template v-if="preHuActionChoice">尚未胡过时，对可接的弃牌，胡、碰、明杠及过均按实际合法动作保留，可自行选择。</template
                ><template v-else>未胡玩家打出的牌，若你尚未胡过，可胡也可碰、但不可明杠时，可选择胡、碰或过；可胡又可明杠时，只提供胡或过。</template
                >你已胡过且本张可胡时，只提供胡。多人回应时，胡优先于明杠，明杠优先于碰。同级按{{
                  counterclockwise ? '逆时针' : '本局原顺时针'
                }}顺序决定，和点击先后无关。</p
              ><p
                >已经胡过的人打出的牌，别人不能碰或明杠。普通弃牌也不能接胡；只有杠后打出的那张可以接胡，仅由实际出牌者付款，不按自摸结算。自己已经胡过不限制接炮：未胡者正常打出听牌时，可以再次胡，不必等自己下一次正常摸牌。</p
              ></section
            >
            <section class="rob-kong-rules"
              ><h3><span>抢</span>补杠先等抢杠</h3
              ><p v-if="pungUpgradeAfterDiscard"
                >刚碰完、还没有打出一张牌时不能补杠；先打出一张，之后轮到自己且符合其他合法条件时，可以用原先留在手里的同牌或后来摸到的同牌补杠，不要求刚摸到同牌。暗杠后的补摸不能代替这次出牌。已成立的明杠或暗杠仍可逐张加到第五张，直到本局同牌上限。</p
              ><p v-if="concealedKongAfterPungDiscard"
                >本局碰后必须先实际打出一张牌，才能在后续合法窗口暗杠；碰后当前回合不能立即暗杠。</p
              ><p
                >补杠、已有杠再加一张，都先给别人抢杠胡的机会。未胡者可胡或过，已胡者可胡就只能胡，不能碰或杠。无人抢胡才形成杠、收杠分、翻萝卜并补摸；有人抢胡则不形成这次杠，胡牌仅由追加牌的杠牌者付款，普通抢杠加
                1 番；七对抢杠不加番，萝卜仍计算。</p
              ><p
                >加牌的玩家还没胡过，第一手即可被抢；已经胡过者的普通摸牌加杠不能被抢，但杠后补摸再加杠，别人无论胡过与否都可按合法听牌抢胡。补杠与加杠均沿用这个来源判断。</p
              ></section
            ><section v-if="usesSpecialPatterns" class="special-pattern-rules"
              ><p v-if="!game || gameBigSingleReadyEnabled"
                >大单吊听牌：四组碰杠完成、出牌后只剩一张手牌并能听牌时，立即结算喜钱，<template
                  v-if="!game && hasFixedReadyPoints"
                  >本桌创建时确定为每家 {{ state.settings.bigSingleReadyPoints }} 分{{ state.settings.bigSingleReadyPoints === 0 ? '，不收取' : '' }}，同桌每局沿用</template
                ><template v-else-if="!inRoom">创建牌桌前填写每家支付的分数，默认 50 分，0 分不收取，创建后同桌每局沿用</template
                ><template v-else-if="!game">房主在每局开局前填写每家支付的分数，默认 50 分，0 分不收取</template
                ><template v-else-if="gameBigSingleReadyPoints === 0">本局为 0 分，不收取</template
                ><template v-else>本局其他玩家各付 {{ gameBigSingleReadyPoints }} 分</template
                >，每人每局只结算一次；第四组杠成立时在补摸前结算。后续胡牌、杠分、萝卜与神龙另算。</p
              ><p v-else
                >本局保留原计分，不补收听牌分；下一局房主可在开局前填写大单吊喜钱，默认每家 50 分，0
                分不收取，每人每局一次，胡牌分另算。</p
              ><h3><span>特</span>七对、大单吊与牌型加番</h3
              ><p
                >七对首次胡后，初次完整牌型里的每一种牌都可作为后续听牌：普通七对听七种；一组四张听六种；两组四张或一组六张听五种。首次七对以
                3 番为基础，每组四张及以上另加“张数 − 3”番；清一色再加 2 番，普通清七对就是 5 番 10
                分。后续胡牌固定在这个总档位（保留已有清一色番），不因胡牌区积累再加番，萝卜仍每次重新计算。</p
              ><p
                >大单吊先胡一次后，原单张和自己的碰杠区牌种均可胡。同种牌可以碰两次，算两组独立碰牌。大单吊或对对胡各加
                2 番，两者不重复计算；清一色另加 2 番。大单吊胡牌按番分、同牌加番与萝卜计算。</p
              ></section
            ><section
              ><h3><span>三</span>普通加番，按三个牌区计算</h3
              ><p
                >自己的手牌区、碰杠区、胡牌区合计：同种牌恰好四张加 1 番，五张加 2 番，六张加 3
                番，七张加 4 番，八张加 5 番。基础为 1 番，例如六张同牌加到 4
                番。<template v-if="extendedCopyFan">四张起每增加一张再加一番，九张加六番，之后同样递增。</template><template v-else>本局保留旧同牌加番，八张以上不额外增加该项；下一局启用每张一番。</template></p
              ><p>胡牌区每胡一次添一张；一炮多响的“共胡”只作本人的计分记录，不增加实体牌总量。</p
              ><p class="fan-scale"
                >1 番 1 分 · 2 番 2 分 · 3 番 4 分 · 4 番 8 分<br />5 番 10 分 · 6 番 12 分 · 7 番
                14 分，之后每番加 2 分。</p
              ></section
            >
            <section
              ><h3><span>四</span>全桌萝卜，共享一池</h3
              ><p
                >萝卜从全桌第一次胡牌才开始翻：首胡翻 6 张，加上首胡前每次成功杠累计的 1
                张。首胡前只记次数，不提前翻牌；首胡后每次成功杠再翻 1
                张。被抢的补杠不算成功杠。已翻萝卜全部保留，全桌共用，牌墙不足只翻余下的牌。</p
              ><p
                >每次胡牌重新计算番分与共享萝卜匹配分。同牌数量相乘，例如计分牌有两张二筒，共享萝卜有两张二筒，加
                4 分。<template v-if="game?.rules?.radishCountsWinPile === false"
                  >本局保留开局时 v0.4.0 的萝卜规则，不计历史胡牌区；下一局使用修正规则。</template
                ><template v-else
                  >自己的胡牌区（含共胡）、碰杠区、手牌区全部参与匹配，本次胡牌只算一次。例如七筒 2
                  张×萝卜 1 张，加四筒 1 张×萝卜 2 张，共 4 分。</template
                ></p
              ></section
            >
            <section
              ><h3><span>五</span>即时杠分与胡牌付款</h3
              ><p
                >明杠由出牌者付 2 分；暗杠其他玩家各付 2
                分；补杠，以及逐张加到第五张，直到本局同牌上限，其他玩家每次各付 1 分，每次计 1 张萝卜并补 1
                张牌，首胡前的萝卜留到首胡一起翻。杠分立即结算。</p
              ><p
                ><template v-if="game?.rules?.selfDrawOnlyUnwon === undefined && game"
                  >本局保留开局时的自摸付款规则；下一局使用修正规则。</template
                ><template v-else
                  >普通摸牌或胡后续摸自摸，只由本次胡之前还未胡的其他玩家付款，已经胡过的不付。<template
                    v-if="game && !game.rules?.finalHuPaymentExceptions"
                    >本局保留开局时的终局付款规则。</template
                  ><template v-else
                    >但最后一家首胡结束牌局时特殊：普通自摸仍由其他玩家各付（明杠后补摸另按下述规则）；接已经胡过者的杠后弃牌，只由出牌者付。多人同次胡先全部处理再结束，终局例外只用于本次首次胡的赢家。</template
                  ></template
                >接别人弃牌明杠后，本次补摸胡只由该明杠的出牌者付款；自己摸来的暗杠、补杠、加杠后补摸胡才由其他玩家付款。杠后打出的牌被胡，仍只由该张牌的出牌者付款。即时杠分和局末神龙独立结算。每次操作记录显示实际付款方。<template
                  v-if="usesSpecialPatterns"
                  >大单吊改为加 2 番，与对对胡不重复计；清一色可另加 2
                  番，萝卜仍另算。局末神龙独立结算。</template
                ><template v-else
                  >本桌保留旧大单钓：每个付款方 50
                  分，本次不叠加番分和萝卜；局末神龙独立结算。下一局使用新牌型规则。</template
                ></p
              ></section
            >
            <section
              ><h3><span>六</span>神龙留到局末，只结一次</h3
              ><p
                >本人的手牌区、碰杠区、胡牌区，加上全桌共享萝卜：<template v-if="exponentialDragon">同牌{{ tableDragonStartCount }}张起10分，每多一张翻倍（10、20、40、80……）。</template><template v-else>本局保留旧神龙：六张10分、七张20分、八张及以上40分封顶。</template>神龙不再加入每次胡牌分，而在本局结束时单独结算一次，记录与即时杠分分开展示。</p
              ><p
                >普通加番只计算自己的三个牌区，不含萝卜；萝卜匹配分另算。神龙才合并全桌共享萝卜计数，由其他玩家各付。多种神龙相加，流局及未胡者也参与，暂按这些方式处理，资格细节仍待核对。</p
              ></section
            >
            <section class="pending-rules"
              ><h3><span>!</span>未确认的边界会明确保留</h3
              ><p
                >本桌遵循开局时保存的规则；旧局不改账，下一局才启用新规则。不同地方的打法可能不同，请以本桌显示的实际结算为准。</p
              ><p
                >只有出牌、碰、胡、杠会播放角色语音，可在右上角关闭。自摸、放炮、抢杠各播对应的一条语音，不再追加“胡”。无机器人、无倒计时。正常选牌不会自动代打。带本桌房间号的页面刷新可重连原座位，主页只进入大厅。离桌不会清除积分记录。只使用虚拟积分。</p
              ></section
            > </div
          ><button class="button primary modal-confirm" @click="showRules = false"
            >明白了，坐下玩一局</button
          ></template
        >
        <template v-else
          ><span class="eyebrow">好朋友，坐一桌</span><h2 id="invite-title">复制牌桌邀请</h2
          ><p class="invite-modal-note"
            >浏览器未允许自动复制，请选中下方链接并复制，发给其他 {{ tablePlayerCount - 1 }} 位朋友。</p
          ><label class="field-label" for="invite-link">房间 {{ state.id }}</label
          ><input
            id="invite-link"
            ref="inviteInput"
            :value="shareUrl"
            readonly
            @focus="$event.target.select()"
          /><button class="button primary modal-confirm" @click="showInvite = false"
            >完成</button
          ></template
        >
      </section>
    </div>
  </div>
</template>
