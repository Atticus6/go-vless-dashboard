import { viewPaths } from '@better-auth-ui/core'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { Network } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Auth } from '@/components/auth/auth'
import { LanguageSwitcher } from '@/components/language-switcher'
import { ThemeToggle } from '@/components/theme-toggle'

const validAuthPaths = new Set(Object.values(viewPaths.auth))

export const Route = createFileRoute('/auth/$path')({
  beforeLoad({ params: { path } }) {
    if (!validAuthPaths.has(path)) {
      throw redirect({ to: '/' })
    }
  },
  component: AuthPage,
})

function AuthPage() {
  const { path } = Route.useParams()
  const { t } = useTranslation()

  return (
    <div className="relative flex min-h-svh flex-col overflow-x-clip">
      {/* 背景装饰：跟主页同一套 */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="bg-grid-fade absolute inset-x-0 top-0 h-[420px]" />
        <div className="absolute -top-32 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
      </div>

      <header className="relative z-10 mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4">
        <Link
          to="/"
          className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-linear-to-br from-primary to-primary/55 text-primary-foreground shadow-xs">
            <Network className="size-4" />
          </div>
          <span className="truncate text-sm font-semibold tracking-tight">
            {t('app.title')}
          </span>
        </Link>
        <span className="flex-1" />
        <LanguageSwitcher />
        <ThemeToggle />
      </header>

      {/* 视口级居中：垂直 + 水平，表单超高时自然滚动 */}
      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 items-center justify-center px-4 py-10">
        <div className="hero-rise w-full max-w-md">
          <Auth path={path} />
        </div>
      </main>
    </div>
  )
}
