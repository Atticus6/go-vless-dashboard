import { router } from '!/trpc/trpc'
import { metaRouter } from '!/trpc/routers/meta'
import { nodesRouter } from '!/trpc/routers/nodes'
import { notifyRouter } from '!/trpc/routers/notify'

export const appRouter = router({
  meta: metaRouter,
  nodes: nodesRouter,
  notify: notifyRouter,
})

// tRPC 契约唯一来源：前端经 AppRouter 全链路推导。
export type AppRouter = typeof appRouter
