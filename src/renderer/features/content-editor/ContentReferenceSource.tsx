import { useEffect, useState } from 'react';
import { FileText, FolderOpen } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/renderer/components/ui/dialog';
import type { ContentDocument, ContentReference } from '@/shared/contracts/content-library';
import { useI18n } from '@/renderer/i18n/useI18n';
import { contentLibraryApi } from '@/renderer/features/content-editor/ContentReferencePicker';

export function ContentReferenceSource({ reference }: { reference: ContentReference }) {
  const copy = useI18n().messages.desktopPetals.document;
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<ContentDocument | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let current = true;
    setSource(null);
    setError('');
    void contentLibraryApi()
      .read(reference.source)
      .then((document) => {
        if (current) setSource(document);
      })
      .catch(() => {
        if (current) setError(copy.unavailable);
      });
    return () => {
      current = false;
    };
  }, [open, reference.source, copy.unavailable]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="ghost" title={copy.source} aria-label={copy.source}>
          <FileText className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[80vh] max-w-3xl flex-col" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{reference.title || copy.source}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate" title={reference.revisionId}>
            {copy.fixed}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={copy.reveal}
            title={copy.reveal}
            onClick={() =>
              void contentLibraryApi()
                .reveal(reference.source)
                .catch(() => setError(copy.unavailable))
            }
          >
            <FolderOpen className="size-4" />
          </Button>
        </div>
        {error && (
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
        )}
        <div className="min-h-0 overflow-y-auto whitespace-normal text-sm leading-relaxed">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            urlTransform={(url) =>
              (source ?? reference).media.find((media) => media.path === url)?.mediaUrl ??
              (/^https?:\/\//u.test(url) ? url : '')
            }
          >
            {source?.markdown ?? reference.markdown}
          </ReactMarkdown>
        </div>
      </DialogContent>
    </Dialog>
  );
}
