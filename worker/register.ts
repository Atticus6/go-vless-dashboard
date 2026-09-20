import { Hono } from 'hono'
import { and, eq, exists, notExists, or } from 'drizzle-orm'
import { node, nodeUser, nodeUserNode } from '!/db/app-schema'
import { createDb } from '!/db/index'
import { registerBodySchema } from '!/lib/validators'
import { zValidator } from '!/lib/zod-validator'

// 后端反向注册的心跳周期（秒）：节点每 30 分钟全量同步一次 UUID；
// 在线判定窗口 = 2 个周期（60 分钟内无上报即离线）.
export const HEARTBEAT_INTERVAL_SEC = 1800
export const ONLINE_WINDOW_MS = HEARTBEAT_INTERVAL_SEC * 2 * 1000

export function isOnline(
  lastSeenAt: Date | string | number | null | undefined,
): boolean {
  if (!lastSeenAt) return false
  const t =
    lastSeenAt instanceof Date
      ? lastSeenAt.getTime()
      : new Date(lastSeenAt).getTime()
  return Number.isFinite(t) && Date.now() - t < ONLINE_WINDOW_MS
}

// 定长比较，key 长度不同直接失败（不泄露长度之外的信息）.
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  if (ab.byteLength !== bb.byteLength) return false
  let diff = 0
  for (let i = 0; i < ab.byteLength; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  }
  return diff === 0
}

// go-vless 后端反向注册：公开接口，凭节点 id + configKey 鉴权.
// 不走 tRPC：Go 端实现 devalue 编解码成本过高，普通 JSON 即可.
const registerApp = new Hono<{ Bindings: Env }>().post(
  '/register',
  zValidator('json', registerBodySchema),
  async (c) => {
    const { id, key, version, urls, tunnelUrl } = c.req.valid('json')
    const db = createDb(c.env.DB)
    const rows = await db.select().from(node).where(eq(node.id, id)).limit(1)
    const target = rows[0]
    if (!target || !target.configKey || !safeEqual(key, target.configKey)) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    // 上报地址按优先级：urls 依次，其次隧道地址（最不可靠，垫底）。
    const reportedUrls = urls ?? []
    const reportedTunnel = tunnelUrl?.trim() ? tunnelUrl.trim() : null
    const candidates = [...reportedUrls]
    if (reportedTunnel) candidates.push(reportedTunnel)
    // 上报原值每次落库；baseUrl 每次注册都用最新上报地址刷新：
    // urls 按序优先，其次隧道地址（最不可靠，垫底），都没上报则保留原值.
    const patch: {
      lastSeenAt: Date
      backendVersion: string | null
      reportedUrls: string
      reportedTunnelUrl: string | null
      baseUrl?: string | null
    } = {
      lastSeenAt: new Date(),
      backendVersion: version ?? target.backendVersion,
      reportedUrls: JSON.stringify(reportedUrls),
      reportedTunnelUrl: reportedTunnel,
    }
    if (candidates.length > 0 && candidates[0]) {
      patch.baseUrl = candidates[0]
    }
    await db.update(node).set(patch).where(eq(node.id, id))
    // 所属用户的节点用户 token：只下发本节点范围内的
    // （无关联行=全部节点，有关联行则须含本节点）；后端注册成功后拉取为 VLESS uuid.
    const linksOf = (nodeId: string) =>
      db
        .select({ nodeUserId: nodeUserNode.nodeUserId })
        .from(nodeUserNode)
        .where(
          and(
            eq(nodeUserNode.nodeUserId, nodeUser.id),
            eq(nodeUserNode.nodeId, nodeId),
          ),
        )
    const anyLink = db
      .select({ nodeUserId: nodeUserNode.nodeUserId })
      .from(nodeUserNode)
      .where(eq(nodeUserNode.nodeUserId, nodeUser.id))
    const userRows = await db
      .select({ token: nodeUser.token })
      .from(nodeUser)
      .where(
        and(
          eq(nodeUser.userId, target.userId),
          or(notExists(anyLink), exists(linksOf(target.id))),
        ),
      )
    return c.json({
      ok: true,
      heartbeatIntervalSec: HEARTBEAT_INTERVAL_SEC,
      userTokens: userRows.map((r) => r.token),
    })
  },
)

export default registerApp
