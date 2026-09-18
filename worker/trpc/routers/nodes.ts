import { TRPCError } from '@trpc/server'
import { and, eq, isNotNull, or } from 'drizzle-orm'
import { node, nodeInvitation, nodeMember, type NodeRow } from '!/db/app-schema'
import type { Database } from '!/db/index'
import { user as authUser } from '!/db/schema'
import { generateId } from '!/lib/utils'
import {
  backendStatusSchema,
  createNodeSchema,
  invitationIdInputSchema,
  inviteMemberInputSchema,
  memberRemoveInputSchema,
  nodeIdInputSchema,
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

// 共享读：owner 或成员可见（读到之后能干什么是各 procedure 的事：
// query 共享，mutation 一律只要 owner，成员只读）。
async function getAccessibleNode(db: Database, id: string, userId: string) {
  const target = await getNode(db, id)
  if (!target) return null
  if (target.userId === userId) return target
  const m = await db
    .select({ userId: nodeMember.userId })
    .from(nodeMember)
    .where(and(eq(nodeMember.nodeId, id), eq(nodeMember.userId, userId)))
    .limit(1)
  return m.length > 0 ? target : null
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
        ownerId: node.userId,
        memberUserId: nodeMember.userId,
      })
      .from(node)
      .leftJoin(
        nodeMember,
        and(eq(nodeMember.nodeId, node.id), eq(nodeMember.userId, uid)),
      )
      // 自己名下或被共享的节点可见.
      .where(or(eq(node.userId, uid), isNotNull(nodeMember.userId)))
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
        isOwner: row.ownerId === uid,
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
    const target = await getAccessibleNode(ctx.db, input.id, ctx.session.user.id)
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

  // 共享成员管理（owner 专属）：成员只读，读写/删节点/密钥/成员管理一律只要 owner。
  memberList: authedProcedure.input(nodeIdInputSchema).query(async ({ ctx, input }) => {
    const db = ctx.db
    const existing = await getOwnedNode(db, input.id, ctx.session.user.id)
    if (!existing) notFound()
    const rows = await db
      .select({ userId: authUser.id, email: authUser.email, name: authUser.name })
      .from(nodeMember)
      .innerJoin(authUser, eq(nodeMember.userId, authUser.id))
      .where(eq(nodeMember.nodeId, input.id))
    return { members: rows }
  }),

  inviteMember: authedProcedure.input(inviteMemberInputSchema).mutation(async ({ ctx, input }) => {
    const db = ctx.db
    const me = ctx.session.user.id
    const existing = await getOwnedNode(db, input.id, me)
    if (!existing) notFound()
    // 不论邮箱是否注册、是否已邀请，一律返回成功（防枚举）。
    if (input.email === ctx.session.user.email.toLowerCase()) {
      return { ok: true as const }
    }
    const inv = await db
      .select({ id: nodeInvitation.id, status: nodeInvitation.status })
      .from(nodeInvitation)
      .where(
        and(
          eq(nodeInvitation.nodeId, input.id),
          eq(nodeInvitation.email, input.email),
        ),
      )
      .limit(1)
    const row = inv[0]
    if (!row) {
      await db.insert(nodeInvitation).values({
        id: generateId(),
        nodeId: input.id,
        email: input.email,
        invitedBy: me,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    } else if (row.status !== 'pending') {
      await db
        .update(nodeInvitation)
        .set({ status: 'pending', invitedBy: me, updatedAt: new Date() })
        .where(eq(nodeInvitation.id, row.id))
    }
    return { ok: true as const }
  }),

  memberRemove: authedProcedure.input(memberRemoveInputSchema).mutation(async ({ ctx, input }) => {
    const db = ctx.db
    const existing = await getOwnedNode(db, input.id, ctx.session.user.id)
    if (!existing) notFound()
    if (input.userId === existing.userId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'cannot remove owner' })
    }
    const rows = await db
      .select({ userId: nodeMember.userId })
      .from(nodeMember)
      .where(and(eq(nodeMember.nodeId, input.id), eq(nodeMember.userId, input.userId)))
      .limit(1)
    if (rows.length === 0) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'member not found' })
    }
    await db
      .delete(nodeMember)
      .where(and(eq(nodeMember.nodeId, input.id), eq(nodeMember.userId, input.userId)))
    return { ok: true as const }
  }),

  // 成员主动离开：只删自己的成员行；owner 不能离开自己的节点（去删节点）。
  leave: authedProcedure.input(nodeIdInputSchema).mutation(async ({ ctx, input }) => {
    const db = ctx.db
    const me = ctx.session.user.id
    const target = await getNode(db, input.id)
    if (!target) notFound()
    if (target.userId === me) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'owner cannot leave' })
    }
    const rows = await db
      .select({ userId: nodeMember.userId })
      .from(nodeMember)
      .where(and(eq(nodeMember.nodeId, input.id), eq(nodeMember.userId, me)))
      .limit(1)
    if (rows.length === 0) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'not a member' })
    }
    await db
      .delete(nodeMember)
      .where(and(eq(nodeMember.nodeId, input.id), eq(nodeMember.userId, me)))
    return { ok: true as const }
  }),

  // 我的待处理邀请（仅看自己的；节点/邀请人没了连带消失）.
  myInvitations: authedProcedure.query(async ({ ctx }) => {
    const email = ctx.session.user.email.toLowerCase()
    const rows = await ctx.db
      .select({
        id: nodeInvitation.id,
        nodeId: nodeInvitation.nodeId,
        nodeName: node.name,
        inviterEmail: authUser.email,
        createdAt: nodeInvitation.createdAt,
      })
      .from(nodeInvitation)
      .innerJoin(node, eq(nodeInvitation.nodeId, node.id))
      .innerJoin(authUser, eq(nodeInvitation.invitedBy, authUser.id))
      .where(
        and(
          eq(nodeInvitation.email, email),
          eq(nodeInvitation.status, 'pending'),
        ),
      )
    return {
      invitations: rows.map((row) => ({
        ...row,
        createdAt: toISO(row.createdAt),
      })),
    }
  }),

  // 应答邀请：只能应答发给自己的 pending 邀请；接受即进成员表（幂等）.
  invitationAccept: authedProcedure.input(invitationIdInputSchema).mutation(async ({ ctx, input }) => {
    const db = ctx.db
    const me = ctx.session.user.id
    const myEmail = ctx.session.user.email.toLowerCase()
    const rows = await db
      .select()
      .from(nodeInvitation)
      .where(eq(nodeInvitation.id, input.invitationId))
      .limit(1)
    const inv = rows[0]
    if (!inv || inv.status !== 'pending' || inv.email !== myEmail) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'invitation not found' })
    }
    const dup = await db
      .select({ userId: nodeMember.userId })
      .from(nodeMember)
      .where(and(eq(nodeMember.nodeId, inv.nodeId), eq(nodeMember.userId, me)))
      .limit(1)
    if (dup.length === 0) {
      await db
        .insert(nodeMember)
        .values({ nodeId: inv.nodeId, userId: me, createdAt: new Date() })
    }
    await db
      .update(nodeInvitation)
      .set({ status: 'accepted', updatedAt: new Date() })
      .where(eq(nodeInvitation.id, inv.id))
    return { ok: true as const }
  }),

  invitationDecline: authedProcedure.input(invitationIdInputSchema).mutation(async ({ ctx, input }) => {
    const db = ctx.db
    const myEmail = ctx.session.user.email.toLowerCase()
    const rows = await db
      .select()
      .from(nodeInvitation)
      .where(eq(nodeInvitation.id, input.invitationId))
      .limit(1)
    const inv = rows[0]
    if (!inv || inv.status !== 'pending' || inv.email !== myEmail) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'invitation not found' })
    }
    await db
      .update(nodeInvitation)
      .set({ status: 'declined', updatedAt: new Date() })
      .where(eq(nodeInvitation.id, inv.id))
    return { ok: true as const }
  }),
})
