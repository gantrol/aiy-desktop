import { ChevronLeftIcon, ChevronRightIcon, LoaderCircleIcon, PanelsTopLeftIcon, RefreshCwIcon } from 'lucide-react';
import type { ExtensionDto } from '@/shared/contracts';
import type { CodexVisualizationFilter } from '@/shared/contracts/codex-visualizations';
import { CODEX_VISUALIZATION_THREAD_CONTENT_PERMISSION } from '@/shared/extension-ids';
import { Button } from '@/renderer/components/ui/button';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { CodexVisualizationSessionGroup } from '@/renderer/features/extensions/CodexVisualizationSessionGroup';
import { CodexHtmlPreviewDialog } from '@/renderer/features/extensions/CodexHtmlPreviewDialog';
import { CodexMermaidPreviewDialog } from '@/renderer/features/extensions/CodexMermaidPreviewDialog';
import { CodexThreadDiagramDateRangePicker } from '@/renderer/features/extensions/CodexThreadDiagramDateRangePicker';
import { useCodexVisualizationDiscovery } from '@/renderer/features/extensions/useCodexVisualizationDiscovery';

interface Props {
  active: boolean;
  extension: ExtensionDto;
  standalone?: boolean;
  notify(message: string): void;
}

type DiscoveryState = ReturnType<typeof useCodexVisualizationDiscovery>;

function VisualizationToolbar({
  state,
  threadContentAuthorized,
}: {
  state: DiscoveryState;
  threadContentAuthorized: boolean;
}) {
  const l = useI18n().messages.extensions.codexVisualizationDiscovery;
  const snapshot = state.snapshot;
  if (!snapshot) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
      <Segmented
        type="single"
        value={state.filter}
        aria-label={l.filters.label}
        onValueChange={(value) => value && state.changeFilter(value as CodexVisualizationFilter)}
      >
        <SegmentedItem value="VISIBLE" disabled={state.busy || !snapshot.available}>
          {l.filters.visible(state.visibleCount)}
        </SegmentedItem>
        <SegmentedItem value="HIDDEN" disabled={state.busy || !snapshot.available}>
          {l.filters.hidden(snapshot.hiddenSessionCount)}
        </SegmentedItem>
      </Segmented>
      <CodexThreadDiagramDateRangePicker
        busy={state.busy}
        threadContentAuthorized={threadContentAuthorized}
        selection={state.threadDiagramDateSelection}
        range={state.threadDiagramDateRange}
        artifactCount={state.loading ? null : snapshot.threadDiagramArtifactCount}
        onChange={state.changeThreadDiagramDateSelection}
      />
      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
        {l.matches(snapshot.filteredSessionCount)}
      </span>
    </div>
  );
}

function VisualizationResults({ authorized, state }: { authorized: boolean; state: DiscoveryState }) {
  const l = useI18n().messages.extensions.codexVisualizationDiscovery;
  const snapshot = state.snapshot;
  if (state.loading && (!snapshot || !snapshot.available)) {
    return (
      <div className="grid min-h-32 place-items-center">
        <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!state.loading && (!authorized || snapshot?.available === false)) {
    return <div className="grid min-h-32 place-items-center text-sm text-muted-foreground">{l.unavailable}</div>;
  }
  if (!state.loading && authorized && snapshot?.available && snapshot.sessions.length === 0) {
    return (
      <div className="grid min-h-32 place-items-center text-sm text-muted-foreground">
        {state.filter === 'HIDDEN' ? l.emptyHidden : l.empty}
      </div>
    );
  }
  if (!authorized || !snapshot?.available) return null;
  return (
    <>
      <div className="grid gap-4">
        {snapshot.sessions.map((session) => (
          <CodexVisualizationSessionGroup
            key={session.sessionId}
            session={session}
            favorite={state.favoriteIds.has(session.sessionId)}
            hidden={state.hiddenIds.has(session.sessionId)}
            busy={state.busy}
            onOpenCodex={(sessionId) => void state.openCodex(sessionId)}
            onPreviewArtifact={(artifact) => void state.previewArtifact(artifact)}
            onOpenArtifact={(artifact) => void state.openArtifact(artifact)}
            onRevealArtifact={(artifact) =>
              void state.runArtifactAction(`reveal:${artifact.id}`, artifact, (input) =>
                window.desktopApi.codexVisualizationReveal(input),
              )
            }
            onExportArtifact={(artifact) => void state.exportArtifact(artifact)}
            onExportSession={(sessionId) => void state.exportSession(sessionId)}
            onSetFavorite={state.setFavorite}
            onSetHidden={state.setHidden}
          />
        ))}
      </div>
      {snapshot.pageCount > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={state.busy || snapshot.page <= 1}
            onClick={() => void state.changePage(snapshot.page - 1)}
          >
            <ChevronLeftIcon className="size-4" />
            {l.actions.previous}
          </Button>
          <span className="min-w-28 text-center text-xs tabular-nums text-muted-foreground">
            {l.page(snapshot.page, snapshot.pageCount)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={state.busy || snapshot.page >= snapshot.pageCount}
            onClick={() => void state.changePage(snapshot.page + 1)}
          >
            {l.actions.next}
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>
      )}
    </>
  );
}

export function CodexVisualizationDiscoveryConfiguration({ active, extension, standalone = false, notify }: Props) {
  const l = useI18n().messages.extensions.codexVisualizationDiscovery;
  const authorized =
    extension.enabled &&
    extension.compatible &&
    extension.permissions.every((permission) => !permission.required || permission.granted);
  const threadContentAuthorized = extension.permissions.some(
    (permission) => permission.key === CODEX_VISUALIZATION_THREAD_CONTENT_PERMISSION && permission.granted,
  );
  const state = useCodexVisualizationDiscovery({
    active,
    authorized,
    threadContentAuthorized,
    standalone,
    notify,
  });
  const preview = state.preview;
  const Heading = standalone ? 'h2' : 'h3';

  return (
    <section
      ref={state.sectionRef}
      data-codex-visualization-discovery-configuration
      className={cn(
        'overflow-hidden bg-background',
        standalone ? 'flex size-full min-h-0 flex-col' : 'rounded-lg border',
      )}
    >
      <header
        className={cn(
          'flex flex-wrap items-center gap-2 border-b',
          standalone ? 'min-h-14 shrink-0 px-5 py-2' : 'px-4 py-3',
        )}
      >
        <PanelsTopLeftIcon className="size-4" />
        <Heading className={cn('font-semibold', standalone ? 'text-base' : 'text-sm')}>{l.title}</Heading>
        <div className="ml-auto">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={l.actions.refresh}
            title={l.actions.refresh}
            disabled={!authorized || state.busy}
            onClick={() => void state.load(state.snapshot?.page ?? 1, true, true)}
          >
            {state.loading ? (
              <LoaderCircleIcon className="size-4 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-4" />
            )}
          </Button>
        </div>
      </header>

      {authorized && state.snapshot?.rootPath && (
        <div className="flex min-w-0 items-center gap-3 border-b bg-surface-sunken/40 px-4 py-2 text-xs">
          <span className="shrink-0 text-muted-foreground">{l.root}</span>
          <code className="min-w-0 flex-1 truncate" title={state.snapshot.rootPath}>
            {state.snapshot.rootPath}
          </code>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {l.sessions(state.snapshot.totalSessionCount)} · {l.artifacts(state.snapshot.totalArtifactCount)}
          </span>
        </div>
      )}

      {authorized && <VisualizationToolbar state={state} threadContentAuthorized={threadContentAuthorized} />}

      {state.error && (
        <div role="alert" className="border-b bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {state.error}
        </div>
      )}

      <div ref={state.contentRef} className={cn('p-4', standalone && 'min-h-0 flex-1 overflow-y-auto')}>
        <VisualizationResults authorized={authorized} state={state} />
      </div>
      {preview?.kind === 'HTML' && (
        <CodexHtmlPreviewDialog
          artifact={preview.artifact}
          access={preview.access}
          busy={state.busy}
          onClose={state.closePreview}
          onOpenExternal={() => void state.openArtifact(preview.artifact)}
        />
      )}
      {preview?.kind === 'MERMAID' && (
        <CodexMermaidPreviewDialog
          artifact={preview.artifact}
          access={preview.access}
          busy={state.busy}
          openSourceLabel={
            preview.artifact.sourceKind === 'THREAD_MESSAGE' ? l.actions.openCodex : l.actions.openExternal
          }
          onClose={state.closePreview}
          onOpenSource={() =>
            void (preview.artifact.sourceKind === 'THREAD_MESSAGE'
              ? state.openCodex(preview.artifact.sessionId)
              : state.openArtifact(preview.artifact))
          }
        />
      )}
    </section>
  );
}
