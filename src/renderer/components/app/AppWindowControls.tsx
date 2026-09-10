import { useEffect, useState } from 'react';
import { CopyIcon, MinusIcon, SquareIcon, XIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useArticleEditorSessionFlush } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';

export function AppWindowControls() {
  const labels = useI18n().messages.app.windowControls;
  const flushArticleEditors = useArticleEditorSessionFlush();
  const [maximized, setMaximized] = useState(false);
  const customControls = window.desktopApi.appPlatform !== 'darwin';

  useEffect(() => {
    if (!customControls) return undefined;
    let active = true;
    void window.desktopApi.appWindowGetState().then((state) => {
      if (active) setMaximized(state.maximized);
    });
    const unsubscribe = window.desktopApi.onAppWindowStateChanged((state) => setMaximized(state.maximized));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [customControls]);

  if (!customControls) return null;

  return (
    <div className="app-title-bar-actions absolute right-0 top-0 flex h-9" aria-label={labels.label}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-12 rounded-none focus-visible:ring-inset focus-visible:ring-offset-0"
        aria-label={labels.minimize}
        title={labels.minimize}
        onClick={() => void window.desktopApi.appWindowMinimize()}
      >
        <MinusIcon className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-12 rounded-none focus-visible:ring-inset focus-visible:ring-offset-0"
        aria-label={maximized ? labels.restore : labels.maximize}
        title={maximized ? labels.restore : labels.maximize}
        onClick={() => {
          void window.desktopApi.appWindowToggleMaximized().then((state) => setMaximized(state.maximized));
        }}
      >
        {maximized ? <CopyIcon className="size-3" /> : <SquareIcon className="size-3" />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-12 rounded-none hover:bg-destructive hover:text-destructive-foreground active:bg-destructive-hover focus-visible:ring-inset focus-visible:ring-offset-0"
        aria-label={labels.close}
        title={labels.close}
        onClick={() =>
          void flushArticleEditors().then((saved) => {
            if (saved) void window.desktopApi.appWindowClose();
          })
        }
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}
