import { subDays } from 'date-fns'
import { useMemo, useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import {
  DateRangeFilter,
  endOfDayISO,
  startOfDayISO,
} from '@/components/date-range-filter'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ChartLoading } from '@/components/loading-skeletons'
import { formatBytes, formatTick } from '@/lib/bytes'
import { formatNodeName } from '@/lib/country'
import { trpc } from '@/lib/trpc'

// 分组柱数上限：超出收进“其他”，横轴保持可读；Y 轴名字超长截断，tooltip 看全名.
// Y 轴宽按刻度文本自动测量（width="auto"），中英文混排都不裁剪.
const MAX_GROUPS = 15
const NAME_TICK_LEN = 10

function truncateName(s: string): string {
  return s.length > NAME_TICK_LEN ? `${s.slice(0, NAME_TICK_LEN)}…` : s
}

// 流量分组分析弹框（节点页 / 用户页共用）：
// mode=user 按节点用户分（查某节点下各用户用量），mode=node 按节点分.
// 数据来自 nodes.trafficBreakdown（累计值差分聚合，总量倒序）；
// 日期独立筛选，缺省近 14 天（含今天）.
export function TrafficBreakdownDialog({
  open,
  onClose,
  title,
  description,
  mode,
  nodeId,
  nodeUserId,
}: {
  open: boolean
  onClose: () => void
  title: string
  description: string
  mode: 'user' | 'node'
  nodeId?: string
  nodeUserId?: string
}) {
  const { t } = useTranslation()
  const [range, setRange] = useState<DateRange | undefined>(() => ({
    from: subDays(new Date(), 13),
    to: new Date(),
  }))

  const input = useMemo(
    () => ({
      by: mode,
      nodeId,
      nodeUserId,
      from: startOfDayISO(range?.from),
      // 仅选 from 时按单天查.
      to: endOfDayISO(range?.to ?? range?.from),
    }),
    [mode, nodeId, nodeUserId, range],
  )
  const breakdownQuery = trpc.nodes.trafficBreakdown.useQuery(input, {
    enabled: open,
  })
  const totalUp = breakdownQuery.data?.totalUp ?? 0
  const totalDown = breakdownQuery.data?.totalDown ?? 0
  const loading = breakdownQuery.isPending
  const error =
    breakdownQuery.isError && breakdownQuery.error instanceof Error
      ? breakdownQuery.error.message
      : null

  // config key 即 dataKey：tooltip / 图例文案与颜色都从这里取.
  // 上行绿、下行蓝，明暗主题各一套，保证两边一眼区分.
  const chartConfig = {
    up: {
      label: t('traffic.up'),
      theme: { light: '#059669', dark: '#34d399' },
    },
    down: {
      label: t('traffic.down'),
      theme: { light: '#2563eb', dark: '#60a5fa' },
    },
  } satisfies ChartConfig

  // 后端已按总量倒序；Top N 之外并入“其他”.
  const groups = useMemo(() => {
    const rows = (breakdownQuery.data?.groups ?? []).map((g) => ({
      up: g.upBytes,
      down: g.downBytes,
      name:
        mode === 'node'
          ? formatNodeName(g.name ?? '', g.countryCode)
          : (g.name ?? t('traffic.unlinked')),
    }))
    if (rows.length <= MAX_GROUPS) return rows
    const head = rows.slice(0, MAX_GROUPS)
    const rest = rows.slice(MAX_GROUPS)
    head.push({
      up: rest.reduce((s, r) => s + r.up, 0),
      down: rest.reduce((s, r) => s + r.down, 0),
      name: t('traffic.other'),
    })
    return head
  }, [breakdownQuery.data, mode, t])
  const hasData = groups.length > 0 && totalUp + totalDown > 0

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-x-hidden overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DateRangeFilter
          id="traffic-breakdown-range"
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
          <div className="min-w-0 space-y-3">
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
            <ChartContainer config={chartConfig} className="min-h-[320px] w-full">
              <BarChart accessibilityLayer data={groups}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  height={64}
                  angle={-30}
                  textAnchor="end"
                  interval={0}
                  tickFormatter={(v) => truncateName(String(v))}
                />
                <YAxis
                  type="number"
                  // 显式留 5% 余量：最高柱不到顶，顶部刻度也有位置显示.
                  domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.05)]}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={(v) => formatTick(Number(v))}
                />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        // 标题取该柱分组的全名（轴上截断显示，这里看全名）.
                        labelFormatter={(_label, payload) => {
                          const first = Array.isArray(payload)
                            ? payload[0]
                            : undefined
                          const name = (
                            first as
                              | { payload?: { name?: unknown } }
                              | undefined
                          )?.payload?.name
                          return typeof name === 'string'
                            ? name
                            : String(_label ?? '')
                        }}
                        // 自定义 formatter 会整行替换默认渲染，这里把名字+数值一起画出来.
                        formatter={(value, name) => (
                          <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                            <span className="text-muted-foreground">
                              {String(name) === 'up'
                                ? t('traffic.up')
                                : t('traffic.down')}
                            </span>
                            <span className="font-mono font-medium text-foreground tabular-nums">
                              {formatBytes(Number(value))}
                            </span>
                          </div>
                        )}
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
