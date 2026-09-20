import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { user } from '!/db/schema'
import type { Database } from '!/db/index'

// 用户通知配置（存 user.notify_config JSON，null = 未配置）：
// 哪个渠道 enabled 就发哪个，全空/解析失败一律静默跳过.
export const notifyConfigSchema = z.object({
  feishu: z
    .object({
      enabled: z.boolean(),
      webhook: z.string().trim().min(1).max(512),
      secret: z.string().trim().max(256).optional(),
    })
    .optional(),
  telegram: z
    .object({
      enabled: z.boolean(),
      botToken: z.string().trim().min(1).max(256),
      chatId: z.string().trim().min(1).max(128),
    })
    .optional(),
})

export type NotifyConfig = z.infer<typeof notifyConfigSchema>

// 用户配置对象：notifyConfig 是其中一项，后续配置项往这里加 key；
// 缺省为 {}（空配置 = 全静默）.
export const configSchema = z.object({
  notifyConfig: notifyConfigSchema.optional(),
})

export type Config = z.infer<typeof configSchema>

/** 通知渠道抽象：新增渠道只需实现该接口并在 createNotifiers 里挂载. */
export interface Notifier {
  readonly channel: 'feishu' | 'telegram'
  send(title: string, message: string): Promise<void>
}

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

// 注意：Workers 的全局 fetch 不能被剥离后换 receiver 调用
//（如 this.fetchImpl(...) 会报 Illegal invocation），
// 默认实现包一层箭头函数保持直接调用；测试注入的普通函数不受影响.
const defaultFetch: FetchImpl = (url, init) => fetch(url, init)

function textOf(title: string, message: string): string {
  return message ? `${title}\n${message}` : title
}

/** 飞书群机器人：文本消息；配了签名密钥则加签（timestamp + HmacSHA256）. */
export class FeishuNotifier implements Notifier {
  readonly channel = 'feishu' as const
  private readonly webhook: string
  private readonly secret: string | undefined
  private readonly fetchImpl: FetchImpl
  constructor(
    webhook: string,
    secret: string | undefined,
    fetchImpl: FetchImpl = defaultFetch,
  ) {
    this.webhook = webhook
    this.secret = secret
    this.fetchImpl = fetchImpl
  }

  async send(title: string, message: string): Promise<void> {
    const body: Record<string, unknown> = {
      msg_type: 'text',
      content: { text: textOf(title, message) },
    }
    if (this.secret) {
      const timestamp = Math.floor(Date.now() / 1000).toString()
      body['timestamp'] = timestamp
      body['sign'] = await feishuSign(this.secret, timestamp)
    }
    const res = await this.fetchImpl(this.webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw new Error(`feishu http ${res.status}`)
    }
    const data = (await res.json().catch(() => null)) as {
      code?: number
      msg?: string
    } | null
    if (!data || data.code !== 0) {
      throw new Error(`feishu error: ${data?.msg ?? 'bad response'}`)
    }
  }
}

/** Telegram Bot：sendMessage 纯文本（不解析 markdown，避免特殊字符炸格式）. */
export class TelegramNotifier implements Notifier {
  readonly channel = 'telegram' as const
  private readonly botToken: string
  private readonly chatId: string
  private readonly fetchImpl: FetchImpl
  constructor(
    botToken: string,
    chatId: string,
    fetchImpl: FetchImpl = defaultFetch,
  ) {
    this.botToken = botToken
    this.chatId = chatId
    this.fetchImpl = fetchImpl
  }

  async send(title: string, message: string): Promise<void> {
    const res = await this.fetchImpl(
      `https://api.telegram.org/bot${this.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: textOf(title, message),
          disable_web_page_preview: true,
        }),
      },
    )
    if (!res.ok) {
      throw new Error(`telegram http ${res.status}`)
    }
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean
      description?: string
    } | null
    if (!data || data.ok !== true) {
      throw new Error(`telegram error: ${data?.description ?? 'bad response'}`)
    }
  }
}

/** 飞书加签：base64(HmacSHA256(key=secret, msg="timestamp\nsecret")). */
export async function feishuSign(
  secret: string,
  timestamp: string,
): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(`${timestamp}\n${secret}`),
  )
  let bin = ''
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** 按配置组装启用的渠道（未启用/缺字段的不进列表）. */
export function createNotifiers(
  config: NotifyConfig | null,
  fetchImpl: FetchImpl = defaultFetch,
): Notifier[] {
  if (!config) return []
  const out: Notifier[] = []
  if (config.feishu?.enabled && config.feishu.webhook) {
    out.push(
      new FeishuNotifier(config.feishu.webhook, config.feishu.secret, fetchImpl),
    )
  }
  if (config.telegram?.enabled && config.telegram.botToken && config.telegram.chatId) {
    out.push(
      new TelegramNotifier(
        config.telegram.botToken,
        config.telegram.chatId,
        fetchImpl,
      ),
    )
  }
  return out
}

export interface NotifyResult {
  channel: string
  ok: boolean
  error?: string
}

/** 给指定用户按其配置全渠道推送（尽力而为，单渠道失败不影响其他）.
 * 配置列缺省 {}，notifyConfig 为其中一项.
 */
export async function notifyUser(
  db: Database,
  userId: string,
  title: string,
  message: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<NotifyResult[]> {
  const rows = await db
    .select({ config: user.config })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  const config: Config = rows[0]?.config ?? {}
  const notifiers = createNotifiers(config.notifyConfig ?? null, fetchImpl)
  const settled = await Promise.allSettled(
    notifiers.map((n) => n.send(title, message)),
  )
  return notifiers.map((n, i) => {
    const r = settled[i]
    if (r && r.status === 'fulfilled') return { channel: n.channel, ok: true }
    const reason = r && r.status === 'rejected' ? r.reason : 'unknown'
    return {
      channel: n.channel,
      ok: false,
      error: reason instanceof Error ? reason.message : String(reason),
    }
  })
}
