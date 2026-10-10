import type { ReactNode } from 'react';
import { BlocksIcon, LanguagesIcon } from 'lucide-react';
import { Badge } from '@/renderer/components/ui/badge';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ExtensionDto } from '@/shared/contracts';
import { DEEPSEEK_API_EXTENSION_ID } from '@/shared/extension-ids';
import { localizeExtensionManifest } from '@/shared/extension-localization';

/** The extension detail heading, shared with prepared feature-demo windows. */
export function ExtensionPluginHeader({
  extension,
  actions,
  navigationAction,
}: {
  extension: ExtensionDto;
  actions?: ReactNode;
  navigationAction?: ReactNode;
}) {
  const { locale, messages } = useI18n();
  const copy = messages.extensions;
  const manifest = localizeExtensionManifest(extension.manifest, locale);
  // Older bootstrap snapshots can still carry the former generic English label.
  // Its localized state badge already conveys the same information.
  const redundantReady = extension.connectionState === 'READY' && extension.connectionMessage === 'Ready';
  const showConnectionDetail =
    Boolean(extension.connectionMessage) &&
    !redundantReady &&
    !(extension.manifest.id === DEEPSEEK_API_EXTENSION_ID && extension.connectionState === 'NEEDS_CONFIGURATION');
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-3 @4xl/extension-detail:grid-cols-[auto_minmax(0,1fr)_auto] @4xl/extension-detail:gap-x-4">
      <div className="flex items-center gap-2">
        {navigationAction}
        <div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted">
          {extension.manifest.kind === 'LANGUAGE' ? (
            <LanguagesIcon className="size-5" />
          ) : (
            <BlocksIcon className="size-5" />
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 break-words text-lg font-semibold">{manifest.displayName}</h2>
          <Badge variant="secondary">
            {extension.enabled ? copy.connectionStates[extension.connectionState] : copy.disabled}
          </Badge>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="tabular-nums">{extension.manifest.version}</span>
          <span>{copy.kinds[extension.manifest.kind]}</span>
          <span>{copy.source[extension.source]}</span>
        </div>
        {showConnectionDetail && (
          <p className="mt-1 break-words text-xs text-muted-foreground">{extension.connectionMessage}</p>
        )}
      </div>
      {actions && (
        <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-2 @4xl/extension-detail:col-auto @4xl/extension-detail:flex-nowrap">
          {actions}
        </div>
      )}
    </div>
  );
}
