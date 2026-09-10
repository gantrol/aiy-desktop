import type { App } from 'electron';
import path from 'node:path';
import { isPackagedApplication } from '@/main/app/runtime-mode';
import { NaturalWatermarkConfigurationStore } from '@/main/extensions/natural-watermark/configuration';
import { NaturalWatermarkCustomLogoStore } from '@/main/extensions/natural-watermark/custom-logo-store';
import { NaturalWatermarkPreviewImageStore } from '@/main/extensions/natural-watermark/preview-image-store';
import { NaturalWatermarkService } from '@/main/extensions/natural-watermark/service';
import { NATURAL_WATERMARK_EXTENSION_ID } from '@/shared/extension-ids';

export function createNaturalWatermarkRuntime(app: App, bundledExtensionsPath: string) {
  const extensionDataPath = path.join(app.getPath('userData'), 'extension-data', NATURAL_WATERMARK_EXTENSION_ID);
  const customLogos = new NaturalWatermarkCustomLogoStore(path.join(extensionDataPath, 'logos'));
  const previewImages = new NaturalWatermarkPreviewImageStore(
    path.join(extensionDataPath, 'preview.png'),
    extensionDataPath,
  );
  return [
    new NaturalWatermarkConfigurationStore(
      path.join(app.getPath('userData'), 'configuration', 'natural-watermark.json'),
    ),
    new NaturalWatermarkService(
      {
        AIY: {
          absolutePath: isPackagedApplication(app)
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
      previewImages,
    ),
  ] as const;
}
