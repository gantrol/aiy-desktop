import type { ComposerAdapter, ComposerElement, TextControl } from '@/lib/composer-adapters/contract';
import { isComposerElement, isVisible, normalizeDraft, readComposerText } from '@/lib/composer-adapters/dom';
import {
  WECHAT_SOCIAL_POST as config,
  WECHAT_ARTICLE,
  matchesWechatEditor,
} from '@/lib/composer-adapters/wechat-config';

function isSocialPostEditor(): boolean {
  const url = new URL(window.location.href);
  return window.top === window && matchesWechatEditor(url, config);
}

function findEditors(): ComposerElement[] {
  return isSocialPostEditor() ? [...document.querySelectorAll(config.body)].filter(isComposerElement) : [];
}

function previews(): HTMLElement[] {
  return [...document.querySelectorAll(config.mediaRoot)]
    .flatMap((root) => [...root.querySelectorAll(config.previews)])
    .filter((element): element is HTMLElement => element instanceof HTMLElement && isVisible(element));
}

function uploadedImageUrl(source: string): boolean {
  try {
    const url = new URL(source);
    return url.protocol === 'https:' && (url.hostname === 'mmbiz.qpic.cn' || url.hostname.endsWith('.qpic.cn'));
  } catch {
    return false;
  }
}

const backgroundPreviews = new WeakMap<HTMLElement, { source: string; image: HTMLImageElement }>();

function previewLoaded(element: HTMLElement): boolean {
  if (element instanceof HTMLImageElement)
    return uploadedImageUrl(element.currentSrc || element.src) && element.complete && element.naturalWidth > 0;
  const background = window.getComputedStyle(element).backgroundImage;
  const source = /^url\(["']?(.*?)["']?\)$/u.exec(background)?.[1];
  if (!source || !uploadedImageUrl(source)) return false;
  let preview = backgroundPreviews.get(element);
  if (preview?.source !== source) {
    const image = new Image();
    image.src = source;
    preview = { source, image };
    backgroundPreviews.set(element, preview);
  }
  return preview.image.complete && preview.image.naturalWidth > 0;
}

const navigationAttempts = new WeakMap<HTMLElement, string>();

export async function openWechatComposer(handoffId: string, contentKind: 'social-post-body' | 'article-body') {
  const selected = contentKind === 'article-body' ? WECHAT_ARTICLE : config;
  // Never navigate away from an existing editor, including the other content type.
  if (window.top !== window || window.location.pathname === selected.editorPath) return false;
  const entries = [...document.querySelectorAll<HTMLElement>(selected.menuContent)].filter(
    (element) => isVisible(element) && element.innerText.trim() === selected.menuLabel,
  );
  const entry = entries.length === 1 ? entries[0] : null;
  if (!entry || navigationAttempts.get(entry) === handoffId) return false;
  navigationAttempts.set(entry, handoffId);
  const opened =
    (await browser.runtime
      .sendMessage({ kind: 'open-wechat-social-post', handoffId, contentKind })
      .catch(() => false)) === true;
  if (!opened) navigationAttempts.delete(entry);
  return opened;
}

export function readWechatComposerText(editor: TextControl, placeholder: string): string {
  if (editor.querySelector(placeholder)) {
    const clone = editor.cloneNode(true);
    if (clone instanceof HTMLElement) {
      clone.querySelectorAll(placeholder).forEach((placeholder) => placeholder.remove());
      if (!clone.textContent?.trim()) return '';
    }
  }
  return readComposerText(editor);
}

export const wechatComposerAdapter: ComposerAdapter = {
  findEditors,
  async writeText(editor, draft) {
    // The share editor has an inline ProseMirror schema. Native paste retains
    // hard breaks; replacing its DOM text lets the next transaction flatten them.
    const content = document.createElement('p');
    draft
      .replaceAll('\r\n', '\n')
      .split('\n')
      .forEach((line, index) => {
        if (index) content.append(document.createElement('br'));
        content.append(document.createTextNode(line));
      });
    editor.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const transfer = new DataTransfer();
    transfer.setData('text/plain', draft);
    transfer.setData('text/html', content.outerHTML);
    const unhandled = editor.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
    if (unhandled && !document.execCommand('insertHTML', false, content.outerHTML)) return false;
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    return normalizeDraft(readComposerText(editor)) === normalizeDraft(draft);
  },
  hasExistingMedia() {
    return previews().length > 0;
  },
  readText(editor) {
    return readWechatComposerText(editor, config.placeholder);
  },
  findTitle() {
    const titles = [...document.querySelectorAll(config.title)].filter(isComposerElement);
    return titles.length === 1 ? (titles[0] ?? null) : null;
  },
  findMediaInput() {
    if (!isSocialPostEditor()) return null;
    const inputs = [...document.querySelectorAll<HTMLInputElement>(config.upload)].filter(
      (input) => !input.disabled && input.multiple,
    );
    return inputs.length === 1 ? (inputs[0] ?? null) : null;
  },
  requestMediaInput() {
    // The scoped WebUploader input exists before choosing a file. Never fall
    // back to the hidden article-body or cover-image upload controls.
  },
  async openComposer(handoffId) {
    return openWechatComposer(handoffId, 'social-post-body');
  },
  captureMedia() {
    return isSocialPostEditor() ? { elements: new Set(previews()) } : null;
  },
  async confirmMedia(files, snapshot, timeoutMs) {
    if (files.length === 0) return true;
    if (!snapshot) return false;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const root = document.querySelector(config.mediaRoot);
      if (!root || /上传失败|上传出错|文件过大/.test(root.textContent ?? '')) return false;
      const uploaded = previews().filter((element) => !snapshot.elements.has(element));
      if (uploaded.length > files.length) return false;
      if (uploaded.length === files.length && uploaded.every(previewLoaded)) return true;
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    return false;
  },
};
