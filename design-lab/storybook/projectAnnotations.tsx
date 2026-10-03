import { useEffect, useState } from 'react';
import type { Preview } from '@storybook/react-vite';
import type { Locale } from '@/shared/contracts';
import { StoryEnvironment } from './StoryEnvironment';

function Environment({
  children,
  id,
  initialLocale,
}: {
  children: React.ReactNode;
  id: string;
  initialLocale: Locale;
}) {
  const [locale, setLocale] = useState(initialLocale);
  useEffect(() => setLocale(initialLocale), [initialLocale]);
  return (
    <StoryEnvironment storyId={id} locale={locale} setLocale={setLocale}>
      {children}
    </StoryEnvironment>
  );
}

/** Shared by the browser preview and portable stories; no manager hooks or DOM-test shims. */
export const projectAnnotations: Preview = {
  initialGlobals: { locale: 'zh' },
  decorators: [
    (Story, context) => (
      <Environment key={context.id} id={context.id} initialLocale={context.globals.locale === 'en' ? 'en' : 'zh'}>
        <Story />
      </Environment>
    ),
  ],
};
