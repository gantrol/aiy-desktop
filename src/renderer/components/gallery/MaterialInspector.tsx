import type {
  MaterialAlbumMembershipApplyInput,
  MaterialAlbumMembershipApplyResult,
} from '@/shared/contracts/material-album-membership';
import type { MembershipEditorState } from '@/renderer/components/gallery/MaterialAlbumMembershipDialog';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/renderer/components/ui/collapsible';
import { CollectionDetailLayout } from '@/renderer/components/workbench/CollectionDetailLayout';
import { WorkbenchPaneToggle } from '@/renderer/components/workbench/WorkbenchPane';
import { MaterialBrowseList } from '@/renderer/components/gallery/MaterialBrowseList';
import { cn } from '@/renderer/lib/utils';
import { HeartIcon, LoaderCircleIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type {
  AssetRelationshipDto,
  ImageRatingDimension,
  ExternalMaterialMetadataDto,
  Locale,
  MaterialAlbumDto,
  AssetFileRevealContext,
} from '@/shared/contracts';
import type { HistoryNavigationGuard } from '@/renderer/components/app/app-navigation';
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
import { isVideoAsset } from '@/renderer/components/media/AssetMedia';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { StateTag } from '@/renderer/components/ui/state-tag';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { ImageEvaluationControls } from '@/renderer/components/gallery/ImageEvaluationControls';
import { MaterialAlbumMembership } from '@/renderer/components/gallery/MaterialAlbumMembership';
import {
  MaterialMetadataEditor,
  type MaterialMetadataEditorState,
} from '@/renderer/components/gallery/MaterialMetadataEditor';
import { MaterialRelationships } from '@/renderer/components/gallery/MaterialRelationships';
import {
  MaterialDetailActions,
  MaterialDetailHeader,
  MaterialDetailPreview,
} from '@/renderer/components/gallery/MaterialDetailOverview';
import { materialTitle, type MaterialLibraryItem } from '@/renderer/components/gallery/materialLibraryTypes';
import { CopyAgentLinkButton } from '@/renderer/features/content-editor/CopyAgentLinkButton';

interface Props {
  browseItems?: readonly MaterialLibraryItem[];
  onBrowseSelect?(item: MaterialLibraryItem): void;
  spaceId: string;
  item: MaterialLibraryItem;
  position: number;
  total: number;
  albums: MaterialAlbumDto[];
  ratingBusy: boolean;
  albumMembershipBusy: boolean;
  favorited: boolean;
  favoriteBusy: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  onClose(): void;
  onPrevious(): void;
  onNext(): void;
  onOpenResult(seriesId: string, assetId: string): void;
  onOpenTerm(termId: string): void;
  onCopyText(text: string): void;
  lifecycleBusy: boolean;
  onArchive(item: MaterialLibraryItem): void;
  onDelete(item: MaterialLibraryItem): void;
  onAddFavorite(): void;
  onRemoveFavorite(): void;
  onApplyAlbumMembership(input: MaterialAlbumMembershipApplyInput): Promise<MaterialAlbumMembershipApplyResult>;
  albumsLoading: boolean;
  albumsFailed: boolean;
  onRetryAlbums(): Promise<unknown>;
  onOpenAlbum(albumId: string): void;
  onScore(dimension: ImageRatingDimension, score: number | null): void;
  notify(message: string): void;
  onMetadataUpdated(metadata: ExternalMaterialMetadataDto): void;
  closeAfterRemoveFavorite: boolean;
  onHistoryNavigationGuardChange(guard: HistoryNavigationGuard | null): void;
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

export function MaterialDetailPage({
  browseItems = [],
  onBrowseSelect,
  spaceId,
  item,
  position,
  total,
  albums,
  ratingBusy,
  albumMembershipBusy,
  favorited,
  favoriteBusy,
  hasPrevious,
  hasNext,
  onClose,
  onPrevious,
  onNext,
  onOpenResult,
  onOpenTerm,
  onCopyText,
  lifecycleBusy,
  onArchive,
  onDelete,
  onAddFavorite,
  onRemoveFavorite,
  onApplyAlbumMembership,
  albumsLoading,
  albumsFailed,
  onRetryAlbums,
  onOpenAlbum,
  onScore,
  notify,
  onMetadataUpdated,
  closeAfterRemoveFavorite,
  onHistoryNavigationGuardChange,
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
  const [membershipState, setMembershipState] = useState<MembershipEditorState>({ dirty: false, saving: false });
  const dirty = metadataState.dirty || membershipState.dirty;
  const saving = metadataState.saving || membershipState.saving;
  const [discardOpen, setDiscardOpen] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const pendingExitRef = useRef<() => void>(onClose);

  useEffect(() => {
    setMetadataState({ dirty: false, saving: false, valid: true });
    setMembershipState({ dirty: false, saving: false });
    setDiscardOpen(false);
    setCopyBusy(false);
    pendingExitRef.current = onClose;
  }, [item.key]);

  useEffect(() => {
    if (!dirty && !saving) {
      onHistoryNavigationGuardChange(null);
      return;
    }
    const guard: HistoryNavigationGuard = (_direction, continueNavigation) => {
      if (saving) return true;
      pendingExitRef.current = continueNavigation;
      setDiscardOpen(true);
      return true;
    };
    onHistoryNavigationGuardChange(guard);
    return () => onHistoryNavigationGuardChange(null);
  }, [dirty, saving, onHistoryNavigationGuardChange]);

  function requestExit(action: () => void) {
    if (saving) return;
    if (dirty) {
      pendingExitRef.current = action;
      setDiscardOpen(true);
      return;
    }
    action();
  }

  async function copyImage() {
    if (item.kind !== 'IMAGE' || copyBusy) return;
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

  const body = (navigationAction: ReactNode = null, visible = true) => (
    <MaterialDetailBody
      navigationAction={navigationAction}
      visible={visible}
      spaceId={spaceId}
      key={item.key}
      item={item}
      position={position}
      total={total}
      albums={albums}
      title={title}
      locale={locale}
      ratingBusy={ratingBusy}
      albumMembershipBusy={albumMembershipBusy}
      favorited={favorited}
      favoriteBusy={favoriteBusy}
      hasPrevious={hasPrevious}
      hasNext={hasNext}
      onClose={() => requestExit(onClose)}
      onPrevious={() => requestExit(onPrevious)}
      onNext={() => requestExit(onNext)}
      onOpenResult={(seriesId, assetId) => requestExit(() => onOpenResult(seriesId, assetId))}
      onOpenTerm={(termId) => requestExit(() => onOpenTerm(termId))}
      onCopyText={onCopyText}
      lifecycleBusy={lifecycleBusy}
      onArchive={onArchive}
      onDelete={onDelete}
      onAddFavorite={onAddFavorite}
      onRemoveFavorite={() => (closeAfterRemoveFavorite ? requestExit(onRemoveFavorite) : onRemoveFavorite())}
      onApplyAlbumMembership={onApplyAlbumMembership}
      albumsLoading={albumsLoading}
      albumsFailed={albumsFailed}
      onRetryAlbums={onRetryAlbums}
      onOpenAlbum={(albumId) => requestExit(() => onOpenAlbum(albumId))}
      onMembershipStateChange={setMembershipState}
      onScore={onScore}
      notify={notify}
      onMetadataUpdated={onMetadataUpdated}
      revealContext={revealContext}
      metadataState={metadataState}
      onMetadataStateChange={setMetadataState}
      copyBusy={copyBusy}
      onCopyImage={() => void copyImage()}
      onRequestExit={requestExit}
    />
  );

  return (
    <>
      {browseItems.length && onBrowseSelect ? (
        <CollectionDetailLayout
          layoutKey="gallery-detail"
          collectionLabel={messages.workbench.browseResults}
          collectionWidth={240}
          minimumDetailWidth={540}
          selectionKey={item.key}
          collection={({ toggle, revealDetail }) => (
            <MaterialBrowseList
              items={browseItems}
              selectedKey={item.key}
              toggle={toggle}
              onSelect={(next) => {
                if (next.key === item.key) {
                  revealDetail();
                  return;
                }
                requestExit(() => {
                  onBrowseSelect(next);
                  revealDetail();
                });
              }}
            />
          )}
        >
          {({ toggle, visible }) => body(toggle, visible)}
        </CollectionDetailLayout>
      ) : (
        body()
      )}
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
    </>
  );
}

interface MaterialDetailBodyProps extends Omit<
  Props,
  'item' | 'closeAfterRemoveFavorite' | 'onHistoryNavigationGuardChange'
> {
  item: MaterialLibraryItem;
  title: string;
  locale: Locale;
  navigationAction: ReactNode;
  visible: boolean;
  onMembershipStateChange(state: MembershipEditorState): void;
  metadataState: MaterialMetadataEditorState;
  onMetadataStateChange(state: MaterialMetadataEditorState): void;
  copyBusy: boolean;
  onCopyImage(): void;
  onRequestExit(action: () => void): void;
}

function MaterialDetailBody({
  navigationAction,
  visible,
  spaceId,
  item,
  position,
  total,
  albums,
  title,
  locale,
  ratingBusy,
  albumMembershipBusy,
  favorited,
  favoriteBusy,
  hasPrevious,
  hasNext,
  onClose,
  onPrevious,
  onNext,
  onOpenResult,
  onOpenTerm,
  onCopyText,
  lifecycleBusy,
  onArchive,
  onDelete,
  onAddFavorite,
  onRemoveFavorite,
  onApplyAlbumMembership,
  albumsLoading,
  albumsFailed,
  onRetryAlbums,
  onOpenAlbum,
  onScore,
  notify,
  onMetadataUpdated,
  revealContext,
  metadataState,
  onMetadataStateChange,
  onMembershipStateChange,
  copyBusy,
  onCopyImage,
  onRequestExit,
}: MaterialDetailBodyProps) {
  const { messages } = useI18n();
  const l = messages.gallery.inspector;
  const image = item.kind !== 'TEXT' ? item.image : null;
  const video = isVideoAsset(image?.asset);
  const [propertiesOpen, setPropertiesOpen] = useState(true);
  const [activeTab, setActiveTab] = useState('details');
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
    if (!visible || !propertiesOpen || activeTab !== 'relationships') return;
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
      .assetRelationshipGet(image.asset.id, locale)
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
  }, [visible, propertiesOpen, activeTab, image?.asset.id, locale, relationshipRefresh]);

  return (
    <article
      className="@container/material-detail flex size-full min-h-0 min-w-0 flex-col bg-background"
      data-slot="material-detail-page"
    >
      <MaterialDetailHeader
        navigationAction={navigationAction}
        propertiesAction={
          <WorkbenchPaneToggle
            floating={false}
            side="right"
            expanded={propertiesOpen}
            label={messages.workbench.properties}
            onClick={() => setPropertiesOpen((open) => !open)}
          />
        }
        agentLinkAction={
          (item.kind === 'TEXT' || item.image.materialId) && (
            <CopyAgentLinkButton
              target={{
                spaceId,
                target: 'material',
                entityId: item.kind === 'TEXT' ? item.text.id : item.image.materialId!,
              }}
              disabled={metadataState.dirty || metadataState.saving || lifecycleBusy}
              notify={notify}
            />
          )
        }
        title={title}
        position={position}
        total={total}
        hasPrevious={hasPrevious}
        hasNext={hasNext}
        copyBusy={copyBusy}
        canCopy={Boolean(image && !video)}
        onClose={onClose}
        onPrevious={onPrevious}
        onNext={onNext}
        onCopyImage={onCopyImage}
      />

      <div
        className={cn(
          'grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden',
          propertiesOpen
            ? 'grid-rows-[minmax(12rem,1fr)_minmax(0,1fr)] @min-[900px]/material-detail:grid-cols-[minmax(0,1fr)_minmax(20rem,36%)] @min-[900px]/material-detail:grid-rows-1'
            : 'grid-rows-1',
        )}
      >
        <MaterialDetailPreview
          item={item}
          title={title}
          video={video}
          notify={notify}
          revealContext={revealContext}
          lifecycleBusy={lifecycleBusy}
          onArchive={() => onRequestExit(() => onArchive(item))}
          onDelete={() => onRequestExit(() => onDelete(item))}
        />

        <aside
          hidden={!propertiesOpen}
          inert={!propertiesOpen}
          className={cn(
            'min-h-0 min-w-0 flex-col border-t bg-background @min-[900px]/material-detail:border-t-0 @min-[900px]/material-detail:border-l',
            propertiesOpen ? 'flex' : 'hidden',
          )}
        >
          <ScrollArea
            viewportRef={viewportRef}
            className="min-h-0 min-w-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full"
          >
            <div className="w-full min-w-0 space-y-5 p-5">
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
                      {role === 'OUTPUT' ? l.roleOutput : role === 'SOURCE' ? l.roleSource : l.roleInput}
                    </Badge>
                  ))}
                </div>
                <h2 className="break-words text-base font-semibold leading-6">{title}</h2>
                <MetaText as="p">{formatDate(item.createdAt, locale)}</MetaText>
              </div>

              <MaterialDetailActions
                item={item}
                video={video}
                favorited={favorited}
                favoriteBusy={favoriteBusy}
                onCopyText={onCopyText}
                onAddFavorite={onAddFavorite}
                onRemoveFavorite={onRemoveFavorite}
                onOpenResult={onOpenResult}
                onOpenTerm={onOpenTerm}
                onRequestExit={onRequestExit}
                lifecycleBusy={lifecycleBusy}
                onArchive={onArchive}
                onDelete={onDelete}
                notify={notify}
                revealContext={revealContext}
              />

              <MaterialAlbumMembership
                albums={albums}
                target={
                  item.kind === 'TEXT'
                    ? { kind: 'MATERIAL', materialId: item.text.id }
                    : item.image.materialId
                      ? { kind: 'MATERIAL', materialId: item.image.materialId }
                      : { kind: 'IMAGE_ASSET', imageAssetId: item.image.asset.id }
                }
                loading={albumsLoading}
                failed={albumsFailed}
                disabled={albumMembershipBusy || metadataState.saving}
                onOpenAlbum={onOpenAlbum}
                onRetry={onRetryAlbums}
                onStateChange={onMembershipStateChange}
                onApply={(edit) =>
                  onApplyAlbumMembership({
                    ...edit,
                    spaceId,
                    locale,
                    target:
                      item.kind === 'TEXT'
                        ? { kind: 'MATERIAL', materialId: item.text.id }
                        : item.image.materialId
                          ? { kind: 'MATERIAL', materialId: item.image.materialId }
                          : { kind: 'IMAGE_ASSET', imageAssetId: item.image.asset.id },
                  })
                }
              />

              <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0 gap-4">
                <TabsList className="grid grid-cols-2">
                  <TabsTrigger value="details" data-action="material-inspector-details">
                    {l.details}
                  </TabsTrigger>
                  <TabsTrigger value="relationships" data-action="material-inspector-relationships">
                    {l.relationships}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="relationships" className="min-w-0 space-y-4">
                  {image && relationshipLoading && (
                    <div className="grid h-10 place-items-center" aria-live="polite">
                      <LoaderCircleIcon className="size-4 animate-spin" aria-label={l.loading} />
                    </div>
                  )}
                  {image && relationshipFailed && (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => setRelationshipRefresh((value) => value + 1)}
                    >
                      {l.retry}
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
                </TabsContent>

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
                  {image && !video && (
                    <Collapsible className="mb-4">
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm">
                          {l.ratingTitle}
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <ImageEvaluationControls
                          ratings={image.ratings}
                          visibleDimensions={['AESTHETIC', 'REALISM']}
                          disabled={ratingBusy}
                          onChange={onScore}
                        />
                      </CollapsibleContent>
                    </Collapsible>
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
                        <MetaText as="dt">{l.assetId}</MetaText>
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
                {messages.gallery.membership.saveMetadata}
              </Button>
            </div>
          )}
        </aside>
      </div>
    </article>
  );
}
