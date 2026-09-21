-- 节点手动排序：默认 0，拖拽排序后按位置重写；list/sub 按该字段升序.
ALTER TABLE `node` ADD COLUMN `sort_order` integer DEFAULT 0 NOT NULL;
