/** Only the media transport is substituted; the album components are production code. */
import type { AssetDto } from '@/shared/contracts';
import {
  mediaThumbnailUrl as productionThumbnailUrl,
  codexGeneratedThumbnailUrl,
} from '../src/renderer/components/media/mediaThumbnailUrl';
import { landscape, portrait, smallSvg, poster } from './fixtures';
export { codexGeneratedThumbnailUrl };
const fixtures: Record<string, string> = {
  'album-demo-landscape': landscape,
  'album-demo-portrait': portrait,
  'album-demo-square': smallSvg,
  'album-demo-video': poster,
  'album-demo-broken': 'data:image/png;base64,broken',
};
export function mediaThumbnailUrl(asset: Pick<AssetDto, 'id'>, size: number) {
  return fixtures[asset.id] ?? productionThumbnailUrl(asset, size);
}
