import { z } from 'zod'

// 订阅内容构造（纯函数）：GET /api/sub/:token 返回该 token 可访问的
// 全部 vless 节点。显式 ?format=vless|base64|clash 优先，否则按 UA 判定兜底 Clash.

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

// ?port= / ?security= 覆盖（非法回退默认 443 / tls）.
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

/** vless 订阅链接（与前端单节点复制格式对齐）：ws + 443/tls 默认。
 * address=实际连接地址，host=上报主机名（SNI + ws Host 头）。
 */
export function buildSubLink(
  token: string,
  address: string,
  host: string,
  remark: string,
  params: SubParams,
): string {
  const query = new URLSearchParams()
  query.set('path', '/')
  query.set('security', params.security)
  query.set('encryption', 'none')
  query.set('insecure', '0')
  query.set('host', host)
  query.set('fp', 'chrome')
  query.set('type', 'ws')
  query.set('allowInsecure', '0')
  query.set('sni', host)
  return `vless://${token}@${address}:${params.port}?${query.toString()}#${encodeURIComponent(remark)}`
}

/** 国家代码转旗帜 emoji（区域指示符拼合法）：US → 🇺🇸。
 * 非标准两位字母一律返回空串（调用方直接不拼）.
 * UK 归一化为 GB（UK 不是合法旗帜，会退化成字母）.
 */
export function countryFlag(
  countryCode: string | null | undefined,
): string {
  let code = (countryCode ?? '').trim().toUpperCase()
  if (code === 'UK') code = 'GB'
  if (!/^[A-Z]{2}$/.test(code)) return ''
  const base = 0x1f1e6 - 65 // 'A'.charCodeAt(0)
  return String.fromCodePoint(
    base + code.charCodeAt(0),
    base + code.charCodeAt(1),
  )
}

// 名称前缀识别国家码的白名单（兜底用）：仅匹配开头，命中即返回.
// 两位字母如 sgvercel、us美国railway；中文如 法国scaleway、新加坡Oracle.
const CODE_PREFIXES = new Set([
  'SG', 'US', 'HK', 'TW', 'JP', 'KR', 'GB', 'DE', 'FR', 'NL', 'CA', 'AU',
  'MY', 'TH', 'VN', 'IN', 'ID', 'PH', 'NZ', 'IE', 'SE', 'NO', 'DK', 'FI',
  'TR', 'AE', 'SA', 'IL', 'BR', 'MX', 'RU', 'UA', 'PL', 'ES', 'IT', 'PT',
  'GR', 'CH', 'AT', 'BE', 'ZA', 'EG',
])

// 中文名前缀 → 国家码（长的在前，如印度尼西亚优先于印度）.
const NAME_PREFIXES: Array<[string, string]> = [
  ['印度尼西亚', 'ID'],
  ['新加坡', 'SG'],
  ['马来西亚', 'MY'],
  ['澳大利亚', 'AU'],
  ['美国', 'US'],
  ['法国', 'FR'],
  ['英国', 'GB'],
  ['德国', 'DE'],
  ['日本', 'JP'],
  ['韩国', 'KR'],
  ['香港', 'HK'],
  ['台湾', 'TW'],
  ['澳洲', 'AU'],
  ['加拿大', 'CA'],
  ['荷兰', 'NL'],
  ['泰国', 'TH'],
  ['越南', 'VN'],
  ['印度', 'IN'],
  ['印尼', 'ID'],
  ['菲律宾', 'PH'],
  ['土耳其', 'TR'],
  ['阿联酋', 'AE'],
  ['以色列', 'IL'],
  ['巴西', 'BR'],
  ['墨西哥', 'MX'],
  ['俄罗斯', 'RU'],
  ['乌克兰', 'UA'],
  ['波兰', 'PL'],
  ['西班牙', 'ES'],
  ['意大利', 'IT'],
  ['葡萄牙', 'PT'],
  ['希腊', 'GR'],
  ['瑞士', 'CH'],
  ['瑞典', 'SE'],
  ['挪威', 'NO'],
  ['丹麦', 'DK'],
  ['芬兰', 'FI'],
  ['爱尔兰', 'IE'],
  ['新西兰', 'NZ'],
  ['南非', 'ZA'],
  ['埃及', 'EG'],
]

/** 从节点名称开头识别国家码（countryCode 为空时的兜底）：
 * 显式国家码优先，心跳写入后以码为准；识别不到返回 null.
 */
export function guessCountryCode(name: string): string | null {
  const text = name.trim()
  if (!text) return null
  for (const [prefix, code] of NAME_PREFIXES) {
    if (text.startsWith(prefix)) return code
  }
  const m = /^[a-z]{2}/i.exec(text)
  if (m) {
    const code = m[0].toUpperCase()
    if (code === 'UK') return 'GB'
    if (CODE_PREFIXES.has(code)) return code
  }
  return null
}

/** 节点旗帜：显式国家码优先，其次名称识别，都没有返回空串. */
export function nodeFlag(
  name: string,
  countryCode: string | null | undefined,
): string {
  const code = (countryCode ?? '').trim()
  return countryFlag(code || guessCountryCode(name))
}

/** 地址 5 位 hash（FNV-1a，备注区分用，各运行时结果一致）.
 * 注意取的是上报主机名 host（隧道各自不同），而非优选后的连接地址.
 */
export function addrHash5(host: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < host.length; i++) {
    h ^= host.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 5)
}
/** 范围内每个节点的全部上报地址逐个出一条链接：
 * urls 在前、隧道地址垫底，同节点内去重；无上报地址的节点跳过.
 * 备注格式：国旗前缀 + 节点名，单地址如 🇺🇸HK，多地址如 🇺🇸HK-1-a1b2c
 * （序号为该节点内地址序号）；旗帜先认 countryCode，没有再从名称识别，
 * 都没有则不拼 emoji；全局重名时缀序号保证唯一.
 */
export function buildSubEntries(
  nodes: SubNodeInput[],
  token: string,
  params: SubParams,
  frontPatterns: readonly string[] = DEFAULT_FRONT_PATTERNS,
): SubLinkEntry[] {
  const out: SubLinkEntry[] = []
  const used = new Set<string>()
  for (const node of nodes) {
    const hosts = [
      ...new Set(
        [...node.reportedUrls, node.reportedTunnelUrl ?? '']
          .map((raw) => hostnameOf(raw))
          .filter((h) => h !== ''),
      ),
    ]
    // 备注名前拼旗帜（如 🇺🇸HK）：显式国家码优先，否则从名称识别；
    // 都没有则直接用节点名.
    const flag = nodeFlag(node.name, node.countryCode)
    const displayName = flag ? `${flag}${node.name}` : node.name
    hosts.forEach((host, index) => {
      const base =
        hosts.length === 1
          ? displayName
          : `${displayName}-${index + 1}-${addrHash5(host)}`
      let remark = base
      let i = 2
      while (used.has(remark)) {
        remark = `${base}-${i}`
        i += 1
      }
      used.add(remark)
      const address = dialAddress(host, frontPatterns)
      out.push({
        nodeId: node.id,
        nodeName: node.name,
        address,
        host,
        remark,
        link: buildSubLink(token, address, host, remark, params),
      })
    })
  }
  return out
}

function yamlQuote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Mihomo/Clash 通用配置：代理 + 选择组 + 自动组 + 兜底规则。 */
export function buildSubClashYaml(
  entries: SubLinkEntry[],
  token: string,
  port: string,
  security: SubSecurity,
): string {
  const portNum = Number.parseInt(port, 10)
  const lines: string[] = ['proxies:']
  const names: string[] = []
  for (const e of entries) {
    names.push(e.remark)
    lines.push(
      `  - name: ${yamlQuote(e.remark)}`,
      '    type: vless',
      `    server: ${yamlQuote(e.address)}`,
      `    port: ${Number.isFinite(portNum) ? portNum : 443}`,
      `    uuid: ${token}`,
      '    network: ws',
      '    udp: true',
    )
    if (security === 'tls') {
      lines.push(
        '    tls: true',
        `    servername: ${yamlQuote(e.host)}`,
        '    skip-cert-verify: false',
        '    ws-opts:',
        '      path: "/"',
        '      headers:',
        `        Host: ${yamlQuote(e.host)}`,
      )
    } else {
      lines.push(
        '    tls: false',
        '    ws-opts:',
        '      path: "/"',
        '      headers:',
        `        Host: ${yamlQuote(e.host)}`,
      )
    }
  }
  lines.push(
    'proxy-groups:',
    '  - name: "Proxy"',
    '    type: select',
    '    proxies:',
    ...names.map((n) => `      - ${yamlQuote(n)}`),
    '      - DIRECT',
    '  - name: "Auto"',
    '    type: url-test',
    '    proxies:',
    ...names.map((n) => `      - ${yamlQuote(n)}`),
    '    url: "https://www.gstatic.com/generate_204"',
    '    interval: 300',
    'rules:',
    '  - MATCH,Proxy',
  )
  return lines.join('\n')
}

/** 按格式渲染订阅体（含 Content-Type）。 */
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

/** vless 系客户端订阅体：批量链接整体 base64（v2rayN 标准订阅格式）。 */
export function buildSubVlessBody(links: string[]): string {
  const raw = links.join('\n')
  if (typeof btoa === 'function') return btoa(raw)
  const g = globalThis as { Buffer?: { from(s: string): { toString(e: string): string } } }
  if (g.Buffer) return g.Buffer.from(raw).toString('base64')
  return raw
}
