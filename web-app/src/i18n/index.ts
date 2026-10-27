import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import th from './locales/th.json'
import en from './locales/en.json'
import cn from './locales/cn.json'
import mm from './locales/mm.json'
import jp from './locales/jp.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      th: { translation: th },
      en: { translation: en },
      cn: { translation: cn },
      mm: { translation: mm },
      jp: { translation: jp },
    },
    fallbackLng: 'th',
    interpolation: { escapeValue: false },
  })

export default i18n
