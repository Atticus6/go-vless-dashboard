import {
  DEFAULT_FRONT_PATTERNS,
  dialAddress,
  hostnameOf,
} from '!/lib/subscription'
import type {
  SubLinkEntry,
  SubNodeInput,
  SubParams,
} from '!/lib/subscription'

// v2ray 系订阅内容：vless 明文链接组（format=vless）与
// base64 批量订阅体（format=base64，v2rayN 标准格式）。
// 备注/旗帜/去重规则见 buildSubEntries.

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

/** vless 系客户端订阅体：批量链接整体 base64（v2rayN 标准订阅格式）。 */
export function buildSubVlessBody(links: string[]): string {
  const raw = links.join('\n')
  if (typeof btoa === 'function') return btoa(raw)
  const g = globalThis as { Buffer?: { from(s: string): { toString(e: string): string } } }
  if (g.Buffer) return g.Buffer.from(raw).toString('base64')
  return raw
}
