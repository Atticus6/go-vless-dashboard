CREATE TABLE `node_member` (
	`node_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`node_id`, `user_id`),
	FOREIGN KEY (`node_id`) REFERENCES `node`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
