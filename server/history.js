/** Metadata lives alongside, never inside, versioned game engines. */
export function ensureGameMetadata(room) {
  if (!room.game || room.gameMeta) return;
  // Existing rooms have no generation marker. Their one verifiable current game
  // gets this deterministic ID; later starts always receive a fresh random ID.
  room.gameMeta = {
    id: `legacy-${room.id}-${room.createdAt}`,
    startedAt: room.createdAt, startedAtEstimated: true,
    finishedAt: room.game.phase === 'finished' ? room.updatedAt : null,
    finishedAtEstimated: room.game.phase === 'finished',
    participants: room.seats.map((person, seat) => person ? {
      seat, name: person.name, tokenHash: person.tokenHash, playerHash: person.playerHash || null,
    } : null),
  };
}

export function newGameMetadata(room, id, at) {
  return { id, startedAt: at, finishedAt: null, participants: room.seats.map((person, seat) => ({ seat, name: person.name, tokenHash: person.tokenHash, playerHash: person.playerHash || null })) };
}

// Explicit public-event fields avoid copying a future engine's private fields.
function publicEvents(game) {
  const allowed = ['revision', 'type', 'seat', 'source', 'message', 'tile', 'fromSeat', 'points', 'payments', 'score', 'newRadishes', 'radish', 'reason', 'automatic', 'afterKong', 'dragons'];
  return (game.history || []).map(event => {
    const result = {};
    for (const key of allowed) if (event[key] !== undefined && !(event.type === 'draw' && key === 'tile')) result[key] = structuredClone(event[key]);
    if (event.type === 'draw') result.message = `${Number.isInteger(event.seat) ? event.seat + 1 : ''}号位${event.source === 'replacement' ? '杠后补牌' : event.source === 'continuation' ? '胡后补摸' : '摸了一张牌'}。`;
    return result;
  });
}

/** Keep all historical scores and public events, without copying private walls/hands forever. */
export function archiveFinishedGame(room) {
  const game = room.game;
  return {
    meta: structuredClone(room.gameMeta), updatedAt: room.updatedAt,
    game: { schemaVersion: game.schemaVersion || 1, phase: 'finished', finishReason: game.finishReason,
      players: game.players.map(player => ({ score: player.score, huCount: player.huCount || 0, kongCount: player.kongCount || 0 })),
      history: publicEvents(game),
    },
  };
}

export function recordsForProfile(room, playerHash) {
  const records = [];
  const games = [...(room.archivedGames || []).map(archive => ({ ...archive, archived: true })), ...(room.game && room.gameMeta ? [{ game: room.game, meta: room.gameMeta, updatedAt: room.updatedAt, archived: false }] : [])];
  for (const entry of games) {
    const { game, meta } = entry;
    for (const participant of meta.participants) {
      if (!participant || participant.playerHash !== playerHash) continue;
      const seat = participant.seat, person = room.seats[seat];
      const finished = game.phase === 'finished';
      records.push({
        gameId: meta.id, roomId: room.id, seat, name: participant.name,
        status: finished ? 'finished' : !person || person.tokenHash !== participant.tokenHash || person.detached ? 'detached' : 'playing',
        score: game.players[seat].score, huCount: game.players[seat].huCount || 0,
        startedAt: meta.startedAt, startedAtEstimated: Boolean(meta.startedAtEstimated), finishedAtEstimated: Boolean(meta.finishedAtEstimated), updatedAt: entry.updatedAt, finishedAt: finished ? meta.finishedAt || entry.updatedAt : null,
        rulesVersion: game.schemaVersion || 1, finishReason: game.finishReason || null,
        players: game.players.map((player, index) => ({ seat: index, name: meta.participants[index]?.name || `${index + 1}号位`, score: player.score })),
        events: publicEvents(game),
      });
    }
  }
  return records;
}
