import { DownloadIcon, FilmIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/renderer/components/ui/button';
import type { GifMakerModel } from '@/renderer/features/gif-making/useGifMaker';
export function GifMakerFooter({
  model,
  adoption,
  status,
}: {
  model: GifMakerModel;
  adoption?: ReactNode;
  status?: ReactNode;
}) {
  const { labels, project, manifest, exporting, progress, result, activeRun, busy, exportGif, safe } = model;
  return (
    <footer className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
      <div role="status" className="min-w-0 flex-1 text-xs text-muted-foreground">
        {status !== undefined
          ? status
          : project.error
            ? labels.errors[project.error]
            : progress
              ? `${labels.stages[progress.stage]} ${progress.completed}/${progress.total}`
              : result
                ? `${labels.exportRevision} ${result.revision} · ${Math.round((result.asset.byteSize ?? 0) / 1024)} KB`
                : null}
      </div>
      {result && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => safe(() => window.desktopApi.assetFileSaveAs(result.asset.id))}
          data-action="gif-save-file"
        >
          <DownloadIcon className="size-4" />
          {labels.download}
        </Button>
      )}
      {adoption}
      {exporting ? (
        <Button
          variant="outline"
          size="sm"
          disabled={!activeRun.current}
          onClick={() => {
            if (activeRun.current) safe(() => window.desktopApi.gifCancel(activeRun.current!));
          }}
        >
          {labels.cancel}
        </Button>
      ) : (
        <Button
          data-action="gif-export"
          size="sm"
          disabled={busy || manifest.frames.length < 2}
          onClick={() => void exportGif()}
        >
          <FilmIcon className="size-4" />
          {result ? labels.exportAgain : labels.export}
        </Button>
      )}
    </footer>
  );
}
