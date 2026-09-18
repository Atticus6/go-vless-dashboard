import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { getHealth } from '@/lib/api'

export const Route = createFileRoute('/')({
  loader: async () => {
    try {
      const health = await getHealth()
      return {
        status: 'ok' as const,
        service: health.service,
        time: health.time,
      }
    } catch {
      return { status: 'error' as const }
    }
  },
  component: IndexComponent,
})

function IndexComponent() {
  const { t } = useTranslation()
  const data = Route.useLoaderData()
  const router = useRouter()

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight">
          {t('app.title')}
        </h1>
        <p className="text-muted-foreground">{t('app.subtitle')}</p>
        <div className="flex gap-2">
          <Badge>{t('badges.baseUI')}</Badge>
          <Badge variant="secondary">{t('badges.theme')}</Badge>
          {data.status === 'ok' ? (
            <Badge variant="secondary">{t('badges.apiOk')}</Badge>
          ) : (
            <Badge variant="destructive">{t('badges.apiError')}</Badge>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('home.cardTitle')}</CardTitle>
          <CardDescription>{t('home.cardDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {data.status === 'ok' ? (
            <p className="text-sm">
              {data.service} · {data.time}
            </p>
          ) : (
            <p className="text-sm text-destructive">{t('home.apiError')}</p>
          )}
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                void router.invalidate()
              }}
            >
              {t('home.recheck')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Button render={<Link to="/dashboard/nodes" />}>
        {t('home.goDashboard')}
      </Button>
    </section>
  )
}
