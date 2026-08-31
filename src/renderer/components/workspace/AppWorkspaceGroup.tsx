import { memo, useRef, type ComponentProps, type FocusEvent } from 'react';
import type {
  BootstrapDto,
  ImportedCreationOutputDto,
  IntakeCommitResult,
  Locale,
  TransitionPreviewDto,
  WorkspaceArticleEditOwnerDto,
  WorkspaceArticleEditorStateDto,
} from '@/shared/contracts';
import type { AppLocation, HistoryNavigationGuard, NavigationMode } from '@/renderer/components/app/app-navigation';
import type { CodexImagesNavigationState } from '@/renderer/features/extensions/codexImageNavigation';
import type { TransitionShowcaseNavigationState } from '@/renderer/features/extensions/transitionShowcaseNavigation';
import type { WorkspaceRuntimeGroup, WorkspaceRuntimeTab } from '@/renderer/components/workspace/workspace-state';
import { WorkspaceTabStrip } from '@/renderer/components/workspace/WorkspaceTabStrip';
import {
  WorkspaceTabSurface,
  type WorkspaceTabSurfaceProps,
} from '@/renderer/components/workspace/WorkspaceTabSurface';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

type TabSurfaceProps = ComponentProps<typeof WorkspaceTabSurface>;
const MemoizedWorkspaceTabSurface = memo(WorkspaceTabSurface);

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
  articleEditOwners: readonly WorkspaceArticleEditOwnerDto[];
  onArticleEditorStateChange: WorkspaceTabSurfaceProps['onArticleEditorStateChange'];
  onArticleLocationChange: WorkspaceTabSurfaceProps['onArticleLocationChange'];
  onArticleLocationNavigate: WorkspaceTabSurfaceProps['onArticleLocationNavigate'];
  onRequestEditOwnership: WorkspaceTabSurfaceProps['onRequestEditOwnership'];
  onLocationFlushChange: WorkspaceTabSurfaceProps['onLocationFlushChange'];
  onActivateGroup(): void;
  onActivateTab(tabId: string): void;
  onCloseTab(tabId: string): void;
  onCloseOtherTabs(tabId: string): void;
  onReorderTab(tabId: string, delta: -1 | 1): void;
  onNewTab(sourceTabId: string, destination: AppLocation['view'] | AppLocation): void;
  onOpenBeside(sourceTabId: string, view: AppLocation['view']): void;
  split: boolean;
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
  onApplyIntakeResult(result: IntakeCommitResult): void;
  onVideoDocumentsChange(): void;
  onRetryGeneration(runId: string): Promise<void>;
  notify(message: string): void;
}

function activateFocusedWorkspaceGroup(event: FocusEvent<HTMLDivElement>, onActivateGroup: () => void) {
  onActivateGroup();
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  event.currentTarget
    .querySelector<HTMLElement>('[data-workspace-last-focus]')
    ?.removeAttribute('data-workspace-last-focus');
  target.setAttribute('data-workspace-last-focus', 'true');
}

function WorkspaceTabSession({
  tab,
  visible,
  ...props
}: Omit<WorkspaceTabSurfaceProps, 'tab'> & { tab: WorkspaceRuntimeTab; visible: boolean }) {
  const onArticleEditorStateChange = useStableCallback(props.onArticleEditorStateChange);
  const onArticleLocationChange = useStableCallback(props.onArticleLocationChange);
  const onArticleLocationNavigate = useStableCallback(props.onArticleLocationNavigate);
  const onRequestEditOwnership = useStableCallback(props.onRequestEditOwnership);
  const onLocationFlushChange = useStableCallback(props.onLocationFlushChange);
  const onNewTab = useStableCallback(props.onNewTab);
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
  const onApplyIntakeResult = useStableCallback(props.onApplyIntakeResult);
  const onVideoDocumentsChange = useStableCallback(props.onVideoDocumentsChange);
  const onRetryGeneration = useStableCallback(props.onRetryGeneration);
  const notify = useStableCallback(props.notify);

  return (
    <div
      data-workspace-tab-id={tab.id}
      className={
        visible
          ? 'absolute inset-0 z-10 min-h-0 min-w-0 overflow-hidden opacity-100'
          : 'pointer-events-none absolute inset-0 z-0 min-h-0 min-w-0 overflow-hidden opacity-0'
      }
      aria-hidden={!visible}
      inert={!visible}
    >
      <MemoizedWorkspaceTabSurface
        {...props}
        tab={tab}
        onArticleEditorStateChange={onArticleEditorStateChange}
        onArticleLocationChange={onArticleLocationChange}
        onArticleLocationNavigate={onArticleLocationNavigate}
        onRequestEditOwnership={onRequestEditOwnership}
        onLocationFlushChange={onLocationFlushChange}
        onNewTab={onNewTab}
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
  onActivateGroup,
  onActivateTab,
  onCloseTab,
  onCloseOtherTabs,
  onReorderTab,
  onNewTab,
  onOpenBeside,
  split,
  onMergeGroups,
  onMoveTabToOtherGroup,
  onSplit,
  onReset,
  ...surfaceProps
}: Props) {
  const mountedTabIdsRef = useRef(new Set<string>());
  mountedTabIdsRef.current.add(group.activeTabId);
  const mountedTabs = group.tabs.filter((tab) => mountedTabIdsRef.current.has(tab.id));

  return (
    <div
      data-workspace-group-id={group.id}
      className="flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
      onPointerDownCapture={onActivateGroup}
      onFocusCapture={(event) => activateFocusedWorkspaceGroup(event, onActivateGroup)}
    >
      {tabsVisible && (
        <WorkspaceTabStrip
          data={surfaceProps.data}
          group={group}
          active={active}
          onActivate={onActivateTab}
          onClose={onCloseTab}
          onCloseOthers={onCloseOtherTabs}
          onReorder={onReorderTab}
          onNewTab={(destination) => onNewTab(group.activeTabId, destination)}
          onOpenBeside={(view) => onOpenBeside(group.activeTabId, view)}
          split={split}
          onMerge={onMergeGroups}
          onMoveToOtherGroup={onMoveTabToOtherGroup}
          onSplit={(axis) => onSplit(group.activeTabId, axis)}
          onReset={onReset}
        />
      )}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {mountedTabs.map((tab) => {
          const visible = tab.id === group.activeTabId;
          return (
            <WorkspaceTabSession
              key={tab.id}
              {...surfaceProps}
              tab={tab}
              active={active && visible}
              visible={visible}
              onNewTab={onNewTab}
            />
          );
        })}
      </div>
    </div>
  );
}
