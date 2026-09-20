import type { ReactNode } from 'react';
import type { TransitionPreviewDto } from '@/shared/contracts';
import type { AppView } from '@/renderer/components/app/app-navigation';
import type { AppWorkspaceLoadingBoundaries } from '@/renderer/components/app/AppWorkspaceViews';
import { APP_LOADING_VARIANTS as loadingVariants } from '@/renderer/components/app/AppLoadingState';
import {
  WorkspaceDetailLoadingBoundary,
  WorkspaceLoadingProvider,
} from '@/renderer/components/app/WorkspaceDetailLoadingBoundary';

export function createWorkspaceLoadingBoundaries(
  previews: readonly TransitionPreviewDto[],
  view: AppView,
): AppWorkspaceLoadingBoundaries {
  // Cover the initial screen-module load. Once mounted, each screen's detail
  // boundaries keep editor loading from replacing its visible directory.
  const screen = (screenView: AppView) => (children: ReactNode) => (
    <WorkspaceLoadingProvider previews={previews} variant={loadingVariants[screenView]}>
      <WorkspaceDetailLoadingBoundary>{children}</WorkspaceDetailLoadingBoundary>
    </WorkspaceLoadingProvider>
  );
  return {
    creator: screen('creator'),
    documents: (children) => (
      <WorkspaceLoadingProvider previews={previews} variant={loadingVariants.documents}>
        <WorkspaceDetailLoadingBoundary>{children}</WorkspaceDetailLoadingBoundary>
      </WorkspaceLoadingProvider>
    ),
    dictionary: screen('dictionary'),
    gallery: screen('gallery'),
    search: screen('search'),
    calendar: screen('calendar'),
    companion: screen('companion'),
    extensions: screen(view),
    aiCenter: screen('aiCenter'),
  };
}
