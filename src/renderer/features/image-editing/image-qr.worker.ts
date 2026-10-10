import jsQR from 'jsqr';

self.onmessage = async (event: MessageEvent<Blob>) => {
  let image: ImageBitmap | undefined;
  let canvas: OffscreenCanvas | undefined;
  try {
    if (!(event.data instanceof Blob) || event.data.size > 25 * 1024 * 1024) throw new Error('IMAGE_QR_LIMIT');
    image = await createImageBitmap(event.data);
    if (image.width * image.height > 32_000_000) throw new Error('IMAGE_QR_LIMIT');
    const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
    canvas = new OffscreenCanvas(
      Math.max(1, Math.round(image.width * scale)),
      Math.max(1, Math.round(image.height * scale)),
    );
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('IMAGE_QR_CANVAS');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    const found: string[] = [];
    for (let index = 0; index < 16; index++) {
      const data = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' });
      if (!code) break;
      if (!found.includes(code.data)) found.push(code.data);
      const corners = [
        code.location.topLeftCorner,
        code.location.topRightCorner,
        code.location.bottomRightCorner,
        code.location.bottomLeftCorner,
      ];
      context.beginPath();
      corners.forEach((point, i) => {
        if (i) context.lineTo(point.x, point.y);
        else context.moveTo(point.x, point.y);
      });
      context.closePath();
      context.fillStyle = 'white';
      context.fill();
    }
    self.postMessage({ text: found.join('\n\n') });
  } catch {
    self.postMessage({ error: true });
  } finally {
    image?.close();
    if (canvas) canvas.width = canvas.height = 1;
  }
};
