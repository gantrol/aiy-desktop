import { useEffect, useMemo, useRef } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { I18nContextValue } from '@/renderer/i18n/I18nContext';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';
import type { PetalNoteMenuActions } from '@/renderer/features/desktop-petals/PetalNoteMenu';
import type { PetalOverlaySurface } from '@/renderer/features/desktop-petals/use-petal-overlay';
import {
  petalMenuApi,
  type PetalMenuApi,
  type PetalMenuControl,
  type PetalMenuExecutor,
} from '@/renderer/features/desktop-petals/petal-menu-api';

type Menu =
  | { kind: 'hub'; snapshot: DesktopPetalSnapshot; onError(error: unknown): void }
  | { kind: 'note'; actions: PetalNoteMenuActions };
export type PetalMenuWindowInput = Menu & {
  language: I18nContextValue;
  api: PetalMenuApi;
  control: PetalMenuControl;
  execute: PetalMenuExecutor;
  ready(): void;
};
declare global {
  interface Window {
    petalMenuHost?: { render(input: PetalMenuWindowInput): void };
  }
}

/** Radix must run in the menu's own document for focus and keyboard handling. */
export function PetalMenuWindow({
  surface,
  control,
  menu,
}: {
  surface: PetalOverlaySurface | null;
  control: Omit<PetalMenuControl, 'anchor'> & { anchor: PetalMenuControl['anchor'] | null };
  menu: Menu;
}) {
  const language = useI18n();
  const api = useMemo(() => petalMenuApi(window.desktopPetals), []);
  const running = useRef(false);
  useEffect(() => {
    if (!surface || !control.anchor || surface.window.closed) return;
    const host = surface.window.petalMenuHost;
    if (!host) {
      control.dismiss();
      return;
    }
    host.render({
      ...menu,
      language,
      api,
      control: { ...control, anchor: control.anchor },
      execute: async (action, args, { dismiss = true, prepare = true } = {}) => {
        if (running.current) return;
        running.current = true;
        try {
          if (prepare && menu.kind === 'note' && menu.actions.beforeAction && !(await menu.actions.beforeAction()))
            return;
          if (dismiss) await control.close();
          await action(...args);
        } catch (error) {
          (menu.kind === 'note' ? menu.actions.onError : menu.onError)(error);
        } finally {
          running.current = false;
        }
      },
      ready: () => void window.desktopPetals.overlayReady({ token: surface.token }).catch(() => control.dismiss()),
    });
  }, [api, control, language, menu, surface]);
  return null;
}
