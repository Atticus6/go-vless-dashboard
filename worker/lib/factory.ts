import { createFactory } from 'hono/factory'
import type { Auth } from '!/auth'
import { createAuth } from '!/auth'
import type { Database } from '!/db/index'
import { createDb } from '!/db/index'

export type Session = Auth['$Infer']['Session']

export interface AppEnv {
  Bindings: Env
  Variables: {
    db: Database
    auth: Auth
    session: Session | null
  }
}

export const factory = createFactory<AppEnv>()

// 初始化中间件：每个请求进来先建好 drizzle + auth，后续只读 c.var。
export const init = factory.createMiddleware(async (c, next) => {
  const db = createDb(c.env.DB)
  c.set('db', db)
  c.set('auth', createAuth(c.env, db))
  await next()
})

// 登录守卫：挂在 init 之后，用初始化好的 auth 校验会话。
export const requireAuth = factory.createMiddleware(async (c, next) => {
  const session = await c.var.auth.api.getSession({
    headers: c.req.raw.headers,
  })
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  c.set('session', session)
  await next()
})
