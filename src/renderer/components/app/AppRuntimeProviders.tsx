import type { ReactElement } from 'react';
import { ImageVisibilityProvider } from '@/renderer/components/media/ImageVisibilityProvider';
import type { ExtensionDto, TermListItem } from '@/shared/contracts';
import { ExtensionContentLinks } from '@/renderer/features/extensions/ExtensionContentLinks';
import { GifMakerProvider } from '@/renderer/features/gif-making/GifMakerProvider';
import { CodexThreadLinkNavigation } from '@/renderer/components/app/CodexThreadLinkNavigation';
import { AssetMenuActionsProvider, type AssetMenuActions } from '@/renderer/components/media/AssetMenuActionsProvider';
import { BackgroundIssueProvider } from '@/renderer/features/background-issues/BackgroundIssueProvider';
import { ArticleDeliveryProvider } from '@/renderer/features/article-delivery/ArticleDeliveryProvider';
import { DesktopPetalLanguageBridge } from '@/renderer/features/desktop-petals/DesktopPetalLanguageBridge';
import { SpaceProfileProvider, type CreationAuthorChangeHandler } from '@/renderer/features/me/SpaceProfileProvider';
import { CreationDraftChangesProvider } from '@/renderer/components/creator/CreationDraftChanges';

interface Props {
  assetMenuActions: AssetMenuActions;
  children: ReactElement;
  spaceId: string | null;
  terms: TermListItem[];
  extensions: readonly ExtensionDto[];
  refresh(): Promise<unknown>;
  onAuthorChange: CreationAuthorChangeHandler;
}

export function AppRuntimeProviders({
  assetMenuActions,
  children,
  spaceId,
  terms,
  extensions,
  refresh,
  onAuthorChange,
}: Props) {
  return (
    <ImageVisibilityProvider key={spaceId} notify={assetMenuActions.notify}>
      <AssetMenuActionsProvider value={assetMenuActions}>
        <BackgroundIssueProvider spaceId={spaceId} refresh={refresh} notify={assetMenuActions.notify}>
          <ArticleDeliveryProvider key={spaceId} spaceId={spaceId} notify={assetMenuActions.notify}>
            <CodexThreadLinkNavigation />
            <DesktopPetalLanguageBridge />
            <GifMakerProvider
              key={spaceId}
              spaceId={spaceId}
              terms={terms}
              refresh={refresh}
              notify={assetMenuActions.notify}
            >
              <SpaceProfileProvider key={spaceId} spaceId={spaceId} onAuthorChange={onAuthorChange}>
                <CreationDraftChangesProvider spaceId={spaceId}>
                  <ExtensionContentLinks extensions={extensions}>{children}</ExtensionContentLinks>
                </CreationDraftChangesProvider>
              </SpaceProfileProvider>
            </GifMakerProvider>
          </ArticleDeliveryProvider>
        </BackgroundIssueProvider>
      </AssetMenuActionsProvider>
    </ImageVisibilityProvider>
  );
}
