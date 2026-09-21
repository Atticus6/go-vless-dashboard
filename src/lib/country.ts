// 国家代码转旗帜 emoji，与 worker/lib/subscription 的 countryFlag 同逻辑。
// worker 不能被前端 import，前后端各一份，改一边要同步另一边。
// 展示用：节点名统一经 formatNodeName 拼旗帜；编辑框必须用原始名.
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

// 与 worker/lib/subscription 的同名表一致：名称前缀识别国家码（兜底用）.
const CODE_PREFIXES = new Set([
  'SG', 'US', 'HK', 'TW', 'JP', 'KR', 'GB', 'DE', 'FR', 'NL', 'CA', 'AU',
  'MY', 'TH', 'VN', 'IN', 'ID', 'PH', 'NZ', 'IE', 'SE', 'NO', 'DK', 'FI',
  'TR', 'AE', 'SA', 'IL', 'BR', 'MX', 'RU', 'UA', 'PL', 'ES', 'IT', 'PT',
  'GR', 'CH', 'AT', 'BE', 'ZA', 'EG',
])

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

/** 节点展示名：显式国家码优先，其次名称识别（如 🇺🇸HK），都没有返回原名. */
export function formatNodeName(
  name: string,
  countryCode: string | null | undefined,
): string {
  const code = (countryCode ?? '').trim()
  const flag = countryFlag(code || guessCountryCode(name))
  return flag ? `${flag}${name}` : name
}
