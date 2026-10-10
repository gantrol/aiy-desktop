import { useEffect, useRef, useState } from 'react';
import { discardTablePreviews } from '@/renderer/features/browser-companion/prepareTableImagePost';
import { useTablePreviewReadiness } from '@/renderer/features/browser-companion/useTablePreviewReadiness';
import type {
  BrowserCompanionBatchItemResult,
  BrowserCompanionStageInput,
  BrowserCompanionWatermarkSelection,
} from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { MessageCatalog } from '@/renderer/i18n/types';
import { useArticleEditorSession } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { articleDeliveryRequestErrorMessage } from '@/renderer/features/article-delivery/presentation';
import {
  rememberArticleDeliveryPreferences,
  articleUploadTargetKey,
  type ArticleDeliveryPreferences,
} from '@/renderer/features/article-delivery/articleDeliveryPreferences';
import type { ArticleDeliveryTarget } from '@/renderer/features/article-delivery/articleDeliveryTargets';
import {
  prepareArticleDeliveryBatch,
  type PreparedArticleApiDelivery,
  type ArticleDeliveryProfileSelection,
} from '@/renderer/features/article-delivery/articleDeliveryBatchPreparation';

export type ArticleDeliveryBatchOutcome =
  | { kind: 'QUEUED'; jobId: string }
  | { kind: 'FAILED'; message: string; retryable?: boolean }
  | { kind: 'UNKNOWN' }
  | { kind: 'STOPPED' }
  | { kind: 'BROWSER'; receipt: BrowserCompanionBatchItemResult };

export function canRetryArticleDeliveryOutcome(outcome: ArticleDeliveryBatchOutcome) {
  if (outcome.kind === 'FAILED') return outcome.retryable === true;
  return outcome.kind === 'BROWSER' && (!outcome.receipt.result || outcome.receipt.result.handoff.state === 'ready');
}

function submissionFailure(reason: unknown, messages: MessageCatalog): ArticleDeliveryBatchOutcome {
  if (reason && typeof reason === 'object' && 'admissionRejected' in reason && reason.admissionRejected === true) {
    const spaceChanged =
      'code' in reason && ['BROWSER_COMPANION_LIBRARY_CHANGED', 'DELIVERY_SPACE_CHANGED'].includes(String(reason.code));
    const selectionChanged =
      'code' in reason && ['DELIVERY_PROFILE_CHANGED', 'DELIVERY_MODE_CHANGED'].includes(String(reason.code));
    return {
      kind: 'FAILED',
      retryable: !spaceChanged && !selectionChanged,
      message: spaceChanged
        ? messages.articleDelivery.errors.DELIVERY_SPACE_CHANGED
        : articleDeliveryRequestErrorMessage(
            reason,
            messages.articleDelivery,
            messages.articleDelivery.errors.DELIVERY_ADMISSION_REJECTED,
          ),
    };
  }
  return { kind: 'UNKNOWN' };
}

async function enqueueArticle(
  plan: PreparedArticleApiDelivery,
  messages: MessageCatalog,
  outcome: (key: string, value: ArticleDeliveryBatchOutcome) => void,
) {
  const { key, input, profile } = plan;
  try {
    if (plan.saveProfile) {
      await window.desktopApi.articleDeliveryArticleProfileSave({
        extensionId: input.extensionId,
        channelId: input.channelId,
        spaceId: input.spaceId,
        articleId: input.articleId,
        ...profile,
      });
      // Retrying admission must not overwrite subsequent profile edits.
      plan.saveProfile = false;
    }
  } catch (reason) {
    outcome(key, {
      kind: 'FAILED',
      retryable: true,
      message: articleDeliveryRequestErrorMessage(reason, messages.articleDelivery),
    });
    return false;
  }
  try {
    const job = await window.desktopApi.articleDeliveryJobEnqueue(input);
    outcome(key, { kind: 'QUEUED', jobId: job.id });
    return true;
  } catch (reason) {
    // IPC can lose a reply after admission; history establishes the result.
    outcome(key, submissionFailure(reason, messages));
    return false;
  }
}

async function stageBrowserBatches(
  browserInputs: { key: string; input: BrowserCompanionStageInput }[],
  spaceId: string,
  title: string,
  messages: MessageCatalog,
  outcome: (key: string, value: ArticleDeliveryBatchOutcome) => void,
) {
  // Each companion batch accepts one handoff per platform, so the two WeChat
  // formats require separate batches and unambiguous receipts.
  const browserBatches: (typeof browserInputs)[] = [];
  for (const plan of browserInputs) {
    const group = browserBatches.find((items) => !items.some(({ input }) => input.target === plan.input.target));
    if (group) group.push(plan);
    else browserBatches.push([plan]);
  }
  for (const browserBatch of browserBatches) {
    try {
      const batch = await window.desktopApi.browserCompanionStageBatch({
        expectedSpaceId: spaceId,
        items: browserBatch.map(({ input }) => input),
        ...(title.trim() ? { title: title.trim().slice(0, 80) } : {}),
      });
      for (const { key, input } of browserBatch) {
        const receipt = batch.items.find((item) => item.target === input.target);
        outcome(key, receipt ? { kind: 'BROWSER', receipt } : { kind: 'UNKNOWN' });
      }
      if (
        batch.items.length !== browserBatch.length ||
        batch.items.some((item) => item.errorCode || !item.result?.browserOpened || item.result.browserOpenError)
      )
        return false;
    } catch (reason) {
      for (const { key } of browserBatch) outcome(key, submissionFailure(reason, messages));
      return false;
    }
  }
  return true;
}

export function useArticleDeliveryBatch({
  articleId,
  spaceId,
  notify,
}: {
  articleId: string;
  spaceId: string;
  notify(message: string): void;
}) {
  const session = useArticleEditorSession();
  const { messages } = useI18n();
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, ArticleDeliveryBatchOutcome>>({});
  const [review, setReview] = useState<{
    preferences: ArticleDeliveryPreferences;
    title: string;
    revisionId: string;
    apiInputs: PreparedArticleApiDelivery[];
    browserInputs: { key: string; input: BrowserCompanionStageInput }[];
  } | null>(null);
  const inFlight = useRef(false);
  const sent = useRef(false);
  const alive = useRef(true);
  const apiPlans = useRef(new Map<string, PreparedArticleApiDelivery>());
  const browserPlans = useRef(new Map<string, BrowserCompanionStageInput>());
  const preparing = useRef<AbortController | null>(null);
  const previewFiles = useRef<BrowserCompanionStageInput[]>([]);
  const tablePreviews = useTablePreviewReadiness();
  const canConfirmReview = Boolean(review?.browserInputs.every((plan) => tablePreviews.ready(plan.input)));
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      preparing.current?.abort();
      if (!sent.current) discardTablePreviews(spaceId, previewFiles.current);
    };
  }, [spaceId]);

  function outcome(key: string, value: ArticleDeliveryBatchOutcome) {
    if (alive.current) setOutcomes((current) => ({ ...current, [key]: value }));
  }

  function stopBatch(pending: ReadonlySet<string>) {
    for (const key of pending) outcome(key, { kind: 'STOPPED' });
    if (alive.current) setFault(messages.publishing.batchStopped);
  }

  async function submit({
    preferences,
    definitions,
    profiles,
    watermark,
  }: {
    preferences: ArticleDeliveryPreferences;
    definitions: ReadonlyMap<string, ArticleDeliveryTarget>;
    profiles: Readonly<Record<string, ArticleDeliveryProfileSelection>>;
    watermark: BrowserCompanionWatermarkSelection;
  }) {
    if (inFlight.current || sent.current || !preferences.targets.length) return;
    inFlight.current = true;
    setBusy(true);
    setFault(null);
    setOutcomes({});
    const selected = structuredClone(preferences);
    const pending = new Set(selected.targets.map(articleUploadTargetKey));
    const selectedWatermark = structuredClone(watermark);
    const selectedProfiles = structuredClone(profiles);
    const controller = new AbortController();
    preparing.current = controller;
    try {
      if (!(await session.flush('manual'))) {
        if (alive.current) setFault(messages.publishing.saveFailed);
        return;
      }
      if (!alive.current) return;
      const article = structuredClone(session.capturePersistedArticle());
      if (article.id !== articleId) return;
      const { apiInputs, browserInputs, failures } = await prepareArticleDeliveryBatch({
        article,
        spaceId,
        preferences: selected,
        definitions,
        profiles: selectedProfiles,
        watermark: selectedWatermark,
        messages,
        signal: controller.signal,
      });
      if (!alive.current || controller.signal.aborted) {
        discardTablePreviews(
          spaceId,
          browserInputs.map((plan) => plan.input),
        );
        return;
      }
      previewFiles.current = browserInputs.map((plan) => plan.input);
      for (const [key, message] of Object.entries(failures)) {
        pending.delete(key);
        outcome(key, { kind: 'FAILED', message });
      }
      if (Object.keys(failures).length) {
        discardTablePreviews(spaceId, previewFiles.current);
        previewFiles.current = [];
        stopBatch(pending);
        return;
      }
      if (!apiInputs.length && !browserInputs.length) return;
      if (browserInputs.some((plan) => plan.input.tableConversion)) {
        setReview({
          preferences: selected,
          title: article.content.title,
          revisionId: article.revisionId,
          apiInputs,
          browserInputs,
        });
        return;
      }
      await execute(selected, article.content.title, apiInputs, browserInputs);
    } catch (reason) {
      if (alive.current && !controller.signal.aborted)
        setFault(articleDeliveryRequestErrorMessage(reason, messages.articleDelivery));
    } finally {
      inFlight.current = false;
      preparing.current = null;
      if (alive.current) setBusy(false);
    }
  }

  async function execute(
    selected: ArticleDeliveryPreferences,
    title: string,
    apiInputs: PreparedArticleApiDelivery[],
    browserInputs: { key: string; input: BrowserCompanionStageInput }[],
  ) {
    const pending = new Set([...apiInputs, ...browserInputs].map((plan) => plan.key));
    sent.current = true;
    setSubmitted(true);
    apiPlans.current = new Map(apiInputs.map((plan) => [plan.key, plan]));
    browserPlans.current = new Map(browserInputs.map(({ key, input }) => [key, input]));
    if (!rememberArticleDeliveryPreferences(spaceId, articleId, selected))
      notify(messages.articleDelivery.batch.preferenceFailed);
    // Only captured scope and acknowledged revision enter these bounded writes.
    // Do not admit another destination after a failure or an uncertain reply.
    for (const plan of apiInputs) {
      pending.delete(plan.key);
      if (!(await enqueueArticle(plan, messages, outcome))) {
        stopBatch(pending);
        return;
      }
    }
    const completed = await stageBrowserBatches(browserInputs, spaceId, title, messages, (key, result) => {
      pending.delete(key);
      outcome(key, result);
    });
    if (!completed) stopBatch(pending);
  }

  async function confirmReview() {
    if (!review || !canConfirmReview || inFlight.current || sent.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      if (!(await session.flush('manual'))) {
        setFault(messages.publishing.saveFailed);
        return;
      }
      if (!alive.current) return;
      const current = session.capturePersistedArticle();
      if (current.id !== articleId || current.revisionId !== review.revisionId) {
        setFault(messages.publishing.sourceChanged);
        discardTablePreviews(spaceId, previewFiles.current);
        previewFiles.current = [];
        setReview(null);
        return;
      }
      await execute(review.preferences, review.title, review.apiInputs, review.browserInputs);
      setReview(null);
    } catch (reason) {
      if (alive.current) setFault(articleDeliveryRequestErrorMessage(reason, messages.articleDelivery));
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function retry(key: string) {
    const previous = outcomes[key];
    if (inFlight.current || !previous || !canRetryArticleDeliveryOutcome(previous)) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const apiPlan = apiPlans.current.get(key);
      if (previous.kind === 'FAILED' && apiPlan) {
        await enqueueArticle(apiPlan, messages, outcome);
        return;
      }
      const input = browserPlans.current.get(key);
      if (previous.kind !== 'BROWSER' || !input) return;
      const old = previous.receipt.result;
      const receipt = old
        ? {
            ...previous.receipt,
            result: await window.desktopApi.browserCompanionReopen({
              handoffId: old.handoff.handoffId,
              expectedSpaceId: spaceId,
            }),
            errorCode: null,
          }
        : (await window.desktopApi.browserCompanionStageBatch({ items: [input], expectedSpaceId: spaceId })).items[0];
      outcome(key, receipt ? { kind: 'BROWSER', receipt } : { kind: 'UNKNOWN' });
    } catch (reason) {
      outcome(key, submissionFailure(reason, messages));
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function updateReview(key: string, prepared: Omit<BrowserCompanionStageInput, 'target' | 'watermark'>) {
    if (inFlight.current || sent.current) return;
    setReview((current) =>
      current
        ? {
            ...current,
            browserInputs: current.browserInputs.map((plan) =>
              plan.key === key ? { ...plan, input: { ...plan.input, ...prepared } } : plan,
            ),
          }
        : null,
    );
  }
  return {
    busy,
    submitted,
    fault,
    outcomes,
    submit,
    retry,
    review,
    confirmReview,
    canConfirmReview,
    setTablePreviewReady: tablePreviews.update,
    updateReview,
    cancelPreparation: () => preparing.current?.abort(),
    cancelReview: () => {
      if (!inFlight.current) {
        discardTablePreviews(spaceId, previewFiles.current);
        previewFiles.current = [];
        setReview(null);
        setFault(null);
      }
    },
  };
}
