import type { ComponentProps, ReactNode } from 'react';
import { FileTextIcon, VideoIcon } from 'lucide-react';
import type { AssetDto } from '@/shared/contracts';
import { DictionaryIcon, ImageIcon } from '@/renderer/icons';
import { AssetBreakdownSourceFormProvider } from '@/renderer/components/media/AssetMenuActionsProvider';
import { CanvasPresetPicker } from '@/renderer/components/creator/CanvasPresetPicker';
import { CreationMaterialPicker } from '@/renderer/components/creator/CreationMaterialPicker';
import { CreationReferenceStrip } from '@/renderer/components/creator/CreationReferenceStrip';
import { DerivedVisualSourceContext } from '@/renderer/components/creator/DerivedVisualSourceContext';
import { DictionaryPicker } from '@/renderer/components/creator/DictionaryPicker';
import { GenerationTaskTray } from '@/renderer/components/creator/GenerationTaskTray';
import { PasteDropSurface } from '@/renderer/components/creator/intake/PasteDropSurface';
import { MinimalCreationStarter } from '@/renderer/components/creator/MinimalCreationStarter';
import { StyleExplorationPanel } from '@/renderer/components/creator/StyleExplorationPanel';
import { CreatorDialogHost } from '@/renderer/components/creator/screen/CreatorDialogHost';
import { CreatorInputHeader } from '@/renderer/components/creator/screen/CreatorInputHeader';
import type { CreatorScreenViewModel } from '@/renderer/components/creator/screen/creatorScreenViewModel';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { cn } from '@/renderer/lib/utils';
import { VideoDocumentCreationStarter } from '@/renderer/features/video-documents/VideoDocumentCreationStarter';
import { VideoFileInput } from '@/renderer/features/video-documents/VideoDocumentFileInputs';
import { useI18n } from '@/renderer/i18n/useI18n';

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

function useCreatorInputAccessories(model: CreatorScreenViewModel): Accessories {
  const { app, draftInput, generation, navigation, projection, prompt, selection, workbench, workflow } = model;
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
        allowUnspecified={!workbench.editorSocialCoverVisual}
        onChange={(preset) => generation.setCanvasPresetKey(preset?.stableKey ?? '')}
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
    sourceContext: workbench.editorSocialCoverVisual ? (
      <DerivedVisualSourceContext
        locale={app.locale}
        sourceTitle={workbench.editorDerivedVisualSourceTitle}
        assets={workbench.editorDerivedVisualSourceAssets}
        referenceAssetIds={document.referenceAssets.map((asset) => asset.id)}
        onOpenSource={openSource}
        onToggleReference={(asset) => toggleReferenceAsset(model, asset)}
      />
    ) : null,
    video: (
      <>
        <VideoFileInput
          inputRef={prompt.newCreationVideoInputRef}
          onSelect={(file) => {
            draftInput.navigation.selectCreationStartMode('video-document');
            selection.setVideoCreationRequest({ file, source: 'UPLOAD' });
          }}
        />
        <Button
          data-action="creation-video-picker"
          type="button"
          variant="outline"
          size="icon"
          className="rounded-full"
          title={app.locale === 'zh' ? '视频转文稿' : 'Video to document'}
          aria-label={app.locale === 'zh' ? '视频转文稿' : 'Video to document'}
          onClick={() => prompt.newCreationVideoInputRef.current?.click()}
        >
          <VideoIcon className="size-4" />
        </Button>
      </>
    ),
  };
}

function toggleReferenceAsset(model: CreatorScreenViewModel, asset: AssetDto) {
  const references = model.generation.promptDocument.referenceAssets;
  if (references.some((reference) => reference.id === asset.id)) {
    model.generation.referenceImport.removeReferenceAsset(asset.id);
    return;
  }
  if (references.length >= 8) {
    model.app.notify(model.app.locale === 'zh' ? '最多添加 8 张参考图' : 'You can add up to 8 reference images');
    return;
  }
  model.generation.referenceImport.applyReferenceAssets([...references, asset]);
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
  const accessories = useCreatorInputAccessories(model);
  const hidden =
    app.documentWorkspaceActive ||
    app.comparisonFullWindow ||
    selected.selectedAlbum ||
    selected.selectedArticle ||
    selected.selectedEvaluationSuite ||
    selected.selectedImageBreakdown ||
    (selected.selectedSocialPost && !workbench.editorSocialCoverVisual);
  return (
    <AssetBreakdownSourceFormProvider sourceFormId={sourceFormId}>
      <PasteDropSurface
        disabled={generation.referenceImport.referenceImporting}
        onImages={(files, source, sourceUrl) => {
          if (projection.newCreationSurface) draftInput.navigation.selectCreationStartMode('image');
          void generation.referenceImport.importReferenceFiles(files, source, sourceUrl);
        }}
        onClipboardImage={(sourceUrl) => {
          if (projection.newCreationSurface) draftInput.navigation.selectCreationStartMode('image');
          void generation.referenceImport.importClipboardReference(sourceUrl);
        }}
        onVideo={(file, source) => {
          if (!projection.newCreationSurface) return;
          draftInput.navigation.selectCreationStartMode('video-document');
          selection.setVideoCreationRequest({ file, source });
        }}
        onText={document.appendText}
        overlay={
          projection.newCreationSurface ? (
            <div className="flex items-center gap-3 text-muted-foreground">
              <ImageIcon className="size-8" />
              <FileTextIcon className="size-8" />
            </div>
          ) : (
            <ImageIcon className="size-8 text-muted-foreground" />
          )
        }
        className={
          hidden
            ? 'hidden'
            : cn(
                app.promptFullWindow || projection.panes.multiPane || projection.panes.compactPanel === 'creator'
                  ? 'flex'
                  : 'hidden',
                'relative min-h-0 min-w-0 flex-col overflow-hidden bg-background',
                projection.showOutputPane && !app.promptFullWindow && 'border-r',
              )
        }
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
          onChooseVersion={generation.hydration.chooseVersion}
          onCreateAlbum={(parent) => library.setCreateAlbumRequest({ parent, destination: 'NEW_CREATION' })}
          onCreateDerivedScheme={() => {
            if (selected.selectedSocialPost) {
              void workflow.content.derivedVisual.createSocialCoverScheme(selected.selectedSocialPost);
            }
          }}
          onOpenExternalImport={() => navigation.external.openExternalCreation(selection.targetAlbumId)}
          onOpenInputStashes={() => void draftInput.inputStashes.openDialog()}
          onRenameSeries={() => library.setRenameSeriesOpen(true)}
          onResumeDerivedVisual={(visualId) => void workflow.content.derivedVisual.resumeDerivedVisual(visualId)}
          onSelectImageMode={() => draftInput.navigation.selectCreationStartMode('image')}
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
            stashReady={hasPromptNodes(document.promptNodes)}
            stashing={workflow.inspiration.busy}
            stashed={
              Boolean(selected.selectedInspirationStashId) &&
              workflow.inspiration.savedContentKey === workflow.inspiration.currentContentKey
            }
            starting={workflow.starting || navigation.promptVersion.creating}
            planning={selection.creationMode === 'new' && !workbench.editorSocialCoverVisual}
            startReady={Boolean(generation.promptResolution.livePrompt.trim())}
            fullWindow={app.promptFullWindow}
            annotationRefinement={outputUi.annotationRefinement}
            materialPicker={accessories.material}
            dictionaryPicker={accessories.dictionary}
            dictionarySidebar={accessories.dictionarySidebar}
            canvasPicker={accessories.canvas}
            videoPicker={accessories.video}
            references={accessories.references}
            sourceContext={accessories.sourceContext}
            showStashAction={!workbench.editorSocialCoverVisual}
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
        <CreatorInputDialogs model={model} />
      </PasteDropSurface>
    </AssetBreakdownSourceFormProvider>
  );
}

function CreatorInputDialogs({ model }: Pick<Props, 'model'>) {
  const { app, draftInput, generation, library, navigation, selection, workbench, workflow } = model;
  const { messages } = useI18n();
  const assistant = workflow.assistant.workflows;
  return (
    <CreatorDialogHost
      albumDefaults={library.settingsAlbum}
      appliedPalettes={generation.promptDocument.appliedPalettes}
      confirmationDialog={library.lifecycle.confirmationDialog}
      createAlbumBusy={library.busy}
      createAlbumLabels={{
        title: messages.gallery.albums.createTitle,
        childTitle: messages.gallery.albums.createChild,
        name: messages.gallery.albums.name,
        placeholder: messages.gallery.albums.namePlaceholder,
        cancel: messages.gallery.albums.cancel,
        create: messages.gallery.albums.create,
        operationFailed: messages.gallery.albums.operationFailed,
      }}
      createAlbumRequest={library.createAlbumRequest}
      currentInput={draftInput.draftProjection.currentInput}
      data={app.data}
      defaultPromptLocale={app.defaultPromptLocale}
      direction={{
        open: assistant.direction.dialog.open,
        directions: assistant.direction.dialog.directions,
        targets: assistant.direction.dialog.targets,
        routes: generation.configuration.imageGenerationRoutes,
        commonConstraints: assistant.direction.dialog.commonConstraints,
        assumptions: assistant.direction.dialog.assumptions,
        objective: assistant.direction.dialog.objective,
        canvasLabel: assistant.direction.dialog.canvasLabel,
        remoteScope: assistant.direction.dialog.remoteScope,
        busy: assistant.direction.starting,
        error: assistant.direction.error,
        onOpenChange: assistant.direction.changeDialogOpen,
        onConfirm: assistant.direction.start,
      }}
      distilledPalette={library.distilledPalette}
      distillation={{
        open: assistant.distillation.dialogOpen,
        locale: app.locale,
        proposals: assistant.distillation.proposals,
        busy: assistant.distillation.busy,
        error: assistant.distillation.error,
        acceptingProposalId: assistant.distillation.acceptingProposalId,
        onOpenChange: assistant.distillation.changeDialogOpen,
        onCreate: assistant.distillation.create,
        onAccept: assistant.distillation.accept,
      }}
      externalAlbumId={navigation.external.externalCreationAlbumId}
      externalOpen={navigation.external.externalCreationOpen}
      inputStashBusy={draftInput.inputStashes.busy}
      inputStashes={draftInput.inputStashes.stashes}
      inputStashOpen={draftInput.inputStashes.dialogOpen}
      locale={app.locale}
      notify={app.notify}
      outputImport={generation.outputImport}
      paletteInspector={generation.dictionaryMaterials.paletteInspector}
      paletteToApply={generation.dictionaryMaterials.paletteToApply}
      recipeSavedMessage={messages.creator.workbench.recipeSaved}
      renameAlbum={library.renameAlbum}
      renameArticle={library.renameArticle}
      renameDocument={library.renameDocument}
      renameSeriesOpen={library.renameSeriesOpen}
      series={selection.creationMode === 'existing' ? workbench.series : undefined}
      seriesPrompt={generation.hydration.version?.finalPrompt ?? generation.promptResolution.livePrompt}
      onAlbumDefaultsChange={library.setSettingsAlbum}
      onAlbumDefaultsSaved={app.refreshAlbums}
      onApplyPalette={generation.dictionaryMaterials.applyPalette}
      onCreateAlbum={library.actions.createAlbum}
      onCreateAlbumRequestChange={library.setCreateAlbumRequest}
      onCreateExternal={navigation.external.createExternalCreation}
      onDistilledPaletteChange={library.setDistilledPalette}
      onExternalOpenChange={(open) => {
        if (!open) navigation.external.openExternalCreation(undefined);
      }}
      onInputStashOpenChange={draftInput.inputStashes.changeDialogOpen}
      onPaletteApplicationDismiss={generation.dictionaryMaterials.dismissPaletteApplication}
      onPaletteInspectorChange={generation.dictionaryMaterials.setPaletteInspector}
      onPaletteSaved={generation.dictionaryMaterials.paletteSaved}
      onRefresh={app.refresh}
      onRenameAlbum={library.actions.renameAlbum}
      onRenameAlbumChange={library.setRenameAlbum}
      onRenameArticle={workflow.content.article.renameArticle}
      onRenameArticleChange={library.setRenameArticle}
      onRenameDocument={library.actions.renameDocument}
      onRenameDocumentChange={library.setRenameDocument}
      onRenameSeriesOpenChange={library.setRenameSeriesOpen}
      onRestoreInputStash={draftInput.inputStashes.restoreStash}
      onStashCurrentInput={draftInput.inputStashes.createStash}
    />
  );
}

function derivedHeader(model: CreatorScreenViewModel) {
  const visual = model.workbench.editorSocialCoverVisual;
  if (!visual) return null;
  return {
    appliedAssetId: model.selection.contentSelection.selectedSocialPost?.content.coverAssetId ?? null,
    creating: model.workflow.content.derivedVisual.creatingSocialCoverScheme,
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
