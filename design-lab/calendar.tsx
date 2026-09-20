import { StrictMode, useState } from 'react';
import {
  calendarViewSaveSchema,
  calendarViewDeleteSchema,
  calendarViewSchema,
  type CalendarView,
} from '@/shared/calendar-views';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import type { BootstrapDto } from '@/shared/contracts';
import { calendarPreferencesSchema, type CalendarApi, type CalendarPreferences } from '@/shared/contracts/calendar';
import { createCalendarDemoApi } from './calendar-demo-data';
import {
  calendarUsageQuerySchema,
  calendarUsageResultSchema,
  calendarUsageRunsQuerySchema,
  calendarUsageRunsResultSchema,
  calendarUsageSourceValues,
  type CalendarUsageQuery,
  type CalendarUsageRun,
  type CalendarUsageRunsQuery,
  type CalendarUsageSource,
  type CalendarUsageTotals,
} from '@/shared/calendar-usage';
import { I18nContext } from '@/renderer/i18n/I18nContext';
import { hydrateLanguageCatalog } from '@/renderer/i18n/languageCatalog';
import { enMessages } from '@/renderer/i18n/locales/en';
import zhMessages from '../extensions/com.aiy.language.zh-cn/messages.json';
import CalendarScreen from '@/renderer/features/calendar/CalendarScreen';
import { dateInTimeZone } from '@/renderer/features/calendar/calendarDates';
import './style.css';

// Synthetic, in-memory component workbench. No real library, account or provider access.
const locale = new URLSearchParams(location.search).get('locale') === 'en' ? 'en' : 'zh';
const label = (zh: string, en: string) => (locale === 'zh' ? zh : en);
const now = new Date().toISOString();
const today = dateInTimeZone(now, 'Asia/Shanghai');
const ago = (days: number) => new Date(Date.parse(now) - days * 86_400_000).toISOString();
let preferences: CalendarPreferences = calendarPreferencesSchema.parse({
  timeZone: 'Asia/Shanghai',
  categories: ['content', 'organization', 'knowledge', 'ai', 'delivery', 'workspace', 'other'],
  showInvalidated: false,
  timeAxis: 'effective',
  showUsage: true,
  usageMetric: 'calls',
  usageSource: 'all',
  weekStartsOn: 1,
});
const cursorSchema = z
  .object({ key: z.string(), offset: z.number().int().nonnegative(), version: z.number().int().nonnegative() })
  .strict();
const encodeCursor = (value: z.infer<typeof cursorSchema>) => btoa(JSON.stringify(value));
function offsetFor(raw: string | undefined, key: string, version: number) {
  if (!raw) return 0;
  let cursor: z.infer<typeof cursorSchema>;
  try {
    cursor = cursorSchema.parse(JSON.parse(atob(raw)));
  } catch {
    throw new Error('CALENDAR_CURSOR_INVALID');
  }
  if (cursor.key !== key) throw new Error('CALENDAR_CURSOR_INVALID');
  if (cursor.version !== version) throw new Error('CALENDAR_CURSOR_STALE');
  return cursor.offset;
}
const tokenKeys = [
  'knownInputTokens',
  'knownCachedInputTokens',
  'knownOutputTokens',
  'knownReasoningOutputTokens',
  'knownTotalTokens',
] as const;
const emptyTotals: CalendarUsageTotals = {
  runCount: 0,
  failedRunCount: 0,
  activeRunCount: 0,
  notStartedRunCount: 0,
  usageKnownRunCount: 0,
  usageMissingRunCount: 0,
  usagePartialRunCount: 0,
  knownInputTokens: null,
  knownCachedInputTokens: null,
  knownOutputTokens: null,
  knownReasoningOutputTokens: null,
  knownTotalTokens: null,
};
function makeRun(patch: Partial<CalendarUsageRun> & Pick<CalendarUsageRun, 'source' | 'runId' | 'originalRun'>) {
  return calendarUsageRunsResultSchema.shape.runs.element.parse({
    requestedModel: 'demo-model',
    observedModel: null,
    date: today,
    startedAt: now,
    finishedAt: now,
    status: 'SUCCEEDED',
    target: null,
    targetBasis: 'UNASSIGNED',
    usageState: 'MISSING',
    knownInputTokens: null,
    knownCachedInputTokens: null,
    knownOutputTokens: null,
    knownReasoningOutputTokens: null,
    knownTotalTokens: null,
    notes: [],
    ...patch,
  });
}
// Two distinct source objects intentionally share a title. The fifth run records measured zero.
const sampleRuns: CalendarUsageRun[] = [
  makeRun({
    source: 'VIDEO_DOCUMENT_GENERATION',
    runId: 'demo-video-1',
    originalRun: { type: 'VIDEO_DOCUMENT_GENERATION_RUN', id: 'demo-video-1' },
    target: { type: 'VIDEO_DOCUMENT', id: 'video-rose-a' },
    targetBasis: 'RUN_SCOPE',
    requestedModel: 'demo-route',
    observedModel: 'demo-model',
    usageState: 'KNOWN',
    knownInputTokens: 1000,
    knownCachedInputTokens: 600,
    knownOutputTokens: 250,
    knownReasoningOutputTokens: 100,
    knownTotalTokens: 1250,
    notes: ['MULTI_STAGE_SUBTOTAL'],
  }),
  makeRun({
    source: 'VIDEO_TRANSLATION',
    runId: 'demo-translation-1',
    originalRun: { type: 'VIDEO_DOCUMENT_TRANSLATION_RUN', id: 'demo-translation-1' },
    target: { type: 'VIDEO_DOCUMENT', id: 'video-rose-b' },
    targetBasis: 'RUN_SCOPE',
    status: 'FAILED',
    usageState: 'PARTIAL',
    knownInputTokens: 300,
    notes: ['MULTI_STAGE_SUBTOTAL'],
  }),
  makeRun({
    source: 'IMAGE_GENERATION',
    runId: 'demo-image-1',
    originalRun: { type: 'GENERATION_RUN', id: 'demo-image-1' },
    target: { type: 'PROMPT_SERIES', id: 'demo-prompt' },
    targetBasis: 'PROMPT_VERSION_SCOPE',
    notes: ['TOKENS_NOT_STORED', 'REQUESTED_ROUTE_ONLY'],
  }),
  makeRun({
    source: 'AGENT_CHAT',
    runId: 'demo-agent-1',
    originalRun: { type: 'AI_PROCESS', id: 'demo-agent-1' },
    requestedModel: null,
    notes: ['THREAD_TOTALS_NOT_ATTRIBUTABLE', 'MODEL_NOT_RECORDED', 'TARGET_NOT_RECORDED'],
  }),
  makeRun({
    source: 'VIDEO_DOCUMENT_GENERATION',
    runId: 'demo-video-zero',
    originalRun: { type: 'VIDEO_DOCUMENT_GENERATION_RUN', id: 'demo-video-zero' },
    target: { type: 'VIDEO_DOCUMENT', id: 'video-rose-a' },
    targetBasis: 'RUN_SCOPE',
    requestedModel: 'demo-route',
    observedModel: 'demo-model',
    usageState: 'KNOWN',
    knownInputTokens: 0,
    knownCachedInputTokens: 0,
    knownOutputTokens: 0,
    knownReasoningOutputTokens: 0,
    knownTotalTokens: 0,
  }),
];
const usageSnapshot = 'c'.repeat(64);
// Enough retained run headers to exercise the component's real 50-row continuation.
for (let index = 1; index <= 51; index += 1) {
  const runId = `demo-check-${String(index).padStart(2, '0')}`;
  sampleRuns.push(
    makeRun({
      source: 'ARTICLE_CHECK',
      runId,
      originalRun: { type: 'ARTICLE_CHECK_RUN', id: runId },
      target: { type: 'ARTICLE', id: 'rose' },
      targetBasis: 'RUN_SCOPE',
      notes: ['TOKENS_NOT_STORED', 'REQUESTED_ROUTE_ONLY'],
    }),
  );
}
function selectRuns(input: CalendarUsageQuery | CalendarUsageRunsQuery) {
  if (input.snapshot && input.snapshot !== usageSnapshot) throw new Error('CALENDAR_USAGE_CURSOR_STALE');
  return sampleRuns
    .map((run) => ({ ...run, date: dateInTimeZone(run.startedAt, input.timeZone) }))
    .filter(
      (run) =>
        input.startDate <= run.date &&
        run.date <= input.endDate &&
        (!input.sources || input.sources.includes(run.source)) &&
        (input.model === undefined ||
          input.model === (input.modelAttribution === 'OBSERVED' ? run.observedModel : run.requestedModel)) &&
        (input.target === undefined ||
          (input.target === null
            ? run.target === null
            : input.target.type === run.target?.type && input.target.id === run.target.id)),
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.runId.localeCompare(a.runId));
}
function totalsFor(runs: CalendarUsageRun[]) {
  const totals = { ...emptyTotals };
  for (const run of runs) {
    totals.runCount += 1;
    totals.failedRunCount += Number(['FAILED', 'CANCELLED', 'INTERRUPTED'].includes(run.status));
    totals.activeRunCount += Number(['RUNNING', 'QUEUED'].includes(run.status));
    totals.notStartedRunCount += Number(['NOT_STARTED', 'BLOCKED'].includes(run.status));
    totals.usageKnownRunCount += Number(run.usageState !== 'MISSING');
    totals.usageMissingRunCount += Number(run.usageState === 'MISSING');
    totals.usagePartialRunCount += Number(run.usageState === 'PARTIAL');
    for (const key of tokenKeys) if (run[key] !== null) totals[key] = (totals[key] ?? 0) + run[key];
  }
  return totals;
}
function groupsOf(runs: CalendarUsageRun[], key: (run: CalendarUsageRun) => string) {
  const groups = new Map<string, CalendarUsageRun[]>();
  for (const run of runs) groups.set(key(run), [...(groups.get(key(run)) ?? []), run]);
  return [...groups.values()];
}
function usageCoverage(sources: readonly CalendarUsageSource[], all: CalendarUsageRun[], selected = all) {
  return {
    scope: 'LOCAL_LIBRARY_RUNS',
    tokenSemantics: 'KNOWN_SUBTOTAL',
    billing: 'NOT_AVAILABLE',
    externalSessions: 'NOT_READ',
    historicalUnobservedChats: 'NOT_INCLUDED',
    sources: sources.map((source) => ({
      source,
      available: true,
      includedRunCount: selected.filter((run) => run.source === source).length,
      truncated:
        all.filter((run) => run.source === source).length > selected.filter((run) => run.source === source).length,
      notes: [...new Set(all.filter((run) => run.source === source).flatMap((run) => run.notes))],
    })),
  };
}
function sampleUsage(raw: CalendarUsageQuery) {
  const input = calendarUsageQuerySchema.parse(raw);
  const all = selectRuns(input);
  const sources = [...new Set(input.sources ?? calendarUsageSourceValues)];
  const limit = input.limitPerSource ?? 2000;
  const selected = sources.flatMap((source) => all.filter((run) => run.source === source).slice(0, limit));
  const models = (run: CalendarUsageRun) => JSON.stringify([run.source, run.requestedModel, run.observedModel]);
  return calendarUsageResultSchema.parse({
    startDate: input.startDate,
    endDate: input.endDate,
    timeZone: input.timeZone,
    attribution: 'RUN_START',
    snapshot: usageSnapshot,
    totals: totalsFor(selected),
    days: groupsOf(selected, (run) => run.date).map((group) => ({ ...totalsFor(group), date: group[0].date })),
    models: groupsOf(selected, models).map((group) => ({
      ...totalsFor(group),
      source: group[0].source,
      requestedModel: group[0].requestedModel,
      observedModel: group[0].observedModel,
    })),
    groups: groupsOf(selected, (run) => JSON.stringify([run.date, models(run), run.target])).map((group) => ({
      ...totalsFor(group),
      date: group[0].date,
      source: group[0].source,
      requestedModel: group[0].requestedModel,
      observedModel: group[0].observedModel,
      target: group[0].target,
    })),
    targets: groupsOf(selected, (run) => JSON.stringify(run.target)).map((group) => ({
      ...totalsFor(group),
      target: group[0].target,
      title: group[0].target ? label('玫瑰教程', 'Rose tutorial') : '',
      titleBasis: group[0].target ? 'CURRENT' : 'UNAVAILABLE',
      available: group[0].target !== null,
      navigateTo: group[0].target?.type === 'VIDEO_DOCUMENT' ? group[0].target : null,
    })),
    groupsTruncated: false,
    targetsTruncated: false,
    coverage: { ...usageCoverage(sources, all, selected), limitPerSource: limit },
    truncated: selected.length < all.length,
  });
}
function assertSpace(spaceId: string) {
  if (spaceId !== 'calendar-demo') throw new Error('CALENDAR_SPACE_CHANGED');
}
const namedViews = new Map<string, CalendarView>();
const api: CalendarApi = {
  async listViews(spaceId) {
    assertSpace(spaceId);
    return [...namedViews.values()];
  },
  async saveView(raw, spaceId) {
    assertSpace(spaceId);
    const input = calendarViewSaveSchema.parse(raw);
    const current = input.id ? namedViews.get(input.id) : undefined;
    if (input.id && current?.revision !== input.expectedRevision) throw new Error('CALENDAR_VIEW_REVISION_CONFLICT');
    if (!current && namedViews.size >= 50) throw new Error('CALENDAR_VIEW_LIMIT');
    const name = input.name.normalize('NFKC').trim();
    if ([...namedViews.values()].some((view) => view.id !== input.id && view.name.toLowerCase() === name.toLowerCase()))
      throw new Error('CALENDAR_VIEW_NAME_EXISTS');
    const at = new Date().toISOString();
    const view = calendarViewSchema.parse({
      id: current?.id ?? crypto.randomUUID(),
      name,
      preferences: input.preferences,
      revision: (current?.revision ?? 0) + 1,
      createdAt: current?.createdAt ?? at,
      updatedAt: at,
    });
    namedViews.set(view.id, view);
    return view;
  },
  async deleteView(raw, spaceId) {
    assertSpace(spaceId);
    const input = calendarViewDeleteSchema.parse(raw);
    if (namedViews.get(input.id)?.revision !== input.expectedRevision)
      throw new Error('CALENDAR_VIEW_REVISION_CONFLICT');
    namedViews.delete(input.id);
    return { deleted: true };
  },
  ...createCalendarDemoApi(today, label),
  async getPreferences(spaceId) {
    assertSpace(spaceId);
    return preferences;
  },
  async savePreferences(input, spaceId) {
    assertSpace(spaceId);
    preferences = calendarPreferencesSchema.parse(input);
    return preferences;
  },
  async usage(input, spaceId) {
    assertSpace(spaceId);
    return sampleUsage(input);
  },
  async usageRuns(raw, spaceId) {
    assertSpace(spaceId);
    const input = calendarUsageRunsQuerySchema.parse(raw);
    const { cursor, limit = 50, ...filter } = input;
    const key = JSON.stringify(filter);
    const all = selectRuns(input);
    let offset: number;
    try {
      offset = offsetFor(cursor, key, 0);
    } catch (error) {
      throw new Error(
        String(error).includes('STALE') ? 'CALENDAR_USAGE_CURSOR_STALE' : 'CALENDAR_USAGE_CURSOR_INVALID',
      );
    }
    const runs = all.slice(offset, offset + limit);
    const hasMore = offset + runs.length < all.length;
    return calendarUsageRunsResultSchema.parse({
      startDate: input.startDate,
      endDate: input.endDate,
      timeZone: input.timeZone,
      attribution: 'RUN_START',
      snapshot: usageSnapshot,
      runs,
      hasMore,
      nextCursor: hasMore ? encodeCursor({ key, offset: offset + runs.length, version: 0 }) : null,
      coverage: usageCoverage([...new Set(input.sources ?? calendarUsageSourceValues)], all),
    });
  },
};
Object.defineProperty(window, 'desktopApi', {
  configurable: true,
  value: { calendar: api },
});
const data: BootstrapDto = {
  locale,
  spaceId: 'calendar-demo',
  spaceName: 'Calendar workbench',
  spaceCoverUrl: null,
  workspaceLayout: null,
  series: [],
  albums: [],
  terms: [],
  categories: [],
  facets: [],
  wordPalettes: [],
  canvasPresets: [],
  imageGenerationRoutes: [],
  generationTasks: [],
  assistantRuns: [],
  creationItems: [],
  styleExplorationBatches: [],
  agentTasks: [],
  libraryEmpty: false,
  creationDraft: null,
  codex: { state: 'unavailable', version: '', authenticated: false, message: 'Synthetic workbench' },
  modelWorker: { state: 'CONNECTED', workerId: null, generationTaskCount: 0, codexTaskCount: 0 },
  articles: [
    {
      id: 'rose',
      albumId: null,
      sourceInspirationStashId: null,
      content: {
        schemaVersion: 1,
        title: label('玫瑰教程', 'Rose tutorial'),
        markdown: '',
        mediaBindings: [],
        mediaAssets: [],
        coverAssetId: null,
      },
      contentHash: 'a'.repeat(64),
      revisionId: 'demo-article-revision',
      revisionNo: 1,
      elements: [],
      comments: [],
      status: 'ACTIVE',
      createdAt: ago(2),
      updatedAt: now,
    },
  ],
};
function Workbench() {
  const [message, setMessage] = useState('');
  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      <div className="border-b border-border px-5 py-2 text-xs text-muted-foreground">
        {label('日历组件工作台 · 合成动态数据', 'Calendar workbench · synthetic activity data')}
        {message ? ` · ${message}` : ''}
      </div>
      <div className="min-h-0 flex-1">
        <CalendarScreen
          active
          spaceId="calendar-demo"
          data={data}
          dataRevision={0}
          notify={setMessage}
          onOpenLocation={() => setMessage(label('打开玫瑰教程', 'Open the rose tutorial'))}
        />
      </div>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nContext.Provider
      value={{
        locale,
        setLocale: (value) => {
          location.search = '?locale=' + value;
        },
        messages: hydrateLanguageCatalog(locale === 'zh' ? zhMessages : {}, enMessages),
        availableLocales: ['zh', 'en'],
      }}
    >
      <Workbench />
    </I18nContext.Provider>
  </StrictMode>,
);
