-- 节点额外地址：用户自填 CDN/优选地址数组（JSON 文本），缺省 '[]'；
-- 上报地址由后端覆盖写入，额外地址只在编辑页修改，订阅与复制链接时优先使用.
ALTER TABLE `node` ADD COLUMN `extra_urls` text DEFAULT '[]' NOT NULL;
