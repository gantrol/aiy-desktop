import { createContext, Suspense, useContext, useMemo, type ReactNode } from 'react';
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
}: {
  children: ReactNode;
  className?: string;
  visible?: boolean;
}) {
  const scene = useContext(WorkspaceLoadingContext);
  return (
    <Suspense
      fallback={
        visible ? (
          <div className={className ?? 'size-full min-h-0 min-w-0 overflow-hidden'}>
            <AppLoadingState {...scene} />
          </div>
        ) : null
      }
    >
      {children}
    </Suspense>
  );
}
