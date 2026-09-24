import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { factory, init } from '!/lib/factory'
import registerApp from '!/register'
import subApp from '!/sub'
import trafficApp from '!/traffic'
import { createTRPCContext } from '!/trpc/context'
import { appRouter } from '!/trpc/router'

const authApp = factory.createApp()
authApp.use(init)
authApp.all('/*', (c) => c.var.auth.handler(c.req.raw))

const app = new Hono<{ Bindings: Env }>()
  // API 统一 base 路径：对外仍是 /api/auth、/api/trpc。
  .basePath('/api')
  .route('/auth', authApp)
  // 后端反向注册（公开，key 鉴权）：POST /api/nodes/register
  .route('/nodes', registerApp)
  // 后端流量上报（公开，节点 id + key 鉴权）：POST /api/traffic/report
  .route('/traffic', trafficApp)
  // 用户订阅地址（公开，token 即凭证）：GET /api/sub/:token
  .route('/sub', subApp)
  // 管理后台数据一律走 tRPC（/api/nodes 已下线，/api/health 已并入 trpc.meta.health）。
  // endpoint 写完整对外路径，fetchRequestHandler 用它剥离前缀定位 procedure。
  .all('/trpc/*', (c) =>
    fetchRequestHandler({
      endpoint: '/api/trpc',
      req: c.req.raw,
      router: appRouter,
      createContext: ({ req }) => createTRPCContext({ req, env: c.env }),
      onError: (e) => {
        console.error(e.error);

      }
    }),
  )

app.notFound((c) => c.json({ error: 'Not Found', path: c.req.path }, 404))

app.onError((error, c) => {
  // Validation (and other intentional HTTP errors) thrown as HTTPException
  // are formatted here centrally; unexpected errors become 500.
  if (error instanceof HTTPException) {
    return c.json({ error: validationMessage(error) }, error.status)
  }
  console.error(
    JSON.stringify({
      message: 'request failed',
      path: c.req.path,
      error: error instanceof Error ? error.message : String(error),
    }),
  )
  return c.json({ error: 'Internal Server Error' }, 500)
})

function validationMessage(error: HTTPException): string {
  const cause = error.cause as
    | { issues?: Array<{ message?: unknown }> }
    | undefined
  const message = cause?.issues?.[0]?.message
  if (typeof message === 'string' && message.length > 0) {
    return message
  }
  return error.message
}

export default app
