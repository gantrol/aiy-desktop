import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Label } from '@/renderer/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/renderer/components/ui/dialog';
import { CaptureShortcutSetting } from '@/renderer/features/clipboard-capture/CaptureShortcutSetting';
import { ClearCaptureHistory } from '@/renderer/features/clipboard-capture/ClearCaptureHistory';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ClipboardHistoryController } from '@/renderer/features/clipboard-capture/useClipboardHistory';
import type { ClipboardStatus } from '@/shared/contracts/clipboard-capture';

export function ClipboardSettingsDialog({
  controller,
  status,
  onClose,
  onOpenPermissions,
}: {
  controller: ClipboardHistoryController;
  status: ClipboardStatus;
  onClose(): void;
  onOpenPermissions?(): void;
}) {
  const { messages, locale } = useI18n();
  const l = messages.clipboardCapture;
  const capture = controller.scope === 'capture';
  const [settings, setSettings] = useState(status.settings);
  const [excluded, setExcluded] = useState(settings.excludedApps.join(', '));
  const { busy, error, run } = controller;
  const apply = async () => {
    const current = await controller.execute({ kind: 'status' });
    if (current.kind !== 'status') return;
    if (
      await run({
        kind: 'configure',
        settings: {
          ...settings,
          captureShortcut: current.value.settings.captureShortcut,
          pinShortcut: current.value.settings.pinShortcut,
          historyShortcut: current.value.settings.historyShortcut,
          pasteNextShortcut: current.value.settings.pasteNextShortcut,
          excludedApps: excluded
            .split(/[,，]/u)
            .map((value) => value.trim())
            .filter(Boolean),
        },
      })
    )
      onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{capture ? l.captureHistory : l.settings}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          {capture && (
            <Label className="flex items-center gap-2">
              <Checkbox
                checked={settings.recording}
                disabled={busy || (!settings.recording && (!status.canRecord || !status.supported))}
                onCheckedChange={(checked) => setSettings({ ...settings, recording: checked === true })}
              />
              {l.recordCaptures}
            </Label>
          )}
          {!capture && (
            <>
              <Label className="flex items-center gap-2">
                <Checkbox
                  checked={settings.preserveImageFiles}
                  disabled={busy || (!settings.preserveImageFiles && !status.canPreserveFiles)}
                  onCheckedChange={(checked) => setSettings({ ...settings, preserveImageFiles: checked === true })}
                />
                {l.preserveImageFiles}
              </Label>
              <Label className="grid gap-2">
                {l.excludedApps}
                <Input
                  value={excluded}
                  maxLength={3240}
                  disabled={busy}
                  onChange={(event) => setExcluded(event.target.value)}
                />
              </Label>
            </>
          )}
          {(['limitCount', 'limitMiB', 'retentionDays'] as const).map((field) => (
            <Label key={field} className="grid gap-2">
              {l[field]}
              <Input
                type="number"
                value={settings[field]}
                disabled={busy}
                min={field === 'retentionDays' ? 0 : field === 'limitCount' ? 50 : 32}
                max={field === 'retentionDays' ? 365 : field === 'limitCount' ? 1000 : 512}
                onChange={(event) => setSettings({ ...settings, [field]: Number(event.target.value) })}
              />
            </Label>
          ))}
          {capture ? (
            <>
              <CaptureShortcutSetting field="captureShortcut" />
              <CaptureShortcutSetting field="pinShortcut" />
            </>
          ) : (
            <>
              <CaptureShortcutSetting field="historyShortcut" />
              <CaptureShortcutSetting field="pasteNextShortcut" />
            </>
          )}
          {!capture && status.enabled && (!status.canRecord || !status.canPreserveFiles) && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {status.canRecord ? l.imageFilePermissionRequired : l.permissionRequired}
              </span>
              {onOpenPermissions && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    onClose();
                    onOpenPermissions();
                  }}
                >
                  {l.permissions}
                </Button>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {status.count.toLocaleString(locale)} / {status.limitCount.toLocaleString(locale)} ·{' '}
          {(status.usedBytes / 1024 / 1024).toLocaleString(locale, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          })}{' '}
          / {(status.limitBytes / 1024 / 1024).toLocaleString(locale)} MiB
        </div>
        <DialogFooter>
          {capture && <ClearCaptureHistory controller={controller} />}
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {l.cancel}
          </Button>
          <Button disabled={busy} onClick={() => void apply()}>
            {l.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
