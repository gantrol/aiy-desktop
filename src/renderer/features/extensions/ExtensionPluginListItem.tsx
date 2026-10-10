import type { ExtensionDto } from '@/shared/contracts';
import { localizeExtensionManifest } from '@/shared/extension-localization';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

export function ExtensionPluginListItem({
  extension,
  selectedId,
  onSelect,
}: {
  extension: ExtensionDto;
  selectedId: string;
  onSelect(extensionId: string): void;
}) {
  const { locale, messages } = useI18n();
  const l = messages.extensions;
  const copy = localizeExtensionManifest(extension.manifest, locale);
  const missing = extension.permissions.filter((permission) => permission.required && !permission.granted).length;
  return (
    <Button
      type="button"
      variant="ghost"
      data-extension-id={extension.manifest.id}
      aria-current={selectedId === extension.manifest.id ? 'true' : undefined}
      title={copy.displayName}
      className={cn(
        'grid h-auto w-full min-w-0 justify-stretch gap-1.5 whitespace-normal rounded-sm px-3 py-2.5 text-left font-normal focus-visible:ring-inset focus-visible:ring-offset-0',
        selectedId === extension.manifest.id &&
          'bg-selected text-selected-foreground hover:bg-selected active:bg-selected',
      )}
      onClick={() => onSelect(extension.manifest.id)}
    >
      <strong className="min-w-0 truncate text-sm font-medium">{copy.displayName}</strong>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="tabular-nums">{extension.manifest.version}</span>
        <span>{l.source[extension.source]}</span>
        <span
          className={cn(
            'ml-auto',
            extension.enabled && extension.connectionState !== 'READY' && 'font-medium text-foreground',
          )}
        >
          {extension.enabled ? l.connectionStates[extension.connectionState] : l.disabled}
        </span>
      </span>
      {missing > 0 && (
        <span className="text-xs text-muted-foreground">{messages.extensionManager.missingCount(missing)}</span>
      )}
    </Button>
  );
}
