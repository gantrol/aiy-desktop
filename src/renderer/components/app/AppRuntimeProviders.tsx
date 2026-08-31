import type { ReactElement } from 'react';
import { CodexThreadLinkNavigation } from '@/renderer/components/app/CodexThreadLinkNavigation';
import { AssetMenuActionsProvider, type AssetMenuActions } from '@/renderer/components/media/AssetMenuActionsProvider';
import { BackgroundIssueProvider } from '@/renderer/features/background-issues/BackgroundIssueProvider';

interface Props {
  assetMenuActions: AssetMenuActions;
  children: ReactElement;
  spaceId: string | null;
  refresh(): Promise<unknown>;
}

export function AppRuntimeProviders({ assetMenuActions, children, spaceId, refresh }: Props) {
  return (
    <AssetMenuActionsProvider value={assetMenuActions}>
      <BackgroundIssueProvider spaceId={spaceId} refresh={refresh} notify={assetMenuActions.notify}>
        <CodexThreadLinkNavigation />
        {children}
      </BackgroundIssueProvider>
    </AssetMenuActionsProvider>
  );
}
