import type { DataTransformer } from '@trpc/server'
import { parse, stringify } from 'devalue'

// tRPC 序列化唯一实现：前后端共用同一对象，保证编解码一致。
export const devalueTransformer: DataTransformer = {
  serialize: (object) => stringify(object),
  deserialize: (object) => parse(object),
}
