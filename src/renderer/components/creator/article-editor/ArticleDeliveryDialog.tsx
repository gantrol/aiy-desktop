import { selectArticleDeliveryTargets } from '@/renderer/components/creator/article-editor/ArticleDeliverySelection';
import { useWorkspacePaneContainer } from '@/renderer/components/workspace/WorkspacePaneScope';
import { ArticleDeliverySettings } from '@/renderer/components/creator/article-editor/ArticleDeliverySettings';
import { ArticleDeliveryTargetList } from '@/renderer/components/creator/article-editor/ArticleDeliveryTargetList';
import { ArticleDeliveryHeader } from '@/renderer/components/creator/article-editor/ArticleDeliveryHeader';
import { publishingMaskTarget } from '@/shared/contracts/publishing-mask';
import { useMemo, useState } from 'react';
import { CloudUploadIcon, LoaderCircleIcon } from 'lucide-react';
import type { BrowserCompanionTarget, BrowserCompanionWatermarkSelection } from '@/shared/contracts';
import { browserCompanionStageErrorCodeSchema } from '@/shared/contracts/browser-companion';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { MessageCatalog } from '@/renderer/i18n/types';
import { ArticleDeliveryTargetRow } from '@/renderer/components/creator/article-editor/ArticleDeliveryTargetRow';
import { useArticleEditorSession } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { useWatermarkSelection } from '@/renderer/features/browser-companion/CompanionHandoffMenu';
import {
  articleDeliveryConnectionMessage,
  articleDeliveryRequestErrorMessage,
  articleDeliveryTargetUnavailableMessage,
} from '@/renderer/features/article-delivery/presentation';
import {
  articleBrowserDestinationState,
  articleDeliveryTargetChoice,
  normalizeArticleDeliverySlug,
  type ArticleDeliveryTarget,
} from '@/renderer/features/article-delivery/articleDeliveryTargets';
import {
  articleUploadTargetKey,
  readArticleDeliveryPreferences,
  type ArticleDeliveryPreferences,
  type ArticleUploadTarget,
} from '@/renderer/features/article-delivery/articleDeliveryPreferences';
import {
  useArticleDeliverySetup,
  type ArticleDeliveryProfileDraft,
} from '@/renderer/features/article-delivery/useArticleDeliverySetup';
import {
  useArticleDeliveryBatch,
  canRetryArticleDeliveryOutcome,
  type ArticleDeliveryBatchOutcome,
} from '@/renderer/features/article-delivery/useArticleDeliveryBatch';

const browserTargets = ['xiaohongshu', 'weibo', 'x'] as const;

function resultLabel(result: ArticleDeliveryBatchOutcome, messages: MessageCatalog): string {
  const copy = messages.articleDelivery.batch;
  const deliveryCopy = messages.articleDelivery;
  const companionCopy = messages.browserCompanion;
  const publishingCopy = messages.publishing;
  if (result.kind === 'UNKNOWN') return copy.unknown;
  if (result.kind === 'FAILED') return result.message;
  if (result.kind === 'QUEUED') return deliveryCopy.status.queued;
  const { result: handoff, errorCode } = result.receipt;
  if (errorCode) {
    const error = browserCompanionStageErrorCodeSchema.safeParse(errorCode);
    return error.success
      ? companionCopy.stageErrors[error.data]
      : errorCode === 'NOT_ATTEMPTED'
        ? publishingCopy.notAttempted
        : errorCode === 'OPEN_NOT_CONFIRMED'
          ? publishingCopy.openNotConfirmed
          : errorCode === 'HANDOFF_NOT_ALLOWED'
            ? publishingCopy.denied
            : publishingCopy.failed;
  }
  if (!handoff) return copy.unknown;
  if (handoff.handoff.state === 'delivered') return publishingCopy.delivered;
  if (handoff.handoff.state === 'claimed') return publishingCopy.claimed;
  return handoff.browserOpenError ? companionCopy.openErrors[handoff.browserOpenError] : publishingCopy.waiting;
}

function choiceStatus(
  target: ArticleUploadTarget,
  definition: ArticleDeliveryTarget | undefined,
  setup: ReturnType<typeof useArticleDeliverySetup>,
  messages: MessageCatalog,
  availableBrowserTargets: readonly BrowserCompanionTarget[],
) {
  const copy = messages.articleDelivery.batch;
  const deliveryCopy = messages.articleDelivery;
  const companionCopy = messages.browserCompanion;
  const publishingCopy = messages.publishing;
  const key = articleUploadTargetKey(target);
  if (target.kind === 'API') {
    if (!definition) return copy.missingExtension;
    if (!definition.activated) return articleDeliveryTargetUnavailableMessage(definition, messages);
    if (setup.loading) return companionCopy.loadingProfiles;
    const entry = setup.entries[key];
    return entry?.status
      ? articleDeliveryConnectionMessage(entry.status.connection, deliveryCopy)
      : articleDeliveryRequestErrorMessage(entry?.error, deliveryCopy);
  }
  if (!availableBrowserTargets.includes(target.target)) return copy.unavailable;
  if (setup.loading) return companionCopy.loadingProfiles;
  if (setup.browserFailed) return companionCopy.unavailable;
  const state = articleBrowserDestinationState(setup.destinations, target.target);
  return state === 'READY'
    ? publishingCopy.ready
    : state === 'NO_COMPANION'
      ? companionCopy.noCompanion
      : state === 'UNAVAILABLE'
        ? companionCopy.unavailable
        : companionCopy.notConfigured;
}

function submissionProfiles(
  targets: readonly ArticleUploadTarget[],
  profileFor: (key: string) => ArticleDeliveryProfileDraft,
  entries: ReturnType<typeof useArticleDeliverySetup>['entries'],
) {
  return Object.fromEntries(
    targets
      .filter((target) => target.kind === 'API')
      .map((target) => {
        const key = articleUploadTargetKey(target);
        const profile = profileFor(key);
        const slug = normalizeArticleDeliverySlug(profile.slug);
        const saved = entries[key]?.status?.profile;
        return [
          key,
          {
            ...profile,
            slug,
            saveRequired: !saved || saved.slug !== slug || saved.description !== profile.description,
          },
        ];
      }),
  );
}

export function ArticleDeliveryDialog({
  articleId,
  spaceId,
  targets,
  availableBrowserTargets,
  watermarkAvailable,
  notify,
  onClose,
  onOpenHistory,
}: {
  articleId: string;
  spaceId: string;
  targets: readonly ArticleDeliveryTarget[];
  availableBrowserTargets: readonly BrowserCompanionTarget[];
  watermarkAvailable: boolean;
  notify(message: string): void;
  onClose(): void;
  onOpenHistory(): void;
}) {
  const { messages } = useI18n();
  const paneContainer = useWorkspacePaneContainer();
  const copy = messages.articleDelivery.batch;
  const session = useArticleEditorSession();
  const [initial] = useState(() => readArticleDeliveryPreferences(spaceId, articleId));
  const [preferences, setPreferences] = useState<ArticleDeliveryPreferences>(initial.preferences);
  const [profiles, setProfiles] = useState<Record<string, ArticleDeliveryProfileDraft>>({});
  const watermark = useWatermarkSelection();
  const selectedWatermark: BrowserCompanionWatermarkSelection = watermarkAvailable
    ? watermark.selection
    : { kind: 'NONE' };
  const setup = useArticleDeliverySetup({ articleId, spaceId, targets });
  const batch = useArticleDeliveryBatch({ articleId, spaceId, notify });
  const locked = batch.busy || batch.submitted;
  const definitions = useMemo(
    () => new Map(targets.map((target) => [articleUploadTargetKey(articleDeliveryTargetChoice(target)), target])),
    [targets],
  );
  const choices = useMemo(() => deliveryChoices(targets, preferences.targets), [targets, preferences.targets]);
  const selectedByKey = new Map(preferences.targets.map((target) => [articleUploadTargetKey(target), target]));
  const selectedBrowsers = [
    ...new Set(preferences.targets.flatMap((target) => (target.kind === 'BROWSER' ? [target.target] : []))),
  ];
  const maskTargets = preferences.targets.flatMap((target) =>
    target.kind === 'BROWSER'
      ? [publishingMaskTarget(target.target, target.target === 'wechat' ? target.mode : 'images')]
      : [],
  );

  const selectable = choices
    .filter((choice) =>
      choice.kind === 'BROWSER'
        ? availableBrowserTargets.includes(choice.target)
        : definitions.get(articleUploadTargetKey(choice))?.activated,
    )
    .slice(0, 32)
    .map((choice) => selectedByKey.get(articleUploadTargetKey(choice)) ?? choice);
  const groupTargets = choices.filter(
    (choice) =>
      selectedByKey.has(articleUploadTargetKey(choice)) ||
      selectable.some((target) => articleUploadTargetKey(target) === articleUploadTargetKey(choice)),
  );

  function profileFor(key: string): ArticleDeliveryProfileDraft {
    const profile = setup.entries[key]?.status?.profile;
    return (
      profiles[key] ?? {
        slug: profile?.slug ?? normalizeArticleDeliverySlug(session.captureSnapshot().title),
        description: profile?.description ?? '',
      }
    );
  }

  function ready(target: ArticleUploadTarget) {
    if (setup.loading) return false;
    if (target.kind === 'BROWSER') {
      return (
        availableBrowserTargets.includes(target.target) &&
        articleBrowserDestinationState(setup.destinations, target.target) === 'READY'
      );
    }
    const key = articleUploadTargetKey(target);
    return definitions.get(key)?.activated && setup.entries[key]?.status?.connection.state === 'READY';
  }

  function selectTargets(targets: readonly ArticleUploadTarget[], selected: boolean) {
    setPreferences((current) => selectArticleDeliveryTargets(current, targets, selected));
  }

  function updateProfile(key: string, patch: Partial<ArticleDeliveryProfileDraft>) {
    setProfiles((current) => ({ ...current, [key]: { ...profileFor(key), ...patch } }));
  }

  const canSubmit =
    preferences.targets.length > 0 &&
    preferences.targets.every(
      (target) =>
        ready(target) &&
        (target.kind !== 'API' || normalizeArticleDeliverySlug(profileFor(articleUploadTargetKey(target)).slug)),
    );
  const usesPublish = preferences.targets.some(
    (target) => definitions.get(articleUploadTargetKey(target))?.deliveryMode === 'PUBLISH',
  );

  function renderChoice(choice: ArticleUploadTarget) {
    const key = articleUploadTargetKey(choice);
    const result = batch.outcomes[key];
    return (
      <ArticleDeliveryTargetRow
        key={key}
        choice={choice}
        selected={selectedByKey.get(key)}
        definition={definitions.get(key)}
        ready={Boolean(ready(choice))}
        available={
          choice.kind === 'BROWSER'
            ? availableBrowserTargets.includes(choice.target)
            : Boolean(definitions.get(key)?.activated)
        }
        locked={locked}
        canAdd={preferences.targets.length < 32}
        profile={profileFor(key)}
        hasProfile={Boolean(setup.entries[key]?.status?.profile)}
        status={
          result
            ? resultLabel(result, messages)
            : choiceStatus(choice, definitions.get(key), setup, messages, availableBrowserTargets)
        }
        result={Boolean(result)}
        failed={result?.kind === 'FAILED' || result?.kind === 'UNKNOWN'}
        retrying={batch.busy}
        onSelect={(selected) => selectTargets([choice], selected)}
        onProfileChange={(patch) => updateProfile(key, patch)}
        onImageModeChange={(imageMode) =>
          setPreferences((current) => ({
            ...current,
            targets: current.targets.map((item) =>
              articleUploadTargetKey(item) === key && item.kind === 'API' ? { ...item, imageMode } : item,
            ),
          }))
        }
        onRetry={result && canRetryArticleDeliveryOutcome(result) ? () => void batch.retry(key) : undefined}
      />
    );
  }

  return (
    <Dialog
      container={paneContainer}
      open
      onOpenChange={(open) => {
        if (!open && !batch.busy) onClose();
      }}
    >
      <DialogContent
        className={
          paneContainer
            ? 'inset-0 flex h-full max-h-full w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 shadow-none'
            : 'flex max-h-[90vh] max-w-md flex-col gap-0 overflow-hidden p-0'
        }
        aria-describedby={undefined}
        showCloseButton={!batch.busy}
      >
        <ArticleDeliveryHeader
          busy={batch.busy}
          locked={locked}
          loading={setup.loading}
          preferences={preferences}
          selectable={selectable}
          configured={choices
            .filter(ready)
            .slice(0, 32)
            .map((choice) => selectedByKey.get(articleUploadTargetKey(choice)) ?? choice)}
          onRefresh={() => void setup.refresh()}
          onOpenHistory={onOpenHistory}
          onChange={setPreferences}
          notify={notify}
        />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2">
          <ArticleDeliveryTargetList
            choices={choices}
            renderChoice={renderChoice}
            preferences={preferences}
            groupTargets={groupTargets}
            disabled={locked}
            onSelect={selectTargets}
          />
          <ArticleDeliverySettings
            articleId={articleId}
            spaceId={spaceId}
            busy={batch.busy}
            submitted={batch.submitted}
            destinations={setup.destinations}
            onDestinationsChange={setup.setDestinations}
            selectedBrowsers={selectedBrowsers}
            availableBrowserTargets={availableBrowserTargets}
            watermarkAvailable={watermarkAvailable}
            selectedWatermark={selectedWatermark}
            watermark={watermark}
            maskTargets={maskTargets}
            beforeOpen={() => session.flush('manual')}
          />
          {batch.fault && (
            <div role="alert" className="text-sm text-destructive">
              {batch.fault}
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0 flex-row items-center justify-end border-t bg-overlay px-4 py-3">
          {batch.submitted && (
            <Button type="button" variant="outline" disabled={batch.busy} onClick={onClose}>
              {messages.common.close}
            </Button>
          )}
          {!batch.submitted && (
            <Button
              type="button"
              data-action="article-upload-submit"
              disabled={locked || !canSubmit}
              onClick={() =>
                void batch.submit({
                  preferences,
                  definitions,
                  watermark: selectedWatermark,
                  profiles: submissionProfiles(preferences.targets, profileFor, setup.entries),
                })
              }
            >
              {batch.busy ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : (
                <CloudUploadIcon className="size-4" />
              )}
              {copy.submit.replace('{count}', String(preferences.targets.length))}
              {usesPublish && ` · ${copy.directPublish}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function deliveryChoices(targets: readonly ArticleDeliveryTarget[], selected: readonly ArticleUploadTarget[]) {
  const result: ArticleUploadTarget[] = [
    { kind: 'BROWSER', target: 'wechat', mode: 'article' },
    { kind: 'BROWSER', target: 'wechat', mode: 'images' },
    ...browserTargets.map((target) => ({ kind: 'BROWSER' as const, target })),
    ...targets.map(articleDeliveryTargetChoice),
  ];
  const known = new Set(result.map(articleUploadTargetKey));
  for (const target of selected) {
    if (!known.has(articleUploadTargetKey(target))) result.push(target);
  }
  return result;
}
