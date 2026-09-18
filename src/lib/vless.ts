// 拼装 vless 订阅链接：
// vless://<uuid>@<address>:<port>?path=&security=&encryption=none&insecure=0
//   &host=&fp=&type=&allowInsecure=0&sni=#<remark>
// 参数顺序与常见客户端导出格式对齐；host / sni 为空时省略。

export type VlessSecurity = 'none' | 'tls'
export type VlessNetwork = 'tcp' | 'ws'

export interface BuildVlessLinkInput {
  /** 当前登录用户的个人 token */
  uuid: string
  /** 连接地址（上报主机名） */
  address: string
  port: string
  security: VlessSecurity
  network: VlessNetwork
  /** 仅 network=ws 时使用 */
  path: string
  /** ws Host 头，可空 */
  host: string
  /** 客户端指纹，如 chrome */
  fp: string
  /** TLS SNI，可空 */
  sni: string
  remark: string
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value.trim())
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

export function buildVlessLink(input: BuildVlessLinkInput): string {
  const params = new URLSearchParams()
  if (input.network === 'ws') {
    const raw = input.path.trim() || '/'
    params.set('path', raw.startsWith('/') ? raw : `/${raw}`)
  }
  params.set('security', input.security)
  params.set('encryption', 'none')
  params.set('insecure', '0')
  if (input.host.trim()) params.set('host', input.host.trim())
  params.set('fp', input.fp.trim() || 'chrome')
  params.set('type', input.network)
  params.set('allowInsecure', '0')
  if (input.sni.trim()) params.set('sni', input.sni.trim())
  const address = input.address.trim()
  const port = input.port.trim()
  return `vless://${input.uuid.trim()}@${address}:${port}?${params.toString()}#${encodeURIComponent(input.remark)}`
}
