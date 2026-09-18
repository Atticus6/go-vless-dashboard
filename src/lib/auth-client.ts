import { createAuthClient } from 'better-auth/react'
import { multiSessionClient } from 'better-auth/client/plugins'

// Same-origin: dashboard 与 /api/auth 由同一个 Worker 提供，
// 无需 baseURL / CORS 配置。
export const authClient = createAuthClient({
  plugins: [multiSessionClient()],
})
