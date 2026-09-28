import { useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { ArrowUpRight, Globe, LoaderCircle, RotateCw } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { contentLibraryApi } from '@/renderer/features/content-editor/ContentReferencePicker';
import { useContentLinkProviders, useContentLinkSource } from '@/renderer/features/content-editor/ContentLinkProviders';
import { fallbackLinkPreview, linkCardTarget, type LinkPreview } from '@/shared/contracts/link-card';

function LinkCardBody({ url, title }: { url: string; title?: string }) {
  const copy = useI18n().messages.desktopPetals.editor;
  const root = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<LinkPreview>(() => fallbackLinkPreview(url));
  const [loading, setLoading] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!/^https?:\/\//iu.test(url)) return;
    let live = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setLoading(true);
        void Promise.resolve()
          .then(() => contentLibraryApi().linkPreview(url, attempt > 0))
          .then((result) => {
            if (live) setPreview(result);
          })
          .catch(() => {
            if (live) setPreview((value) => ({ ...value, failure: { stage: 'page', code: 'NETWORK' } }));
          })
          .finally(() => {
            if (live) setLoading(false);
          });
      },
      { rootMargin: '100px' },
    );
    if (root.current) observer.observe(root.current);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [url, attempt]);
  const heading = title || preview.title || (preview.kind === 'X' ? copy.xLinkCard : url);
  const failureLabel = preview.failure
    ? `${preview.failure.stage === 'image' ? copy.linkPreviewImageFailed : copy.linkPreviewPageFailed}: ${copy.linkPreviewErrors[preview.failure.code]}`
    : '';
  return (
    <div ref={root} className="flex items-start">
      <Button
        asChild
        variant="ghost"
        className="h-auto min-w-0 flex-1 justify-start gap-3 rounded-sm p-3 text-left font-normal whitespace-normal"
      >
        <a
          href={url}
          title={openFailed ? copy.linkOpenFailed : url}
          aria-label={`${copy.openLinkCard}: ${heading}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpenFailed(false);
            void contentLibraryApi()
              .linkOpen(url)
              .catch(() => setOpenFailed(true));
          }}
          onAuxClick={(event) => event.preventDefault()}
          className="!text-foreground !no-underline"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {preview.kind === 'X' ? (
                <span aria-hidden="true" className="font-semibold">
                  𝕏
                </span>
              ) : (
                <Globe className="size-3.5" />
              )}
              <span className="truncate">{preview.author || preview.siteName}</span>
              {loading && <LoaderCircle className="size-3 animate-spin" aria-label={copy.linkPreviewLoading} />}
              <ArrowUpRight className="ml-auto size-3.5 shrink-0" />
            </span>
            {preview.quote ? (
              <span className="whitespace-pre-wrap break-words text-sm leading-relaxed">{preview.quote}</span>
            ) : (
              <span className="line-clamp-2 break-words text-sm font-medium">{heading}</span>
            )}
            <span className="truncate text-xs text-muted-foreground">{url}</span>
          </span>
          {preview.image && (
            <img
              src={preview.image}
              alt=""
              draggable={false}
              className="!m-0 !h-20 !w-28 shrink-0 rounded-sm object-contain"
              onError={() =>
                setPreview((value) => ({ ...value, image: null, failure: { stage: 'image', code: 'UNSUPPORTED' } }))
              }
            />
          )}
        </a>
      </Button>
      {preview.failure && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="mt-2 mr-1 shrink-0 text-muted-foreground"
          title={`${failureLabel} · ${copy.linkPreviewRetry}`}
          aria-label={`${copy.linkPreviewRetry}: ${failureLabel}`}
          disabled={loading}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setLoading(true);
            setAttempt((value) => value + 1);
          }}
        >
          <RotateCw className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

export function ContentLinkCard({ node, selected }: NodeViewProps) {
  const providers = useContentLinkProviders();
  const source = useContentLinkSource();
  const target = linkCardTarget(node.attrs.url);
  const Card = target && providers.find((provider) => provider.matches(target.url))?.Card;
  return (
    <NodeViewWrapper
      contentEditable={false}
      data-drag-handle
      data-aiy-link-card={target?.url}
      className={cn(
        'my-3 overflow-hidden rounded-sm border bg-surface',
        selected && 'outline-2 outline-offset-1 outline-ring',
      )}
    >
      {target &&
        (Card ? (
          <Card
            key={target.url}
            url={target.url}
            title={node.attrs.title}
            application={node.attrs.application}
            source={source}
          />
        ) : (
          <LinkCardBody key={target.url} url={target.url} title={node.attrs.title || undefined} />
        ))}
    </NodeViewWrapper>
  );
}
