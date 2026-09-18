import type { RouterOutputs } from './trpc'

// 领域类型全部经 AppRouter 推导，禁止手写重复接口。
export type NodeItem = RouterOutputs['nodes']['list']['nodes'][number]
export type BackendStatus = RouterOutputs['nodes']['status']
export type NodeTestResult = RouterOutputs['nodes']['test']
