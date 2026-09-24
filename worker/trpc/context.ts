import type { Auth } from '!/auth'
import { createAuth } from '!/auth'
import type { Database } from '!/db/index'
import { createDb } from '!/db/index'

export type Session = Auth['$Infer']['Session']

export interface Context {
  db: Database
  auth: Auth
  session: Session | null
  // Worker 自身对外 origin（拼 per-node 安装命令用，就近取请求 URL）.
  origin: string
  // 读环境变量用（如 ALLOW_SIGNUP），D1 binding 同理按请求透传。
  env: Env
}

// 每个 tRPC 请求按需创建（D1 binding 只在请求 env 上可用，不能用模块单例）。
export async function createTRPCContext(opts: {
  req: Request
  env: Env
}): Promise<Context> {
  const db = createDb(opts.env.DB)
  const auth = createAuth(opts.env, db)
  const session = await auth.api.getSession({
    headers: opts.req.headers,
  })
  return {
    db,
    auth,
    session,
    origin: new URL(opts.req.url).origin,
    env: opts.env,
  }
}
