import { CreatorDialogHost } from '@/renderer/components/creator/screen/CreatorDialogHost';
import type { CreatorScreenViewModel } from '@/renderer/components/creator/screen/creatorScreenViewModel';
import { useI18n } from '@/renderer/i18n/useI18n';

export function CreatorScreenDialogs({ model }: { model: CreatorScreenViewModel }) {
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
