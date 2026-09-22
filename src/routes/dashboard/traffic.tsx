import { createFileRoute } from '@tanstack/react-router'
import { format } from 'date-fns'
import { enUS, zhCN } from 'date-fns/locale'
import { CalendarIcon, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { useTranslation } from 'react-i18next'
import { cn } from 'cn'
import { Button, buttonVariants } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatNodeName } from '@/lib/country'
import { TableSkeleton } from '@/components/loading-skeletons'
import { trpc } from '@/lib/trpc'
import type { RouterOutputs } from '@/lib/trpc'

// 流量记录查询页：筛选（节点 / 用户 / 日期范围）+ 记录表 + cursor 分页.
// 数据来自 nodes.trafficList（后端定时上报的快照），空表显示空状态.
export const Route = createFileRoute('/dashboard/traffic')({
  component: TrafficPage,
})

// 单行记录类型：由 tRPC RouterOutputs 全链路推导，后端改字段这里自动跟随.
type TrafficRecordItem =
  RouterOutputs['nodes']['trafficList']['records'][number]

// 每页条数：默认 20（表行高，50 一屏太满）；与后端 trafficList 默认 limit 对齐，
// 后端上限 200，前端档位不超过 100.
const DEFAULT_PAGE_SIZE = 10
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

// 字节数格式化（B/KB/MB/GB/TB，两位小数），展示用.
function formatBytes(n: number): string {
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

// 日期转 ISO 过滤边界：开始取当天 00:00，结束取当天 23:59:59.999.
function startOfDayISO(date: Date | undefined): string | undefined {
  if (!date) return undefined
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function endOfDayISO(date: Date | undefined): string | undefined {
  if (!date) return undefined
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

// 筛选用日期范围选择器：单个 Popover + Calendar（range 模式）。
// 选完起止自动关闭，支持一键清除；仅选了 from 时按单天处理.
// 宽屏双月、窄屏单月，避免小屏溢出.
function DateRangeFilter({
  id,
  value,
  onChange,
}: {
  id: string
  value: DateRange | undefined
  onChange: (next: DateRange | undefined) => void
}) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [twoMonths, setTwoMonths] = useState(false)
  const locale = i18n.language.startsWith('zh') ? zhCN : enUS

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 720px)')
    const update = () => setTwoMonths(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  const from = value?.from
  const to = value?.to
  const label = ((): string | null => {
    if (from == null) return null
    if (to == null || from.getTime() === to.getTime()) {
      return format(from, 'PPP', { locale })
    }
    return `${format(from, 'PPP', { locale })} – ${format(to, 'PPP', { locale })}`
  })()

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{t('traffic.range')}</Label>
      <div className="flex gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            id={id}
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'flex-1 justify-between font-normal',
              from == null && 'text-muted-foreground',
            )}
          >
            {label ?? <span>{t('traffic.pickRange')}</span>}
            <CalendarIcon />
          </PopoverTrigger>
          <PopoverContent className="w-auto overflow-hidden p-0" align="start">
            <Calendar
              mode="range"
              locale={locale}
              selected={value}
              defaultMonth={value?.from}
              captionLayout="dropdown"
              numberOfMonths={twoMonths ? 2 : 1}
              onSelect={(range) => {
                onChange(range)
                if (range?.from && range?.to) setOpen(false)
              }}
            />
          </PopoverContent>
        </Popover>
        {from != null && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('traffic.clearRange')}
            onClick={() => onChange(undefined)}
          >
            <X />
          </Button>
        )}
      </div>
    </div>
  )
}

function TrafficPage() {
  const { t } = useTranslation()
  // 筛选状态：空字符串 = 不限（传参时转 undefined）；改任一筛选都要回到第一页.
  const [nodeId, setNodeId] = useState('')
  const [nodeUserId, setNodeUserId] = useState('')
  const [range, setRange] = useState<DateRange | undefined>(undefined)
  // cursor 分页状态：栈存每页入口游标，首页为 undefined；
  // 下一页压入本页返回的 nextCursor，上一页弹出栈顶（后端只做向前翻页）.
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  // 每页条数：改档位回到第一页（游标位置与 limit 强相关，旧栈直接作废）.
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const page = cursors.length
  const currentCursor = cursors[cursors.length - 1]

  // 下拉选项数据：节点列表与节点用户列表（与节点用户页同源）.
  const nodesQuery = trpc.nodes.list.useQuery()
  const usersQuery = trpc.nodes.nodeUserList.useQuery()
  const nodes = nodesQuery.data?.nodes ?? []
  const users = usersQuery.data?.users ?? []

  // 查询入参：useMemo 定住引用，避免每次渲染触发重复请求；
  // 空筛选转 undefined（后端视为不限），日期按天边界换算成 ISO.
  // cursor 取栈顶（首页为 undefined），改过滤时栈已重置.
  const input = useMemo(
    () => ({
      nodeId: nodeId || undefined,
      nodeUserId: nodeUserId || undefined,
      from: startOfDayISO(range?.from),
      // 仅选 from 时按单天查.
      to: endOfDayISO(range?.to ?? range?.from),
      limit: pageSize,
      cursor: currentCursor,
    }),
    [nodeId, nodeUserId, range, pageSize, currentCursor],
  )
  const listQuery = trpc.nodes.trafficList.useQuery(input)
  const records: TrafficRecordItem[] = listQuery.data?.records ?? []
  const hasMore = listQuery.data?.hasMore ?? false
  const nextCursor = listQuery.data?.nextCursor ?? null
  const loading = listQuery.isPending
  const fetching = listQuery.isFetching
  const error =
    listQuery.isError && listQuery.error instanceof Error
      ? listQuery.error.message
      : null

  // 筛选变化统一回到第一页：旧游标栈在新过滤下无意义.
  function resetPage() {
    setCursors([undefined])
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('menu.traffic')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('traffic.desc')}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('traffic.filterTitle')}</CardTitle>
          <CardDescription>{t('traffic.filterDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="traffic-node">{t('traffic.node')}</Label>
              {/* items 显式传 label：弹窗关闭后回显不依赖 DOM，否则只显示 id. */}
              <Select
                value={nodeId || 'all'}
                items={[
                  { value: 'all', label: t('traffic.all') },
                  ...nodes.map((n) => ({
                    value: n.id,
                    label: formatNodeName(n.name, n.countryCode),
                  })),
                ]}
                onValueChange={(v) => {
                  setNodeId(v === 'all' ? '' : (v ?? ''))
                  resetPage()
                }}
              >
                <SelectTrigger id="traffic-node" className="w-full">
                  <SelectValue placeholder={t('traffic.all')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('traffic.all')}</SelectItem>
                  {nodes.map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      {formatNodeName(n.name, n.countryCode)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="traffic-user">{t('traffic.user')}</Label>
              {/* 同上：value 是行 id，展示靠 items 里的 name. */}
              <Select
                value={nodeUserId || 'all'}
                items={[
                  { value: 'all', label: t('traffic.all') },
                  ...users.map((u) => ({ value: u.id, label: u.name })),
                ]}
                onValueChange={(v) => {
                  setNodeUserId(v === 'all' ? '' : (v ?? ''))
                  resetPage()
                }}
              >
                <SelectTrigger id="traffic-user" className="w-full">
                  <SelectValue placeholder={t('traffic.all')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('traffic.all')}</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DateRangeFilter
              id="traffic-range"
              value={range}
              onChange={(next) => {
                setRange(next)
                resetPage()
              }}
            />
          </div>
        </CardContent>
      </Card>

      {loading && <TableSkeleton rows={8} cols={6} />}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && !error && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t('traffic.time')}</TableHead>
                  <TableHead>{t('traffic.node')}</TableHead>
                  <TableHead>{t('traffic.user')}</TableHead>
                  <TableHead className="text-right">{t('traffic.up')}</TableHead>
                  <TableHead className="text-right">
                    {t('traffic.down')}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('traffic.total')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-sm text-muted-foreground"
                    >
                      {t('traffic.empty')}
                    </TableCell>
                  </TableRow>
                )}
                {records.map((r) => (
                  <TableRow key={r.id}>
                    {/* 记录时间跟浏览器 locale；理论上恒有值，防御性兜底. */}
                    <TableCell className="whitespace-nowrap text-xs">
                      {r.recordedAt
                        ? new Date(r.recordedAt).toLocaleString()
                        : '—'}
                    </TableCell>
                    <TableCell className="font-medium">
                      {formatNodeName(r.nodeName, r.nodeCountryCode)}
                    </TableCell>
                    {/* 用户名为空 = 上报时未映射或用户已删，显示未关联. */}
                    <TableCell className="text-sm text-muted-foreground">
                      {r.nodeUserName ?? t('traffic.unlinked')}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatBytes(r.upBytes)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatBytes(r.downBytes)}
                    </TableCell>
                    {/* 合计前端现算：快照行即当次全量，无需跨行累加. */}
                    <TableCell className="text-right font-mono text-xs">
                      {formatBytes(r.upBytes + r.downBytes)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* 分页条：cursor 无总数，展示当前页码与本页条数；首页且空记录时不展示. */}
      {!loading && !error && (records.length > 0 || cursors.length > 1) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {t('traffic.page', { page, size: records.length })}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {t('traffic.perPage')}
            </span>
            <Select
              value={String(pageSize)}
              items={PAGE_SIZE_OPTIONS.map((n) => ({
                value: String(n),
                label: String(n),
              }))}
              onValueChange={(v) => {
                const n = Number(v)
                if (!Number.isInteger(n) || n <= 0) return
                setPageSize(n)
                setCursors([undefined])
              }}
            >
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              disabled={cursors.length <= 1 || fetching}
              onClick={() => setCursors((prev) => prev.slice(0, -1))}
            >
              {t('traffic.prev')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasMore || !nextCursor || fetching}
              onClick={() => {
                if (nextCursor) setCursors((prev) => [...prev, nextCursor])
              }}
            >
              {t('traffic.next')}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
