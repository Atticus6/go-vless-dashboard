CREATE TABLE `node_invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`email` text NOT NULL,
	`invited_by` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `node`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `node_invitation_node_email_unique` ON `node_invitation` (`node_id`,`email`);