import { TRPCError } from '@trpc/server'
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import {
  node,
  nodeUser,
  nodeUserNode,
  trafficRecord,
  type NodeRow,
} from '!/db/app-schema'
import type { Database } from '!/db/index'
import { generateId } from '!/lib/utils'
import {
  backendStatusSchema,
  createNodeSchema,
  nodeIdInputSchema,
  nodeUserCreateInputSchema,
  nodeUserEnsureInputSchema,
  nodeUserRemoveInputSchema,
  nodeUserRenameInputSchema,
  nodeUserScopeInputSchema,
  removeNodesInputSchema,
  reorderNodesInputSchema,
  trafficBreakdownSchema,
  trafficListInputSchema,
  trafficStatsInputSchema,
  updateAllBackendsInputSchema,
  updateBackendInputSchema,
  updateBackendsInputSchema,
  updateNodeInputSchema,
  usersInputSchema,
} from '!/lib/validators'
import { isOnline } from '!/register'
import { countryFlag } from '!/lib/subscription'
import { authedProcedure, router } from '!/trpc/trpc'

// tRPC 契约唯一来源：前端经 AppRouter 全链路推导，禁止在 src 下手写重复接口。
// BackendStatus 由 validators 的 backendStatusSchema 导出（见下 status）。
export interface PublicNode {
  id: string
  name: string
  baseUrl: string | null
  createdAt: string
  updatedAt: string
}

function toISO(value: Date | string | number): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number') return new Date(value).toISOString()
  return value
}

function toMillis(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  return new Date(value).getTime()
}

// 流量游标编解码：不透明 base64(JSON { t: recordedAt毫秒, id })，前端透传不解析.
// router 只跑在 Workers 侧，btoa/atob 原生可用（与 notify.ts 一致，直接裸用）；
// id 为 ascii hex，JSON 全 ascii，无需 TextEncoder.
function encodeTrafficCursor(recordedAtMs: number, id: string): string {
  return btoa(JSON.stringify({ t: recordedAtMs, id }))
}

function decodeTrafficCursor(cursor: string): { t: number; id: string } {
  try {
    const raw = atob(cursor)
    const v = JSON.parse(raw) as { t?: unknown; id?: unknown }
    if (
      typeof v.t === 'number' &&
      Number.isFinite(v.t) &&
      typeof v.id === 'string' &&
      v.id.length > 0
    ) {
      return { t: v.t, id: v.id }
    }
  } catch {
    // 落到下方统一 400.
  }
  throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid cursor' })
}

// 流量查询公共前置：过滤 id 归属校验（跨用户穿透直接 404），
// trafficStats / trafficBreakdown 共用（trafficList 另有 userId 兜底条件，保持不动）.
async function assertTrafficFilters(
  db: Database,
  me: string,
  input: { nodeId?: string; nodeUserId?: string },
) {
  if (input.nodeId) {
    const target = await getOwnedNode(db, input.nodeId, me)
    if (!target) notFound()
  }
  if (input.nodeUserId) {
    const rows = await db
      .select({ id: nodeUser.id })
      .from(nodeUser)
      .where(and(eq(nodeUser.id, input.nodeUserId), eq(nodeUser.userId, me)))
      .limit(1)
    if (!rows[0]) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'node user not found',
      })
    }
  }
}

// 归属收敛（builder 版）：名下节点 id 子查询；分页查询用 IN 代替 JOIN 过滤，
// 排序走 (recordedAt, id) 索引倒序、LIMIT 提前停；D1 按扫描行计费.
function ownedNodeIds(db: Database, me: string) {
  return db.select({ id: node.id }).from(node).where(eq(node.userId, me))
}

// 归属收敛（raw SQL 版）：聚合查询用，配合 (nodeId, recordedAt) 索引范围扫描；
// 聚合不再 JOIN node（展示名在外层按分组 probe），只读时间窗内的行.
function ownedNodeIdsSQL(me: string): SQL {
  return sql`tr."node_id" IN (SELECT "id" FROM "node" WHERE "user_id" = ${me})`
}

// 聚合时间窗：缺省近 14 天（含今天），UTC 天对齐，跨度上限 31 天.
// 返回 baseFromMs（lag 基线多取 1 天）与 toMs（毫秒 unlike trafficList 的 ISO 边界）.
const STATS_MAX_DAYS = 31

function resolveStatsRange(input: { from?: string; to?: string }) {
  const DAY = 86400000
  const to = input.to ? new Date(input.to) : new Date()
  const from = input.from
    ? new Date(input.from)
    : new Date(to.getTime() - 13 * DAY)
  // 按 UTC 天对齐比较跨度，避免时区边界差一天.
  const fromDay = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  )
  const toDay = Date.UTC(
    to.getUTCFullYear(),
    to.getUTCMonth(),
    to.getUTCDate(),
  )
  if (
    !Number.isFinite(fromDay) ||
    !Number.isFinite(toDay) ||
    fromDay > toDay
  ) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid range' })
  }
  if ((toDay - fromDay) / DAY > STATS_MAX_DAYS - 1) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `range too large (max ${STATS_MAX_DAYS} days)`,
    })
  }
  return {
    DAY,
    fromDay,
    toDay,
    fromKey: new Date(fromDay).toISOString().slice(0, 10),
    // lag 基线：往前多取 1 天，前一天无数据时 lag 缺省 0.
    baseFromMs: fromDay - DAY,
    toMs: toDay + DAY - 1,
  }
}

function toPublic(row: NodeRow): PublicNode {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    createdAt: toISO(row.createdAt),
    updatedAt: toISO(row.updatedAt),
  }
}

// 与 go-vless install.sh 的 rand_hex() 同强度：16 字节随机 → 32 位 hex。
function generateConfigKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface BackendFetch {
  ok: boolean
  status: number
  body: unknown
}

// Calls backend /config (key via header, never in URL/logs), 10s timeout.
async function fetchBackend(
  baseUrl: string,
  key: string,
  path: string,
  init?: RequestInit,
): Promise<BackendFetch> {
  let res: Response
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-config-key': key,
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(10000),
    })
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: {
        error: 'unreachable',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { ok: res.ok, status: res.status, body }
}

async function getNode(db: Database, id: string) {
  const rows = await db.select().from(node).where(eq(node.id, id)).limit(1)
  return rows[0] ?? null
}

// 归属隔离：只返回属于该用户的节点（无兼容：userId 非空，不存在或不属于即 null）。
async function getOwnedNode(db: Database, id: string, userId: string) {
  const target = await getNode(db, id)
  if (!target || target.userId !== userId) {
    return null
  }
  return target
}

function notFound(): never {
  throw new TRPCError({ code: 'NOT_FOUND', message: 'node not found' })
}

function parseReportedUrls(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : []
  } catch {
    return []
  }
}

// 后端代理失败时尽量透出后端的 error 字段，否则回退固定文案。
function backendMessage(body: unknown, fallback: string): string {
  if (body !== null && typeof body === 'object' && 'error' in body) {
    const err = (body as { error?: unknown }).error
    if (typeof err === 'string' && err.length > 0) return err
  }
  return fallback
}

async function proxyUsers(
  action: 'add' | 'remove',
  target: NodeRow,
  uuids: string[],
): Promise<{ ok: true; users: string[] }> {
  if (!target.baseUrl || !target.configKey) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'node not configured' })
  }
  const check = await fetchBackend(
    target.baseUrl,
    target.configKey,
    `/config/users/${action}`,
    {
      method: 'POST',
      body: JSON.stringify({ uuids }),
    },
  )
  if (!check.ok) {
    throw new TRPCError({
      code: check.status === 400 ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
      message: backendMessage(check.body, 'request failed'),
    })
  }
  // 后端成功体即 { ok: true, users: string[] }。
  return check.body as { ok: true; users: string[] }
}

interface BackendUpdateResult {
  ok: true
  started: boolean
  version: string
  latest: boolean
}

// 程序自更新代理：后端立即回包（ started=true 表示后台已开工），
// 下载替换耗时远超 10 秒代理超时，故只确认“已接受”，成败看后端日志与版本号变化.
async function proxyUpdate(
  target: NodeRow,
  version?: string,
): Promise<BackendUpdateResult> {
  if (!target.baseUrl || !target.configKey) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'node not configured' })
  }
  const check = await fetchBackend(target.baseUrl, target.configKey, '/config/update', {
    method: 'POST',
    body: JSON.stringify({ version: version ?? '' }),
  })
  if (!check.ok) {
    throw new TRPCError({
      code:
        check.status === 400 || check.status === 409
          ? 'BAD_REQUEST'
          : 'INTERNAL_SERVER_ERROR',
      message: backendMessage(check.body, 'request failed'),
    })
  }
  return check.body as BackendUpdateResult
}

interface UpdateSummary {
  started: string[]
  failed: string[]
  skipped: string[]
}

// 广播自更新（尽力而为）：scopeNodeIds 为空推全部名下节点，否则只推所列
// （显式选中的必须全部归属自己，否则直接拒绝）；离线/未配置的跳过
// （等上线后手动补），在线节点即刻开工；永不抛错.
async function broadcastUpdate(
  db: Database,
  userId: string,
  version: string | undefined,
  scopeNodeIds: string[] | null,
): Promise<UpdateSummary> {
  const owned = await db
    .select({
      id: node.id,
      name: node.name,
      baseUrl: node.baseUrl,
      configKey: node.configKey,
      lastSeenAt: node.lastSeenAt,
    })
    .from(node)
    .where(eq(node.userId, userId))
  const ownedSet = new Set(owned.map((n) => n.id))
  if (scopeNodeIds && !scopeNodeIds.every((id) => ownedSet.has(id))) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'node not found' })
  }
  const inScope =
    scopeNodeIds && scopeNodeIds.length > 0
      ? owned.filter((n) => scopeNodeIds.includes(n.id))
      : owned
  const configured = inScope.filter(
    (n): n is typeof n & { baseUrl: string; configKey: string } =>
      !!n.baseUrl && !!n.configKey,
  )
  const skipped = configured
    .filter((n) => !isOnline(n.lastSeenAt))
    .map((n) => n.name)
  const targets = configured.filter((n) => isOnline(n.lastSeenAt))
  if (targets.length === 0) return { started: [], failed: [], skipped }
  const results = await Promise.allSettled(
    targets.map(async (t) => {
      const check = await fetchBackend(t.baseUrl, t.configKey, '/config/update', {
        method: 'POST',
        body: JSON.stringify({ version: version ?? '' }),
      })
      if (!check.ok) throw new Error(backendMessage(check.body, 'request failed'))
      return t.name
    }),
  )
  const started: string[] = []
  const failed: string[] = []
  results.forEach((r, i) => {
    const name = targets[i]?.name ?? ''
    if (r.status === 'fulfilled') started.push(name)
    else failed.push(name)
  })
  return { started, failed, skipped }
}

// 增删节点用户时广播推送到范围内已配置节点（尽力而为）：
// scopeNodeIds 为空（null 或空数组）推送全部名下节点，否则只推所列节点；
// 离线节点直接跳过（进 skipped 名单，不尝试推送）；推送失败的进 failed；
// 在线推送成功的即刻生效；跳过/失败的节点下次反向注册拉取时自动对账.
// 永不抛错，调用方落库成功后调用.
interface PushSummary {
  synced: string[]
  failed: string[]
  skipped: string[]
}

async function broadcastUserToken(
  db: Database,
  userId: string,
  action: 'add' | 'remove',
  token: string,
  scopeNodeIds: string[] | null,
): Promise<PushSummary> {
  const owned = await db
    .select({
      id: node.id,
      name: node.name,
      baseUrl: node.baseUrl,
      configKey: node.configKey,
      lastSeenAt: node.lastSeenAt,
    })
    .from(node)
    .where(eq(node.userId, userId))
  const inScope =
    scopeNodeIds && scopeNodeIds.length > 0
      ? owned.filter((n) => scopeNodeIds.includes(n.id))
      : owned
  const configured = inScope.filter(
    (n): n is typeof n & { baseUrl: string; configKey: string } =>
      !!n.baseUrl && !!n.configKey,
  )
  // 不在线的直接跳过，不发请求（等下次反向注册对账）。
  const skipped = configured.filter((n) => !isOnline(n.lastSeenAt)).map((n) => n.name)
  const targets = configured.filter((n) => isOnline(n.lastSeenAt))
  if (targets.length === 0) return { synced: [], failed: [], skipped }
  const results = await Promise.allSettled(
    targets.map(async (t) => {
      const check = await fetchBackend(
        t.baseUrl,
        t.configKey,
        `/config/users/${action}`,
        {
          method: 'POST',
          body: JSON.stringify({ uuids: [token] }),
        },
      )
      if (!check.ok) throw new Error(backendMessage(check.body, 'request failed'))
      return t.name
    }),
  )
  const synced: string[] = []
  const failed: string[] = []
  results.forEach((r, i) => {
    const name = targets[i]?.name ?? ''
    if (r.status === 'fulfilled') synced.push(name)
    else failed.push(name)
  })
  return { synced, failed, skipped }
}

export const nodesRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    const uid = ctx.session.user.id
    const rows = await ctx.db
      .select({
        id: node.id,
        name: node.name,
        baseUrl: node.baseUrl,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        lastSeenAt: node.lastSeenAt,
        backendVersion: node.backendVersion,
        reportedUrls: node.reportedUrls,
        reportedTunnelUrl: node.reportedTunnelUrl,
        extraUrls: node.extraUrls,
        countryCode: node.countryCode,
      })
      .from(node)
      .where(eq(node.userId, uid))
      // 手动排序优先（拖拽写入），值相同按创建时间兜底.
      .orderBy(asc(node.sortOrder), asc(node.createdAt))
    return {
      nodes: rows.map((row) => ({
        id: row.id,
        name: row.name,
        baseUrl: row.baseUrl,
        createdAt: toISO(row.createdAt),
        updatedAt: toISO(row.updatedAt),
        lastSeenAt: row.lastSeenAt ? toISO(row.lastSeenAt) : null,
        backendVersion: row.backendVersion,
        reportedUrls: parseReportedUrls(row.reportedUrls),
        reportedTunnelUrl: row.reportedTunnelUrl,
        // 额外地址 JSON mode 直出 string[]，无需 parse.
        extraUrls: row.extraUrls,
        // 原始名 + 国家码分别返回，展示层按需拼旗帜（编辑框必须用原始名）.
        countryCode: row.countryCode,
        online: isOnline(row.lastSeenAt),
      })),
    }
  }),

  create: authedProcedure.input(createNodeSchema).mutation(async ({ ctx, input }) => {
    // 写入时静默生成通信密钥（占位，避免 null；配对靠编辑页粘贴后端 key 覆盖）。
    // 该值永不返回给前端。
    const row: NodeRow = {
      id: generateId(),
      name: input.name,
      userId: ctx.session.user.id,
      baseUrl: null,
      configKey: generateConfigKey(),
      lastSeenAt: null,
      backendVersion: null,
      reportedUrls: null,
      reportedTunnelUrl: null,
      // 额外地址缺省空数组（JSON mode）.
      extraUrls: [],
      // 新节点排序默认 0（与老数据一致），同值按创建时间排.
      sortOrder: 0,
      // 国家代码未知（首次注册时由边缘信息写入）.
      countryCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    await ctx.db.insert(node).values(row)
    return { node: toPublic(row) }
  }),

  update: authedProcedure.input(updateNodeInputSchema).mutation(async ({ ctx, input }) => {
    const db = ctx.db
    const existing = await getOwnedNode(db, input.id, ctx.session.user.id)
    if (!existing) notFound()

    const name = input.name ?? existing.name
    const baseUrl = input.baseUrl ?? existing.baseUrl
    const configKey = input.configKey ?? existing.configKey
    // 额外地址缺省沿用旧值（JSON mode 下直接是 string[]）.
    const extraUrls = input.extraUrls ?? existing.extraUrls

    // 地址与密钥都齐了且刚改过，才实时校验；缺一项先存着。
    const connectionChanged =
      baseUrl !== existing.baseUrl || configKey !== existing.configKey
    if (connectionChanged && baseUrl !== null && configKey !== null) {
      const check = await fetchBackend(baseUrl, configKey, '/config')
      if (!check.ok) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: check.status === 404 ? 'invalid configKey' : 'unreachable',
        })
      }
    }

    await db
      .update(node)
      .set({ name, baseUrl, configKey, extraUrls, updatedAt: new Date() })
      .where(eq(node.id, input.id))
    const updated = await getOwnedNode(db, input.id, ctx.session.user.id)
    return { node: updated ? toPublic(updated) : null }
  }),

  remove: authedProcedure.input(nodeIdInputSchema).mutation(async ({ ctx, input }) => {
    const db = ctx.db
    const existing = await getOwnedNode(db, input.id, ctx.session.user.id)
    if (!existing) notFound()
    // 关联行显式清理（D1 外键级联不一定生效，用户保留、变回全部语义）.
    await db.delete(nodeUserNode).where(eq(nodeUserNode.nodeId, input.id))
    await db.delete(node).where(eq(node.id, input.id))
    return { ok: true as const }
  }),

  // 拖拽排序：按数组位置重写 sort_order（首位 0，依次递增）。
  // ids 必须恰好是名下全部节点（防多端并发下旧顺序覆盖新节点），否则直接拒绝.
  reorder: authedProcedure
    .input(reorderNodesInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db
      const me = ctx.session.user.id
      const owned = await db
        .select({ id: node.id })
        .from(node)
        .where(eq(node.userId, me))
      const ownedSet = new Set(owned.map((n) => n.id))
      const nextSet = new Set(input.ids)
      if (
        nextSet.size !== input.ids.length ||
        nextSet.size !== ownedSet.size ||
        ![...nextSet].every((id) => ownedSet.has(id))
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'stale node list, please retry',
        })
      }
      await Promise.all(
        input.ids.map((id, index) =>
          db
            .update(node)
            .set({ sortOrder: index, updatedAt: new Date() })
            .where(eq(node.id, id)),
        ),
      )
      return { ok: true as const }
    }),

  // 该节点的后端安装命令（含 服务端地址:节点id:config_key 三元组）。
  // 点击复制 = 明示查看 key；key 明文仅在此接口返回，其它接口永不返回。
  // 安装脚本地址见 go-vless/README.md（一键安装节）。
  installCommand: authedProcedure.input(nodeIdInputSchema).mutation(async ({ ctx, input }) => {
    const db = ctx.db
    const existing = await getOwnedNode(db, input.id, ctx.session.user.id)
    if (!existing) notFound()
    let configKey = existing.configKey
    if (!configKey) {
      // 存量 null key 行：写入时补生成（与 create 同强度），保证命令可用。
      configKey = generateConfigKey()
      await db
        .update(node)
        .set({ configKey, updatedAt: new Date() })
        .where(eq(node.id, input.id))
    }
    const script =
      'https://raw.githubusercontent.com/Atticus6/go-vless/main/install.sh'
    const triple = `${ctx.origin}:${existing.id}:${configKey}`
    // 本地联调端口取该节点地址的端口（dashboard 连的就是后端监听端口），取不到默认 8080。
    let backendPort = '8080'
    try {
      backendPort = (existing.baseUrl ? new URL(existing.baseUrl).port : '') || '8080'
    } catch {
      backendPort = '8080'
    }
    return {
      triple,
      commands: {
        auto: `curl -fsSL ${script} | sudo bash -s -- --register "${triple}"`,
        binary: `curl -fsSL ${script} -o install.sh && sudo RUNTIME=binary bash install.sh --register "${triple}"`,
        docker: `curl -fsSL ${script} -o install.sh && sudo RUNTIME=docker bash install.sh --register "${triple}"`,
        dev: `CONFIG_KEY=${configKey} REGISTER_URL=${ctx.origin} REGISTER_NODE_ID=${existing.id} go run . --port ${backendPort}`,
        devPwsh: `$env:CONFIG_KEY="${configKey}"; $env:REGISTER_URL="${ctx.origin}"; $env:REGISTER_NODE_ID="${existing.id}"; go run . --port ${backendPort}`,
      },
    }
  }),

  test: authedProcedure.input(nodeIdInputSchema).mutation(async ({ ctx, input }) => {
    const target = await getOwnedNode(ctx.db, input.id, ctx.session.user.id)
    if (!target) notFound()
    if (!target.baseUrl || !target.configKey) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'node not configured' })
    }
    const started = Date.now()
    const check = await fetchBackend(target.baseUrl, target.configKey, '/config')
    if (!check.ok) {
      return {
        ok: false as const,
        error: check.status === 404 ? 'invalid configKey' : 'unreachable',
        detail: check.body,
      }
    }
    return { ok: true as const, latencyMs: Date.now() - started }
  }),

  status: authedProcedure.input(nodeIdInputSchema).query(async ({ ctx, input }) => {
    const target = await getOwnedNode(ctx.db, input.id, ctx.session.user.id)
    if (!target) notFound()
    if (!target.baseUrl || !target.configKey) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'node not configured' })
    }
    const check = await fetchBackend(target.baseUrl, target.configKey, '/config')
    if (!check.ok) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: check.status === 404 ? 'invalid configKey' : 'backend error',
      })
    }
    // 输出按 backendStatusSchema 运行时校验：后端改字段直接 500，不透 undefined。
    return backendStatusSchema.parse(check.body)
  }),

  addUsers: authedProcedure.input(usersInputSchema).mutation(async ({ ctx, input }) => {
    const target = await getOwnedNode(ctx.db, input.id, ctx.session.user.id)
    if (!target) notFound()
    return proxyUsers('add', target, input.uuids)
  }),

  removeUsers: authedProcedure.input(usersInputSchema).mutation(async ({ ctx, input }) => {
    const target = await getOwnedNode(ctx.db, input.id, ctx.session.user.id)
    if (!target) notFound()
    return proxyUsers('remove', target, input.uuids)
  }),

  // 单节点程序自更新：version 为空跟最新版，否则按 tag 精确更新；
  // 后端接受即回（下载替换耗时远超代理超时），started=true 仅表示已开工.
  updateBackend: authedProcedure
    .input(updateBackendInputSchema)
    .mutation(async ({ ctx, input }) => {
      const target = await getOwnedNode(ctx.db, input.id, ctx.session.user.id)
      if (!target) notFound()
      return proxyUpdate(target, input.version)
    }),

  // 全部在线节点广播自更新：离线/未配置的跳过（等上线后手动补）.
  updateAllBackends: authedProcedure
    .input(updateAllBackendsInputSchema)
    .mutation(async ({ ctx, input }) => {
      return broadcastUpdate(ctx.db, ctx.session.user.id, input.version, null)
    }),

  // 选中子集广播自更新：version 为空跟最新版.
  updateBackends: authedProcedure
    .input(updateBackendsInputSchema)
    .mutation(async ({ ctx, input }) => {
      return broadcastUpdate(
        ctx.db,
        ctx.session.user.id,
        input.version,
        [...new Set(input.ids)],
      )
    }),

  // 节点批量删除：逐个验归属后删（关联行显式清理，与单删语义一致）.
  removeNodes: authedProcedure
    .input(removeNodesInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db
      const me = ctx.session.user.id
      const ids = [...new Set(input.ids)]
      const owned = await db
        .select({ id: node.id })
        .from(node)
        .where(eq(node.userId, me))
      const ownedSet = new Set(owned.map((n) => n.id))
      if (!ids.every((id) => ownedSet.has(id))) notFound()
      await Promise.all(
        ids.map(async (id) => {
          await db.delete(nodeUserNode).where(eq(nodeUserNode.nodeId, id))
          await db.delete(node).where(eq(node.id, id))
        }),
      )
      return { ok: true as const, deleted: ids.length }
    }),

  // 节点订阅用户（归属当前用户）：创建时服务端签发 UUID token，
  // 可限定多个节点（空即全部节点）；落库后广播推送到范围内已配置节点；
  // 离线节点下次注册拉取时自动补齐.
  nodeUserList: authedProcedure.query(async ({ ctx }) => {
    const me = ctx.session.user.id
    const rows = await ctx.db
      .select({
        id: nodeUser.id,
        name: nodeUser.name,
        token: nodeUser.token,
        createdAt: nodeUser.createdAt,
      })
      .from(nodeUser)
      .where(eq(nodeUser.userId, me))
    const owned = await ctx.db
      .select({ id: node.id, name: node.name, countryCode: node.countryCode })
      .from(node)
      .where(eq(node.userId, me))
    // 可用范围展示名：名前拼旗帜（与订阅备注一致），无码不拼.
    const names = new Map(
      owned.map((n) => {
        const flag = countryFlag(n.countryCode)
        return [n.id, flag ? `${flag}${n.name}` : n.name] as const
      }),
    )
    const ownedIds = new Set(owned.map((n) => n.id))
    const linkRows =
      rows.length === 0
        ? []
        : await ctx.db
            .select({
              nodeUserId: nodeUserNode.nodeUserId,
              nodeId: nodeUserNode.nodeId,
            })
            .from(nodeUserNode)
            .innerJoin(nodeUser, eq(nodeUserNode.nodeUserId, nodeUser.id))
            .where(eq(nodeUser.userId, me))
    const byUser = new Map<string, string[]>()
    for (const l of linkRows) {
      if (!ownedIds.has(l.nodeId)) continue
      const arr = byUser.get(l.nodeUserId) ?? []
      arr.push(l.nodeId)
      byUser.set(l.nodeUserId, arr)
    }
    return {
      users: rows.map((row) => {
        const nodeIds = byUser.get(row.id) ?? []
        return {
          id: row.id,
          name: row.name,
          token: row.token,
          nodeIds,
          nodeNames: nodeIds.map((id) => names.get(id) ?? id),
          createdAt: toISO(row.createdAt),
        }
      }),
    }
  }),

  nodeUserCreate: authedProcedure
    .input(nodeUserCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id
      // 限定节点必须全部归属自己，否则直接拒绝（防跨用户 id 穿透）；
      // 空数组 = 全部节点，不写关联行.
      const scopeNodeIds = [...new Set(input.nodeIds ?? [])]
      if (scopeNodeIds.length > 0) {
        const owned = await ctx.db
          .select({ id: node.id })
          .from(node)
          .where(eq(node.userId, me))
        const ownedSet = new Set(owned.map((n) => n.id))
        if (!scopeNodeIds.every((id) => ownedSet.has(id))) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'node not found' })
        }
      }
      const row = {
        id: generateId(),
        userId: me,
        name: input.name,
        token: crypto.randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      await ctx.db.insert(nodeUser).values(row)
      if (scopeNodeIds.length > 0) {
        await ctx.db.insert(nodeUserNode).values(
          scopeNodeIds.map((nodeId) => ({ nodeUserId: row.id, nodeId })),
        )
      }
      const sync = await broadcastUserToken(
        ctx.db,
        me,
        'add',
        row.token,
        scopeNodeIds,
      )
      return {
        user: {
          id: row.id,
          name: row.name,
          token: row.token,
          nodeIds: scopeNodeIds,
          createdAt: toISO(row.createdAt),
        },
        sync,
      }
    }),

  nodeUserRemove: authedProcedure
    .input(nodeUserRemoveInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db
      const me = ctx.session.user.id
      const rows = await db
        .select({ id: nodeUser.id, token: nodeUser.token })
        .from(nodeUser)
        .where(
          and(eq(nodeUser.id, input.nodeUserId), eq(nodeUser.userId, me)),
        )
        .limit(1)
      const record = rows[0]
      if (!record) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'node user not found' })
      }
      const links = await db
        .select({ nodeId: nodeUserNode.nodeId })
        .from(nodeUserNode)
        .where(eq(nodeUserNode.nodeUserId, record.id))
      // 先广播移除（范围内在线节点即刻失效），再落库删除（关联级联）；
      // 离线节点下次注册对账时移除.
      const sync = await broadcastUserToken(
        db,
        me,
        'remove',
        record.token,
        links.map((l) => l.nodeId),
      )
      // 关联行显式清理（D1 外键级联不一定生效）.
      await db.delete(nodeUserNode).where(eq(nodeUserNode.nodeUserId, record.id))
      await db.delete(nodeUser).where(eq(nodeUser.id, input.nodeUserId))
      return { ok: true as const, sync }
    }),

  // 节点用户改名：仅改名，不动 token 与可用范围，后端无需同步.
  nodeUserRename: authedProcedure
    .input(nodeUserRenameInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db
      const me = ctx.session.user.id
      const rows = await db
        .select({ id: nodeUser.id })
        .from(nodeUser)
        .where(
          and(eq(nodeUser.id, input.nodeUserId), eq(nodeUser.userId, me)),
        )
        .limit(1)
      if (!rows[0]) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'node user not found',
        })
      }
      await db
        .update(nodeUser)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(nodeUser.id, input.nodeUserId))
      return { ok: true as const }
    }),

  // 可用范围更新：换关联行（空即全部节点），并按增减 diff 推送——
  // 新加入的节点 add，移出的节点 remove，离线节点下次注册对账.
  nodeUserScope: authedProcedure
    .input(nodeUserScopeInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db
      const me = ctx.session.user.id
      const rows = await db
        .select({ id: nodeUser.id, token: nodeUser.token })
        .from(nodeUser)
        .where(
          and(eq(nodeUser.id, input.nodeUserId), eq(nodeUser.userId, me)),
        )
        .limit(1)
      const record = rows[0]
      if (!record) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'node user not found' })
      }
      const nextIds = [...new Set(input.nodeIds ?? [])]
      if (nextIds.length > 0) {
        const owned = await db
          .select({ id: node.id })
          .from(node)
          .where(eq(node.userId, me))
        const ownedSet = new Set(owned.map((n) => n.id))
        if (!nextIds.every((id) => ownedSet.has(id))) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'node not found' })
        }
      }
      const prevLinks = await db
        .select({ nodeId: nodeUserNode.nodeId })
        .from(nodeUserNode)
        .where(eq(nodeUserNode.nodeUserId, record.id))
      const prevIds = prevLinks.map((l) => l.nodeId)
      const added = nextIds.filter((id) => !prevIds.includes(id))
      const removed = prevIds.filter((id) => !nextIds.includes(id))
      await db.delete(nodeUserNode).where(eq(nodeUserNode.nodeUserId, record.id))
      if (nextIds.length > 0) {
        await db.insert(nodeUserNode).values(
          nextIds.map((nodeId) => ({ nodeUserId: record.id, nodeId })),
        )
      }
      const syncs = await Promise.all([
        added.length > 0
          ? broadcastUserToken(db, me, 'add', record.token, added)
          : { synced: [], failed: [], skipped: [] },
        removed.length > 0
          ? broadcastUserToken(db, me, 'remove', record.token, removed)
          : { synced: [], failed: [], skipped: [] },
      ])
      const sync: PushSummary = {
        synced: syncs.flatMap((s) => s.synced),
        failed: syncs.flatMap((s) => s.failed),
        skipped: syncs.flatMap((s) => s.skipped),
      }
      return { ok: true as const, sync }
    }),
  // 复制订阅链接前调用：把该 token 同步到目标节点后端（后端 add 幂等）。
  // 无关联行 = 全部节点放行；有关联行则必须含目标节点，否则直接拒绝.
  nodeUserEnsure: authedProcedure
    .input(nodeUserEnsureInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db
      const me = ctx.session.user.id
      const target = await getOwnedNode(db, input.id, me)
      if (!target) notFound()
      const rows = await db
        .select({ token: nodeUser.token })
        .from(nodeUser)
        .where(
          and(eq(nodeUser.id, input.nodeUserId), eq(nodeUser.userId, me)),
        )
        .limit(1)
      const record = rows[0]
      if (!record) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'node user not found' })
      }
      const links = await db
        .select({ nodeId: nodeUserNode.nodeId })
        .from(nodeUserNode)
        .where(eq(nodeUserNode.nodeUserId, input.nodeUserId))
      if (links.length > 0 && !links.some((l) => l.nodeId === input.id)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'node user not allowed on this node',
        })
      }
      await proxyUsers('add', target, [record.token])
      return { ok: true as const }
    }),

  // 流量记录查询（归属当前用户）：按节点 / 节点用户 / 时间范围过滤，
  // 时间倒序 + keyset cursor 分页；nodeUser 已删除的行 nodeUserName 为 null 照常返回.
  // 排序键为 (recordedAt DESC, id DESC)，游标为上一页最后一条的 (t, id)；
  // 下一页条件：recordedAt < t OR (recordedAt = t AND id < cursorId)，避免
  // 同毫秒多行（同一批次上报时间戳一致）丢行或重行；非法游标直接 400.
  // 过滤 id 先做归属校验（跨用户 id 穿透直接 404），再叠加 userId 兜底条件，
  // 双保险：即使过滤缺失也只能看到名下节点的记录.
  // 返回 limit+1 探针判断 hasMore，不做 count（大表 count 贵且插入时漂移）.
  trafficList: authedProcedure
    .input(trafficListInputSchema)
    .query(async ({ ctx, input }) => {
      const db = ctx.db
      const me = ctx.session.user.id
      // 节点过滤必须归属自己，否则 404（与其它节点接口语义一致）.
      if (input.nodeId) {
        const target = await getOwnedNode(db, input.nodeId, me)
        if (!target) notFound()
      }
      // 用户过滤同样必须归属自己.
      if (input.nodeUserId) {
        const rows = await db
          .select({ id: nodeUser.id })
          .from(nodeUser)
          .where(
            and(eq(nodeUser.id, input.nodeUserId), eq(nodeUser.userId, me)),
          )
          .limit(1)
        if (!rows[0]) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'node user not found',
          })
        }
      }
      const limit = input.limit ?? 50
      // 条件动态叠加：归属恒为第一条件（名下节点 IN 子查询，404 校验在上），
      // 其余按传入组装；时间字符串已在 schema 层校验为 ISO，这里直接转 Date.
      // IN 子查询 + (recordedAt, id) 索引倒序：LIMIT 提前停，只读本页行.
      const conds = [inArray(trafficRecord.nodeId, ownedNodeIds(db, me))]
      if (input.nodeId) conds.push(eq(trafficRecord.nodeId, input.nodeId))
      if (input.nodeUserId) {
        conds.push(eq(trafficRecord.nodeUserId, input.nodeUserId))
      }
      if (input.from) {
        conds.push(gte(trafficRecord.recordedAt, new Date(input.from)))
      }
      if (input.to) {
        conds.push(lte(trafficRecord.recordedAt, new Date(input.to)))
      }
      // keyset 游标条件：排序 (recordedAt DESC, id DESC) 的严格下一页.
      if (input.cursor) {
        const c = decodeTrafficCursor(input.cursor)
        const t = new Date(c.t)
        conds.push(
          or(
            lt(trafficRecord.recordedAt, t),
            and(eq(trafficRecord.recordedAt, t), lt(trafficRecord.id, c.id)),
          )!,
        )
      }
      const where = and(...conds)
      // 联表仅取展示列：node 内连接（记录 nodeId 必填，孤儿行不存在）；
      // nodeUser 左连接（上报时未映射或用户已删的行保留，名字为 null）.
      // 过滤已由 IN 子查询收敛，联表为索引 probe，不参与扫描.
      // 多取 1 条做 hasMore 探针，前端按 nextCursor 翻页.
      const rows = await db
        .select({
          id: trafficRecord.id,
          nodeId: trafficRecord.nodeId,
          nodeName: node.name,
          nodeCountryCode: node.countryCode,
          nodeUserId: trafficRecord.nodeUserId,
          nodeUserName: nodeUser.name,
          upBytes: trafficRecord.upBytes,
          downBytes: trafficRecord.downBytes,
          recordedAt: trafficRecord.recordedAt,
        })
        .from(trafficRecord)
        .innerJoin(node, eq(trafficRecord.nodeId, node.id))
        .leftJoin(nodeUser, eq(trafficRecord.nodeUserId, nodeUser.id))
        .where(where)
        .orderBy(desc(trafficRecord.recordedAt), desc(trafficRecord.id))
        .limit(limit + 1)
      const hasMore = rows.length > limit
      const pageRows = hasMore ? rows.slice(0, limit) : rows
      // nextCursor 取本页最后一条（recordedAt 转毫秒 + id），无下一页为 null.
      const last = pageRows[pageRows.length - 1]
      const nextCursor =
        hasMore && last
          ? encodeTrafficCursor(toMillis(last.recordedAt), last.id)
          : null
      return {
        records: pageRows.map((r) => ({
          id: r.id,
          nodeId: r.nodeId,
          nodeName: r.nodeName,
          nodeCountryCode: r.nodeCountryCode,
          nodeUserId: r.nodeUserId,
          nodeUserName: r.nodeUserName,
          upBytes: r.upBytes,
          downBytes: r.downBytes,
          recordedAt: r.recordedAt ? toISO(r.recordedAt) : null,
        })),
        nextCursor,
        hasMore,
      }
    }),

  // 流量按天聚合（归属当前用户）：与 trafficList 同归属校验 + 同过滤，
  // 上报是累计值（重启清零），故按 (nodeId, nodeUserId) 分组取每日 max，
  // 再用 lag 差分得到每日增量（计数器回退视为清零，按当日 max 计）；
  // 缺省近 14 天（含今天），跨度上限 31 天，无数据日期补 0.
  trafficStats: authedProcedure
    .input(trafficStatsInputSchema)
    .query(async ({ ctx, input }) => {
      const db = ctx.db
      const me = ctx.session.user.id
      await assertTrafficFilters(db, me, input)
      const { DAY, fromDay, toDay, fromKey, baseFromMs, toMs } =
        resolveStatsRange(input)
      // 归属收敛走 IN 子查询（(nodeId, recordedAt) 索引范围扫描），不 JOIN node.
      const conds = [ownedNodeIdsSQL(me)]
      if (input.nodeId) conds.push(sql`tr."node_id" = ${input.nodeId}`)
      if (input.nodeUserId) {
        conds.push(sql`tr."node_user_id" = ${input.nodeUserId}`)
      }
      const where = sql.join(conds, sql` AND `)
      const rows = await db.all<{
        date: string
        upBytes: number
        downBytes: number
      }>(sql`
        WITH daily AS (
          SELECT date(tr."recorded_at" / 1000, 'unixepoch') AS d,
                 tr."node_id" AS node_id,
                 tr."node_user_id" AS node_user_id,
                 max(tr."up_bytes") AS up,
                 max(tr."down_bytes") AS down
          FROM "traffic_record" tr
          WHERE ${where}
            AND tr."recorded_at" >= ${baseFromMs}
            AND tr."recorded_at" <= ${toMs}
          GROUP BY d, tr."node_id", tr."node_user_id"
        ),
        diff AS (
          SELECT d,
            CASE WHEN up - lag(up, 1, 0) OVER w < 0 THEN up
                 ELSE up - lag(up, 1, 0) OVER w END AS up_use,
            CASE WHEN down - lag(down, 1, 0) OVER w < 0 THEN down
                 ELSE down - lag(down, 1, 0) OVER w END AS down_use
          FROM daily
          WINDOW w AS (PARTITION BY node_id, node_user_id ORDER BY d)
        )
        SELECT d AS date,
               CAST(sum(up_use) AS INTEGER) AS upBytes,
               CAST(sum(down_use) AS INTEGER) AS downBytes
        FROM diff
        WHERE d >= ${fromKey}
        GROUP BY d
        ORDER BY d
      `)
      // 无数据日期补 0，保证柱状图横轴连续.
      const byDate = new Map(rows.map((r) => [r.date, r]))
      const days: Array<{ date: string; upBytes: number; downBytes: number }> =
        []
      let totalUp = 0
      let totalDown = 0
      for (let t = fromDay; t <= toDay; t += DAY) {
        const key = new Date(t).toISOString().slice(0, 10)
        const r = byDate.get(key)
        const upBytes = Number(r?.upBytes ?? 0)
        const downBytes = Number(r?.downBytes ?? 0)
        days.push({ date: key, upBytes, downBytes })
        totalUp += upBytes
        totalDown += downBytes
      }
      return { days, totalUp, totalDown }
    }),

  // 流量分组汇总（归属当前用户）：by=user 按节点用户分（某节点下各用户用量），
  // by=node 按节点分（某用户在各节点用量）；差分语义与 trafficStats 一致，
  // 外层再按目标维度汇总；总量倒序；未关联行 id/name 为 null.
  trafficBreakdown: authedProcedure
    .input(trafficBreakdownSchema)
    .query(async ({ ctx, input }) => {
      const db = ctx.db
      const me = ctx.session.user.id
      await assertTrafficFilters(db, me, input)
      const { fromKey, baseFromMs, toMs } = resolveStatsRange(input)
      // 归属收敛走 IN 子查询（(nodeId, recordedAt) 索引范围扫描），不 JOIN node；
      // 展示名在外层按分组 probe（n2 / nu），聚合只读窗内行.
      const conds = [ownedNodeIdsSQL(me)]
      if (input.nodeId) conds.push(sql`tr."node_id" = ${input.nodeId}`)
      if (input.nodeUserId) {
        conds.push(sql`tr."node_user_id" = ${input.nodeUserId}`)
      }
      const where: SQL = sql.join(conds, sql` AND `)
      // CTE 内仍按 (node, user) 细粒度差分，外层按目标维度汇总，保证可加性.
      // summed 的源是 diff（列为 node_id / node_user_id），此处不能带 tr. 前缀.
      const gid =
        input.by === 'user' ? sql`node_user_id` : sql`node_id`
      const nameSelect =
        input.by === 'user'
          ? sql`SELECT s.gid AS id, nu."name" AS name,
                       CAST(NULL AS TEXT) AS countryCode,
                       CAST(s.up_sum AS INTEGER) AS upBytes,
                       CAST(s.down_sum AS INTEGER) AS downBytes
                FROM summed s
                LEFT JOIN "node_user" nu ON s.gid = nu."id"`
          : sql`SELECT s.gid AS id, n2."name" AS name,
                       n2."country_code" AS countryCode,
                       CAST(s.up_sum AS INTEGER) AS upBytes,
                       CAST(s.down_sum AS INTEGER) AS downBytes
                FROM summed s
                INNER JOIN "node" n2 ON s.gid = n2."id"`
      const rows = await db.all<{
        id: string | null
        name: string | null
        countryCode: string | null
        upBytes: number
        downBytes: number
      }>(sql`
        WITH daily AS (
          SELECT date(tr."recorded_at" / 1000, 'unixepoch') AS d,
                 tr."node_id" AS node_id,
                 tr."node_user_id" AS node_user_id,
                 max(tr."up_bytes") AS up,
                 max(tr."down_bytes") AS down
          FROM "traffic_record" tr
          WHERE ${where}
            AND tr."recorded_at" >= ${baseFromMs}
            AND tr."recorded_at" <= ${toMs}
          GROUP BY d, tr."node_id", tr."node_user_id"
        ),
        diff AS (
          SELECT d, node_id, node_user_id,
            CASE WHEN up - lag(up, 1, 0) OVER w < 0 THEN up
                 ELSE up - lag(up, 1, 0) OVER w END AS up_use,
            CASE WHEN down - lag(down, 1, 0) OVER w < 0 THEN down
                 ELSE down - lag(down, 1, 0) OVER w END AS down_use
          FROM daily
          WINDOW w AS (PARTITION BY node_id, node_user_id ORDER BY d)
        ),
        summed AS (
          SELECT ${gid} AS gid, sum(up_use) AS up_sum, sum(down_use) AS down_sum
          FROM diff
          WHERE d >= ${fromKey}
          GROUP BY gid
        )
        ${nameSelect}
        ORDER BY (up_sum + down_sum) DESC
      `)
      let totalUp = 0
      let totalDown = 0
      const groups = rows.map((r) => {
        const upBytes = Number(r.upBytes ?? 0)
        const downBytes = Number(r.downBytes ?? 0)
        totalUp += upBytes
        totalDown += downBytes
        return {
          id: r.id,
          name: r.name,
          countryCode: r.countryCode,
          upBytes,
          downBytes,
        }
      })
      return { groups, totalUp, totalDown }
    }),
})
