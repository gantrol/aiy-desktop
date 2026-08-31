import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type Dispatch,
  type DragEvent,
  type SetStateAction,
} from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CopyIcon,
  ImagePlusIcon,
  Link2Icon,
  LoaderCircleIcon,
  StarIcon,
  Trash2Icon,
} from 'lucide-react';
import type {
  AssetDto,
  BrowserCompanionTarget,
  CanvasPresetDto,
  Locale,
  SocialPostContentInput,
  SocialPostDto,
} from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { hasExternalFilesDrag, hasMaterialsDrag, readMaterialsDrag } from '@/renderer/components/albums/albumDrag';
import {
  clipboardImageFiles,
  clipboardHasUserText,
  imageFiles,
  imageImportItems,
  imageMimeType,
  transferSourceUrl,
  type RendererImageImportSource,
} from '@/renderer/components/creator/imageImport';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Textarea } from '@/renderer/components/ui/textarea';
import type { ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { AssetFileDragHandle } from '@/renderer/components/media/AssetFileDragHandle';
import { MediaActionMenu } from '@/renderer/components/media/MediaActionMenu';
import { MediaOrderHandle } from '@/renderer/components/media/MediaOrderHandle';
import { SocialPostMediaPreviewDialog } from '@/renderer/components/creator/SocialPostMediaPreviewDialog';
import { SocialPostHeader } from '@/renderer/components/creator/SocialPostHeader';
import {
  hasSocialPostMediaReorderDrag,
  socialPostMediaReorderSourceId,
  startSocialPostMediaDrag,
} from '@/renderer/components/creator/socialPostMediaDrag';
import { useBrowserCompanionHandoff } from '@/renderer/features/browser-companion/useBrowserCompanionHandoff';
import { prepareSocialPostHandoff } from '@/renderer/features/browser-companion/prepareSocialPostHandoff';
import {
  CreationRelationsPreview,
  CreationRelationsSheet,
  type CreationRelationItem,
} from '@/renderer/components/creator/CreationRelationsSheet';
interface Props {
  post: SocialPostDto;
  locale: Locale;
  canvasPresets: CanvasPresetDto[];
  handoffTargets: readonly BrowserCompanionTarget[];
  relations: readonly CreationRelationItem[];
  onSave(content: SocialPostContentInput): Promise<SocialPostDto>;
  onCreateSocialPost(content: SocialPostContentInput, copySourceContent: boolean): Promise<void>;
  onCreateArticle(
    content: SocialPostContentInput,
    mediaAssets: readonly AssetDto[],
    copySourceContent: boolean,
  ): Promise<void>;
  onGenerateCover(post: SocialPostDto, content: SocialPostContentInput, preset: CanvasPresetDto): Promise<void>;
  onOpenRelation(item: CreationRelationItem): void;
  notify(message: string): void;
}

const socialPostMediaLimit = 100;
const importBatchLimit = 8;

function editableContent(post: SocialPostDto): SocialPostContentInput {
  const { mediaAssets: _mediaAssets, ...content } = post.content;
  return {
    ...content,
    mediaAssetIds: [...content.mediaAssetIds],
  };
}

function move<T>(items: readonly T[], index: number, offset: -1 | 1) {
  const target = index + offset;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function moveTo<T>(items: readonly T[], sourceIndex: number, targetIndex: number) {
  if (sourceIndex === targetIndex || sourceIndex < 0 || targetIndex < 0) return [...items];
  const next = [...items];
  const [item] = next.splice(sourceIndex, 1);
  if (item === undefined) return [...items];
  next.splice(targetIndex, 0, item);
  return next;
}

function useSocialPostMediaIntake({
  content,
  locale,
  notify,
  setContent,
  setMediaAssets,
}: {
  content: SocialPostContentInput;
  locale: Locale;
  notify(message: string): void;
  setContent: Dispatch<SetStateAction<SocialPostContentInput>>;
  setMediaAssets: Dispatch<SetStateAction<AssetDto[]>>;
}) {
  const zh = locale === 'zh';
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
      notify(zh ? '这里只能添加图片' : 'Only images can be added here');
      return;
    }
    if (addingRef.current) {
      notify(zh ? '图片仍在导入' : 'Images are still being imported');
      return;
    }

    const capacity = Math.max(0, socialPostMediaLimit - contentRef.current.mediaAssetIds.length);
    if (!capacity) {
      notify(
        zh ? `一条贴图最多 ${socialPostMediaLimit} 张图片` : `A post can contain up to ${socialPostMediaLimit} images`,
      );
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
      notify(
        added
          ? zh
            ? `已添加 ${added} 张图片`
            : `${added} image${added === 1 ? '' : 's'} added`
          : zh
            ? '这些图片已在当前贴图中'
            : 'These images are already in this post',
      );
      if (selectedFiles.length < files.length) {
        notify(zh ? `已达到 ${socialPostMediaLimit} 张上限` : `The ${socialPostMediaLimit}-image limit was reached`);
      }
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason);
      notify(
        added
          ? zh
            ? `已添加 ${added} 张，其余图片导入失败：${detail}`
            : `${added} added; the remaining images could not be imported: ${detail}`
          : detail,
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
        notify(zh ? '所选图片已在当前贴图中' : 'The selected images are already in this post');
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
      notify(zh ? '图片仍在添加' : 'Images are still being added');
      return;
    }
    const capacity = Math.max(0, socialPostMediaLimit - contentRef.current.mediaAssetIds.length);
    if (!capacity) {
      notify(
        zh ? `一条贴图最多 ${socialPostMediaLimit} 张图片` : `A post can contain up to ${socialPostMediaLimit} images`,
      );
      return;
    }

    addingRef.current = true;
    setAdding(true);
    try {
      const assets = await window.desktopApi.materialImageAssetsResolve({ targets: targets.slice(0, capacity) });
      const added = appendMediaAssets(assets);
      notify(
        added
          ? zh
            ? `已添加 ${added} 张图片`
            : `${added} image${added === 1 ? '' : 's'} added`
          : zh
            ? '这些图片已在当前贴图中'
            : 'These images are already in this post',
      );
      if (targets.length > capacity) {
        notify(zh ? `已达到 ${socialPostMediaLimit} 张上限` : `The ${socialPostMediaLimit}-image limit was reached`);
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
    void importMediaFiles(files, 'PASTE', transferSourceUrl(event.clipboardData));
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
      void addMaterialImages(event.dataTransfer);
      return;
    }
    if (!hasExternalFilesDrag(event.dataTransfer)) return;
    event.preventDefault();
    setDragActive(false);
    void importMediaFiles(imageFiles(event.dataTransfer.files), 'DROP', transferSourceUrl(event.dataTransfer));
  }

  return { adding, chooseMedia, dragActive, dragMedia, dropMedia, pasteImages };
}

function SocialPostMediaSection({
  adding,
  assetsById,
  content,
  locale,
  notify,
  onAdd,
  onChangeIds,
  onOpenRelations,
  onSelectRelation,
  onSetCover,
  relations,
}: {
  adding: boolean;
  assetsById: ReadonlyMap<string, AssetDto>;
  content: SocialPostContentInput;
  locale: Locale;
  notify(message: string): void;
  onAdd(): void;
  onChangeIds(ids: string[]): void;
  onOpenRelations(assetId: string | null): void;
  onSelectRelation(item: CreationRelationItem): void;
  onSetCover(assetId: string): void;
  relations: readonly CreationRelationItem[];
}) {
  const zh = locale === 'zh';
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
    <section className="grid gap-3 border-t pt-4">
      <div className="flex h-8 items-center justify-between gap-3">
        <span className="text-xs font-medium text-foreground-secondary">
          {zh ? `图片 · ${content.mediaAssetIds.length}` : `Images · ${content.mediaAssetIds.length}`}
        </span>
        <Button type="button" variant="outline" size="sm" disabled={adding} onClick={onAdd}>
          {adding ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ImagePlusIcon className="size-4" />}
          {zh ? '添加图片' : 'Add images'}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {content.mediaAssetIds.map((assetId, index) => {
          const asset = assetsById.get(assetId);
          const cover = content.coverAssetId === assetId;
          const actions: ActionMenuAction[] = [
            ...(!cover
              ? [
                  {
                    id: 'social-post-media-set-cover',
                    label: zh ? '设为首图' : 'Set as cover',
                    icon: StarIcon,
                    onSelect: () => onSetCover(assetId),
                  } satisfies ActionMenuAction,
                ]
              : []),
            {
              id: 'social-post-media-move-earlier',
              label: zh ? '前移' : 'Move earlier',
              icon: ArrowLeftIcon,
              disabled: index === 0,
              onSelect: () => onChangeIds(move(content.mediaAssetIds, index, -1)),
            },
            {
              id: 'social-post-media-move-later',
              label: zh ? '后移' : 'Move later',
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
              label: zh ? '从贴图移除' : 'Remove from post',
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
              className={cn('group min-w-0', dragTargetId === assetId && 'ring-2 ring-selected-border')}
              onDragEnter={(event) => {
                if (!hasSocialPostMediaReorderDrag(event.dataTransfer)) return;
                event.preventDefault();
                event.stopPropagation();
                setDragTargetId(assetId);
              }}
              onDragOver={(event) => {
                if (!hasSocialPostMediaReorderDrag(event.dataTransfer)) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = 'move';
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
                      draggable
                      className="relative size-full cursor-grab overflow-hidden outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      title={zh ? '拖动调整顺序，单击放大' : 'Drag to reorder, click to enlarge'}
                      aria-label={
                        zh
                          ? `第 ${index + 1} 张图片：拖动调整顺序，单击放大`
                          : `Image ${index + 1}: drag to reorder, click to enlarge`
                      }
                      onDragStart={(event) => startSocialPostMediaDrag(event, assetId)}
                      onDragEnd={() => setDragTargetId(null)}
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
                    {zh ? '图片不可用' : 'Unavailable'}
                  </div>
                )}
                <MediaOrderHandle
                  draggable
                  className="absolute top-1.5 left-1.5 z-20 tabular-nums"
                  label={zh ? `拖动第 ${index + 1} 张图片调整顺序` : `Drag image ${index + 1} to reorder`}
                  onDragStart={(event) => startSocialPostMediaDrag(event, assetId)}
                  onDragEnd={() => setDragTargetId(null)}
                >
                  {index + 1}
                </MediaOrderHandle>
                {asset && (
                  <AssetFileDragHandle
                    assetId={asset.id}
                    label={zh ? `拖动第 ${index + 1} 张图片到其他应用` : `Drag image ${index + 1} to another app`}
                    notify={notify}
                    className="absolute bottom-1.5 left-1.5 z-20 size-7"
                  />
                )}
                {cover && (
                  <span className="pointer-events-none absolute top-1.5 right-1.5 z-10 flex items-center gap-1 rounded bg-overlay/90 px-1.5 py-0.5 text-2xs">
                    <StarIcon className="size-3 fill-current" />
                    {zh ? '首图' : 'Cover'}
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
                    {zh ? `用于 ${usageCount}` : `Used by ${usageCount}`}
                  </Button>
                </figcaption>
              )}
            </figure>
          );
        })}
      </div>
      <CreationRelationsPreview items={relations} locale={locale} onSelect={onSelectRelation} />
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

export function SocialPostEditor({
  post,
  locale,
  canvasPresets,
  handoffTargets,
  relations,
  onSave,
  onCreateSocialPost,
  onCreateArticle,
  onGenerateCover,
  onOpenRelation,
  notify,
}: Props) {
  const zh = locale === 'zh';
  const [content, setContent] = useState<SocialPostContentInput>(() => editableContent(post));
  const [mediaAssets, setMediaAssets] = useState<AssetDto[]>(post.content.mediaAssets);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(editableContent(post)));
  const savedJsonRef = useRef(savedJson);
  const postIdRef = useRef(post.id);
  const savedPostRef = useRef(post);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [failedJson, setFailedJson] = useState<string | null>(null);
  const [creatingForm, setCreatingForm] = useState(false);
  const [generatingCover, setGeneratingCover] = useState(false);
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [relationAssetId, setRelationAssetId] = useState<string | null>(null);
  const defaultCoverPreset = canvasPresets.find((preset) => preset.stableKey === 'xiaohongshu_portrait_3_4');
  const contentJson = useMemo(() => JSON.stringify(content), [content]);
  const dirty = contentJson !== savedJson;
  const saveFailed = failedJson === contentJson;
  const assetsById = useMemo(() => new Map(mediaAssets.map((asset) => [asset.id, asset])), [mediaAssets]);
  const saveForEffect = useStableCallback(onSave);
  const notifyForEffect = useStableCallback(notify);
  const mediaIntake = useSocialPostMediaIntake({ content, locale, notify, setContent, setMediaAssets });

  useEffect(() => {
    const incoming = editableContent(post);
    const incomingJson = JSON.stringify(incoming);
    if (postIdRef.current !== post.id) {
      postIdRef.current = post.id;
      savedPostRef.current = post;
      savedJsonRef.current = incomingJson;
      setContent(incoming);
      setMediaAssets(post.content.mediaAssets);
      setSavedJson(incomingJson);
      setFailedJson(null);
      return;
    }

    const previousSavedJson = savedJsonRef.current;
    savedPostRef.current = post;
    savedJsonRef.current = incomingJson;
    setSavedJson(incomingJson);
    setFailedJson((current) => (current === incomingJson ? null : current));
    setContent((current) => (JSON.stringify(current) === previousSavedJson ? incoming : current));
    setMediaAssets((current) => {
      const merged = new Map(current.map((asset) => [asset.id, asset]));
      post.content.mediaAssets.forEach((asset) => merged.set(asset.id, asset));
      return [...merged.values()];
    });
  }, [post]);

  const persist = useStableCallback(async (snapshot: SocialPostContentInput) => {
    const snapshotJson = JSON.stringify(snapshot);
    if (snapshotJson === savedJsonRef.current) return true;
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      const savedPost = await saveForEffect(snapshot);
      savedPostRef.current = savedPost;
      savedJsonRef.current = snapshotJson;
      setSavedJson(snapshotJson);
      setFailedJson(null);
      return true;
    } catch (reason) {
      setFailedJson(snapshotJson);
      const detail = reason instanceof Error ? reason.message : String(reason);
      notifyForEffect(zh ? `贴图自动保存失败：${detail}` : `Could not autosave the social post: ${detail}`);
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  });
  const { busy: handingOff, handoff: handoffToBrowser } = useBrowserCompanionHandoff({
    notify,
    zh,
    prepare: (target) => prepareSocialPostHandoff({ content, dirty, notify, persist, postId: post.id, target, zh }),
  });

  useEffect(() => {
    if (!dirty || saving || saveFailed) return;
    const snapshot = content;
    const timeout = window.setTimeout(() => void persist(snapshot), 650);
    return () => window.clearTimeout(timeout);
  }, [content, dirty, persist, saveFailed, saving]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== 's') return;
      event.preventDefault();
      void persist(content);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [content, persist]);

  function updateMediaIds(mediaAssetIds: string[]) {
    setContent((current) => ({
      ...current,
      mediaAssetIds,
      coverAssetId:
        current.coverAssetId && mediaAssetIds.includes(current.coverAssetId)
          ? current.coverAssetId
          : (mediaAssetIds[0] ?? null),
    }));
  }

  async function runCreateAction(action: () => Promise<void>) {
    if (creatingForm) return;
    if (dirty && !(await persist(content))) return;
    setCreatingForm(true);
    try {
      await action();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCreatingForm(false);
    }
  }

  async function createSocialPost(copySourceContent: boolean) {
    await runCreateAction(() => onCreateSocialPost(content, copySourceContent));
  }

  async function createArticle(copySourceContent: boolean) {
    await runCreateAction(() => onCreateArticle(content, mediaAssets, copySourceContent));
  }

  async function generateCover() {
    if (generatingCover) return;
    if (!defaultCoverPreset) {
      notify(zh ? '贴图封面画幅不可用' : 'Social cover canvas is unavailable');
      return;
    }
    if (dirty && !(await persist(content))) return;
    setGeneratingCover(true);
    try {
      await onGenerateCover(savedPostRef.current, content, defaultCoverPreset);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setGeneratingCover(false);
    }
  }

  return (
    <div
      data-social-post-editor
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col bg-background',
        mediaIntake.dragActive && 'ring-2 ring-inset ring-selected-border',
      )}
      onPaste={mediaIntake.pasteImages}
      onDragEnter={(event) => mediaIntake.dragMedia(event, true)}
      onDragOver={(event) => mediaIntake.dragMedia(event, true)}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) mediaIntake.dragMedia(event, false);
      }}
      onDrop={mediaIntake.dropMedia}
    >
      <SocialPostHeader
        creatingForm={creatingForm}
        generatingCover={generatingCover}
        dirty={dirty}
        handingOff={handingOff}
        handoffTargets={handoffTargets}
        onCreateArticle={(copySourceContent) => void createArticle(copySourceContent)}
        onCreateSocialPost={(copySourceContent) => void createSocialPost(copySourceContent)}
        onGenerateCover={() => void generateCover()}
        onHandoff={(target) => void handoffToBrowser(target)}
        onRetrySave={() => void persist(content)}
        saveFailed={saveFailed}
        saving={saving}
        title={content.title}
        zh={zh}
      />

      <ScrollArea type="always" className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-6 lg:px-8">
          <label className="grid gap-2">
            <span className="text-xs font-medium text-foreground-secondary">{zh ? '标题' : 'Title'}</span>
            <Input
              value={content.title}
              maxLength={200}
              onChange={(event) => setContent((current) => ({ ...current, title: event.target.value }))}
            />
          </label>

          <label className="grid gap-2">
            <span className="flex items-center justify-between gap-3 text-xs font-medium text-foreground-secondary">
              <span>{zh ? '正文' : 'Body'}</span>
              <span className="font-normal tabular-nums text-muted-foreground">{Array.from(content.body).length}</span>
            </span>
            <Textarea
              value={content.body}
              className="min-h-52 resize-y text-base leading-7"
              maxLength={100_000}
              onChange={(event) => setContent((current) => ({ ...current, body: event.target.value }))}
            />
          </label>

          <SocialPostMediaSection
            adding={mediaIntake.adding}
            assetsById={assetsById}
            content={content}
            locale={locale}
            notify={notify}
            onAdd={() => void mediaIntake.chooseMedia()}
            onChangeIds={updateMediaIds}
            onOpenRelations={(assetId) => {
              setRelationAssetId(assetId);
              setRelationsOpen(true);
            }}
            onSelectRelation={onOpenRelation}
            onSetCover={(assetId) => setContent((current) => ({ ...current, coverAssetId: assetId }))}
            relations={relations}
          />
        </div>
      </ScrollArea>
      <CreationRelationsSheet
        items={relations}
        locale={locale}
        open={relationsOpen}
        filteredAssetId={relationAssetId}
        onOpenChange={(open) => {
          setRelationsOpen(open);
          if (!open) setRelationAssetId(null);
        }}
        onSelect={onOpenRelation}
      />
    </div>
  );
}
