import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BookOpenIcon, ImagesIcon, LoaderCircleIcon, SquarePenIcon } from 'lucide-react';
import {
  assetSourceKey,
  type AssetNavigationDto,
  type AssetNavigationTarget,
  type AssetSourceDestination,
  type AssetSourceIdentity,
} from '@/shared/contracts/asset-navigation';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/renderer/components/ui/dialog';
import { useWorkspacePaneContainer } from '@/renderer/components/workspace/WorkspacePaneScope';

export type AssetNavigationIntent = 'PRIMARY' | 'MATERIAL' | 'SOURCES';
interface AssetNavigationActions {
  open(assetId: string, intent: AssetNavigationIntent, source?: AssetSourceIdentity): Promise<void>;
  busyAssetId: string | null;
  currentAssetId?: string | null;
}
const AssetNavigationContext = createContext<AssetNavigationActions | null>(null);
export const useAssetNavigation = () => useContext(AssetNavigationContext);

export function AssetNavigationProvider({
  active,
  navigationKey,
  currentAssetId,
  onNavigate,
  notify,
  children,
}: {
  active: boolean;
  navigationKey: string;
  currentAssetId?: string | null;
  onNavigate(target: AssetNavigationTarget): void;
  notify(message: string): void;
  children: ReactNode;
}) {
  const { locale, messages } = useI18n();
  const labels = messages.assetFile;
  const paneContainer = useWorkspacePaneContainer();
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const [choices, setChoices] = useState<AssetNavigationDto | null>(null);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const invalidate = useCallback(() => {
    revision.current++;
  }, []);
  const latest = useRef({ active, navigationKey, locale, onNavigate, notify });
  latest.current = { active, navigationKey, locale, onNavigate, notify };
  useEffect(() => {
    setChoices(null);
    setBusyAssetId(null);
    return invalidate;
  }, [active, navigationKey, locale, invalidate]);

  const actions = useMemo<AssetNavigationActions>(
    () => ({
      currentAssetId,
      busyAssetId,
      async open(assetId, intent, requestedSource) {
        if (!latest.current.active) return;
        const request = ++revision.current;
        const origin = latest.current;
        returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const current = () =>
          request === revision.current &&
          latest.current.active &&
          origin.navigationKey === latest.current.navigationKey &&
          origin.locale === latest.current.locale;
        setBusyAssetId(assetId);
        setError('');
        try {
          const result = await window.desktopApi.assetNavigationGet(assetId, origin.locale);
          if (!current()) return;
          if (!result) throw new Error('UNAVAILABLE');
          const creations = result.sources.filter((source) => source.kind === 'CREATION');
          const candidates = requestedSource
            ? result.sources.filter((source) => assetSourceKey(source) === assetSourceKey(requestedSource))
            : intent === 'PRIMARY'
              ? creations
              : result.sources;
          if (requestedSource && !candidates[0]?.available) throw new Error('UNAVAILABLE');
          if (intent === 'MATERIAL' || (intent === 'PRIMARY' && creations.length === 0)) {
            origin.onNavigate({ kind: 'MATERIAL', assetId });
          } else if (candidates.length === 1 && candidates[0].available) {
            const source = candidates[0];
            origin.onNavigate(
              source.kind === 'TERM'
                ? { kind: 'TERM', termId: source.id }
                : {
                    kind: 'CREATION',
                    assetId,
                    seriesId: source.id,
                    ...(source.versionId ? { versionId: source.versionId } : {}),
                  },
            );
          } else {
            setChoices(result);
          }
        } catch {
          if (current()) origin.notify(labels.navigationFailed);
        } finally {
          if (current()) setBusyAssetId(null);
        }
      },
    }),
    [busyAssetId, currentAssetId, labels.navigationFailed],
  );

  async function choose(source?: AssetSourceDestination) {
    if (!choices || busyAssetId) return;
    const assetId = choices.material.asset.id;
    const request = ++revision.current;
    const origin = latest.current;
    setBusyAssetId(assetId);
    setError('');
    try {
      const refreshed = await window.desktopApi.assetNavigationGet(assetId, origin.locale);
      if (
        request !== revision.current ||
        !latest.current.active ||
        origin.navigationKey !== latest.current.navigationKey
      )
        return;
      if (!refreshed) throw new Error('UNAVAILABLE');
      const target =
        source && refreshed.sources.find((candidate) => assetSourceKey(candidate) === assetSourceKey(source));
      if (source && !target?.available) {
        setChoices(refreshed);
        throw new Error('UNAVAILABLE');
      }
      setChoices(null);
      origin.onNavigate(
        !target
          ? { kind: 'MATERIAL', assetId }
          : target.kind === 'TERM'
            ? { kind: 'TERM', termId: target.id }
            : {
                kind: 'CREATION',
                assetId,
                seriesId: target.id,
                ...(target.versionId ? { versionId: target.versionId } : {}),
              },
      );
    } catch {
      if (request === revision.current) setError(labels.navigationFailed);
    } finally {
      if (request === revision.current) setBusyAssetId(null);
    }
  }

  return (
    <AssetNavigationContext.Provider value={actions}>
      {children}
      <Dialog
        container={paneContainer}
        open={Boolean(choices) && active}
        onOpenChange={(open) => {
          if (!open) {
            revision.current++;
            setChoices(null);
            setBusyAssetId(null);
          }
        }}
      >
        <DialogContent
          className="max-w-sm gap-2 p-3"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (latest.current.active && returnFocus.current?.isConnected)
              returnFocus.current.focus({ preventScroll: true });
          }}
        >
          <DialogTitle className="sr-only">{labels.sources}</DialogTitle>
          {choices?.sources.length === 0 && (
            <p role="status" className="px-2 py-2 text-xs text-muted-foreground">
              {labels.noSources}
            </p>
          )}
          <div className="max-h-[60vh] overflow-y-auto pr-8">
            {choices?.sources.map((source) => {
              const Icon = source.kind === 'CREATION' ? SquarePenIcon : BookOpenIcon;
              const version =
                source.kind === 'CREATION' && source.versionNo !== null
                  ? ` · V${new Intl.NumberFormat(locale).format(source.versionNo)}`
                  : '';
              const title = `${source.title}${version}`;
              return (
                <Button
                  key={assetSourceKey(source)}
                  variant="ghost"
                  className="h-auto min-h-9 w-full justify-start py-2 text-left"
                  disabled={Boolean(busyAssetId) || !source.available}
                  title={source.available ? title : messages.referenceOutline.lookup.notAvailable}
                  onClick={() => void choose(source)}
                >
                  <Icon className="size-4" aria-hidden />
                  <span className="min-w-0 whitespace-normal break-words">{title}</span>
                  {!source.available && (
                    <span className="sr-only">{messages.referenceOutline.lookup.notAvailable}</span>
                  )}
                </Button>
              );
            })}
          </div>
          {choices?.material.asset.id !== currentAssetId && (
            <Button
              variant="ghost"
              className="justify-start"
              disabled={Boolean(busyAssetId)}
              onClick={() => void choose()}
            >
              {busyAssetId ? (
                <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
              ) : (
                <ImagesIcon className="size-4" aria-hidden />
              )}
              {labels.viewMaterial}
            </Button>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </AssetNavigationContext.Provider>
  );
}
