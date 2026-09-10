import type { AssetDto } from '@/shared/contracts';
import type { GifManifest } from '@/shared/contracts/gif-making';
import type { GifMotionPlan } from '@/shared/contracts/gif-motion-plan';
import type { useI18n } from '@/renderer/i18n/useI18n';
import { demoSmileImages } from '@/renderer/features/extensions/feature-demo/v050/demoMedia';
import { demoRoseAsset } from '@/renderer/features/extensions/feature-demo/v050/demoCreationData';
import { demoCues } from '@/renderer/features/extensions/feature-demo/v050/demoTimeline';

type DemoCopy = ReturnType<typeof useI18n>['messages']['extensions']['featureDemo']['v050'];

// From the prepared retry-01 animation.json. These are presentation-only IDs, not saved document IDs.
const durations = [650, 120, 160, 160, 750, 220, 220, 320];
const byteSizes = [2043574, 2038548, 2039158, 2037500, 2037754, 2038090, 2038368, 2036962];
export const demoSmileRegion = {
  x: 0.4882812832749408,
  y: 0.10091145848799465,
  width: 0.2246093753442464,
  height: 0.13671875020954127,
};
export const demoSmileAssets = new Map<string, AssetDto>(
  demoSmileImages.map((mediaUrl, index) => {
    const id = `demo-smile-${index + 1}`;
    return [id, { ...demoRoseAsset, id, mediaUrl, byteSize: byteSizes[index] }];
  }),
);
export const demoSmileManifest: GifManifest = {
  schemaVersion: 1,
  width: 1024,
  height: 1536,
  fit: 'CONTAIN',
  backgroundColor: null,
  backgroundAssetId: null,
  foreground: { scale: 1, x: 0, y: 0 },
  loop: 'FOREVER',
  playback: 'FORWARD',
  frames: durations.map((durationMs, index) => ({
    id: `demo-smile-frame-${index + 1}`,
    assetId: `demo-smile-${index + 1}`,
    durationMs,
    sourceRect: null,
  })),
};
export const demoSmileDuration = durations.reduce((total, duration) => total + duration, 0);

export function demoSmilePlan(copy: DemoCopy): GifMotionPlan {
  const states = copy.smileStates;
  return {
    title: copy.smileTitle,
    subject: copy.smileSubject,
    preserve: copy.smilePreserve,
    mode: 'REGION',
    region: demoSmileRegion,
    states: [
      states.source,
      states.begin,
      states.deepen,
      states.lift,
      states.peak,
      states.relax,
      states.return,
      states.settle,
    ],
    returnMode: 'CONTINUE',
    durationMs: demoSmileDuration,
  };
}

/** One clock drives the film, canvas and selected thumbnail, including paused seeks. */
export function demoSmileIndex(time: number) {
  if (time < demoCues.motionPlay) return time >= demoCues.frameSelect ? 4 : 0;
  return demoSmileFrameAtElapsed((Math.min(time, demoCues.motionHold) - demoCues.motionPlay) * 1000);
}

export function demoSmileFrameAtElapsed(milliseconds: number) {
  let elapsed = ((Math.round(milliseconds) % demoSmileDuration) + demoSmileDuration) % demoSmileDuration;
  for (let index = 0; index < durations.length; index++) {
    if (elapsed < durations[index]) return index;
    elapsed -= durations[index];
  }
  return 0;
}

export const demoFrameImageUrl = (asset: AssetDto) => asset.mediaUrl;
