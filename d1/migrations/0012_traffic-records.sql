-- 流量记录表：后端 POST /api/traffic/report 落库，一用户一行快照。
-- node 必填（归属隔离），node_user_id 可空（uuid 未映射时记空）；
-- 任一端删除连带清理；两个 (id/time) 复合索引供查询页倒序分页.
CREATE TABLE `traffic_record` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`node_user_id` text,
	`up_bytes` integer DEFAULT 0 NOT NULL,
	`down_bytes` integer DEFAULT 0 NOT NULL,
	`recorded_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `node`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_user_id`) REFERENCES `node_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `traffic_record_node_time_idx` ON `traffic_record` (`node_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `traffic_record_user_time_idx` ON `traffic_record` (`node_user_id`,`recorded_at`);
