import type {
  CreatorImageImportItemInput,
  CreatorImageStagePreviewRow,
  ImportedCreationOutputDto,
} from '@/shared/contracts';
import { creatorImageImportMimeTypeSchema } from '@/shared/contracts/creator-import';

export type RendererImageImportSource = 'PASTE' | 'DROP' | 'UPLOAD';

export type RendererImageImportItem = CreatorImageImportItemInput;
export type RendererImageImportPreviewRow = Omit<CreatorImageStagePreviewRow, 'previewUrl'> & {
  displayName: string;
  promptVersionId: string | null;
  newVersionNo?: number;
  source: RendererImageImportSource;
  sourceUrl: string;
  previewUrl: string | null;
};

export type ImportVersionAssignment = Pick<RendererImageImportPreviewRow, 'promptVersionId' | 'newVersionNo'>;

const maxImageBytes = 25 * 1024 * 1024;
const maxImages = 8;
const imageTypeByExtension = new Map<string, RendererImageImportItem['mimeType']>([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'],
  ['gif', 'image/gif'],
  ['svg', 'image/svg+xml'],
]);

export function imageMimeType(file: File): RendererImageImportItem['mimeType'] | null {
  const mimeType = creatorImageImportMimeTypeSchema.safeParse(file.type);
  if (mimeType.success) return mimeType.data;
  return imageTypeByExtension.get(file.name.split('.').pop()?.toLowerCase() ?? '') ?? null;
}

export function imageFiles(files: FileList | File[]): File[] {
  return [...files];
}

export function clipboardImageFiles(clipboard: DataTransfer): File[] {
  const itemFiles = [...clipboard.items]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .flatMap((item) => item.getAsFile() ?? []);
  return imageFiles(itemFiles.length ? itemFiles : clipboard.files);
}

export function clipboardHasImagePayload(clipboard: DataTransfer) {
  if ([...clipboard.items].some((item) => item.kind === 'file' && item.type.startsWith('image/'))) return true;

  const html = clipboard.getData('text/html');
  if (html) {
    const document = new DOMParser().parseFromString(html, 'text/html');
    if (document.querySelector('img, picture, source')) return true;
  }
  return false;
}

export function clipboardHasUserText(clipboard: DataTransfer) {
  const html = clipboard.getData('text/html');
  if (html) {
    const document = new DOMParser().parseFromString(html, 'text/html');
    document.querySelectorAll('img, picture, source').forEach((element) => element.remove());
    if (document.body.textContent?.trim()) return true;
  }

  const text = clipboard.getData('text/plain').trim();
  if (!text) return false;
  if (httpUrl(text)) return false;
  return !/^(?:[a-zA-Z]:[\\/]|file:\/\/).+\.(?:avif|gif|jpe?g|png|svg|webp)$/iu.test(text);
}

function httpUrl(value: string | null | undefined) {
  if (!value) return '';
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export function transferSourceUrl(transfer: DataTransfer) {
  const uri = transfer
    .getData('text/uri-list')
    .split(/\r?\n/)
    .find((line) => line && !line.startsWith('#'));
  const direct = httpUrl(uri) || httpUrl(transfer.getData('text/plain'));
  if (direct) return direct;
  const html = transfer.getData('text/html');
  if (!html) return '';
  const document = new DOMParser().parseFromString(html, 'text/html');
  return (
    httpUrl(document.querySelector('img')?.getAttribute('src')) ||
    httpUrl(document.querySelector('a')?.getAttribute('href'))
  );
}

export async function imageImportItems(files: File[]): Promise<RendererImageImportItem[]> {
  if (!files.length) return [];
  if (files.length > maxImages) throw new Error(`Import supports at most ${maxImages} images`);
  const unsupported = files.find((file) => !imageMimeType(file));
  if (unsupported) throw new Error(`Unsupported image: ${unsupported.name}`);
  const invalidSize = files.find((file) => file.size <= 0 || file.size > maxImageBytes);
  if (invalidSize) throw new Error(`Image must be 25 MB or smaller: ${invalidSize.name}`);
  const items: RendererImageImportItem[] = [];
  for (const file of files) {
    items.push({
      id: crypto.randomUUID(),
      name: file.name || 'image',
      mimeType: imageMimeType(file)!,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  }
  return items;
}

export function appendPastedText(current: string, pasted: string): string {
  const value = pasted.trim();
  if (!value) return current;
  if (!current.trim()) return value;
  return `${current.trimEnd()}\n\n${value}`;
}

export function importedGenerationTextType(
  aiGeneratedStatus: ImportedCreationOutputDto['aiGeneratedStatus'],
): ImportedCreationOutputDto['generationTextType'] {
  return aiGeneratedStatus === 'YES' ? 'EXACT_PROMPT' : 'DESCRIPTION';
}

export function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}
