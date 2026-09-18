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
  user: {
    deleteUser: {
      enabled: true,
    },
  },
})
