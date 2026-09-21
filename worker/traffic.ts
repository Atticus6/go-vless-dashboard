import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { node, nodeUser, trafficRecord } from '!/db/app-schema'
import { createDb } from '!/db/index'
import { trafficReportBodySchema } from '!/lib/validators'
import { generateId } from '!/lib/utils'
import { zValidator } from '!/lib/zod-validator'
import { safeEqual } from '!/register'

// go-vless 后端流量上报：公开接口，凭节点 id + configKey 鉴权（与反向注册同级）。
// POST /api/traffic/report，一次上报该节点全用户快照（一用户落一行）。
// 不走 tRPC：Go 端实现 devalue 编解码成本过高，普通 JSON 即可.
// 上报节奏由后端心跳触发（默认 30 分钟），服务端这里只管鉴权落库，不回查后端.
const trafficApp = new Hono<{ Bindings: Env }>().post(
  '/report',
  zValidator('json', trafficReportBodySchema),
  async (c) => {
    const { id, key, users } = c.req.valid('json')
    const db = createDb(c.env.DB)
    // 先认节点：查无此 id、未配 key、key 对不上，一律 401（不区分原因）.
    const rows = await db.select().from(node).where(eq(node.id, id)).limit(1)
    const target = rows[0]
    if (!target || !target.configKey || !safeEqual(key, target.configKey)) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    // token → 节点用户 id：只认本节点所属用户名下的 token（防跨用户 token 串扰）；
    // 对不上的记空（未知 uuid 照常入库，查询页显示未关联），不断流.
    const known = await db
      .select({ id: nodeUser.id, token: nodeUser.token })
      .from(nodeUser)
      .where(eq(nodeUser.userId, target.userId))
    const tokenToId = new Map(known.map((u) => [u.token, u.id] as const))
    // 空上报直接返回，避免空批量插入；recordedAt 走库默认（同批时间戳一致）.
    if (users.length > 0) {
      await db.insert(trafficRecord).values(
        users.map((u) => ({
          id: generateId(),
          nodeId: target.id,
          nodeUserId: tokenToId.get(u.uuid) ?? null,
          upBytes: u.upBytes,
          downBytes: u.downBytes,
        })),
      )
    }
    return c.json({ ok: true, recorded: users.length })
  },
)

export default trafficApp
