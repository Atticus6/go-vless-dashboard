CREATE TABLE `node` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`config_key` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
