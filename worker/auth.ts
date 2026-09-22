import { betterAuth } from 'better-auth/minimal'
import { multiSession } from 'better-auth/plugins'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { eq, inArray } from 'drizzle-orm'
import { node, nodeUser, nodeUserNode } from '!/db/app-schema'
import type { Database } from '!/db/index'
import { generateId } from '!/lib/utils'

// 由 init 中间件按请求创建（Bindings 只在请求 env 上可用，
// Worker 里不能用模块级单例）。Schema 生成走
// worker/auth-schema.config.ts（保持同步）。
export function createAuth(env: Env, db: Database) {
  const allowedHosts = ["*.workers.dev"];
  if (env.DOMAIN) {
    allowedHosts.push(env.DOMAIN);
  }
  return betterAuth({
    // 同源多 host（本地 dev / workers.dev / 预览域名）：按请求 host 动态解析，
    // 未知 host 直接抛错而不静默回退；protocol auto 让 http(s)/Secure cookie 跟随请求。
    baseURL: {
      allowedHosts,
      protocol: 'auto',
    },
    database: drizzleAdapter(db, {
      provider: 'sqlite',
    }),
    advanced: {
      ipAddress: {
        ipv6Subnet: 64 as const, // Rate limit by /64 subnet instead of individual addresses
        ipAddressHeaders: ["cf-connecting-ip"], // Cloudflare specific header example
      },
      database: {
        generateId: () => generateId()
      }
    },
    emailAndPassword: {
      enabled: true,
    },
    plugins: [multiSession()],
    user: {
      // 账号注销：密码确认后立即删除（本项目无邮件通道，不走验证邮件）。
      deleteUser: {
        enabled: true,
        // D1 外键级联不一定生效，这里显式清理应用侧残留：
        // 名下节点、节点订阅用户及其双向关联行（幂等，级联已清则匹配 0 行）。
        afterDelete: async (user) => {
          const userId = user.id
          const ownedUsers = await db
            .select({ id: nodeUser.id })
            .from(nodeUser)
            .where(eq(nodeUser.userId, userId))
          const userIds = ownedUsers.map((u) => u.id)
          if (userIds.length > 0) {
            await db
              .delete(nodeUserNode)
              .where(inArray(nodeUserNode.nodeUserId, userIds))
          }
          const ownedNodes = await db
            .select({ id: node.id })
            .from(node)
            .where(eq(node.userId, userId))
          const nodeIds = ownedNodes.map((n) => n.id)
          if (nodeIds.length > 0) {
            await db
              .delete(nodeUserNode)
              .where(inArray(nodeUserNode.nodeId, nodeIds))
          }
          await db.delete(node).where(eq(node.userId, userId))
          await db.delete(nodeUser).where(eq(nodeUser.userId, userId))
        },
      },
    },
    secret: env.BETTER_AUTH_SECRET,
  })
}

export type Auth = ReturnType<typeof createAuth>
