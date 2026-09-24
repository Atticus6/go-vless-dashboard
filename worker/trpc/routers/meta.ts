import { publicProcedure, router } from '!/trpc/trpc'

// 公开元信息：登录/注册/主页在未登录时也要读，必须用 publicProcedure。
export const metaRouter = router({
  health: publicProcedure.query(({ ctx }) => {
    return {
      ok: true as const,
      service: 'go-vless-dashboard',
      time: new Date().toISOString(),
      // 是否允许公开注册（Worker 环境变量 ALLOW_SIGNUP，缺省/非 "false" 均为允许）。
      allowSignup: String(ctx.env.ALLOW_SIGNUP).toLowerCase() !== 'false',
    }
  }),
})
