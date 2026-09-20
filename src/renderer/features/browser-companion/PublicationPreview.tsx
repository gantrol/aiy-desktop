import { useI18n } from '@/renderer/i18n/useI18n';
import type { AssetDto, BrowserCompanionStageInput } from '@/shared/contracts';
import { contentImageNumber } from '@/shared/content-image-number';

function attribute(value: string) {
  return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

export function PublicationPreview({
  prepared,
  assets,
}: {
  prepared: Omit<BrowserCompanionStageInput, 'target' | 'watermark'>;
  assets: readonly AssetDto[];
}) {
  const { messages } = useI18n();
  const copy = messages.publishing;
  const ids = prepared.mediaAssetIds ?? [];
  const imageUrl = (id: string) =>
    assets.find((asset) => asset.id === id)?.mediaUrl ?? `aiy-media://asset/${encodeURIComponent(id)}`;
  const html = prepared.articleHtml?.replace(
    /(<img\s[^>]*?\bsrc=")aiy-handoff-media:(\d+)(")/gu,
    (_match, prefix: string, index: string, suffix: string) =>
      prefix + (ids[Number(index)] ? attribute(imageUrl(ids[Number(index)]!)) : '') + suffix,
  );
  return (
    <div className="grid min-w-0 gap-3">
      {prepared.title && <p className="break-words font-medium">{prepared.title}</p>}
      {html ? (
        <iframe
          title={copy.articlePreview}
          sandbox=""
          referrerPolicy="no-referrer"
          className="h-80 w-full rounded-md border bg-white"
          srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src aiy-media: data:; style-src 'unsafe-inline';"></head><body>${html}</body></html>`}
        />
      ) : (
        <p
          data-publication-text
          className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed"
        >
          {prepared.text}
        </p>
      )}
      {ids.length > 0 && (
        <div>
          <p className="mb-2 text-xs text-muted-foreground">{copy.imageOrder}</p>
          <ol className="flex gap-2 overflow-x-auto pb-2" aria-label={copy.imageOrder}>
            {ids.map((id, index) => (
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
                    contentImageNumber(index + 1, messages.desktopPetals.document.numbering),
                  )}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
