import {
  CreationRelationsSheet,
  type CreationRelationItem,
} from '@/renderer/components/creator/CreationRelationsSheet';
import { SocialPostHeader } from '@/renderer/components/creator/SocialPostHeader';
import { SocialPostDocumentPane } from '@/renderer/components/creator/SocialPostDocumentPane';
import { SocialPostRecoveryStatus } from '@/renderer/components/creator/SocialPostRecoveryStatus';
import { SocialPostSaveConflict } from '@/renderer/components/creator/SocialPostSaveConflict';
import { appendEditorImage } from '@/renderer/components/creator/socialPostEditorImage';
import { editableContent } from '@/renderer/components/creator/socialPostEditorTransforms';
import { useSocialPostDiagnostics } from '@/renderer/components/creator/useSocialPostDiagnostics';
import { useSocialPostSaveSession } from '@/renderer/components/creator/useSocialPostSaveSession';
import { AssetFileRevealContextProvider } from '@/renderer/components/media/AssetFileRevealContext';
import { useSocialPostPublication } from '@/renderer/features/browser-companion/useSocialPostPublication';
import { ContentInput } from '@/renderer/features/content-editor/ContentInput';
import { ContentWorkspace, ContentWorkspacePanels } from '@/renderer/features/content-editor/ContentWorkspacePanels';
import { PinContentButton } from '@/renderer/features/desktop-petals/PinContentAction';
import type { VideoDocumentWysiwygEditorHandle } from '@/renderer/features/video-documents/videoDocumentEditorTypes';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ImagesIcon } from 'lucide-react';
import { cn } from '@/renderer/lib/utils';
import { blockDocumentMarkdown } from '@/shared/block-document-codecs';
import { plainTextMarkdown } from '@/shared/content-document';
import { contentImageNumber } from '@/shared/content-image-number';
import { figureReferenceMessages } from '@/shared/i18n/figure-reference';
import type {
  AssetDto,
  BrowserCompanionTarget,
  CanvasPresetDto,
  Locale,
  SocialPostContentInput,
  SocialPostDto,
} from '@/shared/contracts';
import { blockDocumentAssetIds, type BlockDocument } from '@/shared/contracts/block-document';
import type { DesktopPetalMessages } from '@/shared/i18n/desktop-petals';
import type { SocialPostRevisionSaveInput, SocialPostRevisionSaveResult } from '@/shared/contracts/social-post';
import { socialPostMediaLimit } from '@/shared/contracts/social-post';
import { useEffect, useMemo, useRef, useState } from 'react';
interface Props {
  spaceId: string;
  post: SocialPostDto;
  locale: Locale;
  canvasPresets: CanvasPresetDto[];
  handoffTargets: readonly BrowserCompanionTarget[];
  watermarkAvailable: boolean;
  relations: readonly CreationRelationItem[];
  onSave(request: SocialPostRevisionSaveInput, spaceId?: string): Promise<SocialPostRevisionSaveResult>;
  onCreateArticle(
    content: SocialPostContentInput,
    mediaAssets: readonly AssetDto[],
    copySourceContent: boolean,
  ): Promise<void>;
  onGenerateCover(post: SocialPostDto, content: SocialPostContentInput, preset: CanvasPresetDto): Promise<void>;
  onOpenRelation(item: CreationRelationItem): void;
  notify(message: string): void;
}

import { SocialPostMediaSection, useSocialPostMediaIntake } from '@/renderer/components/creator/SocialPostEditorMedia';

function useSocialPostSaveShortcut(save: () => void) {
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== 's') return;
      event.preventDefault();
      saveRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

async function saveSocialPostWithDiagnostics(
  onSave: Props['onSave'],
  beginSave: ReturnType<typeof useSocialPostDiagnostics>['beginSave'],
  request: SocialPostRevisionSaveInput,
  savingSpaceId?: string,
) {
  const attempt = beginSave(request.content);
  try {
    const result = await onSave(request, savingSpaceId);
    if (result.status === 'ACKNOWLEDGED') attempt.success(result.post.revisionNo);
    else attempt.failure(new Error('Social post save conflict'));
    return result;
  } catch (reason) {
    attempt.failure(reason);
    throw reason;
  }
}

function withSocialPostDocument(current: SocialPostContentInput, document: BlockDocument): SocialPostContentInput {
  return {
    ...current,
    schemaVersion: 2,
    document,
    body: blockDocumentMarkdown(document),
    format: 'markdown',
    mediaAssetIds: [...new Set([...current.mediaAssetIds, ...blockDocumentAssetIds(document)])],
  };
}

function referenceSocialPostImage(
  assetId: string,
  ids: readonly string[],
  handle: VideoDocumentWysiwygEditorHandle | null,
  copy: DesktopPetalMessages['document'],
  locale: Locale,
  notify: Props['notify'],
) {
  const index = ids.indexOf(assetId);
  if (index < 0) return;
  const label = copy.imageNumber.replace('{number}', contentImageNumber(index + 1, copy.numbering));
  if (!handle?.insertFigureReference(assetId, label)) notify(figureReferenceMessages(locale).insertionFailed);
}

function useSocialPostEditorControls(session: ReturnType<typeof useSocialPostSaveSession>, notify: Props['notify']) {
  const copy = useI18n().messages.creator.socialPostEditor;
  const editorHandle = useRef<VideoDocumentWysiwygEditorHandle | null>(null);
  const inputSubscription = useRef<(() => void) | null>(null);
  useEffect(() => () => inputSubscription.current?.(), []);
  const bindInput = (handle: VideoDocumentWysiwygEditorHandle | null) => {
    inputSubscription.current?.();
    editorHandle.current = handle;
    session.setRecoverableInput(handle?.whenRecoverable ?? null);
    inputSubscription.current =
      handle?.subscribeInput(() => {
        if (handle.isInputPending()) void session.trackInput(handle.whenSettled().then(() => undefined));
      }) ?? null;
  };
  const [previewRequest, setPreviewRequest] = useState<{ assetId: string; revision: number }>();
  const [mediaOpen, setMediaOpen] = useState(true);
  const showReference = (assetId: string) => {
    setMediaOpen(true);
    setPreviewRequest((current) => ({ assetId, revision: (current?.revision ?? 0) + 1 }));
  };
  function updateMediaIds(mediaAssetIds: string[]) {
    const removed = session.content.mediaAssetIds.filter((id) => !mediaAssetIds.includes(id));
    if (removed.length && !editorHandle.current?.removeImageAssets(removed, true)) {
      notify(copy.importing);
      return false;
    }
    session.setContent((current) => ({
      ...current,
      mediaAssetIds,
      coverAssetId:
        current.coverAssetId && mediaAssetIds.includes(current.coverAssetId)
          ? current.coverAssetId
          : (mediaAssetIds[0] ?? null),
    }));
    return true;
  }
  return {
    editorHandle,
    bindInput,
    updateMediaIds,
    figure: { previewRequest, mediaOpen, setMediaOpen, showReference, handled: () => setPreviewRequest(undefined) },
  };
}

function SocialPostEditorBody({
  spaceId,
  post,
  locale,
  canvasPresets,
  handoffTargets,
  watermarkAvailable,
  relations,
  onSave,
  onCreateArticle,
  onGenerateCover,
  onOpenRelation,
  notify,
}: Props) {
  const editorCopy = useI18n().messages.contentEditor;
  const socialCopy = useI18n().messages.creator.socialPostEditor;
  const contentCopy = useI18n().messages.desktopPetals.document;
  const session = useSocialPostSaveSession({ spaceId, post, onSave: saveWithDiagnostics, notify });
  const { editorHandle, bindInput, figure, updateMediaIds } = useSocialPostEditorControls(session, notify);
  const { content, setContent, mediaAssets, setMediaAssets, savedPostRef, saving, dirty, saveFailed, persist } =
    session;
  const [creatingForm, setCreatingForm] = useState(false);
  const [generatingCover, setGeneratingCover] = useState(false);
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [relationAssetId, setRelationAssetId] = useState<string | null>(null);
  const defaultCoverPreset = canvasPresets.find((preset) => preset.stableKey === 'xiaohongshu_portrait_3_4');
  const diagnostics = useSocialPostDiagnostics({ post, content, dirty, saving, saveFailed });
  function saveWithDiagnostics(request: SocialPostRevisionSaveInput, savingSpaceId?: string) {
    return saveSocialPostWithDiagnostics(onSave, diagnostics.beginSave, request, savingSpaceId);
  }
  const assetsById = useMemo(() => new Map(mediaAssets.map((asset) => [asset.id, asset])), [mediaAssets]);
  const mediaIntake = useSocialPostMediaIntake({
    content,
    locale,
    notify,
    setContent,
    setMediaAssets,
    trackInput: session.trackInput,
  });

  const publication = useSocialPostPublication({
    content,
    dirty,
    notify,
    persist,
    postId: post.id,
    targets: handoffTargets,
    assets: mediaAssets,
    readSavedContent: () => editableContent(savedPostRef.current),
  });

  useSocialPostSaveShortcut(() => void persist(content));

  async function runCreateAction(action: () => Promise<void>) {
    if (creatingForm || !session.ready) return;
    setCreatingForm(true);
    try {
      if (!(await persist(content))) return;
      await action();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCreatingForm(false);
    }
  }

  async function createArticle(copySourceContent: boolean) {
    await runCreateAction(() =>
      onCreateArticle(
        editableContent(savedPostRef.current),
        savedPostRef.current.content.mediaAssets,
        copySourceContent,
      ),
    );
  }

  async function generateCover() {
    if (generatingCover || !session.ready) return;
    if (!defaultCoverPreset) {
      notify(socialCopy.canvasUnavailable);
      return;
    }
    setGeneratingCover(true);
    try {
      if (!(await persist(content))) return;
      await onGenerateCover(savedPostRef.current, editableContent(savedPostRef.current), defaultCoverPreset);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setGeneratingCover(false);
    }
  }

  return (
    <div
      data-social-post-editor
      ref={diagnostics.rootRef}
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col bg-background',
        mediaIntake.dragActive && 'ring-2 ring-inset ring-selected-border',
      )}
      onPaste={(event) => session.ready && mediaIntake.pasteImages(event)}
      onDragEnter={(event) => session.ready && mediaIntake.dragMedia(event, true)}
      onDragOver={(event) => session.ready && mediaIntake.dragMedia(event, true)}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) mediaIntake.dragMedia(event, false);
      }}
      onDrop={(event) => session.ready && mediaIntake.dropMedia(event)}
    >
      <SocialPostRecoveryStatus session={session} />
      <div className="contents" inert={!session.ready}>
        <SocialPostHeader
          pinAction={
            <PinContentButton
              iconOnly
              source={{ kind: 'SOCIAL_POST', id: post.id }}
              beforePin={async () => Boolean(await persist(content))}
              disabled={!session.ready}
              notify={notify}
            />
          }
          creatingForm={creatingForm}
          generatingCover={generatingCover}
          dirty={dirty}
          handingOff={publication.busy}
          handoffTargets={handoffTargets}
          watermarkAvailable={watermarkAvailable}
          onCreateArticle={(copySourceContent) => void createArticle(copySourceContent)}
          onHandoff={(target, watermark) => void publication.handoff(target, watermark)}
          onPrepareBatch={publication.prepareBatch}
          onWechatArticle={publication.prepareWechatArticle}
          onRetrySave={() => void session.retry()}
          saveFailed={saveFailed || session.recoveryStatus === 'error'}
          conflicted={Boolean(session.conflict) || session.recoveryStatus === 'conflict'}
          saving={saving}
          title={content.title}
        />

        <ContentWorkspace>
          <SocialPostDocumentPane
            title={content.title}
            onTitleChange={(title) => {
              diagnostics.noteChange();
              setContent((current) => ({ ...current, title }));
            }}
          >
            {(toolbarRoot) => (
              <>
                {session.conflict && (
                  <SocialPostSaveConflict
                    post={session.conflict}
                    disabled={saving || session.recoveryStatus === 'conflict'}
                    onResolve={session.resolveConflict}
                  />
                )}

                <ContentInput
                  contentSource={{ kind: 'SOCIAL_POST', id: post.id }}
                  markdown={content.format === 'markdown' ? content.body : plainTextMarkdown(content.body)}
                  document={content.document}
                  sessionIdentity={`${post.id}:${session.editorEpoch}`}
                  assets={mediaAssets}
                  figureAssetIds={content.mediaAssetIds}
                  onFigureReferenceClick={figure.showReference}
                  compact
                  toolbarPreset="compact"
                  toolbarRoot={toolbarRoot}
                  mediaIntake="INLINE"
                  readOnly={!session.ready}
                  onHandleChange={bindInput}
                  onChange={(body) => {
                    diagnostics.noteChange();
                    setContent((current) => ({ ...current, body, format: 'markdown' }));
                  }}
                  onDocumentChange={(document) => {
                    diagnostics.noteChange();
                    setContent((current) => withSocialPostDocument(current, document));
                  }}
                  onSave={() => void persist(content)}
                  onError={() =>
                    notify(
                      content.mediaAssetIds.length >= socialPostMediaLimit
                        ? socialCopy.imageLimit.replace('{count}', String(socialPostMediaLimit))
                        : contentCopy.failure,
                    )
                  }
                  onImageImported={(image) => appendEditorImage(image, setContent, setMediaAssets)}
                />
              </>
            )}
          </SocialPostDocumentPane>
          <ContentWorkspacePanels
            preferenceKey="social-post"
            open={figure.mediaOpen}
            onOpenChange={figure.setMediaOpen}
            tabs={[
              {
                id: 'MEDIA',
                icon: ImagesIcon,
                label: editorCopy.media,
                count: content.mediaAssetIds.length,
                content: (
                  <SocialPostMediaSection
                    adding={mediaIntake.adding}
                    assetsById={assetsById}
                    previewRequest={figure.previewRequest}
                    onPreviewRequestHandled={figure.handled}
                    onReferenceImage={(assetId) =>
                      referenceSocialPostImage(
                        assetId,
                        content.mediaAssetIds,
                        editorHandle.current,
                        contentCopy,
                        locale,
                        notify,
                      )
                    }
                    content={content}
                    generatingCover={generatingCover}
                    locale={locale}
                    notify={notify}
                    onAdd={() => void mediaIntake.chooseMedia()}
                    onChangeIds={updateMediaIds}
                    onGenerateCover={() => void generateCover()}
                    onOpenRelations={(assetId) => {
                      setRelationAssetId(assetId);
                      setRelationsOpen(true);
                    }}
                    onSelectRelation={onOpenRelation}
                    onSetCover={(assetId) => setContent((current) => ({ ...current, coverAssetId: assetId }))}
                    relations={relations}
                  />
                ),
              },
            ]}
          />
        </ContentWorkspace>
        {publication.dialog}
        <CreationRelationsSheet
          items={relations}
          open={relationsOpen}
          filteredAssetId={relationAssetId}
          onOpenChange={(open) => {
            setRelationsOpen(open);
            if (!open) setRelationAssetId(null);
          }}
          onSelect={onOpenRelation}
        />
      </div>
    </div>
  );
}

export function SocialPostEditor(props: Props) {
  return (
    <AssetFileRevealContextProvider value={{ kind: 'CONTENT', source: { kind: 'SOCIAL_POST', id: props.post.id } }}>
      <SocialPostEditorBody {...props} />
    </AssetFileRevealContextProvider>
  );
}
