import { PetalIconButton } from '@/renderer/features/desktop-petals/PetalControls';
import { useI18n } from '@/renderer/i18n/useI18n';
import { RotateCw, X } from 'lucide-react';
import { useState } from 'react';

export function PetalLoadError({ error, initial, onRetry }: { error: string; initial: boolean; onRetry(): void }) {
  const { messages } = useI18n();
  const copy = messages.desktopPetals.errors;
  const [closeError, setCloseError] = useState(false);
  const message = /invalid_value|invalid_type|unrecognized_keys/.test(error) ? copy.reloadHint : copy.readHint;
  return (
    <div
      className={`absolute inset-x-1 bottom-1 z-10 overflow-y-auto rounded-sm bg-background p-2 text-xs text-destructive${initial ? ' top-1' : ''}`}
      role="alert"
      title={message}
    >
      <strong>{initial ? copy.loadTitle : copy.updateTitle}</strong>
      {closeError && <output>{copy.hideFailed}</output>}
      <div>
        <PetalIconButton label={copy.retryLoad} onClick={onRetry}>
          <RotateCw />
        </PetalIconButton>
        <PetalIconButton
          label={copy.hide}
          title={copy.hideHint}
          onClick={() => void window.desktopPetals.hide().catch(() => setCloseError(true))}
        >
          <X />
        </PetalIconButton>
      </div>
    </div>
  );
}
