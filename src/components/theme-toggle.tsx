import { Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'

/** Public pages theme toggle: flips between light / dark with animation. */
export function ThemeToggle() {
  const { t } = useTranslation()
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === 'dark'

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t('theme.toggle')}
      title={t('theme.toggle')}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      <span className="relative block size-4">
        <Sun className="absolute inset-0 size-4 scale-100 rotate-0 transition-all duration-300 dark:scale-0 dark:-rotate-90" />
        <Moon className="absolute inset-0 size-4 scale-0 rotate-90 transition-all duration-300 dark:scale-100 dark:rotate-0" />
      </span>
    </Button>
  )
}
