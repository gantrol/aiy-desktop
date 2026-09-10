import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useElementFullscreen } from '@/renderer/hooks/useElementFullscreen';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Slider } from '@/renderer/components/ui/slider';
import { useI18n } from '@/renderer/i18n/useI18n';
import { recordRendererDiagnostic } from '@/renderer/lib/rendererDiagnostics';
import { useDemoLoadDiagnostics } from '@/renderer/features/extensions/feature-demo/v050/useDemoLoadDiagnostics';
import { demoMedia } from '@/renderer/features/extensions/feature-demo/v050/demoMedia';
import { demoWorkspaceCamera } from '@/renderer/features/extensions/feature-demo/v050/demoWorkspaceScene';
import { DemoPlaybackControls } from '@/renderer/features/extensions/feature-demo/v050/DemoPlaybackControls';
import { DemoOutro } from '@/renderer/features/extensions/feature-demo/v050/DemoOutro';
import { DemoPointer } from '@/renderer/features/extensions/feature-demo/v050/DemoPointer';
import {
  DEMO_CHANNEL,
  demoRoles,
  demoTargets,
  demoWindowUrl,
  type DemoHostMessage,
  type DemoRole,
  type DemoWindowMessage,
} from '@/renderer/features/extensions/feature-demo/v050/demoProtocol';
import {
  between,
  full,
  screen,
  note,
  paper,
  rect,
  projection,
  mixQuad,
} from '@/renderer/features/extensions/feature-demo/v050/demoProjection';
import {
  demoDefaultTargets,
  demoDesktopLayout,
  demoDesktopScene,
} from '@/renderer/features/extensions/feature-demo/v050/demoDesktopScene';
import {
  DEMO_DURATION,
  DEMO_FPS,
  DEMO_HEIGHT,
  DEMO_WIDTH,
  demoCues,
  demoChapters,
  demoChapterAt,
  demoCollectedAt,
  demoFrameTime,
} from '@/renderer/features/extensions/feature-demo/v050/demoTimeline';

// Remounting on language change gives each set of subframes a fresh token and readiness state.
export function DemoV050Showcase({ active }: { active: boolean }) {
  const { locale } = useI18n();
  const [attempt, setAttempt] = useState(0);
  return (
    <DemoV050Session key={`${locale}:${attempt}`} active={active} onRetry={() => setAttempt((value) => value + 1)} />
  );
}

function useDemoPlayback(active: boolean) {
  const [token] = useState(() => crypto.randomUUID());
  const frames = useRef<Partial<Record<DemoRole, HTMLIFrameElement>>>({});
  const viewport = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const currentTime = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [scale, setScale] = useState(1);
  const [targets, setTargets] = useState(demoDefaultTargets);
  const [ready, setReady] = useState({ note: false, petal: false, flower: false, workspace: false, media: false });
  const [motionReady, setMotionReady] = useState(false);
  const [outroReady, setOutroReady] = useState(false);
  const { failed, fail, reportReady } = useDemoLoadDiagnostics(token, currentTime);
  const [slow, setSlow] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  const pending = Object.entries(ready)
    .filter(([, loaded]) => !loaded)
    .map(([resource]) => resource);
  if (time >= demoCues.motionResult && !motionReady) pending.push('motion');
  if (time >= demoCues.motionHold && !outroReady) pending.push('outro');
  const pendingKey = pending.join(',');
  const readyToPlay = pending.length === 0 && !failed;
  const mediaReady = useCallback(() => {
    setReady((current) => (current.media ? current : { ...current, media: true }));
    reportReady('media');
  }, [reportReady]);
  const outroLoaded = useCallback(
    (loaded: boolean) => {
      setOutroReady(loaded);
      if (loaded) reportReady('outro');
    },
    [reportReady],
  );
  const send = useCallback(
    (time: number) => {
      for (const role of ['flower', 'workspace'] as const) {
        const message: DemoHostMessage = {
          channel: DEMO_CHANNEL,
          token,
          role,
          type: 'snapshot',
          time,
          collected: demoCollectedAt(time),
        };
        frames.current[role]?.contentWindow?.postMessage(message, '*');
      }
    },
    [token],
  );

  const requestStatus = useCallback(
    (role: DemoRole) => {
      const target = frames.current[role]?.contentWindow;
      if (!target) return;
      const snapshot: DemoHostMessage = {
        channel: DEMO_CHANNEL,
        token,
        role,
        type: 'snapshot',
        time: currentTime.current,
        collected: demoCollectedAt(currentTime.current),
      };
      const request: DemoHostMessage = { channel: DEMO_CHANNEL, token, role, type: 'status-request' };
      target.postMessage(snapshot, '*');
      target.postMessage(request, '*');
    },
    [token],
  );

  useEffect(() => {
    const receive = (event: MessageEvent<DemoWindowMessage>) => {
      const data = event.data;
      if (data?.channel !== DEMO_CHANNEL || data.token !== token || !demoRoles.includes(data.role)) return;
      const source = frames.current[data.role]?.contentWindow;
      if (!source || event.source !== source) return;
      if (data.type === 'ready') {
        setReady((current) => (current[data.role] ? current : { ...current, [data.role]: true }));
        reportReady(data.role);
        send(currentTime.current);
      }
      if (data.type === 'failed') fail(data.role);
      if (data.type === 'motion-ready' && data.role === 'workspace') {
        setMotionReady(true);
        reportReady('motion');
      }
      if (
        data.type === 'target' &&
        demoTargets.includes(data.target) &&
        (data.role === 'workspace' ? !demoRoles.includes(data.target as DemoRole) : data.target === data.role) &&
        Array.isArray(data.point) &&
        data.point.length === 2 &&
        data.point.every(Number.isFinite)
      ) {
        const frame = frames.current[data.role];
        if (
          !frame ||
          data.point[0] < 0 ||
          data.point[0] > frame.clientWidth ||
          data.point[1] < 0 ||
          data.point[1] > frame.clientHeight
        )
          return;
        setTargets((current) => ({ ...current, [data.target]: data.point }));
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [token, send, fail, reportReady]);

  useEffect(() => {
    setSlow(false);
    if (!pendingKey || failed || !active || !visible) return;
    const resources = pendingKey.split(',');
    const ask = () => {
      for (const role of demoRoles) {
        if (resources.includes(role) || (role === 'workspace' && resources.includes('motion'))) requestStatus(role);
      }
      if (video.current && video.current.readyState >= 2) mediaReady();
    };
    ask();
    const retry = setInterval(ask, 1_000);
    const timer = setTimeout(() => {
      setSlow(true);
      recordRendererDiagnostic('demo-load-slow', {
        sessionId: token,
        demoResources: resources,
        demoTime: currentTime.current,
        durationMs: 20_000,
      });
    }, 20_000);
    return () => {
      clearTimeout(timer);
      clearInterval(retry);
    };
  }, [pendingKey, failed, active, visible, requestStatus, mediaReady, token]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const update = () => setScale(Math.min(element.clientWidth / DEMO_WIDTH, element.clientHeight / DEMO_HEIGHT));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const seek = useCallback(
    (next: number) => {
      const value = demoFrameTime(next);
      setPlaying(false);
      currentTime.current = value;
      setTime(value);
      send(value);
      if (video.current?.readyState) video.current.currentTime = Math.min(value, demoCues.paperEnd - 1 / DEMO_FPS);
    },
    [send],
  );

  const togglePlayback = () => {
    if (!readyToPlay) return;
    if (time >= DEMO_DURATION) {
      seek(0);
      setPlaying(true);
    } else setPlaying((value) => !value);
  };

  useEffect(() => {
    const clip = video.current;
    if (!playing || !active || !readyToPlay) {
      clip?.pause();
      return;
    }
    let live = true;
    if (clip && currentTime.current < demoCues.paperEnd) {
      clip.currentTime = currentTime.current;
      void clip.play().catch((reason: unknown) => {
        if (!live) return;
        if (reason instanceof DOMException && reason.name === 'AbortError') setPlaying(false);
        else fail('playback');
      });
    }
    const start = performance.now() - currentTime.current * 1000;
    let frame = 0;
    const tick = (now: number) => {
      const next = Math.min(DEMO_DURATION, Math.floor(((now - start) * DEMO_FPS) / 1000) / DEMO_FPS);
      if (next !== currentTime.current) {
        send(next);
        currentTime.current = next;
        setTime(next);
        if (next >= demoCues.paperEnd) clip?.pause();
      }
      if (next < DEMO_DURATION) frame = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      clip?.pause();
    };
  }, [playing, active, readyToPlay, send, fail]);

  useEffect(() => {
    if (!active || failed) setPlaying(false);
    const pauseWhenHidden = () => {
      setVisible(!document.hidden);
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden);
  }, [active, failed]);

  return {
    token,
    frames,
    viewport,
    video,
    time,
    currentTime,
    playing,
    setPlaying,
    scale,
    targets,
    readyToPlay,
    mediaReady,
    failed,
    slow,
    fail,
    outroLoaded,
    requestStatus,
    seek,
    togglePlayback,
  };
}

function DemoV050Session({ active, onRetry }: { active: boolean; onRetry(): void }) {
  const { locale, messages } = useI18n();
  const copy = messages.extensions.featureDemo;
  const labels = copy.v050;
  const {
    token,
    frames,
    viewport,
    video,
    time,
    currentTime,
    playing,
    setPlaying,
    scale,
    targets,
    readyToPlay,
    mediaReady,
    failed,
    slow,
    fail,
    outroLoaded,
    requestStatus,
    seek,
    togglePlayback,
  } = useDemoPlayback(active);
  const { fullscreen, targetRef, toggleFullscreen } = useElementFullscreen<HTMLElement>();
  const outroFailed = useCallback(() => fail('outro'), [fail]);
  const camera = between(time, demoCues.handExit, demoCues.cameraEnd);
  const scene = demoDesktopScene(time, targets);
  const workspaceCamera = demoWorkspaceCamera(time, targets);
  const chapter = demoChapterAt(time);
  const cover =
    time < demoCues.cut
      ? between(time, demoCues.handEnter, demoCues.cut)
      : 1 - between(time, demoCues.cut, demoCues.handExit);
  const iframe = (role: DemoRole) => (
    <iframe
      ref={(element) => {
        if (element) frames.current[role] = element;
        else delete frames.current[role];
      }}
      src={demoWindowUrl(role, token, locale)}
      title={
        role === 'workspace'
          ? messages.creator.workbench.creationModeImage
          : role === 'flower'
            ? messages.desktopPetals.flower.title
            : messages.desktopPetals.note.title
      }
      tabIndex={-1}
      className="pointer-events-none size-full border-0"
      onLoad={() => requestStatus(role)}
      onError={() => fail(role)}
    />
  );

  return (
    <section
      ref={targetRef}
      className={cn(
        'grid gap-3',
        fullscreen && 'fixed inset-0 z-fullscreen flex h-dvh w-dvw flex-col bg-background p-3',
      )}
      aria-label={labels.title}
    >
      <DemoPlaybackControls
        ready={readyToPlay}
        playing={playing}
        time={time}
        onToggle={togglePlayback}
        onReplay={() => {
          seek(0);
          setPlaying(true);
        }}
        onSeek={seek}
        fullscreen={fullscreen}
        onFullscreen={() => void toggleFullscreen()}
      />
      {(failed || (slow && !readyToPlay)) && (
        <div className="flex items-center gap-3">
          <span role={failed ? 'alert' : 'status'} className="text-sm text-destructive">
            {failed ? labels.loadFailed : labels.loadSlow}
          </span>
          {(failed || (slow && !readyToPlay)) && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              {messages.app.retry}
            </Button>
          )}
        </div>
      )}
      <div
        ref={viewport}
        tabIndex={0}
        className={cn(
          'relative aspect-video w-full overflow-hidden bg-media-surround-light outline-none focus-visible:ring-2 focus-visible:ring-ring',
          fullscreen && 'min-h-0 flex-1 basis-0',
        )}
        aria-label={copy.previewAria}
        aria-keyshortcuts="Space ArrowLeft ArrowRight Home"
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || !readyToPlay) return;
          if (![' ', 'ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
          event.preventDefault();
          if (event.key === ' ') togglePlayback();
          if (event.key === 'ArrowLeft') seek(time - 5);
          if (event.key === 'ArrowRight') seek(time + 5);
          if (event.key === 'Home') seek(0);
        }}
      >
        <div
          className="absolute left-1/2 top-1/2 origin-top-left overflow-hidden"
          style={{
            width: DEMO_WIDTH,
            height: DEMO_HEIGHT,
            transform: `translate(${(-DEMO_WIDTH * scale) / 2}px, ${(-DEMO_HEIGHT * scale) / 2}px) scale(${scale})`,
            colorScheme: 'light',
          }}
        >
          <div
            className="absolute inset-0 origin-top-left"
            style={{ transform: projection(screen, mixQuad(screen, full, camera)) }}
          >
            <img
              src={time < demoCues.cut ? demoMedia.settled : demoMedia.monitor}
              alt=""
              className="absolute inset-0 size-full"
              draggable={false}
              onError={() => fail('backdrop')}
            />
            <video
              ref={video}
              src={demoMedia.opening}
              poster={demoMedia.first}
              muted
              playsInline
              preload="auto"
              className="absolute inset-0 size-full"
              style={{ visibility: time < demoCues.paperEnd ? 'visible' : 'hidden' }}
              onLoadedData={() => {
                mediaReady();
                if (video.current)
                  video.current.currentTime = Math.min(currentTime.current, demoCues.paperEnd - 1 / DEMO_FPS);
              }}
              onError={() => fail('opening')}
            />
            <div
              className="absolute inset-0 origin-top-left"
              style={{ transform: projection(full, screen), visibility: time >= demoCues.cut ? 'visible' : 'hidden' }}
            >
              <div
                className="absolute left-0 top-0 origin-top-left"
                style={{
                  width: demoDesktopLayout.note.width,
                  height: demoDesktopLayout.note.height,
                  transform: projection(rect(410, 455), mixQuad(paper, note, camera)),
                  visibility: time < demoCues.collapsed ? 'inherit' : 'hidden',
                }}
              >
                <div
                  className="size-full origin-top-left"
                  style={{
                    opacity: 1 - scene.noteClose,
                    transform: `translateY(${3 * scene.noteClose}px) scale(${1 - 0.03 * scene.noteClose})`,
                  }}
                >
                  {iframe('note')}
                </div>
              </div>
              <div
                className="absolute h-56 w-56 origin-top-left"
                style={{
                  left: demoDesktopLayout.flower.x,
                  top: demoDesktopLayout.flower.y,
                  opacity: camera,
                  transform: `scale(${demoDesktopLayout.flower.scale})`,
                }}
              >
                {iframe('flower')}
              </div>
              <div
                className="absolute size-28 origin-top-left"
                style={{
                  left: scene.petalPosition[0],
                  top: scene.petalPosition[1],
                  transform: `scale(${demoDesktopLayout.petal.scale})`,
                  visibility: scene.petalVisible ? 'inherit' : 'hidden',
                }}
              >
                {iframe('petal')}
              </div>
            </div>
            {cover > 0 && (
              <img
                src={demoMedia.hand}
                alt=""
                className="pointer-events-none absolute inset-0 size-full"
                style={{ transform: `translate(${-1150 * (1 - cover)}px, ${800 * (1 - cover)}px)` }}
                draggable={false}
                onError={() => fail('hand')}
              />
            )}
          </div>
          <div
            className="absolute inset-0 origin-top-left"
            style={{
              visibility: time >= demoCues.menuOpen ? 'visible' : 'hidden',
              transform: workspaceCamera.transform,
            }}
          >
            {iframe('workspace')}
          </div>
          {time >= demoCues.cursorStart && <DemoPointer scene={scene} />}
          {time >= demoCues.gifWorkspace && (
            <DemoOutro time={time - demoCues.motionHold} onReady={outroLoaded} onError={outroFailed} />
          )}
        </div>
      </div>
      <Slider
        value={[time]}
        min={0}
        max={DEMO_DURATION}
        step={1 / DEMO_FPS}
        disabled={!readyToPlay}
        aria-label={copy.timelineAria}
        onValueChange={([value]) => seek(value ?? 0)}
      />
      <nav className="flex flex-wrap gap-1" aria-label={labels.chapters}>
        {demoChapters.map((item) => (
          <Button
            key={item.id}
            size="sm"
            disabled={!readyToPlay}
            variant={item.id === chapter.id ? 'secondary' : 'ghost'}
            onClick={() => seek(item.start)}
          >
            {labels.scenes[item.id]}
          </Button>
        ))}
      </nav>
    </section>
  );
}
