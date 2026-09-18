import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import en from './en.json'
import zh from './zh.json'

const resources = {
  zh: { translation: zh },
  en: { translation: en },
} as const

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'zh',
    supportedLngs: ['zh', 'en'],
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
  })

function syncHtmlLang(lng: string) {
  document.documentElement.lang = lng
}

i18n.on('languageChanged', syncHtmlLang)
syncHtmlLang(i18n.language)

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: typeof resources
  }
}

export default i18n
