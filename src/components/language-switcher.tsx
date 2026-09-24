import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Languages } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const languages = ['zh', 'en'] as const
type Language = (typeof languages)[number]

const languageNames: Record<Language, string> = {
  zh: '中文',
  en: 'English',
}

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation()
  const current: Language = i18n.resolvedLanguage === 'en' ? 'en' : 'zh'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('lang.label')}
        render={
          <Button variant="ghost" size="sm">
            <Languages className="text-muted-foreground" />
            {languageNames[current]}
            <ChevronDown className="size-3 text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-36">
        {languages.map((lng) => (
          <DropdownMenuItem
            key={lng}
            onClick={() => {
              void i18n.changeLanguage(lng)
            }}
          >
            <span className="flex-1">{languageNames[lng]}</span>
            {current === lng && <Check className="text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
