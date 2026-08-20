import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import type {
  LocalSpaceTransitionEvent,
  TransitionPreviewDto,
  TransitionPreviewRefreshEvent,
} from '@/shared/contracts/local-space';
import {
  TransitionPreviewMedia,
  clampTransitionPreviewAspect,
  type TransitionPreviewMediaState,
} from '@/renderer/components/app/TransitionPreviewMedia';
import { useI18n } from '@/renderer/i18n/useI18n';
import './AppLoadingState.css';

const FILM_STRIP_COUNT = 2;
const FRAMES_PER_FILM_STRIP = 12;
const MAX_PREVIEW_COUNT = FILM_STRIP_COUNT * FRAMES_PER_FILM_STRIP;
const FILM_SCROLL_SPEED_PX_PER_SECOND = 28;
const DEFAULT_FILM_SCROLL_DURATION_MS = 89_000;
// A 13rem frame pitch and 1.625rem perforation pitch keep exactly eight perforations beside every frame.
const POLAROID_CARD_COUNT = 5;
const POLAROID_PREVIEW_SLOT_ORDER = [4, 2, 0, 1, 3] as const;
const POLAROID_CARD_SCALES = [0.8, 0.95, 1.12, 0.95, 0.8] as const;
const PLACEHOLDER_ASPECTS = [0.75, 0.5625, 1, 0.8, 1.5, 0.6667, 1.7778, 0.75] as const;
const FILM_STRIP_CLASSES = [
  'app-loading-filmstrip app-loading-filmstrip-primary absolute -inset-y-48 left-[30%] z-[2] w-48 -translate-x-1/2 rotate-[4deg] overflow-hidden rounded-none drop-shadow-sm',
  'app-loading-filmstrip app-loading-filmstrip-secondary absolute -inset-y-48 left-[70%] z-[1] w-48 -translate-x-1/2 -rotate-[4deg] scale-[0.875] overflow-hidden rounded-none drop-shadow-sm',
] as const;
export type AppLoadingVariant = 'portrait' | 'ribbon';

export interface TransitionSceneMotion {
  paused?: boolean;
  reduced?: boolean;
  replayKey?: number;
  speedMultiplier?: number;
}

export type TransitionSceneMediaState = TransitionPreviewMediaState;

interface Props {
  previews: readonly TransitionPreviewDto[];
  variant?: AppLoadingVariant;
  motion?: TransitionSceneMotion;
}

interface LoadingPreviews {
  spaceId: string | null;
  items: TransitionPreviewDto[];
}

interface FilmFrameModel {
  key: string;
  preview: TransitionPreviewDto | null;
}

type PreviewStyle = CSSProperties & Record<`--${string}`, string | number>;

function readDefaultLoadingVariant(): AppLoadingVariant {
  if (typeof document === 'undefined') return 'portrait';
  return document.documentElement.dataset.appLoadingVariant === 'ribbon' ? 'ribbon' : 'portrait';
}

export const DEFAULT_APP_LOADING_VARIANT = readDefaultLoadingVariant();

function readAppLoadingVariants() {
  const serialized = typeof document === 'undefined' ? '' : document.documentElement.dataset.appLoadingVariants;
  const bits = serialized && /^[01]{6}$/.test(serialized) ? serialized : null;
  const variantAt = (index: number): AppLoadingVariant => (bits?.[index] === '1' ? 'ribbon' : 'portrait');
  return {
    creator: DEFAULT_APP_LOADING_VARIANT,
    documents: DEFAULT_APP_LOADING_VARIANT,
    dictionary: variantAt(1),
    gallery: variantAt(2),
    codexImages: variantAt(3),
    transitionShowcase: DEFAULT_APP_LOADING_VARIANT,
    packs: variantAt(4),
    aiCenter: variantAt(5),
  } as const;
}

export const APP_LOADING_VARIANTS = Object.freeze(readAppLoadingVariants());

export { clampTransitionPreviewAspect };

export function normalizeLoadingPreviews(previews: readonly TransitionPreviewDto[]) {
  const normalized: TransitionPreviewDto[] = [];
  const urls = new Set<string>();
  for (const preview of previews) {
    const detailUrl = preview.detailUrl ?? preview.url;
    if (
      !preview.url.startsWith('aiy-media://space-preview/') ||
      !detailUrl.startsWith('aiy-media://space-preview/') ||
      urls.has(preview.url) ||
      !Number.isInteger(preview.width) ||
      !Number.isInteger(preview.height) ||
      preview.width <= 0 ||
      preview.height <= 0
    ) {
      continue;
    }
    urls.add(preview.url);
    normalized.push({ ...preview, detailUrl });
    if (normalized.length === MAX_PREVIEW_COUNT) break;
  }
  return normalized;
}

function sameLoadingPreviews(left: readonly TransitionPreviewDto[], right: readonly TransitionPreviewDto[]) {
  return (
    left.length === right.length &&
    left.every(
      (preview, index) =>
        preview.url === right[index]?.url &&
        (preview.detailUrl ?? preview.url) === (right[index]?.detailUrl ?? right[index]?.url) &&
        preview.width === right[index]?.width &&
        preview.height === right[index]?.height,
    )
  );
}

function refreshedLoadingPreviews(previews: readonly TransitionPreviewDto[], revision: number) {
  return normalizeLoadingPreviews(previews).map((preview) => ({
    ...preview,
    // A repaired cache entry can keep the same content-derived URL. Give the
    // media element a new identity only after main confirms the cache refresh,
    // so a previous terminal error is retried without polling or eager loads.
    url: `${preview.url}${preview.url.includes('?') ? '&' : '?'}availability=${revision}`,
    detailUrl: `${preview.detailUrl ?? preview.url}${(preview.detailUrl ?? preview.url).includes('?') ? '&' : '?'}availability=${revision}`,
  }));
}

export function useAppLoadingPreviews() {
  const [loadingPreviews, setLoadingPreviews] = useState<LoadingPreviews>({ spaceId: null, items: [] });
  const loadingPreviewsRef = useRef(loadingPreviews);
  const loadingPreviewRevisionRef = useRef(0);
  const loadingPreviewRequestedRef = useRef(false);
  const preTransitionLoadingPreviewsRef = useRef<LoadingPreviews | null>(null);

  const commit = useCallback((next: LoadingPreviews) => {
    loadingPreviewsRef.current = next;
    setLoadingPreviews((current) =>
      current.spaceId === next.spaceId && sameLoadingPreviews(current.items, next.items) ? current : next,
    );
  }, []);

  const requestInitial = useCallback(() => {
    if (loadingPreviewRequestedRef.current) return;
    loadingPreviewRequestedRef.current = true;
    const previewRevision = loadingPreviewRevisionRef.current;
    void window.desktopApi
      .appLoadingPreviews()
      .then((previews) => {
        if (loadingPreviewRevisionRef.current !== previewRevision) return;
        commit({ spaceId: null, items: normalizeLoadingPreviews(previews) });
      })
      .catch(() => undefined);
  }, [commit]);

  const applyTransition = useCallback(
    (transition: LocalSpaceTransitionEvent) => {
      loadingPreviewRevisionRef.current += 1;
      if (transition.phase === 'FAILED') {
        const previous = preTransitionLoadingPreviewsRef.current;
        preTransitionLoadingPreviewsRef.current = null;
        if (previous) commit(previous);
        return;
      }
      const next = {
        spaceId: transition.space.id,
        items: normalizeLoadingPreviews(transition.previews),
      };
      if (transition.phase === 'STARTING') preTransitionLoadingPreviewsRef.current = loadingPreviewsRef.current;
      if (transition.phase === 'COMPLETED') preTransitionLoadingPreviewsRef.current = null;
      commit(next);
    },
    [commit],
  );

  const applyRefresh = useCallback(
    (event: TransitionPreviewRefreshEvent) => {
      const current = loadingPreviewsRef.current;
      if (current.spaceId !== null && current.spaceId !== event.spaceId) return;
      const revision = ++loadingPreviewRevisionRef.current;
      commit({ spaceId: event.spaceId, items: refreshedLoadingPreviews(event.previews, revision) });
    },
    [commit],
  );

  useEffect(() => window.desktopApi.onAppLoadingPreviewsRefreshed(applyRefresh), [applyRefresh]);

  return { previews: loadingPreviews.items, requestInitial, applyTransition };
}

export function AppLoadingBoundary({
  children,
  previews,
  variant,
}: {
  children: ReactNode;
  previews: readonly TransitionPreviewDto[];
  variant: AppLoadingVariant;
}) {
  return <Suspense fallback={<AppLoadingState previews={previews} variant={variant} />}>{children}</Suspense>;
}

function useNearViewport(
  ref: RefObject<HTMLElement | null>,
  identity: string,
  preloadRoot?: RefObject<HTMLElement | null>,
  loadImmediately = false,
) {
  // Admission is keyed by URL instead of reset in an effect. Cached and data
  // URLs can finish before passive effects run, so a reset can overwrite load.
  const [requestedIdentity, setRequestedIdentity] = useState<string | null>(null);
  const requested = loadImmediately || requestedIdentity === identity;

  useEffect(() => {
    const element = ref.current;
    if (!element || requested) return;
    if (typeof IntersectionObserver === 'undefined') {
      setRequestedIdentity(identity);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setRequestedIdentity(identity);
        observer.disconnect();
      },
      { root: preloadRoot?.current ?? null, rootMargin: '100% 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, requested, identity, preloadRoot]);

  return requested;
}

function LazyTransitionPreview({
  preview,
  mediaState = 'ready',
  preloadRoot,
  loadImmediately = false,
  imageClassName = 'object-contain',
}: {
  preview: TransitionPreviewDto;
  mediaState?: TransitionSceneMediaState;
  preloadRoot?: RefObject<HTMLElement | null>;
  loadImmediately?: boolean;
  imageClassName?: string;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const identity = `${preview.url}\0${preview.detailUrl ?? preview.url}`;
  const requested = useNearViewport(hostRef, identity, preloadRoot, loadImmediately);
  return (
    <TransitionPreviewMedia
      ref={hostRef}
      preview={preview}
      requested={requested}
      mediaState={mediaState}
      className="app-loading-preview-host z-[1] block"
      imageClassName={imageClassName}
    />
  );
}

function buildFilmFrames(previews: readonly TransitionPreviewDto[], stripIndex: number) {
  const frames = previews
    .filter((_, index) => index % FILM_STRIP_COUNT === stripIndex)
    .slice(0, FRAMES_PER_FILM_STRIP)
    .map((preview, index): FilmFrameModel => ({
      key: `${stripIndex}-preview-${index}-${preview.url}-${preview.detailUrl ?? preview.url}`,
      preview,
    }));
  while (frames.length < FRAMES_PER_FILM_STRIP) {
    const index = frames.length;
    frames.push({
      key: `${stripIndex}-placeholder-${index}`,
      preview: null,
    });
  }
  return frames;
}

function FilmFrame({
  frame,
  rootRef,
  duplicate,
  mediaState,
  loadAllPreviews,
}: {
  frame: FilmFrameModel;
  rootRef: RefObject<HTMLSpanElement | null>;
  duplicate: boolean;
  mediaState: TransitionSceneMediaState;
  loadAllPreviews: boolean;
}) {
  return (
    <span className="relative z-[2] flex h-52 shrink-0 items-center justify-center">
      <span
        className="app-loading-aperture relative block aspect-[2/3] w-32 flex-none overflow-hidden rounded-none bg-media-surround-dark"
        data-loading-preview={frame.preview ? (mediaState === 'ready' ? 'image' : mediaState) : 'abstract'}
      >
        {frame.preview && (
          <LazyTransitionPreview
            preview={frame.preview}
            mediaState={mediaState}
            preloadRoot={rootRef}
            loadImmediately={loadAllPreviews}
            imageClassName="object-cover"
            key={`${duplicate}-${frame.preview.url}-${frame.preview.detailUrl ?? frame.preview.url}`}
          />
        )}
      </span>
    </span>
  );
}

function FilmStrip({
  index,
  previews,
  motion,
  mediaState,
  loadAllPreviews,
}: {
  index: number;
  previews: readonly TransitionPreviewDto[];
  motion: TransitionSceneMotion;
  mediaState: TransitionSceneMediaState;
  loadAllPreviews: boolean;
}) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const groupRef = useRef<HTMLSpanElement>(null);
  const frames = buildFilmFrames(previews, index);
  const speed = FILM_SCROLL_SPEED_PX_PER_SECOND * Math.max(0.25, motion.speedMultiplier ?? 1);
  const [durationMs, setDurationMs] = useState(DEFAULT_FILM_SCROLL_DURATION_MS);

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const measure = () => setDurationMs(Math.max(8_000, Math.round((group.scrollHeight / speed) * 1000)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    return () => observer.disconnect();
  }, [speed, previews]);

  const trackStyle = {
    '--film-scroll-duration': `${durationMs}ms`,
    '--film-scroll-delay': `${index === 0 ? 0 : Math.round(-durationMs / (FRAMES_PER_FILM_STRIP * 2))}ms`,
  } as PreviewStyle;

  return (
    <span ref={viewportRef} className={FILM_STRIP_CLASSES[index]}>
      <span className="app-loading-filmstrip-clip absolute inset-0 block overflow-hidden">
        <span
          key={motion.replayKey ?? 0}
          className={`app-loading-aperture-track app-loading-aperture-track-${index === 0 ? 'up' : 'down'} absolute inset-x-0 top-0 flex flex-col will-change-transform`}
          style={trackStyle}
        >
          {[false, true].map((duplicate) => (
            <span
              ref={duplicate ? undefined : groupRef}
              className="app-loading-aperture-group app-loading-film-segment relative isolate flex w-full shrink-0 flex-col overflow-hidden bg-media-surround-dark/95"
              aria-hidden={duplicate ? 'true' : undefined}
              key={duplicate ? 'duplicate' : 'original'}
            >
              {frames.map((frame) => (
                <FilmFrame
                  frame={frame}
                  rootRef={viewportRef}
                  duplicate={duplicate}
                  mediaState={mediaState}
                  loadAllPreviews={loadAllPreviews}
                  key={`${duplicate}-${frame.key}`}
                />
              ))}
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

export function PortraitFilmScene({
  previews,
  motion = {},
  mediaState = 'ready',
  loadAllPreviews = false,
}: {
  previews: readonly TransitionPreviewDto[];
  motion?: TransitionSceneMotion;
  mediaState?: TransitionSceneMediaState;
  loadAllPreviews?: boolean;
}) {
  return (
    <span
      className="app-loading-scene relative block size-full"
      data-motion-paused={motion.paused ? 'true' : undefined}
      data-reduced-motion={motion.reduced ? 'true' : undefined}
      aria-hidden="true"
    >
      <span
        data-transition-showcase-export-backdrop
        className="app-loading-aura absolute left-1/2 top-1/2 h-[28rem] w-[32rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-selected opacity-50 blur-[4rem]"
      />
      {Array.from({ length: FILM_STRIP_COUNT }, (_, index) => (
        <FilmStrip
          index={index}
          previews={previews}
          motion={motion}
          mediaState={mediaState}
          loadAllPreviews={loadAllPreviews}
          key={index}
        />
      ))}
    </span>
  );
}

function polaroidFrameAt(previews: readonly TransitionPreviewDto[], cardIndex: number) {
  const preview = previews[POLAROID_PREVIEW_SLOT_ORDER[cardIndex]] ?? null;
  return {
    preview,
    aspect: preview
      ? clampTransitionPreviewAspect(preview.width, preview.height)
      : PLACEHOLDER_ASPECTS[(cardIndex + 2) % PLACEHOLDER_ASPECTS.length]!,
  };
}

export function PolaroidScene({
  previews,
  motion = {},
  mediaState = 'ready',
}: {
  previews: readonly TransitionPreviewDto[];
  motion?: TransitionSceneMotion;
  mediaState?: TransitionSceneMediaState;
}) {
  const frames = Array.from({ length: POLAROID_CARD_COUNT }, (_, index) => polaroidFrameAt(previews, index));
  const speedMultiplier = Math.max(0.25, motion.speedMultiplier ?? 1);
  const sceneStyle = {
    '--polaroid-drift-duration': `${6.4 / speedMultiplier}s`,
    '--polaroid-focus-duration': `${2.4 / speedMultiplier}s`,
  } as PreviewStyle;
  return (
    <span
      className="app-loading-polaroid-scene"
      data-motion-paused={motion.paused ? 'true' : undefined}
      data-reduced-motion={motion.reduced ? 'true' : undefined}
      style={sceneStyle}
      aria-hidden="true"
    >
      <span data-transition-showcase-export-backdrop className="app-loading-polaroid-aura" />
      <span className="app-loading-polaroid-stage" key={motion.replayKey ?? 0}>
        <span className="app-loading-polaroid-spread">
          {frames.map(({ preview, aspect }, cardIndex) => (
            <span
              className={`app-loading-polaroid-card app-loading-polaroid-card-${cardIndex}`}
              style={
                {
                  '--preview-aspect': aspect,
                  '--polaroid-card-weight': aspect * POLAROID_CARD_SCALES[cardIndex]!,
                } as PreviewStyle
              }
              key={cardIndex}
            >
              <span
                className="app-loading-polaroid-aperture"
                data-loading-preview={preview ? (mediaState === 'ready' ? 'image' : mediaState) : 'abstract'}
              >
                {preview && <LazyTransitionPreview preview={preview} mediaState={mediaState} />}
                {cardIndex === 2 && <span className="app-loading-polaroid-focus" />}
              </span>
              <span className="app-loading-polaroid-footer">
                <span />
                <span />
              </span>
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

export function AppLoadingState({ previews, variant = DEFAULT_APP_LOADING_VARIANT, motion = {} }: Props) {
  const { messages } = useI18n();
  const normalizedPreviews = normalizeLoadingPreviews(previews);
  return (
    <div
      data-app-loading-state
      data-app-loading-variant={variant}
      data-preview-count={normalizedPreviews.length}
      className="grid size-full place-items-center overflow-hidden bg-background"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      {variant === 'ribbon' ? (
        <PolaroidScene previews={normalizedPreviews} motion={motion} />
      ) : (
        <PortraitFilmScene previews={normalizedPreviews} motion={motion} />
      )}
      <span className="sr-only">{messages.app.loading}</span>
    </div>
  );
}
