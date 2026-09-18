ALTER TABLE `node` ADD `user_id` text NOT NULL REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `user` ADD `token` text NOT NULL;