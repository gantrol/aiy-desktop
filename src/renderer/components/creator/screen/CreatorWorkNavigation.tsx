import type { ReactNode } from 'react';
import type { CreationFormEntityRef } from '@/shared/contracts';
import type { CreatorScreenViewModel } from '@/renderer/components/creator/screen/creatorScreenViewModel';
import type { CreationFormProjection } from '@/renderer/components/creator/creationLibraryProjection';
import { CreationWorkNavigationContext } from '@/renderer/components/creator/CreationWorkNavigation';

function activeWork(model: CreatorScreenViewModel): CreationFormEntityRef | null {
  const { app, selection, workbench } = model;
  const selected = selection.contentSelection;
  if (model.animationWorkspace && app.location.surface === 'animation')
    return { kind: 'GIF_DOCUMENT', id: app.location.documentId };
  if (app.documentWorkspaceActive && app.selectedDocumentId)
    return { kind: 'VIDEO_DOCUMENT', id: app.selectedDocumentId };
  if (selected.selectedAlbumId) return null;
  if (workbench.editorDerivedVisual) return { kind: 'DERIVED_VISUAL', id: workbench.editorDerivedVisual.id };
  if (selected.selectedArticleId) return { kind: 'ARTICLE', id: selected.selectedArticleId };
  if (selected.selectedSocialPostId) return { kind: 'SOCIAL_POST', id: selected.selectedSocialPostId };
  if (selected.selectedEvaluationSuiteId) return { kind: 'EVALUATION_SUITE', id: selected.selectedEvaluationSuiteId };
  if (selected.selectedImageBreakdownId) return { kind: 'IMAGE_BREAKDOWN', id: selected.selectedImageBreakdownId };
  if (selected.selectedInspirationStashId) return { kind: 'ARTICLE', id: selected.selectedInspirationStashId };
  if (selection.creationMode === 'existing' && workbench.sessionHostSeries)
    return { kind: 'PROMPT_SERIES', id: workbench.sessionHostSeries.id };
  return null;
}

export function CreatorWorkNavigationProvider({
  model,
  children,
}: {
  model: CreatorScreenViewModel;
  children: ReactNode;
}) {
  const { navigation, app } = model;
  const select = async (form: CreationFormProjection) => {
    return form.role === 'IMAGE_CREATION'
      ? navigation.creation.chooseSeries(form.session?.primarySeries.id ?? form.entityRef.id)
      : navigation.content.chooseCreationForm(form.form);
  };
  return (
    <CreationWorkNavigationContext.Provider
      value={
        !model.animationWorkspace && (app.promptFullWindow || app.comparisonFullWindow)
          ? null
          : {
              data: app.data,
              activeEntity: activeWork(model),
              onSelect: select,
              notify: app.notify,
            }
      }
    >
      {children}
    </CreationWorkNavigationContext.Provider>
  );
}
