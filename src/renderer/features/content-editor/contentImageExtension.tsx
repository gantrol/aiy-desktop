import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { AssetImageCopyButton } from '@/renderer/components/media/AssetImageCopyButton';
import { ContentImageContextMenu } from '@/renderer/features/content-editor/ContentImageContextMenu';
import { Button } from '@/renderer/components/ui/button';
import { retryContentImage } from '@/renderer/features/content-editor/contentImageRecovery';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { VideoDocumentMediaBinding, VideoDocumentRevisionMediaDto } from '@/shared/contracts';
import type { JSONContent, MarkdownParseHelpers, MarkdownToken } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { LoaderCircle, X } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';

export function normalizedMediaPath(value: string) {
  const path = value.split(/[?#]/, 1)[0]!.replace(/^\.\//, '');
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function internalImageAssetId(value: string) {
  const match = /^aiy-media:\/\/asset\/([^/?#]+)(?:[?#].*)?$/u.exec(value);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

function persistentDocumentImageSource(sourcePath: string, src: string, mediaSnapshot: DocumentImageMediaSnapshot) {
  const candidate = sourcePath || src;
  const assetId = internalImageAssetId(candidate);
  if (!assetId) return candidate;
  return (
    mediaSnapshot.mediaBindings.find((binding) => binding.kind === 'IMAGE' && binding.assetId === assetId)?.path ??
    candidate
  );
}

function markdownTokenText(token: MarkdownToken, property: 'href' | 'title' | 'text') {
  const value = token[property];
  return typeof value === 'string' ? value : '';
}

export interface ContentEditorMedia extends Omit<VideoDocumentRevisionMediaDto, 'mimeType'> {
  mimeType: string;
}
export interface DocumentImageMediaSnapshot {
  mediaBindings: readonly VideoDocumentMediaBinding[];
  media: readonly ContentEditorMedia[];
}

/** Display metadata can arrive after the document, without changing its saved content. */
export class DocumentImageMediaStore {
  private readonly listeners = new Set<() => void>();
  constructor(private snapshot: DocumentImageMediaSnapshot) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  update(snapshot: DocumentImageMediaSnapshot) {
    if (this.snapshot.media === snapshot.media && this.snapshot.mediaBindings === snapshot.mediaBindings) return;
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
}

function DocumentImageNodeView({ node, extension, deleteNode, editor }: NodeViewProps) {
  const copy = useI18n().messages.contentEditor;
  const store = extension.options.mediaStore as DocumentImageMediaStore;
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const storedSrc = typeof node.attrs.src === 'string' ? node.attrs.src : '';
  const sourcePath = typeof node.attrs.sourcePath === 'string' ? node.attrs.sourcePath : storedSrc;
  const binding = snapshot.mediaBindings.find(
    (item) => normalizedMediaPath(item.path) === normalizedMediaPath(sourcePath),
  );
  const assetId =
    typeof node.attrs.assetId === 'string' && node.attrs.assetId
      ? node.attrs.assetId
      : (binding?.assetId ?? internalImageAssetId(storedSrc));
  const src =
    snapshot.media.find((item) => item.assetId === assetId)?.mediaUrl ??
    (assetId ? `aiy-media://asset/${encodeURIComponent(assetId)}` : storedSrc);
  const [load, setLoad] = useState({ src: '', failed: false, attempt: 0 });
  const failed = load.src === src && load.failed;
  const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : '';
  const title = typeof node.attrs.title === 'string' ? node.attrs.title : undefined;
  if (node.attrs.importId)
    return (
      <NodeViewWrapper className="my-3 flex min-h-16 items-center gap-2 bg-muted px-3" contentEditable={false}>
        {node.attrs.importState === 'pending' && <LoaderCircle className="size-4 animate-spin" />}
        <span className="min-w-0 flex-1 truncate text-xs">
          {node.attrs.importState === 'failed' ? copy.imageImportFailed : copy.imageImporting}
        </span>
        {node.attrs.importState === 'failed' && (
          <Button variant="ghost" size="sm" onClick={() => void retryContentImage(editor, String(node.attrs.importId))}>
            {copy.retryImage}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={copy.removeImage}
          title={copy.removeImage}
          onClick={deleteNode}
        >
          <X className="size-4" />
        </Button>
      </NodeViewWrapper>
    );
  const image = (
    <>
      {src && !extension.options.compact && <ImageAmbientBackdrop src={src} loading="lazy" />}
      <img
        key={`${src}:${load.attempt}`}
        onError={() => setLoad((previous) => ({ ...previous, src, failed: true }))}
        onLoad={() => setLoad((previous) => (previous.failed ? { ...previous, src, failed: false } : previous))}
        src={src}
        alt={alt}
        title={title}
        className="relative z-10 max-h-[34rem] w-full object-contain"
        loading="lazy"
        draggable={false}
      />
      {failed && (
        <div className="relative z-10 flex items-center justify-center gap-2 p-3">
          <span className="text-xs text-muted-foreground">{copy.imageUnavailable}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLoad((previous) => ({ src, failed: false, attempt: previous.attempt + 1 }))}
          >
            {copy.reloadImage}
          </Button>
        </div>
      )}
      {assetId && window.desktopApi && <AssetImageCopyButton assetId={assetId} />}
    </>
  );
  return (
    <NodeViewWrapper
      className={
        extension.options.compact
          ? 'group/article-image relative my-2 block w-full overflow-hidden'
          : 'group/article-image relative isolate my-7 block max-h-[34rem] w-full overflow-hidden rounded-md bg-surface-sunken'
      }
    >
      <ContentImageContextMenu assetId={assetId} remove={editor.isEditable ? deleteNode : undefined}>
        {image}
      </ContentImageContextMenu>
    </NodeViewWrapper>
  );
}

export function createDocumentImageExtension(mediaStore: DocumentImageMediaStore, compact = false) {
  const resolveMedia = mediaStore.getSnapshot;
  return Image.extend({
    addOptions() {
      return {
        inline: false,
        allowBase64: false,
        HTMLAttributes: {},
        resize: false,
        ...this.parent?.(),
        compact,
        mediaStore,
      };
    },
    addAttributes() {
      return {
        ...this.parent?.(),
        assetId: { default: null, rendered: false },
        mediaPath: { default: null, rendered: false },
        importId: { default: null, rendered: false },
        importState: { default: null, rendered: false },
        sourcePath: {
          default: null,
          parseHTML: (element) => {
            const src = element.getAttribute('src') ?? '';
            const path = element.getAttribute('data-aiy-image-path');
            if (
              path &&
              resolveMedia().mediaBindings.some((binding) => binding.kind === 'IMAGE' && binding.path === path)
            )
              return path;
            return persistentDocumentImageSource('', src, resolveMedia()) || null;
          },
          renderHTML: (attributes) => (attributes.sourcePath ? { 'data-aiy-image-path': attributes.sourcePath } : {}),
        },
      };
    },
    parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
      const { mediaBindings, media } = resolveMedia();
      const bindingByPath = new Map(mediaBindings.map((binding) => [normalizedMediaPath(binding.path), binding]));
      const mediaById = new Map(media.map((item) => [item.assetId, item]));
      const sourcePath = persistentDocumentImageSource(markdownTokenText(token, 'href'), '', { mediaBindings, media });
      const binding = bindingByPath.get(normalizedMediaPath(sourcePath));
      const boundMedia = binding?.kind === 'IMAGE' ? mediaById.get(binding.assetId) : null;
      return helpers.createNode('image', {
        assetId: binding?.assetId ?? internalImageAssetId(sourcePath),
        mediaPath: sourcePath,
        src: boundMedia?.mediaUrl ?? sourcePath,
        sourcePath,
        title: markdownTokenText(token, 'title') || null,
        alt: markdownTokenText(token, 'text') || null,
      });
    },
    renderMarkdown(node: JSONContent) {
      const sourcePath = typeof node.attrs?.sourcePath === 'string' ? node.attrs.sourcePath : '';
      const src = node.attrs?.assetId
        ? (resolveMedia().mediaBindings.find((binding) => binding.assetId === node.attrs?.assetId)?.path ??
          `assets/${String(node.attrs.assetId).toLowerCase()}`)
        : persistentDocumentImageSource(
            sourcePath,
            typeof node.attrs?.src === 'string' ? node.attrs.src : '',
            resolveMedia(),
          );
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
      const title = typeof node.attrs?.title === 'string' ? node.attrs.title : '';
      return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
    },
    addNodeView() {
      return ReactNodeViewRenderer(DocumentImageNodeView);
    },
  }).configure({
    HTMLAttributes: {
      class: 'my-5 max-h-[34rem] w-full rounded-lg border bg-surface-sunken object-contain',
    },
  });
}
