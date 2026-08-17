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

const FILM_STRIP_COUNT = 2;
const FRAMES_PER_FILM_STRIP = 12;
const MAX_PREVIEW_COUNT = FILM_STRIP_COUNT * FRAMES_PER_FILM_STRIP;
const POLAROID_CARD_COUNT = 5;
const POLAROID_PREVIEW_SLOT_ORDER = [4, 2, 0, 1, 3] as const;
const POLAROID_CARD_SCALES = [0.8, 0.95, 1.12, 0.95, 0.8] as const;
const PLACEHOLDER_ASPECTS = [0.75, 0.5625, 1, 0.8, 1.5, 0.6667, 1.7778, 0.75] as const;
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
  aspect: number;
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
) {
  // Admission is keyed by URL instead of reset in an effect. Cached and data
  // URLs can finish before passive effects run, so a reset can overwrite load.
  const [requestedIdentity, setRequestedIdentity] = useState<string | null>(null);
  const requested = requestedIdentity === identity;

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
}: {
  preview: TransitionPreviewDto;
  mediaState?: TransitionSceneMediaState;
  preloadRoot?: RefObject<HTMLElement | null>;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const identity = `${preview.url}\0${preview.detailUrl ?? preview.url}`;
  const requested = useNearViewport(hostRef, identity, preloadRoot);
  return (
    <TransitionPreviewMedia
      ref={hostRef}
      preview={preview}
      requested={requested}
      mediaState={mediaState}
      className="app-loading-preview-host z-[1] block"
      imageClassName="object-contain"
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
      aspect: clampTransitionPreviewAspect(preview.width, preview.height),
    }));
  while (frames.length < FRAMES_PER_FILM_STRIP) {
    const index = frames.length;
    frames.push({
      key: `${stripIndex}-placeholder-${index}`,
      preview: null,
      aspect: PLACEHOLDER_ASPECTS[(index + stripIndex * 3) % PLACEHOLDER_ASPECTS.length]!,
    });
  }
  return frames;
}

function useFilmFrameFocus(
  ref: RefObject<HTMLSpanElement | null>,
  rootRef: RefObject<HTMLSpanElement | null>,
  enabled: boolean,
) {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const element = ref.current;
    const root = rootRef.current;
    if (!enabled || !element || !root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setFocused(Boolean(entry?.isIntersecting)), {
      root,
      rootMargin: '-46% 0px -46% 0px',
      threshold: 0,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, ref, rootRef]);
  return focused;
}

function FilmFrame({
  frame,
  rootRef,
  focusable,
  duplicate,
  mediaState,
}: {
  frame: FilmFrameModel;
  rootRef: RefObject<HTMLSpanElement | null>;
  focusable: boolean;
  duplicate: boolean;
  mediaState: TransitionSceneMediaState;
}) {
  const frameRef = useRef<HTMLSpanElement>(null);
  const focused = useFilmFrameFocus(frameRef, rootRef, focusable);
  return (
    <span
      ref={frameRef}
      className="app-loading-aperture"
      data-loading-preview={frame.preview ? (mediaState === 'ready' ? 'image' : mediaState) : 'abstract'}
      data-film-focus={focused ? 'true' : undefined}
      style={{ '--preview-aspect': frame.aspect } as PreviewStyle}
    >
      {frame.preview && (
        <LazyTransitionPreview
          preview={frame.preview}
          mediaState={mediaState}
          preloadRoot={rootRef}
          key={`${duplicate}-${frame.preview.url}-${frame.preview.detailUrl ?? frame.preview.url}`}
        />
      )}
    </span>
  );
}

function FilmStrip({
  index,
  previews,
  motion,
  mediaState,
}: {
  index: number;
  previews: readonly TransitionPreviewDto[];
  motion: TransitionSceneMotion;
  mediaState: TransitionSceneMediaState;
}) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const groupRef = useRef<HTMLSpanElement>(null);
  const frames = buildFilmFrames(previews, index);
  const speed = (index === 0 ? 30 : 24) * Math.max(0.25, motion.speedMultiplier ?? 1);
  const [durationMs, setDurationMs] = useState(24_000);

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
  } as PreviewStyle;

  return (
    <span
      ref={viewportRef}
      className={`app-loading-filmstrip app-loading-filmstrip-${index === 0 ? 'primary' : 'secondary'}`}
    >
      <span
        key={motion.replayKey ?? 0}
        className={`app-loading-aperture-track app-loading-aperture-track-${index === 0 ? 'up' : 'down'}`}
        style={trackStyle}
      >
        {[false, true].map((duplicate) => (
          <span
            ref={duplicate ? undefined : groupRef}
            className="app-loading-aperture-group"
            aria-hidden={duplicate ? 'true' : undefined}
            key={duplicate ? 'duplicate' : 'original'}
          >
            {frames.map((frame) => (
              <FilmFrame
                frame={frame}
                rootRef={viewportRef}
                focusable={index === 0}
                duplicate={duplicate}
                mediaState={mediaState}
                key={`${duplicate}-${frame.key}`}
              />
            ))}
          </span>
        ))}
      </span>
    </span>
  );
}

export function PortraitFilmScene({
  previews,
  motion = {},
  mediaState = 'ready',
}: {
  previews: readonly TransitionPreviewDto[];
  motion?: TransitionSceneMotion;
  mediaState?: TransitionSceneMediaState;
}) {
  return (
    <span
      className="app-loading-scene"
      data-motion-paused={motion.paused ? 'true' : undefined}
      data-reduced-motion={motion.reduced ? 'true' : undefined}
      aria-hidden="true"
    >
      <span className="app-loading-aura" />
      {Array.from({ length: FILM_STRIP_COUNT }, (_, index) => (
        <FilmStrip index={index} previews={previews} motion={motion} mediaState={mediaState} key={index} />
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
      <span className="app-loading-polaroid-aura" />
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
