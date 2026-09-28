import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '@/renderer/features/font-settings/installFontPreferences';
import { I18nContext } from '@/renderer/i18n/I18nContext';
import { Button } from '@/renderer/components/ui/button';
import { PetalNoteMenu } from '@/renderer/features/desktop-petals/PetalNoteMenu';
import { PetalHubMenu } from '@/renderer/features/desktop-petals/PetalHubMenu';
import { PetalMenuApiContext, PetalMenuExecutionContext } from '@/renderer/features/desktop-petals/petal-menu-api';
import type { PetalMenuWindowInput } from '@/renderer/features/desktop-petals/PetalMenuWindow';

function MenuHost({ input }: { input: PetalMenuWindowInput }) {
  useEffect(() => input.ready(), [input]);
  const menu = input.control;
  return (
    <I18nContext.Provider value={input.language}>
      <PetalMenuApiContext.Provider value={input.api}>
        <PetalMenuExecutionContext.Provider value={input.execute}>
          {input.kind === 'hub' ? (
            <PetalHubMenu snapshot={input.snapshot} onError={input.onError} menu={menu} />
          ) : (
            <PetalNoteMenu
              {...input.actions}
              open
              onOpenChange={(open) => {
                if (!open) menu.dismiss();
              }}
              close={menu.close}
              align="start"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                menu.restoreFocus();
              }}
              trigger={
                <Button
                  variant="ghost"
                  tabIndex={-1}
                  aria-hidden="true"
                  className="pointer-events-none fixed size-px border-0 p-0 opacity-0"
                  style={{ left: menu.anchor.x, top: menu.anchor.y }}
                />
              }
            />
          )}
        </PetalMenuExecutionContext.Provider>
      </PetalMenuApiContext.Provider>
    </I18nContext.Provider>
  );
}

const root = createRoot(document.getElementById('root')!);
window.petalMenuHost = { render: (input) => root.render(<MenuHost input={input} />) };
