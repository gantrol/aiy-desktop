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

const svgTags = new Set(['SVG', 'G', 'RECT', 'TEXT', 'IMAGE', 'ANIMATE']);
const svgAttributes = new Set([
  'xmlns',
  'xmlns:xlink',
  'id',
  'width',
  'height',
  'viewbox',
  'preserveaspectratio',
  'style',
  'data-aiy-interaction',
  'opacity',
  'fill',
  'x',
  'y',
  'font-size',
  'font-family',
  'href',
  'xlink:href',
  'attributename',
  'from',
  'to',
  'begin',
  'dur',
  'restart',
]);

function handoffMediaIndex(value: string | null, fileCount: number) {
  const match = /^aiy-handoff-media:(\d+)$/u.exec(value ?? '');
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 && index < fileCount ? index : null;
}

function extractInteractiveArticle(html: string) {
  const input = document.createElement('template');
  input.innerHTML = html;
  const fallbacks = input.content.querySelectorAll('template[data-aiy-static]');
  if (!fallbacks.length) return { staticHtml: html, interactiveHtml: null };
  if (fallbacks.length !== 1 || input.content.lastElementChild !== fallbacks[0]) return null;
  const staticHtml = fallbacks[0]!.innerHTML;
  fallbacks[0]!.remove();
  return { staticHtml, interactiveHtml: input.innerHTML };
}

function prepareInteractiveArticle(html: string, fileCount: number) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const svgRoots = template.content.querySelectorAll('svg[data-aiy-interaction]');
  if (!svgRoots.length || svgRoots.length > 30) return null;
  for (const element of template.content.querySelectorAll('*')) {
    const tag = element.tagName.toUpperCase();
    const svg = element.namespaceURI === 'http://www.w3.org/2000/svg';
    if (svg ? !svgTags.has(tag) : !allowedTags.has(tag)) return null;
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (svg ? !svgAttributes.has(name) : !allowedAttributes.has(name)) return null;
      if (name === 'style' && /url\s*\(|@import|expression\s*\(/iu.test(attribute.value)) return null;
      if (name === 'href' && tag === 'A' && !/^https:\/\//iu.test(attribute.value)) return null;
    }
    if (tag === 'IMG' && handoffMediaIndex(element.getAttribute('src'), fileCount) === null) return null;
    if (tag === 'IMAGE') {
      const href = element.getAttribute('href');
      if (handoffMediaIndex(href, fileCount) === null || href !== element.getAttribute('xlink:href')) return null;
    }
    if (tag === 'SVG' && !['details', 'reveal'].includes(element.getAttribute('data-aiy-interaction') ?? ''))
      return null;
    if (tag === 'ANIMATE') {
      const svgId = element.closest('svg')?.getAttribute('id');
      if (
        !svgId ||
        !/^aiy_interaction_[a-z0-9_]+$/u.test(svgId) ||
        !['opacity', 'height', 'viewBox'].includes(element.getAttribute('attributeName') ?? '') ||
        element.getAttribute('begin') !== `${svgId}.click` ||
        element.getAttribute('restart') !== 'never' ||
        element.getAttribute('fill') !== 'freeze' ||
        !/^(?:0\.2|0\.25)s$/u.test(element.getAttribute('dur') ?? '') ||
        !/^[\d. ]+$/u.test(element.getAttribute('from') ?? '') ||
        !/^[\d. ]+$/u.test(element.getAttribute('to') ?? '')
      )
        return null;
    }
  }
  return { template, svgCount: svgRoots.length };
}

function substituteUploadedImages(
  prepared: NonNullable<ReturnType<typeof prepareInteractiveArticle>>,
  uploadedByIndex: ReadonlyMap<number, HTMLImageElement>,
  fileCount: number,
) {
  const { template } = prepared;
  for (const image of template.content.querySelectorAll('img')) {
    const index = handoffMediaIndex(image.getAttribute('src'), fileCount);
    const uploaded = index === null ? null : uploadedByIndex.get(index);
    if (!uploaded) return null;
    image.setAttribute('src', uploaded.src);
    const fileId = uploaded.getAttribute('data-imgfileid');
    if (fileId) image.setAttribute('data-imgfileid', fileId);
  }
  for (const image of template.content.querySelectorAll('svg image')) {
    const index = handoffMediaIndex(image.getAttribute('href'), fileCount);
    const uploaded = index === null ? null : uploadedByIndex.get(index);
    if (!uploaded) return null;
    image.setAttribute('href', uploaded.src);
    image.setAttribute('xlink:href', uploaded.src);
  }
  return { html: template.innerHTML, expectedText: textOf(template.content), svgCount: prepared.svgCount };
}

async function pasteArticleHtml(editor: HTMLElement, html: string, expectedText: string) {
  editor.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(editor);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  const transfer = new DataTransfer();
  transfer.setData('text/html', html);
  transfer.setData('text/plain', expectedText);
  const unhandled = editor.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
  );
  if (unhandled && !document.execCommand('insertHTML', false, html)) return false;
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  return textOf(editor) === expectedText;
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
      hasWechatArticleCover() || editor.querySelector('img:not(.ProseMirror-separator),svg,video,audio,iframe') !== null
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
    const source = extractInteractiveArticle(html);
    if (!source) return 'INVALID_REQUEST';
    const interactive = source.interactiveHtml ? prepareInteractiveArticle(source.interactiveHtml, files.length) : null;
    if (source.interactiveHtml && !interactive) return 'INVALID_REQUEST';
    const article = prepareArticle(source.staticHtml, files.length, coverMediaIndex);
    if (!article) return 'INVALID_REQUEST';
    if (files.length && !findMediaInput()) return 'MEDIA_INPUT_NOT_FOUND';
    // Use paste transactions so the host editor and its document stay aligned.
    if (!(await pasteArticleHtml(editor, article.html, article.expectedWithPlaceholders))) return 'FILL_FAILED';

    const deadline = Date.now() + 8 * 60_000;
    let uploadedCount = 0;
    const uploadedByIndex = new Map<number, HTMLImageElement>();
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
      uploadedByIndex.set(upload.fileIndex, uploaded);
      uploadedCount += 1;
    }
    const images = articleImages(editor);
    if (images.length !== uploadedCount || images.some((image) => !loadedImage(image))) return 'MEDIA_FILL_FAILED';
    const positioned = editor.cloneNode(true) as HTMLElement;
    articleImages(positioned).forEach((image, index) =>
      image.replaceWith(document.createTextNode(article.uploads[index]!.placeholder)),
    );
    if (textOf(positioned) !== article.expectedWithPlaceholders) return 'FILL_FAILED';
    if (interactive) {
      const final = substituteUploadedImages(interactive, uploadedByIndex, files.length);
      if (!final) return 'INVALID_REQUEST';
      const staticHtml = article.uploads.reduce(
        (current, upload) => current.replace(upload.placeholder, uploadedByIndex.get(upload.fileIndex)!.outerHTML),
        article.html,
      );
      const staticTemplate = document.createElement('template');
      staticTemplate.innerHTML = staticHtml;
      const restore = async () => {
        await pasteArticleHtml(editor, staticHtml, textOf(staticTemplate.content));
      };
      const pasted = await pasteArticleHtml(editor, final.html, final.expectedText);
      const svgRoots = editor.querySelectorAll('svg[id^="aiy_interaction_"]');
      const survived =
        pasted &&
        svgRoots.length === final.svgCount &&
        [...svgRoots].every(
          (svg) =>
            [...svg.querySelectorAll('animate')].length >= 2 &&
            [...svg.querySelectorAll('animate')].every(
              (animation) => animation.getAttribute('begin') === `${svg.getAttribute('id')}.click`,
            ),
        ) &&
        [...editor.querySelectorAll('svg image')].every((image) =>
          /^https:\/\/(?:[^/]+\.)?qpic\.cn\//u.test(
            image.getAttribute('href') || image.getAttribute('xlink:href') || '',
          ),
        ) &&
        articleImages(editor).every(loadedImage) &&
        !editor.innerHTML.includes('aiy-handoff-media:');
      if (!survived) {
        await restore();
        return 'FILL_FAILED';
      }
    }
    if (coverMediaIndex !== undefined && !(await fillWechatArticleCover(files[coverMediaIndex]!)))
      return 'MEDIA_FILL_FAILED';
    return null;
  },
};
