import { Pin } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { petalErrorText } from '@/shared/petal-errors';

export function PinNoteButton({
  stashId,
  saved,
  notify,
}: {
  stashId: string;
  saved: boolean;
  notify(message: string): void;
}) {
  const { messages } = useI18n();
  const copy = messages.desktopPetals;
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={!saved || busy}
      title={!saved ? copy.note.saveBeforePin : undefined}
      onClick={() => {
        setBusy(true);
        void window.desktopPetals
          .create({ requestId: crypto.randomUUID(), stashId })
          .catch((error) => notify(petalErrorText(error, copy.errors)))
          .finally(() => setBusy(false));
      }}
    >
      <Pin className="size-3.5" />
      {copy.note.pin}
    </Button>
  );
}
