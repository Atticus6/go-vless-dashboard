// 前端仅需解析 worker 的 AppRouter（tRPC 推导专用），无需完整 Cloudflare 类型。
// 这里声明最小 Env/D1 占位，让 tsc 在 app 工程内能解析 worker 类型；
// 运行时与真实契约无关，真实类型以 worker-configuration.d.ts 为准。
interface D1Database {
  [key: string]: unknown
}

interface Env {
  DB: D1Database
  BETTER_AUTH_SECRET: string
  ALLOW_SIGNUP: string
}
