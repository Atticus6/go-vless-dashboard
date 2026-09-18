import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/about')({
  component: AboutComponent,
})

function AboutComponent() {
  const { t } = useTranslation()

  return (
    <section>
      <h2>{t('about.title')}</h2>
      <p>{t('about.body')}</p>
    </section>
  )
}
