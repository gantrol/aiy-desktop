import {
  CreationRelationsSheet,
  type CreationRelationItem,
} from '@/renderer/components/creator/CreationRelationsSheet';
import { SocialPostHeader } from '@/renderer/components/creator/SocialPostHeader';
import { SocialPostRecoveryStatus } from '@/renderer/components/creator/SocialPostRecoveryStatus';
import { SocialPostSaveConflict } from '@/renderer/components/creator/SocialPostSaveConflict';
import { appendEditorImage } from '@/renderer/components/creator/socialPostEditorImage';
import { useSocialPostDiagnostics } from '@/renderer/components/creator/useSocialPostDiagnostics';
import { useSocialPostSaveSession } from '@/renderer/components/creator/useSocialPostSaveSession';
import { AssetFileRevealContextProvider } from '@/renderer/components/media/AssetFileRevealContext';
import { Input } from '@/renderer/components/ui/input';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { prepareSocialPostHandoff } from '@/renderer/features/browser-companion/prepareSocialPostHandoff';
import { useBrowserCompanionHandoff } from '@/renderer/features/browser-companion/useBrowserCompanionHandoff';
import { ContentInput } from '@/renderer/features/content-editor/ContentInput';
import { ContentWorkspace, ContentWorkspacePanels } from '@/renderer/features/content-editor/ContentWorkspacePanels';
import { PinContentButton } from '@/renderer/features/desktop-petals/PinContentAction';
import type { VideoDocumentWysiwygEditorHandle } from '@/renderer/features/video-documents/videoDocumentEditorTypes';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { blockDocumentMarkdown } from '@/shared/block-document-codecs';
import { plainTextMarkdown } from '@/shared/content-document';
import type {
  AssetDto,
  BrowserCompanionTarget,
  CanvasPresetDto,
  Locale,
  SocialPostContentInput,
  SocialPostDto,
} from '@/shared/contracts';
import { blockDocumentAssetIds } from '@/shared/contracts/block-document';
import type { SocialPostRevisionSaveInput, SocialPostRevisionSaveResult } from '@/shared/contracts/social-post';
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
  const zh = locale === 'zh';
  const socialCopy = useI18n().messages.creator.socialPostEditor;
  const contentCopy = useI18n().messages.desktopPetals.document;
  const editorHandle = useRef<VideoDocumentWysiwygEditorHandle | null>(null);
  const inputSubscription = useRef<(() => void) | null>(null);
  useEffect(() => () => inputSubscription.current?.(), []);
  const session = useSocialPostSaveSession({ spaceId, post, onSave: saveWithDiagnostics, notify });
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

  const { busy: handingOff, handoff: handoffToBrowser } = useBrowserCompanionHandoff({
    notify,
    zh,
    prepare: (target) =>
      prepareSocialPostHandoff({ content, dirty, notify, persist, postId: post.id, target, copy: contentCopy }),
  });

  useSocialPostSaveShortcut(() => void persist(content));

  function updateMediaIds(mediaAssetIds: string[]) {
    editorHandle.current?.removeImageAssets(content.mediaAssetIds.filter((id) => !mediaAssetIds.includes(id)));
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
    if (creatingForm || !session.ready) return;
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

  async function createArticle(copySourceContent: boolean) {
    await runCreateAction(() => onCreateArticle(content, mediaAssets, copySourceContent));
  }

  async function generateCover() {
    if (generatingCover || !session.ready) return;
    if (!defaultCoverPreset) {
      notify(socialCopy.canvasUnavailable);
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
          handingOff={handingOff}
          handoffTargets={handoffTargets}
          watermarkAvailable={watermarkAvailable}
          onCreateArticle={(copySourceContent) => void createArticle(copySourceContent)}
          onHandoff={(target, watermark) => void handoffToBrowser(target, watermark)}
          onRetrySave={() => void session.retry()}
          saveFailed={saveFailed || session.recoveryStatus === 'error'}
          conflicted={Boolean(session.conflict) || session.recoveryStatus === 'conflict'}
          saving={saving}
          title={content.title}
          zh={zh}
        />

        <ContentWorkspace>
          <ScrollArea type="always" className="min-h-0 min-w-0 flex-1">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-6 lg:px-8">
              {session.conflict && (
                <SocialPostSaveConflict
                  post={session.conflict}
                  disabled={saving || session.recoveryStatus === 'conflict'}
                  onResolve={session.resolveConflict}
                />
              )}
              <label className="grid gap-2">
                <span className="text-xs font-medium text-foreground-secondary">{contentCopy.title}</span>
                <Input
                  aria-label={contentCopy.title}
                  placeholder={contentCopy.title}
                  value={content.title}
                  maxLength={200}
                  onChange={(event) => {
                    diagnostics.noteChange();
                    setContent((current) => ({ ...current, title: event.target.value }));
                  }}
                />
              </label>

              <ContentInput
                contentSource={{ kind: 'SOCIAL_POST', id: post.id }}
                markdown={content.format === 'markdown' ? content.body : plainTextMarkdown(content.body)}
                document={content.document}
                sessionIdentity={`${post.id}:${session.editorEpoch}`}
                assets={mediaAssets}
                compact
                mediaIntake="EXTERNAL"
                readOnly={!session.ready}
                onHandleChange={(handle) => {
                  inputSubscription.current?.();
                  editorHandle.current = handle;
                  session.setRecoverableInput(handle?.whenRecoverable ?? null);
                  inputSubscription.current =
                    handle?.subscribeInput(() => {
                      if (handle.isInputPending()) void session.trackInput(handle.whenSettled().then(() => undefined));
                    }) ?? null;
                }}
                onChange={(body) => {
                  diagnostics.noteChange();
                  setContent((current) => ({ ...current, body, format: 'markdown' }));
                }}
                onDocumentChange={(document) => {
                  diagnostics.noteChange();
                  setContent((current) => ({
                    ...current,
                    schemaVersion: 2,
                    document,
                    body: blockDocumentMarkdown(document),
                    format: 'markdown',
                    mediaAssetIds: [...new Set([...current.mediaAssetIds, ...blockDocumentAssetIds(document)])],
                  }));
                }}
                onSave={() => void persist(content)}
                onError={() => notify(contentCopy.failure)}
                onImageImported={(image) => appendEditorImage(image, setContent, setMediaAssets)}
              />
            </div>
          </ScrollArea>
          <ContentWorkspacePanels
            preferenceKey="social-post"
            tabs={[
              {
                id: 'MEDIA',
                label: editorCopy.media,
                count: content.mediaAssetIds.length,
                content: (
                  <SocialPostMediaSection
                    adding={mediaIntake.adding}
                    assetsById={assetsById}
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
