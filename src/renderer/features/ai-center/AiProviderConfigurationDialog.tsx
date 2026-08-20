import { useEffect, useState } from 'react';
import { CircleAlertIcon, CircleCheckIcon, PowerIcon, RefreshCwIcon, ShieldCheckIcon } from 'lucide-react';
import type { ExtensionDto, Locale } from '@/shared/contracts';
import {
  ANTIGRAVITY_CLI_EXTENSION_ID,
  CODEX_APP_SERVER_EXTENSION_ID,
  DEEPSEEK_API_EXTENSION_ID,
  EXTERNAL_IMAGE_API_EXTENSION_IDS,
  OPENAI_IMAGE_API_EXTENSION_ID,
} from '@/shared/extension-ids';
import { localizeExtensionManifest } from '@/shared/extension-localization';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { StateTag } from '@/renderer/components/ui/state-tag';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { DeepSeekApiConfiguration } from '@/renderer/features/extensions/DeepSeekApiConfiguration';
import { ExternalImageApiConfiguration } from '@/renderer/features/extensions/ExternalImageApiConfiguration';
import { OpenAiImageApiConfiguration } from '@/renderer/features/extensions/OpenAiImageApiConfiguration';
import { AntigravityCliConfiguration } from '@/renderer/features/extensions/AntigravityCliConfiguration';

interface Props {
  open: boolean;
  extension: ExtensionDto | null;
  locale: Locale;
  notify(message: string): void;
  onOpenChange(open: boolean): void;
  onChanged(): Promise<void>;
}

const externalImageApiExtensionIds = new Set<string>(EXTERNAL_IMAGE_API_EXTENSION_IDS);

export function AiProviderConfigurationDialog({ open, extension, locale, notify, onOpenChange, onChanged }: Props) {
  const { messages } = useI18n();
  const l = messages.aiCenter.configuration;
  const extensionCopy = messages.extensions;
  const [current, setCurrent] = useState<ExtensionDto | null>(extension);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function load(refreshCodex = false) {
    if (!extension) return;
    setError('');
    try {
      if (refreshCodex && extension.manifest.id === CODEX_APP_SERVER_EXTENSION_ID) {
        await window.desktopApi.codexHealth();
      }
      const extensions = await window.desktopApi.extensionsList();
      setCurrent(extensions.find((item) => item.manifest.id === extension.manifest.id) ?? extension);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  useEffect(() => {
    if (!open || !extension) return;
    setCurrent(extension);
    void load(false);
  }, [extension?.manifest.id, open]);

  async function changeEnabled(enabled: boolean) {
    if (!current || busy) return;
    setBusy('enabled');
    setError('');
    try {
      const extensions = await window.desktopApi.extensionSetEnabled({
        extensionId: current.manifest.id,
        enabled,
      });
      setCurrent(extensions.find((item) => item.manifest.id === current.manifest.id) ?? current);
      await onChanged();
      notify(enabled ? extensionCopy.notices.enabled : extensionCopy.notices.disabled);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy('');
    }
  }

  async function changePermission(permission: string, granted: boolean) {
    if (!current || busy) return;
    setBusy(`permission:${permission}`);
    setError('');
    try {
      const extensions = await window.desktopApi.extensionSetPermission({
        extensionId: current.manifest.id,
        permission,
        granted,
      });
      setCurrent(extensions.find((item) => item.manifest.id === current.manifest.id) ?? current);
      await onChanged();
      notify(granted ? extensionCopy.notices.permissionGranted : extensionCopy.notices.permissionRevoked);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy('');
    }
  }

  async function connectionChanged() {
    await load(false);
    await onChanged();
  }

  async function refreshConnection() {
    if (busy) return;
    setBusy('refresh');
    try {
      await load(true);
      await onChanged();
    } finally {
      setBusy('');
    }
  }

  const copy = current ? localizeExtensionManifest(current.manifest, locale) : null;
  const ready = current?.enabled && current.connectionState === 'READY';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent className="grid h-[min(760px,calc(100vh-2rem))] max-w-3xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-5 pr-14">
          <DialogTitle>
            {l.title}
            {copy ? ` · ${copy.displayName}` : ''}
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="min-h-0">
          {current && (
            <div className="grid gap-5 p-6">
              <section className="grid gap-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="min-w-0 flex-1 truncate text-sm">{copy?.displayName}</strong>
                  <StateTag
                    tone={ready ? 'success' : 'warning'}
                    icon={ready ? <CircleCheckIcon /> : <CircleAlertIcon />}
                  >
                    {extensionCopy.connectionStates[current.connectionState]}
                  </StateTag>
                  <Button
                    type="button"
                    variant={current.enabled ? 'outline' : 'default'}
                    size="sm"
                    disabled={Boolean(busy)}
                    onClick={() => void changeEnabled(!current.enabled)}
                  >
                    <PowerIcon className="size-3.5" />
                    {current.enabled ? extensionCopy.actions.disable : extensionCopy.actions.enable}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{current.connectionMessage}</p>
              </section>

              {current.permissions.length > 0 && (
                <section className="rounded-lg border">
                  <h3 className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
                    <ShieldCheckIcon className="size-4" />
                    {extensionCopy.sections.permissions}
                  </h3>
                  <div className="divide-y">
                    {current.permissions.map((permission) => (
                      <label
                        key={permission.key}
                        className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm"
                      >
                        <Checkbox
                          checked={permission.granted}
                          disabled={Boolean(busy)}
                          onCheckedChange={(checked) => void changePermission(permission.key, checked === true)}
                        />
                        <span className="min-w-0 flex-1 break-all font-mono text-xs">{permission.key}</span>
                        <Badge variant={permission.required ? 'secondary' : 'outline'}>
                          {permission.required ? extensionCopy.required : extensionCopy.optional}
                        </Badge>
                        {busy === `permission:${permission.key}` && (
                          <RefreshCwIcon className="size-3.5 animate-spin text-muted-foreground" />
                        )}
                      </label>
                    ))}
                  </div>
                </section>
              )}

              {current.manifest.id === CODEX_APP_SERVER_EXTENSION_ID && (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={Boolean(busy)}
                    onClick={() => void refreshConnection()}
                  >
                    <RefreshCwIcon className={cn('size-4', busy === 'refresh' && 'animate-spin')} />
                    {l.refreshConnection}
                  </Button>
                </div>
              )}
              {current.manifest.id === OPENAI_IMAGE_API_EXTENSION_ID && (
                <OpenAiImageApiConfiguration active={open} notify={notify} onConnectionChanged={connectionChanged} />
              )}
              {current.manifest.id === DEEPSEEK_API_EXTENSION_ID && (
                <DeepSeekApiConfiguration active={open} notify={notify} onConnectionChanged={connectionChanged} />
              )}
              {current.manifest.id === ANTIGRAVITY_CLI_EXTENSION_ID && (
                <AntigravityCliConfiguration active={open && current.enabled} onConnectionChanged={connectionChanged} />
              )}
              {externalImageApiExtensionIds.has(current.manifest.id) && (
                <ExternalImageApiConfiguration
                  active={open}
                  manifest={current.manifest}
                  notify={notify}
                  onConnectionChanged={connectionChanged}
                />
              )}
              {error && (
                <p role="alert" className="rounded-md bg-destructive-surface p-3 text-xs text-destructive">
                  {error}
                </p>
              )}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
