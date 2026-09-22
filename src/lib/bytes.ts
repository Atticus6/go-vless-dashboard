// 字节数格式化（B/KB/MB/GB/TB，两位小数），展示用.
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n
  let unit = 'KB'
  for (const u of units) {
    unit = u
    value /= 1024
    if (value < 1024) break
  }
  return `${value.toFixed(2)} ${unit}`
}

// 坐标轴刻度用紧凑字节（1.2M / 300K），tooltip 仍用 formatBytes 精确值.
export function formatTick(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n < 1024) return `${Math.round(n)}`
  const units = ['K', 'M', 'G', 'T']
  let value = n
  let unit = 'K'
  for (const u of units) {
    unit = u
    value /= 1024
    if (value < 1024) break
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)}${unit}`
}
