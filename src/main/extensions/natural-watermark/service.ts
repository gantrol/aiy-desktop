import { randomInt } from 'node:crypto';
import path from 'node:path';
import type { NaturalWatermarkCustomLogoStore } from '@/main/extensions/natural-watermark/custom-logo-store';
import type { NaturalWatermarkPreviewImageStore } from '@/main/extensions/natural-watermark/preview-image-store';
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import { imageDimensions } from '@/main/media/image-dimensions';
import { validateCanvasPngAsync } from '@/main/media/png-validation';
import { withDecodedImageBytesInSandbox, withDecodedImageFileInSandbox } from '@/main/media/sandboxed-image-decoder';
import type { ResolvedAssetFile } from '@/main/database/assets/asset-file-repository';
import {
  imageDecoderSourceMimeTypeSchema,
  type ImageDecoderFileRequestInput,
  type ImageDecoderSourceMimeType,
  type ImageDecoderSuccessResponse,
} from '@/shared/image-decoder-protocol';
import type {
  NaturalWatermarkBrand,
  NaturalWatermarkLogo,
  NaturalWatermarkPosition,
  NaturalWatermarkProfile,
} from '@/shared/contracts/natural-watermark';

const outputExtensionByMimeType = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
} as const;

const sourceExtensionsByMimeType: Readonly<Record<string, readonly string[]>> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'image/svg+xml': ['.svg'],
};

export interface NaturalWatermarkOutput {
  bytes: Buffer;
  mimeType: keyof typeof outputExtensionByMimeType;
  suggestedName: string;
}

type WatermarkSource =
  | { kind: 'file'; absolutePath: string }
  | { kind: 'bytes'; bytes: Uint8Array<ArrayBufferLike>; mimeType: ImageDecoderSourceMimeType };

function bufferView(bytes: Uint8Array<ArrayBufferLike>) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function watermarkedName(fileName: string, extension: string) {
  const baseName = path.basename(fileName, path.extname(fileName)).trim() || 'image';
  const suffix = '-watermarked';
  const maximumStemLength = Math.max(1, 220 - suffix.length - extension.length);
  return `${baseName.slice(0, maximumStemLength)}${suffix}${extension}`;
}

function randomRatio(minimum: number, maximum: number) {
  if (minimum >= maximum) return minimum;
  return minimum + (randomInt(0, 1_000_001) / 1_000_000) * (maximum - minimum);
}

function resolvedPosition(profile: NaturalWatermarkProfile): NaturalWatermarkPosition {
  if (!profile.positionJitter.enabled) return { ...profile.position };
  return {
    x: randomRatio(
      Math.max(0, profile.position.x - profile.positionJitter.x),
      Math.min(1, profile.position.x + profile.positionJitter.x),
    ),
    y: randomRatio(
      Math.max(0, profile.position.y - profile.positionJitter.y),
      Math.min(1, profile.position.y + profile.positionJitter.y),
    ),
  };
}

export class NaturalWatermarkService {
  private readonly logoReads = new Map<NaturalWatermarkBrand, Promise<Buffer>>();

  constructor(
    private readonly logoPaths: Readonly<
      Record<NaturalWatermarkBrand, { absolutePath: string; mimeType: 'image/png' | 'image/svg+xml' }>
    >,
    private readonly customLogos: NaturalWatermarkCustomLogoStore,
    private readonly previewImageStore: NaturalWatermarkPreviewImageStore,
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

  previewImage() {
    return this.previewImageStore.get();
  }

  importPreviewImage(filePath: string) {
    return this.previewImageStore.importFromFile(filePath);
  }

  async apply(
    file: Pick<ResolvedAssetFile, 'absolutePath' | 'extension' | 'mimeType' | 'suggestedName'>,
    profile: NaturalWatermarkProfile,
  ): Promise<NaturalWatermarkOutput> {
    const expectedExtensions = sourceExtensionsByMimeType[file.mimeType];
    const sourceExtension = file.extension.toLowerCase();
    if (!expectedExtensions?.includes(sourceExtension)) {
      throw new Error(`Natural watermark does not support ${file.mimeType}`);
    }
    return this.applySource({ kind: 'file', absolutePath: file.absolutePath }, file.suggestedName, profile);
  }

  applyBytes(
    bytes: Uint8Array<ArrayBufferLike>,
    mimeType: string,
    suggestedName: string,
    profile: NaturalWatermarkProfile,
    signal?: AbortSignal,
  ): Promise<NaturalWatermarkOutput> {
    return this.applySource(
      { kind: 'bytes', bytes, mimeType: imageDecoderSourceMimeTypeSchema.parse(mimeType) },
      suggestedName,
      profile,
      signal,
    );
  }

  private async applySource(
    source: WatermarkSource,
    suggestedName: string,
    profile: NaturalWatermarkProfile,
    signal?: AbortSignal,
  ): Promise<NaturalWatermarkOutput> {
    signal?.throwIfAborted();
    const logo = await this.logo(profile.logo);
    signal?.throwIfAborted();
    const input: ImageDecoderFileRequestInput = {
      operation: 'watermark',
      style: logo.style,
      text: profile.text,
      sizeRatio: profile.sizeRatio,
      position: resolvedPosition(profile),
      opacity: profile.opacity,
      logoBytes: Uint8Array.from(logo.bytes),
      logoMimeType: logo.mimeType,
    };
    const consume = async (result: ImageDecoderSuccessResponse): Promise<NaturalWatermarkOutput> => {
      signal?.throwIfAborted();
      if (result.operation !== 'watermark') throw new Error('Image decoder returned the wrong operation');
      const bytes = bufferView(result.outputBytes);
      const extension = outputExtensionByMimeType[result.outputMimeType];
      const dimensions =
        result.outputMimeType === 'image/png' ? await validateCanvasPngAsync(bytes) : imageDimensions(bytes, extension);
      if (!dimensions || dimensions.width !== result.width || dimensions.height !== result.height) {
        throw new Error('Watermarked image output does not match its reported dimensions');
      }
      signal?.throwIfAborted();
      return {
        bytes,
        mimeType: result.outputMimeType,
        suggestedName: watermarkedName(suggestedName, extension),
      };
    };
    return source.kind === 'bytes'
      ? withDecodedImageBytesInSandbox(source.bytes, source.mimeType, input, consume, 120_000, signal)
      : withDecodedImageFileInSandbox(source.absolutePath, input, consume, 120_000, signal);
  }
}
