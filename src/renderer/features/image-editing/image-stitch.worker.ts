export interface StitchInput {
  files: File[];
  layout: 'vertical' | 'horizontal' | 'grid';
  columns: number;
  gap: number;
  background: 'transparent' | 'white' | 'black';
}
async function stitch(input: StitchInput) {
  if (
    input.files.length < 2 ||
    input.files.length > 16 ||
    input.files.reduce((n, file) => n + file.size, 0) > 100 * 1024 * 1024
  )
    throw new Error('limit');
  const sizes: { width: number; height: number }[] = [];
  let pixels = 0;
  for (const file of input.files) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 25 * 1024 * 1024)
      throw new Error('limit');
    const bitmap = await createImageBitmap(file);
    sizes.push({ width: bitmap.width, height: bitmap.height });
    pixels += bitmap.width * bitmap.height;
    bitmap.close();
    if (pixels > 32_000_000) throw new Error('limit');
  }
  const gap = Math.max(0, Math.min(200, Math.round(input.gap)));
  const columns =
    input.layout === 'vertical'
      ? 1
      : input.layout === 'horizontal'
        ? sizes.length
        : Math.max(1, Math.min(4, input.columns));
  const rows = Math.ceil(sizes.length / columns);
  const widths = Array.from({ length: columns }, (_, col) =>
    Math.max(...sizes.filter((_, i) => i % columns === col).map((s) => s.width), 0),
  );
  const heights = Array.from({ length: rows }, (_, row) =>
    Math.max(...sizes.slice(row * columns, (row + 1) * columns).map((s) => s.height)),
  );
  const width = widths.reduce((a, b) => a + b, 0) + gap * (columns - 1);
  const height = heights.reduce((a, b) => a + b, 0) + gap * (rows - 1);
  if (width > 16384 || height > 16384 || width * height > 32_000_000) throw new Error('limit');
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  if (input.background !== 'transparent') {
    ctx.fillStyle = input.background;
    ctx.fillRect(0, 0, width, height);
  }
  for (let i = 0; i < input.files.length; i++) {
    const bitmap = await createImageBitmap(input.files[i]);
    const col = i % columns,
      row = Math.floor(i / columns);
    const x = widths.slice(0, col).reduce((a, b) => a + b, 0) + gap * col + (widths[col] - bitmap.width) / 2;
    const y = heights.slice(0, row).reduce((a, b) => a + b, 0) + gap * row + (heights[row] - bitmap.height) / 2;
    ctx.drawImage(bitmap, x, y);
    bitmap.close();
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  canvas.width = canvas.height = 1;
  if (blob.size > 25 * 1024 * 1024) throw new Error('limit');
  return blob;
}
self.onmessage = (event: MessageEvent<StitchInput>) => {
  void stitch(event.data).then(
    (blob) => self.postMessage({ blob }),
    () => self.postMessage({ error: true }),
  );
};
