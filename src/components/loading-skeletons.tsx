import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { cn } from 'cn'

// 表格骨架：圆角边框容器 + 表头条 + 若干行，贴合 Card + Table 的视觉.
export function TableSkeleton({
  rows = 5,
  cols = 4,
  avatar = false,
  className,
}: {
  rows?: number
  cols?: number
  /** 首列是否为圆形/方形头像占位（节点表格有图标列） */
  avatar?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  // 确定性宽度循环，避免随机数导致的水合/闪烁差异.
  const widths = ['w-24', 'w-32', 'w-20', 'w-28', 'w-16', 'w-36']
  return (
    <div
      role="status"
      className={cn('overflow-hidden rounded-lg border', className)}
    >
      <span className="sr-only">{t('overview.loading')}</span>
      <div className="flex gap-4 border-b bg-muted/30 px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className={cn('h-4 flex-1', widths[i % widths.length])} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex items-center gap-4 border-b px-4 py-3 last:border-0"
        >
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton
              key={i}
              className={cn(
                'h-4 flex-1',
                widths[(r + i) % widths.length],
                i === 0 &&
                  avatar &&
                  'size-9 shrink-0 grow-0 rounded-lg',
              )}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

// 表单骨架：标签条 + 输入框条，贴合筛选卡/配置卡.
export function FormSkeleton({
  rows = 3,
  className,
}: {
  rows?: number
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <div role="status" className={cn('space-y-4', className)}>
      <span className="sr-only">{t('overview.loading')}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  )
}

// 信息盒骨架：贴合连通弹窗里的圆角 border 详情块.
export function DetailBoxSkeleton({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      className={cn('space-y-2 rounded-lg border p-3', className)}
    >
      <span className="sr-only">{t('overview.loading')}</span>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  )
}

// 图表加载：转圈动画 + 文字，占位高度与图表区一致，弹框共用.
export function ChartLoading({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      className={cn(
        'flex h-72 w-full flex-col items-center justify-center gap-3 text-muted-foreground',
        className,
      )}
    >
      <Spinner className="size-8" />
      <p className="text-sm">{t('overview.loading')}</p>
    </div>
  )
}
