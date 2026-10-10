import { BrowserWindow, nativeImage, type NativeImage } from 'electron';
import sharp from 'sharp';
import { tableImageDocument } from '@/main/browser-companion/table-image-html';

const MAX_PAGE_HEIGHT = 780;
const measureTable = `(async () => {
  await document.fonts.ready;
  for (const image of document.images) await image.decode();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return {
    heights: [...document.querySelectorAll('tr')].map(row => row.getBoundingClientRect().height),
    overflow: [...document.querySelectorAll('th,td')].some(cell => cell.scrollWidth > cell.clientWidth + 1),
    height: document.body.getBoundingClientRect().height
  };
})()`;

interface TableMeasurements {
  heights: number[];
  overflow: boolean;
  height: number;
}

let bitmapOrder: Promise<'rgba' | 'bgra'> | undefined;
function nativeBitmapOrder() {
  // Electron defines bitmap channel order as platform-dependent. Discover it once
  // with one opaque pixel rather than encoding every captured page on the main thread.
  return (bitmapOrder ??= sharp({ create: { width: 1, height: 1, channels: 4, background: '#ff0000' } })
    .png()
    .toBuffer()
    .then((bytes) => {
      const pixel = nativeImage.createFromBuffer(bytes).toBitmap({ scaleFactor: 1 });
      if (pixel[0] === 255 && pixel[2] === 0) return 'rgba';
      if (pixel[0] === 0 && pixel[2] === 255) return 'bgra';
      throw new Error('TABLE_RENDER_FAILED');
    }));
}

async function encodeCapture(capture: NativeImage, height: number) {
  const size = capture.getSize(1);
  if (capture.isEmpty() || size.width < 1 || size.height < 1 || size.width * size.height > 16_000_000)
    throw new Error('TABLE_RENDER_FAILED');
  const pixels = capture.toBitmap({ scaleFactor: 1 });
  if (pixels.byteLength !== size.width * size.height * 4) throw new Error('TABLE_RENDER_FAILED');
  const encoder = sharp(pixels, { raw: { width: size.width, height: size.height, channels: 4 } });
  if ((await nativeBitmapOrder()) === 'bgra')
    encoder.recomb([
      [0, 0, 1],
      [0, 1, 0],
      [1, 0, 0],
    ]);
  return encoder.resize(1200, height, { fit: 'fill' }).png().toBuffer();
}

/** Rendering is isolated from the editor and network. Pages are laid out before capture, never cropped through rows. */
export async function renderTableImages(
  rows: readonly string[],
  label: string,
  maximumPages: number,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const window = new BrowserWindow({
    show: false,
    width: 1200,
    height: 1600,
    useContentSize: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      backgroundThrottling: false,
      partition: 'aiy-table-images',
    },
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  const abort = () => {
    if (!window.isDestroyed()) window.destroy();
  };
  signal.addEventListener('abort', abort, { once: true });
  async function measure(pageRows: readonly string[], pageLabel: string): Promise<TableMeasurements> {
    signal.throwIfAborted();
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(tableImageDocument(pageRows, pageLabel))}`);
    window.webContents.setZoomFactor(2);
    return window.webContents.executeJavaScript(measureTable);
  }
  try {
    // Measure bounded chunks; a very long table never creates an unbounded capture surface.
    const heights: number[] = [];
    for (let offset = 1; offset < rows.length; offset += 40) {
      const measured = await measure([rows[0]!, ...rows.slice(offset, offset + 40)], label);
      if (measured.overflow) throw new Error('TABLE_TOO_WIDE');
      if (!heights.length) heights.push(measured.heights[0]!);
      heights.push(...measured.heights.slice(1));
    }
    if (!heights.length) heights.push((await measure(rows, label)).heights[0]!);
    const header = heights[0]!;
    const available = MAX_PAGE_HEIGHT - 80 - header;
    if (!Number.isFinite(available) || available < 1) throw new Error('TABLE_ROW_TOO_TALL');
    const pages: string[][] = [];
    let current = [rows[0]!],
      used = 0;
    for (let index = 1; index < rows.length; index++) {
      const height = heights[index]!;
      if (!Number.isFinite(height) || height > available) throw new Error('TABLE_ROW_TOO_TALL');
      if (used + height > available) {
        pages.push(current);
        current = [rows[0]!];
        used = 0;
      }
      current.push(rows[index]!);
      used += height;
    }
    pages.push(current);
    if (pages.length > maximumPages) throw new Error('TABLE_IMAGE_LIMIT');
    const images: Buffer[] = [];
    for (const [index, page] of pages.entries()) {
      const dimensions = await measure(page, `${label} · ${index + 1}/${pages.length}`);
      if (dimensions.overflow || dimensions.height > MAX_PAGE_HEIGHT) throw new Error('TABLE_TOO_WIDE');
      const capture = await window.webContents.capturePage(
        { x: 0, y: 0, width: 1200, height: Math.ceil(dimensions.height * 2) },
        { stayHidden: true },
      );
      signal.throwIfAborted();
      images.push(await encodeCapture(capture, Math.ceil(dimensions.height * 2)));
    }
    return images;
  } finally {
    signal.removeEventListener('abort', abort);
    abort();
  }
}
