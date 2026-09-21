-- 节点所在国家代码：反向注册时从 request.cf 提取，可空.
ALTER TABLE `node` ADD COLUMN `country_code` text;
