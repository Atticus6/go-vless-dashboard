import { Link, useNavigate } from '@tanstack/react-router'
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query'
import { useSession } from '@better-auth-ui/react'
import { useTheme } from '@/components/theme-provider'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import { enUS } from '@better-auth-ui/locales/en-US'
import { basePaths } from '@better-auth-ui/core'
import { authClient } from '@/lib/auth-client'
import { themePlugin } from '@/lib/auth/theme-plugin'
import { multiSessionPlugin } from '@/lib/auth/multi-session-plugin'
import { deleteUserPlugin } from '@/lib/auth/delete-user-plugin'
import { zhCN } from '@/lib/auth/zh-cn'
import { devalueTransformer, trpc } from '@/lib/trpc'
import { httpBatchLink } from '@trpc/client'
import { AuthProvider } from './auth/auth-provider'
import { Toaster } from './ui/sonner'

// 切换账号 / 登录 / 退出后，应用层 tRPC 缓存还留着上个用户的数据
//（setActive 只刷新 auth 自身的 query）。监听当前用户 id，变化就把
//业务 query 全部置为过期重取；首挂跳过，避免重复请求。
function SessionUserSync() {
  const { data: session } = useSession(authClient)
  const queryClient = useQueryClient()
  const prevUserId = useRef<string | null | undefined>(undefined)
  const userId = session?.session.userId ?? null

  useEffect(() => {
    if (prevUserId.current !== undefined && prevUserId.current !== userId) {
      void queryClient.invalidateQueries()
    }
    prevUserId.current = userId
  }, [userId, queryClient])

  return null
}

export function Providers({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { i18n, t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 5_000 },
        },
      }),
  )
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({ url: '/api/trpc', transformer: devalueTransformer }),
      ],
    }),
  )

  return (
    <QueryClientProvider client={queryClient}>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <AuthProvider
      authClient={authClient}
      locale={i18n.language.startsWith('en') ? enUS : zhCN}
      redirectTo="/"
      basePaths={{ ...basePaths, settings: '/dashboard/settings' }}
      emailAndPassword={{ requireEmailVerification: false }}
      navigate={navigate}
      plugins={[
        themePlugin({
          useTheme,
          localization: {
            appearance: t('theme.appearance'),
            theme: t('theme.theme'),
            system: t('theme.system'),
            light: t('theme.light'),
            dark: t('theme.dark'),
          },
        }),
        multiSessionPlugin({
          localization: {
            switchAccount: t('multiSession.switchAccount'),
            addAccount: t('multiSession.addAccount'),
            manageAccounts: t('multiSession.manageAccounts'),
            manageAccountsDescription: t(
              'multiSession.manageAccountsDescription',
            ),
          },
        }),
        deleteUserPlugin({
          localization: {
            deleteAccount: t('deleteUser.deleteAccount'),
            deleteAccountDescription: t(
              'deleteUser.deleteAccountDescription',
            ),
            deleteUserVerificationSent: t(
              'deleteUser.deleteUserVerificationSent',
            ),
            deleteUserSuccess: t('deleteUser.deleteUserSuccess'),
          },
        }),
      ]}
      Link={({ href, ...props }) => <Link to={href} {...props} />}
    >
      <SessionUserSync />
      {children}

      <Toaster
        theme={
          resolvedTheme === 'dark' || resolvedTheme === 'light'
            ? resolvedTheme
            : 'system'
        }
      />
    </AuthProvider>
    </trpc.Provider>
    </QueryClientProvider>
  )
}
