import { engineFor, modeForRoom } from './game-engines.js';

// 记录层：把房间生命周期与局内规则隔离，保存可验证的参与身份和公开成绩。
// History layer: separate room lifecycle from game rules and preserve verifiable participation and public scores.
// 旧存档只补当前可证明的一局；不创造已丢失历史，也不改引擎内部状态。
// Backfill only the verifiable current game in legacy saves; do not invent lost history or alter engine state.
export function ensureGameMetadata(room) {
  if (!room.game || room.gameMeta) return;
  // 稳定的旧局 ID 保证重复读取一致；旧时间只是估计值，界面可据标记说明。
  // A stable legacy ID survives rereads; legacy timestamps are marked as estimates for display.
  room.gameMeta = {
    id: `legacy-${room.id}-${room.createdAt}`,
    startedAt: room.createdAt,
    startedAtEstimated: true,
    finishedAt: room.game.phase === 'finished' ? room.updatedAt : null,
    finishedAtEstimated: room.game.phase === 'finished',
    participants: room.seats.map((person, seat) =>
      person
        ? {
            seat,
            name: person.name,
            tokenHash: person.tokenHash,
            playerHash: person.playerHash || null,
          }
        : null,
    ),
  };
}
// 开局拍下参与者身份快照；后续换座或改名不能改变历史归属。
// Snapshot participant identities at start so later seat replacements cannot change history ownership.
export function newGameMetadata(room, id, at) {
  const config = modeForRoom(room).gameConfiguration(room);
  return {
    id,
    startedAt: at,
    finishedAt: null,
    // 配置由本模式选择公开字段；旧局不回填，显式模式也保留在记录中。
    // Each mode selects public configuration fields; never backfill old games, and preserve an explicit mode in records.
    ...(room.game?.gameMode !== undefined ? { gameMode: room.game.gameMode } : {}),
    ...(config ? { config } : {}),
    participants: room.seats.map((person, seat) => ({
      seat,
      name: person.name,
      tokenHash: person.tokenHash,
      playerHash: person.playerHash || null,
    })),
  };
}
// 历史和现场视图共用同一个模式/版本选择，避免成都记录误套花麻将的白名单或隐私规则。
// History and live views share mode/version dispatch; Chengdu records must not inherit Flower allowlists or privacy rules.
export function publicEvents(game, viewerSeat = null, participantNames = [], archived = false) {
  return engineFor(game, { archived }).publicEvents(game, viewerSeat, participantNames);
}
/** Keep all historical scores and public events, without copying private walls/hands forever. */
// 归档只留下元信息、成绩和公开事件，不永久复制私人手牌或牌墙。
// Archive metadata, scores, and public events without retaining private hands or walls in each archive.
export function archiveFinishedGame(room) {
  const game = room.game;
  return {
    meta: structuredClone(room.gameMeta),
    updatedAt: room.updatedAt,
    game: {
      schemaVersion: game.schemaVersion || 1,
      ...(game.gameMode !== undefined ? { gameMode: game.gameMode } : {}),
      // 使用本局快照而非此刻房间属性，归档不能被之后的对象变更影响。
      // Archive the round snapshot rather than mutable current-room properties.
      ...(room.gameMeta?.config ? { config: structuredClone(room.gameMeta.config) } : {}),
      ...(game.runtimeKind ? { runtimeKind: game.runtimeKind, rulesVersion: game.rulesVersion } : {}),
      phase: 'finished',
      finishReason: game.finishReason,
      players: game.players.map((player) => ({
        score: player.score,
        ...playerSummary(game, player),
      })),
      history: publicEvents(game),
    },
  };
}
// 把存档与当前局统一遍历，仅提取匹配个人凭证摘要的参与记录。
// Scan archives and the current game, returning participation records only for the matching profile digest.
export function recordsForProfile(room, playerHash) {
  const records = [];
  const games = [
    ...(room.archivedGames || []).map((archive) => ({
      ...archive,
      archived: true,
    })),
    ...(room.game && room.gameMeta
      ? [
          {
            game: room.game,
            meta: room.gameMeta,
            updatedAt: room.updatedAt,
            archived: false,
          },
        ]
      : []),
  ];
  for (const entry of games) {
    const { game, meta } = entry;
    for (const participant of meta.participants) {
      // 房间索引不是权限：必须在这一局的参与快照中找到本人身份。
      // The room index is not authorization: the game participant snapshot must match the profile.
      if (!participant || participant.playerHash !== playerHash) continue;
      const seat = participant.seat,
        person = room.seats[seat];
      const finished = game.phase === 'finished';
      // finished 代表已结算；未结束时凭座位仍属本人且未离席区分 playing/detached。
      // Finished means settled; active-game status depends on matching occupancy and the detach flag.
      records.push({
        gameId: meta.id,
        roomId: room.id,
        seat,
        name: participant.name,
        status: finished
          ? 'finished'
          : !person || person.tokenHash !== participant.tokenHash || person.detached
            ? 'detached'
            : 'playing',
        score: game.players[seat].score,
        huCount: playerSummary(game, game.players[seat], entry.archived).huCount,
        startedAt: meta.startedAt,
        startedAtEstimated: Boolean(meta.startedAtEstimated),
        finishedAtEstimated: Boolean(meta.finishedAtEstimated),
        updatedAt: entry.updatedAt,
        finishedAt: finished ? meta.finishedAt || entry.updatedAt : null,
        rulesVersion: game.schemaVersion || 1,
        ...(game.gameMode !== undefined ? { gameMode: game.gameMode } : {}),
        // 当前与归档记录采用同一局配置；缺配置旧历史仍保持原样。
        // Live and archived records expose the same round configuration; old records remain unconfigured.
        ...(meta.config ? { config: structuredClone(meta.config) } : {}),
        finishReason: game.finishReason || null,
        players: game.players.map((player, index) => ({
          seat: index,
          name: meta.participants[index]?.name || `${index + 1}号位`,
          score: player.score,
        })),
        events: publicEvents(game, seat, meta.participants.map((person) => person?.name), entry.archived),
      });
    }
  }
  return records;
}
/** Public scores for this room only. Never merge by nickname or replacement seat.
 * Recomputed from the saved ledger, so reloads/retries cannot double-count a round. */
// 本桌成绩从账本重新计算，绝不增写累计计数器，避免刷新或重试重复结算。
// Recompute room totals from the ledger rather than incrementing counters on rereads or retries.
export function tableScores(room) {
  // 计算旧桌时只给浅拷贝补元信息；不把只读查询变成持久化写入。
  // For legacy rooms, backfill metadata on a shallow copy, not as a persisted side effect of reading.
  if (room.game && !room.gameMeta) {
    room = {
      ...room,
    };
    ensureGameMetadata(room);
  }
  const entries = [
    ...(room.archivedGames || []),
    ...(room.game && room.gameMeta
      ? [
          {
            game: room.game,
            meta: room.gameMeta,
          },
        ]
      : []),
  ];
  const totals = new Map();
  // 内部以座位凭证摘要聚合同一参与者；对外只返回不含凭证的显示 ID。
  // Group participants internally by seat digest; expose only a display ID without credentials.
  const addPerson = (person) => {
    if (!person?.tokenHash) return null;
    if (!totals.has(person.tokenHash))
      totals.set(person.tokenHash, {
        id: `player-${totals.size + 1}`,
        name: person.name,
        seat: null,
        totalScore: 0,
        settledScore: 0,
        provisionalScore: 0,
        settledGames: 0,
      });
    return totals.get(person.tokenHash);
  };
  // 每个局 ID / 座位只计一次；同名或同座位的新玩家不会继承旧账。
  // Count each game ID / seat once; a new occupant never inherits scores by name or seat.
  const seen = new Set();
  for (const { game, meta } of entries) {
    for (const person of meta?.participants || []) {
      if (!person) continue;
      const key = `${meta.id}:${person.seat}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const row = addPerson(person);
      if (!row) continue;
      const score = game.players[person.seat]?.score ?? 0;
      row.totalScore += score;
      // 把已结算与暂记分别累计；totalScore 包含两者，但 settledGames 只算结束局。
      // Track settled and provisional scores separately; totalScore includes both, settledGames only finished games.
      if (game.phase === 'finished') {
        row.settledScore += score;
        row.settledGames++;
      } else row.provisionalScore += score;
    }
  }
  // 最后补入尚未打过牌的现任玩家，并更新当前座位和离席显示状态。
  // Finally include current occupants with no games and update their seat and detach display state.
  for (const [seat, person] of room.seats.entries()) {
    const row = addPerson(person);
    if (row) {
      row.name = person.name;
      row.seat = seat;
      row.detached = Boolean(person.detached);
    }
  }
  // 没有当前座位的历史参与者默认已离席；其旧成绩仍保留。
  // Historical participants without a current seat default to detached and retain their scores.
  return [...totals.values()].map((row) => ({
    ...row,
    detached: row.detached ?? true,
  }));
}

// 公共统计只由所属模式派生；不把花麻将的huCount字段补进成都权威玩家状态。
// Derive public counts through the mode without adding Flower huCount fields to authoritative Chengdu players.
export function playerSummary(game, player, archived = false) {
  const engine = engineFor(game, { archived });
  return engine.playerSummary ? engine.playerSummary(player) : { huCount: player.huCount || 0, kongCount: player.kongCount || 0 };
}
