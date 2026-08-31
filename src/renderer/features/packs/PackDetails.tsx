import { BoxesIcon, PackageIcon } from 'lucide-react';
import type { PackCatalogItemDto, PackReleaseDto, PackReleaseSummaryDto } from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { PackReleaseHistory } from '@/renderer/features/packs/PackReleaseHistory';
import { useI18n } from '@/renderer/i18n/useI18n';

export type PackDetailActionKind = 'INSTALL' | 'USE_RELEASE' | 'DISABLE' | 'ENABLE' | 'REMOVE';

interface Props {
  item: PackCatalogItemDto;
  selectedRelease: PackReleaseSummaryDto;
  release: PackReleaseDto | null;
  busy: boolean;
  onSelectRelease(releaseId: string): void;
  onAction(kind: PackDetailActionKind, release: PackReleaseSummaryDto): void;
}

export function PackDetails({ item, selectedRelease, release, busy, onSelectRelease, onAction }: Props) {
  const { messages } = useI18n();
  const l = messages.packs;
  const installation = item.installation;
  const isUsableInstallation = installation && !['REMOVED', 'FAILED_NO_USABLE_RELEASE'].includes(installation.state);
  const inspectedRelease = release?.id === selectedRelease.id ? release : null;

  return (
    <article className="mx-auto grid w-full max-w-4xl gap-6 p-6">
      <div className="flex items-start gap-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-lg border bg-muted">
          {item.pack.kind === 'BUNDLE' ? <BoxesIcon className="size-5" /> : <PackageIcon className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{item.pack.displayName}</h2>
            <Badge variant="outline">{selectedRelease.version}</Badge>
            <Badge variant="secondary">{l.states[installation?.state ?? 'NOT_INSTALLED']}</Badge>
          </div>
          {item.pack.description && <p className="mt-2 text-sm text-muted-foreground">{item.pack.description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!installation || installation.state === 'REMOVED' || installation.state === 'FAILED_NO_USABLE_RELEASE' ? (
            <Button type="button" onClick={() => onAction('INSTALL', selectedRelease)}>
              {l.actions.install}
            </Button>
          ) : installation.state === 'DISABLED' ? (
            <Button type="button" variant="outline" onClick={() => onAction('ENABLE', selectedRelease)}>
              {l.actions.enable}
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => onAction('DISABLE', selectedRelease)}>
              {l.actions.disable}
            </Button>
          )}
          {installation && !['REMOVED', 'FAILED_NO_USABLE_RELEASE'].includes(installation.state) && (
            <Button type="button" variant="ghost" onClick={() => onAction('REMOVE', selectedRelease)}>
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

      <PackReleaseHistory
        releases={item.releases}
        selectedReleaseId={selectedRelease.id}
        installedReleaseId={isUsableInstallation ? installation.selectedReleaseId : null}
        busy={busy}
        onSelect={onSelectRelease}
        onApply={(nextRelease) => onAction('USE_RELEASE', nextRelease)}
      />

      {item.pack.contentKinds.length > 0 && (
        <section className="flex flex-wrap gap-2" aria-label={l.fields.contentKinds}>
          {item.pack.contentKinds.map((kind) => (
            <Badge key={kind} variant="secondary">
              {kind}
            </Badge>
          ))}
        </section>
      )}

      {inspectedRelease && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-lg border">
            <h3 className="border-b px-4 py-3 text-sm font-semibold">{l.sections.contents}</h3>
            <div className="divide-y">
              {inspectedRelease.items.map((releaseItem) => (
                <div key={releaseItem.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{releaseItem.itemKey}</span>
                  <Badge variant="outline">{releaseItem.objectType}</Badge>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-lg border">
            <h3 className="border-b px-4 py-3 text-sm font-semibold">{l.sections.dependencies}</h3>
            <div className="divide-y">
              {inspectedRelease.dependencies.map((dependency) => (
                <div key={dependency.id} className="grid gap-1 px-4 py-2.5 text-sm">
                  <span className="font-medium">{dependency.targetPackId}</span>
                  <span className="text-xs text-muted-foreground">
                    {dependency.kind} · {dependency.versionRange}
                  </span>
                </div>
              ))}
              {inspectedRelease.dependencies.length === 0 && (
                <div className="px-4 py-3 text-sm tabular-nums text-muted-foreground">0</div>
              )}
            </div>
          </section>
        </div>
      )}
    </article>
  );
}
