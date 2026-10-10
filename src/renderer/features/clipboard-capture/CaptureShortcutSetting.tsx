import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { captureShortcutFromKey } from '@/shared/capture-shortcuts';
import type { ClipboardSettings } from '@/shared/contracts/clipboard-capture';

export function CaptureShortcutSetting({
  field,
}: {
  field: 'captureShortcut' | 'pinShortcut' | 'historyShortcut' | 'pasteNextShortcut';
}) {
  const l = useI18n().messages.clipboardCapture;
  const [settings, setSettings] = useState<ClipboardSettings>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    void window.desktopApi.clipboardCapture
      .execute({ kind: 'status' })
      .then((result) => {
        if (current && result.kind === 'status') setSettings(result.value.settings);
      })
      .catch(() => {
        if (current) setError(l.errors.storage);
      });
    return () => {
      current = false;
    };
  }, [l.errors.storage]);
  const change = async (value: string) => {
    if (busy || !settings) return;
    setBusy(true);
    setError('');
    try {
      const result = await window.desktopApi.clipboardCapture.execute({ kind: 'shortcut', field, value });
      if (result.kind === 'status') setSettings(result.value.settings);
      else if (result.kind === 'error') setError(l.errors[result.code as keyof typeof l.errors] ?? l.errors.shortcut);
    } catch {
      setError(l.errors.storage);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-1">
      <Label className="grid gap-2">
        {l[field]}
        <span className="flex items-center gap-1">
          <Input
            readOnly
            value={settings?.[field]?.replace('CommandOrControl', 'Ctrl').replace('Control', 'Ctrl') ?? ''}
            placeholder={l.shortcutNone}
            disabled={busy || !settings}
            onKeyDown={(event) => {
              if (event.key === 'Tab') return;
              if (event.key === 'Escape') {
                event.currentTarget.blur();
                return;
              }
              event.preventDefault();
              const value =
                ['Backspace', 'Delete'].includes(event.key) && !event.ctrlKey && !event.altKey && !event.metaKey
                  ? ''
                  : captureShortcutFromKey(event.nativeEvent);
              if (value !== null) void change(value);
            }}
          />
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={busy || !settings?.[field]}
            aria-label={l.shortcutNone}
            onClick={(event) => {
              event.preventDefault();
              void change('');
            }}
          >
            <X />
          </Button>
        </span>
      </Label>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
