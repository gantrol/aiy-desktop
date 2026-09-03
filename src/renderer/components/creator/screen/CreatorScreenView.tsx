import { lazy } from 'react';
import { creationFormByEntity } from '@/renderer/components/creator/creationFormEntities';
import { CreatorInputWorkspace } from '@/renderer/components/creator/screen/CreatorInputWorkspace';
import {
  CreatorLibraryWorkspace,
  CreatorSpecializedWorkspace,
} from '@/renderer/components/creator/screen/CreatorLibraryWorkspace';
import type { CreatorScreenViewModel } from '@/renderer/components/creator/screen/creatorScreenViewModel';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { useI18n } from '@/renderer/i18n/useI18n';

const CreatorOutputWorkspace = lazy(() =>
  import('@/renderer/components/creator/screen/CreatorOutputWorkspace').then((module) => ({
    default: module.CreatorOutputWorkspace,
  })),
);

interface Props {
  model: CreatorScreenViewModel;
}

export function CreatorScreenView({ model }: Props) {
  const { app, projection } = model;
  const { messages } = useI18n();
  const sourceForms = activeSourceForms(model);
  const specializedWorkspaceVisible = hasSpecializedWorkspace(model);
  return (
    <div className="@container/creator flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
      <nav
        className={
          app.comparisonFullWindow || app.promptFullWindow
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
            {app.documentWorkspaceActive ? messages.videoDocuments.title : messages.app.navigation.creator}
          </SegmentedItem>
          {projection.showOutputPane && (
            <SegmentedItem value="output" className="px-4">
              {outputTabLabel(model)}
            </SegmentedItem>
          )}
        </Segmented>
      </nav>
      <div
        ref={projection.panes.workspaceRef}
        className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden"
        style={projection.panes.workspaceGridStyle}
      >
        <CreatorLibraryWorkspace model={model} />
        {specializedWorkspaceVisible && (
          <CreatorSpecializedWorkspace model={model} imageBreakdownSourceFormId={sourceForms.imageBreakdown} />
        )}
        <CreatorInputWorkspace model={model} sourceFormId={sourceForms.active} />
        {projection.showOutputPane && <CreatorOutputWorkspace model={model} sourceFormId={sourceForms.active} />}
      </div>
    </div>
  );
}

function hasSpecializedWorkspace(model: CreatorScreenViewModel) {
  const selected = model.selection.contentSelection;
  return Boolean(
    model.app.documentWorkspace ||
    selected.selectedArticle ||
    selected.selectedAlbum ||
    selected.selectedEvaluationSuite ||
    selected.selectedImageBreakdown ||
    (selected.selectedSocialPost && !model.workbench.editorSocialCoverVisual),
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

function outputTabLabel(model: CreatorScreenViewModel) {
  const { locale } = model.app;
  const visual = model.workbench.editorDerivedVisual;
  if (visual) {
    if (locale === 'zh') {
      if (visual.role === 'ARTICLE_HEADER') return '题图';
      if (visual.role === 'ARTICLE_INLINE') return '配图';
      return '封面';
    }
    if (visual.role === 'ARTICLE_HEADER') return 'Hero';
    if (visual.role === 'ARTICLE_INLINE') return 'Illustration';
    return 'Cover';
  }
  if (model.outputUi.mode === 'results') return locale === 'zh' ? '成果' : 'Results';
  if (model.outputUi.mode === 'inputs') return locale === 'zh' ? '输入' : 'Inputs';
  return locale === 'zh' ? '记录' : 'Records';
}
