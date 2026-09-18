import { z } from 'zod'

const invalidName = 'invalid name'
const invalidBaseUrl = 'invalid baseUrl (want http(s)://host[:port])'
const missingConfigKey = 'configKey required'
const invalidUuids = 'invalid uuids (1-100 valid UUID strings)'

const uuidFormat = z.uuid()

export const nodeNameSchema = z
  .string(invalidName)
  .trim()
  .min(1, invalidName)
  .max(64, invalidName)

export const baseUrlSchema = z
  .string(invalidBaseUrl)
  .trim()
  .pipe(z.httpUrl(invalidBaseUrl))
  .transform((value) => new URL(value))
  .refine(
    (url) => url.pathname === '/' && !url.search && !url.hash,
    invalidBaseUrl,
  )
  .transform((url) => url.origin)

export const configKeySchema = z.string(missingConfigKey).min(1, missingConfigKey)

export const uuidListSchema = z
  .array(z.string(invalidUuids).trim().toLowerCase(), invalidUuids)
  .min(1, invalidUuids)
  .max(100, invalidUuids)
  .refine(
    (list) => list.every((id) => uuidFormat.safeParse(id).success),
    invalidUuids,
  )
  .transform((list) => [...new Set(list)])

export const createNodeSchema = z.object({
  name: nodeNameSchema,
})

export const patchNodeSchema = z.object({
  name: nodeNameSchema.optional(),
  baseUrl: baseUrlSchema.optional(),
  configKey: configKeySchema.optional(),
})

export const usersBodySchema = z.object({
  uuids: uuidListSchema,
})

export const idParamSchema = z.object({
  id: z.uuid({ error: 'invalid id' }),
})

// ---- tRPC 输入（单对象入参）：复用上面的字段级 schema，行为与 Hono 时代一致 ----
export const nodeIdSchema = z.uuid({ error: 'invalid id' })

export const nodeIdInputSchema = z.object({
  id: nodeIdSchema,
})

export const updateNodeInputSchema = z.object({
  id: nodeIdSchema,
  name: nodeNameSchema.optional(),
  baseUrl: baseUrlSchema.optional(),
  configKey: configKeySchema.optional(),
})

export const usersInputSchema = z.object({
  id: nodeIdSchema,
  uuids: uuidListSchema,
})

// 节点订阅用户：按名称创建，token 服务端签发；按行 id 删除；
// 复制订阅链接前按（节点 id + 行 id）同步到目标后端。
export const nodeUserCreateInputSchema = z.object({
  name: nodeNameSchema,
})

export const nodeUserRemoveInputSchema = z.object({
  nodeUserId: nodeIdSchema,
})

export const nodeUserEnsureInputSchema = z.object({
  id: nodeIdSchema,
  nodeUserId: nodeIdSchema,
})

// Go 后端 /config 返回体的输出契约：worker 用它运行时校验，后端改字段会直接 500 而不是透出 undefined。
export const backendStatusSchema = z.object({
  tunnel: z.boolean(),
  tunnelURL: z.string(),
  urls: z.array(z.string()),
  ipv4: z.boolean(),
  ipv6: z.boolean(),
  egressIPv4: z.string(),
  egressIPv6: z.string(),
  users: z.record(
    z.string(),
    z.object({ up: z.string(), down: z.string() }),
  ),
  buildTime: z.string(),
  binarySize: z.string(),
  memory: z.object({
    alloc: z.string(),
    sys: z.string(),
    rss: z.string(),
  }),
  uptime: z.string(),
})

export type BackendStatus = z.infer<typeof backendStatusSchema>

// 后端反向注册请求体（公开接口，靠 id + key 鉴权）.
export const registerBodySchema = z.object({
  id: nodeIdSchema,
  key: configKeySchema,
  version: z.string().max(128).optional(),
  urls: z.array(z.string().trim().min(1).max(512)).max(20).optional(),
  tunnelUrl: z.string().trim().max(512).optional(),
})
