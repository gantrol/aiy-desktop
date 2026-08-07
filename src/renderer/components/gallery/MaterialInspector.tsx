import {
  BookOpenIcon,
  CopyIcon,
  ExternalLinkIcon,
  HeartIcon,
  HeartOffIcon,
  LoaderCircleIcon,
  SquarePenIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type {
  AssetRelationshipDto,
  ImageRatingDimension,
  ExternalMaterialMetadataDto,
  Locale,
  MaterialAlbumDto,
  MaterialAlbumMemberDto,
  AssetFileRevealContext,
} from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { formatDateTime } from '@/renderer/lib/dateFormat';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { MetaText } from '@/renderer/components/ui/meta-text';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { AssetMedia, isVideoAsset } from '@/renderer/components/media/AssetMedia';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/renderer/components/ui/sheet';
import { StateTag } from '@/renderer/components/ui/state-tag';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { ImageEvaluationControls } from '@/renderer/components/gallery/ImageEvaluationControls';
import { MaterialAlbumMembership } from '@/renderer/components/gallery/MaterialAlbumMembership';
import {
  MaterialMetadataEditor,
  type MaterialMetadataEditorState,
} from '@/renderer/components/gallery/MaterialMetadataEditor';
import { MaterialRelationships } from '@/renderer/components/gallery/MaterialRelationships';
import { materialTitle, type MaterialLibraryItem } from '@/renderer/components/gallery/materialLibraryTypes';

interface Props {
  item: MaterialLibraryItem;
  albums: MaterialAlbumDto[];
  ratingBusy: boolean;
  albumMembershipBusy: boolean;
  favorited: boolean;
  favoriteBusy: boolean;
  onClose(): void;
  onOpenResult(seriesId: string, assetId: string): void;
  onOpenTerm(termId: string): void;
  onCopyText(text: string): void;
  onAddFavorite(): void;
  onRemoveFavorite(): void;
  onToggleAlbumMembership(
    album: MaterialAlbumDto,
    member: MaterialAlbumMemberDto | null,
    checked: boolean,
  ): Promise<void>;
  onScore(dimension: ImageRatingDimension, score: number | null): void;
  notify(message: string): void;
  onMetadataUpdated(metadata: ExternalMaterialMetadataDto): void;
  revealContext?: AssetFileRevealContext;
}

const inspectorDateOptions: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

function formatDate(value: string, locale: Locale) {
  return formatDateTime(value, locale, inspectorDateOptions) || value;
}

function formatBytes(value: number | undefined) {
  if (value == null) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function MaterialInspector({
  item,
  albums,
  ratingBusy,
  albumMembershipBusy,
  favorited,
  favoriteBusy,
  onClose,
  onOpenResult,
  onOpenTerm,
  onCopyText,
  onAddFavorite,
  onRemoveFavorite,
  onToggleAlbumMembership,
  onScore,
  notify,
  onMetadataUpdated,
  revealContext,
}: Props) {
  const { locale, messages } = useI18n();
  const l = messages.gallery.inspector;
  const fileLabels = messages.assetFile;
  const fallbackTitle =
    item.kind === 'TEXT' ? l.textMaterial : item.image.asset.kind === 'GENERATED' ? l.generated : l.reference;
  const title = materialTitle(item, fallbackTitle);
  const [metadataState, setMetadataState] = useState<MaterialMetadataEditorState>({
    dirty: false,
    saving: false,
    valid: true,
  });
  const [discardOpen, setDiscardOpen] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const pendingExitRef = useRef<() => void>(onClose);

  useEffect(() => {
    setMetadataState({ dirty: false, saving: false, valid: true });
    setDiscardOpen(false);
    setCopyBusy(false);
    pendingExitRef.current = onClose;
  }, [item.key]);

  function requestExit(action: () => void) {
    if (metadataState.saving) return;
    if (metadataState.dirty) {
      pendingExitRef.current = action;
      setDiscardOpen(true);
      return;
    }
    action();
  }

  async function copyImage() {
    if (item.kind !== 'IMAGE' || isVideoAsset(item.image.asset) || copyBusy) return;
    setCopyBusy(true);
    notify(fileLabels.copying);
    try {
      await window.desktopApi.assetFileCopy(item.image.asset.id);
      notify(fileLabels.copied);
    } catch (reason) {
      notify(`${fileLabels.failed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setCopyBusy(false);
    }
  }

  function continueEditing() {
    pendingExitRef.current = onClose;
    setDiscardOpen(false);
  }

  function discardAndExit() {
    setDiscardOpen(false);
    pendingExitRef.current();
  }

  const body = (
    <InspectorBody
      key={item.key}
      item={item}
      albums={albums}
      title={title}
      locale={locale}
      ratingBusy={ratingBusy}
      albumMembershipBusy={albumMembershipBusy}
      favorited={favorited}
      favoriteBusy={favoriteBusy}
      onClose={() => requestExit(onClose)}
      onOpenResult={(seriesId, assetId) => requestExit(() => onOpenResult(seriesId, assetId))}
      onOpenTerm={(termId) => requestExit(() => onOpenTerm(termId))}
      onCopyText={onCopyText}
      onAddFavorite={onAddFavorite}
      onRemoveFavorite={() =>
        requestExit(() => {
          onClose();
          onRemoveFavorite();
        })
      }
      onToggleAlbumMembership={onToggleAlbumMembership}
      onScore={onScore}
      notify={notify}
      onMetadataUpdated={onMetadataUpdated}
      revealContext={revealContext}
      metadataState={metadataState}
      onMetadataStateChange={setMetadataState}
      copyBusy={copyBusy}
      onCopyImage={() => void copyImage()}
    />
  );

  return (
    <Sheet open onOpenChange={(open) => !open && requestExit(onClose)}>
      <SheetContent side="right" showCloseButton={false} className="gap-0 p-0" data-slot="material-inspector">
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">{l.dialogDescription}</SheetDescription>
        {body}
        <Dialog open={discardOpen} onOpenChange={(open) => (open ? setDiscardOpen(true) : continueEditing())}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{l.discardTitle}</DialogTitle>
              <DialogDescription>{l.discardDescription}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={continueEditing}>
                {l.continueEditing}
              </Button>
              <Button type="button" variant="destructive" onClick={discardAndExit}>
                {l.discardChanges}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}

interface InspectorBodyProps extends Omit<Props, 'item'> {
  item: MaterialLibraryItem;
  title: string;
  locale: Locale;
  metadataState: MaterialMetadataEditorState;
  onMetadataStateChange(state: MaterialMetadataEditorState): void;
  copyBusy: boolean;
  onCopyImage(): void;
}

function InspectorBody({
  item,
  albums,
  title,
  locale,
  ratingBusy,
  albumMembershipBusy,
  favorited,
  favoriteBusy,
  onClose,
  onOpenResult,
  onOpenTerm,
  onCopyText,
  onAddFavorite,
  onRemoveFavorite,
  onToggleAlbumMembership,
  onScore,
  notify,
  onMetadataUpdated,
  revealContext,
  metadataState,
  onMetadataStateChange,
  copyBusy,
  onCopyImage,
}: InspectorBodyProps) {
  const { messages } = useI18n();
  const l = messages.gallery.inspector;
  const fileLabels = messages.assetFile;
  const image = item.kind === 'IMAGE' ? item.image : null;
  const video = isVideoAsset(image?.asset);
  const [activeTab, setActiveTab] = useState(
    image?.metadata?.provenanceConfidence === 'UNKNOWN' ? 'details' : 'relationships',
  );
  const [relationships, setRelationships] = useState<AssetRelationshipDto | null>(null);
  const [relationshipLoading, setRelationshipLoading] = useState(Boolean(image));
  const [relationshipFailed, setRelationshipFailed] = useState(false);
  const [relationshipRefresh, setRelationshipRefresh] = useState(0);
  const metadataFormId = useId();
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 });
  }, [item.key]);

  useEffect(() => {
    if (!image) {
      setRelationships(null);
      setRelationshipLoading(false);
      setRelationshipFailed(false);
      return;
    }
    let current = true;
    setRelationships(null);
    setRelationshipLoading(true);
    setRelationshipFailed(false);
    void window.desktopApi
      .assetRelationshipGet(image.asset.id)
      .then((result) => {
        if (!current) return;
        setRelationships(result);
        setRelationshipLoading(false);
      })
      .catch(() => {
        if (!current) return;
        setRelationshipLoading(false);
        setRelationshipFailed(true);
      });
    return () => {
      current = false;
    };
  }, [image?.asset.id, relationshipRefresh]);
  const favoriteButton = (image || favorited) && (
    <Button
      type="button"
      data-action="material-favorite-toggle"
      variant="outline"
      className="w-full"
      disabled={favoriteBusy}
      aria-busy={favoriteBusy}
      aria-pressed={favorited}
      onClick={favorited ? onRemoveFavorite : onAddFavorite}
    >
      {favoriteBusy ? (
        <LoaderCircleIcon className="size-4 animate-spin" />
      ) : favorited ? (
        <HeartOffIcon className="size-4" />
      ) : (
        <HeartIcon className="size-4" />
      )}
      {favorited ? l.unfavorite : l.favorite}
    </Button>
  );

  return (
    <div className="flex size-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <strong className="min-w-0 flex-1 truncate text-sm">{l.title}</strong>
        {item.kind === 'IMAGE' && !video && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            data-action="asset-file-copy"
            aria-label={fileLabels.copy}
            aria-busy={copyBusy ? 'true' : 'false'}
            disabled={copyBusy}
            onClick={onCopyImage}
          >
            {copyBusy ? <LoaderCircleIcon className="size-4 animate-spin" /> : <CopyIcon className="size-4" />}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          data-action="material-inspector-close"
          aria-label={l.close}
          onClick={onClose}
        >
          <XIcon className="size-4" />
        </Button>
      </div>
      <ScrollArea
        viewportRef={viewportRef}
        className="min-h-0 min-w-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full"
      >
        <div className="w-full min-w-0 space-y-5 p-4">
          {item.kind === 'IMAGE' ? (
            <AssetFileContextMenu
              assetId={item.image.asset.id}
              notify={notify}
              revealContext={revealContext}
              copyable={!video}
              usableInCreation={!video}
            >
              <div className="grid max-h-80 min-h-48 place-items-center overflow-hidden rounded-lg border bg-media-surround">
                <AssetMedia
                  asset={item.image.asset}
                  className="max-h-80 size-full object-contain"
                  alt=""
                  draggable={false}
                  controls={video}
                  preload={video ? 'auto' : 'metadata'}
                />
              </div>
            </AssetFileContextMenu>
          ) : (
            <div className="rounded-lg border bg-background p-4">
              <p className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-sm leading-6">
                {item.text.text}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {item.kind === 'TEXT' && <Badge variant="secondary">{l.text}</Badge>}
              {favorited && (
                <StateTag
                  tone="neutral"
                  className="bg-selected text-relation-favorited"
                  icon={<HeartIcon className="fill-current" />}
                >
                  {l.favorite}
                </StateTag>
              )}
              {image?.creation?.roles.map((role) => (
                <Badge key={role} variant="secondary">
                  {role === 'OUTPUT'
                    ? locale === 'zh'
                      ? '产出'
                      : 'Output'
                    : role === 'SOURCE'
                      ? locale === 'zh'
                        ? '源图'
                        : 'Source'
                      : locale === 'zh'
                        ? '输入'
                        : 'Input'}
                </Badge>
              ))}
            </div>
            <h2 className="break-words text-base font-semibold leading-6">{title}</h2>
            <MetaText as="p">{formatDate(item.createdAt, locale)}</MetaText>
          </div>

          {item.kind === 'TEXT' ? (
            <div className="grid gap-2">
              <Button type="button" className="w-full" onClick={() => onCopyText(item.text.text)}>
                <CopyIcon className="size-4" />
                {l.copyText}
              </Button>
              {favoriteButton}
            </div>
          ) : (
            <div className="grid gap-2">
              {image?.creation && (
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => onOpenResult(image.creation!.seriesId, image.asset.id)}
                >
                  <SquarePenIcon className="size-4" />
                  {l.openCreation}
                  <ExternalLinkIcon className="ml-auto size-3.5 opacity-60" />
                </Button>
              )}
              {!image?.creation && image?.dictionary && (
                <Button type="button" className="w-full" onClick={() => onOpenTerm(image.dictionary!.termId)}>
                  <BookOpenIcon className="size-4" />
                  {l.openDictionary}
                  <ExternalLinkIcon className="ml-auto size-3.5 opacity-60" />
                </Button>
              )}
              {favoriteButton}
            </div>
          )}

          <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0 gap-4">
            <TabsList className={image ? 'grid grid-cols-3' : 'grid grid-cols-2'}>
              <TabsTrigger value="relationships" data-action="material-inspector-relationships">
                {l.relationships}
              </TabsTrigger>
              {image && (
                <TabsTrigger value="rating" data-action="material-inspector-rating">
                  {l.ratingTitle}
                </TabsTrigger>
              )}
              <TabsTrigger value="details" data-action="material-inspector-details">
                {l.details}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="relationships" className="min-w-0 space-y-4">
              {image && relationshipLoading && (
                <div className="grid h-10 place-items-center" aria-live="polite">
                  <LoaderCircleIcon
                    className="size-4 animate-spin"
                    aria-label={locale === 'zh' ? '正在加载' : 'Loading'}
                  />
                </div>
              )}
              {image && relationshipFailed && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => setRelationshipRefresh((value) => value + 1)}
                >
                  {locale === 'zh' ? '重试' : 'Retry'}
                </Button>
              )}
              {image && relationships && (
                <MaterialRelationships
                  relationships={relationships}
                  assetId={image.asset.id}
                  locale={locale}
                  onOpenResult={onOpenResult}
                  onOpenTerm={onOpenTerm}
                />
              )}
              <MaterialAlbumMembership
                albums={albums}
                target={
                  item.kind === 'TEXT'
                    ? { materialId: item.text.id }
                    : { materialId: item.image.materialId, imageAssetId: item.image.asset.id }
                }
                labels={{
                  title: messages.gallery.albums.membershipTitle,
                  operationFailed: messages.gallery.albums.operationFailed,
                }}
                disabled={albumMembershipBusy}
                onToggle={onToggleAlbumMembership}
              />
            </TabsContent>

            {image && (
              <TabsContent value="rating">
                <ImageEvaluationControls
                  ratings={image.ratings}
                  visibleDimensions={['AESTHETIC', 'REALISM']}
                  disabled={ratingBusy}
                  onChange={onScore}
                />
              </TabsContent>
            )}

            {/*
              Radix passes `hidden={!present}`, and `present` is always true under
              forceMount, so the panel stays mounted *and* visible. The editor must
              stay mounted to keep unsaved edits across tab switches, so hide it here.
            */}
            <TabsContent value="details" forceMount className={activeTab === 'details' ? undefined : 'hidden'}>
              {image?.metadata && (
                <div className="mb-5 border-b pb-5">
                  <MaterialMetadataEditor
                    metadata={image.metadata}
                    formId={metadataFormId}
                    notify={notify}
                    onStateChange={onMetadataStateChange}
                    onUpdated={onMetadataUpdated}
                  />
                </div>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                {image?.metadata?.originalName && (
                  <>
                    <MetaText as="dt">{messages.creator.generationRecord.originalName}</MetaText>
                    <MetaText as="dd" className="truncate text-right" title={image.metadata.originalName}>
                      {image.metadata.originalName}
                    </MetaText>
                  </>
                )}
                <MetaText as="dt">{l.added}</MetaText>
                <MetaText as="dd" className="text-right">
                  {formatDate(item.createdAt, locale)}
                </MetaText>
                {image && (
                  <>
                    <MetaText as="dt">{l.dimensions}</MetaText>
                    <MetaText as="dd" mono className="text-right">
                      {image.asset.width} × {image.asset.height}
                    </MetaText>
                    <MetaText as="dt">{l.format}</MetaText>
                    <MetaText as="dd" className="truncate text-right">
                      {image.asset.mimeType}
                    </MetaText>
                    <MetaText as="dt">{l.fileSize}</MetaText>
                    <MetaText as="dd" mono className="text-right">
                      {formatBytes(image.asset.byteSize)}
                    </MetaText>
                    <MetaText as="dt">{l.origin}</MetaText>
                    <MetaText as="dd" className="truncate text-right">
                      {image.asset.originType || '—'}
                    </MetaText>
                    <MetaText as="dt">ID</MetaText>
                    <MetaText as="dd" mono className="truncate text-right" title={image.asset.id}>
                      {image.asset.id}
                    </MetaText>
                  </>
                )}
              </dl>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
      {image?.metadata && (activeTab === 'details' || metadataState.dirty || metadataState.saving) && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-overlay px-4 py-3">
          <span
            data-slot="material-metadata-status"
            data-state={metadataState.saving ? 'saving' : metadataState.dirty ? 'dirty' : 'saved'}
            className="min-w-0 truncate text-xs text-muted-foreground"
            aria-live="polite"
          >
            {metadataState.saving ? l.saving : metadataState.dirty ? l.unsavedChanges : l.changesSaved}
          </span>
          <Button
            type="submit"
            form={metadataFormId}
            data-action="material-metadata-save"
            aria-busy={metadataState.saving}
            disabled={metadataState.saving || !metadataState.dirty || !metadataState.valid}
          >
            {metadataState.saving && <LoaderCircleIcon className="size-4 animate-spin" />}
            {messages.creator.generationRecord.save}
          </Button>
        </div>
      )}
    </div>
  );
}
