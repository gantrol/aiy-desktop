import { useRef } from 'react';
import { SettingsScreen, type SettingsScreenProps } from '@/renderer/components/app/SettingsScreen';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';

export function SettingsDialog({ onClose, ...props }: SettingsScreenProps & { onClose(): void }) {
  const { messages } = useI18n();
  const focused = document.activeElement;
  const menuTriggerId = focused?.closest('[role="menu"]')?.getAttribute('aria-labelledby');
  const returnFocus = useRef(menuTriggerId ? document.getElementById(menuTriggerId) : focused);
  const navigating = useRef(false);
  function navigate(action: () => void) {
    navigating.current = true;
    onClose();
    action();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        showCloseButton={false}
        className="flex h-[min(42rem,calc(100dvh-3rem))] max-w-5xl flex-col gap-0 overflow-hidden rounded-md p-0"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (navigating.current) return;
          const target = returnFocus.current;
          if (target instanceof HTMLElement && target.isConnected && target !== document.body)
            target.focus({ preventScroll: true });
          else document.querySelector<HTMLElement>('[data-action="app-menu"]')?.focus({ preventScroll: true });
        }}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3">
          <DialogTitle className="text-base">{messages.app.settings.title}</DialogTitle>
          <DialogClose asChild>
            <Button type="button" variant="ghost" size="sm">
              {messages.app.settings.layout.exit}
            </Button>
          </DialogClose>
        </header>
        <SettingsScreen
          {...props}
          onAiFeatureModelsOpen={() => navigate(props.onAiFeatureModelsOpen)}
          onContentManagementOpen={() => navigate(props.onContentManagementOpen)}
        />
      </DialogContent>
    </Dialog>
  );
}
