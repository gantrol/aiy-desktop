import { hasExternalFilesDrag, hasMaterialsDrag, readMaterialsDrag } from '@/renderer/components/albums/albumDrag';
import {
  CreationRelationsPreview,
  type CreationRelationItem,
} from '@/renderer/components/creator/CreationRelationsSheet';
import { SocialPostMediaActions } from '@/renderer/components/creator/SocialPostMediaActions';
import { SocialPostMediaOrderHandle } from '@/renderer/components/creator/SocialPostMediaOrderHandle';
import { SocialPostMediaPreviewDialog } from '@/renderer/components/creator/SocialPostMediaPreviewDialog';
import {
  clipboardHasUserText,
  clipboardImageFiles,
  imageFiles,
  imageImportItems,
  imageMimeType,
  transferSourceUrl,
  type RendererImageImportSource,
} from '@/renderer/components/creator/imageImport';
import { move, moveTo } from '@/renderer/components/creator/socialPostEditorTransforms';
import {
  hasSocialPostMediaReorderDrag,
  socialPostMediaDropEffect,
  socialPostMediaReorderSourceId,
  startSocialPostMediaDrag,
} from '@/renderer/components/creator/socialPostMediaDrag';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { MediaActionMenu } from '@/renderer/components/media/MediaActionMenu';
import type { ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import type { AssetDto, Locale, SocialPostContentInput } from '@/shared/contracts';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CopyIcon,
  Link2Icon,
  LoaderCircleIcon,
  StarIcon,
  Trash2Icon,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type Dispatch,
  type DragEvent,
  type SetStateAction,
} from 'react';
const socialPostMediaLimit = 100;
const importBatchLimit = 8;

export function useSocialPostMediaIntake({
  content,
  locale,
  notify,
  setContent,
  setMediaAssets,
  trackInput,
}: {
  content: SocialPostContentInput;
  locale: Locale;
  notify(message: string): void;
  setContent: Dispatch<SetStateAction<SocialPostContentInput>>;
  setMediaAssets: Dispatch<SetStateAction<AssetDto[]>>;
  trackInput(operation: Promise<void>): Promise<void>;
}) {
  const socialCopy = useI18n().messages.creator.socialPostEditor;
  const editorCopy = useI18n().messages.contentEditor;
  const addingRef = useRef(false);
  const contentRef = useRef(content);
  const [adding, setAdding] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  contentRef.current = content;

  function appendMediaAssets(additions: readonly AssetDto[]) {
    const existingIds = new Set(contentRef.current.mediaAssetIds);
    const unique = additions.filter((asset, index) => {
      if (existingIds.has(asset.id)) return false;
      return additions.findIndex((candidate) => candidate.id === asset.id) === index;
    });
    const accepted = unique.slice(0, Math.max(0, socialPostMediaLimit - existingIds.size));
    if (!accepted.length) return 0;

    const acceptedIds = accepted.map((asset) => asset.id);
    setMediaAssets((current) => {
      const merged = new Map(current.map((asset) => [asset.id, asset]));
      accepted.forEach((asset) => merged.set(asset.id, asset));
      return [...merged.values()];
    });
    setContent((current) => {
      const currentIds = new Set(current.mediaAssetIds);
      const nextIds = acceptedIds.filter((id) => !currentIds.has(id));
      if (!nextIds.length) return current;
      return {
        ...current,
        mediaAssetIds: [...current.mediaAssetIds, ...nextIds].slice(0, socialPostMediaLimit),
        coverAssetId: current.coverAssetId ?? nextIds[0] ?? null,
      };
    });
    return accepted.length;
  }

  async function importMediaFiles(candidates: readonly File[], source: RendererImageImportSource, sourceUrl = '') {
    const files = candidates.filter((file) => imageMimeType(file));
    if (!files.length) {
      notify(socialCopy.onlyImages);
      return;
    }
    if (addingRef.current) {
      notify(socialCopy.importing);
      return;
    }

    const capacity = Math.max(0, socialPostMediaLimit - contentRef.current.mediaAssetIds.length);
    if (!capacity) {
      notify(socialCopy.imageLimit.replace('{count}', String(socialPostMediaLimit)));
      return;
    }

    addingRef.current = true;
    setAdding(true);
    const selectedFiles = files.slice(0, capacity);
    let added = 0;
    try {
      for (let index = 0; index < selectedFiles.length; index += importBatchLimit) {
        const items = await imageImportItems(selectedFiles.slice(index, index + importBatchLimit));
        const assets = await window.desktopApi.creatorReferencesImport({
          context: {
            seriesId: null,
            versionId: null,
            title: contentRef.current.title,
            titleLocale: locale,
            source,
            sourceUrl,
          },
          items,
        });
        added += appendMediaAssets(assets);
      }
      notify(added ? editorCopy.imageAdded.replace('{count}', String(added)) : socialCopy.alreadyAttached);
      if (selectedFiles.length < files.length) {
        notify(socialCopy.imageLimitReached.replace('{count}', String(socialPostMediaLimit)));
      }
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason);
      notify(
        added ? editorCopy.partialImageImport.replace('{count}', String(added)).replace('{detail}', detail) : detail,
      );
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  }

  async function chooseMedia() {
    if (addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    try {
      const result = await window.desktopApi.assetsChooseReferences();
      const added = appendMediaAssets(result.assets);
      if (result.assets.length && !added) {
        notify(socialCopy.selectionAttached);
      }
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  }

  async function addMaterialImages(dataTransfer: DataTransfer) {
    const targets = readMaterialsDrag(dataTransfer);
    if (!targets.length) return;
    if (addingRef.current) {
      notify(socialCopy.adding);
      return;
    }
    const capacity = Math.max(0, socialPostMediaLimit - contentRef.current.mediaAssetIds.length);
    if (!capacity) {
      notify(socialCopy.imageLimit.replace('{count}', String(socialPostMediaLimit)));
      return;
    }

    addingRef.current = true;
    setAdding(true);
    try {
      const assets = await window.desktopApi.materialImageAssetsResolve({ targets: targets.slice(0, capacity) });
      const added = appendMediaAssets(assets);
      notify(added ? editorCopy.imageAdded.replace('{count}', String(added)) : socialCopy.alreadyAttached);
      if (targets.length > capacity) {
        notify(socialCopy.imageLimitReached.replace('{count}', String(socialPostMediaLimit)));
      }
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  }

  function pasteImages(event: ClipboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented) return;
    const files = clipboardImageFiles(event.clipboardData).filter((file) => imageMimeType(file));
    if (!files.length) return;
    if (!clipboardHasUserText(event.clipboardData)) event.preventDefault();
    void trackInput(importMediaFiles(files, 'PASTE', transferSourceUrl(event.clipboardData)));
  }

  function dragMedia(event: DragEvent<HTMLDivElement>, active: boolean) {
    if (event.defaultPrevented) return;
    if (hasMaterialsDrag(event.dataTransfer)) {
      event.preventDefault();
      if (event.type === 'dragover') event.dataTransfer.dropEffect = 'copy';
      setDragActive(active);
      return;
    }
    if (!hasExternalFilesDrag(event.dataTransfer)) return;
    event.preventDefault();
    if (event.type === 'dragover') event.dataTransfer.dropEffect = 'copy';
    setDragActive(active);
  }

  function dropMedia(event: DragEvent<HTMLDivElement>) {
    if (event.defaultPrevented) {
      setDragActive(false);
      return;
    }
    if (hasMaterialsDrag(event.dataTransfer)) {
      event.preventDefault();
      setDragActive(false);
      void trackInput(addMaterialImages(event.dataTransfer));
      return;
    }
    if (!hasExternalFilesDrag(event.dataTransfer)) return;
    event.preventDefault();
    setDragActive(false);
    void trackInput(
      importMediaFiles(imageFiles(event.dataTransfer.files), 'DROP', transferSourceUrl(event.dataTransfer)),
    );
  }

  return { adding, chooseMedia: () => trackInput(chooseMedia()), dragActive, dragMedia, dropMedia, pasteImages };
}

export function SocialPostMediaSection({
  adding,
  assetsById,
  content,
  generatingCover,
  locale,
  notify,
  onAdd,
  onChangeIds,
  onGenerateCover,
  onOpenRelations,
  onSelectRelation,
  onSetCover,
  relations,
}: {
  adding: boolean;
  assetsById: ReadonlyMap<string, AssetDto>;
  content: SocialPostContentInput;
  generatingCover: boolean;
  locale: Locale;
  notify(message: string): void;
  onAdd(): void;
  onChangeIds(ids: string[]): void;
  onGenerateCover(): void;
  onOpenRelations(assetId: string | null): void;
  onSelectRelation(item: CreationRelationItem): void;
  onSetCover(assetId: string): void;
  relations: readonly CreationRelationItem[];
}) {
  const zh = locale === 'zh';
  const socialCopy = useI18n().messages.creator.socialPostEditor;
  const { messages } = useI18n();
  const fileLabels = messages.assetFile;
  const moreActionsLabel = messages.creator.album.moreActions;
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [copyingAssetId, setCopyingAssetId] = useState<string | null>(null);

  useEffect(() => {
    if (previewAssetId && !content.mediaAssetIds.includes(previewAssetId)) setPreviewAssetId(null);
  }, [content.mediaAssetIds, previewAssetId]);

  async function copyImage(assetId: string) {
    if (copyingAssetId) return;
    setCopyingAssetId(assetId);
    notify(fileLabels.copying);
    try {
      await window.desktopApi.assetFileCopy(assetId);
      notify(fileLabels.copied);
    } catch (reason) {
      notify(`${fileLabels.failed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setCopyingAssetId(null);
    }
  }

  function removeImage(assetId: string) {
    const index = content.mediaAssetIds.indexOf(assetId);
    const nextPreviewId = content.mediaAssetIds[index + 1] ?? content.mediaAssetIds[index - 1] ?? null;
    onChangeIds(content.mediaAssetIds.filter((id) => id !== assetId));
    if (previewAssetId === assetId) setPreviewAssetId(nextPreviewId);
  }

  return (
    <section className="grid gap-3">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground-secondary">
          {socialCopy.imageCount.replace('{count}', String(content.mediaAssetIds.length))}
        </span>
        <SocialPostMediaActions
          adding={adding}
          generatingCover={generatingCover}
          onAdd={onAdd}
          onGenerateCover={onGenerateCover}
          zh={zh}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {content.mediaAssetIds.map((assetId, index) => {
          const asset = assetsById.get(assetId);
          const cover = content.coverAssetId === assetId;
          const actions: ActionMenuAction[] = [
            ...(!cover
              ? [
                  {
                    id: 'social-post-media-set-cover',
                    label: socialCopy.setCover,
                    icon: StarIcon,
                    onSelect: () => onSetCover(assetId),
                  } satisfies ActionMenuAction,
                ]
              : []),
            {
              id: 'social-post-media-move-earlier',
              label: socialCopy.moveEarlier,
              icon: ArrowLeftIcon,
              disabled: index === 0,
              onSelect: () => onChangeIds(move(content.mediaAssetIds, index, -1)),
            },
            {
              id: 'social-post-media-move-later',
              label: socialCopy.moveLater,
              icon: ArrowRightIcon,
              disabled: index === content.mediaAssetIds.length - 1,
              onSelect: () => onChangeIds(move(content.mediaAssetIds, index, 1)),
            },
            {
              id: 'social-post-media-copy',
              label: fileLabels.copy,
              icon: copyingAssetId === assetId ? LoaderCircleIcon : CopyIcon,
              busy: copyingAssetId === assetId,
              disabled: !asset || Boolean(copyingAssetId),
              onSelect: () => asset && void copyImage(asset.id),
            },
            {
              id: 'social-post-media-remove',
              label: socialCopy.removeImage,
              icon: Trash2Icon,
              destructive: true,
              separatorBefore: true,
              onSelect: () => removeImage(assetId),
            },
          ];
          const contextActions = actions.filter(
            (action) => action.id !== 'social-post-media-copy' && action.id !== 'social-post-media-remove',
          );
          const usageCount = relations.filter((item) => item.imageAssetIds.includes(assetId)).length;
          return (
            <figure
              key={assetId}
              data-social-post-media-id={assetId}
              className={cn('group min-w-0', dragTargetId === assetId && 'ring-2 ring-selected-border')}
              onDragEnter={(event) => {
                if (!hasSocialPostMediaReorderDrag(event.dataTransfer, content.mediaAssetIds)) return;
                event.preventDefault();
                event.stopPropagation();
                setDragTargetId(assetId);
              }}
              onDragOver={(event) => {
                if (!hasSocialPostMediaReorderDrag(event.dataTransfer, content.mediaAssetIds)) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = socialPostMediaDropEffect(event.dataTransfer);
                setDragTargetId(assetId);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragTargetId(null);
              }}
              onDrop={(event) => {
                const sourceId = socialPostMediaReorderSourceId(event.dataTransfer, content.mediaAssetIds);
                if (!sourceId) return;
                event.preventDefault();
                setDragTargetId(null);
                onChangeIds(
                  moveTo(
                    content.mediaAssetIds,
                    content.mediaAssetIds.indexOf(sourceId),
                    content.mediaAssetIds.indexOf(assetId),
                  ),
                );
              }}
            >
              <div className="relative aspect-square overflow-hidden rounded-lg border bg-surface-sunken">
                {asset ? (
                  <AssetFileContextMenu assetId={asset.id} notify={notify} actions={contextActions} draggable={false}>
                    <button
                      type="button"
                      data-action="preview-social-post-image"
                      draggable
                      className="relative size-full cursor-grab overflow-hidden outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      title={socialCopy.imageAction}
                      aria-label={messages.contentEditor.imageActions.replace('{index}', String(index + 1))}
                      onDragStart={(event) => {
                        try {
                          startSocialPostMediaDrag(event, assetId);
                        } catch (reason) {
                          notify(`${fileLabels.failed}: ${reason instanceof Error ? reason.message : String(reason)}`);
                        }
                      }}
                      onClick={() => setPreviewAssetId(asset.id)}
                    >
                      <img
                        src={asset.mediaUrl}
                        alt=""
                        className="pointer-events-none size-full bg-media-surround-light object-contain"
                        draggable={false}
                      />
                    </button>
                  </AssetFileContextMenu>
                ) : (
                  <div className="grid size-full place-items-center text-xs text-muted-foreground">
                    {socialCopy.unavailable}
                  </div>
                )}
                <SocialPostMediaOrderHandle
                  assetId={assetId}
                  index={index}
                  zh={zh}
                  onDragEnd={() => setDragTargetId(null)}
                  onMove={(offset) => onChangeIds(move(content.mediaAssetIds, index, offset))}
                />
                {cover && (
                  <span className="pointer-events-none absolute top-1.5 right-1.5 z-10 flex items-center gap-1 rounded bg-overlay/90 px-1.5 py-0.5 text-2xs">
                    <StarIcon className="size-3 fill-current" />
                    {socialCopy.cover}
                  </span>
                )}
                <MediaActionMenu
                  actions={actions}
                  label={moreActionsLabel}
                  className="absolute right-1.5 bottom-1.5 z-20 size-7"
                />
              </div>
              {usageCount > 0 && (
                <figcaption>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-1 h-7 px-1.5 text-xs text-muted-foreground"
                    onClick={() => onOpenRelations(assetId)}
                  >
                    <Link2Icon className="size-3.5" />
                    {socialCopy.usageCount.replace('{count}', String(usageCount))}
                  </Button>
                </figcaption>
              )}
            </figure>
          );
        })}
      </div>
      <CreationRelationsPreview items={relations} onSelect={onSelectRelation} />
      <SocialPostMediaPreviewDialog
        assetIds={content.mediaAssetIds}
        assetsById={assetsById}
        coverAssetId={content.coverAssetId}
        copyingAssetId={copyingAssetId}
        copyLabel={fileLabels.copy}
        locale={locale}
        openAssetId={previewAssetId}
        notify={notify}
        onCopy={(assetId) => void copyImage(assetId)}
        onOpenAssetIdChange={setPreviewAssetId}
        onRemove={removeImage}
        onSetCover={onSetCover}
      />
    </section>
  );
}
