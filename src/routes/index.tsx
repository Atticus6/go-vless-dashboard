import { createFileRoute } from '@tanstack/react-router'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  ChartColumn,
  KeyRound,
  LogIn,
  Network,
  RefreshCw,
  Server,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { LanguageSwitcher } from '@/components/language-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { Spinner } from '@/components/ui/spinner'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/')({
  component: IndexComponent,
})

const stack = [
  'TanStack Router',
  'Base UI',
  'Hono',
  'Cloudflare Workers',
]

function StatusDot({ state }: { state: 'ok' | 'error' | 'loading' }) {
  return (
    <span className="relative flex size-2">
      {state !== 'error' && (
        <span
          className={cn(
            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
            state === 'ok' ? 'bg-emerald-500' : 'bg-muted-foreground',
          )}
        />
      )}
      <span
        className={cn(
          'relative inline-flex size-2 rounded-full',
          state === 'ok'
            ? 'bg-emerald-500'
            : state === 'loading'
              ? 'bg-muted-foreground'
              : 'bg-destructive',
        )}
      />
    </span>
  )
}

function IndexComponent() {
  const { t } = useTranslation()
  // 服务状态走 tRPC 公开查询（trpc.meta.health），替代已下线的 /api/health。
  const healthQuery = trpc.meta.health.useQuery(undefined, { retry: 1 })
  const data = healthQuery.data
  const loading = healthQuery.isPending
  const ok = data?.ok === true
  const state = loading ? 'loading' : ok ? 'ok' : 'error'

  const features = [
    {
      icon: Server,
      title: t('home.fNodesTitle'),
      desc: t('home.fNodesDesc'),
    },
    {
      icon: Users,
      title: t('home.fUsersTitle'),
      desc: t('home.fUsersDesc'),
    },
    {
      icon: ChartColumn,
      title: t('home.fTrafficTitle'),
      desc: t('home.fTrafficDesc'),
    },
    {
      icon: KeyRound,
      title: t('home.fSecureTitle'),
      desc: t('home.fSecureDesc'),
    },
  ]

  return (
    <div className="relative min-h-svh overflow-x-clip">
      {/* 背景装饰：网格 + 光晕，浅深色通吃 */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="bg-grid-fade absolute inset-x-0 top-0 h-[560px]" />
        <div className="absolute -top-32 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
      </div>

      {/* 顶栏 */}
      <header className="sticky top-0 z-20 border-b bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-linear-to-br from-primary to-primary/55 text-primary-foreground shadow-xs">
            <Network className="size-4" />
          </div>
          <span className="truncate text-sm font-semibold tracking-tight">
            {t('app.title')}
          </span>
          <span className="flex-1" />
          <LanguageSwitcher />
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link to="/auth/$path" params={{ path: 'sign-in' }} />}
          >
            <LogIn />
            {t('home.navLogin')}
          </Button>
          <Button
            size="sm"
            nativeButton={false}
            render={<Link to="/dashboard/nodes" />}
          >
            {t('home.goDashboard')}
          </Button>
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-6xl space-y-20 px-4 pt-16 pb-10 md:pt-24">
        {/* Hero */}
        <section className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <button
            type="button"
            onClick={() => {
              void healthQuery.refetch()
            }}
            title={t('home.recheck')}
            className="hero-rise inline-flex cursor-pointer items-center gap-2 rounded-full border bg-card/80 py-1 pr-3 pl-2.5 text-xs text-muted-foreground shadow-xs backdrop-blur transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <StatusDot state={state} />
            {loading
              ? t('home.statusChecking')
              : ok
                ? t('home.statusOk')
                : t('home.statusError')}
            {!loading && ok && data && (
              <>
                <span aria-hidden>·</span>
                <span className="font-mono">{data.service}</span>
              </>
            )}
            <RefreshCw
              className={cn(
                'size-3 opacity-60',
                healthQuery.isFetching && 'animate-spin',
              )}
            />
          </button>

          <h1 className="hero-rise hero-rise-1 mt-6 text-4xl font-semibold tracking-tight text-balance md:text-6xl">
            {t('home.headline')}
          </h1>
          <p className="hero-rise hero-rise-2 mt-4 max-w-2xl text-base text-pretty text-muted-foreground md:text-lg">
            {t('home.sub')}
          </p>

          <div className="hero-rise hero-rise-3 mt-8 flex flex-col items-center gap-3 sm:flex-row">
            <Button
              size="lg"
              nativeButton={false}
              render={<Link to="/dashboard/nodes" />}
            >
              {t('home.goDashboard')}
              <ArrowRight />
            </Button>
            <Button
              size="lg"
              variant="outline"
              nativeButton={false}
              render={<Link to="/auth/$path" params={{ path: 'sign-in' }} />}
            >
              <LogIn />
              {t('home.navLogin')}
            </Button>
          </div>

          <div className="hero-rise hero-rise-4 mt-8 flex flex-wrap items-center justify-center gap-2">
            {stack.map((name) => (
              <Badge key={name} variant="secondary" className="font-normal">
                {name}
              </Badge>
            ))}
          </div>
        </section>

        {/* 功能矩阵 */}
        <section>
          <div className="mb-8 text-center">
            <p className="text-xs font-medium tracking-widest text-primary uppercase">
              {t('home.featuresKicker')}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
              {t('home.featuresTitle')}
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => (
              <Card
                key={f.title}
                className="group transition-colors hover:border-primary/40"
              >
                <CardContent className="space-y-3">
                  <div className="grid size-9 place-items-center rounded-lg border border-sidebar-border/60 bg-sidebar-accent/50 text-sidebar-foreground/80 transition-colors group-hover:border-transparent group-hover:bg-primary group-hover:text-primary-foreground group-hover:shadow-xs">
                    <f.icon className="size-4" />
                  </div>
                  <div className="font-medium">{f.title}</div>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {f.desc}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* 服务状态 */}
        <section className="mx-auto max-w-3xl">
          <Card>
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <StatusDot state={state} />
                <div className="min-w-0">
                  <div className="font-medium">{t('home.statusTitle')}</div>
                  <p className="truncate text-sm text-muted-foreground">
                    {loading ? (
                      <span className="inline-flex items-center gap-2">
                        <Spinner className="size-3.5" />
                        {t('home.statusChecking')}
                      </span>
                    ) : ok && data ? (
                      <span className="font-mono">
                        {data.service} · {data.time}
                      </span>
                    ) : (
                      t('home.apiError')
                    )}
                  </p>
                </div>
              </div>
              <p className="hidden max-w-56 text-xs text-muted-foreground lg:block">
                {t('home.statusDesc')}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={healthQuery.isFetching}
                onClick={() => {
                  void healthQuery.refetch()
                }}
              >
                <RefreshCw
                  className={cn(
                    'size-3.5',
                    healthQuery.isFetching && 'animate-spin',
                  )}
                />
                {t('home.recheck')}
              </Button>
            </CardContent>
          </Card>
        </section>

        {/* 页脚 */}
        <footer>
          <Separator className="mb-6" />
          <p className="text-center text-xs text-muted-foreground">
            {t('home.footer')}
          </p>
        </footer>
      </main>
    </div>
  )
}
