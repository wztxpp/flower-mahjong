import { createGame, dealerForNextGame, applyAction, getPlayerView } from '../shared/game.js';
import { applyAction as applyV2Action, getPlayerView as getV2View } from '../shared/v2-game.js';
import { applyAction as applyLegacyAction, getPlayerView as getLegacyView } from '../shared/legacy-game.js';
import { ensureGameMetadata, newGameMetadata, archiveFinishedGame, recordsForProfile, tableScores } from './history.js';
import { assignCharacters, gameCharacters, isCharacterId, preferredCharacter } from '../shared/character-assignment.js';

// Existing saved games keep their exact original rules and physical state.
// Only a new game receives schemaVersion 3; no database migration rewrites hands.
function engineFor(game) {
  if (game.schemaVersion === 3) return { apply: applyAction, view: getPlayerView };
  if (game.schemaVersion === 2) return { apply: applyV2Action, view: getV2View };
  if (game.schemaVersion === undefined || game.schemaVersion === 1) return { apply: applyLegacyAction, view: getLegacyView };
  fail(409, 'UNSUPPORTED_GAME_VERSION', '这桌使用了更新的规则版本，请刷新页面后重试');
}

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
const fail=(status,code,message)=>{throw new ApiError(status,code,message)};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomCode(){return Array.from(crypto.getRandomValues(new Uint8Array(8)),n=>alphabet[n%alphabet.length]).join('');}
function randomToken(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');}
export async function hashToken(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');}
function playerName(name){if(typeof name!=='string')fail(400,'BAD_NAME','请填写落座名字'); const value=name.trim().normalize('NFC'); if(!value||[...value].length>16||/[\p{Cc}\p{Cf}]/u.test(value))fail(400,'BAD_NAME','名字需为 1–16 个字符，不能含控制字符');return value;}
function characterPreference(value) {
  try { return preferredCharacter(value); }
  catch { fail(400, 'BAD_CHARACTER', '请选择有效的偏好角色，或留空随机分配'); }
}
function startRules(options) {
  if (options === undefined) return {};
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some(key => key !== 'autoDiscardAfterHu')
    || (Object.hasOwn(options, 'autoDiscardAfterHu') && typeof options.autoDiscardAfterHu !== 'boolean')) {
    fail(400, 'BAD_START_OPTIONS', '开局选项无效，请重新选择胡后是否自动打出');
  }
  return Object.hasOwn(options, 'autoDiscardAfterHu') ? { autoDiscardAfterHu: options.autoDiscardAfterHu } : {};
}
const requestBodies = new WeakMap();
async function bodyOf(request) {
  if (!requestBodies.has(request)) requestBodies.set(request, readBody(request));
  return requestBodies.get(request);
}
async function readBody(request){
  if(Number(request.headers.get('content-length')||0)>2048)fail(413,'TOO_LARGE','请求内容过长');
  const reader=request.body?.getReader();let total=0,chunks=[];
  if(reader){while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>2048){await reader.cancel();fail(413,'TOO_LARGE','请求内容过长');}chunks.push(value);}}
  const data=new Uint8Array(total);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}
  try{const body=JSON.parse(new TextDecoder().decode(data));if(!body||Array.isArray(body)||typeof body!=='object')throw Error();return body;}catch{fail(400,'BAD_JSON','请求格式不正确');}
}
function connected(person, now = Date.now()) { return Boolean(person && !person.detached && now - person.lastSeen < 30000); }
function publicRoom(room, seat) {
  const game = room.game ? { ...engineFor(room.game).view(room.game, seat), schemaVersion: room.game.schemaVersion ?? 1 } : null;
  if (game) game.id = room.gameMeta?.id || `legacy-${room.createdAt}`;
  if (game) game.characters = gameCharacters(room.gameMeta?.characters);
  if (game) game.participantNames = game.players.map((_, index) => room.gameMeta?.participants[index]?.name || room.seats[index]?.name || `${index + 1}号位`);
  // A newly seated player may see the completed result, not the previous occupant's private hand.
  if (game && room.gameMeta?.participants[seat]?.tokenHash !== undefined && room.gameMeta.participants[seat].tokenHash !== room.seats[seat]?.tokenHash) {
    for (const player of game.players) {
      delete player.hand;
      player.melds = player.melds.map(meld => meld.type === 'anGang' ? { type: 'anGang', tile: null, tiles: Array(meld.tiles.length).fill(null), hidden: true, ...(meld.extended ? { extended: true } : {}) } : meld);
    }
    game.drawnTile = null; game.legalActions = []; game.scoreBreakdown = null;
    game.waitTiles = []; game.lockedWaits = []; game.huLockActive = false; game.huDiagnostic = null;
    if (game.specialHuPattern !== undefined) game.specialHuPattern = null;
  }
  return { id: room.id, revision: room.revision, phase: room.game ? (room.game.phase === 'finished' ? 'finished' : 'playing') : 'lobby', hostSeat: room.hostSeat, you: seat, createdAt: room.createdAt,
    rulesVersion: game?.schemaVersion ?? 3,
    seats: room.seats.map((person, index) => {
      if (!person) return null;
      const isCurrentParticipant = !room.gameMeta || room.gameMeta.participants[index]?.tokenHash === person.tokenHash;
      const player = isCurrentParticipant ? game?.players?.[index] : null;
      return { seat: index, name: person.name, connected: connected(person), detached: Boolean(person.detached), isCurrentParticipant,
        preferredCharacter: isCharacterId(person.preferredCharacter) ? person.preferredCharacter : null,
        characterId: isCurrentParticipant ? game?.characters[index] ?? null : null,
        score: player?.score ?? 0, handCount: player?.handCount ?? 0, huCount: player?.huCount ?? 0,
        melds: player?.melds ?? [], radishes: player?.radishes ?? [], winPile: player?.winPile ?? [], lastScoreBreakdown: player?.lastScoreBreakdown ?? null };
    }), game,
    tableScores: tableScores(room),
    lifecycle: room.lifecycleLog || [],
  };
}
async function credentialHash(request) {
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer [a-f0-9]{64}$/.test(authorization)) fail(401, 'UNAUTHORIZED', '座位凭证失效，请重新进入房间');
  return hashToken(authorization.slice(7));
}
async function profileHashFor(store, request, required = false) {
  const profileEndpoint = new URL(request.url).pathname.startsWith('/api/profile');
  const authorization = request.headers.get('authorization') || '';
  const token = request.headers.get('x-player-token') || (profileEndpoint && authorization.startsWith('Bearer ') ? authorization.slice(7) : request.method === 'POST' ? (await bodyOf(request)).profileToken : null);
  if (!token && !required) return null;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) fail(401, 'PROFILE_UNAUTHORIZED', '个人记录凭证失效，请重新打开大厅');
  const hash = await hashToken(token);
  if (!await store.getProfile(hash)) fail(401, 'PROFILE_UNAUTHORIZED', '个人记录凭证失效，请重新打开大厅');
  return hash;
}
function assertIdentity(person, hash) {
  if (hash && person.playerHash && person.playerHash !== hash) fail(403, 'PROFILE_MISMATCH', '这张座位凭证已属于另一个个人记录');
}
async function bindProfile(store, room, seat, hash) {
  if (!hash) return false;
  const person = room.seats[seat]; assertIdentity(person, hash);
  if (room.seats.some((other, index) => index !== seat && other?.playerHash === hash)) fail(409, 'ALREADY_SEATED', '这个个人记录已经绑定这桌的另一个座位');
  // Index first, room CAS second. A failed CAS can leave an index entry, but
  // history always checks the actual participant hash in the authoritative room.
  await store.linkProfileRoom(hash, room.id);
  let changed = person.playerHash !== hash;
  person.playerHash = hash;
  if (room.game) {
    if (!room.gameMeta) { ensureGameMetadata(room); changed = true; }
    const participant = room.gameMeta.participants[seat];
    if (participant?.tokenHash === person.tokenHash && !participant.playerHash) { participant.playerHash = hash; changed = true; }
  }
  return changed;
}
function selectHost(room) {
  if (Number.isInteger(room.hostSeat) && room.seats[room.hostSeat] && !room.seats[room.hostSeat].detached) return;
  let seat = room.seats.findIndex(person => connected(person));
  if (seat < 0) seat = room.seats.findIndex(person => person && !person.detached);
  room.hostSeat = seat < 0 ? null : seat;
}
function logLifecycle(room, type, seat, at) {
  (room.lifecycleLog ||= []).push({ type, seat, at, hostSeat: room.hostSeat, message: type === 'leave' ? `${seat + 1}号位离开牌桌。` : `${seat + 1}号位重新连接牌桌。` });
}
function revisionMatches(body,room){if(!Number.isSafeInteger(body.revision)||body.revision!==room.revision)fail(409,'STALE_STATE','牌桌已更新，请看最新牌面后再操作');}
async function commit(store,previous,next){next.revision=previous.revision+1;next.updatedAt=Date.now();if(!await store.compareAndSwap(next,previous.revision))fail(409,'STALE_STATE','有人刚刚操作了牌桌，请刷新后重试');}

export function createApi(store) {
  const recentCreates = new Map();
  function throttle(request) {
    const ip = request.headers.get('cf-connecting-ip') || 'local', now = Date.now();
    const recent = (recentCreates.get(ip) || []).filter(at => now - at < 60000);
    if (recent.length >= 10) fail(429, 'RATE_LIMIT', '建房太频繁，请稍后再试');
    recent.push(now); recentCreates.set(ip, recent); if (recentCreates.size > 5000) recentCreates.clear();
  }
  const handle = async function(request) { try {
    const url = new URL(request.url), method = request.method;
    if (!url.pathname.startsWith('/api/')) return null;
    const origin = request.headers.get('origin'); if (origin && origin !== url.origin) fail(403, 'ORIGIN', '不接受跨站请求');
    if (method === 'GET' && url.pathname === '/api/health') return json({ ok: true, service: 'flower-mahjong', version: '0.7.0', rulesVersion: 3 });
    if (method === 'POST' && url.pathname === '/api/profile') {
      const body = await bodyOf(request);
      // A browser may generate and persist a random identity before registration,
      // so an interrupted response or concurrent tabs cannot strand its credential.
      if (body.playerToken !== undefined) {
        if (typeof body.playerToken !== 'string' || !/^[a-f0-9]{64}$/.test(body.playerToken)) fail(400, 'BAD_PROFILE_TOKEN', '个人记录凭证格式不正确');
        const created = await store.createProfile(await hashToken(body.playerToken), Date.now());
        return json({ playerToken: body.playerToken, token: body.playerToken }, created ? 201 : 200);
      }
      if (request.headers.has('x-player-token') || request.headers.has('authorization')) {
        await profileHashFor(store, request, true);
        const token = request.headers.get('x-player-token') || request.headers.get('authorization').slice(7);
        return json({ playerToken: token, token });
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        const token = randomToken();
        if (await store.createProfile(await hashToken(token), Date.now())) return json({ playerToken: token, token }, 201);
      }
      fail(503, 'BUSY', '暂时无法建立个人记录，请稍后再试');
    }
    if (method === 'GET' && url.pathname === '/api/profile/history') {
      const hash = await profileHashFor(store, request, true), records = [];
      for (const id of await store.listProfileRooms(hash)) {
        const room = await store.get(id);
        if (room) records.push(...recordsForProfile(room, hash));
      }
      // One room-game-seat key, regardless of reconnects, retries or room restarts.
      const unique = [...new Map(records.map(record => [`${record.roomId}:${record.gameId}:${record.seat}`, record])).values()];
      unique.sort((a, b) => b.startedAt - a.startedAt || b.gameId.localeCompare(a.gameId));
      const settled = unique.filter(record => record.status === 'finished');
      return json({ summary: { settledGames: settled.length, totalScore: settled.reduce((sum, record) => sum + record.score, 0) }, records: unique });
    }
    if (method === 'POST' && url.pathname === '/api/rooms') {
      const body = await bodyOf(request), name = playerName(body.name), preference = characterPreference(body.preferredCharacter); throttle(request);
      const now = Date.now(), playerHash = await profileHashFor(store, request);
      const token = randomToken(), person = { name, preferredCharacter: preference, tokenHash: await hashToken(token), lastSeen: now, ...(playerHash ? { playerHash } : {}) };
      for (let attempt = 0; attempt < 5; attempt++) {
        const room = { id: randomCode(), revision: 0, hostSeat: 0, seats: [person, null, null], game: null, createdAt: now, updatedAt: now };
        if (playerHash) await store.linkProfileRoom(playerHash, room.id);
        if (await store.insert(room)) return json({ roomId: room.id, token, state: publicRoom(room, 0) }, 201);
      }
      fail(503, 'BUSY', '暂时无法建房，请稍后再试');
    }
    const match = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{8})(?:\/(join|action|start|leave|resume))?$/);
    if (!match) fail(404, 'NOT_FOUND', '没有找到这个接口');
    const [, id, operation] = match;
    let room = await store.get(id); if (!room) fail(404, 'ROOM_NOT_FOUND', '没有找到这个房间，请检查房间号');
    const playerHash = await profileHashFor(store, request);
    if (method === 'POST' && operation === 'join') {
      const body = await bodyOf(request), name = playerName(body.name), preference = characterPreference(body.preferredCharacter);
      if (room.game && room.game.phase !== 'finished') fail(409, 'STARTED', '牌局已经开始，请使用原来的浏览器重连');
      if (room.seats.some(person => person?.name === name)) fail(409, 'NAME_TAKEN', '已有同名玩家，请换一个落座名字');
      if (playerHash && room.seats.some(person => person?.playerHash === playerHash)) fail(409, 'ALREADY_SEATED', '你已在这桌落座，请使用原来的座位凭证重连');
      let seat = body.seat; if (seat === undefined) seat = room.seats.findIndex(person => !person);
      if (!Number.isInteger(seat) || seat < 0 || seat > 2) fail(409, 'ROOM_FULL', '三个位置都坐满了');
      if (room.seats[seat]) fail(409, 'SEAT_TAKEN', '这个座位已有人，请换一个位置');
      const token = randomToken(), next = structuredClone(room); ensureGameMetadata(next);
      next.seats[seat] = { name, preferredCharacter: preference, tokenHash: await hashToken(token), lastSeen: Date.now(), ...(playerHash ? { playerHash } : {}) };
      if (playerHash) await store.linkProfileRoom(playerHash, id);
      selectHost(next); await commit(store, room, next);
      return json({ roomId: id, token, state: publicRoom(next, seat) }, 201);
    }
    const tokenHash = await credentialHash(request);
    if (method === 'POST' && operation === 'leave') {
      await bodyOf(request);
      // Leaving expresses intent, not a game move: safely retry on a concurrent
      // move/join/start while re-authenticating the exact credential each time.
      for (let attempt = 0; attempt < 6; attempt++) {
        const seat = room.seats.findIndex(person => person?.tokenHash === tokenHash);
        if (seat < 0) {
          const departure = room.departures?.find(person => person.tokenHash === tokenHash);
          if (!departure) fail(401, 'UNAUTHORIZED', '座位凭证失效，请重新进入房间');
          assertIdentity(departure, playerHash);
          return json({ left: true, detached: false, roomId: id });
        }
        assertIdentity(room.seats[seat], playerHash);
        const wasDetached = Boolean(room.seats[seat].detached);
        const next = structuredClone(room), bound = await bindProfile(store, next, seat, playerHash); ensureGameMetadata(next);
        if (wasDetached && !bound && room.game && room.game.phase !== 'finished') return json({ left: true, detached: true, roomId: id });
        const detached = Boolean(next.game && next.game.phase !== 'finished');
        if (detached) { next.seats[seat].detached = true; next.seats[seat].lastSeen = 0; }
        else { (next.departures ||= []).push({ tokenHash, playerHash: next.seats[seat].playerHash || null, seat, at: Date.now() }); next.seats[seat] = null; }
        selectHost(next); if (!wasDetached) logLifecycle(next, 'leave', seat, Date.now());
        try { await commit(store, room, next); return json({ left: true, detached, roomId: id }); }
        catch (error) { if (!(error instanceof ApiError) || error.code !== 'STALE_STATE') throw error; }
        room = await store.get(id); if (!room) fail(404, 'ROOM_NOT_FOUND', '没有找到这个房间');
      }
      fail(409, 'STALE_STATE', '牌桌仍在更新，请再试一次离开');
    }
    const seat = room.seats.findIndex(person => person?.tokenHash === tokenHash);
    if (seat < 0) fail(401, 'UNAUTHORIZED', '座位凭证失效，请重新进入房间');
    assertIdentity(room.seats[seat], playerHash);
    if (method === 'POST' && operation === 'resume') {
      await bodyOf(request);
      const next = structuredClone(room), bound = await bindProfile(store, next, seat, playerHash);
      if (next.seats[seat].detached || bound || next.hostSeat === null) {
        const wasDetached = Boolean(next.seats[seat].detached);
        next.seats[seat].detached = false; next.seats[seat].lastSeen = Date.now(); selectHost(next);
        if (wasDetached) logLifecycle(next, 'resume', seat, Date.now());
        await commit(store, room, next); room = next;
      }
      return json({ state: publicRoom(room, seat) });
    }
    if (room.seats[seat].detached) fail(409, 'SEAT_DETACHED', '你已离开这桌，请通过这桌链接重新连接');
    if (method === 'GET' && !operation) {
      if (playerHash && (room.seats[seat].playerHash !== playerHash || (room.game && (!room.gameMeta || (room.gameMeta.participants[seat]?.tokenHash === tokenHash && !room.gameMeta.participants[seat]?.playerHash))))) {
        const next = structuredClone(room); await bindProfile(store, next, seat, playerHash); await commit(store, room, next); room = next;
      }
      const now = Date.now();
      if (now - room.seats[seat].lastSeen >= 10000) {
        const touched = await store.touch(id, seat, now, tokenHash, room.revision);
        if (!touched) fail(409, 'STALE_STATE', '牌桌已更新，请重新读取');
        room.seats[seat].lastSeen = now;
      }
      const since = url.searchParams.get('since');
      if (since !== null && /^\d+$/.test(since) && Number(since) === room.revision) return json({ unchanged: true, revision: room.revision, connections: room.seats.map(person => connected(person, now)) });
      return json({ state: publicRoom(room, seat) });
    }
    if (method === 'POST' && operation === 'start') {
      const body = await bodyOf(request); revisionMatches(body, room);
      if (seat !== room.hostSeat) fail(403, 'HOST_ONLY', '只有房主可以开始');
      if (room.seats.some(person => !person || person.detached)) fail(409, 'NOT_FULL', '三位玩家都落座后才能开始');
      if (room.game && room.game.phase !== 'finished') fail(409, 'PLAYING', '这一局还没结束');
      const rules = startRules(body.options);
      const next = structuredClone(room); await bindProfile(store, next, seat, playerHash); ensureGameMetadata(next);
      if (next.game) (next.archivedGames ||= []).push(archiveFinishedGame(next));
      const now = Date.now(); next.game = createGame({ dealerSeat: dealerForNextGame(next.game), rules }); next.gameMeta = newGameMetadata(next, randomToken().slice(0, 32), now); next.seats[seat].lastSeen = now;
      next.gameMeta.characters = assignCharacters(next.seats.map(person => person.preferredCharacter));
      await commit(store, room, next); return json({ state: publicRoom(next, seat) });
    }
    if (method === 'POST' && operation === 'action') {
      const body = await bodyOf(request); revisionMatches(body, room);
      if (!room.game) fail(409, 'NOT_STARTED', '房主还没有开始这局');
      const supplied = body.action;
      if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied) || typeof supplied.type !== 'string') fail(400, 'BAD_ACTION', '操作格式不正确');
      const action = { type: supplied.type };
      if (supplied.tile !== undefined) { if (!Number.isInteger(supplied.tile) || supplied.tile < 0 || supplied.tile > 17) fail(400, 'BAD_TILE', '牌的编号不正确'); action.tile = supplied.tile; }
      const engine = engineFor(room.game), next = structuredClone(room);
      await bindProfile(store, next, seat, playerHash); ensureGameMetadata(next);
      try { next.game = engine.apply(room.game, seat, action); } catch (error) { fail(422, 'ILLEGAL_ACTION', error.message || '当前不能这样操作'); }
      next.seats[seat].lastSeen = Date.now();
      if (next.game.phase === 'finished' && !next.gameMeta.finishedAt) next.gameMeta.finishedAt = Date.now();
      await commit(store, room, next); return json({ state: publicRoom(next, seat) });
    }
    fail(405, 'METHOD', '不支持这种操作');
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message, code: error.code }, error.status);
    // Never log request bodies, credentials, SQL bindings or private game state.
    console.error('Request failed:', error?.name || 'Error');
    return json({ error: '服务器暂时出了点问题，请稍后刷新', code: 'SERVER_ERROR' }, 500);
  } };
  return async request => {
    const started = performance.now(), response = await handle(request);
    if (response) response.headers.set('server-timing', `app;dur=${(performance.now() - started).toFixed(1)}`);
    return response;
  };
}
