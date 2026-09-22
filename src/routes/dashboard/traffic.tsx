import { createFileRoute } from '@tanstack/react-router'
import { subDays } from 'date-fns'
import { ChartColumn } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  DateRangeFilter,
  endOfDayISO,
  startOfDayISO,
} from '@/components/date-range-filter'
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
import { ChartLoading, TableSkeleton } from '@/components/loading-skeletons'
import { formatBytes, formatTick } from '@/lib/bytes'
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

// 流量分析弹框：节点 / 用户 / 日期筛选 + 按天柱状图（上行 / 下行双柱）。
// 数据来自 nodes.trafficStats（累计值差分聚合，无数据日期补 0）；
// 筛选独立于主表，打开时继承主表筛选项，无选择时默认近 14 天.
function TrafficStatsDialog({
  nodes,
  users,
  initialNodeId,
  initialNodeUserId,
  initialRange,
  onClose,
}: {
  nodes: Array<{ id: string; name: string; countryCode: string | null }>
  users: Array<{ id: string; name: string }>
  initialNodeId: string
  initialNodeUserId: string
  initialRange: DateRange | undefined
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [nodeId, setNodeId] = useState(initialNodeId)
  const [nodeUserId, setNodeUserId] = useState(initialNodeUserId)
  // 缺省近 14 天（含今天），与后端 trafficStats 缺省对齐.
  const [range, setRange] = useState<DateRange | undefined>(
    initialRange ?? { from: subDays(new Date(), 13), to: new Date() },
  )

  const input = useMemo(
    () => ({
      nodeId: nodeId || undefined,
      nodeUserId: nodeUserId || undefined,
      from: startOfDayISO(range?.from),
      // 仅选 from 时按单天查.
      to: endOfDayISO(range?.to ?? range?.from),
    }),
    [nodeId, nodeUserId, range],
  )
  const statsQuery = trpc.nodes.trafficStats.useQuery(input)
  const days = statsQuery.data?.days ?? []
  const totalUp = statsQuery.data?.totalUp ?? 0
  const totalDown = statsQuery.data?.totalDown ?? 0
  const hasData = days.some((d) => d.upBytes > 0 || d.downBytes > 0)
  const loading = statsQuery.isPending
  const error =
    statsQuery.isError && statsQuery.error instanceof Error
      ? statsQuery.error.message
      : null
  // config key 即 dataKey：tooltip / 图例文案与颜色都从这里取.
  const chartConfig = {
    up: { label: t('traffic.up'), color: 'var(--chart-1)' },
    down: { label: t('traffic.down'), color: 'var(--chart-2)' },
  } satisfies ChartConfig
  const chartData = days.map((d) => ({
    date: d.date,
    up: d.upBytes,
    down: d.downBytes,
  }))

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('traffic.analytics')}</DialogTitle>
          <DialogDescription>{t('traffic.analyticsDesc')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="traffic-stats-node">{t('traffic.node')}</Label>
            <Select
              value={nodeId || 'all'}
              items={[
                { value: 'all', label: t('traffic.all') },
                ...nodes.map((n) => ({
                  value: n.id,
                  label: formatNodeName(n.name, n.countryCode),
                })),
              ]}
              onValueChange={(v) => setNodeId(v === 'all' ? '' : (v ?? ''))}
            >
              <SelectTrigger id="traffic-stats-node" className="w-full">
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
            <Label htmlFor="traffic-stats-user">{t('traffic.user')}</Label>
            <Select
              value={nodeUserId || 'all'}
              items={[
                { value: 'all', label: t('traffic.all') },
                ...users.map((u) => ({ value: u.id, label: u.name })),
              ]}
              onValueChange={(v) => setNodeUserId(v === 'all' ? '' : (v ?? ''))}
            >
              <SelectTrigger id="traffic-stats-user" className="w-full">
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
        </div>
        <DateRangeFilter
          id="traffic-stats-range"
          value={range}
          onChange={setRange}
        />

        {loading && <ChartLoading />}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!loading && !error && !hasData && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t('traffic.analyticsEmpty')}
          </p>
        )}
        {!loading && !error && hasData && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <p className="text-muted-foreground">
                {t('traffic.periodUp')}:{' '}
                <span className="font-mono font-medium text-foreground">
                  {formatBytes(totalUp)}
                </span>
              </p>
              <p className="text-muted-foreground">
                {t('traffic.periodDown')}:{' '}
                <span className="font-mono font-medium text-foreground">
                  {formatBytes(totalDown)}
                </span>
              </p>
            </div>
            <ChartContainer config={chartConfig} className="min-h-[280px] w-full">
              <BarChart accessibilityLayer data={chartData}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={24}
                  tickFormatter={(v) => String(v).slice(5)}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={(v) => formatTick(Number(v))}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => formatBytes(Number(value))}
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="up" fill="var(--color-up)" radius={[4, 4, 0, 0]} />
                <Bar
                  dataKey="down"
                  fill="var(--color-down)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          </div>
        )}
      </DialogContent>
    </Dialog>
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
  // 分析弹框开关：条件挂载，打开时继承主表筛选项.
  const [statsOpen, setStatsOpen] = useState(false)
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
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('menu.traffic')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('traffic.desc')}
          </p>
        </div>
        <Button
          variant="outline"
          className="shrink-0"
          onClick={() => setStatsOpen(true)}
        >
          <ChartColumn />
          {t('traffic.analytics')}
        </Button>
      </div>

      {statsOpen && (
        <TrafficStatsDialog
          nodes={nodes}
          users={users}
          initialNodeId={nodeId}
          initialNodeUserId={nodeUserId}
          initialRange={range}
          onClose={() => setStatsOpen(false)}
        />
      )}
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
