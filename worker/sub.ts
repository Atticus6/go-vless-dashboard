import { Hono } from 'hono'
import { asc, eq } from 'drizzle-orm'
import { node, nodeUser, nodeUserNode } from '!/db/app-schema'
import { user } from '!/db/schema'
import { createDb } from '!/db/index'
import {
  buildSubEntries,
  DEFAULT_FRONT_PATTERNS,
  detectSubFormat,
  formatSubBody,
  resolveSubParams,
} from '!/lib/subscription'
import { subQueryInputSchema, subTokenParamSchema } from '!/lib/validators'
import { configSchema, notifyUser } from '!/lib/notify'
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

    // 订阅内节点顺序与管理表格一致：手动排序优先，值相同按创建时间.
    const owned = await db
      .select({
        id: node.id,
        name: node.name,
        reportedUrls: node.reportedUrls,
        reportedTunnelUrl: node.reportedTunnelUrl,
        extraUrls: node.extraUrls,
        countryCode: node.countryCode,
      })
      .from(node)
      .where(eq(node.userId, owner.userId))
      .orderBy(asc(node.sortOrder), asc(node.createdAt))
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
    // 前置域名：默认表 + 属主 config.frontDomains 合并去重，命中改走优选地址.
    const cfgRows = await db
      .select({ config: user.config })
      .from(user)
      .where(eq(user.id, owner.userId))
      .limit(1)
    const parsed = configSchema.safeParse(cfgRows[0]?.config ?? {})
    const frontPatterns = [
      ...DEFAULT_FRONT_PATTERNS,
      ...(parsed.success ? (parsed.data.frontDomains ?? []) : []),
    ].filter((v, i, a) => a.indexOf(v) === i)
    const entries = buildSubEntries(
      scoped.map((n) => ({
        id: n.id,
        name: n.name,
        // 自填额外地址放最前优先（JSON mode 直出 string[]），上报随后、隧道垫底.
        reportedUrls: [
          ...(n.extraUrls ?? []),
          ...parseReportedUrls(n.reportedUrls),
        ],
        reportedTunnelUrl: n.reportedTunnelUrl,
        countryCode: n.countryCode,
      })),
      token,
      params,
      frontPatterns,
    )
    if (entries.length === 0) return c.text('no nodes available', 404)
    // 订阅被成功拉取：异步通知属主（waitUntil 不阻塞本次返回；未配通知静默跳过）.
    // 归属地取自 request.cf（边缘节点注入的国家/城市），不展示客户端 UA.
    const cf = c.req.raw as Request & {
      cf?: { country?: unknown; city?: unknown }
    }
    const country =
      typeof cf.cf?.country === 'string' && cf.cf.country
        ? cf.cf.country
        : '未知'
    const city =
      typeof cf.cf?.city === 'string' && cf.cf.city ? cf.cf.city : '未知'
    c.executionCtx.waitUntil(
      notifyUser(
        db,
        owner.userId,
        `节点用户「${owner.name}」拉取了订阅`,
        [
          `格式：${format}`,
          `节点：${entries.length} 个`,
          `IP：${c.req.header('cf-connecting-ip') ?? '未知'}`,
          `归属地：${country} ${city}`,
          `时间：${new Date().toISOString()}`,
        ].join('\n'),
      ).then(
        () => undefined,
        () => undefined,
      ),
    )
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
