// 管理后台数据一律走 tRPC：类型经 AppRouter 全链路推导，禁止手写重复接口。
// 经典一段式写法：trpc.nodes.list.useQuery() / trpc.nodes.create.useMutation()
import { createTRPCReact } from '@trpc/react-query'
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '!/trpc/router'
import { devalueTransformer } from '!/trpc/transformer'

export { devalueTransformer }

export const trpc = createTRPCReact<AppRouter>()

export type RouterInputs = inferRouterInputs<AppRouter>
export type RouterOutputs = inferRouterOutputs<AppRouter>
