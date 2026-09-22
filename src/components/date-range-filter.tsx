import { format } from 'date-fns'
import { enUS, zhCN } from 'date-fns/locale'
import { CalendarIcon, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { useTranslation } from 'react-i18next'
import { cn } from 'cn'
import { Button, buttonVariants } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

// 日期转 ISO 过滤边界：开始取当天 00:00，结束取当天 23:59:59.999.
export function startOfDayISO(date: Date | undefined): string | undefined {
  if (!date) return undefined
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export function endOfDayISO(date: Date | undefined): string | undefined {
  if (!date) return undefined
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

// 筛选用日期范围选择器：单个 Popover + Calendar（range 模式）。
// 选完起止自动关闭，支持一键清除；仅选了 from 时按单天处理.
// 宽屏双月、窄屏单月，避免小屏溢出.
export function DateRangeFilter({
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
              'min-w-0 flex-1 justify-between font-normal',
              from == null && 'text-muted-foreground',
            )}
          >
            <span className="min-w-0 flex-1 truncate text-left">
              {label ?? t('traffic.pickRange')}
            </span>
            <CalendarIcon className="shrink-0" />
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
