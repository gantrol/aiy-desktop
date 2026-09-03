import path from 'node:path';
import type { NaturalWatermarkCustomLogoStore } from '@/main/extensions/natural-watermark/custom-logo-store';
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import { imageDimensions } from '@/main/media/image-dimensions';
import { validateCanvasPngAsync } from '@/main/media/png-validation';
import { withDecodedImageFileInSandbox } from '@/main/media/sandboxed-image-decoder';
import type { ResolvedAssetFile } from '@/main/database/assets/asset-file-repository';
import type {
  NaturalWatermarkBrand,
  NaturalWatermarkConfiguration,
  NaturalWatermarkLogo,
} from '@/shared/contracts/natural-watermark';

const outputExtensionByMimeType = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
} as const;

const sourceExtensionsByMimeType: Readonly<Record<string, readonly string[]>> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'image/svg+xml': ['.svg'],
};

export interface NaturalWatermarkOutput {
  bytes: Buffer;
  mimeType: keyof typeof outputExtensionByMimeType;
  suggestedName: string;
}

function bufferView(bytes: Uint8Array<ArrayBufferLike>) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function watermarkedName(fileName: string, extension: string) {
  const baseName = path.basename(fileName, path.extname(fileName)).trim() || 'image';
  const suffix = '-watermarked';
  const maximumStemLength = Math.max(1, 220 - suffix.length - extension.length);
  return `${baseName.slice(0, maximumStemLength)}${suffix}${extension}`;
}

export class NaturalWatermarkService {
  private readonly logoReads = new Map<NaturalWatermarkBrand, Promise<Buffer>>();

  constructor(
    private readonly logoPaths: Readonly<
      Record<NaturalWatermarkBrand, { absolutePath: string; mimeType: 'image/png' | 'image/svg+xml' }>
    >,
    private readonly customLogos: NaturalWatermarkCustomLogoStore,
  ) {}

  private builtInLogo(brand: NaturalWatermarkBrand) {
    const cached = this.logoReads.get(brand);
    if (cached) return cached;
    const read = readBoundedImageFile(this.logoPaths[brand].absolutePath);
    this.logoReads.set(brand, read);
    return read;
  }

  private async logo(logo: NaturalWatermarkLogo) {
    if (logo.kind === 'CUSTOM') {
      const custom = await this.customLogos.get(logo.id);
      return { bytes: bufferView(custom.bytes), mimeType: custom.mimeType, style: 'CUSTOM' as const };
    }
    return {
      bytes: await this.builtInLogo(logo.brand),
      mimeType: this.logoPaths[logo.brand].mimeType,
      style: logo.brand,
    };
  }

  customLogo(id: string) {
    return this.customLogos.get(id);
  }

  importCustomLogo(filePath: string) {
    return this.customLogos.importFromFile(filePath);
  }

  async apply(
    file: Pick<ResolvedAssetFile, 'absolutePath' | 'extension' | 'mimeType' | 'suggestedName'>,
    configuration: NaturalWatermarkConfiguration,
  ): Promise<NaturalWatermarkOutput> {
    const expectedExtensions = sourceExtensionsByMimeType[file.mimeType];
    const sourceExtension = file.extension.toLowerCase();
    if (!expectedExtensions?.includes(sourceExtension)) {
      if (file.mimeType === 'image/gif') throw new Error('Natural watermark does not flatten animated GIF images');
      throw new Error(`Natural watermark does not support ${file.mimeType}`);
    }
    const logo = await this.logo(configuration.logo);
    return withDecodedImageFileInSandbox(
      file.absolutePath,
      {
        operation: 'watermark',
        style: logo.style,
        text: configuration.text,
        placement: configuration.placement,
        opacity: configuration.opacity,
        logoBytes: Uint8Array.from(logo.bytes),
        logoMimeType: logo.mimeType,
      },
      async (result) => {
        if (result.operation !== 'watermark') throw new Error('Image decoder returned the wrong operation');
        const bytes = bufferView(result.outputBytes);
        const extension = outputExtensionByMimeType[result.outputMimeType];
        const dimensions =
          result.outputMimeType === 'image/png'
            ? await validateCanvasPngAsync(bytes)
            : imageDimensions(bytes, extension);
        if (!dimensions || dimensions.width !== result.width || dimensions.height !== result.height) {
          throw new Error('Watermarked image output does not match its reported dimensions');
        }
        return {
          bytes,
          mimeType: result.outputMimeType,
          suggestedName: watermarkedName(file.suggestedName, extension),
        };
      },
    );
  }
}
