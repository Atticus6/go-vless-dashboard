import { initTRPC, TRPCError } from '@trpc/server'
import type { Context } from '!/trpc/context'
import { devalueTransformer } from '!/trpc/transformer'

const t = initTRPC.context<Context>().create({
  transformer: devalueTransformer,
})

export const router = t.router
export const publicProcedure = t.procedure

// 登录守卫：与 Hono requireAuth 同行为，未登录抛 UNAUTHORIZED。
export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Unauthorized' })
  }
  return next({
    ctx: { ...ctx, session: ctx.session },
  })
})
