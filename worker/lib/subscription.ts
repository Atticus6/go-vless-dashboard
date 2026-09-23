import { z } from 'zod'
import { buildSubClashYaml } from '!/lib/subscription-clash'
import { buildSubVlessBody } from '!/lib/subscription-v2ray'

// 订阅内容构造（公共部分）：GET /api/sub/:token 返回该 token 可访问的
// 全部 vless 节点。显式 ?format=vless|base64|clash 优先，否则按 UA 判定兜底 Clash.
//
// 文件拆分：
// - ./subscription-clash：Clash YAML（含 ACL4SSR 内联规则拉取）
// - ./subscription-v2ray：vless 链接、备注/旗帜、entries、base64 订阅体
// 本文件保留公共类型/判定/参数与 formatSubBody 分发，并 re-export 两边，
// 外部统一从 '!/lib/subscription' 导入即可.

export type SubBodyFormat = 'vless' | 'base64' | 'clash'
export type SubSecurity = 'tls' | 'none'

export interface SubNodeInput {
  id: string
  name: string
  reportedUrls: string[]
  reportedTunnelUrl: string | null
  /** 节点所在国家代码（ISO alpha-2，如 US），无则不拼 emoji. */
  countryCode: string | null
}

export interface SubLinkEntry {
  nodeId: string
  nodeName: string
  /** 实际连接地址（隧道域名会被优选地址替换，见 below） */
  address: string
  /** 上报主机名：同时用作 SNI、ws Host 头与展示 */
  host: string
  remark: string
  link: string
}

// 命中前置表的域名直连质量差：连接改走优选地址，
// SNI 与 Host 头保持原域名不变，边缘仍按 SNI/Host 回源.
// 默认前置表（兼容老行为）：trycloudflare 隧道域名；
// 用户可在 config.frontDomains 里追加（与默认表合并去重后生效）.
const QUICK_TUNNEL_FRONT = 'www.shopify.com'
export const DEFAULT_FRONT_PATTERNS: readonly string[] = [
  'trycloudflare.com',
  '*.trycloudflare.com',
]

/** 通配符匹配：'*.example.com' 匹配任意级子域（不含裸域）；
 * 普通条目精确匹配；大小写不敏感，首尾点忽略. */
export function matchDomainPattern(host: string, pattern: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.+$/, '')
  const p = pattern.trim().toLowerCase().replace(/\.+$/, '')
  if (!h || !p) return false
  if (p.startsWith('*.')) {
    const suffix = p.slice(1) // '.example.com'
    return h.length > suffix.length && h.endsWith(suffix)
  }
  return h === p
}

/** 命中任一条前置域名即走优选地址. */
export function isFrontedDomain(
  host: string,
  patterns: readonly string[] = DEFAULT_FRONT_PATTERNS,
): boolean {
  return patterns.some((p) => matchDomainPattern(host, p))
}

/** 连接地址：命中前置域换优选地址，其他原样. */
export function dialAddress(
  host: string,
  patterns: readonly string[] = DEFAULT_FRONT_PATTERNS,
): string {
  return isFrontedDomain(host, patterns) ? QUICK_TUNNEL_FRONT : host
}

// 输出格式：clash=YAML，vless=明文链接组，base64=v2rayN 标准订阅体.
// 默认值由调用方按 UA 判定（detectSubFormat），显式 ?format= 优先，兜底 Clash.
export const subFormatSchema = z.enum(['vless', 'base64', 'clash'])

// 客户端识别：Clash 系（含 Stash/Mihomo/Verge）走 YAML，链接系走 base64 批量，
// 其他（含空、浏览器、curl）一律兜底 Clash.
export function detectSubFormat(
  userAgent: string | null | undefined,
): SubBodyFormat {
  const ua = (userAgent ?? '').toLowerCase()
  if (/clash|mihomo|stash|verge|meta/.test(ua)) return 'clash'
  if (
    /v2ray|shadowrocket|neko|sing-box|streisand|v2box|hiddify|loon|\bsfa\b|\bsfi\b|\bsfm\b/.test(
      ua,
    )
  ) {
    return 'base64'
  }
  return 'clash'
}

// 设备识别（订阅拉取通知用）：优先认代理客户端，认不出再看操作系统，都没有返回“未知”。
// 只返回解析后的短标签，不回传原始 UA.
export function detectDeviceType(
  userAgent: string | null | undefined,
): string {
  const ua = (userAgent ?? '').toLowerCase()
  if (!ua) return '未知'
  const client: Array<[RegExp, string]> = [
    [/clash.?verge|verge/, 'Clash Verge'],
    [/clashx/, 'ClashX'],
    [/clashforwindows/, 'Clash for Windows'],
    [/clashforandroid/, 'Clash for Android'],
    [/flclash/, 'FlClash'],
    [/mihomo|meta/, 'Mihomo'],
    [/stash/, 'Stash'],
    [/surge/, 'Surge'],
    [/shadowrocket/, 'Shadowrocket'],
    [/quantumult/, 'Quantumult X'],
    [/loon/, 'Loon'],
    [/\bsfa\b/, 'sing-box (Android)'],
    [/\bsfi\b/, 'sing-box (iOS)'],
    [/\bsfm\b/, 'sing-box (macOS)'],
    [/sing-box/, 'sing-box'],
    [/v2rayng/, 'v2rayNG'],
    [/nekobox/, 'NekoBox'],
    [/nekoray/, 'NekoRay'],
    [/hiddify/, 'Hiddify'],
    [/streisand/, 'Streisand'],
    [/v2box/, 'V2Box'],
  ]
  for (const [re, name] of client) {
    if (re.test(ua)) return name
  }
  if (/iphone|ipad|ios/.test(ua)) return 'iOS'
  if (/android/.test(ua)) return 'Android'
  if (/windows/.test(ua)) return 'Windows'
  if (/mac os|macos|darwin/.test(ua)) return 'macOS'
  if (/linux/.test(ua)) return 'Linux'
  return '未知'
}
export const subQuerySchema = z.object({
  port: z
    .string()
    .regex(/^\d{1,5}$/)
    .refine((v) => {
      const n = Number.parseInt(v, 10)
      return n >= 1 && n <= 65535
    })
    .optional(),
  security: z.enum(['tls', 'none']).optional(),
})

export interface SubParams {
  port: string
  security: SubSecurity
}

export function resolveSubParams(query: {
  port?: string
  security?: string
}): SubParams {
  const parsed = subQuerySchema.safeParse(query)
  return {
    port: parsed.success && parsed.data.port ? parsed.data.port : '443',
    security:
      parsed.success && parsed.data.security ? parsed.data.security : 'tls',
  }
}

/** 从上报地址（https://host 或裸 host）提取主机名，提不出返回空串。 */
export function hostnameOf(url: string): string {
  const text = url.trim()
  if (!text) return ''
  try {
    return new URL(text.includes('://') ? text : `https://${text}`).hostname
  } catch {
    return ''
  }
}

/** 按格式渲染订阅体（含 Content-Type）。
 * clash 走 rule-providers 版；要服务端内联全量规则请用
 * buildSubClashYamlUnified（见 ./subscription-clash，sub.ts 已接入）.
 */
export function formatSubBody(
  format: SubBodyFormat,
  entries: SubLinkEntry[],
  token: string,
  params: SubParams,
): { body: string; contentType: string } {
  if (format === 'clash') {
    return {
      body: buildSubClashYaml(entries, token, params.port, params.security),
      contentType: 'text/yaml; charset=utf-8',
    }
  }
  const links = entries.map((e) => e.link)
  if (format === 'base64') {
    return { body: buildSubVlessBody(links), contentType: 'text/plain; charset=utf-8' }
  }
  return { body: links.join('\n'), contentType: 'text/plain; charset=utf-8' }
}

export * from '!/lib/subscription-clash'
export * from '!/lib/subscription-v2ray'
