import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { user as authUser } from '!/db/schema'

// Dashboard 纳管的 go-vless 服务节点。
// configKey 仅保存在 D1，绝不返回给前端；前端经 Worker 代理访问后端。
// userId 为所属登录用户（非空）；用户删号连带删除名下节点。
export const node = sqliteTable('node', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => authUser.id, {
      onDelete: 'cascade',
    }),
  // 先建后配：创建时可为空，在编辑里补齐地址与密钥。
  baseUrl: text('base_url'),
  configKey: text('config_key'),
  // 后端反向注册/心跳写入：最近上线时间 + 后端版本（均可空，未注册过即空）。
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
  backendVersion: text('backend_version'),
  // 每次注册原样落库的上报地址：urls JSON 数组 + 隧道地址（可空）。
  reportedUrls: text('reported_urls'),
  reportedTunnelUrl: text('reported_tunnel_url'),
  // 手动排序：默认 0，管理表格拖拽后按数组位置重写；
  // list 与订阅输出按该字段升序（值相同按创建时间兜底）.
  sortOrder: integer('sort_order').notNull().default(0),
  // 节点所在国家代码（Cloudflare cf.country，ISO alpha-2，如 US）：
  // 反向注册时从请求边缘信息提取，本地开发无边缘信息时记空.
  countryCode: text('country_code'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
})

export type NodeRow = typeof node.$inferSelect

// 节点订阅用户（归属 dashboard 用户）：
// 每条带一个 UUID token；复制订阅链接时自动同步到目标节点后端。
// 创建者删号连带清理。
//
// 可用范围走 nodeUserNode 关联表：无关联行表示全部节点，
// 有关联行则只用于所列节点（增删广播、注册拉取、复制同步都按此收敛）.
export const nodeUser = sqliteTable(
  'node_user',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    token: text('token').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex('node_user_user_token_unique').on(t.userId, t.token),
  ],
)

export type NodeUserRow = typeof nodeUser.$inferSelect

// 节点用户与节点的关联（可用范围）：一行一对，无行即全部节点.
// 任一端删除连带清理关联行（用户删光则回到全部节点语义）.
export const nodeUserNode = sqliteTable(
  'node_user_node',
  {
    nodeUserId: text('node_user_id')
      .notNull()
      .references(() => nodeUser.id, { onDelete: 'cascade' }),
    nodeId: text('node_id')
      .notNull()
      .references(() => node.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.nodeUserId, t.nodeId] })],
)

export type NodeUserNodeRow = typeof nodeUserNode.$inferSelect

// 流量记录：后端定时上报（POST /api/traffic/report）的用户流量快照。
// 一次上报落多行（一用户一行），同用户随时间多行，用于画用量趋势。
// nodeId 必填：归属隔离的锚点，查询一律先按所属用户收敛到名下节点。
// nodeUserId 可空：上报只带 uuid(token)，反查不到对应节点用户时记空
// （展示为“未关联用户”，不断流）；节点用户被删时关联行按外键连带清理。
// up/down 存原始字节数（后端 /config 的 upBytes/downBytes），方便求和排序；
// recordedAt 落库时刻（库默认 now），同一批次多行时间戳一致。
// 索引：查询页按（节点，时间）与（用户，时间）倒序分页，两组复合索引覆盖.
export const trafficRecord = sqliteTable(
  'traffic_record',
  {
    id: text('id').primaryKey(),
    nodeId: text('node_id')
      .notNull()
      .references(() => node.id, { onDelete: 'cascade' }),
    nodeUserId: text('node_user_id').references(() => nodeUser.id, {
      onDelete: 'cascade',
    }),
    upBytes: integer('up_bytes').notNull().default(0),
    downBytes: integer('down_bytes').notNull().default(0),
    recordedAt: integer('recorded_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (t) => [
    index('traffic_record_node_time_idx').on(t.nodeId, t.recordedAt),
    index('traffic_record_user_time_idx').on(t.nodeUserId, t.recordedAt),
  ],
)

export type TrafficRecordRow = typeof trafficRecord.$inferSelect
