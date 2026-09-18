PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_node` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_url` text,
	`config_key` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_node`("id", "name", "base_url", "config_key", "created_at", "updated_at") SELECT "id", "name", "base_url", "config_key", "created_at", "updated_at" FROM `node`;--> statement-breakpoint
DROP TABLE `node`;--> statement-breakpoint
ALTER TABLE `__new_node` RENAME TO `node`;--> statement-breakpoint
PRAGMA foreign_keys=ON;