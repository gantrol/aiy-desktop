import { useEffect, useRef, useState } from 'react';
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
  const inFlight = useRef(false);
  const sent = useRef(false);
  const alive = useRef(true);
  const apiPlans = useRef(new Map<string, PreparedArticleApiDelivery>());
  const browserPlans = useRef(new Map<string, BrowserCompanionStageInput>());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function outcome(key: string, value: ArticleDeliveryBatchOutcome) {
    if (alive.current) setOutcomes((current) => ({ ...current, [key]: value }));
  }

  async function enqueue(plan: PreparedArticleApiDelivery) {
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
        // A queue retry must not overwrite a profile another window changed
        // after this write. Admission rechecks the captured values instead.
        plan.saveProfile = false;
      }
    } catch (reason) {
      outcome(key, {
        kind: 'FAILED',
        retryable: true,
        message: articleDeliveryRequestErrorMessage(reason, messages.articleDelivery),
      });
      return;
    }
    try {
      const job = await window.desktopApi.articleDeliveryJobEnqueue(input);
      outcome(key, { kind: 'QUEUED', jobId: job.id });
    } catch (reason) {
      // IPC can lose a reply after admission; history establishes the result.
      outcome(key, submissionFailure(reason, messages));
    }
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
    const selectedWatermark = structuredClone(watermark);
    const selectedProfiles = structuredClone(profiles);
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
      });
      if (!alive.current) return;
      for (const [key, message] of Object.entries(failures)) outcome(key, { kind: 'FAILED', message });
      if (!apiInputs.length && !browserInputs.length) return;
      sent.current = true;
      setSubmitted(true);
      apiPlans.current = new Map(apiInputs.map((plan) => [plan.key, plan]));
      browserPlans.current = new Map(browserInputs.map(({ key, input }) => [key, input]));
      if (!rememberArticleDeliveryPreferences(spaceId, articleId, selected))
        notify(messages.articleDelivery.batch.preferenceFailed);
      // Only captured scope and acknowledged revision enter these bounded writes.
      // Failure in one destination does not resubmit successful destinations.
      for (const plan of apiInputs) await enqueue(plan);
      if (browserInputs.length) {
        try {
          const batch = await window.desktopApi.browserCompanionStageBatch({
            expectedSpaceId: spaceId,
            items: browserInputs.map(({ input }) => input),
            ...(article.content.title.trim() ? { title: article.content.title.trim().slice(0, 80) } : {}),
          });
          for (const { key, input } of browserInputs) {
            const receipt = batch.items.find((item) => item.target === input.target);
            outcome(key, receipt ? { kind: 'BROWSER', receipt } : { kind: 'UNKNOWN' });
          }
        } catch (reason) {
          for (const { key } of browserInputs) outcome(key, submissionFailure(reason, messages));
        }
      }
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
        await enqueue(apiPlan);
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

  return { busy, submitted, fault, outcomes, submit, retry };
}
