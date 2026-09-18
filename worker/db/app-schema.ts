import { sql } from 'drizzle-orm'
import {
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
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
})

export type NodeRow = typeof node.$inferSelect

// 节点共享成员（只读）：owner 手动添加其他用户，成员仅查看节点。
// 任一侧删除连带清理本表（节点删→成员关系没；用户删号→其成员关系没，名下节点走 node 侧 cascade）。
export const nodeMember = sqliteTable(
  'node_member',
  {
    nodeId: text('node_id')
      .notNull()
      .references(() => node.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.nodeId, t.userId] })],
)

export type NodeMemberRow = typeof nodeMember.$inferSelect

// 节点邀请（按邮箱）：存在与否统一返回成功（防枚举）；被邀人接受后才进成员表。
// 节点删除连带清理；邀请人删号连带清理其发出的邀请.
export const nodeInvitation = sqliteTable(
  'node_invitation',
  {
    id: text('id').primaryKey(),
    nodeId: text('node_id')
      .notNull()
      .references(() => node.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    invitedBy: text('invited_by')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex('node_invitation_node_email_unique').on(t.nodeId, t.email),
  ],
)

export type NodeInvitationRow = typeof nodeInvitation.$inferSelect
