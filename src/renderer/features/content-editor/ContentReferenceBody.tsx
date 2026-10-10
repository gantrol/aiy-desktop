import { ScratchImage } from '@/renderer/components/media/ScratchImage';
import { useId, useRef, useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ContentReference } from '@/shared/contracts/content-library';
import { isDocumentSource, type ReferenceSource } from '@/shared/contracts/content-source';
import { useReferenceNavigation } from '@/renderer/features/content-editor/contentReferenceNavigation';
import { referenceFailure } from '@/shared/i18n/reference-outline';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { contentAssetFileAction } from '@/renderer/features/content-editor/contentAssetFileActions';
import { ContentMarkdown } from '@/renderer/features/content-editor/ContentMarkdown';
import { parseAiyDeepLink } from '@/shared/contracts/app-deep-link';
import { openAppContentLink } from '@/renderer/components/app/app-content-link';
import {
  contentTypographyClassName,
  type ContentTypography,
} from '@/renderer/features/content-editor/contentEditorTypography';
import type { BlockDocument } from '@/shared/contracts/block-document';
import { ReferenceStructuredBody } from '@/renderer/features/content-editor/ReferenceStructuredBody';
import { contentFigureReferenceAssetId } from '@/shared/content-figure-reference';
import { contentAssetPath } from '@/shared/content-asset-path';
import { referenceMarkdownHeadings } from '@/renderer/features/content-editor/referenceMarkdownHeadings';
import { PinContentButton } from '@/renderer/features/desktop-petals/PinContentAction';
import { parseReadingCitationLink } from '@/shared/reading-citation-link';
import { useReadingHost } from '@/renderer/features/creation-reading/ReadingHost';

function ReferenceImage({ src, alt, media }: { src: string; alt: string; media?: ContentReference['media'][number] }) {
  const { messages } = useI18n();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [load, setLoad] = useState({ failed: false, attempt: 0 });
  const execute = async (action: 'copy' | 'save-as') => {
    if (!media || running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await contentAssetFileAction({ assetId: media.assetId, action });
    } catch {
      setError(messages.desktopPetals.contentEntry.actionFailed);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const imageState = load.failed && (
    <span className="inline-flex items-center gap-2">
      <span role="alert">{messages.contentEditor.imageUnavailable}</span>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setLoad((previous) => ({ failed: false, attempt: previous.attempt + 1 }))}
      >
        {messages.contentEditor.reloadImage}
      </Button>
    </span>
  );
  const imageEvents = {
    onError: () => setLoad((previous) => ({ ...previous, failed: true })),
  };
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className="my-2 h-auto max-w-full p-0"
          aria-label={messages.referenceOutline.viewImage}
          onClick={(event) => event.stopPropagation()}
        >
          <ScratchImage
            key={load.attempt}
            {...imageEvents}
            src={src}
            alt={alt}
            loading="lazy"
            className="max-h-72 max-w-full object-contain"
          />
        </Button>
      </DialogTrigger>
      {imageState}
      <DialogContent className="max-w-4xl" aria-describedby={undefined} onClick={(event) => event.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{alt || messages.referenceOutline.viewImage}</DialogTitle>
        </DialogHeader>
        <ScratchImage
          key={load.attempt}
          {...imageEvents}
          src={src}
          alt={alt}
          className="max-h-[65vh] w-full object-contain"
        />
        {imageState}
        {media && (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void execute('copy')}>
              <Copy />
              {messages.desktopPetals.contentEntry.copyImage}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void execute('save-as')}>
              <Download />
              {messages.desktopPetals.contentEntry.saveAs}
            </Button>
            <PinContentButton source={{ kind: 'IMAGE', id: media.assetId }} disabled={busy} notify={setError} />
          </div>
        )}
        {error && (
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Links open current editing locations; the source dialog separately preserves historical inspection. */
export function ContentReferenceBody({
  markdown,
  media,
  source,
  originBlockId,
  onNavigated,
  typography = 'compact',
  document: structured,
}: {
  markdown: string;
  media: ContentReference['media'];
  source: ReferenceSource;
  originBlockId?: string;
  onNavigated?(): void;
  typography?: ContentTypography;
  document?: BlockDocument;
}) {
  const { messages } = useI18n();
  const copy = messages.referenceOutline;
  const navigate = useReferenceNavigation(originBlockId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const localId = useId();
  const occurrenceId = originBlockId || localId;
  const readingHost = useReadingHost();
  const follow = async (href: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (!isDocumentSource(source)) throw new Error('REFERENCE_NAVIGATION_UNSUPPORTED');
      const blockId = decodeURIComponent(href.slice('#aiy-block:'.length));
      const matches = [...(root.current?.querySelectorAll<HTMLElement>('[data-reference-source-block]') ?? [])].filter(
        (element) => element.dataset.referenceSourceBlock === blockId,
      );
      if (matches.length === 1) {
        matches[0].scrollIntoView({ block: 'center' });
        return;
      }
      await navigate({ source, blockId, scope: 'SELF' });
      onNavigated?.();
    } catch (reason) {
      setError(referenceFailure(reason, copy));
    } finally {
      setBusy(false);
    }
  };
  const onLink = (href: string) => {
    const citation = parseReadingCitationLink(href);
    if (citation) {
      const trigger = globalThis.document.activeElement;
      const opened = readingHost?.openCitation(citation, () => {
        if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
      });
      setError(opened ? '' : messages.creationReading.citationUnavailable);
    } else if (href.startsWith('#aiy-block:')) void follow(href);
    else if (parseAiyDeepLink(href)) {
      if (!openAppContentLink(href)) setError(copy.locationMissing);
      else onNavigated?.();
    } else if (/^https?:\/\//u.test(href))
      void contentLibraryApi()
        .linkOpen(href)
        .catch(() => setError(copy.failure));
    else if (contentFigureReferenceAssetId(href)) {
      const id = contentFigureReferenceAssetId(href);
      const image = [...(root.current?.querySelectorAll<HTMLImageElement>('img') ?? [])].find((element) =>
        media.some((asset) => asset.assetId === id && asset.mediaUrl === element.getAttribute('src')),
      );
      if (image) image.scrollIntoView({ block: 'center' });
      else setError(copy.locationMissing);
    } else setError(copy.locationMissing);
  };
  const renderImage = (path: string, alt: string) => {
    const asset = media.find(
      (item) => item.path === path || item.mediaUrl === path || contentAssetPath(item.assetId) === path,
    );
    const src = asset?.mediaUrl ?? (/^https?:\/\//u.test(path) ? path : '');
    return src ? (
      <ReferenceImage key={`${asset?.assetId ?? ''}:${src}`} src={src} alt={alt} media={asset} />
    ) : (
      <span role="status">{messages.contentEditor.imageUnavailable}</span>
    );
  };
  return (
    <div ref={root} data-reference-body>
      {structured ? (
        <div className={contentTypographyClassName(typography)}>
          <ReferenceStructuredBody
            document={structured}
            occurrenceId={occurrenceId}
            onLink={onLink}
            image={renderImage}
          />
        </div>
      ) : (
        <ContentMarkdown
          typography={typography}
          urlTransform={(url) =>
            media.find((item) => item.path === url)?.mediaUrl ??
            (/^(https?:\/\/|#aiy-block:)/u.test(url) || parseAiyDeepLink(url) ? url : '')
          }
          components={{
            ...referenceMarkdownHeadings(occurrenceId),
            img: ({ src, alt }) => renderImage(typeof src === 'string' ? src : '', alt || ''),
            a: ({ href, children }) => (
              <a
                href={href}
                className="underline underline-offset-2"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (href) onLink(href);
                }}
              >
                {children}
              </a>
            ),
          }}
        >
          {markdown}
        </ContentMarkdown>
      )}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
