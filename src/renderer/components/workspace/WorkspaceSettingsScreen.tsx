import { SettingsScreen } from '@/renderer/components/app/SettingsScreen';
import { activeNavigationEntry } from '@/renderer/components/workspace/workspace-state';
import type { WorkspaceTabSurfaceProps } from '@/renderer/components/workspace/WorkspaceTabSurface';
import { ContentManagementScreen } from '@/renderer/features/content-management/ContentManagementScreen';

type Props = Pick<
  WorkspaceTabSurfaceProps,
  | 'tab'
  | 'visible'
  | 'active'
  | 'defaultPromptLocale'
  | 'onPromptLocaleChange'
  | 'onNewTab'
  | 'onCommitLocation'
  | 'onGoBack'
  | 'refresh'
  | 'notify'
>;

export function WorkspaceSettingsScreen(props: Props) {
  const { tab, visible = props.active } = props;
  const location = activeNavigationEntry(tab).location;
  return (
    <SettingsScreen
      promptLocale={props.defaultPromptLocale}
      onPromptLocaleChange={props.onPromptLocaleChange}
      onAiFeatureModelsOpen={() =>
        props.onNewTab(tab.id, {
          ...location,
          view: 'aiCenter',
          aiCenter: { tab: 'capabilities', recordId: null },
        })
      }
      onContentManagementOpen={() =>
        props.onCommitLocation(tab.id, (current) => ({ ...current, view: 'contentManagement' }))
      }
      onSettingsOpen={() => props.onCommitLocation(tab.id, (current) => ({ ...current, view: 'settings' }))}
      contentManagement={
        location.view === 'contentManagement' ? (
          <ContentManagementScreen
            embedded
            active={visible}
            canNavigateBack={tab.history.index > 0}
            onNavigateBack={() => props.onGoBack(tab.id)}
            onContentChange={props.refresh}
            notify={props.notify}
          />
        ) : undefined
      }
    />
  );
}
