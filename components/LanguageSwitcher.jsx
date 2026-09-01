'use client';

import { Languages } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { useLanguage } from '@/providers/language-provider';
import { LANGUAGES } from '@/lib/i18n';

// English / Hindi toggle. Visible to ADMIN only — an ADMIN "viewing as" another
// role has that role as their effective role, so it hides then too (matching
// what NLDC / RLDC see).
export function LanguageSwitcher() {
  const { user } = useAuth();
  const { lang, setLang } = useLanguage();

  if (user?.role !== 'ADMIN') return null;

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-background p-0.5" title="Language">
      <Languages className="size-3.5 text-muted-foreground mx-1 shrink-0" />
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => setLang(l.code)}
          aria-pressed={lang === l.code}
          className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${
            lang === l.code ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {l.short}
        </button>
      ))}
    </div>
  );
}
