import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const mahjongRooms=sqliteTable('mahjong_rooms',{
 id:text('id').primaryKey(),revision:integer('revision').notNull(),state:text('state').notNull(),updatedAt:integer('updated_at').notNull()
});

export const mahjongProfiles = sqliteTable('mahjong_profiles', {
 tokenHash: text('token_hash').primaryKey(), createdAt: integer('created_at').notNull()
});
export const mahjongPlayerRooms = sqliteTable('mahjong_player_rooms', {
 playerHash: text('player_hash').notNull(), roomId: text('room_id').notNull()
}, table => [primaryKey({ columns: [table.playerHash, table.roomId] })]);
