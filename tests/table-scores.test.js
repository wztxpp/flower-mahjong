import test from 'node:test';
import assert from 'node:assert/strict';
import { tableScores, ensureGameMetadata } from '../server/history.js';

const people = ['甲', '乙', '丙'].map((name, seat) => ({ name, seat, tokenHash: `private-seat-${seat}`, playerHash: `private-profile-${seat}` }));
const entry = (id, scores, phase = 'finished', participants = people) => ({
  meta: { id, participants: structuredClone(participants) },
  game: { phase, players: scores.map(score => ({ score })) },
});
function roomFixture() {
  const round = entry('current', [3, -1, -2], 'turn');
  return { id: 'ABCDEF23', seats: structuredClone(people), archivedGames: [entry('one', [8, -3, -5]), entry('two', [-2, 5, -3])], game: round.game, gameMeta: round.meta };
}

test('table total adds settled rounds and current provisional points without changing source ledger', () => {
  const room = roomFixture(), before = structuredClone(room);
  const rows = tableScores(room);
  assert.deepEqual(rows.map(row => row.totalScore), [9, 1, -10]);
  assert.deepEqual(rows.map(row => row.settledScore), [6, 2, -8]);
  assert.deepEqual(rows.map(row => row.provisionalScore), [3, -1, -2]);
  assert.deepEqual(rows.map(row => row.settledGames), [2, 2, 2]);
  assert.equal(rows.reduce((sum, row) => sum + row.totalScore, 0), 0);
  assert.deepEqual(tableScores(JSON.parse(JSON.stringify(room))), rows);
  assert.deepEqual(tableScores(room), rows);
  assert.deepEqual(room, before);
  assert.doesNotMatch(JSON.stringify(rows), /private-seat|private-profile|tokenHash|playerHash/);
});

test('settling and archiving changes accounting columns but never double-counts the current game', () => {
  const room = roomFixture(); room.game.phase = 'finished';
  const settled = tableScores(room);
  assert.deepEqual(settled.map(row => row.settledScore), [9, 1, -10]);
  assert.deepEqual(settled.map(row => row.provisionalScore), [0, 0, 0]);
  room.archivedGames.push(entry('current', [3, -1, -2]));
  assert.deepEqual(tableScores(room), settled, 'duplicate archived current ID should not add the same game twice');
  const next = entry('next', [0, 0, 0], 'turn'); room.game = next.game; room.gameMeta = next.meta;
  assert.deepEqual(tableScores(room).map(row => row.totalScore), settled.map(row => row.totalScore));
});

test('same-name replacement cannot inherit another player’s score; departed totals remain conserved', () => {
  const room = roomFixture(); room.game.phase = 'finished';
  room.seats[2] = { name: '丙', tokenHash: 'new-secret-seat', playerHash: people[2].playerHash };
  const rows = tableScores(room);
  assert.equal(rows.length, 4);
  assert.equal(rows[2].seat, null); assert.equal(rows[2].detached, true); assert.equal(rows[2].totalScore, -10);
  assert.equal(rows[3].seat, 2); assert.equal(rows[3].totalScore, 0);
  assert.equal(rows.reduce((sum, row) => sum + row.totalScore, 0), 0);
  assert.notEqual(rows[2].id, rows[3].id);
  assert.doesNotMatch(JSON.stringify(rows), /private-|new-secret/);
});

test('detaching/reconnecting never erases scores and a lobby starts all present players at zero', () => {
  const room = roomFixture(); const initial = tableScores(room);
  room.seats[1].detached = true;
  assert.equal(tableScores(room)[1].totalScore, initial[1].totalScore);
  assert.equal(tableScores(room)[1].detached, true);
  room.seats[1].detached = false; assert.deepEqual(tableScores(room), initial);
  const lobby = tableScores({ seats: [people[0], null, null] });
  assert.equal(lobby.length, 1); assert.equal(lobby[0].totalScore, 0);
});

test('old verifiable room receives only its known game; no fabricated lost history', () => {
  const room = { id: 'ABCDEF23', createdAt: 1, updatedAt: 2, seats: structuredClone(people), game: entry('old', [1, -1, 0]).game };
  ensureGameMetadata(room);
  assert.deepEqual(tableScores(room).map(row => row.totalScore), [1, -1, 0]);
});
