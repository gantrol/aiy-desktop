export const FEATURE_DEMO_WIDTH = 2560;
export const FEATURE_DEMO_HEIGHT = 1440;
export const FEATURE_DEMO_PREVIEW_WIDTH = 1280;
export const FEATURE_DEMO_PREVIEW_HEIGHT = 720;
export const FEATURE_DEMO_FPS = 30;

export type FeatureDemoSceneId =
  | 'petalNote'
  | 'imageCreation'
  | 'directionDetailsExpand'
  | 'directionDetailsCollapse'
  | 'directoryExpand'
  | 'directoryCollapse'
  | 'codexImages'
  | 'promptCompare'
  | 'videoDocument';

export interface FeatureDemoScene {
  id: FeatureDemoSceneId;
  durationInSeconds: number;
}

export const FEATURE_DEMO_SCENES: readonly FeatureDemoScene[] = [
  { id: 'petalNote', durationInSeconds: 10 },
  { id: 'imageCreation', durationInSeconds: 12 },
  { id: 'directionDetailsExpand', durationInSeconds: 6 },
  { id: 'directionDetailsCollapse', durationInSeconds: 5 },
  { id: 'directoryExpand', durationInSeconds: 7 },
  { id: 'directoryCollapse', durationInSeconds: 6 },
  { id: 'codexImages', durationInSeconds: 10 },
  { id: 'promptCompare', durationInSeconds: 14 },
  { id: 'videoDocument', durationInSeconds: 12 },
] as const;

export function featureDemoDuration(scenes: readonly FeatureDemoScene[] = FEATURE_DEMO_SCENES) {
  return scenes.reduce((total, scene) => total + scene.durationInSeconds, 0);
}

export const FEATURE_DEMO_DURATION_SECONDS = featureDemoDuration();

export interface FeatureDemoScenePosition {
  scene: FeatureDemoScene;
  sceneIndex: number;
  sceneStart: number;
  elapsed: number;
  progress: number;
}

export function featureDemoSceneStart(sceneIndex: number, scenes: readonly FeatureDemoScene[] = FEATURE_DEMO_SCENES) {
  return scenes.slice(0, Math.max(0, sceneIndex)).reduce((total, scene) => total + scene.durationInSeconds, 0);
}

export function featureDemoSceneAt(
  timeInSeconds: number,
  scenes: readonly FeatureDemoScene[] = FEATURE_DEMO_SCENES,
): FeatureDemoScenePosition {
  if (scenes.length === 0) throw new Error('Feature demo timeline has no scenes');
  const duration = featureDemoDuration(scenes);
  const bounded = Math.min(Math.max(0, timeInSeconds), duration);
  let sceneStart = 0;

  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex += 1) {
    const scene = scenes[sceneIndex]!;
    const sceneEnd = sceneStart + scene.durationInSeconds;
    if (bounded < sceneEnd || sceneIndex === scenes.length - 1) {
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

  throw new Error('Feature demo timeline has no reachable scene');
}
