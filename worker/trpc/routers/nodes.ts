import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { node, nodeUser, type NodeRow } from '!/db/app-schema'
import type { Database } from '!/db/index'
import { generateId } from '!/lib/utils'
import {
  backendStatusSchema,
  createNodeSchema,
  nodeIdInputSchema,
  nodeUserCreateInputSchema,
  nodeUserEnsureInputSchema,
  nodeUserRemoveInputSchema,
  updateNodeInputSchema,
  usersInputSchema,
} from '!/lib/validators'
import { isOnline } from '!/register'
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

// 增删节点用户时广播推送到名下已配置节点（尽力而为）：
// 在线节点即刻生效；离线/推送失败的节点下次反向注册拉取时自动对账.
// 永不抛错，调用方落库成功后调用，失败只进 failed 名单.
interface PushSummary {
  synced: string[]
  failed: string[]
}

async function broadcastUserToken(
  db: Database,
  userId: string,
  action: 'add' | 'remove',
  token: string,
): Promise<PushSummary> {
  const owned = await db
    .select({
      name: node.name,
      baseUrl: node.baseUrl,
      configKey: node.configKey,
    })
    .from(node)
    .where(eq(node.userId, userId))
  const targets = owned.filter(
    (n): n is typeof n & { baseUrl: string; configKey: string } =>
      !!n.baseUrl && !!n.configKey,
  )
  if (targets.length === 0) return { synced: [], failed: [] }
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
  return { synced, failed }
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
      })
      .from(node)
      .where(eq(node.userId, uid))
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
      .set({ name, baseUrl, configKey, updatedAt: new Date() })
      .where(eq(node.id, input.id))
    const updated = await getOwnedNode(db, input.id, ctx.session.user.id)
    return { node: updated ? toPublic(updated) : null }
  }),

  remove: authedProcedure.input(nodeIdInputSchema).mutation(async ({ ctx, input }) => {
    const db = ctx.db
    const existing = await getOwnedNode(db, input.id, ctx.session.user.id)
    if (!existing) notFound()
    await db.delete(node).where(eq(node.id, input.id))
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

  // 节点订阅用户（归属当前用户）：创建时服务端签发 UUID token，
  // 落库后广播推送到名下已配置节点；离线节点下次注册拉取时自动补齐.
  nodeUserList: authedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: nodeUser.id,
        name: nodeUser.name,
        token: nodeUser.token,
        createdAt: nodeUser.createdAt,
      })
      .from(nodeUser)
      .where(eq(nodeUser.userId, ctx.session.user.id))
    return {
      users: rows.map((row) => ({
        ...row,
        createdAt: toISO(row.createdAt),
      })),
    }
  }),

  nodeUserCreate: authedProcedure
    .input(nodeUserCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const row = {
        id: generateId(),
        userId: ctx.session.user.id,
        name: input.name,
        token: crypto.randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      await ctx.db.insert(nodeUser).values(row)
      const sync = await broadcastUserToken(
        ctx.db,
        ctx.session.user.id,
        'add',
        row.token,
      )
      return {
        user: {
          id: row.id,
          name: row.name,
          token: row.token,
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
      // 先广播移除（在线即刻失效），再落库删除；离线节点下次注册对账时移除.
      const sync = await broadcastUserToken(db, me, 'remove', record.token)
      await db.delete(nodeUser).where(eq(nodeUser.id, input.nodeUserId))
      return { ok: true as const, sync }
    }),

  // 复制订阅链接前调用：把该 token 同步到目标节点后端（后端 add 幂等）。
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
      await proxyUsers('add', target, [record.token])
      return { ok: true as const }
    }),
})
