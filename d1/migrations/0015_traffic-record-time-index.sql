-- 流量按时间倒序 keyset 分页 + 时间范围聚合：补 (recorded_at, id) 复合索引。
-- ORDER BY recorded_at DESC, id DESC 走索引倒序，LIMIT 提前停；
-- 游标谓词 (recorded_at < t OR (= t AND id < x)) 同样命中该索引；
-- 避免无该索引时的全表扫描 + 排序（D1 按扫描行计费）。
CREATE INDEX IF NOT EXISTS `traffic_record_time_idx` ON `traffic_record` (`recorded_at`,`id`);
