import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import sv from './locales/sv.json' with { type: 'json' };
import en from './locales/en.json' with { type: 'json' };

i18n.use(initReactI18next).init({
  resources: {
    sv: { translation: sv as Record<string, string> },
    en: { translation: en as Record<string, string> },
  },
  lng: 'sv',
  fallbackLng: 'sv',
  interpolation: { escapeValue: false },
});

export default i18n;
