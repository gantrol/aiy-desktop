import { ImagesIcon, LoaderCircleIcon, PlayIcon } from 'lucide-react';
import type { VideoKeyChangeResultDto } from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';

interface Props {
  result: VideoKeyChangeResultDto | null;
  loading: boolean;
  extracting: boolean;
  onExtract(): void;
  onSeek(timestampMs: number): void;
}

function formatTimestamp(timestampMs: number) {
  const totalSeconds = Math.max(0, Math.floor(timestampMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function VideoKeyChangePanel({ result, loading, extracting, onExtract, onSeek }: Props) {
  const { messages } = useI18n();
  const labels = messages.videoDocuments.keyChanges;
  const busy = loading || extracting;

  return (
    <section data-slot="video-key-change-panel">
      <div className="flex items-center gap-2 border-b pb-4">
        <ImagesIcon className="size-4 text-muted-foreground" />
        <h2 className="font-semibold">{labels.title}</h2>
        {result && (
          <Badge variant="outline" className="ml-1">
            {labels.candidateCount(result.candidates.length)}
          </Badge>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={busy || Boolean(result)}
          onClick={onExtract}
        >
          {busy && <LoaderCircleIcon className="size-4 animate-spin" />}
          {extracting ? labels.extracting : labels.extract}
        </Button>
      </div>

      {loading && !result ? (
        <div className="grid h-28 place-items-center text-muted-foreground">
          <LoaderCircleIcon className="size-5 animate-spin" />
        </div>
      ) : result ? (
        <>
          <p className="py-3 text-xs text-muted-foreground">
            {labels.scanSummary(result.scannedFrameCount, result.sampleIntervalMs / 1000)}
          </p>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            {result.candidates.map((candidate) => {
              const timestamp = formatTimestamp(candidate.timestampMs);
              return (
                <button
                  key={candidate.id}
                  type="button"
                  className="group overflow-hidden rounded-lg border bg-surface text-left outline-none transition-colors hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={labels.openAt(timestamp)}
                  onClick={() => onSeek(candidate.timestampMs)}
                >
                  <span className="relative isolate block aspect-video overflow-hidden bg-surface-sunken">
                    <ImageAmbientBackdrop src={candidate.imageUrl} loading="lazy" />
                    <img
                      src={candidate.imageUrl}
                      alt=""
                      className="relative z-10 size-full object-contain"
                      loading="lazy"
                    />
                    <span className="absolute bottom-2 left-2 z-20 inline-flex items-center gap-1 rounded bg-overlay/90 px-2 py-1 text-xs text-foreground shadow-overlay backdrop-blur-sm">
                      <PlayIcon className="size-3 fill-current" />
                      {timestamp}
                    </span>
                  </span>
                  <span className="block truncate px-3 py-2 text-xs text-muted-foreground">
                    {labels.reasons[candidate.reason]}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <p className="py-8 text-sm text-muted-foreground">{labels.empty}</p>
      )}
    </section>
  );
}
