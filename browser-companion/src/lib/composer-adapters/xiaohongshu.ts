import type {
  ComposerAdapter,
  ComposerElement,
  ComposerMediaSnapshot,
  TextControl,
} from '@/lib/composer-adapters/contract';
import {
  isComposerElement,
  isVisible,
  normalizeDraft,
  readComposerText,
  setMediaFiles,
  usableMediaInputs,
} from '@/lib/composer-adapters/dom';
import type { FillDraftErrorCode } from '@/lib/protocol';

// Creator image-post flow; selectors are deliberately separate from the video/long-article editors.
const EDITOR_SELECTOR =
  '.tiptap.ProseMirror[contenteditable="true"],.ql-editor[contenteditable="true"],.edit-container [role="textbox"][contenteditable="true"]';
const TITLE_SELECTOR = 'input[placeholder*="标题"],.title-container input,.title-container textarea';
const PREVIEW_SELECTOR = '.img-preview-area .pr';
const UPLOAD_WAIT_MS = 90_000;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const attemptedTabs = new WeakSet<HTMLElement>();

function imagePostPage(): boolean {
  return (
    window.top === window &&
    location.origin === 'https://creator.xiaohongshu.com' &&
    location.pathname === '/publish/publish' &&
    new URL(location.href).searchParams.get('target') === 'image'
  );
}

function findEditors(): ComposerElement[] {
  return imagePostPage() ? [...document.querySelectorAll(EDITOR_SELECTOR)].filter(isComposerElement) : [];
}

function findTitle(): TextControl | null {
  if (!imagePostPage()) return null;
  const controls = [...document.querySelectorAll(TITLE_SELECTOR)].filter(
    (element): element is HTMLInputElement | HTMLTextAreaElement =>
      (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
      !element.disabled &&
      !element.readOnly &&
      isVisible(element),
  );
  return controls.length === 1 ? controls[0]! : null;
}

function previews(): HTMLElement[] {
  return imagePostPage() ? [...document.querySelectorAll<HTMLElement>(PREVIEW_SELECTOR)].filter(isVisible) : [];
}

function readText(control: TextControl): string {
  if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) return readComposerText(control);
  const blocks = [...control.children];
  if (!blocks.length || blocks.some((block) => !['P', 'DIV'].includes(block.tagName))) return readComposerText(control);
  // ProseMirror paragraphs add layout spacing to innerText. Read their actual line breaks instead.
  function nodeText(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node instanceof HTMLBRElement) return '\n';
    return [...node.childNodes].map(nodeText).join('');
  }
  return blocks
    .map((block) => (block.childNodes.length === 1 && block.firstChild instanceof HTMLBRElement ? '' : nodeText(block)))
    .join('\n');
}

async function writeText(control: TextControl, text: string, replaceExisting: boolean): Promise<boolean> {
  if (!imagePostPage() || !isVisible(control)) return false;
  if (!replaceExisting && normalizeDraft(readText(control))) return false;
  control.focus({ preventScroll: true });
  if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
    control.select();
  } else {
    const range = document.createRange();
    range.selectNodeContents(control);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  // Use the browser's editing command so Vue/ProseMirror observe input. A DOM-only
  // value/innerHTML assignment can look filled while leaving the saved title empty.
  if (!document.execCommand('insertText', false, text)) return false;
  control.dispatchEvent(new Event('change', { bubbles: true }));
  control.blur();
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  return control.isConnected && normalizeDraft(readText(control)) === normalizeDraft(text);
}

function findMediaInput(): HTMLInputElement | null {
  if (!imagePostPage()) return null;
  const inputs = usableMediaInputs(document).filter((input) => input.accept.trim().length > 0);
  const initial = inputs.filter((input) => input.matches('.upload-input'));
  // The editor has both append (multiple) and replace-one inputs. Only append
  // accepts the remaining handoff images without replacing the selected image.
  const candidates = initial.length ? initial : inputs.filter((input) => input.multiple);
  return candidates.length === 1 ? candidates[0]! : null;
}

function requestImageTab(): void {
  if (!imagePostPage() || findMediaInput() || previews().length || findEditors().length) return;
  const tabs = [...document.querySelectorAll<HTMLElement>('.creator-tab')].filter((tab) => {
    if (!isVisible(tab) || tab.closest('[aria-hidden="true"]') || tab.textContent?.trim() !== '上传图文') return false;
    const bounds = tab.getBoundingClientRect();
    return Number(window.getComputedStyle(tab).opacity) > 0.01 && bounds.right > 0 && bounds.bottom > 0;
  });
  const tab = tabs.length === 1 ? tabs[0] : null;
  if (!tab || attemptedTabs.has(tab)) return;
  attemptedTabs.add(tab);
  tab.click();
}

function uploadState(count: number, snapshot: ComposerMediaSnapshot): 'ready' | 'waiting' | 'failed' {
  if (!imagePostPage()) return 'failed';
  const root = document.querySelector<HTMLElement>('.img-preview-area');
  if (!root) return 'waiting';
  if (/上传失败|上传出错|文件过大|图片异常/.test(root.innerText)) return 'failed';
  const added = previews().filter((element) => !snapshot.elements.has(element));
  if (added.length > count) return 'failed';
  const busy =
    [...root.querySelectorAll<HTMLElement>('.uploading,.upload-progress,[role="progressbar"],[aria-busy="true"]')].some(
      isVisible,
    ) || /上传中|正在上传|处理中/.test(root.innerText);
  const loaded = added.every((element) => {
    const image = element.querySelector('img');
    return image
      ? image.complete && image.naturalWidth > 0
      : window.getComputedStyle(element).backgroundImage !== 'none';
  });
  return !busy && added.length === count && loaded ? 'ready' : 'waiting';
}

async function waitForUploads(count: number, snapshot: ComposerMediaSnapshot, deadline: number): Promise<boolean> {
  let readySince: number | null = null;
  while (Date.now() < deadline) {
    const state = uploadState(count, snapshot);
    if (state === 'failed') return false;
    if (state === 'ready') {
      readySince ??= Date.now();
      if (Date.now() - readySince >= 500) return true;
    } else readySince = null;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }
  return false;
}

export const xiaohongshuComposerAdapter: ComposerAdapter = {
  findEditors,
  findTitle,
  readText,
  writeText,
  writeTitle: writeText,
  findMediaInput,
  requestMediaInput() {},
  validateDraft(draft, title) {
    const titleWidth = [...(title ?? '').trim()].reduce(
      (width, character) => width + (character.codePointAt(0)! <= 0xff ? 1 : 2),
      0,
    );
    if (titleWidth > 40) return 'XIAOHONGSHU_TITLE_TOO_LONG';
    if ([...normalizeDraft(draft)].length > 1_000) return 'XIAOHONGSHU_BODY_TOO_LONG';
    return null;
  },
  async prepareMedia(files, options) {
    const failure = (code: FillDraftErrorCode) => ({
      ok: false as const,
      code,
    });
    if (location.origin === 'https://creator.xiaohongshu.com' && location.pathname.startsWith('/login'))
      return failure('XIAOHONGSHU_LOGIN_REQUIRED');
    if (
      !files.length ||
      files.length > 18 ||
      files.some((file) => !IMAGE_TYPES.has(file.type) || file.size === 0 || file.size > 32 * 1024 * 1024)
    )
      return failure('XIAOHONGSHU_MEDIA_UNSUPPORTED');
    if (!imagePostPage()) return failure('COMPOSER_NOT_FOUND');
    const existing = findEditors();
    if (existing.length > 1) return failure('COMPOSER_AMBIGUOUS');
    if (previews().length) return failure('COMPOSER_HAS_MEDIA');
    const title = findTitle();
    if (
      !options.replaceExisting &&
      ((existing[0] && normalizeDraft(readText(existing[0]))) || (title && normalizeDraft(readText(title))))
    )
      return failure('COMPOSER_NOT_EMPTY');
    requestImageTab();
    let input = findMediaInput();
    if (!input) return failure('MEDIA_INPUT_NOT_FOUND');
    const snapshot = { elements: new Set<Element>() };
    const deadline = Date.now() + UPLOAD_WAIT_MS;
    // The first upload mounts the editor and replaces the file input. Upload in
    // order, reacquiring that input each time, so the first image remains the cover.
    for (let index = 0; index < files.length; index += 1) {
      input = findMediaInput();
      if (!input || !setMediaFiles(input, [files[index]!])) return failure('MEDIA_FILL_FAILED');
      if (!(await waitForUploads(index + 1, snapshot, deadline))) return failure('MEDIA_FILL_FAILED');
    }
    while (Date.now() < deadline) {
      const editors = findEditors();
      if (editors.length === 1 && findTitle()) return { ok: true, editor: editors[0]! };
      if (!imagePostPage() || editors.length > 1) break;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
    }
    return failure('MEDIA_FILL_FAILED');
  },
  captureMedia() {
    return imagePostPage() ? { elements: new Set(previews()) } : null;
  },
  async confirmMedia(files, snapshot, timeoutMs) {
    if (!files.length) return true;
    return snapshot !== null && (await waitForUploads(files.length, snapshot, Date.now() + timeoutMs));
  },
};
