import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Locale } from '@/shared/contracts';
import { WorkbenchScopeProvider } from '@/renderer/components/workbench/WorkbenchScope';
import { I18nContext } from '@/renderer/i18n/I18nContext';
import { htmlLanguages } from '@/renderer/i18n/catalog';
import { storyCatalogs } from './catalogs';

function clearLayoutPreferences(scope: string) {
  try {
    const prefix = `aiy.workbench.v1:${scope}:`;
    const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index));
    for (const key of keys) if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
  } catch {
    // As in the product, denied storage must not prevent the work surface from opening.
  }
}

/** A remount owns a new workspace. No controls or product-shaped demo shell wrap its content. */
export function StoryEnvironment({
  children,
  storyId,
  locale,
  setLocale,
}: {
  children: ReactNode;
  storyId: string;
  locale: Locale;
  setLocale(locale: Locale): void;
}) {
  const [scope] = useState(() => `storybook:${storyId}:${crypto.randomUUID()}`);
  const value = useMemo(
    () => ({ locale, setLocale, messages: storyCatalogs[locale], availableLocales: ['zh', 'en'] as const }),
    [locale, setLocale],
  );
  useEffect(() => () => clearLayoutPreferences(scope), [scope]);
  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = htmlLanguages[locale];
    return () => {
      document.documentElement.lang = previous;
    };
  }, [locale]);
  return (
    <I18nContext.Provider value={value}>
      <WorkbenchScopeProvider scope={scope}>
        <div className="h-dvh w-full overflow-auto bg-background text-foreground">{children}</div>
      </WorkbenchScopeProvider>
    </I18nContext.Provider>
  );
}
