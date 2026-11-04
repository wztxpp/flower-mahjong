/** Single-process memory store, also used by deterministic API tests. */
export class MemoryStore {
  constructor(rooms = [], profiles = []) {
    this.rooms = new Map(rooms.map(room => [room.id, structuredClone(room)]));
    this.profiles = new Map(profiles.map(profile => [profile.tokenHash, structuredClone(profile)]));
  }
  async get(id) { const room = this.rooms.get(id); return room ? structuredClone(room) : null; }
  async insert(room) { if (this.rooms.has(room.id)) return false; this.rooms.set(room.id, structuredClone(room)); await this.persist(); return true; }
  async compareAndSwap(room, revision) { if (this.rooms.get(room.id)?.revision !== revision) return false; this.rooms.set(room.id, structuredClone(room)); await this.persist(); return true; }
  async touch(id, seat, at, tokenHash, revision) {
    const room = this.rooms.get(id), person = room?.seats[seat];
    if (!person || person.detached || person.tokenHash !== tokenHash || room.revision !== revision) return false;
    person.lastSeen = Math.max(person.lastSeen || 0, at);
    return true;
  }
  async createProfile(tokenHash, createdAt) {
    if (this.profiles.has(tokenHash)) return false;
    this.profiles.set(tokenHash, { tokenHash, createdAt, rooms: [] }); await this.persist(); return true;
  }
  async getProfile(tokenHash) { const profile = this.profiles.get(tokenHash); return profile ? structuredClone(profile) : null; }
  async linkProfileRoom(tokenHash, roomId) {
    const profile = this.profiles.get(tokenHash);
    if (!profile) throw new Error('Profile not found');
    if (!profile.rooms.includes(roomId)) { profile.rooms.push(roomId); await this.persist(); }
  }
  async listProfileRooms(tokenHash) { return [...(this.profiles.get(tokenHash)?.rooms || [])]; }
  async persist() {}
}

/** All room mutations use CAS. Heartbeats additionally check the exact seat credential and revision. */
export class D1Store {
  constructor(db) { this.db = db; }
  async get(id) { const row = await this.db.prepare('SELECT state FROM mahjong_rooms WHERE id = ?').bind(id).first(); return row ? JSON.parse(row.state) : null; }
  async insert(room) { const result = await this.db.prepare('INSERT OR IGNORE INTO mahjong_rooms (id, revision, state, updated_at) VALUES (?, ?, ?, ?)').bind(room.id, room.revision, JSON.stringify(room), room.updatedAt).run(); return result.meta.changes === 1; }
  async compareAndSwap(room, revision) { const result = await this.db.prepare('UPDATE mahjong_rooms SET revision = ?, state = ?, updated_at = ? WHERE id = ? AND revision = ?').bind(room.revision, JSON.stringify(room), room.updatedAt, room.id, revision).run(); return result.meta.changes === 1; }
  async touch(id, seat, at, tokenHash, revision) {
    const prefix = `$.seats[${seat}]`;
    const result = await this.db.prepare('UPDATE mahjong_rooms SET state = json_set(state, ?, MAX(COALESCE(json_extract(state, ?), 0), ?)) WHERE id = ? AND revision = ? AND json_extract(state, ?) = ? AND COALESCE(json_extract(state, ?), 0) = 0')
      .bind(`${prefix}.lastSeen`, `${prefix}.lastSeen`, at, id, revision, `${prefix}.tokenHash`, tokenHash, `${prefix}.detached`).run();
    return result.meta.changes === 1;
  }
  async createProfile(tokenHash, createdAt) {
    const result = await this.db.prepare('INSERT OR IGNORE INTO mahjong_profiles (token_hash, created_at) VALUES (?, ?)').bind(tokenHash, createdAt).run();
    return result.meta.changes === 1;
  }
  async getProfile(tokenHash) { return this.db.prepare('SELECT token_hash, created_at FROM mahjong_profiles WHERE token_hash = ?').bind(tokenHash).first(); }
  async linkProfileRoom(tokenHash, roomId) {
    await this.db.prepare('INSERT OR IGNORE INTO mahjong_player_rooms (player_hash, room_id) VALUES (?, ?)').bind(tokenHash, roomId).run();
  }
  async listProfileRooms(tokenHash) {
    const result = await this.db.prepare('SELECT room_id FROM mahjong_player_rooms WHERE player_hash = ?').bind(tokenHash).all();
    return result.results.map(row => row.room_id);
  }
}
