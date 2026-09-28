import type { ComposerAdapter, ComposerElement, ComposerMediaSnapshot } from '@/lib/composer-adapters/contract';
import {
  isComposerElement,
  isVisible,
  normalizeControlLabel,
  requestMediaInputWithin,
  usableMediaInputs,
} from '@/lib/composer-adapters/dom';

const CHATGPT_SELECTORS = ['#prompt-textarea', '[data-testid="prompt-textarea"]'] as const;
const IDENTIFIED_COMPOSER_SCOPES = [
  // ChatGPT reverted to the older ProseMirror input, which is now anchored by this form.
  'form[data-chatgpt-composer]',
  '[data-type="unified-composer"]',
  '[data-testid="composer"]',
] as const;
const COMPOSER_SCOPE = `form,${IDENTIFIED_COMPOSER_SCOPES.join(',')}`;
const EDITABLE_SELECTOR = 'textarea,[contenteditable]:not([contenteditable="false"])';
const SEND_BUTTON_MARKER_SELECTOR = 'button[data-testid="send-button"],button#composer-submit-button';
const SEND_BUTTON_SELECTOR = `${SEND_BUTTON_MARKER_SELECTOR},button[type="submit"]`;

function findEditors(): ComposerElement[] {
  const candidates = new Set<ComposerElement>();
  const collect = (root: Element) => {
    if (isComposerElement(root)) candidates.add(root);
    else
      for (const element of root.querySelectorAll(EDITABLE_SELECTOR)) {
        if (isComposerElement(element)) candidates.add(element);
      }
  };
  for (const selector of CHATGPT_SELECTORS) {
    for (const element of document.querySelectorAll(selector)) collect(element);
  }
  // The prompt marker can move to a wrapper during editor hydration. Fall back only
  // inside a composer identified by its own scope or send control, never page-wide textboxes.
  for (const scope of document.querySelectorAll(IDENTIFIED_COMPOSER_SCOPES.join(','))) collect(scope);
  for (const button of document.querySelectorAll(SEND_BUTTON_MARKER_SELECTOR)) {
    const scope = button.closest(COMPOSER_SCOPE);
    if (scope) collect(scope);
  }
  return [...candidates].filter(
    (editor) => ![...candidates].some((other) => other !== editor && other.contains(editor)),
  );
}

function composerMediaScope(editor: ComposerElement): HTMLElement {
  // Attachment controls can sit beside an inner composer wrapper in the same form.
  return (
    editor.closest<HTMLElement>('form') ?? editor.closest<HTMLElement>(COMPOSER_SCOPE) ?? editor.parentElement ?? editor
  );
}

function visibleAttachmentElements(scope: HTMLElement): Element[] {
  return [
    ...scope.querySelectorAll('img,[data-testid*="attachment" i],[data-testid*="preview" i],[data-testid*="upload" i]'),
  ].filter((element) => {
    if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
    if (!(element instanceof HTMLImageElement)) return true;
    const bounds = element.getBoundingClientRect();
    return bounds.width >= 32 && bounds.height >= 32;
  });
}

function captureMedia(): ComposerMediaSnapshot | null {
  const candidates = findEditors();
  const editor = candidates.length === 1 ? candidates[0] : null;
  if (!editor) return null;
  return {
    elements: new Set(visibleAttachmentElements(composerMediaScope(editor))),
  };
}

function attachmentNamesVisible(scope: HTMLElement, files: readonly File[]): boolean {
  const searchable = normalizeControlLabel(
    [
      scope.textContent,
      ...[...scope.querySelectorAll<HTMLElement>('[aria-label],[title],[alt]')].flatMap((element) => [
        element.getAttribute('aria-label'),
        element.getAttribute('title'),
        element.getAttribute('alt'),
      ]),
    ]
      .filter((value): value is string => Boolean(value))
      .join(' '),
  ).toLocaleLowerCase();
  return files.every((file) => searchable.includes(file.name.toLocaleLowerCase()));
}

function chatGptSendReady(scope: HTMLElement): boolean {
  const button = scope.querySelector<HTMLButtonElement>(SEND_BUTTON_SELECTOR);
  return !button || (!button.disabled && button.getAttribute('aria-disabled') !== 'true');
}

function chatGptUploadFailed(scope: HTMLElement): boolean {
  const text = normalizeControlLabel(scope.textContent ?? '');
  return /upload failed|failed to upload|上传失败|无法上传/i.test(text);
}

async function confirmMedia(
  files: readonly File[],
  snapshot: ComposerMediaSnapshot | null,
  timeoutMs: number,
): Promise<boolean> {
  if (files.length === 0) return true;
  if (!snapshot) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidates = findEditors();
    const editor = candidates.length === 1 ? candidates[0] : null;
    if (editor) {
      const scope = composerMediaScope(editor);
      if (chatGptUploadFailed(scope)) return false;
      const newAttachments = visibleAttachmentElements(scope).filter((element) => !snapshot.elements.has(element));
      if (chatGptSendReady(scope) && (attachmentNamesVisible(scope, files) || newAttachments.length >= files.length)) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        return !chatGptUploadFailed(scope) && chatGptSendReady(scope);
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  return false;
}

export const chatGptComposerAdapter: ComposerAdapter = {
  findEditors,
  findMediaInput(editor) {
    const formInput = usableMediaInputs(composerMediaScope(editor))[0];
    if (formInput) return formInput;
    const inputs = usableMediaInputs(document);
    return inputs.length === 1 ? (inputs[0] ?? null) : null;
  },
  requestMediaInput(editor) {
    requestMediaInputWithin(composerMediaScope(editor));
  },
  captureMedia,
  confirmMedia,
};
