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

// Cloudflare 快速隧道域名直连在部分地区质量差：连接改走优选地址，
// SNI 与 Host 头保持隧道域名不变，边缘仍按 SNI/Host 回源到隧道.
const QUICK_TUNNEL_SUFFIX = /(^|\.)trycloudflare\.com$/i
const QUICK_TUNNEL_FRONT = 'www.shopify.com'

export function isQuickTunnel(host: string): boolean {
  return QUICK_TUNNEL_SUFFIX.test(host.trim())
}

/** 连接地址：隧道域名换优选地址，其他原样. */
export function dialAddress(host: string): string {
  return isQuickTunnel(host) ? QUICK_TUNNEL_FRONT : host
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
 * 备注格式：单地址时直接用节点名（如 HK），多地址时节点名-序号-地址hash5位
 * （如 HK-1-a1b2c），序号为该节点内地址序号；
 * 全局重名时缀序号保证唯一.
 */
export function buildSubEntries(
  nodes: SubNodeInput[],
  token: string,
  params: SubParams,
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
    hosts.forEach((host, index) => {
      const base =
        hosts.length === 1
          ? node.name
          : `${node.name}-${index + 1}-${addrHash5(host)}`
      let remark = base
      let i = 2
      while (used.has(remark)) {
        remark = `${base}-${i}`
        i += 1
      }
      used.add(remark)
      const address = dialAddress(host)
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
