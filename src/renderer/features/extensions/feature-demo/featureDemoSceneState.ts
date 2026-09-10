import type { PairComparisonMode } from '@/renderer/components/creator/PairComparisonView';
import {
  directoryDemoCursorAt,
  directoryDemoFrames,
  isDirectoryScene,
} from '@/renderer/features/extensions/feature-demo/featureDemoDirectoryScene';
import type { FeatureDemoSceneId } from '@/renderer/features/extensions/feature-demo/featureDemoTimeline';
import { petalDemoStateAt } from '@/renderer/features/extensions/feature-demo/featureDemoPetalScene';

export function featureDemoCaptureProgress(sceneId: FeatureDemoSceneId): readonly number[] {
  // Petal motion is streamed during encoding instead of retaining a canvas for every frame.
  if (sceneId === 'petalNote') return [];
  if (isDirectoryScene(sceneId)) return directoryDemoFrames(sceneId).map((frame) => frame.progress);
  if (sceneId === 'imageCreation') return [0, 0.25, 0.6];
  if (sceneId === 'directionDetailsExpand') return [0, 0.3, 0.65];
  if (sceneId === 'directionDetailsCollapse') return [0, 0.3];
  if (sceneId === 'promptCompare') return [0, 0.2, 0.45, 0.78];
  if (sceneId === 'videoDocument') return [0, 0.33, 0.66];
  return [0.5];
}

export function imageCreationDemoStateAt(progress: number) {
  return { hasInput: progress >= 0.25, imageToolsOpen: progress >= 0.6 };
}

export function directionDemoStateAt(sceneId: FeatureDemoSceneId, progress: number) {
  const collapse = sceneId === 'directionDetailsCollapse';
  return {
    detailsOpen: collapse ? progress < 0.3 : progress >= 0.3,
    showResult: collapse || progress >= 0.65,
  };
}

export function comparisonDemoStateAt(progress: number): {
  secondAsset: boolean;
  view: 'matrix' | 'pair';
  mode: PairComparisonMode;
} {
  return {
    secondAsset: progress >= 0.2,
    view: progress >= 0.45 ? 'pair' : 'matrix',
    mode: progress >= 0.78 ? 'SWIPE' : 'SIDE_BY_SIDE',
  };
}

export function videoDemoTabAt(progress: number) {
  return progress >= 0.66 ? 'article' : progress >= 0.33 ? 'transcript' : 'frames';
}

export function directionDemoCursorAt(sceneId: FeatureDemoSceneId, progress: number) {
  const collapse = sceneId === 'directionDetailsCollapse';
  const from = collapse ? { x: 88, y: 116 } : { x: 1160, y: 650 };
  const to = collapse ? { x: 1160, y: 650 } : { x: 88, y: 116 };
  const fraction = Math.max(0, Math.min(1, progress / 0.3));
  const eased = fraction * fraction * (3 - 2 * fraction);
  return { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
}

export function featureDemoCursorAt(sceneId: FeatureDemoSceneId, progress: number) {
  if (sceneId === 'petalNote') return petalDemoStateAt(progress).cursor;
  if (isDirectoryScene(sceneId)) return directoryDemoCursorAt(sceneId, progress);
  if (sceneId === 'directionDetailsExpand' || sceneId === 'directionDetailsCollapse')
    return directionDemoCursorAt(sceneId, progress);
  return null;
}
