import { useEffect, useMemo, useState } from 'react';
import type {
  PackCatalogItemDto,
  PackInstallationStateDto,
  PackReleaseDto,
  PackReleaseSummaryDto,
} from '@/shared/contracts';
import {
  BoxesIcon,
  CheckCircle2Icon,
  CircleOffIcon,
  LoaderCircleIcon,
  PackageIcon,
  PackagePlusIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { cn } from '@/renderer/lib/utils';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { NavigationMode } from '@/renderer/components/app/app-navigation';

interface Props {
  active: boolean;
  embedded?: boolean;
  requestedId: string | null;
  onSelectedIdChange(id: string, mode?: NavigationMode): void;
  notify(message: string): void;
}

type PendingAction =
  | { kind: 'INSTALL'; packId: string; release: PackReleaseSummaryDto }
  | { kind: 'DISABLE'; packId: string; release: PackReleaseSummaryDto }
  | { kind: 'ENABLE'; packId: string; release: PackReleaseSummaryDto }
  | { kind: 'REMOVE'; packId: string; release: PackReleaseSummaryDto };

function installationIcon(state: PackInstallationStateDto | null) {
  if (state === 'INSTALLED') return CheckCircle2Icon;
  if (state === 'DISABLED' || state === 'REMOVED') return CircleOffIcon;
  if (state === 'INSTALLING' || state === 'UPDATING' || state === 'REMOVAL_PENDING') return LoaderCircleIcon;
  return PackageIcon;
}

export function PackScreen({ active, embedded = false, requestedId, onSelectedIdChange, notify }: Props) {
  const { messages } = useI18n();
  const l = messages.packs;
  const [catalog, setCatalog] = useState<PackCatalogItemDto[]>([]);
  const [selectedPackId, setSelectedPackId] = useState(requestedId ?? '');
  const [release, setRelease] = useState<PackReleaseDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  async function loadCatalog(preferredPackId?: string) {
    setLoading(true);
    setError('');
    try {
      const next = await window.desktopApi.packsList();
      setCatalog(next);
      const preferred = preferredPackId || requestedId || selectedPackId;
      const nextSelectedId = next.some((item) => item.pack.id === preferred) ? preferred : (next[0]?.pack.id ?? '');
      setSelectedPackId(nextSelectedId);
      if (nextSelectedId && nextSelectedId !== requestedId) onSelectedIdChange(nextSelectedId, 'replace');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (active) void loadCatalog();
  }, [active]);

  useEffect(() => {
    if (requestedId !== null) setSelectedPackId(requestedId);
  }, [requestedId]);

  const selected = useMemo(
    () => catalog.find((item) => item.pack.id === selectedPackId) ?? null,
    [catalog, selectedPackId],
  );
  const selectedRelease = useMemo(() => {
    if (!selected) return null;
    return (
      selected.releases.find((item) => item.id === selected.installation?.selectedReleaseId) ??
      selected.releases[0] ??
      null
    );
  }, [selected]);

  useEffect(() => {
    if (!selectedRelease) {
      setRelease(null);
      return;
    }
    let alive = true;
    setRelease(null);
    void window.desktopApi
      .packReleaseGet(selectedRelease.id)
      .then((next) => {
        if (alive) setRelease(next);
      })
      .catch((reason) => {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      alive = false;
    };
  }, [selectedRelease?.id]);

  async function commitAction() {
    if (!pendingAction) return;
    setBusy(true);
    try {
      if (pendingAction.kind === 'INSTALL') {
        await window.desktopApi.packInstallExact({
          packId: pendingAction.packId,
          releaseId: pendingAction.release.id,
        });
      } else if (pendingAction.kind === 'REMOVE') {
        await window.desktopApi.packRemove(pendingAction.packId);
      } else {
        await window.desktopApi.packSetDisabled(pendingAction.packId, pendingAction.kind === 'DISABLE');
      }
      const packId = pendingAction.packId;
      const message = l.actionComplete[pendingAction.kind.toLowerCase() as Lowercase<PendingAction['kind']>];
      setPendingAction(null);
      await loadCatalog(packId);
      notify(message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function importLocal() {
    setBusy(true);
    setError('');
    try {
      const result = await window.desktopApi.packImportLocal();
      if (result.status === 'cancelled') return;
      await loadCatalog(result.packId);
      notify(l.actionComplete.import);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  const actionRelease = pendingAction?.release ?? null;
  const actionLabel = pendingAction
    ? l.actions[pendingAction.kind.toLowerCase() as Lowercase<PendingAction['kind']>]
    : '';

  return (
    <div data-pack-screen className="grid size-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-background">
      <header className={cn('flex items-center gap-3 border-b px-4', embedded ? 'h-12' : 'h-14 px-5')}>
        {!embedded && (
          <>
            <h1 className="text-base font-semibold">{l.title}</h1>
            <Badge variant="secondary">{catalog.length}</Badge>
          </>
        )}
        <Button className="ml-auto" type="button" variant="outline" disabled={busy} onClick={() => void importLocal()}>
          <PackagePlusIcon className="mr-2 size-4" />
          {l.actions.import}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={l.refresh}
          disabled={loading || busy}
          onClick={() => void loadCatalog()}
        >
          <RefreshCwIcon className={cn('size-4', loading && 'animate-spin')} />
        </Button>
      </header>
      <div className="grid min-h-0 grid-cols-[minmax(260px,360px)_minmax(0,1fr)]">
        <ScrollArea className="min-h-0 border-r">
          <div className="grid gap-2 p-3">
            {catalog.map((item) => {
              const currentRelease =
                item.releases.find((candidate) => candidate.id === item.installation?.selectedReleaseId) ??
                item.releases[0] ??
                null;
              const Icon = installationIcon(item.installation?.state ?? null);
              return (
                <button
                  key={item.pack.id}
                  type="button"
                  data-pack-id={item.pack.id}
                  aria-current={selectedPackId === item.pack.id ? 'true' : undefined}
                  className={cn(
                    'grid gap-2 rounded-lg border p-3 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring',
                    selectedPackId === item.pack.id && 'border-selected-border bg-selected',
                  )}
                  onClick={() => {
                    setSelectedPackId(item.pack.id);
                    onSelectedIdChange(item.pack.id);
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon
                      className={cn(
                        'size-4 shrink-0',
                        ['INSTALLING', 'UPDATING', 'REMOVAL_PENDING'].includes(item.installation?.state ?? '') &&
                          'animate-spin',
                      )}
                    />
                    <strong className="min-w-0 flex-1 truncate text-sm">{item.pack.displayName}</strong>
                    <Badge variant="outline">{item.pack.kind === 'BUNDLE' ? l.kind.bundle : l.kind.content}</Badge>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{currentRelease?.version ?? '—'}</span>
                    <span>{currentRelease ? l.itemCount(currentRelease.itemCount) : l.itemCount(0)}</span>
                    <span className="ml-auto">{l.states[item.installation?.state ?? 'NOT_INSTALLED']}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </ScrollArea>
        <ScrollArea className="min-h-0">
          {selected && selectedRelease && (
            <article className="mx-auto grid w-full max-w-4xl gap-6 p-6">
              <div className="flex items-start gap-4">
                <div className="grid size-11 shrink-0 place-items-center rounded-lg border bg-muted">
                  {selected.pack.kind === 'BUNDLE' ? (
                    <BoxesIcon className="size-5" />
                  ) : (
                    <PackageIcon className="size-5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold">{selected.pack.displayName}</h2>
                    <Badge variant="outline">{selectedRelease.version}</Badge>
                    <Badge variant="secondary">{l.states[selected.installation?.state ?? 'NOT_INSTALLED']}</Badge>
                  </div>
                  {selected.pack.description && (
                    <p className="mt-2 text-sm text-muted-foreground">{selected.pack.description}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!selected.installation ||
                  selected.installation.state === 'REMOVED' ||
                  selected.installation.state === 'FAILED_NO_USABLE_RELEASE' ? (
                    <Button
                      type="button"
                      onClick={() =>
                        setPendingAction({ kind: 'INSTALL', packId: selected.pack.id, release: selectedRelease })
                      }
                    >
                      {l.actions.install}
                    </Button>
                  ) : selected.installation.state === 'DISABLED' ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setPendingAction({ kind: 'ENABLE', packId: selected.pack.id, release: selectedRelease })
                      }
                    >
                      {l.actions.enable}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setPendingAction({ kind: 'DISABLE', packId: selected.pack.id, release: selectedRelease })
                      }
                    >
                      {l.actions.disable}
                    </Button>
                  )}
                  {selected.installation &&
                    !['REMOVED', 'FAILED_NO_USABLE_RELEASE'].includes(selected.installation.state) && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          setPendingAction({ kind: 'REMOVE', packId: selected.pack.id, release: selectedRelease })
                        }
                      >
                        {l.actions.remove}
                      </Button>
                    )}
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border text-sm sm:grid-cols-4">
                <div className="bg-background p-3">
                  <dt className="text-xs text-muted-foreground">{l.fields.version}</dt>
                  <dd className="mt-1 font-medium">{selectedRelease.version}</dd>
                </div>
                <div className="bg-background p-3">
                  <dt className="text-xs text-muted-foreground">{l.fields.items}</dt>
                  <dd className="mt-1 font-medium">{selectedRelease.itemCount}</dd>
                </div>
                <div className="bg-background p-3">
                  <dt className="text-xs text-muted-foreground">{l.fields.dependencies}</dt>
                  <dd className="mt-1 font-medium">{selectedRelease.dependencyCount}</dd>
                </div>
                <div className="bg-background p-3">
                  <dt className="text-xs text-muted-foreground">{l.fields.manifest}</dt>
                  <dd className="mt-1 font-medium">{selectedRelease.manifestVersion}</dd>
                </div>
              </dl>

              {selected.pack.contentKinds.length > 0 && (
                <section className="flex flex-wrap gap-2" aria-label={l.fields.contentKinds}>
                  {selected.pack.contentKinds.map((kind) => (
                    <Badge key={kind} variant="secondary">
                      {kind}
                    </Badge>
                  ))}
                </section>
              )}

              {release && (
                <div className="grid gap-5 lg:grid-cols-2">
                  <section className="rounded-lg border">
                    <h3 className="border-b px-4 py-3 text-sm font-semibold">{l.sections.contents}</h3>
                    <div className="divide-y">
                      {release.items.map((item) => (
                        <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                          <span className="min-w-0 flex-1 truncate">{item.itemKey}</span>
                          <Badge variant="outline">{item.objectType}</Badge>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="rounded-lg border">
                    <h3 className="border-b px-4 py-3 text-sm font-semibold">{l.sections.dependencies}</h3>
                    <div className="divide-y">
                      {release.dependencies.map((dependency) => (
                        <div key={dependency.id} className="grid gap-1 px-4 py-2.5 text-sm">
                          <span className="font-medium">{dependency.targetPackId}</span>
                          <span className="text-xs text-muted-foreground">
                            {dependency.kind} · {dependency.versionRange}
                          </span>
                        </div>
                      ))}
                      {release.dependencies.length === 0 && (
                        <div className="px-4 py-3 text-sm tabular-nums text-muted-foreground">0</div>
                      )}
                    </div>
                  </section>
                </div>
              )}
            </article>
          )}
          {!selected && !loading && (
            <div className="grid size-full place-items-center text-3xl tabular-nums text-muted-foreground">0</div>
          )}
          {error && (
            <div
              role="alert"
              className="m-6 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}
        </ScrollArea>
      </div>

      <Dialog
        open={Boolean(pendingAction)}
        onOpenChange={(open) => {
          if (!open && !busy) setPendingAction(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{actionLabel}</DialogTitle>
            {actionRelease && (
              <DialogDescription>
                {actionRelease.version} · {l.itemCount(actionRelease.itemCount)} ·{' '}
                {l.dependencyCount(actionRelease.dependencyCount)}
              </DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setPendingAction(null)}>
              {messages.common.cancel}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void commitAction()}>
              {actionLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
