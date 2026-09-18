import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

const languages = ['zh', 'en'] as const
type Language = (typeof languages)[number]

const languageNames: Record<Language, string> = {
  zh: '中文',
  en: 'EN',
}

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation()
  const current: Language = i18n.resolvedLanguage === 'en' ? 'en' : 'zh'

  return (
    <div className="flex items-center gap-1" role="group" aria-label={t('lang.label')}>
      {languages.map((lng) => (
        <Button
          key={lng}
          variant={current === lng ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => {
            void i18n.changeLanguage(lng)
          }}
        >
          {languageNames[lng]}
        </Button>
      ))}
    </div>
  )
}
