import { CanvasPresetPicker } from '@/renderer/components/creator/CanvasPresetPicker';
import { CreationMaterialPicker } from '@/renderer/components/creator/CreationMaterialPicker';
import { CreationReferenceStrip } from '@/renderer/components/creator/CreationReferenceStrip';
import { CreationVideoAttachments } from '@/renderer/components/creator/CreationVideoAttachments';
import { DerivedVisualSourceContext } from '@/renderer/components/creator/DerivedVisualSourceContext';
import { DictionaryPicker } from '@/renderer/components/creator/DictionaryPicker';
import { GenerationTaskTray } from '@/renderer/components/creator/GenerationTaskTray';
import { PasteDropSurface } from '@/renderer/components/creator/intake/PasteDropSurface';
import { MinimalCreationStarter } from '@/renderer/components/creator/MinimalCreationStarter';
import { CreatorInputHeader } from '@/renderer/components/creator/screen/CreatorInputHeader';
import type { CreatorScreenViewModel } from '@/renderer/components/creator/screen/creatorScreenViewModel';
import { StyleExplorationPanel } from '@/renderer/components/creator/StyleExplorationPanel';
import { useCreatorVideoImport } from '@/renderer/components/creator/workflows/useCreatorVideoImport';
import { AssetBreakdownSourceFormProvider } from '@/renderer/components/media/AssetMenuActionsProvider';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { PinNoteButton } from '@/renderer/features/desktop-petals/PinNoteButton';
import { VideoDocumentCreationStarter } from '@/renderer/features/video-documents/VideoDocumentCreationStarter';
import { VideoFileInput } from '@/renderer/features/video-documents/VideoDocumentFileInputs';
import { useI18n } from '@/renderer/i18n/useI18n';
import { DictionaryIcon, ImageIcon } from '@/renderer/icons';
import { cn } from '@/renderer/lib/utils';
import type { AssetDto } from '@/shared/contracts';
import { FileTextIcon, VideoIcon } from 'lucide-react';
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';

interface Props {
  model: CreatorScreenViewModel;
  sourceFormId: string | null;
}

interface Accessories {
  canvas: ReactNode;
  dictionary: ReactNode;
  dictionarySidebar: ReactNode;
  experiments: ReactNode;
  material: ReactNode;
  references: ReactNode;
  sourceContext: ReactNode;
  video: ReactNode;
}

function useCreatorInputAccessories(
  model: CreatorScreenViewModel,
  videos: ReturnType<typeof useCreatorVideoImport>,
): Accessories {
  const { app, generation, navigation, projection, prompt, selection, workbench, workflow } = model;
  const { messages } = useI18n();
  const c = messages.creator.workbench;
  const document = generation.promptDocument;
  const dictionary = generation.dictionaryMaterials;
  const assistant = workflow.assistant.workflows;
  const relevantExplorations = app.data.styleExplorationBatches
    .filter((batch) => {
      if (selection.creationMode === 'existing' && selection.seriesId) {
        return (
          (batch.scope.kind === 'SERIES' && batch.scope.id === selection.seriesId) ||
          batch.slots.some((slot) => slot.seriesId === selection.seriesId)
        );
      }
      return (
        selection.creationMode === 'new' &&
        selection.creationDraftSession.draftId &&
        batch.scope.kind === 'DRAFT' &&
        batch.scope.id === selection.creationDraftSession.draftId
      );
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    .slice(0, 6);
  const dictionaryProps: Omit<ComponentProps<typeof DictionaryPicker>, 'layout' | 'onClose'> = {
    locale: app.locale,
    query: prompt.dictionaryCatalog.query,
    terms: prompt.dictionaryCatalog.results,
    facets: app.data.facets,
    palettes: prompt.dictionaryCatalog.scopedWordPalettes,
    selectedTerms: document.selectedTerms,
    focusTarget: dictionary.dictionaryFocusTarget,
    scopeMode: prompt.dictionaryCatalog.dictionaryScope.mode,
    albumScopeAvailable: Boolean(selection.targetAlbum?.creationDefaults?.dictionaryScope.mode === 'SELECTED'),
    draggableMaterials: true,
    recommendationRuns: assistant.historicalTerms.runs,
    recommendationSelectedTermIds: generation.promptResolution.effectiveTerms.map((item) => item.term.id),
    recommendationBusy: assistant.historicalTerms.busy,
    recommendationAvailable: Boolean(document.manualPrompt.trim() || generation.promptResolution.effectiveTerms.length),
    onRecommendFromHistory: assistant.historicalTerms.recommend,
    onAddRecommendation: dictionary.addHistoricalTerm,
    onScopeModeChange: (mode) => prompt.dictionaryCatalog.setDictionaryScope((current) => ({ ...current, mode })),
    onQueryChange: prompt.dictionaryCatalog.setQuery,
    onToggle: dictionary.toggleTerm,
    onClear: dictionary.clearMaterials,
    onPaletteApply: (palette) => dictionary.requestPalette(palette),
    onPaletteView: (palette) => dictionary.setPaletteInspector({ mode: 'view', palette }),
    onPaletteCreated: dictionary.paletteSaved,
    notify: app.notify,
  };
  const openSource = () => {
    if (selection.contentSelection.selectedSocialPost) {
      void navigation.content.chooseSocialPost(selection.contentSelection.selectedSocialPost.id, 'replace');
    } else if (selection.contentSelection.selectedArticle) {
      void navigation.content.chooseArticle(selection.contentSelection.selectedArticle.id, 'replace');
    }
  };

  return {
    canvas: (
      <CanvasPresetPicker
        locale={app.locale}
        presets={workbench.editorDerivedVisualCanvasPresets}
        value={generation.canvasPreset}
        compact
        toolbar
        allowUnspecified={!workbench.editorDerivedVisual}
        onChange={(preset) => {
          if (workbench.editorDerivedVisual && preset) navigation.derivedVisual.changeCanvas(preset);
          else generation.setCanvasPresetKey(preset?.stableKey ?? '');
        }}
      />
    ),
    dictionary: (
      <Popover open={dictionary.dictionaryOpen} onOpenChange={dictionary.changeDictionaryOpen}>
        <PopoverTrigger asChild>
          <Button
            data-action="dictionary-picker"
            variant={dictionary.dictionaryOpen || projection.dictionarySelectionCount > 0 ? 'secondary' : 'outline'}
            size="icon"
            className="rounded-full shadow-none"
            title={c.dictionary}
            aria-label={c.dictionary}
          >
            <DictionaryIcon className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={8}
          className="w-[760px] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
          onFocusOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (dictionary.paletteToApply || dictionary.paletteInspector) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <DictionaryPicker {...dictionaryProps} onClose={dictionary.closeDictionary} />
        </PopoverContent>
      </Popover>
    ),
    dictionarySidebar: <DictionaryPicker {...dictionaryProps} layout="sidebar" />,
    experiments: (
      <StyleExplorationPanel
        className="mt-4"
        batches={relevantExplorations}
        series={app.data.series}
        stoppingBatchIds={assistant.direction.stoppingBatchIds}
        retryingSlotIds={assistant.direction.retryingSlotIds}
        proposingAdjacentSlotIds={assistant.direction.proposingAdjacentSlotIds}
        onStop={assistant.direction.stop}
        onRetrySlot={(_batchId, slotId) => assistant.direction.retrySlot(slotId)}
        onProposeAdjacent={assistant.direction.proposeAdjacent}
        onContinueDirection={navigation.output.continueDirection}
        onOpenAsset={navigation.output.openExplorationAsset}
        notify={app.notify}
      />
    ),
    material: (
      <CreationMaterialPicker
        libraryKey={app.data.spaceName}
        dataRevision={app.dataRevision}
        terms={app.data.terms}
        facets={app.data.facets}
        selectedAssets={document.referenceAssets}
        disabled={generation.referenceImport.referenceImporting}
        onBeforeOpen={app.onTermDetailsRequest}
        onApply={generation.referenceImport.applyReferenceAssets}
        onImport={generation.referenceImport.attachReferences}
      />
    ),
    references: (
      <CreationReferenceStrip
        assets={document.referenceAssets}
        imageImporting={generation.referenceImport.referenceImporting}
        promptResolution={generation.promptResolution}
        hidePromptMaterials
        removeLabel={c.delete}
        onAssetsChange={generation.referenceImport.applyReferenceAssets}
        onOpenPalette={dictionary.openPalette}
        onOpenTerm={dictionary.openTerm}
        onRemoveAsset={generation.referenceImport.removeReferenceAsset}
        onRemovePalette={dictionary.removePalette}
        onRemoveTerm={dictionary.toggleTerm}
        notify={app.notify}
        revealContext={workbench.series ? { kind: 'CREATION', seriesId: workbench.series.id } : undefined}
      />
    ),
    sourceContext: workbench.editorDerivedVisual ? (
      <DerivedVisualSourceContext
        sourceTitle={workbench.editorDerivedVisualSourceTitle}
        assets={workbench.editorDerivedVisualSourceAssets}
        referenceAssetIds={document.referenceAssets.map((asset) => asset.id)}
        onOpenSource={openSource}
        onToggleReference={(asset) => toggleReferenceAsset(model, asset, messages.contentEditor.referenceLimit)}
      />
    ) : null,
    video: (
      <>
        <VideoFileInput
          inputRef={prompt.newCreationVideoInputRef}
          onSelectFiles={(files) => void videos.importFiles(files, 'UPLOAD')}
        />
        <Button
          data-action="creation-video-picker"
          type="button"
          variant="outline"
          size="icon"
          className="rounded-full"
          title={messages.contentEditor.addVideos}
          aria-label={messages.contentEditor.addVideos}
          disabled={videos.importing}
          onClick={() => prompt.newCreationVideoInputRef.current?.click()}
        >
          <VideoIcon className="size-4" />
        </Button>
      </>
    ),
  };
}

function toggleReferenceAsset(model: CreatorScreenViewModel, asset: AssetDto, limitMessage: string) {
  const references = model.generation.promptDocument.referenceAssets;
  if (references.some((reference) => reference.id === asset.id)) {
    model.generation.referenceImport.removeReferenceAsset(asset.id);
    return;
  }
  if (references.length >= 8) {
    model.app.notify(limitMessage);
    return;
  }
  model.generation.referenceImport.applyReferenceAssets([...references, asset]);
}

function appendPromptImage(
  model: Props['model'],
  image: import('@/renderer/features/content-editor/contentImageAsset').ImportedEditorImage,
) {
  model.generation.promptDocument.updateReferenceAssets((current) =>
    current.some((asset) => asset.id === image.binding.assetId)
      ? current
      : [
          ...current,
          {
            id: image.binding.assetId,
            kind: 'REFERENCE',
            width: image.media.width,
            height: image.media.height,
            mimeType: image.media.mimeType,
            byteSize: image.media.byteSize,
            mediaUrl: image.media.mediaUrl,
            createdAt: new Date().toISOString(),
          },
        ],
  );
}

export function CreatorInputWorkspace({ model, sourceFormId }: Props) {
  const {
    app,
    draftInput,
    generation,
    generationRuntime,
    library,
    navigation,
    outputUi,
    projection,
    selection,
    workbench,
    workflow,
  } = model;
  const { messages } = useI18n();
  const c = messages.creator.workbench;
  const selected = selection.contentSelection;
  const document = generation.promptDocument;
  const videoScopeKey = generation.inputScopeKey;
  const videoScopeRef = useRef(videoScopeKey);
  videoScopeRef.current = videoScopeKey;
  useEffect(() => {
    videoScopeRef.current = videoScopeKey;
    return () => {
      videoScopeRef.current = '';
    };
  }, [videoScopeKey]);
  const videos = useCreatorVideoImport({
    scopeKey: videoScopeKey,
    attachToDraft: selection.creationMode === 'new',
    locale: app.locale,
    notify: app.notify,
    updateAttachments: document.updateVideoAttachments,
  });
  const accessories = useCreatorInputAccessories(model, videos);
  const hidden = creatorInputHidden(model);
  const noteWorkspace = useCreatorNoteWorkspace(model, Boolean(hidden));
  if (noteWorkspace.editor)
    return <div className={creatorInputClassName(model, Boolean(hidden))}>{noteWorkspace.editor}</div>;
  return (
    <AssetBreakdownSourceFormProvider sourceFormId={sourceFormId}>
      <PasteDropSurface
        respectEditableImagePaste
        disabled={Boolean(hidden) || generation.referenceImport.referenceImporting || videos.importing}
        onImages={(files, source, sourceUrl) => {
          void generation.referenceImport.importReferenceFiles(files, source, sourceUrl);
        }}
        onClipboardImage={(sourceUrl) => {
          void generation.referenceImport.importClipboardReference(sourceUrl);
        }}
        onVideos={(files, source, sourceUrl) => void videos.importFiles(files, source, sourceUrl)}
        onText={document.appendText}
        overlay={
          projection.newCreationSurface ? (
            <div className="flex items-center gap-3 text-muted-foreground">
              <ImageIcon className="size-8" />
              <VideoIcon className="size-8" />
              <FileTextIcon className="size-8" />
            </div>
          ) : (
            <ImageIcon className="size-8 text-muted-foreground" />
          )
        }
        className={creatorInputClassName(model, Boolean(hidden))}
      >
        <CreatorInputHeader
          albums={app.data.albums}
          allSeries={app.data.series}
          busy={workflow.starting || navigation.promptVersion.creating || library.busy}
          creationMode={selection.creationMode}
          creationStartMode={selection.creationStartMode}
          derived={derivedHeader(model)}
          experiment={workbench.seriesExperimentContext}
          inspirationSelected={Boolean(selected.selectedInspirationStash)}
          desktopNoteAction={
            selected.selectedInspirationStashId ? (
              <PinNoteButton
                stashId={selected.selectedInspirationStashId}
                saved={workflow.inspiration.savedContentKey === workflow.inspiration.currentContentKey}
                notify={app.notify}
              />
            ) : undefined
          }
          inputStashBusy={draftInput.inputStashes.busy}
          labels={{
            importedPrompt: messages.creator.comparison.importedPrompt,
            newPrompt: c.newPrompt,
            noMatchingVersions: c.noMatchingVersions,
            rename: c.rename,
            searchVersions: c.searchVersions,
            version: c.version,
            videoStartTitle: messages.videoDocuments.start.title,
          }}
          locale={app.locale}
          newCreationSurface={projection.newCreationSurface}
          promptFullWindow={app.promptFullWindow}
          series={workbench.series}
          sessionHostSeries={workbench.sessionHostSeries}
          targetAlbumId={selection.targetAlbumId}
          version={generation.hydration.version}
          viewingExperimentBranch={workbench.viewingExperimentBranch}
          onBackToSource={() => backToSource(model)}
          onChangeAlbum={(albumId) => void draftInput.navigation.changeNewCreationAlbum(albumId)}
          onChooseVersion={async (versionId) => {
            if (versionId === generation.hydration.versionId) return;
            if (await draftInput.recovery.flush()) generation.hydration.chooseVersion(versionId);
          }}
          onCreateAlbum={(parent) => library.setCreateAlbumRequest({ parent, destination: 'NEW_CREATION' })}
          onCreateDerivedScheme={() => {
            if (workbench.editorDerivedVisual) {
              void workflow.content.derivedVisual.createDerivedScheme(workbench.editorDerivedVisual.id);
            }
          }}
          onOpenInputStashes={() => void draftInput.inputStashes.openDialog()}
          onRenameSeries={() => library.setRenameSeriesOpen(true)}
          onResumeDerivedVisual={(visualId) => void workflow.content.derivedVisual.resumeDerivedVisual(visualId)}
          onSelectImageMode={() => draftInput.navigation.selectCreationStartMode('image')}
        />
        {noteWorkspace.back}
        <CreationVideoAttachments
          videos={document.videoAttachments}
          locale={app.locale}
          importing={videos.importing}
          onRemove={(materialId) =>
            document.updateVideoAttachments((current) => current.filter((video) => video.materialId !== materialId))
          }
          onCreateDocument={async (video) => {
            const capturedScope = videoScopeKey;
            if (!(await draftInput.recovery.flush())) return;
            if (selection.creationMode === 'new') await selection.creationDraftSession.saveDraftNow();
            if (videoScopeRef.current !== capturedScope) return;
            const created = await window.desktopApi.videoDocumentCreate({
              videoMaterialId: video.materialId,
              title: video.name.replace(/\.[^.]+$/, '') || video.name,
              titleLocale: app.locale,
              albumId: selection.targetAlbumId,
            });
            if (videoScopeRef.current === capturedScope) app.onSelectDocument(created.id, created.albumId);
          }}
          notify={app.notify}
        />
        {projection.newCreationSurface && selection.creationStartMode === 'video-document' ? (
          <VideoDocumentCreationStarter
            locale={app.locale}
            albums={app.data.albums}
            defaultAlbumId={selection.targetAlbumId}
            request={selection.videoCreationRequest}
            onRequestChange={selection.setVideoCreationRequest}
            onLibraryChange={app.refreshAlbums}
            onCreated={(documentId, albumId) => app.onSelectDocument(documentId, albumId)}
            notify={app.notify}
          />
        ) : (
          <MinimalCreationStarter
            key={`creation-input-${selection.inputSessionRevision}`}
            locale={app.locale}
            termPromptLocale={app.defaultPromptLocale ?? document.termPromptLocale}
            promptProfileId={generation.configuration.promptProfileId}
            prompt={document.manualPrompt}
            promptNodes={document.promptNodes}
            document={document.document}
            onImageImported={(image) => appendPromptImage(model, image)}
            onImageImportError={() => app.notify(messages.contentEditor.imageImportFailed)}
            terms={app.data.terms}
            palettes={app.data.wordPalettes}
            appliedPalettes={document.appliedPalettes}
            composerRef={document.promptComposerRef}
            assistantBusy={workflow.assistant.workflows.request.busy}
            assistantMode={workflow.assistant.workflows.request.mode}
            companionHandoffBusy={draftInput.promptHandoff.busy}
            canRequestIdeas
            canBuildPrompt={hasPromptNodes(document.promptNodes)}
            routes={generation.configuration.imageGenerationRoutes}
            generationTargets={generation.generationTargets}
            generationCount={projection.generationCount}
            readiness={projection.readiness}
            stashReady={hasPromptNodes(document.promptNodes) || document.referenceAssets.length > 0}
            stashing={workflow.inspiration.busy}
            stashed={
              Boolean(selected.selectedInspirationStashId) &&
              workflow.inspiration.savedContentKey === workflow.inspiration.currentContentKey
            }
            starting={workflow.starting || navigation.promptVersion.creating}
            planning={selection.creationMode === 'new' && !workbench.editorDerivedVisual}
            startReady={hasPromptNodes(document.promptNodes) || document.referenceAssets.length > 0}
            fullWindow={app.promptFullWindow}
            annotationRefinement={outputUi.annotationRefinement}
            materialPicker={accessories.material}
            dictionaryPicker={accessories.dictionary}
            dictionarySidebar={accessories.dictionarySidebar}
            canvasPicker={accessories.canvas}
            videoPicker={accessories.video}
            references={accessories.references}
            sourceContext={accessories.sourceContext}
            titleInput={
              selection.creationMode === 'new' && !workbench.editorDerivedVisual ? (
                <Input
                  value={generation.title}
                  aria-label={messages.creator.starter.title}
                  placeholder={messages.creator.starter.title}
                  maxLength={200}
                  className="h-11 shrink-0 rounded-none border-0 bg-transparent px-12 text-lg font-medium focus-visible:ring-inset focus-visible:ring-offset-0"
                  onChange={(event) => generation.setTitle(event.target.value)}
                />
              ) : undefined
            }
            showStashAction={!workbench.editorDerivedVisual}
            experiments={accessories.experiments}
            onPromptNodesChange={document.updatePromptDocument}
            onOpenTerm={generation.dictionaryMaterials.openTerm}
            onOpenRecipe={generation.dictionaryMaterials.openPalette}
            onConfigureRecipe={(palette) => generation.dictionaryMaterials.requestPalette(palette)}
            onRecipePromptLocaleChange={generation.dictionaryMaterials.changePaletteLocale}
            onRequestRecipeInsert={(palette, position) =>
              generation.dictionaryMaterials.requestPalette(palette, position)
            }
            onRequestIdeas={navigation.idea.requestProjectIdeas}
            onBuildPrompt={navigation.idea.requestProjectWriting}
            onHandoffPrompt={() => void draftInput.promptHandoff.handoff('chatgpt')}
            onGenerationTargetsChange={generation.setGenerationTargets}
            onConfigureExtension={app.onConfigureExtension}
            onGenerate={() => void generationRuntime.launch.generate()}
            onStashInspiration={() => void workflow.inspiration.stash()}
            onStartCreation={workflow.content.outcome.start}
            onOpenExternalImport={() => navigation.external.openExternalCreation(selection.targetAlbumId)}
            onChooseVideoDocument={() => draftInput.navigation.selectCreationStartMode('video-document')}
            onFullWindowChange={draftInput.navigation.changePromptFullWindow}
          />
        )}
        {(!projection.newCreationSurface || selection.creationStartMode === 'image') && !app.promptFullWindow && (
          <GenerationTaskTray
            tasks={app.data.generationTasks}
            routes={generation.configuration.imageGenerationRoutes}
            series={workbench.series}
            allSeries={app.data.series}
            onCancel={generationRuntime.outputCommands.cancel}
            onRetry={generationRuntime.outputCommands.retry}
            notify={app.notify}
          />
        )}
      </PasteDropSurface>
    </AssetBreakdownSourceFormProvider>
  );
}

function derivedHeader(model: CreatorScreenViewModel) {
  const visual = model.workbench.editorDerivedVisual;
  if (!visual) return null;
  return {
    appliedAssetId: model.workbench.appliedDerivedVisualAssetId,
    creating: model.workflow.content.derivedVisual.creatingDerivedScheme,
    schemeIndex: model.workbench.editorDerivedVisualSchemeIndex,
    schemes: model.workbench.editorDerivedVisualSchemes,
    sourceTitle: model.workbench.editorDerivedVisualSourceTitle,
    visual,
  };
}

function backToSource(model: CreatorScreenViewModel) {
  const selected = model.selection.contentSelection;
  if (selected.selectedSocialPost)
    void model.navigation.content.chooseSocialPost(selected.selectedSocialPost.id, 'replace');
  else if (selected.selectedArticle)
    void model.navigation.content.chooseArticle(selected.selectedArticle.id, 'replace');
}

function hasPromptNodes(nodes: CreatorScreenViewModel['generation']['promptDocument']['promptNodes']) {
  return nodes.some((node) => node.kind !== 'TEXT' || Boolean(node.text.trim()));
}

function useCreatorNoteWorkspace(model: CreatorScreenViewModel, hidden: boolean) {
  const { messages } = useI18n();
  const articleId = model.selection.contentSelection.selectedInspirationStashId;
  return {
    editor: null,
    back: articleId && !hidden && (
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        disabled={model.workflow.inspiration.busy}
        onClick={() => void model.navigation.content.chooseArticle(articleId, 'replace')}
      >
        {messages.desktopPetals.document.body}
      </Button>
    ),
  };
}
function creatorInputHidden({ app, selection, workbench }: CreatorScreenViewModel) {
  const selected = selection.contentSelection;
  return (
    app.documentWorkspaceActive ||
    app.comparisonFullWindow ||
    selected.selectedAlbum ||
    (selected.selectedArticle && !workbench.editorDerivedVisual) ||
    selected.selectedEvaluationSuite ||
    selected.selectedImageBreakdown ||
    (selected.selectedSocialPost && !workbench.editorDerivedVisual)
  );
}

function creatorInputClassName({ app, projection }: CreatorScreenViewModel, hidden: boolean) {
  return cn(
    hidden || !(app.promptFullWindow || projection.panes.multiPane || projection.panes.compactPanel === 'creator')
      ? 'hidden'
      : 'flex',
    'relative min-h-0 min-w-0 flex-col overflow-hidden bg-background',
    projection.showOutputPane && !app.promptFullWindow && 'border-r',
  );
}
