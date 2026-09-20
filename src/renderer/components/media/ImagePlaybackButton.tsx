import { Pause, Play } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useMediaReducedMotion } from '@/renderer/components/media/useMediaActivity';
import {
  hasImagePlaybackControl,
  imagePreviewSource,
  type PreviewAsset,
  type PreviewIntent,
} from '@/shared/media-preview-policy';

interface Props {
  asset: PreviewAsset;
  poster: string;
  motion: NonNullable<PreviewIntent['motion']>;
  labels: { play: string; pause: string };
  disabled?: boolean;
  onMotionChange(motion: NonNullable<PreviewIntent['motion']>): void;
}

/** Use the image policy, including reduced motion and unknown PNG/WebP frame counts. */
export function ImagePlaybackButton({ asset, poster, motion, labels, disabled, onMotionChange }: Props) {
  const reducedMotion = useMediaReducedMotion();
  if (!hasImagePlaybackControl(asset)) return null;
  const playing = imagePreviewSource(asset, poster, { visible: true, reducedMotion, motion }) === asset.mediaUrl;
  const label = playing ? labels.pause : labels.play;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      data-action="media-toggle-playback"
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={() => onMotionChange(playing ? 'still' : 'play')}
    >
      {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
    </Button>
  );
}
