CREATE TABLE IF NOT EXISTS `mahjong_player_rooms` (
	`player_hash` text NOT NULL,
	`room_id` text NOT NULL,
	PRIMARY KEY(`player_hash`, `room_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mahjong_profiles` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
