import { TREE_CONNECTION_GEOMETRY } from '@/renderer/components/albums/treeConnectionGeometry';
import { getMediaStackLayout } from '@/renderer/components/media/MediaStackPreview';
import type { FeatureDemoSceneId } from '@/renderer/features/extensions/feature-demo/featureDemoTimeline';

export type DirectorySceneId = Extract<FeatureDemoSceneId, 'directoryExpand' | 'directoryCollapse'>;
export type DirectoryPreviewTarget = 'root' | 'child' | null;

export const DIRECTORY_DEMO_LAYOUT = { left: 32, top: 88, bottom: 32, padding: 16, sidebarWidth: 416 } as const;

const { rowHeight, contentIndentX } = TREE_CONNECTION_GEOMETRY;
const root = {
  x: DIRECTORY_DEMO_LAYOUT.left + DIRECTORY_DEMO_LAYOUT.padding + getMediaStackLayout('tree').containerWidth / 2,
  y: DIRECTORY_DEMO_LAYOUT.top + DIRECTORY_DEMO_LAYOUT.padding + rowHeight / 2,
};
const child = { x: root.x + contentIndentX, y: root.y + rowHeight };
const item = { x: child.x + contentIndentX + 88, y: child.y + rowHeight };
const rest = { x: 1160, y: 650 };
const pull = (point: Point) => ({ x: point.x, y: point.y + 32 });
const retreat = (point: Point) => ({ x: point.x, y: point.y - 32 });

interface Point {
  x: number;
  y: number;
}

export interface DirectoryDemoState {
  rootOpen: boolean;
  childOpen: boolean;
  preview: DirectoryPreviewTarget;
  selected: boolean;
}

interface DirectoryFrame extends DirectoryDemoState {
  progress: number;
}

// Component states are shared by seeking and video capture.
const frames: Record<DirectorySceneId, readonly DirectoryFrame[]> = {
  directoryExpand: [
    { progress: 0, rootOpen: false, childOpen: false, preview: null, selected: false },
    { progress: 0.14, rootOpen: false, childOpen: false, preview: 'root', selected: false },
    { progress: 0.3, rootOpen: true, childOpen: false, preview: 'root', selected: false },
    { progress: 0.42, rootOpen: true, childOpen: false, preview: 'child', selected: false },
    { progress: 0.58, rootOpen: true, childOpen: true, preview: 'child', selected: false },
    { progress: 0.72, rootOpen: true, childOpen: true, preview: null, selected: true },
  ],
  directoryCollapse: [
    { progress: 0, rootOpen: true, childOpen: true, preview: null, selected: true },
    { progress: 0.16, rootOpen: true, childOpen: true, preview: 'child', selected: true },
    { progress: 0.34, rootOpen: true, childOpen: false, preview: 'child', selected: true },
    { progress: 0.52, rootOpen: true, childOpen: false, preview: 'root', selected: true },
    { progress: 0.7, rootOpen: false, childOpen: false, preview: 'root', selected: true },
    { progress: 0.82, rootOpen: false, childOpen: false, preview: null, selected: true },
  ],
};

const cursorFrames: Record<DirectorySceneId, readonly (Point & { progress: number })[]> = {
  directoryExpand: [
    { progress: 0, ...rest },
    { progress: 0.14, ...root },
    { progress: 0.23, ...root },
    { progress: 0.3, ...pull(root) },
    { progress: 0.42, ...child },
    { progress: 0.51, ...child },
    { progress: 0.58, ...pull(child) },
    { progress: 0.72, ...item },
    { progress: 0.77, ...item },
    { progress: 0.9, ...rest },
  ],
  directoryCollapse: [
    { progress: 0, ...rest },
    { progress: 0.16, ...child },
    { progress: 0.25, ...child },
    { progress: 0.34, ...retreat(child) },
    { progress: 0.52, ...root },
    { progress: 0.61, ...root },
    { progress: 0.7, ...retreat(root) },
    { progress: 0.82, ...rest },
  ],
};

export function isDirectoryScene(sceneId: FeatureDemoSceneId): sceneId is DirectorySceneId {
  return sceneId === 'directoryExpand' || sceneId === 'directoryCollapse';
}

export function directoryDemoFrames(sceneId: DirectorySceneId) {
  return frames[sceneId];
}

export function directoryDemoStateAt(sceneId: DirectorySceneId, progress: number): DirectoryDemoState {
  return frames[sceneId].reduce((state, frame) => (frame.progress <= progress ? frame : state), frames[sceneId][0]!);
}

export function directoryDemoCursorAt(sceneId: DirectorySceneId, progress: number): Point {
  const points = cursorFrames[sceneId];
  const nextIndex = points.findIndex((point) => point.progress > progress);
  if (nextIndex < 0) return points.at(-1)!;
  if (nextIndex === 0) return points[0]!;
  const from = points[nextIndex - 1]!;
  const to = points[nextIndex]!;
  const fraction = (progress - from.progress) / (to.progress - from.progress);
  const eased = fraction * fraction * (3 - 2 * fraction);
  return { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
}
