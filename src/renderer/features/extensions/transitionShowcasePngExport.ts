import { useState, type RefObject } from 'react';
import type {
  TransitionShowcaseScene,
  TransitionShowcaseViewport,
} from '@/renderer/features/extensions/transitionShowcasePreferences';

const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
const MAX_EXPORT_DIMENSION = 4096;
const MAX_EXPORT_SCALE = 2;
const PREVIEW_LOAD_TIMEOUT_MS = 10_000;

interface TransitionShowcasePngExportOptions {
  stageRef: RefObject<HTMLDivElement | null>;
  assetIds: readonly string[];
  scene: TransitionShowcaseScene;
  viewport: TransitionShowcaseViewport;
  notify?(message: string): void;
  exportedMessage: string;
  exportFailedMessage: string;
}

function afterPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}

async function waitForStageImages(stage: HTMLElement) {
  const pending = [...stage.querySelectorAll('img')].filter((image) => !image.complete);
  if (pending.length === 0) return;
  await Promise.race([
    Promise.all(pending.map((image) => image.decode().catch(() => undefined))),
    new Promise<void>((resolve) => window.setTimeout(resolve, 1_500)),
  ]);
}

function hasPendingPortraitPreviews(stage: HTMLElement) {
  return [...stage.querySelectorAll<HTMLElement>('[data-loading-preview="image"] [data-preview-load]')].some(
    (preview) => preview.dataset.previewLoad !== 'loaded',
  );
}

async function waitForPortraitPreviews(stage: HTMLElement) {
  if (!hasPendingPortraitPreviews(stage)) return;
  await new Promise<void>((resolve, reject) => {
    const observer = new MutationObserver(() => finishWhenReady());
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      reject(new Error('Transition export previews did not finish loading'));
    }, PREVIEW_LOAD_TIMEOUT_MS);
    const finishWhenReady = () => {
      if (hasPendingPortraitPreviews(stage)) return;
      window.clearTimeout(timeout);
      observer.disconnect();
      resolve();
    };
    observer.observe(stage, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-preview-load'],
    });
    finishWhenReady();
  });
}

function exportFileName(scene: TransitionShowcaseScene, viewport: TransitionShowcaseViewport) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/u, 'Z');
  return `aiy-transition-${scene}-${viewport}-${timestamp}.png`;
}

function assetIdFromMediaUrl(source: string | null) {
  if (!source) return null;
  try {
    const url = new URL(source);
    if (url.protocol !== 'aiy-media:' || url.hostname !== 'asset') return null;
    const assetId = decodeURIComponent(url.pathname.replace(/^\//u, ''));
    return assetId || null;
  } catch {
    return null;
  }
}

function pngDataUrl(bytes: Uint8Array) {
  const ownedBytes = new Uint8Array(bytes.byteLength);
  ownedBytes.set(bytes);
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      'load',
      () => {
        if (typeof reader.result === 'string' && reader.result.startsWith('data:image/png;base64,')) {
          resolve(reader.result);
          return;
        }
        reject(new Error('Transition export image could not be embedded'));
      },
      { once: true },
    );
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Transition export image read failed')), {
      once: true,
    });
    reader.readAsDataURL(new Blob([ownedBytes.buffer], { type: 'image/png' }));
  });
}

async function loadExportImageDataUrls(assetIds: readonly string[]) {
  const uniqueAssetIds = [...new Set(assetIds)];
  if (uniqueAssetIds.length === 0) return new Map<string, string>();
  const snapshots = await window.desktopApi.transitionShowcaseExportImages(uniqueAssetIds);
  const imageDataUrls = new Map<string, string>();
  for (const snapshot of snapshots) {
    imageDataUrls.set(snapshot.assetId, await pngDataUrl(snapshot.pngBytes));
  }
  if (imageDataUrls.size !== uniqueAssetIds.length) {
    throw new Error('Transition export image snapshots are incomplete');
  }
  return imageDataUrls;
}

function embeddedImageUrl(source: string | null, imageDataUrls: ReadonlyMap<string, string>) {
  const assetId = assetIdFromMediaUrl(source);
  if (!assetId) return null;
  const dataUrl = imageDataUrls.get(assetId);
  if (!dataUrl) throw new Error('Transition export image snapshot is missing');
  return dataUrl;
}

function embedCloneImages(clone: HTMLDivElement, imageDataUrls: ReadonlyMap<string, string>) {
  clone.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => {
    const dataUrl = embeddedImageUrl(image.getAttribute('src'), imageDataUrls);
    if (!dataUrl) return;
    image.src = dataUrl;
    image.removeAttribute('srcset');
  });
  clone.querySelectorAll<SVGImageElement>('image[href], image[xlink\\:href]').forEach((image) => {
    const source = image.getAttribute('href') ?? image.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    const dataUrl = embeddedImageUrl(source, imageDataUrls);
    if (!dataUrl) return;
    image.setAttribute('href', dataUrl);
    image.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
  });
}

function removeNonMediaPreviewLayers(clone: HTMLDivElement) {
  clone.querySelectorAll<HTMLElement>('[data-loading-preview="abstract"]').forEach((frame) => {
    frame.style.setProperty('visibility', 'hidden', 'important');
  });
  clone
    .querySelectorAll('[data-preview-load="loaded"] > [data-transition-preview-placeholder]')
    .forEach((placeholder) => placeholder.remove());
}

function prepareExportClone(
  stage: HTMLDivElement,
  width: number,
  height: number,
  imageDataUrls: ReadonlyMap<string, string>,
) {
  const clone = stage.cloneNode(true) as HTMLDivElement;
  clone.setAttribute('data-showcase-fullscreen', 'true');
  clone.setAttribute('data-transition-showcase-export-clone', 'true');
  clone.setAttribute('aria-hidden', 'true');
  clone.querySelectorAll('[data-transition-showcase-export-exclude]').forEach((node) => node.remove());
  clone.querySelectorAll('[data-transition-showcase-export-backdrop]').forEach((node) => node.remove());
  clone.querySelectorAll<HTMLElement>('[data-app-loading-state], [data-local-space-transition]').forEach((node) => {
    node.style.setProperty('background-color', 'transparent', 'important');
  });
  removeNonMediaPreviewLayers(clone);
  embedCloneImages(clone, imageDataUrls);
  Object.assign(clone.style, {
    position: 'fixed',
    inset: '0 auto auto -100000px',
    width: `${width}px`,
    height: `${height}px`,
    margin: '0',
    pointerEvents: 'none',
    zIndex: '-1',
    background: 'transparent',
    border: '0',
    borderRadius: '0',
    boxShadow: 'none',
    transform: 'none',
  });
  document.body.append(clone);
  return clone;
}

async function captureTransitionShowcasePng(stage: HTMLDivElement, imageDataUrls: ReadonlyMap<string, string>) {
  const width = Math.max(1, Math.round(window.innerWidth));
  const height = Math.max(1, Math.round(window.innerHeight));
  const scale = Math.min(MAX_EXPORT_SCALE, MAX_EXPORT_DIMENSION / Math.max(width, height));
  const clone = prepareExportClone(stage, width, height, imageDataUrls);
  try {
    await afterPaint();
    await document.fonts.ready;
    await waitForStageImages(clone);
    const { getFontEmbedCSS, toBlob } = await import('html-to-image');
    let fontEmbedCSS: string | undefined;
    try {
      fontEmbedCSS = await getFontEmbedCSS(clone, { preferredFontFormat: 'woff2' });
    } catch {
      fontEmbedCSS = undefined;
    }
    const blob = await toBlob(clone, {
      width,
      height,
      canvasWidth: Math.max(1, Math.round(width * scale)),
      canvasHeight: Math.max(1, Math.round(height * scale)),
      pixelRatio: 1,
      skipAutoScale: true,
      cacheBust: false,
      includeQueryParams: true,
      imagePlaceholder: TRANSPARENT_PIXEL,
      backgroundColor: 'transparent',
      fontEmbedCSS,
      skipFonts: !fontEmbedCSS,
      style: {
        position: 'relative',
        inset: 'auto',
        zIndex: 'auto',
        width: `${width}px`,
        height: `${height}px`,
        margin: '0',
        background: 'transparent',
        border: '0',
        borderRadius: '0',
        boxShadow: 'none',
        transform: 'none',
      },
      filter: (node) => !node.hasAttribute('data-transition-showcase-export-exclude'),
    });
    if (!blob) throw new Error('Transition showcase PNG renderer returned no image');
    return blob;
  } finally {
    clone.remove();
  }
}

function downloadTransitionShowcasePng(
  blob: Blob,
  scene: TransitionShowcaseScene,
  viewport: TransitionShowcaseViewport,
) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = exportFileName(scene, viewport);
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function useTransitionShowcasePngExport({
  stageRef,
  assetIds,
  scene,
  viewport,
  notify,
  exportedMessage,
  exportFailedMessage,
}: TransitionShowcasePngExportOptions) {
  const [exporting, setExporting] = useState(false);

  async function exportPng() {
    const stage = stageRef.current;
    if (!stage || exporting) return;
    setExporting(true);
    try {
      const imageDataUrls = await loadExportImageDataUrls(assetIds);
      await afterPaint();
      if (scene === 'portrait') {
        await waitForPortraitPreviews(stage);
        await afterPaint();
      }
      const blob = await captureTransitionShowcasePng(stage, imageDataUrls);
      downloadTransitionShowcasePng(blob, scene, viewport);
      notify?.(exportedMessage);
    } catch {
      notify?.(exportFailedMessage);
    } finally {
      setExporting(false);
    }
  }

  return { exporting, exportPng };
}
