import { ImageIcon } from 'lucide-react';
import type { NaturalWatermarkProfile } from '@/shared/contracts/natural-watermark';
import { cn } from '@/renderer/lib/utils';
import aicandoMarkUrl from '../../../../../extensions/com.aiy.natural-watermark/assets/aicando-mark.svg?url';

export function NaturalWatermarkMark({
  profile,
  customLogoUrl,
  logoHeight,
  dark,
}: {
  profile: NaturalWatermarkProfile;
  customLogoUrl: string | null;
  logoHeight: number;
  dark: boolean;
}) {
  const style = profile.logo.kind === 'BUILT_IN' ? profile.logo.brand : 'CUSTOM';
  const fontSize = Math.max(9, Math.round(logoHeight * 0.72));
  return (
    <span
      className={cn(
        'flex max-w-full items-center font-bold tracking-tight whitespace-nowrap',
        dark ? 'text-media-checker-a' : 'text-media-surround-dark',
      )}
      style={{ gap: Math.max(4, Math.round(logoHeight * 0.18)), fontSize }}
    >
      {style === 'AIY' ? (
        <img
          src="./icon.png"
          alt=""
          className="shrink-0 rounded-sm"
          style={{ height: logoHeight, width: logoHeight }}
        />
      ) : style === 'AICANDO_XYZ' ? (
        <img src={aicandoMarkUrl} alt="" className="w-auto shrink-0" style={{ height: logoHeight }} />
      ) : customLogoUrl ? (
        <img src={customLogoUrl} alt="" className="max-w-24 shrink-0 object-contain" style={{ height: logoHeight }} />
      ) : (
        <ImageIcon aria-hidden="true" className="shrink-0" style={{ height: logoHeight, width: logoHeight }} />
      )}
      {profile.text && <span className="max-w-64 truncate">{profile.text}</span>}
    </span>
  );
}
