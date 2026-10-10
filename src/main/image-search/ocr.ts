import { readFile, stat } from 'node:fs/promises';
import { recognizeWindowsImage } from '@/main/image-privacy/windows-ocr';

/** Reuses the system recognizer; this search task owns its cancellation and derived text cache. */
export async function recognizeSearchImage(filePath: string, checkCancelled: () => void) {
  if (process.platform !== 'win32') return { status: 'unavailable' as const, text: null };
  const controller = new AbortController();
  const timer = setInterval(() => {
    try {
      checkCancelled();
    } catch {
      controller.abort();
    }
  }, 50);
  timer.unref();
  try {
    checkCancelled();
    const info = await stat(filePath);
    if (!info.isFile() || info.size <= 0 || info.size > 25 * 1024 * 1024)
      return { status: 'tooLarge' as const, text: null };
    const bytes = await readFile(filePath, { signal: controller.signal });
    checkCancelled();
    const result = await recognizeWindowsImage(bytes, controller.signal);
    checkCancelled();
    if (result.status !== 'ready') return { status: result.status, text: null };
    const text = result.lines
      .map((line) =>
        line.words
          .map((word) => word.text)
          .join(' ')
          .replace(/([\p{Script=Han}]) +(?=[\p{Script=Han}])/gu, '$1'),
      )
      .join('\n');
    return text.length <= 250_000 ? { status: 'ready' as const, text } : { status: 'tooLarge' as const, text: null };
  } catch {
    checkCancelled();
    return { status: 'failed' as const, text: null };
  } finally {
    clearInterval(timer);
    controller.abort();
  }
}
