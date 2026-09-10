import type { AssetDto, SocialPostContentInput, SocialPostDto } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { AssetThumbnail } from '@/renderer/components/media/AssetThumbnail';

export function SocialPostContentPreview({
  content,
  assets,
}: {
  content: SocialPostContentInput;
  assets: readonly AssetDto[];
}) {
  const { messages } = useI18n();
  const copy = messages.creator.socialPostSave;
  return (
    <div className="mt-3 grid max-h-80 gap-3 overflow-auto rounded border bg-background p-3">
      <strong className="break-words">{content.title}</strong>
      <p className="whitespace-pre-wrap break-words text-sm">{content.body}</p>
      <div className="flex flex-wrap gap-2">
        {content.mediaAssetIds.map((id, index) => {
          const asset = assets.find((item) => item.id === id);
          return (
            <figure key={id} className="w-20 text-xs">
              {asset ? (
                <AssetThumbnail asset={asset} size={192} alt={`${index + 1}`} className="size-20 object-contain" />
              ) : (
                <span className="grid size-20 place-items-center text-muted-foreground">{copy.imageUnavailable}</span>
              )}
              <figcaption>
                {index + 1}
                {content.coverAssetId === id ? ` · ${copy.cover}` : ''}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}

export function SocialPostSaveConflict({
  post,
  disabled = false,
  onResolve,
}: {
  post: SocialPostDto;
  disabled?: boolean;
  onResolve(useLocal: boolean): void;
}) {
  const { messages } = useI18n();
  const copy = messages.creator.socialPostSave;
  return (
    <section role="alert" className="grid gap-3 rounded-lg border border-warning/50 bg-surface-sunken p-4">
      <p className="text-sm font-medium">{copy.conflict}</p>
      <details>
        <summary data-action="compare-social-post-revision" className="cursor-pointer text-sm">
          {copy.compareRevision.replace('{revision}', String(post.revisionNo))}
        </summary>
        <SocialPostContentPreview content={post.content} assets={post.content.mediaAssets} />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button data-action="keep-local-social-post" size="sm" disabled={disabled} onClick={() => onResolve(true)}>
            {copy.keepLocal}
          </Button>
          <Button
            data-action="load-saved-social-post"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => onResolve(false)}
          >
            {copy.loadSaved}
          </Button>
        </div>
      </details>
    </section>
  );
}
