import { useState } from 'react';
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

function ReferenceImage({ src, alt, media }: { src: string; alt: string; media?: ContentReference['media'][number] }) {
  const { messages } = useI18n();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const execute = async (action: 'copy' | 'save-as') => {
    if (!media || busy) return;
    setBusy(true);
    setError('');
    try {
      await contentAssetFileAction({ assetId: media.assetId, action });
    } catch {
      setError(messages.referenceOutline.failure);
    } finally {
      setBusy(false);
    }
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
          <img src={src} alt={alt} loading="lazy" className="max-h-72 max-w-full object-contain" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl" aria-describedby={undefined} onClick={(event) => event.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{alt || messages.referenceOutline.viewImage}</DialogTitle>
        </DialogHeader>
        <img src={src} alt={alt} className="max-h-[65vh] w-full object-contain" />
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
}: {
  markdown: string;
  media: ContentReference['media'];
  source: ReferenceSource;
  originBlockId?: string;
  onNavigated?(): void;
}) {
  const copy = useI18n().messages.referenceOutline;
  const navigate = useReferenceNavigation(originBlockId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const follow = async (href: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (!isDocumentSource(source)) throw new Error('REFERENCE_NAVIGATION_UNSUPPORTED');
      const blockId = decodeURIComponent(href.slice('#aiy-block:'.length));
      await navigate({ source, blockId, scope: 'SELF' });
      onNavigated?.();
    } catch (reason) {
      setError(referenceFailure(reason, copy));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <ContentMarkdown
        typography="compact"
        urlTransform={(url) =>
          media.find((item) => item.path === url)?.mediaUrl ??
          (/^(https?:\/\/|#aiy-block:)/u.test(url) || parseAiyDeepLink(url) ? url : '')
        }
        components={{
          img: ({ src, alt }) => {
            const path = typeof src === 'string' ? src : '';
            return path ? (
              <ReferenceImage src={path} alt={alt || ''} media={media.find((item) => item.mediaUrl === path)} />
            ) : null;
          },
          a: ({ href, children }) => (
            <a
              href={href}
              className="underline underline-offset-2"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (href?.startsWith('#aiy-block:')) void follow(href);
                else if (href && parseAiyDeepLink(href)) {
                  if (!openAppContentLink(href)) setError(copy.locationMissing);
                  else onNavigated?.();
                } else if (href && /^https?:\/\//u.test(href))
                  void contentLibraryApi()
                    .linkOpen(href)
                    .catch(() => setError(copy.failure));
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {markdown}
      </ContentMarkdown>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </>
  );
}
