import { textCoverSourceSchema, type TextCoverSource } from '@/shared/contracts/text-cover-source';
import type { ArticleCoverRatio } from '@/shared/article-covers';
import type { TextCoverRecipe } from '@/renderer/features/text-covers/textCoverPresets';

export const textCoverSourceByteLimit = 64 * 1024;

export type TextCoverSourceError = 'invalid' | 'tooLarge' | 'readFailed' | 'ratioMismatch' | 'fontMissing';
export type TextCoverSourceReadResult =
  { ok: true; source: TextCoverSource } | { ok: false; error: TextCoverSourceError };

export function captureTextCoverSource(title: string, ratio: ArticleCoverRatio, recipe: TextCoverRecipe) {
  // Select known fields: preset IDs and future internal fields are not file data.
  return textCoverSourceSchema.parse({
    format: 'aiy.text-cover-source',
    version: 1,
    title,
    ratio,
    recipe: {
      layout: recipe.layout,
      decoration: recipe.decoration,
      palette: recipe.palette,
      font: recipe.font,
      weight: recipe.weight,
      scale: recipe.scale ?? 1,
      lineHeight: recipe.lineHeight ?? 1.2,
      inset: recipe.inset ?? 0.12,
    },
  });
}

function readSourceBytes(file: File, signal?: AbortSignal): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    function release() {
      settled = true;
      reader.onload = reader.onerror = reader.onabort = null;
      signal?.removeEventListener('abort', cancel);
    }
    function fail(reason: unknown) {
      if (settled) return;
      release();
      reject(reason);
    }
    function cancel() {
      fail(new DOMException('Cover parameter read cancelled', 'AbortError'));
      if (reader.readyState === FileReader.LOADING) reader.abort();
    }
    reader.onload = () => {
      if (settled) return;
      if (!(reader.result instanceof ArrayBuffer)) return fail(new Error('TEXT_COVER_SOURCE_READ_FAILED'));
      const bytes = reader.result;
      release();
      resolve(bytes);
    };
    reader.onerror = () => fail(reader.error);
    reader.onabort = () => fail(new DOMException('Cover parameter read cancelled', 'AbortError'));
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) return cancel();
    try {
      reader.readAsArrayBuffer(file);
    } catch (reason) {
      fail(reason);
    }
  });
}

export async function readTextCoverSource(file: File, signal?: AbortSignal): Promise<TextCoverSourceReadResult> {
  if (file.size > textCoverSourceByteLimit) return { ok: false, error: 'tooLarge' };
  let bytes: ArrayBuffer;
  try {
    bytes = await readSourceBytes(file, signal);
  } catch (reason) {
    if (signal?.aborted) throw reason;
    return { ok: false, error: 'readFailed' };
  }
  if (bytes.byteLength > textCoverSourceByteLimit) return { ok: false, error: 'tooLarge' };
  try {
    // Reject invalid UTF-8 instead of silently replacing characters in the title.
    // The decoder also accepts an optional UTF-8 BOM from an external editor.
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed = textCoverSourceSchema.safeParse(JSON.parse(text));
    return parsed.success ? { ok: true, source: parsed.data } : { ok: false, error: 'invalid' };
  } catch {
    return { ok: false, error: 'invalid' };
  }
}

export function requestTextCoverSourceDownload(title: string, ratio: ArticleCoverRatio, recipe: TextCoverRecipe) {
  const source = captureTextCoverSource(title, ratio, recipe);
  const blob = new Blob([`${JSON.stringify(source, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
  if (blob.size > textCoverSourceByteLimit) throw new Error('TEXT_COVER_SOURCE_TOO_LARGE');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'cover.aiy-cover.json';
  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // Do not revoke before the browser consumes the download request.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  // This requests a download; it does not confirm a disk write or update a work.
}
