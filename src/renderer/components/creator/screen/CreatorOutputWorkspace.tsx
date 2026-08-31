import { AssetBreakdownSourceFormProvider } from '@/renderer/components/media/AssetMenuActionsProvider';
import { CreatorRecordPanel } from '@/renderer/components/creator/CreatorAssistantOutputPanel';
import { CreatorInputPanel } from '@/renderer/components/creator/CreatorInputPanel';
import { CreationOutputTabs } from '@/renderer/components/creator/CreationOutputTabs';
import { DerivedVisualWorkbench } from '@/renderer/components/creator/DerivedVisualWorkbench';
import { OutputInspector } from '@/renderer/components/creator/OutputInspector';
import type { CreatorScreenViewModel } from '@/renderer/components/creator/screen/creatorScreenViewModel';
import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';

interface Props {
  model: CreatorScreenViewModel;
  sourceFormId: string | null;
}

function OutputHeader({ model }: Pick<Props, 'model'>) {
  return (
    <CreationOutputTabs
      value={model.outputUi.mode}
      locale={model.app.locale}
      onValueChange={(value) => void model.navigation.idea.changeOutputMode(value)}
    />
  );
}

function OutputEmptyState({ model }: Pick<Props, 'model'>) {
  const { locale } = model.app;
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="flex max-w-md flex-col items-center gap-4">
        <span className="text-sm font-semibold">{locale === 'zh' ? '新建成果' : 'New result'}</span>
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" variant="secondary" onClick={() => model.projection.panes.setCompactPanel('creator')}>
            {locale === 'zh' ? '图片' : 'Image'}
          </Button>
          {(['文章', '视频', '音频'] as const).map((label, index) => (
            <Button
              key={label}
              type="button"
              variant="outline"
              disabled
              title={locale === 'zh' ? '尚未接入' : 'Not available yet'}
            >
              {locale === 'zh' ? label : (['Article', 'Video', 'Audio'] as const)[index]}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CreatorOutputWorkspace({ model, sourceFormId }: Props) {
  const { app, generation, generationRuntime, navigation, outputUi, projection, selection, workbench, workflow } =
    model;
  const selected = selection.contentSelection;
  const document = generation.promptDocument;
  const assistant = workflow.assistant.workflows;
  const content = workflow.content;
  const { panes } = projection;
  if (!projection.showOutputPane || app.promptFullWindow) return null;

  const headerNavigation = <OutputHeader model={model} />;
  return (
    <AssetBreakdownSourceFormProvider sourceFormId={sourceFormId}>
      <div
        className={
          app.comparisonFullWindow
            ? 'block min-h-0 min-w-0 overflow-hidden [&>*]:size-full'
            : cn(
                panes.multiPane || panes.compactPanel === 'output' ? 'block' : 'hidden',
                'min-h-0 min-w-0 overflow-hidden [&>*]:size-full',
              )
        }
      >
        {workbench.editorDerivedVisual && !workbench.editorSocialCoverVisual ? (
          <DerivedVisualWorkbench
            visual={workbench.editorDerivedVisual}
            locale={app.locale}
            prompt={document.manualPrompt}
            canvasPreset={generation.canvasPreset}
            canvasPresets={app.data.canvasPresets}
            series={workbench.outputSeries}
            routes={generation.configuration.imageGenerationRoutes}
            generationTargets={generation.generationTargets}
            generationCount={projection.generationCount}
            generationTasks={app.data.generationTasks}
            readiness={projection.readiness}
            starting={workflow.starting || navigation.promptVersion.creating}
            resizeValue={panes.outputWidth}
            resizeMin={panes.outputResizeMin}
            resizeMax={panes.outputResizeMax}
            onResizeStart={panes.beginOutputResize}
            onResizeValueChange={panes.setOutputWidth}
            onPromptChange={navigation.derivedVisual.changePrompt}
            onCanvasPresetChange={navigation.derivedVisual.changeCanvas}
            onGenerationTargetsChange={generation.setGenerationTargets}
            onConfigureExtension={app.onConfigureExtension}
            onGenerate={() => void generationRuntime.launch.generate()}
            onAdopt={content.derivedVisual.adoptDerivedVisual}
            onClose={() => {
              workbench.setDismissedDerivedVisualId(workbench.editorDerivedVisual!.id);
              panes.setCompactPanel('creator');
            }}
            notify={app.notify}
          />
        ) : outputUi.mode === 'results' ? (
          <OutputInspector
            headerNavigation={headerNavigation}
            emptyState={<OutputEmptyState model={model} />}
            series={workbench.outputSeries}
            primarySeries={workbench.outputPrimarySeries}
            outputProjection={workbench.outputProjection}
            locale={app.locale}
            terms={app.data.terms}
            wordPalettes={app.data.wordPalettes}
            imageGenerationRoutes={generation.configuration.imageGenerationRoutes}
            generationTargets={generation.generationTargets}
            generationTasks={app.data.generationTasks}
            requestedAssetId={outputUi.requestedAssetId}
            annotationWorkspaceRequest={annotationWorkspaceRequest(model)}
            onAnnotationRefinementStateChange={outputUi.setAnnotationRefinement}
            onRequestedAssetIdChange={model.draftInput.navigation.selectOutputAsset}
            galleryOpen={outputUi.galleryOpen}
            collapsed={panes.outputCollapsed}
            comparisonFullWindow={app.comparisonFullWindow}
            onCollapsedChange={panes.setOutputCollapsed}
            onResizeStart={panes.beginOutputResize}
            resizeValue={panes.outputWidth}
            resizeMin={panes.outputResizeMin}
            resizeMax={panes.outputResizeMax}
            onResizeValueChange={panes.setOutputWidth}
            onComparisonFullWindowChange={app.onComparisonFullWindowChange}
            onGalleryOpenChange={outputUi.setGalleryOpen}
            onGenerateVersion={generationRuntime.outputCommands.generateVersion}
            onGeneratePrompt={generationRuntime.outputCommands.generateImportedPrompt}
            onReusePrompt={navigation.output.reusePromptInput}
            onRefineImage={generationRuntime.outputCommands.refine}
            onCropImage={generationRuntime.outputCommands.crop}
            onReframeImage={generationRuntime.outputCommands.reframe}
            onRetryGeneration={generationRuntime.outputCommands.retry}
            onReEditGeneration={(runId) => void navigation.output.reEditGeneration(runId)}
            distilling={assistant.distillation.busy}
            onDistillKnowledge={assistant.distillation.open}
            importing={generation.outputImport.busy}
            onImportFiles={(files, source, sourceUrl) =>
              void generation.outputImport.previewFiles(files, source, sourceUrl)
            }
            onChooseImport={() => void generation.outputImport.chooseFiles()}
            onPasteText={navigation.output.pasteTextFromOutput}
            onCreatePromptVersion={navigation.promptVersion.create}
            onImportedOutputUpdated={app.refresh}
            onImportedOutputSaved={app.onImportedOutputSaved}
            derivedVisual={workbench.editorSocialCoverVisual ?? workbench.outputDerivedVisual}
            appliedDerivedVisualAssetId={
              workbench.editorSocialCoverVisual
                ? (selected.selectedSocialPost?.content.coverAssetId ?? null)
                : undefined
            }
            onAdoptDerivedVisual={content.derivedVisual.adoptDerivedVisual}
            notify={app.notify}
          />
        ) : outputUi.mode === 'inputs' ? (
          <CreatorInputPanel
            headerNavigation={headerNavigation}
            locale={app.locale}
            prompt={document.manualPrompt}
            referenceAssets={document.referenceAssets}
            collapsed={panes.outputCollapsed}
            resizeValue={panes.outputWidth}
            resizeMin={panes.outputResizeMin}
            resizeMax={panes.outputResizeMax}
            revealContext={workbench.series ? { kind: 'CREATION', seriesId: workbench.series.id } : undefined}
            notify={app.notify}
            onReferenceAssetsChange={generation.referenceImport.applyReferenceAssets}
            onCollapsedChange={panes.setOutputCollapsed}
            onResizeStart={panes.beginOutputResize}
            onResizeValueChange={panes.setOutputWidth}
          />
        ) : (
          <CreatorRecordPanel
            headerNavigation={headerNavigation}
            locale={app.locale}
            scope={projection.activeIdeaCreation?.sourceScope ?? workbench.assistantScope}
            runs={workflow.assistant.recordAssistantRuns}
            progressEvents={projection.activeIdeaCreation?.activityEvents ?? assistant.request.progressEvents}
            prompt={document.manualPrompt}
            promptNodes={document.promptNodes}
            currentContextKey={generation.assistantContextKey}
            busy={assistant.request.busy}
            activeMode={assistant.request.mode}
            error={assistant.request.error || projection.activeIdeaCreation?.failureMessage || ''}
            collapsed={panes.outputCollapsed}
            resizeValue={panes.outputWidth}
            resizeMin={panes.outputResizeMin}
            resizeMax={panes.outputResizeMax}
            onCollapsedChange={panes.setOutputCollapsed}
            onResizeStart={panes.beginOutputResize}
            onResizeValueChange={panes.setOutputWidth}
            onRequestIdeas={navigation.idea.requestProjectIdeas}
            onBuildPrompt={navigation.idea.requestProjectWriting}
            onApply={assistant.adoption.adopt}
            onDismiss={assistant.request.dismiss}
            onDismissTransient={assistant.request.clearError}
            onStartExperiment={assistant.direction.review}
          />
        )}
      </div>
    </AssetBreakdownSourceFormProvider>
  );
}

function annotationWorkspaceRequest(model: CreatorScreenViewModel) {
  const { location } = model.app;
  return location.surface === 'existing-creation' && location.workspace === 'annotations' && location.assetId
    ? { assetId: location.assetId, requestId: location.requestId ?? 0 }
    : null;
}
