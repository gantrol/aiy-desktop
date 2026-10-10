import { lazy, useEffect } from 'react';
import { WorkspaceDetailLoadingBoundary } from '@/renderer/components/app/WorkspaceDetailLoadingBoundary';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { Button } from '@/renderer/components/ui/button';
import { DerivedVisualResumeDialog } from '@/renderer/components/creator/DerivedVisualResumeDialog';
import { creationFormByEntity } from '@/renderer/components/creator/creationFormEntities';
import { CreatorInputWorkspace } from '@/renderer/components/creator/screen/CreatorInputWorkspace';
import { CreatorScreenDialogs } from '@/renderer/components/creator/screen/CreatorScreenDialogs';
import {
  CreatorLibraryWorkspace,
  CreatorSpecializedWorkspace,
} from '@/renderer/components/creator/screen/CreatorLibraryWorkspace';
import type { CreatorScreenViewModel } from '@/renderer/components/creator/screen/creatorScreenViewModel';
import { AssetBreakdownSourceFormProvider } from '@/renderer/components/media/AssetMenuActionsProvider';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { useI18n } from '@/renderer/i18n/useI18n';
import { CreatorWorkNavigationProvider } from '@/renderer/components/creator/screen/CreatorWorkNavigation';
import type { MessageCatalog } from '@/renderer/i18n/types';
import { useWorkspaceSidebarWidth, WorkspaceSidebarContent } from '@/renderer/components/workspace/WorkspaceHeader';

const CreatorOutputWorkspace = lazy(() =>
  import('@/renderer/components/creator/screen/CreatorOutputWorkspace').then((module) => ({
    default: module.CreatorOutputWorkspace,
  })),
);

interface Props {
  model: CreatorScreenViewModel;
}

export function CreatorScreenView({ model }: Props) {
  const { animationWorkspace, app, projection } = model;
  const { messages } = useI18n();
  const awaitingArticle = articleSelectionPending(model);
  const sourceForms = activeSourceForms(model);
  const specializedWorkspaceVisible = hasSpecializedWorkspace(model);
  const derivedVisual = model.workflow.content.derivedVisual;
  const animationId = animationWorkspace && app.location.surface === 'animation' ? app.location.documentId : null;
  const { setCompactPanel } = projection.panes;
  const sidebarVisible = creatorSidebarVisible(model);
  const sidebarWidth = useWorkspaceSidebarWidth(
    sidebarVisible ? projection.panes.resultWidth : 0,
    projection.panes.animateDisclosure,
  );
  const gridStyle = projection.panes.workspaceGridStyle;
  useEffect(() => {
    if (animationId) setCompactPanel('creator');
  }, [animationId, setCompactPanel]);
  return (
    <CreatorWorkNavigationProvider model={model}>
      <div className="@container/creator flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        <nav
          className={
            app.libraryVisible === false || (!animationWorkspace && (app.comparisonFullWindow || app.promptFullWindow))
              ? 'hidden'
              : 'flex h-11 shrink-0 items-center justify-center border-b bg-muted/40 px-3 @min-[840px]/creator:hidden'
          }
          aria-label={messages.app.navigation.creator}
        >
          <Segmented
            type="single"
            value={projection.panes.compactPanel}
            onValueChange={(value) =>
              value && projection.panes.setCompactPanel(value as 'library' | 'creator' | 'output')
            }
          >
            <SegmentedItem value="library" className="px-4">
              {messages.creator.results.library}
            </SegmentedItem>
            <SegmentedItem value="creator" className="px-4">
              {animationWorkspace
                ? messages.creator.gifMaker.workspaceTitle
                : app.documentWorkspaceActive
                  ? messages.videoDocuments.title
                  : messages.app.navigation.creator}
            </SegmentedItem>
            {projection.showOutputPane && (
              <SegmentedItem value="output" className="px-4">
                {outputTabLabel(model, messages)}
              </SegmentedItem>
            )}
          </Segmented>
        </nav>
        <div
          ref={projection.panes.workspaceRef}
          className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden"
          style={
            sidebarVisible && gridStyle
              ? {
                  ...gridStyle,
                  gridTemplateColumns: String(gridStyle.gridTemplateColumns).replace(/^\S+/, sidebarWidth),
                }
              : gridStyle
          }
        >
          {app.libraryVisible !== false && <CreatorLibraryWorkspace model={model} />}
          <WorkspaceSidebarContent>
            {awaitingArticle && <ArticleLoadStatus model={model} />}
            {animationWorkspace && (
              <div
                className={`${projection.panes.multiPane || projection.panes.compactPanel === 'creator' ? 'flex' : 'hidden'} min-h-0 min-w-0 overflow-hidden bg-background`}
              >
                {animationWorkspace}
              </div>
            )}
            {!animationWorkspace && specializedWorkspaceVisible && (
              <CreatorSpecializedWorkspace model={model} imageBreakdownSourceFormId={sourceForms.imageBreakdown} />
            )}
            {!animationWorkspace && !awaitingArticle && (
              <CreatorInputWorkspace model={model} sourceFormId={sourceForms.active} />
            )}
            {projection.showOutputPane && !app.promptFullWindow && (
              <WorkspaceDetailLoadingBoundary
                className="min-h-0 min-w-0 overflow-hidden"
                visible={
                  app.comparisonFullWindow || projection.panes.multiPane || projection.panes.compactPanel === 'output'
                }
              >
                <CreatorOutputWorkspace model={model} sourceFormId={sourceForms.active} />
              </WorkspaceDetailLoadingBoundary>
            )}
          </WorkspaceSidebarContent>
        </div>
        <AssetBreakdownSourceFormProvider sourceFormId={sourceForms.active}>
          <CreatorScreenDialogs model={model} />
        </AssetBreakdownSourceFormProvider>
        {app.active && derivedVisual.resumeFailure && (
          <DerivedVisualResumeDialog
            message={derivedVisual.resumeFailure.message}
            onDismiss={derivedVisual.dismissResumeFailure}
            onOpenCurrent={() => void derivedVisual.openCurrentDerivedVisual()}
          />
        )}
      </div>
    </CreatorWorkNavigationProvider>
  );
}

function creatorSidebarVisible({ projection, app, animationWorkspace }: CreatorScreenViewModel) {
  return (
    projection.panes.multiPane &&
    app.libraryVisible !== false &&
    Boolean(animationWorkspace || (!app.comparisonFullWindow && !app.promptFullWindow))
  );
}

function hasSpecializedWorkspace(model: CreatorScreenViewModel) {
  const selected = model.selection.contentSelection;
  return Boolean(
    model.app.documentWorkspace ||
    (selected.selectedArticle && !model.workbench.editorDerivedVisual) ||
    selected.selectedAlbum ||
    selected.selectedEvaluationSuite ||
    selected.selectedImageBreakdown ||
    (selected.selectedSocialPost && !model.workbench.editorDerivedVisual),
  );
}

function activeSourceForms(model: CreatorScreenViewModel) {
  const { data } = model.app;
  const selectedBreakdown = model.selection.contentSelection.selectedImageBreakdown;
  const imageBreakdown = selectedBreakdown
    ? (creationFormByEntity(data.creationItems, 'IMAGE_BREAKDOWN', selectedBreakdown.id)?.form ?? null)
    : null;
  const active = model.workbench.editorDerivedVisual
    ? (creationFormByEntity(data.creationItems, 'DERIVED_VISUAL', model.workbench.editorDerivedVisual.id)?.form.id ??
      null)
    : imageBreakdown
      ? imageBreakdown.sourceFormId
      : model.selection.seriesId
        ? (creationFormByEntity(data.creationItems, 'PROMPT_SERIES', model.selection.seriesId)?.form.id ?? null)
        : null;
  return { active, imageBreakdown: imageBreakdown?.sourceFormId ?? null };
}

function outputTabLabel(model: CreatorScreenViewModel, messages: MessageCatalog) {
  const visual = model.workbench.editorDerivedVisual;
  if (visual) {
    return messages.creator.derivedVisual.targetRoles[visual.role];
  }
  return messages.creator.outputTabs[model.outputUi.mode];
}

function articleSelectionPending(model: CreatorScreenViewModel) {
  const content = model.selection.contentSelection;
  return Boolean(
    (content.selectedArticleId && !content.selectedArticle) ||
    (content.selectedInspirationStashId && !content.selectedInspirationStash),
  );
}

function ArticleLoadStatus({ model }: Props) {
  const content = model.selection.contentSelection;
  const { messages } = useI18n();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-6" aria-busy={!content.articleLoadError}>
      {content.articleLoadError ? (
        <>
          <p role="alert" className="text-sm text-destructive">
            {content.articleLoadError}
          </p>
          <Button variant="outline" className="self-start" onClick={content.retryArticleLoad}>
            {messages.workbench.retry}
          </Button>
        </>
      ) : (
        <>
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-40 w-full" />
        </>
      )}
    </div>
  );
}
