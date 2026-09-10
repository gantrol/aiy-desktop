import path from 'node:path';
import type { AssetFileAvailabilityDto, AssetFileRevealContext, AssetFileSaveResult } from '@/shared/contracts';
import { acceptedAssetExportExtensions, type ResolvedAssetFile } from '@/main/database/assets/asset-file-repository';

interface SaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

interface AssetFileActionPorts {
  showSaveDialog(options: Electron.SaveDialogOptions): Promise<SaveDialogResult>;
  copyFile(sourcePath: string, destinationPath: string): Promise<void>;
  copyImage?(filePath: string): Promise<void>;
  showItemInFolder(filePath: string): void;
  openPath(filePath: string): Promise<string>;
}

export class AssetFileActions {
  constructor(
    private readonly resolve: (assetId: string) => ResolvedAssetFile | null | Promise<ResolvedAssetFile | null>,
    private readonly ports: AssetFileActionPorts,
    private readonly resolveRevealPath?: (
      asset: ResolvedAssetFile,
      context: AssetFileRevealContext,
    ) => string | Promise<string>,
  ) {}

  async availability(assetId: string): Promise<AssetFileAvailabilityDto> {
    return { available: Boolean(await this.resolve(assetId)) };
  }

  async copy(assetId: string) {
    const source = await this.require(assetId);
    try {
      if (!this.ports.copyImage) throw new Error('Clipboard is unavailable');
      await this.ports.copyImage(source.absolutePath);
    } catch {
      throw new Error('Unable to copy the image');
    }
  }

  async saveAs(assetId: string): Promise<AssetFileSaveResult> {
    const source = await this.require(assetId);
    const extensions = acceptedAssetExportExtensions(source.mimeType).map((extension) => extension.slice(1));
    let result: SaveDialogResult;
    try {
      result = await this.ports.showSaveDialog({
        defaultPath: source.suggestedName,
        filters: [{ name: 'Image', extensions }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
    } catch {
      throw new Error('Unable to choose an export location');
    }
    if (result.canceled || !result.filePath) return { status: 'cancelled' };

    const selectedExtension = path.extname(result.filePath).toLowerCase();
    if (!acceptedAssetExportExtensions(source.mimeType).includes(selectedExtension as never)) {
      throw new Error(`File extension must be ${extensions.map((extension) => `.${extension}`).join(' or ')}`);
    }

    // Re-resolve immediately before the copy so a deleted or missing source
    // cannot be exported from a stale renderer capability check.
    const current = await this.require(assetId);
    if (path.resolve(current.absolutePath) !== path.resolve(result.filePath)) {
      try {
        await this.ports.copyFile(current.absolutePath, result.filePath);
      } catch {
        throw new Error('Unable to save the image');
      }
    }
    return { status: 'saved' };
  }

  async reveal(assetId: string, context?: AssetFileRevealContext) {
    const source = await this.require(assetId);
    try {
      const revealPath = await this.resolveRevealPath?.(source, context ?? { kind: 'ALL_MATERIALS' });
      if (!revealPath) throw new Error('Readable asset directory unavailable');
      this.ports.showItemInFolder(revealPath);
    } catch {
      throw new Error('Unable to show the image in the file manager');
    }
  }

  async open(assetId: string, context?: AssetFileRevealContext) {
    const source = await this.require(assetId);
    try {
      const readablePath = await this.resolveRevealPath?.(source, context ?? { kind: 'ALL_MATERIALS' });
      if (!readablePath) throw new Error('Readable asset file unavailable');
      const error = await this.ports.openPath(readablePath);
      if (error) throw new Error('open failed');
    } catch {
      throw new Error('Unable to open the image');
    }
  }

  private async require(assetId: string) {
    const file = await this.resolve(assetId);
    if (!file) throw new Error('Asset file is unavailable');
    return file;
  }
}
