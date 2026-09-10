import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/renderer/components/ui/dropdown-menu';
import { TrayMenuItems } from '@/renderer/features/app-shell/TrayMenuItems';
import { appearanceStyle } from '@/renderer/features/desktop-petals/petal-appearance';
import { petalMenuSurfaceClass } from '@/renderer/features/desktop-petals/petal-menu-style';
import { I18nContext } from '@/renderer/i18n/I18nContext';
import { htmlLanguages } from '@/renderer/i18n/catalog';
import { enMessages } from '@/renderer/i18n/locales/en';
import { cn } from '@/renderer/lib/utils';
import type { TrayMenuApi, TrayMenuState } from '@/shared/contracts/tray-menu';

declare global {
  interface Window {
    trayMenu: TrayMenuApi;
  }
}

export function TrayMenuApp() {
  const [state, setState] = useState<TrayMenuState | null>(null);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    let live = true,
      revision = 0;
    const unsubscribe = window.trayMenu.onState((value) => {
      revision++;
      if (live) setState(value);
    });
    const request = revision;
    void window.trayMenu
      .state()
      .then((value) => {
        if (live && revision === request) setState(value);
      })
      .catch((error) => console.error('[tray-menu] Failed to read menu state', error));
    const focus = () => setOpen(true);
    window.addEventListener('focus', focus);
    return () => {
      live = false;
      unsubscribe();
      window.removeEventListener('focus', focus);
    };
  }, []);
  const language = state?.language;
  const value = useMemo(
    () => ({
      locale: language?.locale ?? 'en',
      availableLocales: [language?.locale ?? 'en'],
      setLocale: () => undefined,
      messages: { ...enMessages, appShell: language?.messages ?? enMessages.appShell },
    }),
    [language],
  );
  useLayoutEffect(() => {
    if (!language) return;
    document.documentElement.lang = htmlLanguages[language.locale];
    document.title = language.messages.open;
  }, [language]);
  const loaded = state !== null;
  useEffect(() => {
    if (loaded) window.trayMenu.ready();
  }, [loaded]);
  if (!state) return null;
  return (
    <I18nContext.Provider value={value}>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) void window.trayMenu.action('dismiss');
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none fixed left-2 top-[7px] size-px p-0 opacity-0"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          sideOffset={0}
          avoidCollisions={false}
          className={cn(petalMenuSurfaceClass, 'w-[calc(100vw-16px)]')}
          style={appearanceStyle('rose')}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <TrayMenuItems
            state={state}
            onAction={(action) => {
              void window.trayMenu.action(action).catch((error) => console.error('[tray-menu] Action failed', error));
            }}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </I18nContext.Provider>
  );
}
