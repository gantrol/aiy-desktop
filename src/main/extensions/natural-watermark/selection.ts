import { NATURAL_WATERMARK_EXTENSION_ID } from '@/shared/extension-ids';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import type { NaturalWatermarkConfigurationStore } from '@/main/extensions/natural-watermark/configuration';
import type { NaturalWatermarkService } from '@/main/extensions/natural-watermark/service';
import type { BrowserCompanionWatermarkSelection } from '@/shared/contracts/browser-companion';
import type { NaturalWatermarkProfile } from '@/shared/contracts/natural-watermark';

export interface NaturalWatermarkRuntime {
  configuration: NaturalWatermarkConfigurationStore;
  service: NaturalWatermarkService;
  isActivated(): boolean;
}

export async function selectedWatermarkProfile(
  selection: BrowserCompanionWatermarkSelection | undefined,
  runtime: NaturalWatermarkRuntime | undefined,
): Promise<NaturalWatermarkProfile | null> {
  if (!selection || selection.kind === 'NONE') return null;
  if (!runtime?.isActivated()) throw new Error('Natural Watermark is disabled or missing permissions');
  return selection.kind === 'PREFERRED'
    ? runtime.configuration.preferredProfile()
    : runtime.configuration.profile(selection.profileId);
}

export function bindNaturalWatermarkRuntime(
  [configuration, service]: readonly [NaturalWatermarkConfigurationStore, NaturalWatermarkService],
  extensions: Pick<ExtensionRegistry, 'isActivated'>,
): NaturalWatermarkRuntime {
  return { configuration, service, isActivated: () => extensions.isActivated(NATURAL_WATERMARK_EXTENSION_ID) };
}
