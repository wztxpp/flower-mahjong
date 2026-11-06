// HTTP 接口：验证输入和身份 → 复制房间 → 修改 → 原子保存 → 返回私人视图。
// HTTP API: validate input/identity → clone room → mutate → atomically save → return a private view.
import {
  createGame,
  dealerForNextGame,
  applyAction,
  applyPresentedAction,
  continuePresentedGame,
  getPlayerView,
} from '../shared/game.js';
import { isBigSingleReadyPoints, MAX_BIG_SINGLE_READY_POINTS } from '../shared/start-options.js';
import { applyAction as applyV2Action, getPlayerView as getV2View } from '../shared/v2-game.js';
import {
  applyAction as applyLegacyAction,
  getPlayerView as getLegacyView,
} from '../shared/legacy-game.js';
import {
  ensureGameMetadata,
  newGameMetadata,
  archiveFinishedGame,
  recordsForProfile,
  tableScores,
} from './history.js';
import {
  assignCharacters,
  gameCharacters,
  isCharacterId,
  preferredCharacter,
} from '../shared/character-assignment.js';
// 根据该局保存的版本选引擎；旧局绝不在重连时偷偷升级。
// Choose the engine from the saved game version; reconnecting never upgrades an existing game.
function engineFor(game) {
  if (game.schemaVersion === 3)
    return {
      apply: applyAction,
      view: getPlayerView,
    };
  if (game.schemaVersion === 2)
    return {
      apply: applyV2Action,
      view: getV2View,
    };
  if (game.schemaVersion === undefined || game.schemaVersion === 1)
    return {
      apply: applyLegacyAction,
      view: getLegacyView,
    };
  fail(409, 'UNSUPPORTED_GAME_VERSION', '这桌使用了更新的规则版本，请刷新页面后重试');
}
// 可预期的业务错误同时携带 HTTP 状态、机器错误码和给玩家看的提示。
// Expected API errors carry an HTTP status, machine code, and player-facing message.
export class ApiError extends Error {
  // 保留标准 Error.message，再补上接口需要的字段。
  // Preserve Error.message and add the API-specific fields.
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
// 统一抛出业务错误，由最外层请求处理器转成 JSON。
// Throw an API error for the outer request handler to serialize.
const fail = (status, code, message) => {
  throw new ApiError(status, code, message);
};
// 禁止缓存私人响应；拒绝 MIME 猜测，并避免通过 Referer 泄露路径。
// Disable caching of private responses, MIME sniffing, and referrer disclosure.
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
// 房间号是可分享的入口，不是授权凭证；字母表避开部分易混淆字符。
// A room code is a shareable locator, not authorization; omit some ambiguous characters.
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// 生成八位房间号；插入时仍检查碰撞，不能假设随机值必然唯一。
// Generate an eight-character code; insertion still checks collisions.
export function randomCode() {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(8)),
    (n) => alphabet[n % alphabet.length],
  ).join('');
}
// 生成 32 字节随机秘密，编码为 64 位十六进制；不要记录或分享。
// Generate a 32-byte secret encoded as 64 hexadecimal characters; never log or share it.
function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
}
// 存储 SHA-256 摘要而非明文凭证；请求也先取摘要再比较。
// Store a SHA-256 digest, not the raw credential; hash incoming credentials before comparison.
export async function hashToken(value) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (n) => n.toString(16).padStart(2, '0'),
  ).join('');
}
// 修剪并做 NFC Unicode 规范化；按码点限长，拒绝控制/格式字符。
// Trim and normalize Unicode to NFC; count code points and reject control/format characters.
function playerName(name) {
  if (typeof name !== 'string') fail(400, 'BAD_NAME', '请填写落座名字');
  const value = name.trim().normalize('NFC');
  if (!value || [...value].length > 16 || /[\p{Cc}\p{Cf}]/u.test(value))
    fail(400, 'BAD_NAME', '名字需为 1–16 个字符，不能含控制字符');
  return value;
}
// 把共享角色校验错误转换为稳定的 HTTP 400 错误。
// Translate shared character validation errors into a stable HTTP 400 response.
function characterPreference(value) {
  try {
    return preferredCharacter(value);
  } catch {
    fail(400, 'BAD_CHARACTER', '请选择有效的偏好角色，或留空随机分配');
  }
}
// 仅接受已知开局选项并分别校验布尔/金额类型；省略选项保留新局默认值。
// Accept known start options and validate boolean/amount types separately; omission preserves new-game defaults.
function startRules(options) {
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

// Request 流只能读一次；WeakMap 缓存同一请求的解析 Promise，且不永久持有请求。
// A Request stream is single-use; WeakMap caches its parsing promise without retaining it forever.
const requestBodies = new WeakMap();
// 路由和身份校验共享同一次请求体读取，包括读取失败。
// Routes and identity validation share one body read, including failures.
async function bodyOf(request) {
  if (!requestBodies.has(request)) requestBodies.set(request, readBody(request));
  return requestBodies.get(request);
}
// 先检查声明长度，再逐块检查实际字节数，避免缺失或伪造长度绕过 2 KiB 限制。
// Check both declared and streamed byte lengths so a missing or false header cannot bypass 2 KiB.
async function readBody(request) {
  if (Number(request.headers.get('content-length') || 0) > 2048)
    fail(413, 'TOO_LARGE', '请求内容过长');
  const reader = request.body?.getReader();
  let total = 0,
    chunks = [];
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 2048) {
        await reader.cancel();
        fail(413, 'TOO_LARGE', '请求内容过长');
      }
      chunks.push(value);
    }
  }
  // 按原顺序拼接字节，再统一 UTF-8 解码，避免截断跨块字符。
  // Join bytes in order before UTF-8 decoding so characters spanning chunks remain intact.
  const data = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    data.set(c, offset);
    offset += c.length;
  }
  try {
    // 只接受 JSON 对象；null、数组和基本类型都不是接口请求对象。
    // Only JSON objects are valid request bodies; reject null, arrays, and primitive values.
    const body = JSON.parse(new TextDecoder().decode(data));
    if (!body || Array.isArray(body) || typeof body !== 'object') throw Error();
    return body;
  } catch {
    fail(400, 'BAD_JSON', '请求格式不正确');
  }
}
// 在线只是 30 秒心跳窗口内且未离席，不代表仍占座或已登录账号。
// Online means a recent 30-second heartbeat and no detach flag, not an account login.
function connected(person, now = Date.now()) {
  return Boolean(person && !person.detached && now - person.lastSeen < 30000);
}
// 先调用引擎的按座位隐私过滤，绝不直接返回保存的完整 game。
// First ask the engine for a seat-filtered view; never return the full stored game.
function publicRoom(room, seat) {
  const game = room.game
    ? {
        ...engineFor(room.game).view(room.game, seat),
        schemaVersion: room.game.schemaVersion ?? 1,
      }
    : null;
  if (game) game.id = room.gameMeta?.id || `legacy-${room.createdAt}`;
  if (game) game.characters = gameCharacters(room.gameMeta?.characters);
  if (game)
    game.participantNames = game.players.map(
      (_, index) =>
        room.gameMeta?.participants[index]?.name || room.seats[index]?.name || `${index + 1}号位`,
    );
  // A newly seated player may see the completed result, not the previous occupant's private hand.
  // 换座后即使座位号相同，也必须隐藏上一位参与者的手牌、暗杠和诊断。
  // A replacement occupant must not see the former participant’s hand, concealed kongs, or diagnostics.
  if (
    game &&
    room.gameMeta?.participants[seat]?.tokenHash !== undefined &&
    room.gameMeta.participants[seat].tokenHash !== room.seats[seat]?.tokenHash
  ) {
    for (const player of game.players) {
      delete player.hand;
      player.melds = player.melds.map((meld) =>
        meld.type === 'anGang'
          ? {
              type: 'anGang',
              tile: null,
              tiles: Array(meld.tiles.length).fill(null),
              hidden: true,
              ...(meld.extended
                ? {
                    extended: true,
                  }
                : {}),
            }
          : meld,
      );
    }
    game.drawnTile = null;
    game.legalActions = [];
    game.scoreBreakdown = null;
    game.waitTiles = [];
    game.lockedWaits = [];
    game.huLockActive = false;
    game.huDiagnostic = null;
    if (game.specialHuPattern !== undefined) game.specialHuPattern = null;
  }
  return {
    id: room.id,
    revision: room.revision,
    phase: room.game ? (room.game.phase === 'finished' ? 'finished' : 'playing') : 'lobby',
    hostSeat: room.hostSeat,
    you: seat,
    createdAt: room.createdAt,
    rulesVersion: game?.schemaVersion ?? 3,
    seats: room.seats.map((person, index) => {
      if (!person) return null;
      // 参与者按凭证摘要识别，不按座位号或昵称继承上一人的本局数据。
      // Match participants by credential digest, not seat number or nickname.
      const isCurrentParticipant =
        !room.gameMeta || room.gameMeta.participants[index]?.tokenHash === person.tokenHash;
      const player = isCurrentParticipant ? game?.players?.[index] : null;
      return {
        seat: index,
        name: person.name,
        connected: connected(person),
        detached: Boolean(person.detached),
        isCurrentParticipant,
        preferredCharacter: isCharacterId(person.preferredCharacter)
          ? person.preferredCharacter
          : null,
        characterId: isCurrentParticipant ? (game?.characters[index] ?? null) : null,
        score: player?.score ?? 0,
        handCount: player?.handCount ?? 0,
        huCount: player?.huCount ?? 0,
        melds: player?.melds ?? [],
        radishes: player?.radishes ?? [],
        winPile: player?.winPile ?? [],
        lastScoreBreakdown: player?.lastScoreBreakdown ?? null,
      };
    }),
    game,
    // 只公开播放屏障的白名单；不发送引擎内部续行动作或任何凭证。
    // Expose only gate metadata, never private engine continuations or credentials.
    presentation: room.presentation ? {
      id: room.presentation.id,
      gameId: room.presentation.gameId,
      requiredSeats: [...room.presentation.requiredSeats],
      completedSeats: [...room.presentation.completedSeats],
      owners: { ...room.presentation.owners },
      preferredClients: { ...room.presentation.preferredClients },
      expiresAt: room.presentation.expiresAt,
      remainingMs: Math.max(0, room.presentation.expiresAt - Date.now()),
    } : null,
    tableScores: tableScores(room),
    lifecycle: room.lifecycleLog || [],
  };
}
// 房间操作用 Authorization 中的座位凭证；格式正确不等于已匹配到座位。
// Room operations use the Authorization seat credential; valid syntax alone does not identify a seat.
async function credentialHash(request) {
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer [a-f0-9]{64}$/.test(authorization))
    fail(401, 'UNAUTHORIZED', '座位凭证失效，请重新进入房间');
  return hashToken(authorization.slice(7));
}
// 个人跨桌记录凭证与座位凭证不同；仅在个人接口允许 Bearer 作为个人凭证。
// The cross-room profile credential is separate; Bearer is treated as a profile token only on profile routes.
async function profileHashFor(store, request, required = false) {
  const profileEndpoint = new URL(request.url).pathname.startsWith('/api/profile');
  const authorization = request.headers.get('authorization') || '';
  // 优先读专用头，其次按接口读 Bearer 或 POST 请求体，保持旧客户端兼容顺序。
  // Prefer the dedicated header, then route-specific Bearer or POST body, preserving client compatibility.
  const token =
    request.headers.get('x-player-token') ||
    (profileEndpoint && authorization.startsWith('Bearer ')
      ? authorization.slice(7)
      : request.method === 'POST'
        ? (await bodyOf(request)).profileToken
        : null);
  if (!token && !required) return null;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
    fail(401, 'PROFILE_UNAUTHORIZED', '个人记录凭证失效，请重新打开大厅');
  const hash = await hashToken(token);
  if (!(await store.getProfile(hash)))
    fail(401, 'PROFILE_UNAUTHORIZED', '个人记录凭证失效，请重新打开大厅');
  return hash;
}
// 只有双方都有个人身份且不一致时才拒绝；兼容尚未绑定的旧座位。
// Reject only conflicting known profile identities; allow legacy seats without a binding.
function assertIdentity(person, hash) {
  if (hash && person.playerHash && person.playerHash !== hash)
    fail(403, 'PROFILE_MISMATCH', '这张座位凭证已属于另一个个人记录');
}
// 绑定同一人的座位和个人索引；一份个人记录在一桌只能绑定一个座位。
// Bind a seat to its profile index; a profile may occupy only one seat per room.
async function bindProfile(store, room, seat, hash, indexAlreadyLinked = false) {
  if (!hash) return false;
  const person = room.seats[seat];
  assertIdentity(person, hash);
  if (room.seats.some((other, index) => index !== seat && other?.playerHash === hash))
    fail(409, 'ALREADY_SEATED', '这个个人记录已经绑定这桌的另一个座位');
  // Index first, room CAS second. A failed CAS can leave an index entry, but
  // history always checks the actual participant hash in the authoritative room.
  // 先写索引再保存房间；孤立索引只用于查找，不能代替房间里的参与者身份验证。
  // Write the index before room CAS; an orphan index is only a lookup hint, never proof of participation.
  if (!indexAlreadyLinked) await store.linkProfileRoom(hash, room.id);
  let changed = person.playerHash !== hash;
  person.playerHash = hash;
  if (room.game) {
    if (!room.gameMeta) {
      ensureGameMetadata(room);
      changed = true;
    }
    const participant = room.gameMeta.participants[seat];
    // 只补充当前座位能证明拥有的本局记录，不把前任玩家的历史转给新人。
    // Backfill only a game participant proven by this seat credential, never the previous occupant.
    if (participant?.tokenHash === person.tokenHash && !participant.playerHash) {
      participant.playerHash = hash;
      changed = true;
    }
  }
  return changed;
}
// 保留未离席的现任房主；否则优先在线玩家，再找未离席玩家，空桌设为 null。
// Keep an attached host; otherwise prefer online then attached players, or null for an empty room.
function selectHost(room) {
  if (
    Number.isInteger(room.hostSeat) &&
    room.seats[room.hostSeat] &&
    !room.seats[room.hostSeat].detached
  )
    return;
  let seat = room.seats.findIndex((person) => connected(person));
  if (seat < 0) seat = room.seats.findIndex((person) => person && !person.detached);
  room.hostSeat = seat < 0 ? null : seat;
}
// 进出桌日志独立于麻将动作历史，不改变牌墙或计分。
// Room arrival/departure logs are separate from game actions and do not alter tiles or scores.
function logLifecycle(room, type, seat, at) {
  (room.lifecycleLog ||= []).push({
    type,
    seat,
    at,
    hostSeat: room.hostSeat,
    message: type === 'leave' ? `${seat + 1}号位离开牌桌。` : `${seat + 1}号位重新连接牌桌。`,
  });
}
// 客户端版本必须是安全整数并与读取的房间一致，防止用旧牌面发动作。
// Require a safe-integer client revision equal to the loaded room to reject stale actions.
function revisionMatches(body, room) {
  if (!Number.isSafeInteger(body.revision) || body.revision !== room.revision)
    fail(409, 'STALE_STATE', '牌桌已更新，请看最新牌面后再操作');
}
// CAS：只在数据库仍是旧版本时写入新版本，避免并发请求互相覆盖。
// CAS writes the next revision only if storage still has the expected revision, preventing lost updates.
async function commit(store, previous, next) {
  next.revision = previous.revision + 1;
  next.updatedAt = Date.now();
  const committed = await store.compareAndSwap(next, previous.revision);
  if (committed === false) {
    // 只有存储明确返回 false 才证明没有写入；存储抛出的同名错误也不能当作可重试失败。
    // Only an explicit false proves no write occurred; even a similarly named storage exception is not retry-safe.
    const error = new ApiError(409, 'STALE_STATE', '有人刚刚操作了牌桌，请刷新后重试');
    error.isCompareAndSwapConflict = true;
    throw error;
  }
  // 存储契约只允许布尔值；缺失或畸形返回无法证明是否已写入，必须视为不确定结果。
  // The store contract permits booleans only; missing or malformed results cannot prove whether a write occurred.
  if (committed !== true) throw new Error('Invalid compareAndSwap result');
}
// 播放屏障与规则阶段分开保存；四十秒覆盖两段音频的看门狗和加载时间。
// Persist playback gates separately from rule phases; forty seconds covers two audio watchdogs and loading.
const PRESENTATION_TIMEOUT_MS = 40000;

// 每个标签页独立登记短租约；秘密仍只由座位凭证验证，这些标识不是认证凭证。
// Each tab records a short lease independently; seat credentials still authenticate, never these identifiers.
const PRESENTATION_LEASE_MS = 5000;
const PRESENTATION_DISCOVERY_MS = 1500;
function presentationPresence(request) {
  const clientId = request.headers.get('x-presentation-client');
  if (!clientId) return null;
  const visible = request.headers.get('x-presentation-visible');
  const audio = request.headers.get('x-presentation-audio');
  const ready = request.headers.get('x-presentation-ready');
  const gameId = request.headers.get('x-presentation-game') || null;
  const gateId = request.headers.get('x-presentation-gate') || null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(clientId) ||
    !['true', 'false'].includes(visible) || !['ready', 'silent'].includes(audio) ||
    !['true', 'false'].includes(ready) || (gameId && gameId.length > 128) ||
    (gateId && !/^[A-Za-z0-9_-]{1,64}$/.test(gateId)))
    fail(400, 'BAD_PRESENTATION', '播放状态格式不正确');
  return { clientId, visible: visible === 'true', audio, ready: ready === 'true', gameId, gateId };
}

// 同样内容一秒内不重复写；最多保留八个最近标签页，防止存档无界增长。
// Coalesce identical reports within one second and retain at most eight recent tabs to bound storage.
function recordPresence(room, seat, presence, now = Date.now()) {
  if (!presence) return false;
  const clients = room.seats[seat].presentationClients || [];
  const previous = clients.find((client) => client.clientId === presence.clientId);
  if (previous && (!room.game || now - previous.at < 1000) &&
    ['visible', 'audio', 'ready', 'gameId', 'gateId'].every((key) => previous[key] === presence[key])) return false;
  room.seats[seat].presentationClients = [
    { ...presence, at: now },
    ...clients.filter((client) => client.clientId !== presence.clientId),
  ].slice(0, 8);
  return true;
}

// 只选同局、前台且已建立事件基线的活跃页面；声音已就绪优先，ID 决定稳定平局顺序。
// Elect only fresh, foreground, baselined pages of this game; audio readiness wins, then stable lexical IDs.
function presentationCandidates(room, seat, now = Date.now()) {
  const clients = (room.seats[seat]?.presentationClients || [])
    .filter((client) => client.gameId === room.gameMeta?.id && now - client.at < PRESENTATION_LEASE_MS);
  // 当前 gate 的无新事件声明只适用这一段；下一段是新的实时事件，不应永久排除前台页。
  // No-new-events applies only to the reported gate; the next live segment must not exclude that foreground page.
  const eligible = clients.filter((client) => client.visible &&
    (client.ready || (client.gateId && client.gateId !== room.presentation?.id)))
    .sort((a, b) => Number(b.audio === 'ready') - Number(a.audio === 'ready') ||
      a.clientId.localeCompare(b.clientId));
  return { clients, eligible };
}

// 未取得 owner 的座位只短暂等待发现；已有 owner 必须等播放完成或四十秒故障恢复。
// Unowned seats wait only a short discovery window; owned seats retain full playback or forty-second recovery protection.
function electPresentationClients(room, now = Date.now()) {
  const gate = room.presentation;
  if (!gate) return false;
  const before = JSON.stringify([gate.requiredSeats, gate.preferredClients]);
  gate.preferredClients ||= {};
  gate.requiredSeats = gate.requiredSeats.filter((seat) => {
    if (!attachedParticipant(room, seat)) {
      delete gate.preferredClients[seat];
      return false;
    }
    if (gate.owners?.[seat] || gate.completedSeats.includes(seat)) return true;
    const { clients, eligible } = presentationCandidates(room, seat, now);
    if (eligible.length) {
      gate.preferredClients[seat] = eligible[0].clientId;
      return true;
    }
    delete gate.preferredClients[seat];
    // 已知后台/未就绪页面不拖住一桌；无新鲜遥测时给旧客户端短发现窗口。
    // Known hidden/unready pages do not hold the table; missing fresh telemetry gets short legacy discovery.
    return !clients.length && now < (gate.discoveryExpiresAt ?? gate.expiresAt);
  });
  return before !== JSON.stringify([gate.requiredSeats, gate.preferredClients]);
}

// 当前参与者才可以阻挡本局；换座身份与离席状态不会继承等待权。
// Only current participants can hold a gate; replacements and detached occupants cannot inherit it.
function attachedParticipant(room, seat) {
  const person = room.seats[seat];
  return Boolean(
    person && !person.detached &&
    room.gameMeta?.participants[seat]?.tokenHash === person.tokenHash,
  );
}

// 为新的引擎暂停建立独立 ID；重启后只需读取 JSON，不依赖 Worker 定时器。
// Give each engine pause a fresh ID; stored JSON survives restart without Worker timers.
function createPresentationGate(room, now = Date.now()) {
  if (!room.game?.presentation) {
    delete room.presentation;
    return;
  }
  room.presentation = {
    id: randomToken().slice(0, 32),
    gameId: room.gameMeta.id,
    requiredSeats: room.seats.flatMap((person, seat) =>
      attachedParticipant(room, seat) && connected(person, now) ? [seat] : []),
    completedSeats: [],
    owners: {},
    preferredClients: {},
    discoveryExpiresAt: now + PRESENTATION_DISCOVERY_MS,
    expiresAt: now + PRESENTATION_TIMEOUT_MS,
  };
  electPresentationClients(room, now);
}

// 只继续已经提交的动作；不选择碰、杠、胡或过。下一次暂停必须使用全新屏障。
// Continue only committed actions, never choose claims or passes. A subsequent pause gets a fresh gate.
function settlePresentation(room, now = Date.now()) {
  const gate = room.presentation;
  if (!gate || !room.game?.presentation || gate.gameId !== room.gameMeta?.id) return false;
  const elected = electPresentationClients(room, now);
  const requiredSeats = gate.requiredSeats.filter((seat) => attachedParticipant(room, seat));
  const changed = elected || requiredSeats.length !== gate.requiredSeats.length;
  gate.requiredSeats = requiredSeats;
  if (now < gate.expiresAt && !requiredSeats.every((seat) => gate.completedSeats.includes(seat)))
    return changed;
  room.game = continuePresentedGame(room.game);
  if (room.game.phase === 'finished' && !room.gameMeta.finishedAt)
    room.gameMeta.finishedAt = now;
  createPresentationGate(room, now);
  return true;
}

// 完成回执不携带房间版本；每次 CAS 冲突后重新验权，并且绝不把旧 ID 用在新屏障。
// Completion receipts need no room revision; reauthenticate after CAS conflicts and never apply an old ID to a new gate.
async function updatePresentation(store, room, tokenHash, playerHash, receipt = null, presence = null) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const seat = room.seats.findIndex((person) => person?.tokenHash === tokenHash);
    if (seat < 0) fail(401, 'UNAUTHORIZED', '座位凭证失效，请重新进入房间');
    assertIdentity(room.seats[seat], playerHash);
    if (room.seats[seat].detached) fail(409, 'SEAT_DETACHED', '你已离开这桌，请重新连接');
    const gate = room.presentation;
    // 旧回执幂等返回当前视图，甚至不能触发一个更新屏障的超时恢复。
    // Stale receipts return the current view idempotently, without even expiring a newer gate.
    if (
      receipt && (!gate || receipt.presentationId !== gate.id || receipt.gameId !== gate.gameId)
    ) return room;
    const next = structuredClone(room);
    let changed = recordPresence(next, seat, presence);
    const isBeginning = receipt?.phase === 'begin';
    const isReleasing = receipt?.phase === 'release';
    if (gate && !isReleasing) changed = electPresentationClients(next) || changed;
    if (receipt) {
      // 同座位多标签页先竞争一次播放权；只有赢家可提交完成，避免静默标签页提前放行。
      // Same-seat tabs claim playback ownership first; only the winner can complete, preventing silent-tab early release.
      if (!attachedParticipant(next, seat) || !next.presentation.requiredSeats.includes(seat)) {
        if (!changed) return room;
      } else {
        const owner = gate.owners?.[seat];
        if (isBeginning) {
          const { clients } = presentationCandidates(next, seat);
          const preferred = next.presentation.preferredClients?.[seat];
          const mayBegin = clients.length ? preferred === receipt.clientId : !presence;
          if (!owner && !gate.completedSeats.includes(seat) && mayBegin) {
            (next.presentation.owners ||= {})[seat] = receipt.clientId;
            next.seats[seat].lastSeen = Date.now();
            changed = true;
          }
        } else if (isReleasing) {
          // 播放前切到后台的赢家可以交还所有权；已完成的座位和别人的 owner 都不可撤销。
          // A winner hidden before playback can relinquish ownership; completed seats and other owners are immutable.
          if (owner === receipt.clientId && !gate.completedSeats.includes(seat)) {
            delete next.presentation.owners[seat];
            changed = true;
          }
        } else {
          // 无 owner 时只兼容旧版无 clientId 回执；新版必须先完成 begin 握手。
          // Only legacy receipts without clientId work while unowned; modern clients must handshake first.
          const ownsPresentation = owner
            ? owner === receipt.clientId
            : receipt.clientId === undefined && !presentationCandidates(next, seat).clients.length;
          if (!ownsPresentation) return room;
          if (!gate.completedSeats.includes(seat)) {
            next.presentation.completedSeats.push(seat);
            next.seats[seat].lastSeen = Date.now();
            changed = true;
          }
        }
      }
    }
    // 交还 owner 后立即重新选候选，但 release 本身不能续行牌局。
    // Re-elect immediately after relinquishing ownership, without letting release advance the game.
    if (isReleasing && gate && changed) changed = electPresentationClients(next) || changed;
    // begin/release 只修改所有权，即使屏障超时也不推进规则或代表播放完成。
    // Begin/release only change ownership, even after expiry; neither advances rules nor means playback finished.
    if (!isBeginning && !isReleasing) changed = settlePresentation(next) || changed;
    if (!changed) return room;
    try {
      await commit(store, room, next);
      return next;
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'STALE_STATE') throw error;
    }
    room = await store.get(room.id);
    if (!room) fail(404, 'ROOM_NOT_FOUND', '没有找到这个房间');
  }
  fail(409, 'STALE_STATE', '牌桌仍在更新，请再试一次');
}
// 仅忽略租约/心跳及其提交外壳；其他任何字段变化都不是可重试的遥测冲突。
// Ignore only lease/heartbeat fields and their commit envelope; every other change disqualifies telemetry-only retry.
function differsOnlyInPresence(previous, current) {
  if (!current || current.revision <= previous.revision) return false;
  // 比较完整保存模型而非局版本：离席、换座、档案、房主和屏障都必须原样。
  // Compare the entire saved model, not just game revision: detach, occupancy, history, host and gate must remain unchanged.
  const withoutPresence = (room) => {
    const copy = structuredClone(room);
    delete copy.revision;
    delete copy.updatedAt;
    for (const person of copy.seats) {
      if (!person) continue;
      delete person.lastSeen;
      delete person.presentationClients;
    }
    return JSON.stringify(copy);
  };
  return withoutPresence(previous) === withoutPresence(current);
}

// 每个存储实例创建一套接口；限流 Map 仅属于本进程/Worker 实例，不是全局配额。
// Create handlers per store; the throttle map is process/isolate-local, not a global quota.
export function createApi(store) {
  const recentCreates = new Map();
  // 同一 IP 的一分钟窗口最多建房十次；本地请求共用 local 退路键。
  // Limit room creation to ten per IP per minute; local requests share the fallback key.
  function throttle(request) {
    const ip = request.headers.get('cf-connecting-ip') || 'local',
      now = Date.now();
    const recent = (recentCreates.get(ip) || []).filter((at) => now - at < 60000);
    if (recent.length >= 10) fail(429, 'RATE_LIMIT', '建房太频繁，请稍后再试');
    recent.push(now);
    recentCreates.set(ip, recent);
    if (recentCreates.size > 5000) recentCreates.clear();
  }
  // 路由总入口：非 API 路径返回 null，让外层继续处理静态页面。
  // Main router: return null for non-API paths so the adapter can serve the page.
  const handle = async function (request) {
    try {
      const url = new URL(request.url),
        method = request.method;
      if (!url.pathname.startsWith('/api/')) return null;
      // 有 Origin 时必须与请求 URL 同源；无 Origin 的请求仍走凭证校验。
      // If present, Origin must match the request URL; requests without it still require credentials.
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) fail(403, 'ORIGIN', '不接受跨站请求');
      // 健康检查只给出公开版本信息，不读取玩家或牌局秘密。
      // The health endpoint returns public version information, not player or game secrets.
      if (method === 'GET' && url.pathname === '/api/health')
        return json({
          ok: true,
          service: 'flower-mahjong',
          version: '0.7.0',
          rulesVersion: 3,
        });
      // 注册或恢复匿名个人身份；浏览器可预存随机凭证以应对响应丢失。
      // Register or restore an anonymous profile; browsers may persist a random credential before registration.
      if (method === 'POST' && url.pathname === '/api/profile') {
        const body = await bodyOf(request);
        // A browser may generate and persist a random identity before registration,
        // so an interrupted response or concurrent tabs cannot strand its credential.
        if (body.playerToken !== undefined) {
          if (typeof body.playerToken !== 'string' || !/^[a-f0-9]{64}$/.test(body.playerToken))
            fail(400, 'BAD_PROFILE_TOKEN', '个人记录凭证格式不正确');
          const created = await store.createProfile(await hashToken(body.playerToken), Date.now());
          return json(
            {
              playerToken: body.playerToken,
              token: body.playerToken,
            },
            created ? 201 : 200,
          );
        }
        // 已有个人凭证先验证，再原样返回；不会创建第二份身份。
        // Validate and return an existing profile credential rather than creating another identity.
        if (request.headers.has('x-player-token') || request.headers.has('authorization')) {
          await profileHashFor(store, request, true);
          const token =
            request.headers.get('x-player-token') || request.headers.get('authorization').slice(7);
          return json({
            playerToken: token,
            token,
          });
        }
        // 最多尝试五个随机凭证；唯一索引防止随机碰撞覆盖已有个人记录。
        // Try at most five random credentials; uniqueness prevents overwriting an existing profile.
        for (let attempt = 0; attempt < 5; attempt++) {
          const token = randomToken();
          if (await store.createProfile(await hashToken(token), Date.now()))
            return json(
              {
                playerToken: token,
                token,
              },
              201,
            );
        }
        fail(503, 'BUSY', '暂时无法建立个人记录，请稍后再试');
      }
      // 按索引找候选房间，再逐个检查真实参与者；已结算总分不混入进行中暂记分。
      // Use the index to find candidate rooms, then verify participants; settled totals exclude provisional scores.
      if (method === 'GET' && url.pathname === '/api/profile/history') {
        const hash = await profileHashFor(store, request, true),
          records = [];
        for (const id of await store.listProfileRooms(hash)) {
          const room = await store.get(id);
          if (room) records.push(...recordsForProfile(room, hash));
        }
        // One room-game-seat key, regardless of reconnects, retries or room restarts.
        // 以房间、局 ID、座位组合去重，重复读取或索引不会重复计分。
        // Deduplicate by room, game ID, and seat so retries or repeated index entries cannot double-count.
        const unique = [
          ...new Map(
            records.map((record) => [`${record.roomId}:${record.gameId}:${record.seat}`, record]),
          ).values(),
        ];
        unique.sort((a, b) => b.startedAt - a.startedAt || b.gameId.localeCompare(a.gameId));
        const settled = unique.filter((record) => record.status === 'finished');
        return json({
          summary: {
            settledGames: settled.length,
            totalScore: settled.reduce((sum, record) => sum + record.score, 0),
          },
          records: unique,
        });
      }
      // 建房创建第一位玩家、独立座位秘密和空牌局；只有插入成功才返回凭证。
      // Create the first occupant, a separate seat secret, and no game; return credentials only after insertion.
      if (method === 'POST' && url.pathname === '/api/rooms') {
        const body = await bodyOf(request),
          name = playerName(body.name),
          preference = characterPreference(body.preferredCharacter);
        throttle(request);
        const now = Date.now(),
          playerHash = await profileHashFor(store, request);
        const token = randomToken(),
          person = {
            name,
            preferredCharacter: preference,
            tokenHash: await hashToken(token),
            lastSeen: now,
            ...(playerHash
              ? {
                  playerHash,
                }
              : {}),
          };
        for (let attempt = 0; attempt < 5; attempt++) {
          const room = {
            id: randomCode(),
            revision: 0,
            hostSeat: 0,
            seats: [person, null, null],
            game: null,
            createdAt: now,
            updatedAt: now,
          };
          if (playerHash) await store.linkProfileRoom(playerHash, room.id);
          if (await store.insert(room))
            return json(
              {
                roomId: room.id,
                token,
                state: publicRoom(room, 0),
              },
              201,
            );
        }
        fail(503, 'BUSY', '暂时无法建房，请稍后再试');
      }
      // 仅匹配约定的房间号与操作后缀，未知路径不会误落入其他操作。
      // Match only the room-code and operation grammar; unknown routes cannot fall through to another action.
      const match = url.pathname.match(
        /^\/api\/rooms\/([A-Z2-9]{8})(?:\/(join|action|start|leave|resume|presentation))?$/,
      );
      if (!match) fail(404, 'NOT_FOUND', '没有找到这个接口');
      const [, id, operation] = match;
      let room = await store.get(id);
      if (!room) fail(404, 'ROOM_NOT_FOUND', '没有找到这个房间，请检查房间号');
      const playerHash = await profileHashFor(store, request);
      // 加入只允许大厅或已结束局；进行中不可换人，抢座用 CAS 决胜。
      // Joining is allowed only before a game or after it finishes; CAS resolves concurrent seat claims.
      if (method === 'POST' && operation === 'join') {
        const body = await bodyOf(request),
          name = playerName(body.name),
          preference = characterPreference(body.preferredCharacter);
        if (room.game && room.game.phase !== 'finished')
          fail(409, 'STARTED', '牌局已经开始，请使用原来的浏览器重连');
        if (room.seats.some((person) => person?.name === name))
          fail(409, 'NAME_TAKEN', '已有同名玩家，请换一个落座名字');
        if (playerHash && room.seats.some((person) => person?.playerHash === playerHash))
          fail(409, 'ALREADY_SEATED', '你已在这桌落座，请使用原来的座位凭证重连');
        // 未指定座位时找第一个空位；指定座位也必须为 0、1、2 且无人占用。
        // Choose the first empty seat when omitted; explicit seats must be 0, 1, or 2 and vacant.
        let seat = body.seat;
        if (seat === undefined) seat = room.seats.findIndex((person) => !person);
        if (!Number.isInteger(seat) || seat < 0 || seat > 2)
          fail(409, 'ROOM_FULL', '三个位置都坐满了');
        if (room.seats[seat]) fail(409, 'SEAT_TAKEN', '这个座位已有人，请换一个位置');
        const token = randomToken(),
          next = structuredClone(room);
        ensureGameMetadata(next);
        next.seats[seat] = {
          name,
          preferredCharacter: preference,
          tokenHash: await hashToken(token),
          lastSeen: Date.now(),
          ...(playerHash
            ? {
                playerHash,
              }
            : {}),
        };
        if (playerHash) await store.linkProfileRoom(playerHash, id);
        selectHost(next);
        await commit(store, room, next);
        return json(
          {
            roomId: id,
            token,
            state: publicRoom(next, seat),
          },
          201,
        );
      }
      // join 之后的所有房间操作都需要座位凭证，包括读取牌面。
      // Every remaining room operation requires a seat credential, including reading the table.
      const tokenHash = await credentialHash(request);
      // 离开是房间意图而非打牌动作；并发冲突可重新读取后有限次重试。
      // Leaving is room intent, not a game move; reread and retry boundedly on a concurrent update.
      if (method === 'POST' && operation === 'leave') {
        await bodyOf(request);
        // Leaving expresses intent, not a game move: safely retry on a concurrent
        // move/join/start while re-authenticating the exact credential each time.
        for (let attempt = 0; attempt < 6; attempt++) {
          const seat = room.seats.findIndex((person) => person?.tokenHash === tokenHash);
          if (seat < 0) {
            // 已释放座位保留离席凭证摘要，让重复离开请求安全返回成功。
            // Saved departure digests allow repeated leave requests to succeed safely after a seat is released.
            const departure = room.departures?.find((person) => person.tokenHash === tokenHash);
            if (!departure) fail(401, 'UNAUTHORIZED', '座位凭证失效，请重新进入房间');
            assertIdentity(departure, playerHash);
            return json({
              left: true,
              detached: false,
              roomId: id,
            });
          }
          assertIdentity(room.seats[seat], playerHash);
          const wasDetached = Boolean(room.seats[seat].detached);
          const next = structuredClone(room),
            bound = await bindProfile(store, next, seat, playerHash);
          ensureGameMetadata(next);
          if (wasDetached && !bound && room.game && room.game.phase !== 'finished')
            return json({
              left: true,
              detached: true,
              roomId: id,
            });
          // 进行中只标记离席，保留手牌；未开局或结束后才真正释放座位。
          // During play only detach and preserve the hand; release seats only before play or after completion.
          const detached = Boolean(next.game && next.game.phase !== 'finished');
          if (detached) {
            next.seats[seat].detached = true;
            next.seats[seat].lastSeen = 0;
          } else {
            (next.departures ||= []).push({
              tokenHash,
              playerHash: next.seats[seat].playerHash || null,
              seat,
              at: Date.now(),
            });
            next.seats[seat] = null;
          }
          settlePresentation(next);
          selectHost(next);
          if (!wasDetached) logLifecycle(next, 'leave', seat, Date.now());
          try {
            await commit(store, room, next);
            return json({
              left: true,
              detached,
              roomId: id,
            });
          } catch (error) {
            if (!(error instanceof ApiError) || error.code !== 'STALE_STATE') throw error;
          }
          room = await store.get(id);
          if (!room) fail(404, 'ROOM_NOT_FOUND', '没有找到这个房间');
        }
        fail(409, 'STALE_STATE', '牌桌仍在更新，请再试一次离开');
      }
      const seat = room.seats.findIndex((person) => person?.tokenHash === tokenHash);
      if (seat < 0) fail(401, 'UNAUTHORIZED', '座位凭证失效，请重新进入房间');
      assertIdentity(room.seats[seat], playerHash);
      // 重连恢复原座位，不生成新身份、不换手牌，也不重新结算。
      // Resume the original seat without creating identity, replacing hands, or settling again.
      if (method === 'POST' && operation === 'resume') {
        await bodyOf(request);
        const next = structuredClone(room),
          bound = await bindProfile(store, next, seat, playerHash);
        const presenceChanged = recordPresence(next, seat, presentationPresence(request));
        if (next.seats[seat].detached || bound || next.hostSeat === null || presenceChanged) {
          const wasDetached = Boolean(next.seats[seat].detached);
          next.seats[seat].detached = false;
          next.seats[seat].lastSeen = Date.now();
          selectHost(next);
          if (wasDetached) logLifecycle(next, 'resume', seat, Date.now());
          await commit(store, room, next);
          room = next;
        }
        return json({
          state: publicRoom(room, seat),
        });
      }
      if (room.seats[seat].detached)
        fail(409, 'SEAT_DETACHED', '你已离开这桌，请通过这桌链接重新连接');
      // 完成回执只确认本人的播放，不接受客户端指定其他座位或引擎动作。
      // A receipt confirms this viewer's playback only; supplied seats or rule actions are ignored.
      if (method === 'POST' && operation === 'presentation') {
        const body = await bodyOf(request);
        if (
          typeof body.presentationId !== 'string' || typeof body.gameId !== 'string' ||
          (body.phase !== undefined && !['begin', 'complete', 'release'].includes(body.phase)) ||
          (body.clientId !== undefined &&
            (typeof body.clientId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.clientId))) ||
          (['begin', 'release'].includes(body.phase) && body.clientId === undefined)
        ) fail(400, 'BAD_PRESENTATION', '播放确认格式不正确');
        room = await updatePresentation(store, room, tokenHash, playerHash, body, presentationPresence(request));
        return json({ state: publicRoom(room, seat) });
      }
      // 读和打牌请求惰性恢复失联屏障；恢复会提升版本，旧动作不会顺带重放。
      // Reads and actions lazily recover abandoned gates; revision changes prevent replaying stale actions.
      if (method === 'GET' && !operation)
        room = await updatePresentation(store, room, tokenHash, playerHash, null, presentationPresence(request));
      if (method === 'POST' && operation === 'action' && room.presentation)
        room = await updatePresentation(store, room, tokenHash, playerHash, null, presentationPresence(request));
      // 轮询可补绑旧记录、更新心跳；版本未变时只返回轻量连接状态。
      // Polling can bind legacy records and refresh heartbeats; unchanged revisions return lightweight connections.
      if (method === 'GET' && !operation) {
        if (
          playerHash &&
          (room.seats[seat].playerHash !== playerHash ||
            (room.game &&
              (!room.gameMeta ||
                (room.gameMeta.participants[seat]?.tokenHash === tokenHash &&
                  !room.gameMeta.participants[seat]?.playerHash))))
        ) {
          const next = structuredClone(room);
          await bindProfile(store, next, seat, playerHash);
          await commit(store, room, next);
          room = next;
        }
        const now = Date.now();
        // 最多每十秒触碰心跳；同时校验座位秘密和版本，防止旧请求复活已离席玩家。
        // Touch at most once per ten seconds, checking credential and revision to prevent stale resurrection.
        if (now - room.seats[seat].lastSeen >= 10000) {
          const touched = await store.touch(id, seat, now, tokenHash, room.revision);
          if (!touched) fail(409, 'STALE_STATE', '牌桌已更新，请重新读取');
          room.seats[seat].lastSeen = now;
        }
        const since = url.searchParams.get('since');
        if (since !== null && /^\d+$/.test(since) && Number(since) === room.revision)
          return json({
            unchanged: true,
            revision: room.revision,
            connections: room.seats.map((person) => connected(person, now)),
          });
        return json({
          state: publicRoom(room, seat),
        });
      }
      // 只有房主、全员在座、上一局已结束时可开局；旧局先归档，后生成新局。
      // Start requires the host, all attached occupants, and no active game; archive before creating the next game.
      if (method === 'POST' && operation === 'start') {
        const body = await bodyOf(request);
        revisionMatches(body, room);
        if (seat !== room.hostSeat) fail(403, 'HOST_ONLY', '只有房主可以开始');
        if (room.seats.some((person) => !person || person.detached))
          fail(409, 'NOT_FULL', '三位玩家都落座后才能开始');
        if (room.game && room.game.phase !== 'finished') fail(409, 'PLAYING', '这一局还没结束');
        const rules = startRules(body.options);
        const next = structuredClone(room);
        await bindProfile(store, next, seat, playerHash);
        ensureGameMetadata(next);
        if (next.game) (next.archivedGames ||= []).push(archiveFinishedGame(next));
        const now = Date.now();
        next.game = createGame({
          dealerSeat: dealerForNextGame(next.game),
          rules,
        });
        delete next.presentation;
        next.gameMeta = newGameMetadata(next, randomToken().slice(0, 32), now);
        // 展示能力按本局保存而非改规则；旧浏览器加入同局后也不能绕过节奏。
        // Save presentation capability per game, not as a rule; older clients cannot bypass it later.
        if (body.presentation === true) next.gameMeta.presentationEnabled = true;
        recordPresence(next, seat, presentationPresence(request));
        next.seats[seat].lastSeen = now;
        // 角色在开局时统一分配并保存；重连读取同一映射，不重新抽签。
        // Assign and save characters once at game start; reconnects reuse the mapping.
        next.gameMeta.characters = assignCharacters(
          next.seats.map((person) => person.preferredCharacter),
        );
        await commit(store, room, next);
        return json({
          state: publicRoom(next, seat),
        });
      }
      // 先验证动作结构，只提取 type/tile；实际合法性由该局版本引擎决定。
      // Validate action shape and copy only type/tile; the saved-version engine decides legality.
      if (method === 'POST' && operation === 'action') {
        const body = await bodyOf(request);
        // 新浏览器可用局 ID 和引擎版本证明牌面仍相同；心跳只改房间版本，不应误拒打牌。
        // Modern clients can prove the same game state by game ID/revision; presence-only room changes must not reject moves.
        // 旧客户端仍严格匹配房间版本；任何实际动作改变引擎版本，最后仍必须通过房间 CAS。
        // Legacy clients retain strict room revisions; actual moves change game revision and final room CAS still applies.
        const hasCurrentGameProof = body.presentation === true &&
          body.gameId === room.gameMeta?.id && Number.isSafeInteger(body.gameRevision) &&
          body.gameRevision === room.game?.revision;
        // 一旦请求提供局证明，两项必须完整且匹配；不能用新的房间版本掩盖旧局证明。
        // Once either proof field is supplied, require both to match; a current room revision cannot hide stale game proof.
        const hasGameProofFields = Object.hasOwn(body, 'gameId') || Object.hasOwn(body, 'gameRevision');
        if (hasGameProofFields && !hasCurrentGameProof)
          fail(409, 'STALE_STATE', '牌桌已更新，请看最新牌面后再操作');
        if (!hasGameProofFields) revisionMatches(body, room);
        if (room.presentation || room.game?.presentation)
          fail(409, 'PRESENTATION_PENDING', '请等待动画和语音播放完成');
        if (!room.game) fail(409, 'NOT_STARTED', '房主还没有开始这局');
        const supplied = body.action;
        if (
          !supplied ||
          typeof supplied !== 'object' ||
          Array.isArray(supplied) ||
          typeof supplied.type !== 'string'
        )
          fail(400, 'BAD_ACTION', '操作格式不正确');
        const action = {
          type: supplied.type,
        };
        if (supplied.tile !== undefined) {
          if (!Number.isInteger(supplied.tile) || supplied.tile < 0 || supplied.tile > 17)
            fail(400, 'BAD_TILE', '牌的编号不正确');
          action.tile = supplied.tile;
        }
        // 游戏状态必须完全未变才重试；索引只关联一次，每轮重新构建独立待提交状态。
        // Retry only an identical game/lifecycle; link the profile index once and rebuild each candidate from fresh storage.
        let indexAlreadyLinked = false;
        for (let attempt = 0; attempt < 4; attempt++) {
          const engine = engineFor(room.game),
            next = structuredClone(room);
          await bindProfile(store, next, seat, playerHash, indexAlreadyLinked);
          indexAlreadyLinked = true;
          ensureGameMetadata(next);
          recordPresence(next, seat, presentationPresence(request));
          try {
            // 把原牌局交给规则引擎产生下一状态；失败不提交房间副本。
            // Let the engine produce the next state from the original game; failure never commits the clone.
            if (body.presentation === true && room.game.schemaVersion === 3)
              next.gameMeta.presentationEnabled = true;
            next.game = next.gameMeta.presentationEnabled === true && room.game.schemaVersion === 3
              ? applyPresentedAction(room.game, seat, action)
              : engine.apply(room.game, seat, action);
          } catch (error) {
            fail(422, 'ILLEGAL_ACTION', error.message || '当前不能这样操作');
          }
          next.seats[seat].lastSeen = Date.now();
          createPresentationGate(next);
          // 首次结束时记录结束时间；重读和重复请求不能重新结算或重写这个时间。
          // Record the first finish time; rereads and retries do not resettle or rewrite it.
          if (next.game.phase === 'finished' && !next.gameMeta.finishedAt)
            next.gameMeta.finishedAt = Date.now();
          try {
            await commit(store, room, next);
            return json({ state: publicRoom(next, seat) });
          } catch (error) {
            if (!(error instanceof ApiError) || error.code !== 'STALE_STATE' ||
              error.isCompareAndSwapConflict !== true || !hasCurrentGameProof || room.game.schemaVersion !== 3 || attempt === 3) throw error;
            const latest = await store.get(room.id);
            if (!differsOnlyInPresence(room, latest)) throw error;
            // 只在明确未写入的 CAS 冲突后重算；身份再次校验，积分和事件不从失败副本复用。
            // Recompute only after a known failed CAS; reauthenticate and never reuse scores/events from the failed clone.
            if (latest.seats[seat]?.tokenHash !== tokenHash || latest.seats[seat]?.detached) throw error;
            assertIdentity(latest.seats[seat], playerHash);
            room = latest;
          }
        }
      }
      fail(405, 'METHOD', '不支持这种操作');
    } catch (error) {
      if (error instanceof ApiError)
        return json(
          {
            error: error.message,
            code: error.code,
          },
          error.status,
        );
      // Never log request bodies, credentials, SQL bindings or private game state.
      // 服务端日志只输出错误类型，不输出请求体、凭证、SQL 参数或私人牌面。
      // Log only the error type, never request bodies, credentials, SQL bindings, or private game state.
      console.error('Request failed:', error?.name || 'Error');
      return json(
        {
          error: '服务器暂时出了点问题，请稍后刷新',
          code: 'SERVER_ERROR',
        },
        500,
      );
    }
  };
  // 为已处理响应补充服务器耗时；不改变业务状态，也不向静态响应强加 API 行为。
  // Add server timing to handled responses without changing state or non-API behavior.
  return async (request) => {
    const started = performance.now(),
      response = await handle(request);
    if (response)
      response.headers.set('server-timing', `app;dur=${(performance.now() - started).toFixed(1)}`);
    return response;
  };
}
