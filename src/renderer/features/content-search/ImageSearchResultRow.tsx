import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ImageSearchItem } from '@/shared/contracts/image-search';
import { imageSearchTitle } from '@/renderer/features/content-search/imageSearchPresentation';
import { ScratchImage } from '@/renderer/components/media/ScratchImage';
import { ContentSearchHighlight } from '@/renderer/features/content-search/ContentSearchHighlight';
import { SearchRelevance } from '@/renderer/features/content-search/SearchRelevance';

export function ImageSearchResultRow({
  item,
  selected,
  onSelect,
  onOpen,
  notify,
  disabled,
  onPreview,
  terms = [],
}: {
  item: ImageSearchItem;
  selected: boolean;
  onSelect(): void;
  onOpen(): void;
  notify(message: string): void;
  disabled?: boolean;
  onPreview?(): void;
  terms?: readonly string[];
}) {
  const { messages, locale } = useI18n();
  const copy = messages.imageSearch;
  const title = imageSearchTitle(item, copy, locale);
  return (
    <div role="listitem">
      <AssetFileContextMenu assetId={item.id} notify={notify}>
        <Button
          data-image-search-result
          data-search-result={`IMAGE:${item.id}`}
          disabled={disabled}
          variant="ghost"
          className="h-auto w-full justify-start gap-3 rounded-none px-3 py-2 text-left aria-pressed:bg-selected"
          aria-pressed={selected}
          onClick={onSelect}
          onFocus={onPreview}
          onDoubleClick={onOpen}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.nativeEvent.isComposing &&
              !event.altKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.shiftKey
            ) {
              event.preventDefault();
              onOpen();
            }
          }}
          title={`${title}\n${item.id}`}
        >
          <ScratchImage
            src={mediaThumbnailUrl(item, 144)}
            alt=""
            loading="lazy"
            className="size-16 shrink-0 object-contain"
          />
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 break-words whitespace-normal">{title}</span>
            {item.preview && (
              <span className="line-clamp-2 whitespace-pre-wrap break-words text-xs text-foreground-secondary">
                <ContentSearchHighlight text={item.preview} terms={terms} />
              </span>
            )}
            <span className="block text-xs tabular-nums text-muted-foreground">
              {item.match === 'EXACT' ? (
                copy.exact
              ) : item.match === 'TEXT' ? (
                copy.textMatch
              ) : item.match === 'OCR' ? (
                copy.ocrMatch
              ) : (
                <SearchRelevance score={item.score} channel="image" borderline={item.borderline} />
              )}
            </span>
            {item.borderline && item.match !== 'SEMANTIC' && (
              <SearchRelevance score={item.score} channel="image" borderline />
            )}
          </span>
        </Button>
      </AssetFileContextMenu>
    </div>
  );
}
