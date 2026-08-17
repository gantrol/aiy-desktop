import { useEffect, useMemo, useRef, useState } from 'react';
import { DownloadIcon, PauseIcon, PlayIcon, RotateCcwIcon, SquareIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Slider } from '@/renderer/components/ui/slider';
import {
  downloadFeatureDemoVideo,
  exportFeatureDemoVideo,
} from '@/renderer/features/extensions/feature-demo/featureDemoExport';
import {
  drawFeatureDemoFrame,
  type FeatureDemoCopy,
} from '@/renderer/features/extensions/feature-demo/featureDemoRenderer';
import {
  FEATURE_DEMO_DURATION_SECONDS,
  FEATURE_DEMO_PREVIEW_HEIGHT,
  FEATURE_DEMO_PREVIEW_WIDTH,
  FEATURE_DEMO_SCENES,
  featureDemoSceneAt,
  featureDemoSceneStart,
} from '@/renderer/features/extensions/feature-demo/featureDemoTimeline';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

function formatTime(seconds: number) {
  const bounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(bounded / 60);
  return `${minutes}:${String(bounded % 60).padStart(2, '0')}`;
}

export function FeatureDemoShowcase({ notify }: { notify(message: string): void }) {
  const { messages } = useI18n();
  const l = messages.extensions.featureDemo;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const timeRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [exportProgress, setExportProgress] = useState<number | null>(null);

  const copy = useMemo<FeatureDemoCopy>(
    () => ({
      brand: l.brand,
      introTitle: l.scenes.intro.title,
      introSubtitle: l.scenes.intro.subtitle,
      thumbnailExpandTitle: l.scenes.thumbnailExpand.title,
      thumbnailExpandSubtitle: l.scenes.thumbnailExpand.subtitle,
      thumbnailCollapseTitle: l.scenes.thumbnailCollapse.title,
      thumbnailCollapseSubtitle: l.scenes.thumbnailCollapse.subtitle,
      codexImagesTitle: l.scenes.codexImages.title,
      codexImagesSubtitle: l.scenes.codexImages.subtitle,
      promptCompareTitle: l.scenes.promptCompare.title,
      promptCompareSubtitle: l.scenes.promptCompare.subtitle,
      videoDocumentTitle: l.scenes.videoDocument.title,
      videoDocumentSubtitle: l.scenes.videoDocument.subtitle,
      outroTitle: l.scenes.outro.title,
      outroSubtitle: l.scenes.outro.subtitle,
      tasks: l.canvas.tasks,
      library: l.canvas.library,
      prompt: l.canvas.prompt,
      model: l.canvas.model,
      version: l.canvas.version,
      video: l.canvas.video,
      article: l.canvas.article,
      transcript: l.canvas.transcript,
      importAction: l.canvas.importAction,
    }),
    [l],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { alpha: false });
    if (context) drawFeatureDemoFrame(context, time, copy);
  }, [copy, time]);

  useEffect(() => {
    if (!playing) return;
    const startedAt = performance.now() - timeRef.current * 1000;
    let lastPublishedAt = 0;
    const tick = (now: number) => {
      const next = (now - startedAt) / 1000;
      if (next >= FEATURE_DEMO_DURATION_SECONDS) {
        timeRef.current = FEATURE_DEMO_DURATION_SECONDS;
        setTime(FEATURE_DEMO_DURATION_SECONDS);
        setPlaying(false);
        return;
      }
      timeRef.current = next;
      if (now - lastPublishedAt >= 33) {
        lastPublishedAt = now;
        setTime(next);
      }
      animationFrameRef.current = requestAnimationFrame(tick);
    };
    animationFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    };
  }, [playing]);

  useEffect(
    () => () => {
      exportAbortRef.current?.abort();
    },
    [],
  );

  const position = featureDemoSceneAt(time);
  const exporting = exportProgress !== null;

  function seek(next: number) {
    const bounded = Math.min(FEATURE_DEMO_DURATION_SECONDS, Math.max(0, next));
    timeRef.current = bounded;
    setTime(bounded);
  }

  function replay() {
    seek(0);
    setPlaying(true);
  }

  async function exportVideo() {
    if (exporting) {
      exportAbortRef.current?.abort();
      return;
    }
    const controller = new AbortController();
    exportAbortRef.current = controller;
    setExportProgress(0);
    try {
      const video = await exportFeatureDemoVideo({
        copy,
        signal: controller.signal,
        onProgress: setExportProgress,
      });
      downloadFeatureDemoVideo(video);
      notify(l.exported);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) notify(l.exportFailed);
    } finally {
      exportAbortRef.current = null;
      setExportProgress(null);
    }
  }

  return (
    <section data-feature-demo-showcase className="grid gap-4 rounded-lg border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{l.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatTime(FEATURE_DEMO_DURATION_SECONDS)} · 2560×1440 · 30 FPS
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setPlaying((current) => !current)}>
            {playing ? <PauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5" />}
            {playing ? l.pause : l.play}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={replay}>
            <RotateCcwIcon className="size-3.5" />
            {l.replay}
          </Button>
          <Button type="button" size="sm" onClick={() => void exportVideo()}>
            {exporting ? <SquareIcon className="size-3.5" /> : <DownloadIcon className="size-3.5" />}
            {exporting ? l.cancelExport : l.export2k}
          </Button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {FEATURE_DEMO_SCENES.map((scene, index) => (
          <button
            type="button"
            key={scene.id}
            className={cn(
              'rounded-md border px-3 py-2 text-left text-xs transition-colors',
              position.scene.id === scene.id ? 'border-primary bg-primary/5 font-semibold' : 'bg-background',
            )}
            onClick={() => seek(featureDemoSceneStart(index))}
          >
            {l.scenes[scene.id].title}
          </button>
        ))}
      </div>

      <div className="grid gap-2">
        <canvas
          ref={canvasRef}
          width={FEATURE_DEMO_PREVIEW_WIDTH}
          height={FEATURE_DEMO_PREVIEW_HEIGHT}
          aria-label={l.previewAria}
          className="aspect-video w-full rounded-lg border bg-muted shadow-overlay"
        />
        <Slider
          value={[time]}
          min={0}
          max={FEATURE_DEMO_DURATION_SECONDS}
          step={1 / 30}
          aria-label={l.timelineAria}
          aria-valuetext={`${formatTime(time)} / ${formatTime(FEATURE_DEMO_DURATION_SECONDS)}`}
          onValueChange={([value]) => seek(value ?? 0)}
        />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{l.scenes[position.scene.id].title}</span>
          <span>
            {formatTime(time)} / {formatTime(FEATURE_DEMO_DURATION_SECONDS)}
          </span>
        </div>
      </div>

      {exporting && (
        <div className="grid gap-2 rounded-md border bg-background p-3">
          <div className="flex items-center justify-between text-xs font-medium">
            <span>{l.exporting}</span>
            <span>{Math.round(exportProgress * 100)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary" style={{ width: `${exportProgress * 100}%` }} />
          </div>
        </div>
      )}
    </section>
  );
}
