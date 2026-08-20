import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { DownloadIcon, PauseIcon, PlayIcon, RotateCcwIcon, SquareIcon } from 'lucide-react';
import type { BootstrapDto, ExtensionDto } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Slider } from '@/renderer/components/ui/slider';
import {
  downloadFeatureDemoVideo,
  exportFeatureDemoVideo,
} from '@/renderer/features/extensions/feature-demo/featureDemoExport';
import { FeatureDemoStage } from '@/renderer/features/extensions/feature-demo/FeatureDemoStage';
import {
  FEATURE_DEMO_PREVIEW_HEIGHT,
  FEATURE_DEMO_PREVIEW_WIDTH,
  featureDemoDuration,
  featureDemoSceneAt,
  featureDemoSceneStart,
} from '@/renderer/features/extensions/feature-demo/featureDemoTimeline';
import {
  createFeatureDemoRunPlan,
  createFeatureDemoSeed,
} from '@/renderer/features/extensions/feature-demo/featureDemoRunPlan';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

interface FeatureDemoShowcaseProps {
  data: BootstrapDto;
  extensions: readonly ExtensionDto[];
  notify(message: string): void;
}

function formatTime(seconds: number) {
  const bounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(bounded / 60);
  return `${minutes}:${String(bounded % 60).padStart(2, '0')}`;
}

function afterPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}

export function FeatureDemoShowcase({ data, extensions, notify }: FeatureDemoShowcaseProps) {
  const { messages } = useI18n();
  const l = messages.extensions.featureDemo;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [stageScale, setStageScale] = useState(1);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [plan, setPlan] = useState(() => createFeatureDemoRunPlan(data));
  const duration = featureDemoDuration(plan.scenes);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateScale = () => setStageScale(viewport.clientWidth / FEATURE_DEMO_PREVIEW_WIDTH);
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const startedAt = performance.now() - timeRef.current * 1000;
    let lastPublishedAt = 0;
    const tick = (now: number) => {
      const next = (now - startedAt) / 1000;
      if (next >= duration) {
        timeRef.current = duration;
        setTime(duration);
        setPlaying(false);
        return;
      }
      timeRef.current = next;
      if (now - lastPublishedAt >= 33) {
        lastPublishedAt = now;
        setTime(next);
      }
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };
    animationFrameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    };
  }, [duration, playing]);

  useEffect(
    () => () => {
      exportAbortRef.current?.abort();
    },
    [],
  );

  const position = featureDemoSceneAt(time, plan.scenes);
  const exporting = exportProgress !== null;

  function seek(next: number) {
    const bounded = Math.min(duration, Math.max(0, next));
    timeRef.current = bounded;
    setTime(bounded);
  }

  function stopPlayback() {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setPlaying(false);
  }

  function togglePlayback() {
    if (playing) stopPlayback();
    else setPlaying(true);
  }

  function replay() {
    setPlan(createFeatureDemoRunPlan(data, createFeatureDemoSeed()));
    seek(0);
    setPlaying(true);
  }

  function selectScene(sceneIndex: number) {
    stopPlayback();
    seek(featureDemoSceneStart(sceneIndex, plan.scenes));
  }

  function scrub(next: number) {
    stopPlayback();
    seek(next);
  }

  async function exportVideo() {
    if (exporting) {
      exportAbortRef.current?.abort();
      return;
    }
    const stage = stageRef.current;
    if (!stage) return;
    const restoreTime = timeRef.current;
    const resumePlayback = playing;
    const controller = new AbortController();
    exportAbortRef.current = controller;
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    flushSync(() => setPlaying(false));
    setExportProgress(0);
    try {
      await document.fonts.ready;
      const video = await exportFeatureDemoVideo({
        stage,
        scenes: plan.scenes,
        signal: controller.signal,
        onProgress: setExportProgress,
        renderAt: async (nextTime) => {
          flushSync(() => seek(nextTime));
          await afterPaint();
          const sceneId = featureDemoSceneAt(nextTime, plan.scenes).scene.id;
          if (sceneId === 'directoryExpand' || sceneId === 'directoryCollapse') {
            await new Promise<void>((resolve) => window.setTimeout(resolve, 320));
            await afterPaint();
          }
        },
      });
      downloadFeatureDemoVideo(video);
      notify(l.exported);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) notify(l.exportFailed);
    } finally {
      exportAbortRef.current = null;
      setExportProgress(null);
      flushSync(() => seek(restoreTime));
      if (resumePlayback) setPlaying(true);
    }
  }

  return (
    <section data-feature-demo-showcase className="grid gap-4 rounded-lg border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{l.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{formatTime(duration)} · 2560×1440 · 30 FPS</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={togglePlayback}>
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

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {plan.scenes.map((scene, index) => (
          <button
            type="button"
            key={scene.id}
            className={cn(
              'rounded-md border px-3 py-2 text-left text-xs transition-colors',
              position.scene.id === scene.id ? 'border-primary bg-primary/5 font-semibold' : 'bg-background',
            )}
            onClick={() => selectScene(index)}
          >
            {l.scenes[scene.id].title}
          </button>
        ))}
      </div>

      <div className="grid gap-2">
        <div ref={viewportRef} className="relative aspect-video w-full overflow-hidden rounded-lg border bg-muted">
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{
              width: FEATURE_DEMO_PREVIEW_WIDTH,
              height: FEATURE_DEMO_PREVIEW_HEIGHT,
              transform: `scale(${stageScale})`,
            }}
          >
            <FeatureDemoStage
              ref={stageRef}
              data={data}
              extensions={extensions}
              plan={plan}
              timeInSeconds={time}
              notify={notify}
              key={plan.seed}
            />
          </div>
        </div>
        <Slider
          value={[time]}
          min={0}
          max={duration}
          step={1 / 30}
          aria-label={l.timelineAria}
          aria-valuetext={`${formatTime(time)} / ${formatTime(duration)}`}
          onValueChange={([value]) => scrub(value ?? 0)}
        />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{l.scenes[position.scene.id].title}</span>
          <span>
            {formatTime(time)} / {formatTime(duration)}
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
