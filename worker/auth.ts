import { betterAuth } from 'better-auth/minimal'
import { multiSession } from 'better-auth/plugins'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { eq, or } from 'drizzle-orm'
import { node, nodeInvitation, nodeMember } from '!/db/app-schema'
import type { Database } from '!/db/index'
import { generateId } from '!/lib/utils'

// 由 init 中间件按请求创建（Bindings 只在请求 env 上可用，
// Worker 里不能用模块级单例）。Schema 生成走
// worker/auth-schema.config.ts（保持同步）。
export function createAuth(env: Env, db: Database) {
  return betterAuth({
    // 同源多 host（本地 dev / workers.dev / 预览域名）：按请求 host 动态解析，
    // 未知 host 直接抛错而不静默回退；protocol auto 让 http(s)/Secure cookie 跟随请求。
    baseURL: {
      allowedHosts: ['localhost:*', '127.0.0.1:*', '*.workers.dev'],
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
    // 建用户时服务端签发个人 token。注意用 v4 不用 v7：
    // token 是 bearer 凭证，v7 自带时间戳且随机位少，v4（122 位全随机）才合适。
    // input:false 保证客户端传不进来，required:true 保证列非空：这里是唯一的写入口。
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const existing = (user as { token?: unknown }).token
            return {
              data: {
                ...user,
                token:
                  typeof existing === 'string' && existing.length > 0
                    ? existing
                    : crypto.randomUUID(),
              },
            }
          },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
    },
    plugins: [multiSession()],
    // 用户个人 token（UUID）：与节点通信的凭证，服务端字段，签发/轮换只走应用层写入.
    // required 必须保持 false：设为 true 会让注册接口在端点层就要求客户端传 token
    //（databaseHooks 是后注入的，拦不住这次校验）；非空由 D1 约束 + 下面的 hook 共同保证。
    user: {
      additionalFields: {
        token: {
          type: 'string',
          required: false,
          input: false,
        },
      },
      // 账号注销：密码确认后立即删除（本项目无邮件通道，不走验证邮件）。
      deleteUser: {
        enabled: true,
        // D1 外键级联不一定生效，这里显式清理应用侧残留：
        // 名下节点、成员关系、发出的邀请（幂等，级联已清则匹配 0 行）。
        afterDelete: async (user) => {
          const userId = user.id
          await db.delete(node).where(eq(node.userId, userId))
          await db.delete(nodeMember).where(eq(nodeMember.userId, userId))
          await db
            .delete(nodeInvitation)
            .where(
              or(
                eq(nodeInvitation.invitedBy, userId),
                eq(nodeInvitation.email, user.email.toLowerCase()),
              ),
            )
        },
      },
    },
    secret: env.BETTER_AUTH_SECRET,
  })
}

export type Auth = ReturnType<typeof createAuth>
