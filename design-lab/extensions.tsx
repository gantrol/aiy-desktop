import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nContext } from '@/renderer/i18n/I18nContext';
import { useI18n } from '@/renderer/i18n/useI18n';
import { hydrateLanguageCatalog } from '@/renderer/i18n/languageCatalog';
import { enMessages } from '@/renderer/i18n/locales/en';
import { ExtensionPluginList } from '@/renderer/features/extensions/ExtensionPluginList';
import { ExtensionPluginHeader } from '@/renderer/features/extensions/ExtensionPluginHeader';
import { ExtensionPermissionPanel } from '@/renderer/features/extensions/ExtensionPermissionPanel';
import { Button } from '@/renderer/components/ui/button';
import zhMessages from '../extensions/com.aiy.language.zh-cn/messages.json';
import { extensionExamples } from './extension-fixtures';
import './style.css';

const locale = new URLSearchParams(location.search).get('locale') === 'en' ? 'en' : 'zh';
document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
function Example() {
  const { messages } = useI18n();
  const l = messages.extensionManager;
  const [extensions, setExtensions] = useState(extensionExamples);
  const [selected, setSelected] = useState(extensions[0].manifest.id);
  const [failNext, setFailNext] = useState(false);
  const [error, setError] = useState('');
  const extension = extensions.find((item) => item.manifest.id === selected)!;
  async function change(keys: string[], granted: boolean) {
    setError('');
    if (failNext) {
      setFailNext(false);
      setError(l.exampleFailureMessage);
      throw new Error(l.exampleFailureMessage);
    }
    setExtensions((current) =>
      current.map((item) => {
        if (item.manifest.id !== selected) return item;
        const permissions = item.permissions.map((permission) =>
          keys.includes(permission.key) ? { ...permission, granted } : permission,
        );
        const effective = permissions.every((permission) => !permission.required || permission.granted);
        return { ...item, permissions, effective, connectionState: effective ? 'READY' : 'PERMISSION_REQUIRED' };
      }),
    );
    return true;
  }
  return (
    <main className="mx-auto max-w-6xl bg-background p-4 text-foreground sm:p-8">
      <a href="./index.html" className="text-xs underline">
        AIY Design Lab
      </a>
      <h1 className="mt-3 text-2xl font-semibold">{l.exampleTitle}</h1>
      <p className="my-3 text-sm text-muted-foreground">{l.exampleNote}</p>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setExtensions(extensionExamples());
            setFailNext(false);
            setError('');
          }}
        >
          {l.exampleReset}
        </Button>
        <Button variant="outline" aria-pressed={failNext} onClick={() => setFailNext(!failNext)}>
          {l.exampleFailure}
        </Button>
      </div>
      <div className="grid min-w-0 gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="min-w-0 rounded-lg border border-border">
          <ExtensionPluginList extensions={extensions} selectedId={selected} onSelect={setSelected} />
        </aside>
        <div className="@container/extension-detail grid min-w-0 content-start gap-4">
          <ExtensionPluginHeader extension={extension} />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <ExtensionPermissionPanel
            key={selected}
            extension={extension}
            busy={false}
            onChange={async (key, granted) => {
              try {
                await change([key], granted);
              } catch {
                /* Shown above; no external side effect. */
              }
            }}
            onRevoke={(keys) => change(keys, false)}
          />
        </div>
      </div>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <I18nContext.Provider
    value={{
      locale,
      setLocale: (next) => {
        location.search = '?locale=' + next;
      },
      messages: hydrateLanguageCatalog(locale === 'zh' ? zhMessages : {}, enMessages),
      availableLocales: ['zh', 'en'],
    }}
  >
    <Example />
  </I18nContext.Provider>,
);
