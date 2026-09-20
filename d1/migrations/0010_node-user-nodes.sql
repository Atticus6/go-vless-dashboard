CREATE TABLE `node_user_node` (
	`node_user_id` text NOT NULL,
	`node_id` text NOT NULL,
	PRIMARY KEY(`node_user_id`, `node_id`),
	FOREIGN KEY (`node_user_id`) REFERENCES `node_user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `node`(`id`) ON UPDATE no action ON DELETE cascade
);
