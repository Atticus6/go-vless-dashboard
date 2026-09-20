import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { node, nodeUser, nodeUserNode } from '!/db/app-schema'
import { createDb } from '!/db/index'
import {
  buildSubEntries,
  detectSubFormat,
  formatSubBody,
  resolveSubParams,
} from '!/lib/subscription'
import { subQueryInputSchema, subTokenParamSchema } from '!/lib/validators'
import { zValidator } from '!/lib/zod-validator'

// 用户订阅地址：GET /api/sub/:token，返回该 token 可访问的全部 vless 节点。
// 入参全部显式校验（非法直接 400）：token 为路径参数，format/port/security 为查询参数；
// token 即 bearer 凭证：查无此 token 直接 404，不区分“不存在”。
const subApp = new Hono<{ Bindings: Env }>().get(
  '/:token',
  zValidator('param', subTokenParamSchema),
  zValidator('query', subQueryInputSchema),
  async (c) => {
    const { token } = c.req.valid('param')
    const query = c.req.valid('query')
    const params = resolveSubParams(query)
    // 显式 ?format= 优先，否则按客户端 UA 判定，兜底 Clash.
    const format = query.format ?? detectSubFormat(c.req.header('user-agent'))

    const db = createDb(c.env.DB)
    const owners = await db
      .select({ id: nodeUser.id, userId: nodeUser.userId, name: nodeUser.name })
      .from(nodeUser)
      .where(eq(nodeUser.token, token))
      .limit(1)
    const owner = owners[0]
    if (!owner) return c.text('unknown token', 404)

    const owned = await db
      .select({
        id: node.id,
        name: node.name,
        reportedUrls: node.reportedUrls,
        reportedTunnelUrl: node.reportedTunnelUrl,
      })
      .from(node)
      .where(eq(node.userId, owner.userId))
    // 无关联行 = 全部节点；有关联行 = 仅所列节点.
    const myLinks = await db
      .select({ nodeId: nodeUserNode.nodeId })
      .from(nodeUserNode)
      .where(eq(nodeUserNode.nodeUserId, owner.id))
    const myScope =
      myLinks.length === 0 ? null : new Set(myLinks.map((l) => l.nodeId))
    const scoped = myScope
      ? owned.filter((n) => myScope.has(n.id))
      : owned

    // 后端同步靠注册心跳与增删推送保证，这里只组装返回，不做逐节点 ensure.
  const entries = buildSubEntries(
    scoped.map((n) => ({
      id: n.id,
      name: n.name,
      reportedUrls: parseReportedUrls(n.reportedUrls),
      reportedTunnelUrl: n.reportedTunnelUrl,
    })),
    token,
    params,
  )
    if (entries.length === 0) return c.text('no nodes available', 404)
  const { body, contentType } = formatSubBody(
    format,
    entries,
    token,
    params,
  )
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': contentType,
        // 订阅内容随范围/节点变化，禁止边缘缓存.
        'cache-control': 'no-store',
      },
    })
  },
)

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

export default subApp
