import type { App } from 'electron';
import path from 'node:path';
import { NaturalWatermarkConfigurationStore } from '@/main/extensions/natural-watermark/configuration';
import { NaturalWatermarkCustomLogoStore } from '@/main/extensions/natural-watermark/custom-logo-store';
import { NaturalWatermarkService } from '@/main/extensions/natural-watermark/service';
import { NATURAL_WATERMARK_EXTENSION_ID } from '@/shared/extension-ids';

export function createNaturalWatermarkRuntime(app: App, bundledExtensionsPath: string) {
  const customLogos = new NaturalWatermarkCustomLogoStore(
    path.join(app.getPath('userData'), 'extension-data', NATURAL_WATERMARK_EXTENSION_ID, 'logos'),
  );
  return [
    new NaturalWatermarkConfigurationStore(
      path.join(app.getPath('userData'), 'configuration', 'natural-watermark.json'),
    ),
    new NaturalWatermarkService(
      {
        AIY: {
          absolutePath: app.isPackaged
            ? path.join(process.resourcesPath, 'icon.png')
            : path.join(app.getAppPath(), 'build', 'icon.png'),
          mimeType: 'image/png',
        },
        AICANDO_XYZ: {
          absolutePath: path.join(bundledExtensionsPath, NATURAL_WATERMARK_EXTENSION_ID, 'assets', 'aicando-mark.svg'),
          mimeType: 'image/svg+xml',
        },
      },
      customLogos,
    ),
  ] as const;
}
