'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { translate } from '@/lib/i18n';

const LanguageContext = createContext(null);
const STORAGE_KEY = 'portal_lang';

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState('en');

  // Restore the saved choice on mount (per-browser).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'hi' || saved === 'en') {
        setLangState(saved);
        document.documentElement.lang = saved;
      }
    } catch { /* private mode / blocked storage */ }
  }, []);

  const setLang = useCallback((next) => {
    const l = next === 'hi' ? 'hi' : 'en';
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch {}
    try { document.documentElement.lang = l; } catch {}
  }, []);

  const t = useCallback((key) => translate(lang, key), [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

// Safe default so components render in English even outside the provider.
export function useLanguage() {
  return useContext(LanguageContext) ?? { lang: 'en', setLang: () => {}, t: (k) => k };
}
