import { ImageOffIcon } from 'lucide-react';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, type RefObject } from 'react';
import type { Components } from 'react-markdown';
import { ContentMarkdown } from '@/renderer/features/content-editor/ContentMarkdown';
import type {
  ArticleContentInput,
  ArticleElementPlacementInput,
  VideoDocumentRevisionMediaDto,
} from '@/shared/contracts';
import { parseCodexThreadHref } from '@/shared/contracts/codex-thread';
import { CodexThreadAnchor } from '@/renderer/components/content/CodexThreadAnchor';
import { AssetImageCopyButton } from '@/renderer/components/media/AssetImageCopyButton';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { useArticleEditorMarkdownProjection } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { useWorkspaceArticleEditorState } from '@/renderer/components/workspace/WorkspaceArticleEditorStateProvider';
import { useI18n } from '@/renderer/i18n/useI18n';
import { articleDocumentWidthClassName, articleReferenceTitleClassName } from '@/renderer/lib/articleTypography';
import { codexMarkdownUrlTransform } from '@/renderer/lib/codexThreadLinks';

export interface ArticleReferenceMedia {
  assetId: string;
  mediaUrl: string;
}

function normalizedMediaPath(value: string | undefined) {
  if (!value) return '';
  const path = value.split(/[?#]/, 1)[0]!.replace(/^\.\//, '');
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

const ArticleComparisonMarkdown = memo(function ArticleComparisonMarkdown({
  markdown,
  media,
  mediaBindings,
  unavailableLabel,
}: {
  markdown: string;
  media: readonly ArticleReferenceMedia[];
  mediaBindings: ArticleContentInput['mediaBindings'];
  unavailableLabel: string;
}) {
  const components = useMemo<Components>(() => {
    const bindingByPath = new Map(mediaBindings.map((binding) => [normalizedMediaPath(binding.path), binding]));
    const mediaById = new Map(media.map((item) => [item.assetId, item]));
    return {
      h1: () => null,
      a: ({ href, children }) => {
        const threadId = parseCodexThreadHref(href);
        const className = 'text-[var(--button-primary)] underline decoration-selected-border underline-offset-4';
        return threadId ? (
          <CodexThreadAnchor threadId={threadId} className={className}>
            {children}
          </CodexThreadAnchor>
        ) : (
          <span className={className}>{children}</span>
        );
      },
      img: ({ src, alt }) => {
        const binding = bindingByPath.get(normalizedMediaPath(src));
        const resolved = binding ? mediaById.get(binding.assetId) : null;
        if (!resolved) {
          return (
            <span className="grid min-h-40 w-full place-items-center rounded-md border bg-surface-sunken text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <ImageOffIcon className="size-4" />
                {unavailableLabel}
              </span>
            </span>
          );
        }
        return (
          <AssetFileContextMenu assetId={resolved.assetId} inline>
            <span className="group/article-image relative isolate my-7 block max-h-[34rem] w-full overflow-hidden rounded-md bg-surface-sunken">
              <img
                src={resolved.mediaUrl}
                alt={alt ?? ''}
                className="max-h-[34rem] w-full object-contain"
                loading="lazy"
                decoding="async"
                draggable={false}
              />
              <AssetImageCopyButton assetId={resolved.assetId} />
            </span>
          </AssetFileContextMenu>
        );
      },
    };
  }, [media, mediaBindings, unavailableLabel]);

  return (
    <ContentMarkdown
      containerProps={{ 'data-article-reference-body': true }}
      typography="article"
      className="[content-visibility:auto] [contain-intrinsic-size:auto_800px]"
      components={components}
      urlTransform={codexMarkdownUrlTransform}
    >
      {markdown}
    </ContentMarkdown>
  );
});

export function ArticleReferenceDocument({
  articleId,
  markdown,
  media,
  mediaBindings,
  title,
  scrollRootRef,
}: {
  articleId?: string;
  markdown: string;
  media: readonly ArticleReferenceMedia[];
  mediaBindings: ArticleContentInput['mediaBindings'];
  title: string;
  scrollRootRef?: RefObject<HTMLDivElement | null>;
}) {
  const { messages } = useI18n();
  const deferredMarkdown = useDeferredValue(markdown);
  return (
    <div ref={scrollRootRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <article
        data-content-source={articleId ? JSON.stringify({ kind: 'ARTICLE', id: articleId }) : undefined}
        className={`mx-auto w-full ${articleDocumentWidthClassName} px-6 py-7 lg:px-8`}
      >
        <h1 className={`${articleReferenceTitleClassName} mb-7`}>
          {title || messages.creator.manuscriptEditor.untitled}
        </h1>
        {deferredMarkdown.trim() ? (
          <ArticleComparisonMarkdown
            markdown={deferredMarkdown}
            media={media}
            mediaBindings={mediaBindings}
            unavailableLabel={messages.contentEditor.imageUnavailable}
          />
        ) : (
          <div className="grid min-h-60 place-items-center text-sm text-muted-foreground">
            {messages.creator.manuscriptEditor.noBody}
          </div>
        )}
      </article>
    </div>
  );
}

export function CurrentArticleReference({
  media,
  mediaBindings,
  title,
  articleId,
  elements = [],
  trackPosition = false,
}: {
  media: readonly VideoDocumentRevisionMediaDto[];
  mediaBindings: ArticleContentInput['mediaBindings'];
  title: string;
  articleId?: string;
  elements?: readonly ArticleElementPlacementInput[];
  trackPosition?: boolean;
}) {
  const markdown = useArticleEditorMarkdownProjection();
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const positionTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const navigation = useWorkspaceArticleEditorState(articleId ?? '');
  const referenceMedia = useMemo<ArticleReferenceMedia[]>(
    () => media.map((item) => ({ assetId: item.assetId, mediaUrl: item.mediaUrl })),
    [media],
  );
  const capturePosition = useCallback(() => {
    if (!trackPosition || !articleId) return;
    const root = scrollRootRef.current;
    if (!root) return;
    const rootTop = root.getBoundingClientRect().top;
    const blocks = referenceBlocks(root);
    const index = blocks.findIndex((block) => block.getBoundingClientRect().bottom > rootTop + 16);
    const placement = index < 0 ? elements[elements.length - 1] : elements[index];
    const block = index < 0 ? blocks[blocks.length - 1] : blocks[index];
    if (placement && block) {
      navigation.updateArticleLocation({
        elementId: placement.elementId,
        relativeOffset: 0,
        blockIndex: placement.blockIndex,
        viewportOffset: Math.max(0, Math.round(rootTop + 16 - block.getBoundingClientRect().top)),
      });
    }
  }, [articleId, elements, navigation, trackPosition]);

  useEffect(() => {
    if (!trackPosition || !articleId) return;
    const root = scrollRootRef.current;
    const location = navigation.articleLocation ?? navigation.state?.resumeLocation ?? null;
    if (!root || !location) return;
    const frame = window.requestAnimationFrame(() => {
      const blocks = referenceBlocks(root);
      const placement =
        elements.find((element) => element.elementId === location.elementId) ??
        (location.blockIndex === undefined ? null : elements[location.blockIndex]);
      const target = placement ? blocks[placement.blockIndex] : null;
      if (!target) return;
      const targetRect = target.getBoundingClientRect();
      const viewportOffset = Math.min(location.viewportOffset ?? 0, Math.max(0, Math.round(targetRect.height)));
      root.scrollTop += targetRect.top + viewportOffset - root.getBoundingClientRect().top - 16;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    articleId,
    elements,
    markdown,
    navigation.articleLocation,
    navigation.navigationEntryId,
    navigation.state?.resumeLocation,
    trackPosition,
  ]);

  useEffect(() => {
    if (!trackPosition || !articleId) return;
    const root = scrollRootRef.current;
    if (!root) return;
    const capture = () => {
      if (positionTimerRef.current !== null) globalThis.clearTimeout(positionTimerRef.current);
      positionTimerRef.current = globalThis.setTimeout(() => {
        positionTimerRef.current = null;
        capturePosition();
      }, 450);
    };
    root.addEventListener('scroll', capture, { passive: true });
    return () => {
      root.removeEventListener('scroll', capture);
      if (positionTimerRef.current !== null) globalThis.clearTimeout(positionTimerRef.current);
    };
  }, [articleId, capturePosition, trackPosition]);

  useEffect(() => {
    if (!trackPosition || !articleId) return;
    const flush = () => {
      if (positionTimerRef.current !== null) {
        globalThis.clearTimeout(positionTimerRef.current);
        positionTimerRef.current = null;
      }
      capturePosition();
    };
    navigation.registerLocationFlush(flush);
    return () => navigation.registerLocationFlush(null);
  }, [articleId, capturePosition, navigation, trackPosition]);
  return (
    <ArticleReferenceDocument
      articleId={articleId}
      markdown={markdown}
      media={referenceMedia}
      mediaBindings={mediaBindings}
      title={title}
      scrollRootRef={scrollRootRef}
    />
  );
}

function referenceBlocks(root: HTMLElement) {
  const body = root.querySelector<HTMLElement>('[data-article-reference-body]');
  if (!body) return [];
  return Array.from(
    body.querySelectorAll<HTMLElement>('p, h2, h3, h4, h5, h6, li, blockquote, pre, img, table, tr, th, td'),
  ).filter((element) => element.tagName !== 'P' || element.parentElement === body);
}
