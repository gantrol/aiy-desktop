import { useState } from 'react';
import { VideoIcon } from 'lucide-react';
import type { ContentSearchScreenProps } from '@/renderer/features/content-search/ContentSearchScreen';
import { ContentSearchView } from '@/renderer/features/content-search/ContentSearchView';
import { ImageSearchModelSettings } from '@/renderer/features/content-search/ImageSearchModelSettings';
import { WorkspaceSearchMode } from '@/renderer/features/content-search/WorkspaceSearchMode';
import { VideoSearchPreview } from '@/renderer/features/content-search/VideoSearchPreview';
import { useVideoSearch } from '@/renderer/features/content-search/useVideoSearch';
import { formatVideoSearchTime } from '@/renderer/features/content-search/videoSearchTime';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { imageSearchErrorSchema } from '@/shared/contracts/image-search';
import type { VideoSearchItem } from '@/shared/contracts/video-search';
import { SearchRelevance } from '@/renderer/features/content-search/SearchRelevance';

export function VideoSearchScreen({ active, location, onNavigate, navigationError }: ContentSearchScreenProps) {
  const { locale, messages } = useI18n();
  const copy = messages.imageSearch.videos;
  const [composing, setComposing] = useState(false);
  const mode = location.mode === 'HYBRID' ? 'HYBRID' : 'SEMANTIC';
  const search = useVideoSearch(location.query, mode, active && !composing);
  const [selection, setSelection] = useState<{ key: string; item: VideoSearchItem; play: number } | null>(null);
  const selected = selection?.key === search.key ? selection.item : null;
  const select = async (item: VideoSearchItem) => {
    setSelection({ key: search.key, item, play: 0 });
    return true;
  };
  const play = (item: VideoSearchItem) =>
    setSelection((current) => ({ key: search.key, item, play: (current?.play ?? 0) + 1 }));
  const error = imageSearchErrorSchema.safeParse(search.error);
  const result = search.videoResult;
  return (
    <ContentSearchView
      active={active}
      platform={window.desktopApi?.appPlatform ?? 'win32'}
      location={{ ...location, mode }}
      composing={composing}
      onComposing={setComposing}
      onNavigate={onNavigate}
      search={search}
      selection={{ selected, busy: false, error: navigationError ?? '', select }}
      opening={{
        busy: false,
        error: '',
        open: async () => {
          if (selected) play(selected);
        },
      }}
      openLabel={copy.open}
      onOpenItem={play}
      itemKey={(item) => item.id}
      placeholder={messages.referenceOutline.lookup.semanticPlaceholder}
      errorMessage={
        search.error === 'DISABLED' ? copy.permission : error.success ? messages.imageSearch[error.data] : undefined
      }
      toolbar={
        <>
          <WorkspaceSearchMode value={mode} allowText={false} onChange={(mode) => onNavigate({ ...location, mode })} />
          <ImageSearchModelSettings video onClose={search.refresh} />
        </>
      }
      status={
        <div className="flex flex-col gap-2 px-3 py-2">
          {result?.relevance === 'BORDERLINE' && (
            <span role="status" className="text-xs text-warning">
              {result.coverage.pending || result.coverage.unavailable || result.coverage.limited
                ? copy.onlyBorderlinePartial
                : copy.onlyBorderline}
            </span>
          )}
          {result && result.coverage.total > 0 && (
            <span role="status" className="text-2xs text-muted-foreground">
              {copy.frames(new Intl.NumberFormat(locale).format(result.indexedFrames))}
              {' · '}
              {copy.timeline(
                formatVideoSearchTime(result.processedMs, locale),
                formatVideoSearchTime(result.totalMs, locale),
              )}
            </span>
          )}
          {Boolean(result?.coverage.limited) && <span className="text-2xs text-warning">{copy.limited}</span>}
          {Boolean(result?.coverage.unavailable) && <span className="text-2xs text-warning">{copy.unavailable}</span>}
        </div>
      }
      renderRow={(item, options) => (
        <div role="listitem">
          <Button
            variant="ghost"
            disabled={options.disabled}
            data-search-result={item.id}
            aria-current={options.selected ? 'true' : undefined}
            className={`h-auto w-full items-start justify-start gap-3 rounded-md px-3 py-3 text-left font-normal whitespace-normal ${options.selected ? 'bg-selected text-selected-foreground' : ''}`}
            onClick={options.onSelect}
            onFocus={options.onPreview}
            onDoubleClick={options.onOpen}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                options.onOpen?.();
              }
            }}
          >
            <VideoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="line-clamp-2 text-sm font-medium">{item.title}</span>
              {item.preview && <span className="line-clamp-2 text-xs text-foreground-secondary">{item.preview}</span>}
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
                <span>
                  {formatVideoSearchTime(item.startMs, locale, item.kind === 'FRAME')}
                  {' · '}
                  {item.kind === 'FRAME' ? copy.frame : item.kind === 'TRANSCRIPT' ? copy.transcript : copy.note}
                </span>
                {(item.score > -1 || item.borderline) && !item.lexicalMatch && (
                  <SearchRelevance
                    score={item.score}
                    channel={item.kind === 'FRAME' ? 'videoFrame' : 'videoText'}
                    borderline={item.borderline}
                  />
                )}
              </span>
              {item.lexicalMatch && <span className="text-2xs text-muted-foreground">{copy.textMatch}</span>}
            </span>
          </Button>
        </div>
      )}
      renderPreview={(visible) => <VideoSearchPreview item={selected} active={visible} play={selection?.play ?? 0} />}
    />
  );
}
