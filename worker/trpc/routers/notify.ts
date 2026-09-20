import { eq } from 'drizzle-orm'
import { user } from '!/db/schema'
import { configSchema, notifyUser, type Config } from '!/lib/notify'
import { authedProcedure, router } from '!/trpc/trpc'

// 当前登录用户的配置：读/写/测试发送.
// config 下面包含 notifyConfig（后续配置项同级扩展）；缺省 {}.
// secrets 只对属主可见（同 row 归属隔离），写全量覆盖（空对象 = 全关）.
export const notifyRouter = router({
  getConfig: authedProcedure.query(async ({ ctx }): Promise<{ config: Config }> => {
    const rows = await ctx.db
      .select({ config: user.config })
      .from(user)
      .where(eq(user.id, ctx.session.user.id))
      .limit(1)
    return { config: rows[0]?.config ?? {} }
  }),

  updateConfig: authedProcedure
    .input(configSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(user)
        .set({ config: input })
        .where(eq(user.id, ctx.session.user.id))
      return { ok: true as const }
    }),

  test: authedProcedure.mutation(async ({ ctx }) => {
    const results = await notifyUser(
      ctx.db,
      ctx.session.user.id,
      'go-vless 通知测试',
      '这是一条测试通知，说明你的通知渠道已配通。',
    )
    return { results }
  }),
})
