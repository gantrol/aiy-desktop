import { useRef, useState } from 'react';
import type { CreationVideoAttachmentDto, Locale } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { formatVideoDocumentDuration } from '@/renderer/features/video-documents/useVideoDocumentLocalFile';

interface Props {
  videos: readonly CreationVideoAttachmentDto[];
  locale: Locale;
  importing: boolean;
  onRemove(materialId: string): void;
  onCreateDocument(video: CreationVideoAttachmentDto): Promise<void>;
  notify(message: string): void;
}

export function CreationVideoAttachments({ videos, locale, importing, onRemove, onCreateDocument, notify }: Props) {
  const [openingId, setOpeningId] = useState<string | null>(null);
  const opening = useRef(false);
  const zh = locale === 'zh';
  if (!videos.length && !importing) return null;
  async function create(video: CreationVideoAttachmentDto) {
    if (opening.current) return;
    opening.current = true;
    setOpeningId(video.materialId);
    try {
      await onCreateDocument(video);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      opening.current = false;
      setOpeningId(null);
    }
  }
  return (
    <section aria-label={zh ? '附加视频' : 'Attached videos'} className="shrink-0 border-b px-4 py-3">
      <div className="mb-2 text-xs text-muted-foreground">
        {importing ? (zh ? '正在导入视频…' : 'Importing videos…') : zh ? '附加视频' : 'Attached videos'}
      </div>
      <div className="flex gap-3 overflow-x-auto">
        {videos.map((video) => (
          <div key={video.materialId} className="w-56 shrink-0 rounded-lg border bg-surface-sunken/20 p-2">
            <video
              src={video.asset.mediaUrl}
              controls
              preload="none"
              aria-label={video.name}
              className="h-28 w-full rounded bg-media-surround-dark object-contain"
            />
            <div className="mt-1 truncate text-xs" title={video.name}>
              {video.name}
            </div>
            <div className="mt-2 flex items-center justify-between gap-1">
              <span className="text-xs text-muted-foreground">{formatVideoDocumentDuration(video.durationMs)}</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={!!openingId || importing}
                onClick={() => onRemove(video.materialId)}
              >
                {zh ? '移除' : 'Remove'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!!openingId || importing}
                onClick={() => void create(video)}
              >
                {openingId === video.materialId ? (zh ? '正在打开…' : 'Opening…') : zh ? '转为文稿' : 'To document'}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
