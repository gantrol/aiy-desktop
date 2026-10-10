import { useI18n } from '@/renderer/i18n/useI18n';
import type { AssetDto, BrowserCompanionStageInput, BrowserCompanionTarget } from '@/shared/contracts';
import { contentImageNumber } from '@/shared/content-image-number';
import { xPostThread } from '@/shared/x-post-text';
import { X_POST_MEDIA_LIMIT } from '@/shared/x-thread-media';
import { TablePublicationPreview } from '@/renderer/features/browser-companion/TablePublicationPreview';

function attribute(value: string) {
  return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

export function PublicationPreview({
  prepared,
  assets,
  target,
  onChange,
  onImagesReady,
}: {
  prepared: Omit<BrowserCompanionStageInput, 'target' | 'watermark'>;
  assets: readonly AssetDto[];
  target: BrowserCompanionTarget;
  onChange?(prepared: Omit<BrowserCompanionStageInput, 'target' | 'watermark'>): void;
  onImagesReady?(ready: boolean): void;
}) {
  const { messages } = useI18n();
  const copy = messages.publishing;
  const ids = prepared.mediaAssetIds ?? [];
  const posts = target === 'x' ? xPostThread(prepared.text, ids.length) : null;
  const imageUrl = (id: string) =>
    prepared.tableConversion?.media.find((media) => media.assetId === id)?.mediaUrl ??
    assets.find((asset) => asset.id === id)?.mediaUrl ??
    `aiy-media://asset/${encodeURIComponent(id)}`;
  const html = prepared.articleHtml?.replace(
    /(<img\s[^>]*?\bsrc=")aiy-handoff-media:(\d+)(")/gu,
    (_match, prefix: string, index: string, suffix: string) =>
      prefix + (ids[Number(index)] ? attribute(imageUrl(ids[Number(index)]!)) : '') + suffix,
  );
  const mediaPreview = (start: number, end: number) =>
    start < Math.min(end, ids.length) && (
      <ol className="flex gap-2 overflow-x-auto pb-2" aria-label={copy.imageOrder}>
        {ids.slice(start, end).map((id, index) => (
          <li key={id} className="w-20 shrink-0 text-center">
            <img
              src={imageUrl(id)}
              alt=""
              className="h-20 w-20 rounded-sm bg-surface-sunken object-contain"
              loading="lazy"
            />
            <span className="text-xs text-muted-foreground">
              {messages.desktopPetals.document.imageNumber.replace(
                '{number}',
                contentImageNumber(start + index + 1, messages.desktopPetals.document.numbering),
              )}
            </span>
          </li>
        ))}
      </ol>
    );
  return (
    <div className="grid min-w-0 gap-3">
      {prepared.title && target !== 'x' && target !== 'weibo' && (
        <p className="break-words font-medium">{prepared.title}</p>
      )}
      {html ? (
        <iframe
          title={copy.articlePreview}
          sandbox=""
          referrerPolicy="no-referrer"
          className="h-80 w-full rounded-md border bg-white"
          srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src aiy-media: data:; style-src 'unsafe-inline';"></head><body>${html}</body></html>`}
        />
      ) : posts && posts.length > 1 ? (
        <ol className="grid max-h-64 list-decimal gap-3 overflow-y-auto pl-6 text-sm leading-relaxed">
          {posts.map((post, index) => (
            <li key={index} className="whitespace-pre-wrap break-words">
              {post && <p data-publication-text>{post}</p>}
              {mediaPreview(index * X_POST_MEDIA_LIMIT, (index + 1) * X_POST_MEDIA_LIMIT)}
            </li>
          ))}
        </ol>
      ) : (
        <p
          data-publication-text
          className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed"
        >
          {prepared.text}
        </p>
      )}
      {prepared.tableConversion && (
        <TablePublicationPreview
          prepared={prepared}
          target={target}
          onChange={onChange}
          onImagesReady={onImagesReady}
        />
      )}
      {!prepared.tableConversion && ids.length > 0 && !(posts && posts.length > 1) && (
        <div>
          <p className="mb-2 text-xs text-muted-foreground">{copy.imageOrder}</p>
          {mediaPreview(0, ids.length)}
        </div>
      )}
    </div>
  );
}
