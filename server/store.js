// 存储接口：get 返回快照，insert 防重号，compareAndSwap 防旧版本覆盖新版本。
// Store contract: get returns a snapshot, insert prevents collisions, compareAndSwap prevents stale overwrites.
// 单进程内存实现供本地服务和测试使用；FileStore 在其基础上增加磁盘保存。
// Single-process memory implementation for local service/tests; FileStore adds disk persistence.
export class MemoryStore {
  // 导入数据时深拷贝，调用者修改原对象不会偷偷改变存储。
  // Deep-clone imported data so callers cannot mutate storage through shared references.
  constructor(rooms = [], profiles = []) {
    this.rooms = new Map(rooms.map((room) => [room.id, structuredClone(room)]));
    this.profiles = new Map(
      profiles.map((profile) => [profile.tokenHash, structuredClone(profile)]),
    );
  }
  // 读取返回独立快照；调用者必须显式 CAS，不能修改读出的对象就算保存。
  // Return an independent snapshot; callers must explicitly CAS rather than mutate a retrieved reference.
  async get(id) {
    const room = this.rooms.get(id);
    return room ? structuredClone(room) : null;
  }
  // 只允许新房间号；先同步更新内存，再等待持久化完成。
  // Accept only new room IDs; update memory synchronously before awaiting persistence.
  async insert(room) {
    if (this.rooms.has(room.id)) return false;
    this.rooms.set(room.id, structuredClone(room));
    await this.persist();
    return true;
  }
  // 检查并替换在第一次 await 之前完成，使单进程内两个请求不能同时赢得同一版本。
  // Check and replace before the first await so two in-process requests cannot both win the same revision.
  async compareAndSwap(room, revision) {
    if (this.rooms.get(room.id)?.revision !== revision) return false;
    this.rooms.set(room.id, structuredClone(room));
    await this.persist();
    return true;
  }
  // 心跳不加业务 revision；检查座位凭证、离席和版本，且时间只增不减。
  // Heartbeats do not increment revision; verify credential, detach flag, and revision, with monotonic time.
  async touch(id, seat, at, tokenHash, revision) {
    const room = this.rooms.get(id),
      person = room?.seats[seat];
    if (!person || person.detached || person.tokenHash !== tokenHash || room.revision !== revision)
      return false;
    person.lastSeen = Math.max(person.lastSeen || 0, at);
    return true;
  }
  // 个人凭证摘要必须唯一；重复注册返回 false，不覆盖已有索引。
  // Profile digests must be unique; duplicate registration returns false without overwriting the index.
  async createProfile(tokenHash, createdAt) {
    if (this.profiles.has(tokenHash)) return false;
    this.profiles.set(tokenHash, {
      tokenHash,
      createdAt,
      rooms: [],
    });
    await this.persist();
    return true;
  }
  // 读取个人身份快照，不把内部可变索引直接交给调用者。
  // Return a profile snapshot without exposing the mutable internal index.
  async getProfile(tokenHash) {
    const profile = this.profiles.get(tokenHash);
    return profile ? structuredClone(profile) : null;
  }
  // 同一房间只加入索引一次；索引用于查找，不代表历史读取授权。
  // Link a room once; the index supports lookup but does not authorize history access.
  async linkProfileRoom(tokenHash, roomId) {
    const profile = this.profiles.get(tokenHash);
    if (!profile) throw new Error('Profile not found');
    if (!profile.rooms.includes(roomId)) {
      profile.rooms.push(roomId);
      await this.persist();
    }
  }
  // 返回数组副本，避免外部 push/splice 修改实际索引。
  // Return an array copy so external push/splice cannot mutate the stored index.
  async listProfileRooms(tokenHash) {
    return [...(this.profiles.get(tokenHash)?.rooms || [])];
  }
  // 内存基类无需落盘；子类覆盖此钩子。心跳本身不调用该钩子。
  // The memory base needs no disk write; subclasses override this hook. Heartbeats do not call it.
  async persist() {}
}
// D1 用数据库条件更新实现跨 Worker 的 CAS；不能用先读后无条件写替代。
// D1 uses conditional database updates for cross-Worker CAS, never a read followed by an unconditional write.
export class D1Store {
  // 接收已绑定 D1 数据库；本层不创建数据库、不执行迁移。
  // Accept the bound D1 database; this layer neither creates databases nor runs migrations.
  constructor(db) {
    this.db = db;
  }
  // 读取并解析完整房间快照；不存在返回 null。
  // Read and parse a full room snapshot; return null if absent.
  async get(id) {
    // 参数绑定与 SQL 文本分开；state 是包含私人状态的完整 JSON，不可直接发给客户端。
    // Bind parameters separately from SQL; state is full private JSON and must not be returned directly to clients.
    const row = await this.db
      .prepare('SELECT state FROM mahjong_rooms WHERE id = ?')
      .bind(id)
      .first();
    return row ? JSON.parse(row.state) : null;
  }
  // 尝试插入新房间，返回是否占到这个房间号。
  // Try inserting a new room and return whether its ID was claimed.
  async insert(room) {
    // 主键冲突忽略写入，changes 恰为 1 才表示本次创建成功。
    // Ignore primary-key collisions; exactly one changed row means this creation succeeded.
    const result = await this.db
      .prepare(
        'INSERT OR IGNORE INTO mahjong_rooms (id, revision, state, updated_at) VALUES (?, ?, ?, ?)',
      )
      .bind(room.id, room.revision, JSON.stringify(room), room.updatedAt)
      .run();
    return result.meta.changes === 1;
  }
  // 用预期旧版本提交完整房间；失败不覆盖其他写入。
  // Commit a full room against the expected revision without overwriting competing writes.
  async compareAndSwap(room, revision) {
    // WHERE 同时匹配房间和旧 revision；只有一个并发请求可以把同一版本更新掉。
    // WHERE matches both room and expected revision so only one concurrent writer wins that revision.
    const result = await this.db
      .prepare(
        'UPDATE mahjong_rooms SET revision = ?, state = ?, updated_at = ? WHERE id = ? AND revision = ?',
      )
      .bind(room.revision, JSON.stringify(room), room.updatedAt, room.id, revision)
      .run();
    return result.meta.changes === 1;
  }
  // 更新指定占座者的心跳，返回此次条件更新是否成功。
  // Refresh this occupant’s heartbeat and return whether the conditional update succeeded.
  async touch(id, seat, at, tokenHash, revision) {
    // 只定点更新对应座位的 lastSeen，避免心跳覆盖整桌；座位身份与版本仍在 SQL 中验证。
    // Update only the seat heartbeat, not the whole room; SQL still checks identity and revision.
    const prefix = `$.seats[${seat}]`;
    const result = await this.db
      .prepare(
        'UPDATE mahjong_rooms SET state = json_set(state, ?, MAX(COALESCE(json_extract(state, ?), 0), ?)) WHERE id = ? AND revision = ? AND json_extract(state, ?) = ? AND COALESCE(json_extract(state, ?), 0) = 0',
      )
      .bind(
        `${prefix}.lastSeen`,
        `${prefix}.lastSeen`,
        at,
        id,
        revision,
        `${prefix}.tokenHash`,
        tokenHash,
        `${prefix}.detached`,
      )
      .run();
    return result.meta.changes === 1;
  }
  // 登记个人凭证摘要；重复注册不改创建时间。
  // Register a profile digest; duplicate registration preserves its creation time.
  async createProfile(tokenHash, createdAt) {
    // 数据库主键保证个人身份注册幂等；返回是否确实新增。
    // The primary key makes profile registration idempotent; return whether insertion actually occurred.
    const result = await this.db
      .prepare('INSERT OR IGNORE INTO mahjong_profiles (token_hash, created_at) VALUES (?, ?)')
      .bind(tokenHash, createdAt)
      .run();
    return result.meta.changes === 1;
  }
  // 查找个人凭证摘要是否登记；调用者只依赖记录存在与否。
  // Look up a registered profile digest; callers depend only on record existence.
  async getProfile(tokenHash) {
    return this.db
      .prepare('SELECT token_hash, created_at FROM mahjong_profiles WHERE token_hash = ?')
      .bind(tokenHash)
      .first();
  }
  // 为个人追加候选房间索引；允许安全重复调用。
  // Add a candidate-room link for a profile, safely allowing repeated calls.
  async linkProfileRoom(tokenHash, roomId) {
    // 复合主键去重个人/房间索引；孤立索引不会授予私人记录权限。
    // The composite key deduplicates profile/room links; orphan links cannot grant access to private records.
    await this.db
      .prepare('INSERT OR IGNORE INTO mahjong_player_rooms (player_hash, room_id) VALUES (?, ?)')
      .bind(tokenHash, roomId)
      .run();
  }
  // 取出此个人的候选房间号数组，不直接查询或泄露其他人的记录。
  // List this profile’s candidate room IDs without returning other profiles’ records.
  async listProfileRooms(tokenHash) {
    // 只返回候选房间号，实际历史归属由 history.js 再验证。
    // Return candidate room IDs; history.js verifies actual record ownership.
    const result = await this.db
      .prepare('SELECT room_id FROM mahjong_player_rooms WHERE player_hash = ?')
      .bind(tokenHash)
      .all();
    return result.results.map((row) => row.room_id);
  }
}
