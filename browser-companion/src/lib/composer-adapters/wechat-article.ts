import type { ComposerAdapter, ComposerElement } from '@/lib/composer-adapters/contract';
import { isComposerElement, setMediaFiles } from '@/lib/composer-adapters/dom';
import { fillWechatArticleCover, hasWechatArticleCover } from '@/lib/composer-adapters/wechat-cover';
import { WECHAT_ARTICLE as config, matchesWechatEditor } from '@/lib/composer-adapters/wechat-config';
import { openWechatComposer, readWechatComposerText } from '@/lib/composer-adapters/wechat';

function findEditors(): ComposerElement[] {
  const url = new URL(window.location.href);
  if (window.top !== window || !matchesWechatEditor(url, config)) return [];
  return [...document.querySelectorAll(config.body)].filter(isComposerElement);
}

function findMediaInput(): HTMLInputElement | null {
  const inputs = [...document.querySelectorAll<HTMLInputElement>(config.upload)].filter(
    (input) => !input.disabled && !input.closest('.image-selector,#js_cover,.js_cover,.cover') && input.isConnected,
  );
  // Multiple unscoped controls could include a cover uploader. Fail closed.
  return inputs.length === 1 ? inputs[0]! : null;
}

function textOf(root: Node): string {
  const clone = root.cloneNode(true);
  if (clone instanceof Element) clone.querySelectorAll(config.placeholder).forEach((node) => node.remove());
  return (clone.textContent ?? '').replace(/\s+/gu, ' ').trim();
}

function loadedImage(image: HTMLImageElement): boolean {
  try {
    const url = new URL(image.src);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'mmbiz.qpic.cn' || url.hostname.endsWith('.qpic.cn')) &&
      /^[1-9]\d*$/u.test(image.getAttribute('data-imgfileid') ?? '') &&
      image.complete &&
      image.naturalWidth > 0
    );
  } catch {
    return false;
  }
}

function articleImages(root: ParentNode): HTMLImageElement[] {
  // ProseMirror inserts a src-less separator image beside an inline node.
  return [...root.querySelectorAll<HTMLImageElement>('img:not(.ProseMirror-separator)')];
}

function selectPlaceholder(editor: HTMLElement, placeholder: string): boolean {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  let match: { node: Node; offset: number } | null = null;
  while ((node = walker.nextNode())) {
    const text = node.textContent ?? '';
    const offset = text.indexOf(placeholder);
    if (offset < 0) continue;
    if (match || text.lastIndexOf(placeholder) !== offset) return false;
    match = { node, offset };
  }
  if (!match) return false;
  editor.focus({ preventScroll: true });
  const range = document.createRange();
  range.setStart(match.node, match.offset);
  range.setEnd(match.node, match.offset + placeholder.length);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return selection?.toString() === placeholder;
}

const allowedTags = new Set([
  'SECTION',
  'DIV',
  'P',
  'SPAN',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'STRONG',
  'B',
  'EM',
  'I',
  'S',
  'DEL',
  'U',
  'A',
  'BR',
  'HR',
  'BLOCKQUOTE',
  'UL',
  'OL',
  'LI',
  'PRE',
  'CODE',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TH',
  'TD',
  'SUP',
  'SUB',
  'IMG',
]);
const allowedAttributes = new Set([
  'style',
  'href',
  'title',
  'alt',
  'width',
  'height',
  'start',
  'colspan',
  'rowspan',
  'src',
]);

function prepareArticle(html: string, fileCount: number, coverMediaIndex?: number) {
  if (
    coverMediaIndex !== undefined &&
    (!Number.isInteger(coverMediaIndex) || coverMediaIndex < 0 || coverMediaIndex >= fileCount)
  )
    return null;
  const template = document.createElement('template');
  template.innerHTML = html;
  const uploads: { placeholder: string; fileIndex: number }[] = [];
  const prefix = `AIY_IMAGE_${crypto.randomUUID().replaceAll('-', '')}_`;
  for (const element of template.content.querySelectorAll('*')) {
    if (!allowedTags.has(element.tagName)) return null;
    for (const attribute of [...element.attributes]) {
      if (!allowedAttributes.has(attribute.name)) element.removeAttribute(attribute.name);
      if (attribute.name === 'style' && /url\s*\(|@import|expression\s*\(/iu.test(attribute.value)) return null;
      if (attribute.name === 'href' && !/^https:\/\//iu.test(attribute.value)) element.removeAttribute(attribute.name);
      if (attribute.name === 'src' && element.tagName !== 'IMG') return null;
    }
    if (element.tagName !== 'IMG') continue;
    const index = /^aiy-handoff-media:(\d+)$/u.exec(element.getAttribute('src') ?? '');
    if (!index || Number(index[1]) >= fileCount || uploads.length >= 100) return null;
    const placeholder = `${prefix}${uploads.length}_END`;
    uploads.push({ placeholder, fileIndex: Number(index[1]) });
    element.replaceWith(document.createTextNode(placeholder));
  }
  const referencedFiles = new Set(uploads.map((item) => item.fileIndex));
  if (coverMediaIndex !== undefined) referencedFiles.add(coverMediaIndex);
  if (referencedFiles.size !== fileCount) return null;
  const expectedWithPlaceholders = textOf(template.content);
  return { html: template.innerHTML, uploads, expectedWithPlaceholders };
}

export const wechatArticleComposerAdapter: ComposerAdapter = {
  findEditors,
  readText(editor) {
    return readWechatComposerText(editor, config.placeholder);
  },
  findTitle() {
    const candidates = [...document.querySelectorAll(config.title)].filter(isComposerElement);
    return candidates.length === 1 ? candidates[0]! : null;
  },
  hasExistingMedia(editor) {
    return (
      hasWechatArticleCover() || editor.querySelector('img:not(.ProseMirror-separator),video,audio,iframe') !== null
    );
  },
  acceptsMedia(files) {
    return files.every((file) => ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type));
  },
  findMediaInput,
  requestMediaInput() {},
  openComposer(handoffId) {
    return openWechatComposer(handoffId, 'article-body');
  },
  async fillArticle(editor, html, files, coverMediaIndex) {
    const article = prepareArticle(html, files.length, coverMediaIndex);
    if (!article) return 'INVALID_REQUEST';
    if (files.length && !findMediaInput()) return 'MEDIA_INPUT_NOT_FOUND';
    editor.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // Use the editor's paste transaction; execCommand is the native fallback.
    // Replacing innerHTML directly would leave ProseMirror's document stale.
    const transfer = new DataTransfer();
    transfer.setData('text/html', article.html);
    transfer.setData('text/plain', article.expectedWithPlaceholders);
    const unhandled = editor.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
    if (unhandled && !document.execCommand('insertHTML', false, article.html)) return 'FILL_FAILED';
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    if (textOf(editor) !== article.expectedWithPlaceholders) return 'FILL_FAILED';

    const deadline = Date.now() + 8 * 60_000;
    let uploadedCount = 0;
    for (const upload of article.uploads) {
      if (!editor.isConnected || !selectPlaceholder(editor, upload.placeholder)) return 'FILL_FAILED';
      // The uploader reads ProseMirror's selection. Let its selection observer
      // consume the DOM range before deleting the marker or opening an upload.
      document.dispatchEvent(new Event('selectionchange'));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      if (window.getSelection()?.toString() !== upload.placeholder) return 'FILL_FAILED';
      const input = findMediaInput();
      if (!input) return 'MEDIA_FILL_FAILED';
      if (!document.execCommand('delete') || textOf(editor).includes(upload.placeholder)) return 'FILL_FAILED';
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      // WeChat's native image-paste plugin starts its remote upload pipeline.
      // The toolbar can insert a local data URL without starting that pipeline.
      const imageTransfer = new DataTransfer();
      imageTransfer.items.add(files[upload.fileIndex]!);
      const unhandledImage = editor.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: imageTransfer,
          bubbles: true,
          cancelable: true,
        }),
      );
      if (unhandledImage) {
        input.value = '';
        if (!setMediaFiles(input, [files[upload.fileIndex]!])) return 'MEDIA_FILL_FAILED';
      }
      const imageDeadline = Math.min(deadline, Date.now() + 90_000);
      let uploaded: HTMLImageElement | undefined;
      while (Date.now() < imageDeadline && editor.isConnected) {
        // The host normalizes earlier uploaded nodes and their CDN URLs.
        // Each next upload must occupy the next image position in the document.
        const currentImages = articleImages(editor);
        if (currentImages.length > uploadedCount + 1) return 'MEDIA_FILL_FAILED';
        const nextImage = currentImages[uploadedCount];
        if (nextImage && loadedImage(nextImage) && currentImages.every(loadedImage)) {
          uploaded = nextImage;
          break;
        }
        const errors = [...document.querySelectorAll('.weui-desktop-toast,.weui-desktop-toptips')];
        if (errors.some((element) => /上传失败|上传出错|文件过大/.test(element.textContent ?? '')))
          return 'MEDIA_FILL_FAILED';
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
      if (!uploaded) return 'MEDIA_FILL_FAILED';
      uploadedCount += 1;
    }
    const images = articleImages(editor);
    if (images.length !== uploadedCount || images.some((image) => !loadedImage(image))) return 'MEDIA_FILL_FAILED';
    const positioned = editor.cloneNode(true) as HTMLElement;
    articleImages(positioned).forEach((image, index) =>
      image.replaceWith(document.createTextNode(article.uploads[index]!.placeholder)),
    );
    if (textOf(positioned) !== article.expectedWithPlaceholders) return 'FILL_FAILED';
    if (coverMediaIndex !== undefined && !(await fillWechatArticleCover(files[coverMediaIndex]!)))
      return 'MEDIA_FILL_FAILED';
    return null;
  },
};
