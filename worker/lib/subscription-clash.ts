import type { SubLinkEntry, SubSecurity } from '!/lib/subscription'

// Clash 订阅 YAML 构造：代理 + ACL4SSR_Online_AdblockPlus 分流。
// 公共类型见 ./subscription（本文件仅 type-only 引用，无运行时循环依赖）.

function yamlQuote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Mihomo/Clash 配置：代理 + ACL4SSR_Online_AdblockPlus 分流（rule-providers 版）。
 * 来源：https://github.com/zhongfly/now-subconverter/blob/master/subconverter/config/ACL4SSR_Online_AdblockPlus.ini
 * 分组与规则顺序与该 INI 的 custom_proxy_group / ruleset 完全对齐；
 * `.*` 展开为当前订阅的全部节点名（即 entries 的 remark 列表）。
 * 内联版见 buildSubClashYamlUnified（服务端拉取后统一返回，无需客户端回源）；
 * 本函数同时是内联版的 proxies/proxy-groups 复用源与拉取失败时的回退。
 */
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
    // 🚀 节点选择`select`[]♻️ 自动选择`[]DIRECT`.*
    `  - name: ${yamlQuote('🚀 节点选择')}`,
    '    type: select',
    '    proxies:',
    `      - ${yamlQuote('♻️ 自动选择')}`,
    '      - DIRECT',
    ...names.map((n) => `      - ${yamlQuote(n)}`),
    // ♻️ 自动选择`url-test`.*`http://www.gstatic.com/generate_204`300,,50
    `  - name: ${yamlQuote('♻️ 自动选择')}`,
    '    type: url-test',
    '    proxies:',
    ...names.map((n) => `      - ${yamlQuote(n)}`),
    '    url: "http://www.gstatic.com/generate_204"',
    '    interval: 300',
    '    tolerance: 50',
    // 🌍 国外媒体`select`[]🚀 节点选择`[]♻️ 自动选择`[]🎯 全球直连`.*
    `  - name: ${yamlQuote('🌍 国外媒体')}`,
    '    type: select',
    '    proxies:',
    `      - ${yamlQuote('🚀 节点选择')}`,
    `      - ${yamlQuote('♻️ 自动选择')}`,
    `      - ${yamlQuote('🎯 全球直连')}`,
    ...names.map((n) => `      - ${yamlQuote(n)}`),
    // 🤖 AI`select`[]🚀 节点选择`[]♻️ 自动选择`[]🎯 全球直连`.*
    // 覆盖 OpenAI/Claude/Gemini/Copilot/Cursor 等（ACL4SSR AI.list + OpenAi.list）
    `  - name: ${yamlQuote('🤖 AI')}`,
    '    type: select',
    '    proxies:',
    `      - ${yamlQuote('🚀 节点选择')}`,
    `      - ${yamlQuote('♻️ 自动选择')}`,
    `      - ${yamlQuote('🎯 全球直连')}`,
    ...names.map((n) => `      - ${yamlQuote(n)}`),
    // 📢 谷歌FCM`select`[]🚀 节点选择`[]🎯 全球直连`[]♻️ 自动选择`.*
    `  - name: ${yamlQuote('📢 谷歌FCM')}`,
    '    type: select',
    '    proxies:',
    `      - ${yamlQuote('🚀 节点选择')}`,
    `      - ${yamlQuote('🎯 全球直连')}`,
    `      - ${yamlQuote('♻️ 自动选择')}`,
    ...names.map((n) => `      - ${yamlQuote(n)}`),
    // 📲 电报信息`select`[]🚀 节点选择`[]🎯 全球直连`.*
    `  - name: ${yamlQuote('📲 电报信息')}`,
    '    type: select',
    '    proxies:',
    `      - ${yamlQuote('🚀 节点选择')}`,
    `      - ${yamlQuote('🎯 全球直连')}`,
    ...names.map((n) => `      - ${yamlQuote(n)}`),
    // Ⓜ️ 微软服务`select`[]🎯 全球直连`[]🚀 节点选择`.*
    `  - name: ${yamlQuote('Ⓜ️ 微软服务')}`,
    '    type: select',
    '    proxies:',
    `      - ${yamlQuote('🎯 全球直连')}`,
    `      - ${yamlQuote('🚀 节点选择')}`,
    ...names.map((n) => `      - ${yamlQuote(n)}`),
    // 🍎 苹果服务`select`[]🚀 节点选择`[]🎯 全球直连`.*
    `  - name: ${yamlQuote('🍎 苹果服务')}`,
    '    type: select',
    '    proxies:',
    `      - ${yamlQuote('🚀 节点选择')}`,
    `      - ${yamlQuote('🎯 全球直连')}`,
    ...names.map((n) => `      - ${yamlQuote(n)}`),
    // 🎯 全球直连`select`[]DIRECT`[]🚀 节点选择`[]♻️ 自动选择
    `  - name: ${yamlQuote('🎯 全球直连')}`,
    '    type: select',
    '    proxies:',
    '      - DIRECT',
    `      - ${yamlQuote('🚀 节点选择')}`,
    `      - ${yamlQuote('♻️ 自动选择')}`,
    // 🛑 全球拦截`select`[]REJECT`[]DIRECT
    `  - name: ${yamlQuote('🛑 全球拦截')}`,
    '    type: select',
    '    proxies:',
    '      - REJECT',
    '      - DIRECT',
    // 🍃 应用净化`select`[]REJECT`[]DIRECT
    `  - name: ${yamlQuote('🍃 应用净化')}`,
    '    type: select',
    '    proxies:',
    '      - REJECT',
    '      - DIRECT',
    // 🆎 AdBlock`select`[]REJECT`[]DIRECT
    `  - name: ${yamlQuote('🆎 AdBlock')}`,
    '    type: select',
    '    proxies:',
    '      - REJECT',
    '      - DIRECT',
    // 🐟 漏网之鱼`select`[]🚀 节点选择`[]🎯 全球直连`[]♻️ 自动选择`.*
    `  - name: ${yamlQuote('🐟 漏网之鱼')}`,
    '    type: select',
    '    proxies:',
    `      - ${yamlQuote('🚀 节点选择')}`,
    `      - ${yamlQuote('🎯 全球直连')}`,
    `      - ${yamlQuote('♻️ 自动选择')}`,
    ...names.map((n) => `      - ${yamlQuote(n)}`),
    'rule-providers:',
    ...buildAclRuleProviders(),
    'rules:',
    // ruleset 顺序与 INI 完全一致（规则行内分组名不加引号，与 ACL4SSR 直出一致）
    '  - RULE-SET,LocalAreaNetwork,🎯 全球直连',
    '  - RULE-SET,UnBan,🎯 全球直连',
    '  - RULE-SET,BanAD,🛑 全球拦截',
    '  - RULE-SET,BanProgramAD,🍃 应用净化',
    '  - RULE-SET,BanEasyList,🆎 AdBlock',
    '  - RULE-SET,BanEasyListChina,🆎 AdBlock',
    '  - RULE-SET,BanEasyPrivacy,🆎 AdBlock',
    '  - RULE-SET,GoogleFCM,📢 谷歌FCM',
    '  - RULE-SET,GoogleCN,🎯 全球直连',
    '  - RULE-SET,Microsoft,Ⓜ️ 微软服务',
    '  - RULE-SET,Apple,🍎 苹果服务',
    '  - RULE-SET,Telegram,📲 电报信息',
    ...CUSTOM_AI_RULES,
    '  - RULE-SET,AI,🤖 AI',
    '  - RULE-SET,OpenAi,🤖 AI',
    '  - RULE-SET,ProxyMedia,🌍 国外媒体',
    '  - RULE-SET,ProxyLite,🚀 节点选择',
    '  - RULE-SET,ChinaDomain,🎯 全球直连',
    '  - RULE-SET,ChinaCompanyIp,🎯 全球直连',
    '  - GEOIP,CN,🎯 全球直连',
    '  - MATCH,🐟 漏网之鱼',
  )
  return lines.join('\n')
}

/** ACL4SSR_Online_AdblockPlus 的 rule-providers：provider 名取自规则文件名。
 * 全部 classical（兼容 DOMAIN 与 IP-CIDR 混排的 .list），每小时…每天更新一次。
 */
function buildAclRuleProviders(): string[] {
  const base = 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash'
  const files = [
    'LocalAreaNetwork.list',
    'UnBan.list',
    'BanAD.list',
    'BanProgramAD.list',
    'BanEasyList.list',
    'BanEasyListChina.list',
    'BanEasyPrivacy.list',
    'Ruleset/GoogleFCM.list',
    'GoogleCN.list',
    'Microsoft.list',
    'Apple.list',
    'Telegram.list',
    'Ruleset/AI.list',
    'Ruleset/OpenAi.list',
    'ProxyMedia.list',
    'ProxyLite.list',
    'ChinaDomain.list',
    'ChinaCompanyIp.list',
  ]
  const out: string[] = []
  for (const file of files) {
    const name = file.split('/').pop()?.replace(/\.list$/, '') ?? file
    out.push(
      `  ${name}:`,
      '    type: http',
      '    behavior: classical',
      `    url: ${yamlQuote(`${base}/${file}`)}`,
      `    path: ./ruleset/${name}.yaml`,
      '    interval: 86400',
    )
  }
  return out
}

// ---- ACL4SSR_Online_AdblockPlus 服务端内联规则 ----
// 与 INI 的 ruleset 顺序/分组完全对齐；订阅请求时由 Worker 拉取后内联进 `rules:`，
// 客户端一次拿到完整配置，不再回源抓 rule-providers.
export interface AclRuleSource {
  /** provider 名（取自规则文件名） */
  name: string
  url: string
  /** INI 里该 ruleset 指向的分组 */
  group: string
}

const ACL_BASE = 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash'

/** ACL4SSR 未收录、需手动补的 AI 域名（rule-providers 版与内联版共用，保持一致） */
const CUSTOM_AI_RULES: readonly string[] = [
  '  - DOMAIN-SUFFIX,opencode.ai,🤖 AI',
]

// Clash/Mihomo 通用规则类型白名单：不在此表的（如 URL-REGEX）
// 内核直接报错并导致整个订阅无法更新，必须在服务端过滤掉.
const SUPPORTED_ACL_RULE_TYPES: ReadonlySet<string> = new Set([
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'DOMAIN-REGEX',
  'IP-CIDR',
  'IP-CIDR6',
  'SRC-IP-CIDR',
  'DST-PORT',
  'SRC-PORT',
  'PROCESS-NAME',
  'PROCESS-PATH',
  'IP-ASN',
])

export const ACL_RULE_SOURCES: readonly AclRuleSource[] = [
  { name: 'LocalAreaNetwork', url: `${ACL_BASE}/LocalAreaNetwork.list`, group: '🎯 全球直连' },
  { name: 'UnBan', url: `${ACL_BASE}/UnBan.list`, group: '🎯 全球直连' },
  { name: 'BanAD', url: `${ACL_BASE}/BanAD.list`, group: '🛑 全球拦截' },
  { name: 'BanProgramAD', url: `${ACL_BASE}/BanProgramAD.list`, group: '🍃 应用净化' },
  { name: 'BanEasyList', url: `${ACL_BASE}/BanEasyList.list`, group: '🆎 AdBlock' },
  { name: 'BanEasyListChina', url: `${ACL_BASE}/BanEasyListChina.list`, group: '🆎 AdBlock' },
  { name: 'BanEasyPrivacy', url: `${ACL_BASE}/BanEasyPrivacy.list`, group: '🆎 AdBlock' },
  { name: 'GoogleFCM', url: `${ACL_BASE}/Ruleset/GoogleFCM.list`, group: '📢 谷歌FCM' },
  { name: 'GoogleCN', url: `${ACL_BASE}/GoogleCN.list`, group: '🎯 全球直连' },
  { name: 'Microsoft', url: `${ACL_BASE}/Microsoft.list`, group: 'Ⓜ️ 微软服务' },
  { name: 'Apple', url: `${ACL_BASE}/Apple.list`, group: '🍎 苹果服务' },
  { name: 'Telegram', url: `${ACL_BASE}/Telegram.list`, group: '📲 电报信息' },
  { name: 'AI', url: `${ACL_BASE}/Ruleset/AI.list`, group: '🤖 AI' },
  { name: 'OpenAi', url: `${ACL_BASE}/Ruleset/OpenAi.list`, group: '🤖 AI' },
  { name: 'ProxyMedia', url: `${ACL_BASE}/ProxyMedia.list`, group: '🌍 国外媒体' },
  { name: 'ProxyLite', url: `${ACL_BASE}/ProxyLite.list`, group: '🚀 节点选择' },
  { name: 'ChinaDomain', url: `${ACL_BASE}/ChinaDomain.list`, group: '🎯 全球直连' },
  { name: 'ChinaCompanyIp', url: `${ACL_BASE}/ChinaCompanyIp.list`, group: '🎯 全球直连' },
]

/** 解析 .list 文本并拼好分组：注释/空行/非法行丢弃，同源内去重。
 * 形如 `IP-CIDR,x,no-resolve` 的 payload 行展开为 `IP-CIDR,x,<group>,no-resolve`
 *（no-resolve 必须跟在分组后面才是合法 Clash 规则）。
 * 注意：只保留 Clash/Mihomo 通用的规则类型（如 URL-REGEX 内核不支持，
 * 一条不认会导致整个订阅更新失败，见 ProxyMedia 的 Amazon-Video 规则），其余丢弃。
 */
export function parseAclList(text: string, group: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (
      line.startsWith('#') ||
      line.startsWith(';') ||
      line.startsWith('//') ||
      line.startsWith('[')
    ) {
      continue
    }
    const type = /^([A-Za-z0-9-]+),/.exec(line)?.[1].toUpperCase()
    if (!type || !SUPPORTED_ACL_RULE_TYPES.has(type)) continue
    if (/\s/.test(line)) continue
    const noResolve = /^(.*),no-resolve$/i.exec(line)
    const rule = noResolve ? `${noResolve[1]},${group},no-resolve` : `${line},${group}`
    if (seen.has(rule)) continue
    seen.add(rule)
    out.push(`  - ${rule}`)
  }
  return out
}

// 规则按天更新：fetch 自带 cf 缓存（见
// https://developers.cloudflare.com/workers/examples/cache-using-fetch/），
// 2xx 缓存 6 小时、错误不缓存；不用内存 Map，多实例/重启后依然命中；
// 非 Workers 环境直接忽略 cf 参数.
const ACL_CACHE_TTL_SEC = 6 * 3600

async function fetchAclSource(
  source: AclRuleSource,
  fetchFn: typeof fetch,
): Promise<string[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const res = await fetchFn(source.url, {
      signal: controller.signal,
      cf: {
        cacheEverything: true,
        cacheTtlByStatus: {
          '200-299': ACL_CACHE_TTL_SEC,
          '400-499': 60,
          '500-599': 0,
        },
      },
    })
    if (!res.ok) throw new Error(`${source.name}: HTTP ${res.status}`)
    const rules = parseAclList(await res.text(), source.group)
    if (rules.length === 0) throw new Error(`${source.name}: empty ruleset`)
    return rules
  } finally {
    clearTimeout(timer)
  }
}

/** 内联版 Clash：复用 rule-providers 版的 proxies/proxy-groups，
 * 把 `rule-providers:` 整段替换为拉取下来的全量规则.
 */
export function buildSubClashYamlInline(
  entries: SubLinkEntry[],
  token: string,
  port: string,
  security: SubSecurity,
  expandedRules: string[],
): string {
  const base = buildSubClashYaml(entries, token, port, security)
  const head = base.split('\nrule-providers:')[0]
  return `${head}\nrules:\n${expandedRules.join('\n')}`
}

/** 拉取 18 个 ruleset 并统一内联返回；任一失败则回退 rule-providers 版
 *（客户端回源自抓，保证订阅永远可用），调用方可按 inline 打标.
 */
export async function buildSubClashYamlUnified(
  entries: SubLinkEntry[],
  token: string,
  port: string,
  security: SubSecurity,
  fetchFn: typeof fetch = fetch,
): Promise<{ body: string; inline: boolean; ruleCount: number }> {
  const settled = await Promise.allSettled(
    ACL_RULE_SOURCES.map((s) => fetchAclSource(s, fetchFn)),
  )
  if (settled.some((r) => r.status === 'rejected')) {
    return {
      body: buildSubClashYaml(entries, token, port, security),
      inline: false,
      ruleCount: 0,
    }
  }
  const fulfilled = (settled as PromiseFulfilledResult<string[]>[]).map(
    (r) => r.value,
  )
  // 自定义 AI 规则插在 AI/OpenAi 源之后、其余规则之前（顺序与 rule-providers 版一致）
  const openAiIndex = ACL_RULE_SOURCES.findIndex((s) => s.name === 'OpenAi')
  const expanded = [
    ...fulfilled.slice(0, openAiIndex + 1).flat(),
    ...CUSTOM_AI_RULES,
    ...fulfilled.slice(openAiIndex + 1).flat(),
  ]
  expanded.push('  - DOMAIN-SUFFIX,startimes.me,🎯 全球直连')
  expanded.push('  - GEOIP,CN,🎯 全球直连', '  - MATCH,🐟 漏网之鱼')
  return {
    body: buildSubClashYamlInline(entries, token, port, security, expanded),
    inline: true,
    ruleCount: expanded.length,
  }
}
