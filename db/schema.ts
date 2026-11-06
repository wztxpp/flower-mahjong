// Drizzle 的麻将领域表声明；这里仅描述现有结构，不执行迁移或改写存档。
// Drizzle declarations for the Mahjong domain; these describe existing tables without migrating or rewriting data.
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
// 房间主键定位桌子；revision 用于 CAS；state 包含完整私人 JSON；updated_at 是毫秒时间。
// The room key locates a table; revision supports CAS; state is private JSON; updated_at is epoch milliseconds.
export const mahjongRooms = sqliteTable('mahjong_rooms', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull(),
  state: text('state').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
// 只存匿名个人凭证摘要和创建时间，不存明文凭证。
// Store only the anonymous profile digest and creation time, never raw credentials.
export const mahjongProfiles = sqliteTable('mahjong_profiles', {
  tokenHash: text('token_hash').primaryKey(),
  createdAt: integer('created_at').notNull(),
});
// 个人到候选房间的索引；复合主键防重复，真正授权仍检查房间内的参与快照。
// Profile-to-room lookup index; the composite key prevents duplicates, while participant snapshots authorize access.
export const mahjongPlayerRooms = sqliteTable(
  'mahjong_player_rooms',
  {
    playerHash: text('player_hash').notNull(),
    roomId: text('room_id').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.playerHash, table.roomId],
    }),
  ],
);
