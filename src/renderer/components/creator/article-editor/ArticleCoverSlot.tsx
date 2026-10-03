import { useState, type DragEvent } from 'react';
import { CropIcon, ImagePlusIcon, ImagesIcon, LoaderCircleIcon, RotateCcwIcon, StarIcon, TypeIcon } from 'lucide-react';
import { ArticleHeaderIconButton } from '@/renderer/components/creator/article-editor/ArticleEditorHeader';
import { ArticleCoverRatioInfo } from '@/renderer/components/creator/article-editor/ArticleCoverRatioInfo';
import { useArticleCoverWorkspace } from '@/renderer/components/creator/article-editor/ArticleCoverWorkspace';
import {
  useArticleEditorSession,
  useArticleEditorSessionSelector,
} from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { generationPhaseLabel } from '@/renderer/components/generation/task-presentation';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { mediaThumbnailUrl } from '@/renderer/components/media/mediaThumbnailUrl';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { articleCoverAspectRatio, type ArticleCoverRatio } from '@/shared/article-covers';
import type { VideoDocumentRevisionMediaDto } from '@/shared/contracts';

export function ArticleCoverSlot({
  ratio,
  assetId,
  asset,
  hasVariant,
  isDefault,
  dropping,
  acceptsDrop,
  onDrop,
  onEdit,
  onGenerateText,
}: {
  ratio: ArticleCoverRatio;
  assetId: string | null;
  asset?: VideoDocumentRevisionMediaDto;
  hasVariant: boolean;
  isDefault: boolean;
  dropping: ArticleCoverRatio | null;
  acceptsDrop(data: DataTransfer): boolean;
  onDrop(event: DragEvent, ratio: ArticleCoverRatio): Promise<void>;
  onEdit(): void;
  onGenerateText(): void;
}) {
  const { messages } = useI18n();
  const copy = messages.contentEditor.coverEditor;
  const session = useArticleEditorSession();
  const editableText = useArticleEditorSessionSelector((state) =>
    Boolean(
      state.draft.metadata.coverVariants?.some(
        (variant) => variant.ratio === ratio && variant.assetId === assetId && variant.textSource,
      ),
    ),
  );
  const textLabel = editableText ? messages.textCoverSource.edit : messages.contentEditor.textCover.generate;
  const previewAction = editableText
    ? { label: textLabel, Icon: TypeIcon, open: onGenerateText }
    : { label: copy.edit, Icon: CropIcon, open: onEdit };
  const PreviewIcon = previewAction.Icon;
  const workspace = useArticleCoverWorkspace();
  const [dragOver, setDragOver] = useState(false);
  const generation = workspace.generations[ratio];
  const opening = workspace.openingRatio === ratio || workspace.openingRatio === 'shared';
  const busy = opening || Boolean(generation);
  const status = generation
    ? generationPhaseLabel(generation.task, messages.creator.generationTasks)
    : opening
      ? messages.creator.generationTasks.preparing
      : '';
  const generationLabel = (generation ? copy.viewGenerationRatio : copy.generateRatio).replace('{ratio}', ratio);
  const generationDisabled = Boolean(workspace.openingRatio || dropping) || (!generation && !workspace.canGenerate);
  const openGeneration = () => {
    if (generation) workspace.onOpenGeneration(generation);
    else void workspace.onGenerate(ratio);
  };
  const preview = (
    <Button
      type="button"
      variant="ghost"
      aria-label={`${previewAction.label} ${ratio}`}
      aria-busy={busy || undefined}
      title={`${previewAction.label} ${ratio}`}
      className={cn(
        'group relative mx-auto flex h-20 overflow-hidden rounded-sm bg-surface-sunken p-0',
        dragOver && 'ring-2 ring-ring ring-inset',
      )}
      style={{ width: articleCoverAspectRatio(ratio) * 80 }}
      disabled={Boolean(dropping)}
      onClick={previewAction.open}
      onDragOver={(event) => {
        if (!acceptsDrop(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
          setDragOver(false);
      }}
      onDrop={(event) => {
        setDragOver(false);
        void onDrop(event, ratio);
      }}
    >
      {dropping === ratio ? (
        <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
      ) : asset ? (
        <>
          <img
            src={mediaThumbnailUrl({ id: asset.assetId }, 192)}
            alt=""
            loading="lazy"
            className="size-full object-cover"
            draggable={false}
          />
          <PreviewIcon className="absolute right-1 bottom-1 size-5 rounded-sm bg-background/90 p-0.5 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
          {busy && (
            <span className="absolute top-1 right-1 rounded-sm bg-background/90 p-1">
              <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
            </span>
          )}
        </>
      ) : busy ? (
        <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
      ) : (
        <ImagePlusIcon className="size-4 text-muted-foreground" />
      )}
    </Button>
  );
  return (
    <div className="shrink-0" style={{ width: Math.max(80, articleCoverAspectRatio(ratio) * 80) }}>
      {assetId ? (
        <AssetFileContextMenu
          assetId={assetId}
          actions={[
            { id: 'crop-cover', label: copy.edit, icon: CropIcon, onSelect: onEdit },
            {
              id: 'generate-text-cover',
              label: textLabel,
              icon: TypeIcon,
              onSelect: onGenerateText,
              disabled: Boolean(dropping),
            },
            {
              id: 'generate-cover',
              label: generationLabel,
              icon: busy ? LoaderCircleIcon : ImagePlusIcon,
              disabled: generationDisabled,
              onSelect: openGeneration,
            },
            {
              id: 'use-shared-cover',
              label: copy.setDefault,
              icon: StarIcon,
              disabled: !asset || isDefault,
              onSelect: () => session.coverChanged(assetId),
            },
          ]}
        >
          {preview}
        </AssetFileContextMenu>
      ) : (
        preview
      )}
      <div className="mt-1 flex items-center justify-between gap-1 text-xs tabular-nums text-muted-foreground">
        <div className="flex items-center gap-0.5">
          <span>{ratio}</span>
          <ArticleCoverRatioInfo ratio={ratio} />
        </div>
        {hasVariant && (
          <ArticleHeaderIconButton
            variant="ghost"
            className="size-6"
            label={`${copy.useDefault} ${ratio}`}
            onClick={() => session.coverVariantChanged(ratio, null)}
          >
            <RotateCcwIcon className="size-3" />
          </ArticleHeaderIconButton>
        )}
      </div>
      <div className="flex items-center gap-0.5">
        <ArticleHeaderIconButton
          variant="ghost"
          label={`${textLabel} ${ratio}`}
          disabled={Boolean(dropping)}
          onClick={onGenerateText}
        >
          <TypeIcon className="size-3.5" />
        </ArticleHeaderIconButton>
        <ArticleHeaderIconButton variant="ghost" label={`${copy.chooseImage} ${ratio}`} onClick={onEdit}>
          <ImagesIcon className="size-3.5" />
        </ArticleHeaderIconButton>
        <Button
          type="button"
          variant="ghost"
          size={busy ? 'sm' : 'icon-sm'}
          className={cn('min-w-0', busy && 'h-7 flex-1 justify-start gap-1 px-1 text-xs')}
          aria-label={status ? `${generationLabel} · ${status}` : generationLabel}
          title={status ? `${generationLabel} · ${status}` : generationLabel}
          disabled={generationDisabled}
          onClick={openGeneration}
        >
          {busy ? (
            <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
          ) : (
            <ImagePlusIcon className="size-3.5" />
          )}
          {busy && <span className="truncate">{status}</span>}
        </Button>
      </div>
      <span role="status" className="sr-only">
        {status && `${ratio} · ${status}`}
      </span>
    </div>
  );
}
