/** Single-process memory store, also used by deterministic API tests. */
export class MemoryStore {
  constructor(rooms=[]){this.rooms=new Map(rooms.map(r=>[r.id,structuredClone(r)]));}
  async get(id){const room=this.rooms.get(id);return room?structuredClone(room):null;}
  async insert(room){if(this.rooms.has(room.id))return false;this.rooms.set(room.id,structuredClone(room));await this.persist();return true;}
  async compareAndSwap(room,revision){if(this.rooms.get(room.id)?.revision!==revision)return false;this.rooms.set(room.id,structuredClone(room));await this.persist();return true;}
  async touch(id,seat,at){const room=this.rooms.get(id);if(room?.seats[seat])room.seats[seat].lastSeen=at;}
  async persist(){}
}
/** D1 uses conditional UPDATE, so concurrent Workers cannot reserve a fourth seat or apply a move twice. */
export class D1Store {
  constructor(db){this.db=db;}
  async get(id){const row=await this.db.prepare('SELECT state FROM mahjong_rooms WHERE id = ?').bind(id).first();return row?JSON.parse(row.state):null;}
  async insert(room){const r=await this.db.prepare('INSERT OR IGNORE INTO mahjong_rooms (id, revision, state, updated_at) VALUES (?, ?, ?, ?)').bind(room.id,room.revision,JSON.stringify(room),room.updatedAt).run();return r.meta.changes===1;}
  async compareAndSwap(room,revision){const r=await this.db.prepare('UPDATE mahjong_rooms SET revision = ?, state = ?, updated_at = ? WHERE id = ? AND revision = ?').bind(room.revision,JSON.stringify(room),room.updatedAt,room.id,revision).run();return r.meta.changes===1;}
  async touch(id,seat,at){await this.db.prepare('UPDATE mahjong_rooms SET state = json_set(state, ?, ?) WHERE id = ?').bind(`$.seats[${seat}].lastSeen`,at,id).run();}
}
