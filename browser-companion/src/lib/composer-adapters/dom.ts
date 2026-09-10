import type { ComposerElement, TextControl } from '@/lib/composer-adapters/contract';

const EDITOR_HINT_ATTRIBUTES = ['aria-label', 'aria-placeholder', 'data-placeholder', 'placeholder'] as const;
const IMAGE_FILE_EXTENSIONS = ['.gif', '.jpeg', '.jpg', '.png', '.webp'] as const;
const MEDIA_CONTROL_SELECTOR = 'button,[role="button"],label,[tabindex],[aria-label],[title]';
const MEDIA_CONTROL_TEXT = /图片|照片|相册|文件|上传|image|photo|file|upload|attach/i;
const attemptedMediaControls = new WeakMap<HTMLElement, number>();

export function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected || element.getClientRects().length === 0) return false;
  const bounds = element.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

export function isComposerElement(element: Element): element is ComposerElement {
  if (element instanceof HTMLTextAreaElement) {
    return !element.disabled && !element.readOnly && isVisible(element);
  }

  return (
    element instanceof HTMLElement &&
    element.isContentEditable &&
    element.getAttribute('aria-disabled') !== 'true' &&
    isVisible(element)
  );
}

export function composerElements(): ComposerElement[] {
  const elements = document.querySelectorAll(
    'textarea,[contenteditable]:not([contenteditable="false"]),[role="textbox"]',
  );
  return [...elements].filter(isComposerElement);
}

export function normalizeControlLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function hasEditorHint(editor: ComposerElement, hint: string): boolean {
  const elements = [
    editor,
    ...editor.querySelectorAll<HTMLElement>(EDITOR_HINT_ATTRIBUTES.map((attribute) => `[${attribute}]`).join(',')),
  ];
  return elements.some((element) =>
    EDITOR_HINT_ATTRIBUTES.some((attribute) => element.getAttribute(attribute)?.includes(hint)),
  );
}

export function hasAnyEditorHint(editor: ComposerElement, hints: readonly string[]): boolean {
  return hints.some((hint) => hasEditorHint(editor, hint));
}

export function acceptsImages(input: HTMLInputElement): boolean {
  const accept = input.accept.toLocaleLowerCase().trim();
  if (!accept) return true;
  return accept
    .split(',')
    .map((value) => value.trim())
    .some(
      (value) =>
        value === 'image/*' ||
        value.startsWith('image/') ||
        IMAGE_FILE_EXTENSIONS.some((extension) => value === extension),
    );
}

export function usableMediaInputs(scope: ParentNode): HTMLInputElement[] {
  return [...scope.querySelectorAll<HTMLInputElement>('input[type="file"]')]
    .filter((input) => input.isConnected && !input.disabled && acceptsImages(input))
    .sort((left, right) => {
      const multipleDifference = Number(right.multiple) - Number(left.multiple);
      if (multipleDifference !== 0) return multipleDifference;
      const leftExplicit = left.accept.trim().length > 0;
      const rightExplicit = right.accept.trim().length > 0;
      return Number(rightExplicit) - Number(leftExplicit);
    });
}

export function mediaControlLabel(control: HTMLElement): string {
  return normalizeControlLabel(
    [
      control.getAttribute('aria-label'),
      control.getAttribute('title'),
      control.getAttribute('data-testid'),
      control.innerText,
      control.textContent,
    ]
      .filter((value): value is string => Boolean(value))
      .join(' '),
  );
}

export function usableMediaControl(control: HTMLElement): boolean {
  const lastAttemptedAt = attemptedMediaControls.get(control) ?? 0;
  if (Date.now() - lastAttemptedAt < 1_000 || !isVisible(control)) return false;
  if (control.getAttribute('aria-disabled') === 'true' || (control instanceof HTMLButtonElement && control.disabled)) {
    return false;
  }
  const label = mediaControlLabel(control);
  return MEDIA_CONTROL_TEXT.test(label) && !/^(发布|发微博)$/.test(normalizeControlLabel(label));
}

export function requestMediaInputWithin(scope: ParentNode): boolean {
  const control = [...scope.querySelectorAll<HTMLElement>(MEDIA_CONTROL_SELECTOR)].find(usableMediaControl);
  if (!control) return false;
  attemptedMediaControls.set(control, Date.now());
  control.click();
  return true;
}

export function focusComposer(editor: TextControl): void {
  editor.focus({ preventScroll: true });
}

export function readComposerText(editor: TextControl): string {
  if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) return editor.value;
  return editor.innerText ?? editor.textContent ?? '';
}

export function normalizeDraft(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

export function setNativeTextValue(editor: HTMLInputElement | HTMLTextAreaElement, draft: string): void {
  const prototype = editor instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(editor, draft);
  editor.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: draft,
    }),
  );
}

export function clearComposer(editor: TextControl): boolean {
  if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
    setNativeTextValue(editor, '');
  } else {
    editor.replaceChildren();
  }
  editor.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      inputType: 'deleteContent',
    }),
  );
  return normalizeDraft(readComposerText(editor)).length === 0;
}

export function setTextControlValue(editor: TextControl, draft: string): void {
  if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
    setNativeTextValue(editor, draft);
    focusComposer(editor);
    return;
  }
  setContentEditableValue(editor, draft);
}

export function setContentEditableValue(editor: HTMLElement, draft: string): void {
  editor.focus({ preventScroll: true });

  function moveCaretToEnd(): void {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  moveCaretToEnd();
  const inserted = document.execCommand('insertText', false, draft);
  if (inserted && normalizeDraft(readComposerText(editor)) === normalizeDraft(draft)) {
    return;
  }

  editor.replaceChildren(document.createTextNode(draft));
  moveCaretToEnd();
  editor.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: draft,
    }),
  );
}

export function setMediaFiles(input: HTMLInputElement, files: readonly File[]): boolean {
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
  descriptor?.set?.call(input, transfer.files);
  const assigned = input.files;
  if (!assigned || assigned.length !== files.length) return false;
  for (let index = 0; index < files.length; index += 1) {
    if (assigned[index]?.name !== files[index]?.name || assigned[index]?.size !== files[index]?.size) return false;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}
