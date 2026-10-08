import type { AppLocation, HistoryNavigationGuard, NavigationMode } from '@/renderer/components/app/app-navigation';
import type { WorkspaceRuntimeGroup, WorkspaceRuntimeTab } from '@/renderer/components/workspace/workspace-state';
import { activeNavigationEntry } from '@/renderer/components/workspace/workspace-state';
import { WorkspaceTabStrip } from '@/renderer/components/workspace/WorkspaceTabStrip';
import { WorkspaceHeader, WorkspaceHeaderTabScope } from '@/renderer/components/workspace/WorkspaceHeader';
import {
  WorkspaceTabSurface,
  type WorkspaceTabSurfaceProps,
} from '@/renderer/components/workspace/WorkspaceTabSurface';
import type { CodexImagesNavigationState } from '@/renderer/features/extensions/codexImageNavigation';
import type { TransitionShowcaseNavigationState } from '@/renderer/features/extensions/transitionShowcaseNavigation';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { useWorkspaceGroupPresentation } from '@/renderer/components/workspace/useWorkspaceGroupPresentation';
import { workspaceTabFocusSurfaces } from '@/renderer/commands/shortcut-context';
import type {
  BootstrapDto,
  ImportedCreationOutputDto,
  IntakeCommitResult,
  Locale,
  TransitionPreviewDto,
  WorkspaceArticleEditorStateDto,
} from '@/shared/contracts';
import { memo, useRef, type ComponentProps, type FocusEvent } from 'react';

type TabSurfaceProps = ComponentProps<typeof WorkspaceTabSurface>;
const MemoizedWorkspaceTabSurface = memo(WorkspaceTabSurface);
const maxMountedTabsPerGroup = 3;

interface Props {
  group: WorkspaceRuntimeGroup;
  active: boolean;
  tabsVisible: boolean;
  data: BootstrapDto;
  dataRevision: number;
  locale: Locale;
  defaultPromptLocale: Locale | null;
  comparisonFullWindow: boolean;
  creationPromptFullWindow: boolean;
  loadingPreviews: readonly TransitionPreviewDto[];
  codexImagesNavigation: CodexImagesNavigationState;
  transitionShowcaseNavigation: TransitionShowcaseNavigationState;
  documentNavigationRevision: number;
  articleEditorStates: readonly WorkspaceArticleEditorStateDto[];
  onArticleEditorStateChange: WorkspaceTabSurfaceProps['onArticleEditorStateChange'];
  onArticleLocationChange: WorkspaceTabSurfaceProps['onArticleLocationChange'];
  onArticleLocationNavigate: WorkspaceTabSurfaceProps['onArticleLocationNavigate'];
  onLocationFlushChange: WorkspaceTabSurfaceProps['onLocationFlushChange'];
  onTabsCollapsedChange(collapsed: boolean): void;
  onActivateGroup(): void;
  onActivateTab(tabId: string): void;
  onCloseTab(tabId: string, committed?: () => void): void;
  onCloseOtherTabs(tabId: string): void;
  onReorderTab(tabId: string, delta: -1 | 1): void;
  onNewTab(sourceTabId: string, destination: AppLocation['view'] | AppLocation): void;
  onOpenBeside(sourceTabId: string, destination: AppLocation['view'] | AppLocation): void;
  splitAxis: 'columns' | 'rows' | null;
  splitPosition: 'start' | 'end';
  onMergeGroups(): void;
  onMoveTabToOtherGroup(tabId: string): void;
  onSplit(sourceTabId: string, axis: 'columns' | 'rows'): void;
  onReset(): void;
  onCommitLocation(
    tabId: string,
    destination: AppLocation | ((current: AppLocation) => AppLocation),
    mode?: NavigationMode,
  ): void;
  onGoBack(tabId: string): void;
  onHistoryNavigationGuardChange(tabId: string, guard: HistoryNavigationGuard | null): void;
  onComparisonFullWindowChange(open: boolean): void;
  onCreationPromptFullWindowChange(open: boolean): void;
  onCreatorActiveAlbumChange: TabSurfaceProps['onCreatorActiveAlbumChange'];
  onGalleryActiveAlbumChange: TabSurfaceProps['onGalleryActiveAlbumChange'];
  refresh: TabSurfaceProps['refresh'];
  refreshAlbums: TabSurfaceProps['refreshAlbums'];
  onTermDetailsRequest: TabSurfaceProps['onTermDetailsRequest'];
  onImportedOutputSaved(output: ImportedCreationOutputDto): void;
  onArticleSaved: TabSurfaceProps['onArticleSaved'];
  onSocialPostSaved: TabSurfaceProps['onSocialPostSaved'];
  onApplyIntakeResult(result: IntakeCommitResult): void;
  onVideoDocumentsChange(): void;
  onRetryGeneration(runId: string): Promise<void>;
  notify(message: string): void;
}

function activateFocusedWorkspaceGroup(event: FocusEvent<HTMLDivElement>, onActivateGroup: () => void) {
  onActivateGroup();
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const pane = target.closest<HTMLElement>('[data-workspace-tab-id], [data-workspace-sidebar-tab-id]');
  if (!pane || !event.currentTarget.contains(pane)) return;
  const tabId = pane.dataset.workspaceTabId ?? pane.dataset.workspaceSidebarTabId;
  if (!tabId) return;
  for (const surface of workspaceTabFocusSurfaces(event.currentTarget, tabId)) {
    surface.querySelector('[data-workspace-last-focus]')?.removeAttribute('data-workspace-last-focus');
  }
  target.setAttribute('data-workspace-last-focus', 'true');
}

function WorkspaceTabSession({
  tab,
  visible,
  tabsVisible,
  ...props
}: Omit<WorkspaceTabSurfaceProps, 'tab'> & { tab: WorkspaceRuntimeTab; visible: boolean; tabsVisible: boolean }) {
  const onArticleEditorStateChange = useStableCallback(props.onArticleEditorStateChange);
  const onArticleLocationChange = useStableCallback(props.onArticleLocationChange);
  const onArticleLocationNavigate = useStableCallback(props.onArticleLocationNavigate);
  const onLocationFlushChange = useStableCallback(props.onLocationFlushChange);
  const onNewTab = useStableCallback(props.onNewTab);
  const onOpenBeside = useStableCallback(props.onOpenBeside);
  const onCommitLocation = useStableCallback(props.onCommitLocation);
  const onGoBack = useStableCallback(props.onGoBack);
  const onHistoryNavigationGuardChange = useStableCallback(props.onHistoryNavigationGuardChange);
  const onComparisonFullWindowChange = useStableCallback(props.onComparisonFullWindowChange);
  const onCreationPromptFullWindowChange = useStableCallback(props.onCreationPromptFullWindowChange);
  const onCreatorActiveAlbumChange = useStableCallback(props.onCreatorActiveAlbumChange);
  const onGalleryActiveAlbumChange = useStableCallback(props.onGalleryActiveAlbumChange);
  const refresh = useStableCallback(props.refresh);
  const refreshAlbums = useStableCallback(props.refreshAlbums);
  const onTermDetailsRequest = useStableCallback(async () => props.onTermDetailsRequest?.());
  const onImportedOutputSaved = useStableCallback(props.onImportedOutputSaved);
  const onArticleSaved = useStableCallback(props.onArticleSaved);
  const onSocialPostSaved = useStableCallback(props.onSocialPostSaved);
  const onApplyIntakeResult = useStableCallback(props.onApplyIntakeResult);
  const onVideoDocumentsChange = useStableCallback(props.onVideoDocumentsChange);
  const onRetryGeneration = useStableCallback(props.onRetryGeneration);
  const notify = useStableCallback(props.notify);

  return (
    <div
      id={`workspace-panel-${tab.id}`}
      role="tabpanel"
      aria-labelledby={tabsVisible ? `workspace-tab-${tab.id}` : undefined}
      data-workspace-tab-id={tab.id}
      className={visible ? 'absolute inset-0 z-10 min-h-0 min-w-0 overflow-hidden' : 'hidden'}
      aria-hidden={!visible}
      inert={!visible}
    >
      <MemoizedWorkspaceTabSurface
        {...props}
        visible={visible}
        tab={tab}
        onArticleEditorStateChange={onArticleEditorStateChange}
        onArticleLocationChange={onArticleLocationChange}
        onArticleLocationNavigate={onArticleLocationNavigate}
        onLocationFlushChange={onLocationFlushChange}
        onNewTab={onNewTab}
        onOpenBeside={onOpenBeside}
        onCommitLocation={onCommitLocation}
        onGoBack={onGoBack}
        onHistoryNavigationGuardChange={onHistoryNavigationGuardChange}
        onComparisonFullWindowChange={onComparisonFullWindowChange}
        onCreationPromptFullWindowChange={onCreationPromptFullWindowChange}
        onCreatorActiveAlbumChange={onCreatorActiveAlbumChange}
        onGalleryActiveAlbumChange={onGalleryActiveAlbumChange}
        refresh={refresh}
        refreshAlbums={refreshAlbums}
        onTermDetailsRequest={props.onTermDetailsRequest ? onTermDetailsRequest : undefined}
        onImportedOutputSaved={onImportedOutputSaved}
        onArticleSaved={onArticleSaved}
        onSocialPostSaved={onSocialPostSaved}
        onApplyIntakeResult={onApplyIntakeResult}
        onVideoDocumentsChange={onVideoDocumentsChange}
        onRetryGeneration={onRetryGeneration}
        notify={notify}
      />
    </div>
  );
}

export function AppWorkspaceGroup({
  group,
  active,
  tabsVisible,
  onTabsCollapsedChange,
  onActivateGroup,
  onActivateTab,
  onCloseTab,
  onCloseOtherTabs,
  onReorderTab,
  onNewTab,
  onOpenBeside,
  splitAxis,
  splitPosition,
  onMergeGroups,
  onMoveTabToOtherGroup,
  onSplit,
  onReset,
  ...surfaceProps
}: Props) {
  const collapsed = tabsVisible && Boolean(splitAxis && group.tabsCollapsed);
  const contentVisible = useWorkspaceGroupPresentation(collapsed);
  const mountedTabIdsRef = useRef<string[]>([]);
  const availableTabIds = new Set(group.tabs.map((tab) => tab.id));
  mountedTabIdsRef.current = [
    group.activeTabId,
    ...mountedTabIdsRef.current.filter((tabId) => tabId !== group.activeTabId && availableTabIds.has(tabId)),
  ].slice(0, maxMountedTabsPerGroup);
  const mountedTabIds = new Set(mountedTabIdsRef.current);
  const mountedTabs = group.tabs.filter((tab) => mountedTabIds.has(tab.id));
  const entry = activeNavigationEntry(mountedTabs.find((tab) => tab.id === group.activeTabId)!);

  return (
    <div
      data-workspace-group-id={group.id}
      data-workspace-group-collapsed={collapsed}
      className="relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
      onPointerDownCapture={collapsed ? undefined : onActivateGroup}
      onFocusCapture={(event) => {
        if (!collapsed) activateFocusedWorkspaceGroup(event, onActivateGroup);
      }}
    >
      <WorkspaceHeader
        tabId={group.activeTabId}
        mountedTabIds={mountedTabIdsRef.current}
        enabled={tabsVisible && !collapsed}
        navigationKey={`${group.activeTabId}:${entry.id}:${entry.location.view}`}
        surfaceKey={`${group.activeTabId}:${entry.location.view}`}
        strip={
          tabsVisible && (
            <WorkspaceTabStrip
              data={surfaceProps.data}
              group={group}
              active={active}
              collapsed={collapsed}
              onTabsCollapsedChange={onTabsCollapsedChange}
              onActivate={onActivateTab}
              onClose={onCloseTab}
              onCloseOthers={onCloseOtherTabs}
              onReorder={onReorderTab}
              onNewTab={(destination) => onNewTab(group.activeTabId, destination)}
              onOpenBeside={(view) => onOpenBeside(group.activeTabId, view)}
              splitAxis={splitAxis}
              splitPosition={splitPosition}
              onMerge={onMergeGroups}
              onMoveToOtherGroup={onMoveTabToOtherGroup}
              onSplit={(axis) => onSplit(group.activeTabId, axis)}
              onReset={onReset}
            />
          )
        }
      >
        <div
          data-workspace-group-body
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          aria-hidden={collapsed}
          inert={collapsed}
        >
          <div
            id={`workspace-group-content-${group.id}`}
            className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
            aria-hidden={collapsed}
            inert={collapsed}
          >
            <div>
              {mountedTabs.map((tab) => {
                const visible = contentVisible && tab.id === group.activeTabId;
                return (
                  <WorkspaceHeaderTabScope key={tab.id} tabId={tab.id}>
                    <WorkspaceTabSession
                      key={tab.id}
                      {...surfaceProps}
                      tab={tab}
                      active={active && !collapsed && visible}
                      visible={visible}
                      tabsVisible={tabsVisible}
                      onNewTab={onNewTab}
                      onOpenBeside={onOpenBeside}
                    />
                  </WorkspaceHeaderTabScope>
                );
              })}
            </div>
          </div>
        </div>
      </WorkspaceHeader>
    </div>
  );
}
