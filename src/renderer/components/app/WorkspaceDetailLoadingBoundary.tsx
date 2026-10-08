import { createContext, Suspense, useContext, useMemo, type ReactNode } from 'react';
import { WorkspaceSidebarLoading } from '@/renderer/components/workspace/WorkspaceHeader';
import type { TransitionPreviewDto } from '@/shared/contracts';
import {
  AppLoadingState,
  DEFAULT_APP_LOADING_VARIANT,
  type AppLoadingVariant,
} from '@/renderer/components/app/AppLoadingState';

interface LoadingScene {
  previews: readonly TransitionPreviewDto[];
  variant: AppLoadingVariant;
}

const WorkspaceLoadingContext = createContext<LoadingScene>({
  previews: [],
  variant: DEFAULT_APP_LOADING_VARIANT,
});

export function WorkspaceLoadingProvider({ children, previews, variant }: LoadingScene & { children: ReactNode }) {
  const scene = useMemo(() => ({ previews, variant }), [previews, variant]);
  return <WorkspaceLoadingContext value={scene}>{children}</WorkspaceLoadingContext>;
}

export function WorkspaceDetailLoadingBoundary({
  children,
  className,
  visible = true,
  preserveWorkspaceLayout = false,
}: {
  children: ReactNode;
  className?: string;
  visible?: boolean;
  preserveWorkspaceLayout?: boolean;
}) {
  const scene = useContext(WorkspaceLoadingContext);
  const loading = visible ? (
    <div className={className ?? 'size-full min-h-0 min-w-0 overflow-hidden'}>
      <AppLoadingState {...scene} />
    </div>
  ) : null;
  return (
    <Suspense
      fallback={preserveWorkspaceLayout ? <WorkspaceSidebarLoading>{loading}</WorkspaceSidebarLoading> : loading}
    >
      {children}
    </Suspense>
  );
}
