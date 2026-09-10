import { useEffect, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Label } from '@/renderer/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import { petalQuotaSchema, type PetalQuota } from '@/shared/contracts/petal-hub';
import { codexContentError } from '@/renderer/features/extensions/codex-content/use-codex-content';
import { codexContentSettingsSchema, type CodexContentCommand } from '@/shared/contracts/codex-content';
import { z } from 'zod';

export function CodexFlowerSettings({ active }: { active: boolean }) {
  const copy = useI18n().messages.desktopPetals;
  const [quota, setQuota] = useState<PetalQuota | null>(null),
    [limitId, setLimitId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const [settings, setSettings] = useState<z.infer<typeof codexContentSettingsSchema> | null>(null);
  useEffect(() => {
    if (!active) return;
    let live = true;
    void Promise.all([
      window.desktopPetals.snapshot(),
      window.desktopPetals.codex.command({ kind: 'quota' }),
      window.desktopPetals.codex.command({ kind: 'settings' }),
    ])
      .then(([snapshot, result, defaults]) => {
        if (live) {
          setLimitId(snapshot.hubSettings.codexLimitId);
          setQuota(petalQuotaSchema.parse(result));
          setSettings(codexContentSettingsSchema.parse(defaults));
        }
      })
      .catch((reason) => {
        if (live) setError(reason);
      });
    return () => {
      live = false;
    };
  }, [active]);
  const select = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      const next = value === 'automatic' ? null : value;
      await window.desktopPetals.codex.command({ kind: 'configure-quota', limitId: next });
      setLimitId(next);
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };
  const saveDefaults = async (command: CodexContentCommand) => {
    setBusy(true);
    setError(null);
    try {
      await window.desktopPetals.codex.command(command);
      setSettings(codexContentSettingsSchema.parse(await window.desktopPetals.codex.command({ kind: 'settings' })));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="max-w-lg space-y-5 p-5">
      <div className="grid gap-2">
        <Label htmlFor="codex-result-album">{copy.codex.defaultAlbum}</Label>
        <Select
          value={settings?.albumId ?? ''}
          disabled={busy || !settings}
          onValueChange={(albumId) => void saveDefaults({ kind: 'select-album', albumId }).catch(setError)}
        >
          <SelectTrigger id="codex-result-album">
            <SelectValue placeholder={copy.actions.gallery} />
          </SelectTrigger>
          <SelectContent>
            {settings?.albums.map((album) => (
              <SelectItem key={album.id} value={album.id}>
                {album.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <fieldset className="grid min-w-0 gap-2 border-t pt-3">
        <legend className="pr-2 text-xs text-muted-foreground">{copy.settings.title}</legend>
        <Label htmlFor="codex-flower-quota">{copy.settings.quotaWindow}</Label>
        <Select value={limitId ?? 'automatic'} disabled={busy || !quota} onValueChange={(value) => void select(value)}>
          <SelectTrigger id="codex-flower-quota">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="automatic">{copy.settings.automatic}</SelectItem>
            {(quota?.limits ?? []).map((limit) => (
              <SelectItem key={limit.id} value={limit.id}>
                {limit.name || copy.quota.defaultLimit}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </fieldset>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void window.desktopPetals.codex.command({ kind: 'open-settings' }).catch(setError)}
      >
        {copy.codex.permissions}
      </Button>
      {Boolean(error) && (
        <div className="text-sm text-destructive" role="alert">
          {codexContentError(error, copy.codex)}
        </div>
      )}
    </div>
  );
}
