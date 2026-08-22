import { app, nativeImage, type NativeImage } from 'electron';
import path from 'node:path';

const maximumDragIconSize = 96;

function resizeDragIcon(image: NativeImage) {
  if (image.isEmpty()) return image;
  const { width, height } = image.getSize();
  if (width <= maximumDragIconSize && height <= maximumDragIconSize) return image;
  return image.resize({
    ...(width >= height ? { width: maximumDragIconSize } : { height: maximumDragIconSize }),
    quality: 'good',
  });
}

function applicationIconCandidates() {
  return app.isPackaged
    ? [path.join(process.resourcesPath, 'icon.png')]
    : [path.resolve(__dirname, '../../build/icon.png'), path.join(app.getAppPath(), 'build/icon.png')];
}

export function createAssetFileDragIcon(sourcePath: string) {
  const sourceIcon = resizeDragIcon(nativeImage.createFromPath(sourcePath));
  if (!sourceIcon.isEmpty()) return sourceIcon;

  for (const candidate of applicationIconCandidates()) {
    const fallbackIcon = resizeDragIcon(nativeImage.createFromPath(candidate));
    if (!fallbackIcon.isEmpty()) return fallbackIcon;
  }

  throw new Error('File drag icon is unavailable');
}
