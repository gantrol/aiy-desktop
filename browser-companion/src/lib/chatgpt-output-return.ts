import { z } from 'zod';

import { companionMessage } from '@/lib/i18n';
import type { BrowserCompanionHandoff } from '@/lib/protocol';

const RETURN_CONTEXT_STORAGE_KEY = 'aiy-chatgpt-output-return-v1';
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 32_768;
const MAX_IMAGE_PIXELS = 4_096 * 4_096;
const MIN_CANDIDATE_DIMENSION = 256;

const returnContextSchema = z
  .object({
    schemaVersion: z.literal(1),
    handoffId: z.string().uuid(),
    promptText: z.string().min(1).max(10_000),
  })
  .strict();

type ReturnContext = z.infer<typeof returnContextSchema>;
type OutputMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

function readReturnContext(): ReturnContext | null {
  try {
    const stored: unknown = JSON.parse(window.sessionStorage.getItem(RETURN_CONTEXT_STORAGE_KEY) ?? 'null');
    return returnContextSchema.safeParse(stored).data ?? null;
  } catch {
    return null;
  }
}

export function rememberChatGptOutputHandoff(handoff: BrowserCompanionHandoff): boolean {
  if (
    handoff.target !== 'chatgpt' ||
    handoff.contentKind !== 'prompt' ||
    handoff.source.kind !== 'creation-draft' ||
    !handoff.source.outputTarget
  ) {
    return false;
  }
  const context = returnContextSchema.parse({
    schemaVersion: 1,
    handoffId: handoff.handoffId,
    promptText: handoff.text,
  });
  try {
    window.sessionStorage.setItem(RETURN_CONTEXT_STORAGE_KEY, JSON.stringify(context));
  } catch {
    return false;
  }
  return true;
}

export function chatGptConversationSourceUrl(): string {
  const url = new URL(window.location.href);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function visible(element: HTMLElement): boolean {
  if (!element.isConnected || element.getClientRects().length === 0) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function normalizedMessageText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function precedingUserMessage(assistant: HTMLElement): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[data-message-author-role="user"]')].findLast((message) =>
    Boolean(message.compareDocumentPosition(assistant) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
}

function assistantImage(image: HTMLImageElement, context: ReturnContext): boolean {
  if (image.closest('form') || Math.min(image.naturalWidth, image.naturalHeight) < MIN_CANDIDATE_DIMENSION) {
    return false;
  }
  const assistant = image.closest<HTMLElement>('[data-message-author-role="assistant"]');
  if (!assistant || !visible(image)) return false;
  const userMessage = precedingUserMessage(assistant);
  const promptText = normalizedMessageText(context.promptText);
  if (!userMessage || !normalizedMessageText(userMessage.textContent ?? '').includes(promptText)) {
    return false;
  }
  const bounds = image.getBoundingClientRect();
  return bounds.width >= 96 && bounds.height >= 96;
}

interface OutputReturnButtonControllerOptions {
  onSelect(image: HTMLImageElement, handoffId: string): Promise<boolean>;
}

interface OutputReturnButtonController {
  refresh(): void;
  dispose(): void;
}

export function mountChatGptOutputReturnButtons({
  onSelect,
}: OutputReturnButtonControllerOptions): OutputReturnButtonController {
  const entries = new Map<HTMLImageElement, HTMLButtonElement>();
  let frame: number | null = null;
  let disposed = false;

  function removeEntry(image: HTMLImageElement): void {
    entries.get(image)?.remove();
    entries.delete(image);
  }

  function attach(image: HTMLImageElement): void {
    if (entries.has(image)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.aiyChatgptOutputReturn = '';
    button.textContent = companionMessage('chatgptOutputReturnAction');
    button.setAttribute('aria-label', companionMessage('chatgptOutputReturnAction'));
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const context = readReturnContext();
      if (!context || button.disabled) return;
      button.disabled = true;
      button.dataset.state = 'busy';
      button.textContent = companionMessage('chatgptOutputReturning');
      void onSelect(image, context.handoffId)
        .then((completed) => {
          if (!button.isConnected) return;
          button.disabled = completed;
          button.dataset.state = completed ? 'done' : 'idle';
          button.textContent = companionMessage(completed ? 'chatgptOutputReturned' : 'chatgptOutputReturnAction');
        })
        .catch(() => {
          if (!button.isConnected) return;
          button.disabled = false;
          button.dataset.state = 'idle';
          button.textContent = companionMessage('chatgptOutputReturnAction');
        });
    });
    (document.body ?? document.documentElement).append(button);
    entries.set(image, button);
  }

  function update(): void {
    frame = null;
    if (disposed) return;
    const context = readReturnContext();
    const candidates = new Set<HTMLImageElement>();
    if (context) {
      for (const image of document.querySelectorAll<HTMLImageElement>('[data-message-author-role="assistant"] img')) {
        if (!assistantImage(image, context)) continue;
        candidates.add(image);
        attach(image);
      }
    }

    for (const [image, button] of entries) {
      if (!candidates.has(image)) {
        removeEntry(image);
        continue;
      }
      const bounds = image.getBoundingClientRect();
      if (
        bounds.bottom <= 0 ||
        bounds.top >= window.innerHeight ||
        bounds.right <= 0 ||
        bounds.left >= window.innerWidth
      ) {
        button.hidden = true;
        continue;
      }
      button.hidden = false;
      button.style.top = `${Math.max(8, bounds.top + 8)}px`;
      button.style.left = `${Math.max(8, bounds.right - button.offsetWidth - 8)}px`;
    }
  }

  function refresh(): void {
    if (disposed || frame !== null) return;
    frame = window.requestAnimationFrame(update);
  }

  const observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src'],
  });
  window.addEventListener('resize', refresh);
  window.addEventListener('scroll', refresh, true);
  window.addEventListener('load', refresh, true);
  refresh();

  return {
    refresh,
    dispose() {
      disposed = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', refresh);
      window.removeEventListener('scroll', refresh, true);
      window.removeEventListener('load', refresh, true);
      for (const image of [...entries.keys()]) removeEntry(image);
    },
  };
}

function mimeTypeFromBytes(bytes: Uint8Array): OutputMimeType | null {
  if (bytes.byteLength >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) {
    return 'image/png';
  }
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.byteLength >= 12 &&
    new TextDecoder('ascii').decode(bytes.subarray(0, 4)) === 'RIFF' &&
    new TextDecoder('ascii').decode(bytes.subarray(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

async function boundedResponseBytes(response: Response): Promise<Uint8Array> {
  if (!response.ok) throw new Error('ChatGPT image request failed');
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
    throw new Error('ChatGPT image is too large');
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('ChatGPT image is unavailable');
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let byteSize = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteSize += chunk.value.byteLength;
      if (byteSize > MAX_IMAGE_BYTES) throw new Error('ChatGPT image is too large');
      chunks.push(new Uint8Array(chunk.value));
    }
  } finally {
    reader.releaseLock();
  }
  if (!byteSize) throw new Error('ChatGPT image is empty');
  const bytes = new Uint8Array(byteSize);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function assertDecodeable(blob: Blob): Promise<void> {
  const bitmap = await createImageBitmap(blob);
  try {
    if (
      bitmap.width < 1 ||
      bitmap.height < 1 ||
      bitmap.width > MAX_IMAGE_DIMENSION ||
      bitmap.height > MAX_IMAGE_DIMENSION ||
      bitmap.width * bitmap.height > MAX_IMAGE_PIXELS
    ) {
      throw new Error('ChatGPT image dimensions are unsupported');
    }
  } finally {
    bitmap.close();
  }
}

function outputFileName(mimeType: OutputMimeType): string {
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
  return `chatgpt-cover-${Date.now()}.${extension}`;
}

async function fetchedImageFile(image: HTMLImageElement): Promise<File> {
  const source = image.currentSrc || image.src;
  const url = new URL(source, window.location.href);
  if (url.protocol !== 'https:' && url.protocol !== 'blob:') {
    throw new Error('ChatGPT image URL is unsupported');
  }
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'include',
    redirect: 'follow',
  });
  const bytes = await boundedResponseBytes(response);
  const mimeType = mimeTypeFromBytes(bytes);
  if (!mimeType) throw new Error('ChatGPT image format is unsupported');
  const ownedBytes = new Uint8Array(bytes.byteLength);
  ownedBytes.set(bytes);
  const blob = new Blob([ownedBytes.buffer], { type: mimeType });
  await assertDecodeable(blob);
  return new File([blob], outputFileName(mimeType), { type: mimeType });
}

async function renderedImageFile(image: HTMLImageElement): Promise<File> {
  if (
    image.naturalWidth < 1 ||
    image.naturalHeight < 1 ||
    image.naturalWidth > MAX_IMAGE_DIMENSION ||
    image.naturalHeight > MAX_IMAGE_DIMENSION ||
    image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS
  ) {
    throw new Error('ChatGPT image dimensions are unsupported');
  }
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('ChatGPT image could not be read');
  context.drawImage(image, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('ChatGPT image could not be encoded'))),
        'image/png',
      );
    } catch (reason) {
      reject(reason);
    }
  });
  if (blob.size <= 0 || blob.size > MAX_IMAGE_BYTES) throw new Error('ChatGPT image is too large');
  await assertDecodeable(blob);
  return new File([blob], outputFileName('image/png'), {
    type: 'image/png',
  });
}

export async function readChatGptOutputFile(image: HTMLImageElement): Promise<File> {
  try {
    return await fetchedImageFile(image);
  } catch {
    return renderedImageFile(image);
  }
}
