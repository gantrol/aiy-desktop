import { FileVideoIcon, LoaderCircleIcon } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AlbumDto, IntakeCommitSource, IntakeVideoMimeType } from '@/shared/contracts';
import { flattenAlbumTree, buildAlbumTreeIndex } from '@/renderer/components/albums/albumTree';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import {
  formatVideoDocumentDuration,
  formatVideoDocumentFileSize,
  useVideoDocumentLocalFile,
  videoDocumentFileStem,
} from '@/renderer/features/video-documents/useVideoDocumentLocalFile';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { cn } from '@/renderer/lib/utils';

const UNFILED_VALUE = '__UNFILED__';

export interface VideoDocumentStartConfiguration {
  file: File;
  source: IntakeCommitSource;
  mimeType: IntakeVideoMimeType;
  width: number;
  height: number;
  durationMs: number;
  title: string;
  albumId: string | null;
  generateArticle: boolean;
}

interface Props {
  open: boolean;
  file: File | null;
  source: IntakeCommitSource;
  albums: readonly AlbumDto[];
  defaultAlbumId: string | null;
  onOpenChange(open: boolean): void;
  onCreate(configuration: VideoDocumentStartConfiguration): Promise<void>;
}

export function VideoDocumentStartDialog({
  open,
  file,
  source,
  albums,
  defaultAlbumId,
  onOpenChange,
  onCreate,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.videoDocuments.start;
  const albumRows = useMemo(() => flattenAlbumTree(buildAlbumTreeIndex(albums)), [albums]);
  const { previewUrl, mediaInfo, reading, error: mediaError } = useVideoDocumentLocalFile(file, open, labels);
  const [title, setTitle] = useState('');
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [generateArticle, setGenerateArticle] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!open || !file) return undefined;
    setTitle(videoDocumentFileStem(file.name));
    setAlbumId(defaultAlbumId);
    setGenerateArticle(false);
    setSubmitError('');
    return undefined;
  }, [defaultAlbumId, file, open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!file || !mediaInfo || !nextTitle || reading || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await onCreate({ file, source, ...mediaInfo, title: nextTitle, albumId, generateArticle });
      onOpenChange(false);
    } catch (reason) {
      setSubmitError(reason instanceof Error && reason.message ? reason.message : labels.failed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-w-xl">
        <form className="grid gap-5" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{labels.title}</DialogTitle>
            <DialogDescription>{labels.description}</DialogDescription>
          </DialogHeader>
          <div className="flex min-w-0 gap-4 rounded-lg border bg-surface-sunken p-3">
            <div
              className={cn(
                'relative isolate grid aspect-video w-40 shrink-0 place-items-center overflow-hidden rounded-md text-media-checker-a/70',
                previewUrl ? 'bg-surface-sunken' : 'bg-media-surround-dark',
              )}
            >
              {previewUrl ? (
                <>
                  <ImageAmbientBackdrop src={previewUrl} />
                  <img src={previewUrl} alt="" className="relative z-10 size-full object-contain" />
                </>
              ) : reading ? (
                <LoaderCircleIcon className="size-5 animate-spin" />
              ) : (
                <FileVideoIcon className="size-6" />
              )}
            </div>
            <div className="min-w-0 self-center">
              <strong className="block truncate text-sm">{file?.name}</strong>
              {file && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  {formatVideoDocumentFileSize(file.size)}
                </span>
              )}
              {mediaInfo && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  {formatVideoDocumentDuration(mediaInfo.durationMs)} · {mediaInfo.width}×{mediaInfo.height}
                </span>
              )}
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="video-document-start-title">{labels.documentTitle}</Label>
            <Input
              id="video-document-start-title"
              value={title}
              maxLength={300}
              disabled={reading || submitting}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>{labels.album}</Label>
            <Select
              value={albumId ?? UNFILED_VALUE}
              disabled={submitting}
              onValueChange={(value) => setAlbumId(value === UNFILED_VALUE ? null : value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNFILED_VALUE}>{labels.unfiled}</SelectItem>
                {albumRows.map(({ album, depth }) => (
                  <SelectItem key={album.id} value={album.id}>
                    {'　'.repeat(depth)}
                    {album.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
            <Checkbox
              checked={generateArticle}
              disabled={submitting}
              onCheckedChange={(checked) => setGenerateArticle(checked === true)}
            />
            <span>
              <strong className="block font-medium">{labels.generateArticle}</strong>
              <span className="mt-0.5 block text-xs text-muted-foreground">{labels.generateArticleHint}</span>
            </span>
          </label>
          {(mediaError || submitError) && (
            <p role="alert" className="text-sm text-destructive">
              {mediaError || submitError}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={reading || submitting || !mediaInfo || !title.trim()}>
              {submitting && <LoaderCircleIcon className="size-4 animate-spin" />}
              {submitting ? labels.creating : labels.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
