import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { VideoSearchItem } from '@/shared/contracts/video-search';
import { formatVideoSearchTime } from '@/renderer/features/content-search/videoSearchTime';

export function VideoSearchPreview({
  item,
  active,
  play,
}: {
  item: VideoSearchItem | null;
  active: boolean;
  play: number;
}) {
  const { messages, locale } = useI18n();
  const [source, setSource] = useState<{ key: string; url: string | null } | null>(null);
  const [failed, setFailed] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const positioned = useRef('');
  const key = item ? `${item.id}:${item.revision}:${play}` : '';
  useEffect(() => {
    if (!item || !active) return;
    let cancelled = false;
    setFailed('');
    void window.desktopApi.imageSearch
      .openVideo({ documentId: item.documentId, sourceHash: item.sourceHash, revision: item.revision })
      .then((result) => {
        if (!cancelled) setSource({ key, url: result?.mediaUrl ?? null });
      })
      .catch(() => {
        if (!cancelled) setSource({ key, url: null });
      });
    return () => {
      cancelled = true;
    };
  }, [item, active, key]);
  if (!active || !item) return null;
  const url = source?.key === key ? source.url : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{item.title}</span>
      </div>
      {(failed === key || (source?.key === key && !url)) && (
        <p role="alert" className="text-sm text-destructive">
          {messages.referenceOutline.lookup.notAvailable}
        </p>
      )}
      {url && (
        <video
          key={key}
          ref={video}
          src={url}
          controls
          preload="metadata"
          className="max-h-[65vh] w-full bg-media-surround-dark"
          aria-label={item.title}
          onLoadedMetadata={() => {
            if (!video.current) return;
            positioned.current = '';
            video.current.currentTime = item.startMs / 1000;
          }}
          onSeeked={() => {
            if (positioned.current === key) return;
            positioned.current = key;
            if (play) void video.current?.play().catch(() => undefined);
          }}
          onError={() => setFailed(key)}
        />
      )}
      <span className="text-xs text-muted-foreground">
        {formatVideoSearchTime(item.startMs, locale, item.kind === 'FRAME')}
        {item.endMs > item.startMs ? ` – ${formatVideoSearchTime(item.endMs, locale)}` : ''}
      </span>
      {item.preview && <p className="whitespace-pre-wrap text-sm">{item.preview}</p>}
    </div>
  );
}
