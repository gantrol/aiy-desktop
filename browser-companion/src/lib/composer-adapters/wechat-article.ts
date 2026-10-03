import type { ComposerAdapter, ComposerElement } from '@/lib/composer-adapters/contract';
import { isComposerElement, isVisible } from '@/lib/composer-adapters/dom';
import {
  embedWechatArticleImages,
  isWechatImageUrl,
  type UploadedWechatImage,
} from '@/lib/composer-adapters/wechat-article-media';
import { fillWechatArticleCover, hasWechatArticleCover } from '@/lib/composer-adapters/wechat-cover';
import { WECHAT_ARTICLE as config, matchesWechatEditor } from '@/lib/composer-adapters/wechat-config';
import { openWechatComposer, readWechatComposerText } from '@/lib/composer-adapters/wechat';

function findEditors(): ComposerElement[] {
  const url = new URL(window.location.href);
  if (window.top !== window || !matchesWechatEditor(url, config)) return [];
  return [...document.querySelectorAll(config.body)].filter(isComposerElement);
}

function textOf(root: Node): string {
  const clone = root.cloneNode(true);
  if (clone instanceof Element) clone.querySelectorAll(config.placeholder).forEach((node) => node.remove());
  return (clone.textContent ?? '').replace(/\s+/gu, ' ').trim();
}

function loadedImage(image: HTMLImageElement): boolean {
  return (
    isWechatImageUrl(image.src) &&
    /^[1-9]\d*$/u.test(image.getAttribute('data-imgfileid') ?? '') &&
    image.complete &&
    image.naturalWidth > 0
  );
}

function articleImages(root: ParentNode): HTMLImageElement[] {
  // ProseMirror inserts a src-less separator image beside an inline node.
  return [...root.querySelectorAll<HTMLImageElement>('img:not(.ProseMirror-separator)')];
}

async function waitForArticleText(editor: HTMLElement, expectedText: string): Promise<boolean> {
  // WeChat can inspect pasted HTML asynchronously before applying its document
  // transaction. A single event-loop turn is not a completion signal.
  const deadline = Date.now() + 10_000;
  do {
    await new Promise((resolve) => window.setTimeout(resolve, 25));
    if (!editor.isConnected) return false;
    if (textOf(editor) === expectedText) return true;
  } while (Date.now() < deadline);
  return false;
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
  const imageIndexes: number[] = [];
  for (const element of template.content.querySelectorAll('*')) {
    if (!allowedTags.has(element.tagName)) return null;
    for (const attribute of [...element.attributes]) {
      if (!allowedAttributes.has(attribute.name)) element.removeAttribute(attribute.name);
      if (attribute.name === 'style' && /url\s*\(|@import|expression\s*\(/iu.test(attribute.value)) return null;
      if (attribute.name === 'href' && !/^https:\/\//iu.test(attribute.value)) element.removeAttribute(attribute.name);
      if (attribute.name === 'src' && element.tagName !== 'IMG') return null;
    }
    if (element.tagName !== 'IMG') continue;
    const index = handoffMediaIndex(element.getAttribute('src'), fileCount);
    if (index === null || imageIndexes.length >= 100) return null;
    imageIndexes.push(index);
  }
  const referencedFiles = new Set(imageIndexes);
  if (coverMediaIndex !== undefined) referencedFiles.add(coverMediaIndex);
  if (referencedFiles.size !== fileCount) return null;
  return { template, imageIndexes, svgCount: 0 };
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
  prepared: { template: HTMLTemplateElement; svgCount: number },
  uploadedByIndex: ReadonlyMap<number, UploadedWechatImage>,
  fileCount: number,
) {
  const { template } = prepared;
  for (const image of template.content.querySelectorAll('img')) {
    const index = handoffMediaIndex(image.getAttribute('src'), fileCount);
    const uploaded = index === null ? null : uploadedByIndex.get(index);
    if (!uploaded) return null;
    image.setAttribute('src', uploaded.url);
    image.setAttribute('data-src', uploaded.url);
    image.setAttribute('data-imgfileid', uploaded.fileId);
  }
  for (const image of template.content.querySelectorAll('svg image')) {
    const index = handoffMediaIndex(image.getAttribute('href'), fileCount);
    const uploaded = index === null ? null : uploadedByIndex.get(index);
    if (!uploaded) return null;
    image.setAttribute('href', uploaded.url);
    image.setAttribute('xlink:href', uploaded.url);
  }
  return { template, html: template.innerHTML, expectedText: textOf(template.content), svgCount: prepared.svgCount };
}

async function pasteArticleHtml(editor: HTMLElement, html: string, expectedText: string) {
  const beforeContent = articleContentSequence(editor);
  editor.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(editor);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  if (!editor.isConnected || articleContentSequence(editor) !== beforeContent) return false;
  const transfer = new DataTransfer();
  transfer.setData('text/html', html);
  transfer.setData('text/plain', expectedText);
  const unhandled = editor.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
  );
  // DOM insertion can bypass the host's document model and image uploader.
  // Require WeChat to accept the complete paste transaction.
  if (unhandled) return false;
  return waitForArticleText(editor, expectedText);
}

function articleContentSequence(root: Node, matchImageIds = true): string {
  const parts: (string | { image: string } | { svgImage: string })[] = [];
  let text = '';
  const flushText = () => {
    const normalized = text.replace(/\s+/gu, ' ').trim();
    if (normalized) parts.push(normalized);
    text = '';
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node instanceof Element && node.matches(`${config.placeholder},.ProseMirror-separator`)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  let node: Node | null;
  let imagePosition = 0;
  while ((node = walker.nextNode())) {
    if (node instanceof HTMLImageElement) {
      flushText();
      parts.push({ image: matchImageIds ? (node.getAttribute('data-imgfileid') ?? '') : String(imagePosition++) });
    } else if (node instanceof SVGElement && node.localName === 'image') {
      flushText();
      parts.push({ svgImage: node.getAttribute('href') || node.getAttribute('xlink:href') || '' });
    } else if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
  }
  flushText();
  return JSON.stringify(parts);
}

async function confirmArticle(
  editor: HTMLElement,
  final: NonNullable<ReturnType<typeof substituteUploadedImages>>,
  isCurrent: () => boolean,
  nativeUpload = false,
) {
  const expectedSequence = articleContentSequence(final.template.content, !nativeUpload);
  const expectedImages = articleImages(final.template.content).length;
  const deadline = Date.now() + (nativeUpload ? 8 * 60_000 : 30_000);
  let progressDeadline = Date.now() + 90_000;
  let loadedCount = 0;
  while (isCurrent() && Date.now() < Math.min(deadline, progressDeadline)) {
    const images = articleImages(editor);
    const loaded = images.filter(loadedImage).length;
    if (loaded > loadedCount) {
      loadedCount = loaded;
      progressDeadline = Date.now() + 90_000;
    }
    if (
      [...document.querySelectorAll<HTMLElement>('.weui-desktop-toast,.weui-desktop-toptips')].some(
        (element) => isVisible(element) && /上传失败|上传出错|文件过大|图片太大/.test(element.textContent ?? ''),
      )
    )
      return false;
    if (
      images.length === expectedImages &&
      loaded === expectedImages &&
      textOf(editor) === final.expectedText &&
      articleContentSequence(editor, !nativeUpload) === expectedSequence &&
      !editor.innerHTML.includes('aiy-handoff-media:')
    )
      return true;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  return false;
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
  findMediaInput() {
    return null;
  },
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
    // Prepare the same embedded-image HTML as the original whole-article copy
    // path. Keep local media references out of the page until it is complete.
    const beforeHtml = editor.innerHTML;
    const beforeUrl = window.location.href;
    const unchanged = () => editor.isConnected && editor.innerHTML === beforeHtml && window.location.href === beforeUrl;
    const referencedImages = new Set(article.imageIndexes);
    if (interactive) {
      for (const image of interactive.template.content.querySelectorAll('img,svg image')) {
        const index = handoffMediaIndex(image.getAttribute('src') ?? image.getAttribute('href'), files.length);
        if (index === null || !referencedImages.has(index)) return 'INVALID_REQUEST';
      }
    }
    const embedded = await embedWechatArticleImages(article.template, article.imageIndexes, files, unchanged);
    if (!unchanged()) return 'COMPOSER_NOT_EMPTY';
    if (!embedded) return 'MEDIA_FILL_FAILED';
    const nativeArticle = {
      template: embedded,
      html: embedded.innerHTML,
      expectedText: textOf(embedded.content),
      svgCount: 0,
    };
    let userEdited = false;
    const protectEdits = (event: Event) => {
      if (event.isTrusted) userEdited = true;
    };
    const isCurrent = () => !userEdited && editor.isConnected && window.location.href === beforeUrl;
    editor.addEventListener('beforeinput', protectEdits);
    try {
      if (!(await pasteArticleHtml(editor, nativeArticle.html, nativeArticle.expectedText))) return 'FILL_FAILED';
      if (!(await confirmArticle(editor, nativeArticle, isCurrent, true))) return 'MEDIA_FILL_FAILED';
      if (interactive) {
        // Only interactive SVG needs a second whole-document transaction. Reuse
        // the image URLs that WeChat has uploaded in the complete static body.
        const uploadedByIndex = new Map<number, UploadedWechatImage>();
        articleImages(editor).forEach((image, position) => {
          uploadedByIndex.set(article.imageIndexes[position]!, {
            url: image.src,
            fileId: image.getAttribute('data-imgfileid')!,
          });
        });
        const staticArticle = substituteUploadedImages(article, uploadedByIndex, files.length);
        const final = substituteUploadedImages(interactive, uploadedByIndex, files.length);
        if (!staticArticle || !final) return 'INVALID_REQUEST';
        const restoreStatic = async () => {
          if (isCurrent()) await pasteArticleHtml(editor, staticArticle.html, staticArticle.expectedText);
        };
        const pasted = await pasteArticleHtml(editor, final.html, final.expectedText);
        if (!pasted || !(await confirmArticle(editor, final, isCurrent))) {
          await restoreStatic();
          return 'FILL_FAILED';
        }
        const svgRoots = editor.querySelectorAll('svg[id^="aiy_interaction_"]');
        const survived =
          svgRoots.length === final.svgCount &&
          [...svgRoots].every(
            (svg) =>
              [...svg.querySelectorAll('animate')].length >= 2 &&
              [...svg.querySelectorAll('animate')].every(
                (animation) => animation.getAttribute('begin') === `${svg.getAttribute('id')}.click`,
              ),
          ) &&
          [...editor.querySelectorAll('svg image')].every((image) =>
            isWechatImageUrl(image.getAttribute('href') || image.getAttribute('xlink:href') || ''),
          );
        if (!survived) {
          await restoreStatic();
          return 'FILL_FAILED';
        }
      }
    } finally {
      editor.removeEventListener('beforeinput', protectEdits);
    }
    if (coverMediaIndex !== undefined && !(await fillWechatArticleCover(files[coverMediaIndex]!)))
      return 'MEDIA_FILL_FAILED';
    return null;
  },
};
