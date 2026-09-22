import { z } from 'zod'
import { subFormatSchema, subQuerySchema } from '!/lib/subscription'

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

// 节点拖拽排序：数组即新顺序（首位 sort_order=0），router 内校验全量一致.
export const reorderNodesInputSchema = z.object({
  ids: z.array(nodeIdSchema).max(100),
})

// 节点批量删除：子集即可（显式选中的才删），router 内逐个验归属.
export const removeNodesInputSchema = z.object({
  ids: z.array(nodeIdSchema).min(1).max(100),
})

// 后端程序自更新：version 为空即跟最新版，否则按 tag 精确更新（如 v1.2.3）.
export const updateVersionSchema = z
  .string('invalid version')
  .trim()
  .max(32, 'invalid version')
  .regex(/^v[\w.-]+$/, 'invalid version (want v1.2.3)')
  .optional()

// 选中子集广播自更新：version 为空跟最新版.
export const updateBackendsInputSchema = z.object({
  ids: z.array(nodeIdSchema).min(1).max(100),
  version: updateVersionSchema,
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

export const updateBackendInputSchema = z.object({
  id: nodeIdSchema,
  version: updateVersionSchema,
})

export const updateAllBackendsInputSchema = z.object({
  version: updateVersionSchema,
})

// 节点订阅用户：按名称创建（可限定多个节点，空即全部节点），token 服务端签发；
// 按行 id 删除；复制订阅链接前按（节点 id + 行 id）同步到目标后端。
export const nodeUserCreateInputSchema = z.object({
  name: nodeNameSchema,
  nodeIds: z.array(nodeIdSchema).max(50).optional(),
})

export const nodeUserRemoveInputSchema = z.object({
  nodeUserId: nodeIdSchema,
})

// 节点用户改名：名称规则与创建一致（1-64 字符）.
export const nodeUserRenameInputSchema = z.object({
  nodeUserId: nodeIdSchema,
  name: nodeNameSchema,
})

// 节点用户可用范围更新：空数组 = 全部节点，否则只用于所列节点.
export const nodeUserScopeInputSchema = z.object({
  nodeUserId: nodeIdSchema,
  nodeIds: z.array(nodeIdSchema).max(50).optional(),
})

export const nodeUserEnsureInputSchema = z.object({
  id: nodeIdSchema,
  nodeUserId: nodeIdSchema,
})

// 节点端 /config 的 register 段：后端的 dashboard 注册/同步状态（是否连上服务端等）。
// 全可选：老版本后端没有该段也能通过校验，前端按 undefined 处理.
export const backendRegisterSchema = z.object({
  enabled: z.boolean(),
  dashboardUrl: z.string().optional(),
  nodeId: z.string().optional(),
  lastSuccessAt: z.string().nullable().optional(),
  lastError: z.string().nullable().optional(),
  lastSyncAdded: z.number().optional(),
  lastSyncRemoved: z.number().optional(),
  syncedUsers: z.number().optional(),
  heartbeatIntervalSec: z.number().optional(),
  nextSyncInSec: z.number().optional(),
})

export type BackendRegister = z.infer<typeof backendRegisterSchema>

// 节点端 /config 的 tls 段：HTTPS 是否启用、证书域名与到期时间。
// 老版本后端没有该段按 undefined 处理.
export const backendTLSStatusSchema = z.object({
  enabled: z.boolean(),
  domain: z.string().optional(),
  expiresAt: z.string().nullable().optional(),
  daysLeft: z.number().optional(),
})

export type BackendTLSStatus = z.infer<typeof backendTLSStatusSchema>

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
    z.object({
      up: z.string(),
      down: z.string(),
      upBytes: z.number().optional(),
      downBytes: z.number().optional(),
    }),
  ),
  // 后端程序版本（tag，如 v1.2.3；本地构建为 dev）：老版本后端没有该字段.
  version: z.string().optional(),
  buildTime: z.string(),
  binarySize: z.string(),
  memory: z.object({
    alloc: z.string(),
    sys: z.string(),
    rss: z.string(),
  }),
  uptime: z.string(),
  register: backendRegisterSchema.optional(),
  tls: backendTLSStatusSchema.optional(),
})

export type BackendStatus = z.infer<typeof backendStatusSchema>

// 订阅地址入参（GET /api/sub/:token）：token 为路径参数，
// format/port/security 为查询参数，全部显式校验（非法直接 400）.
export const subTokenParamSchema = z.object({
  token: z.string().trim().min(1),
})

export const subQueryInputSchema = subQuerySchema.extend({
  format: subFormatSchema.optional(),
})

// 流量记录查询：全部可选过滤（节点 / 节点用户 / 时间范围）+ keyset cursor 分页.
// 时间走 ISO 字符串（tRPC 走 JSON，Date 会变字符串，索性显式收字符串），
// router 内转 Date；归属校验在 router 做（过滤 id 必须属于当前用户）。
// cursor 为不透明游标（后端编码 recordedAt+id），前端透传不解析；
// 第一页不传 cursor，下一页传上一页返回的 nextCursor；改任一过滤要从头查.
// limit 上限 200，默认 50，与查询页 PAGE_SIZE 对齐.
export const trafficListInputSchema = z.object({
  nodeId: nodeIdSchema.optional(),
  nodeUserId: nodeIdSchema.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).max(256).optional(),
})

// 流量按天聚合：与 trafficList 同过滤（节点 / 节点用户 / 时间范围），
// 缺省查近 14 天（含今天）；跨度上限 31 天在 router 层拒绝.
// 上报是累计值（重启清零），聚合语义为“组内每日 max 差分”，由 router 落 SQL.
export const trafficStatsInputSchema = z.object({
  nodeId: nodeIdSchema.optional(),
  nodeUserId: nodeIdSchema.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
})

// 流量分组汇总：by=user 按节点用户分（查某节点下各用户用量），
// by=node 按节点分（查某用户在各节点用量）；其余同 trafficStats.
export const trafficBreakdownSchema = z.object({
  by: z.enum(['user', 'node']),
  nodeId: nodeIdSchema.optional(),
  nodeUserId: nodeIdSchema.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
})

// 后端流量上报请求体（公开接口，靠节点 id + key 鉴权）：
// users 以 uuid(token) 标识用户——后端只认识 token，不认识 dashboard 节点用户 id；
// dashboard 按 token 反查 node_user，查不到的 nodeUserId 记空（查询页显示未关联）。
// 单次最多 500 条（约束请求体大小，节点用户量级下足够）；
// 字节数必须是非负整数（与 D1 integer 列对应，超大值按 JSON number 精度处理）.
export const trafficReportUserSchema = z.object({
  uuid: z.uuid({ error: 'invalid uuid' }),
  upBytes: z.number({ error: 'invalid upBytes' }).int().nonnegative(),
  downBytes: z.number({ error: 'invalid downBytes' }).int().nonnegative(),
})

export const trafficReportBodySchema = z.object({
  id: nodeIdSchema,
  key: configKeySchema,
  users: z.array(trafficReportUserSchema).max(500),
})

// 后端反向注册请求体（公开接口，靠 id + key 鉴权）.
export const registerBodySchema = z.object({
  id: nodeIdSchema,
  key: configKeySchema,
  version: z.string().max(128).optional(),
  urls: z.array(z.string().trim().min(1).max(512)).max(20).optional(),
  tunnelUrl: z.string().trim().max(512).optional(),
})
