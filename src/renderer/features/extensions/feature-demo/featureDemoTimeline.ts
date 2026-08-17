export const FEATURE_DEMO_WIDTH = 2560;
export const FEATURE_DEMO_HEIGHT = 1440;
export const FEATURE_DEMO_PREVIEW_WIDTH = 1280;
export const FEATURE_DEMO_PREVIEW_HEIGHT = 720;
export const FEATURE_DEMO_FPS = 30;

export type FeatureDemoSceneId =
  'intro' | 'thumbnailExpand' | 'thumbnailCollapse' | 'codexImages' | 'promptCompare' | 'videoDocument' | 'outro';

export interface FeatureDemoScene {
  id: FeatureDemoSceneId;
  durationInSeconds: number;
}

export const FEATURE_DEMO_SCENES: readonly FeatureDemoScene[] = [
  { id: 'intro', durationInSeconds: 5 },
  { id: 'thumbnailExpand', durationInSeconds: 8 },
  { id: 'thumbnailCollapse', durationInSeconds: 7 },
  { id: 'codexImages', durationInSeconds: 12 },
  { id: 'promptCompare', durationInSeconds: 14 },
  { id: 'videoDocument', durationInSeconds: 13 },
  { id: 'outro', durationInSeconds: 7 },
] as const;

export const FEATURE_DEMO_DURATION_SECONDS = FEATURE_DEMO_SCENES.reduce(
  (total, scene) => total + scene.durationInSeconds,
  0,
);

export interface FeatureDemoScenePosition {
  scene: FeatureDemoScene;
  sceneIndex: number;
  sceneStart: number;
  elapsed: number;
  progress: number;
}

export function featureDemoSceneStart(sceneIndex: number) {
  return FEATURE_DEMO_SCENES.slice(0, Math.max(0, sceneIndex)).reduce(
    (total, scene) => total + scene.durationInSeconds,
    0,
  );
}

export function featureDemoSceneAt(timeInSeconds: number): FeatureDemoScenePosition {
  const bounded = Math.min(Math.max(0, timeInSeconds), FEATURE_DEMO_DURATION_SECONDS);
  let sceneStart = 0;

  for (let sceneIndex = 0; sceneIndex < FEATURE_DEMO_SCENES.length; sceneIndex += 1) {
    const scene = FEATURE_DEMO_SCENES[sceneIndex]!;
    const sceneEnd = sceneStart + scene.durationInSeconds;
    if (bounded < sceneEnd || sceneIndex === FEATURE_DEMO_SCENES.length - 1) {
      const elapsed = Math.min(scene.durationInSeconds, Math.max(0, bounded - sceneStart));
      return {
        scene,
        sceneIndex,
        sceneStart,
        elapsed,
        progress: scene.durationInSeconds === 0 ? 1 : elapsed / scene.durationInSeconds,
      };
    }
    sceneStart = sceneEnd;
  }

  throw new Error('Feature demo timeline has no scenes');
}
