import { router } from '!/trpc/trpc'
import { nodesRouter } from '!/trpc/routers/nodes'

export const appRouter = router({
  nodes: nodesRouter,
})

// tRPC 契约唯一来源：前端经 AppRouter 全链路推导。
export type AppRouter = typeof appRouter
