import { sql } from 'drizzle-orm'
import {
  integer,
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
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
})

export type NodeRow = typeof node.$inferSelect

// 节点订阅用户（归属 dashboard 用户，不绑特定节点，可用于名下任一节点）：
// 每条带一个 UUID token；复制订阅链接时自动同步到目标节点后端。
// 创建者删号连带清理。
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
