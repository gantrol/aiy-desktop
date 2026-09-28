import type { TextCoverScene } from '@/renderer/features/text-covers/textCoverScene';

/** Raster output contains pixels only, never an embedded or redistributed font. */
export async function textCoverPng(scene: TextCoverScene): Promise<File> {
  if (scene.overflow) throw new Error('TEXT_COVER_OVERFLOW');
  const canvas = document.createElement('canvas');
  const scale = 1600 / Math.max(scene.width, scene.height);
  canvas.width = Math.round(scene.width * scale);
  canvas.height = Math.round(scene.height * scale);
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('TEXT_COVER_CANVAS_UNAVAILABLE');
    context.scale(scale, scale);
    for (const shape of scene.shapes) {
      context.fillStyle = shape.fill;
      if (shape.kind === 'rect') {
        context.fillRect(shape.x, shape.y, shape.width, shape.height);
        continue;
      }
      context.font = `${shape.weight} ${shape.size}px ${shape.family}`;
      await document.fonts.load(context.font, shape.value);
      context.textAlign = shape.anchor === 'middle' ? 'center' : shape.anchor === 'end' ? 'right' : 'left';
      const width = context.measureText(shape.value).width;
      const left = shape.x - (shape.anchor === 'middle' ? width / 2 : shape.anchor === 'end' ? width : 0);
      // An unusual user-installed font must not silently clip the saved cover.
      if (left < 24 || left + width > scene.width - 24) throw new Error('TEXT_COVER_OVERFLOW');
      context.fillText(shape.value, shape.x, shape.y);
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('TEXT_COVER_EXPORT_FAILED'))), 'image/png'),
    );
    return new File([blob], 'text-cover.png', { type: 'image/png' });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
