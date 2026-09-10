import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { petalErrorText } from '@/shared/petal-errors';

export function PetalMaintenance() {
  const copy = useI18n().messages.desktopPetals;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const reload = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.desktopPetals.reload();
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void reload()}>
        {copy.menu.reload}
      </Button>
      {Boolean(error) && (
        <div className="text-sm text-destructive" role="alert">
          {petalErrorText(error, copy.errors)}
        </div>
      )}
    </div>
  );
}
