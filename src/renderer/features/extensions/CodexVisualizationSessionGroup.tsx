import {
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  FileCodeIcon,
  FileIcon,
  FileTextIcon,
  FolderOpenIcon,
  ImageIcon,
  SquareArrowOutUpRightIcon,
  StarIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import type {
  CodexVisualizationArtifactDto,
  CodexVisualizationSessionDto,
} from '@/shared/contracts/codex-visualizations';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import {
  canPreviewCodexVisualizationArtifact,
  isCodexMermaidArtifact,
} from '@/renderer/features/extensions/codexVisualizationArtifacts';
import { CodexHtmlCardPreview } from '@/renderer/features/extensions/CodexHtmlCardPreview';
import { CodexMermaidThumbnail } from '@/renderer/features/extensions/CodexMermaidThumbnail';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

interface Props {
  session: CodexVisualizationSessionDto;
  favorite: boolean;
  hidden: boolean;
  busy: boolean;
  onOpenCodex(sessionId: string): void;
  onPreviewArtifact(artifact: CodexVisualizationArtifactDto): void;
  onOpenArtifact(artifact: CodexVisualizationArtifactDto): void;
  onRevealArtifact(artifact: CodexVisualizationArtifactDto): void;
  onExportArtifact(artifact: CodexVisualizationArtifactDto): void;
  onExportSession(sessionId: string): void;
  onSetFavorite(sessionId: string, favorite: boolean): void;
  onSetHidden(sessionId: string, hidden: boolean): void;
}

function formatBytes(byteSize: number, locale: string) {
  if (byteSize < 1024) return `${byteSize} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = byteSize / 1024;
  let unit = units[0]!;
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index]!;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: value >= 10 ? 0 : 1 }).format(value)} ${unit}`;
}

function ArtifactIcon({ artifact }: { artifact: CodexVisualizationArtifactDto }) {
  if (artifact.kind === 'IMAGE' || artifact.kind === 'VECTOR') return <ImageIcon className="size-8" />;
  if (artifact.kind === 'INTERACTIVE') return <FileCodeIcon className="size-8" />;
  if (artifact.kind === 'DOCUMENT' || artifact.kind === 'DIAGRAM_SOURCE') return <FileTextIcon className="size-8" />;
  return <FileIcon className="size-8" />;
}

export function CodexVisualizationSessionGroup({
  session,
  favorite,
  hidden,
  busy,
  onOpenCodex,
  onPreviewArtifact,
  onOpenArtifact,
  onRevealArtifact,
  onExportArtifact,
  onExportSession,
  onSetFavorite,
  onSetHidden,
}: Props) {
  const { locale, messages } = useI18n();
  const l = messages.extensions.codexVisualizationDiscovery;
  const primaryArtifacts = session.artifacts.filter((artifact) => artifact.role === 'PRIMARY');
  const supportingCount = session.artifactCount - session.primaryCount;
  const displayName = session.threadTitleAvailable ? session.threadName : l.untitledTask;
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
  );

  return (
    <section data-codex-visualization-session={session.sessionId} className="overflow-hidden rounded-lg border">
      <header className="flex min-w-0 flex-wrap items-center gap-2 border-b bg-surface-sunken/40 px-3 py-2">
        <div className="min-w-40 flex-1">
          <strong className="block truncate text-sm" title={displayName}>
            {displayName}
          </strong>
          <span className="mt-0.5 block truncate font-mono text-2xs text-muted-foreground" title={session.sessionId}>
            {session.sessionId.slice(0, 8)}
          </span>
        </div>
        <Badge variant="secondary">{l.results(session.primaryCount)}</Badge>
        {supportingCount > 0 && <Badge variant="outline">{l.supporting(supportingCount)}</Badge>}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={favorite ? l.actions.unfavorite : l.actions.favorite}
          title={favorite ? l.actions.unfavorite : l.actions.favorite}
          onClick={() => onSetFavorite(session.sessionId, !favorite)}
        >
          <StarIcon className={cn('size-4', favorite && 'fill-current text-foreground')} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={l.actions.openCodex}
          title={l.actions.openCodex}
          onClick={() => onOpenCodex(session.sessionId)}
        >
          <SquareArrowOutUpRightIcon className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={l.actions.exportSession}
          title={l.actions.exportSession}
          onClick={() => onExportSession(session.sessionId)}
        >
          <DownloadIcon className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={hidden ? l.actions.restore : l.actions.hide}
          title={hidden ? l.actions.restore : l.actions.hide}
          onClick={() => onSetHidden(session.sessionId, !hidden)}
        >
          {hidden ? <EyeIcon className="size-4" /> : <EyeOffIcon className="size-4" />}
        </Button>
      </header>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,18rem))] gap-3 p-3">
        {primaryArtifacts.map((artifact) => {
          const previewable = canPreviewCodexVisualizationArtifact(artifact);
          const mermaidPreview = isCodexMermaidArtifact(artifact);
          return (
            <article key={artifact.id} className="min-w-0 overflow-hidden rounded-md border bg-background">
              <div className="relative isolate grid aspect-video w-full place-items-center overflow-hidden bg-surface-sunken text-muted-foreground">
                {artifact.mediaUrl ? (
                  <>
                    <ImageAmbientBackdrop src={artifact.mediaUrl} loading="lazy" />
                    <img
                      src={artifact.mediaUrl}
                      alt=""
                      loading="lazy"
                      draggable={false}
                      className="relative z-[1] size-full object-contain"
                    />
                  </>
                ) : (
                  <>
                    {!mermaidPreview && <ArtifactIcon artifact={artifact} />}
                    {artifact.sourceKind === 'FILE' && artifact.kind === 'INTERACTIVE' && (
                      <CodexHtmlCardPreview artifact={artifact} />
                    )}
                    {mermaidPreview && <CodexMermaidThumbnail artifact={artifact} />}
                  </>
                )}
                <button
                  type="button"
                  data-codex-thread-id={session.sessionId}
                  className="absolute inset-0 z-10 bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  aria-label={`${
                    previewable
                      ? l.actions.preview
                      : artifact.sourceKind === 'THREAD_MESSAGE'
                        ? l.actions.openCodex
                        : l.actions.open
                  }: ${artifact.fileName}`}
                  disabled={busy}
                  onClick={() =>
                    previewable
                      ? onPreviewArtifact(artifact)
                      : artifact.sourceKind === 'THREAD_MESSAGE'
                        ? onOpenCodex(session.sessionId)
                        : onOpenArtifact(artifact)
                  }
                />
                <Badge variant="secondary" className="pointer-events-none absolute right-2 bottom-2 z-20 uppercase">
                  {artifact.extension.slice(1)}
                </Badge>
              </div>
              <div className="flex min-w-0 items-center gap-1 border-t px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium" title={artifact.relativePath}>
                    {artifact.fileName}
                  </div>
                  <div className="truncate text-2xs text-muted-foreground">
                    {l.kinds[artifact.kind]} · {formatBytes(artifact.byteSize, locale)} ·{' '}
                    {dateFormatter.format(new Date(artifact.modifiedAt))}
                  </div>
                </div>
                {artifact.sourceKind === 'FILE' && previewable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="2xs"
                    className="size-7 px-0"
                    disabled={busy}
                    aria-label={l.actions.openExternal}
                    title={l.actions.openExternal}
                    onClick={() => onOpenArtifact(artifact)}
                  >
                    <SquareArrowOutUpRightIcon className="size-3.5" />
                  </Button>
                )}
                {artifact.sourceKind === 'FILE' && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="2xs"
                    className="size-7 px-0"
                    disabled={busy}
                    aria-label={l.actions.reveal}
                    title={l.actions.reveal}
                    onClick={() => onRevealArtifact(artifact)}
                  >
                    <FolderOpenIcon className="size-3.5" />
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="2xs"
                  className="size-7 px-0"
                  disabled={busy}
                  aria-label={l.actions.export}
                  title={l.actions.export}
                  onClick={() => onExportArtifact(artifact)}
                >
                  <DownloadIcon className="size-3.5" />
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
