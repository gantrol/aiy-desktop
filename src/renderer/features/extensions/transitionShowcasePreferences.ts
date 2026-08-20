import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type { LocalSpaceTransitionStage } from '@/shared/contracts';
import type { TransitionSceneMediaState } from '@/renderer/components/app/AppLoadingState';
import {
  reorderMaterialImagePickerImages,
  type MaterialImagePickerCollection,
  type MaterialImagePickerImage,
} from '@/renderer/components/gallery/materialImagePicker';

export type TransitionShowcaseScene = 'portrait' | 'ribbon' | 'space';
export type TransitionShowcaseSource = 'real' | 'stress' | 'manual';
export type TransitionShowcaseAspect = 'mixed' | 'landscape' | 'portrait' | 'square' | 'extreme';
export type TransitionShowcaseViewport = 'desktop' | 'tablet' | 'mobile';
export type TransitionShowcaseSpeed = 'half' | 'normal' | 'double';

export type TransitionShowcaseCollection = MaterialImagePickerCollection;
export type TransitionShowcaseStoredImage = MaterialImagePickerImage;
export const reorderTransitionShowcaseImages = reorderMaterialImagePickerImages;

export interface TransitionShowcasePreferences {
  scene: TransitionShowcaseScene;
  source: TransitionShowcaseSource | null;
  aspect: TransitionShowcaseAspect;
  mediaState: TransitionSceneMediaState;
  viewport: TransitionShowcaseViewport;
  speed: TransitionShowcaseSpeed;
  paused: boolean;
  reduced: boolean;
  stage: LocalSpaceTransitionStage;
  progress: number;
  manualImages: TransitionShowcaseStoredImage[];
  pickerCollection: TransitionShowcaseCollection;
}

const scenes = ['portrait', 'ribbon', 'space'] as const satisfies readonly TransitionShowcaseScene[];
const sources = ['real', 'stress', 'manual'] as const satisfies readonly TransitionShowcaseSource[];
const aspects = [
  'mixed',
  'landscape',
  'portrait',
  'square',
  'extreme',
] as const satisfies readonly TransitionShowcaseAspect[];
const mediaStates = ['ready', 'loading', 'error'] as const satisfies readonly TransitionSceneMediaState[];
const viewports = ['desktop', 'tablet', 'mobile'] as const satisfies readonly TransitionShowcaseViewport[];
const speeds = ['half', 'normal', 'double'] as const satisfies readonly TransitionShowcaseSpeed[];
const stages = [
  'PREPARING',
  'OPENING_DATABASE',
  'CONNECTING_SERVICES',
  'LOADING_EXTENSIONS',
  'APPLYING_SETTINGS',
  'ACTIVATING',
  'LOADING_INTERFACE',
  'READY',
  'FAILED',
] as const satisfies readonly LocalSpaceTransitionStage[];

const storedImageSchema = z.object({
  id: z.string().min(1).max(256),
  mediaUrl: z.string().min(1).max(4096),
  width: z.number().int().positive().max(65_536),
  height: z.number().int().positive().max(65_536),
});

const collectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('album'), albumId: z.string().min(1).max(256) }),
  z.object({
    kind: z.literal('dictionary'),
    scope: z.literal('ALL'),
    domainId: z.string().min(1).max(256).optional(),
    typeId: z.string().min(1).max(256).optional(),
    termId: z.string().min(1).max(256).optional(),
  }),
]);

const storedPreferencesSchema = z
  .object({
    scene: z.enum(scenes).optional().catch(undefined),
    source: z.enum(sources).nullable().optional().catch(undefined),
    aspect: z.enum(aspects).optional().catch(undefined),
    mediaState: z.enum(mediaStates).optional().catch(undefined),
    viewport: z.enum(viewports).optional().catch(undefined),
    speed: z.enum(speeds).optional().catch(undefined),
    paused: z.boolean().optional().catch(undefined),
    reduced: z.boolean().optional().catch(undefined),
    stage: z.enum(stages).optional().catch(undefined),
    progress: z.number().int().min(0).max(100).optional().catch(undefined),
    manualImages: z.array(storedImageSchema).max(24).optional().catch(undefined),
    pickerCollection: collectionSchema.optional().catch(undefined),
  })
  .passthrough();

const defaultPreferences: TransitionShowcasePreferences = {
  scene: 'portrait',
  source: null,
  aspect: 'mixed',
  mediaState: 'ready',
  viewport: 'desktop',
  speed: 'normal',
  paused: false,
  reduced: false,
  stage: 'CONNECTING_SERVICES',
  progress: 44,
  manualImages: [],
  pickerCollection: { kind: 'all' },
};

const STORAGE_KEY_PREFIX = 'aiy.transition-showcase.preferences.v1:';

function storageKey(libraryKey: string) {
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(libraryKey)}`;
}

function normalizePreferences(value: unknown): TransitionShowcasePreferences {
  const parsed = storedPreferencesSchema.safeParse(value);
  const stored = parsed.success ? parsed.data : {};
  const manualImages = [...new Map((stored.manualImages ?? []).map((image) => [image.id, image])).values()];
  return {
    scene: stored.scene ?? defaultPreferences.scene,
    source: stored.source === undefined ? defaultPreferences.source : stored.source,
    aspect: stored.aspect ?? defaultPreferences.aspect,
    mediaState: stored.mediaState ?? defaultPreferences.mediaState,
    viewport: stored.viewport ?? defaultPreferences.viewport,
    speed: stored.speed ?? defaultPreferences.speed,
    paused: stored.paused ?? defaultPreferences.paused,
    reduced: stored.reduced ?? defaultPreferences.reduced,
    stage: stored.stage ?? defaultPreferences.stage,
    progress: stored.progress ?? defaultPreferences.progress,
    manualImages,
    pickerCollection: stored.pickerCollection ?? defaultPreferences.pickerCollection,
  };
}

function loadPreferences(libraryKey: string) {
  try {
    const serialized = window.localStorage.getItem(storageKey(libraryKey));
    return serialized ? normalizePreferences(JSON.parse(serialized) as unknown) : defaultPreferences;
  } catch {
    return defaultPreferences;
  }
}

function savePreferences(libraryKey: string, preferences: TransitionShowcasePreferences) {
  try {
    window.localStorage.setItem(storageKey(libraryKey), JSON.stringify(preferences));
  } catch {
    // The showcase remains usable when renderer storage is unavailable.
  }
}

export function useTransitionShowcasePreferences(libraryKey: string, active: boolean) {
  const [preferences, setPreferences] = useState(() => loadPreferences(libraryKey));
  const previousContextRef = useRef({ active, libraryKey });

  useEffect(() => {
    const previous = previousContextRef.current;
    previousContextRef.current = { active, libraryKey };
    if (active && (!previous.active || previous.libraryKey !== libraryKey)) {
      setPreferences(loadPreferences(libraryKey));
    }
  }, [active, libraryKey]);

  const updatePreferences = useCallback(
    (patch: Partial<TransitionShowcasePreferences>) => {
      setPreferences((current) => {
        const next = normalizePreferences({ ...current, ...patch });
        savePreferences(libraryKey, next);
        return next;
      });
    },
    [libraryKey],
  );

  return { preferences, updatePreferences };
}
