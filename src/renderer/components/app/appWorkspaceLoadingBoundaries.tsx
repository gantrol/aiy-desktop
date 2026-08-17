import type { ReactNode } from 'react';
import type { TransitionPreviewDto } from '@/shared/contracts';
import type { AppView } from '@/renderer/components/app/AppSidebar';
import type { AppWorkspaceLoadingBoundaries } from '@/renderer/components/app/AppWorkspaceViews';
import { AppLoadingBoundary, APP_LOADING_VARIANTS as loadingVariants } from '@/renderer/components/app/AppLoadingState';

export function createWorkspaceLoadingBoundaries(
  previews: readonly TransitionPreviewDto[],
  view: AppView,
): AppWorkspaceLoadingBoundaries {
  const currentView = (children: ReactNode) => (
    <AppLoadingBoundary previews={previews} variant={loadingVariants[view]}>
      {children}
    </AppLoadingBoundary>
  );
  return {
    creator: currentView,
    documents: (children) => (
      <AppLoadingBoundary previews={previews} variant={loadingVariants.documents}>
        {children}
      </AppLoadingBoundary>
    ),
    dictionary: currentView,
    gallery: currentView,
    extensions: currentView,
    aiCenter: currentView,
  };
}
