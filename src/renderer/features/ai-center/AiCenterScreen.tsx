import { useEffect, useMemo, useRef, useState } from 'react';
import type { BootstrapDto, Locale } from '@/shared/contracts';
import {
  navigationLocationKey,
  type AiCenterLocation,
  type NavigationMode,
} from '@/renderer/components/app/app-navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { useI18n } from '@/renderer/i18n/useI18n';
import { AiActivityDetail } from '@/renderer/features/ai-center/AiActivityDetail';
import { AiActivityList, type AiActivityViewMode } from '@/renderer/features/ai-center/AiActivityList';
import { AiCapabilitiesView } from '@/renderer/features/ai-center/AiCapabilitiesView';
import { AiProviderConfigurationDialog } from '@/renderer/features/ai-center/AiProviderConfigurationDialog';
import { AiStatisticsView } from '@/renderer/features/ai-center/AiStatisticsView';
import { useVideoDocumentAiActivities } from '@/renderer/features/ai-center/useVideoDocumentAiActivities';
import { useArticleCheckRuns } from '@/renderer/features/ai-center/useArticleCheckRuns';
import {
  activityMatchesFilters,
  projectAiActivities,
  type AiActivityCategoryFilter,
  type AiActivityRecord,
  type AiActivityStatusFilter,
} from '@/renderer/features/ai-center/activityProjection';

interface Props {
  active: boolean;
  data: BootstrapDto;
  locale: Locale;
  location: AiCenterLocation;
  onNavigate(location: AiCenterLocation, mode?: NavigationMode): void;
  onLocate(record: AiActivityRecord): void;
  onReEditGeneration(runId: string): void;
  onManagePlugins(): void;
  onRetryGeneration(runId: string): Promise<void>;
  refresh(): Promise<void>;
  notify(message: string): void;
}

const AI_ACTIVITY_VIEW_STORAGE_KEY = 'aiy.ai-center.activity-view.v1';

function initialActivityViewMode(): AiActivityViewMode {
  try {
    return globalThis.localStorage?.getItem(AI_ACTIVITY_VIEW_STORAGE_KEY) === 'TIMELINE' ? 'TIMELINE' : 'OUTLINE';
  } catch {
    return 'OUTLINE';
  }
}

function storeActivityViewMode(mode: AiActivityViewMode) {
  try {
    globalThis.localStorage?.setItem(AI_ACTIVITY_VIEW_STORAGE_KEY, mode);
  } catch {
    // The selected mode still applies for this session when storage is unavailable.
  }
}

function canLocate(record: AiActivityRecord, data: BootstrapDto) {
  if (record.kind === 'ARTICLE_CHECK')
    return Boolean(data.articles?.some((article) => article.id === record.run.articleId));
  if (record.kind === 'VIDEO_DOCUMENT') return true;
  if (record.kind === 'ASSISTANT' && record.run.creationId) return true;
  if (record.kind === 'EXPERIMENT' && record.sourceRun?.creationId) return true;
  if (record.sourceSeries) return true;
  if (record.kind === 'GENERATION') return false;
  const scope = record.kind === 'ASSISTANT' ? record.run.scope : record.batch.scope;
  return scope.kind === 'DRAFT' && data.creationDraft?.id === scope.id;
}

export function AiCenterScreen({
  active,
  data,
  locale,
  location,
  onNavigate,
  onLocate,
  onReEditGeneration,
  onManagePlugins,
  onRetryGeneration,
  refresh,
  notify,
}: Props) {
  const l = useI18n().messages.aiCenter;
  const videoDocumentActivities = useVideoDocumentAiActivities(active, notify);
  const articleCheckRuns = useArticleCheckRuns(active, notify);
  const records = useMemo(
    () => projectAiActivities(data, videoDocumentActivities.items, articleCheckRuns.items),
    [articleCheckRuns.items, data, videoDocumentActivities.items],
  );
  const locationKey = navigationLocationKey(location);
  const appliedLocationKey = useRef(locationKey);
  const [tab, setTab] = useState<AiCenterLocation['tab']>(location.tab);
  const [activityViewMode, setActivityViewMode] = useState<AiActivityViewMode>(initialActivityViewMode);
  const [categoryFilter, setCategoryFilter] = useState<AiActivityCategoryFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<AiActivityStatusFilter>('ALL');
  const [configurationExtensionId, setConfigurationExtensionId] = useState<string | null>(null);
  const selected = records.find((record) => record.id === location.recordId) ?? null;

  function commit(next: AiCenterLocation, mode: NavigationMode = 'push') {
    appliedLocationKey.current = navigationLocationKey(next);
    onNavigate(next, mode);
  }

  useEffect(() => {
    if (!active || appliedLocationKey.current === locationKey) return;
    appliedLocationKey.current = locationKey;
    setTab(location.tab);
  }, [active, location.tab, locationKey]);

  useEffect(() => {
    if (!active || location.tab !== 'activity' || selected) return;
    const first = records.find((record) => activityMatchesFilters(record, categoryFilter, statusFilter)) ?? null;
    if (first) commit({ ...location, recordId: first.id }, 'replace');
    else if (location.recordId !== null) commit({ ...location, recordId: null }, 'replace');
  }, [active, categoryFilter, location, records, selected, statusFilter]);

  function ensureFilteredSelection(nextCategory: AiActivityCategoryFilter, nextStatus: AiActivityStatusFilter) {
    if (selected && activityMatchesFilters(selected, nextCategory, nextStatus)) return;
    const first = records.find((record) => activityMatchesFilters(record, nextCategory, nextStatus)) ?? null;
    commit({ ...location, recordId: first?.id ?? null }, 'replace');
  }

  function changeCategoryFilter(nextFilter: AiActivityCategoryFilter) {
    setCategoryFilter(nextFilter);
    ensureFilteredSelection(nextFilter, statusFilter);
  }

  function changeStatusFilter(nextFilter: AiActivityStatusFilter) {
    setStatusFilter(nextFilter);
    ensureFilteredSelection(categoryFilter, nextFilter);
  }

  async function retrySlot(slotId: string) {
    try {
      await window.desktopApi.styleExplorationRetrySlot(slotId);
      await refresh();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      notify(message);
    }
  }

  async function applyArticleCheck(runId: string) {
    const result = await window.desktopApi.articleCheckRunApply({ runId });
    await Promise.all([refresh(), articleCheckRuns.reload()]);
    notify(
      locale === 'zh'
        ? `${result.createdCommentIds.length} 条检查意见已加入评论`
        : `${result.createdCommentIds.length} check findings added as comments`,
    );
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        const nextTab = value as AiCenterLocation['tab'];
        setTab(nextTab);
        commit({ ...location, tab: nextTab });
      }}
      className="flex size-full min-h-0 flex-col bg-background"
    >
      <header className="shrink-0 border-b bg-surface px-5 pt-3">
        <div className="flex h-9 items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">{l.title}</h1>
          <span className="text-2xs tabular-nums text-muted-foreground">{l.stats.recordCount(records.length)}</span>
        </div>
        <TabsList className="h-10 gap-1 border-0">
          <TabsTrigger value="activity" className="h-10 px-4">
            {l.tabs.activity}
          </TabsTrigger>
          <TabsTrigger value="statistics" className="h-10 px-4">
            {l.tabs.statistics}
          </TabsTrigger>
          <TabsTrigger value="capabilities" className="h-10 px-4">
            {l.tabs.capabilities}
          </TabsTrigger>
        </TabsList>
      </header>
      <TabsContent value="activity" className="min-h-0 flex-1">
        <div className="grid size-full min-h-0 grid-cols-[minmax(310px,390px)_minmax(0,1fr)] max-[760px]:grid-cols-1">
          <AiActivityList
            active={active}
            records={records}
            categoryFilter={categoryFilter}
            statusFilter={statusFilter}
            viewMode={activityViewMode}
            selectedId={selected?.id ?? null}
            currentDraftId={data.creationDraft?.id ?? null}
            locale={locale}
            routes={data.imageGenerationRoutes}
            outlineContext={data}
            onCategoryFilterChange={changeCategoryFilter}
            onStatusFilterChange={changeStatusFilter}
            onViewModeChange={(mode) => {
              setActivityViewMode(mode);
              storeActivityViewMode(mode);
            }}
            onSelect={(recordId) => commit({ ...location, recordId })}
          />
          <AiActivityDetail
            record={selected}
            data={data}
            locale={locale}
            canLocate={selected ? canLocate(selected, data) : false}
            onLocate={onLocate}
            onReEditGeneration={onReEditGeneration}
            onRetryGeneration={onRetryGeneration}
            onRetrySlot={retrySlot}
            onApplyArticleCheck={applyArticleCheck}
            notify={notify}
          />
        </div>
      </TabsContent>
      <TabsContent value="statistics" className="min-h-0 flex-1">
        <AiStatisticsView
          active={active && tab === 'statistics'}
          records={records}
          routes={data.imageGenerationRoutes}
          locale={locale}
        />
      </TabsContent>
      <TabsContent value="capabilities" className="min-h-0 flex-1 overflow-hidden">
        <AiCapabilitiesView
          active={active && tab === 'capabilities'}
          data={data}
          locale={locale}
          notify={notify}
          refresh={refresh}
          onConfigure={setConfigurationExtensionId}
          onManagePlugins={onManagePlugins}
        />
      </TabsContent>
      <AiProviderConfigurationDialog
        open={Boolean(configurationExtensionId)}
        extension={(data.extensions ?? []).find((item) => item.manifest.id === configurationExtensionId) ?? null}
        locale={locale}
        notify={notify}
        onOpenChange={(open) => {
          if (!open) setConfigurationExtensionId(null);
        }}
        onChanged={refresh}
      />
    </Tabs>
  );
}

export type { AiActivityRecord } from '@/renderer/features/ai-center/activityProjection';
