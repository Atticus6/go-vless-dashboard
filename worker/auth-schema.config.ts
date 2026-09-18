import { betterAuth } from 'better-auth/minimal'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import type { D1Database } from '@cloudflare/workers-types'
import { drizzle } from 'drizzle-orm/d1'

// CLI-only mirror of worker/auth.ts (see note below).
// The placeholder client is never queried: `generate` only reads the
// adapter structure to emit the schema.
// Keep emailAndPassword/plugins in sync with worker/auth.ts, then run:
//   bunx better-auth generate \
//     --config ./worker/auth-schema.config.ts \
//     --output ./worker/db/schema.ts -y
const db = drizzle({} as D1Database)

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'sqlite',
  }),
  emailAndPassword: {
    enabled: true,
  },
  // 与 worker/auth.ts 保持同步（见上注）。
  // 注意：required 保持 false（原因见 worker/auth.ts）；重新 generate 后
  // 若把 token 变回 nullable，需手动改回 .notNull() 以对齐 D1 约束。
  user: {
    additionalFields: {
      token: {
        type: 'string',
        required: false,
        input: false,
      },
    },
  },
})
