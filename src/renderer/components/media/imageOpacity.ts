const OPACITY_SAMPLE_SIZE = 64;

/** Only extend backgrounds that have no transparency in a bounded, full-image sample. */
export function sampleImageIsOpaque(
  image: HTMLImageElement,
  canvas: HTMLCanvasElement = document.createElement('canvas'),
): boolean {
  if (!image.naturalWidth || !image.naturalHeight) return false;

  try {
    // The sample also serves as the still backdrop, so preserve its source aspect ratio.
    const scale = Math.min(1, OPACITY_SAMPLE_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return false;

    // Sample the entire image, including interior cutouts and translucent pixels.
    // Read at most 4,096 pixels and reuse the image that the backdrop already loaded.
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] < 255) return false;
    }
    return true;
  } catch {
    // If the source cannot be sampled, leave its transparency unobscured.
    return false;
  }
}
