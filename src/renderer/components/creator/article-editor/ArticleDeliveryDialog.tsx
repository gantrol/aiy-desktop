import { useMemo, useState } from 'react';
import { CloudUploadIcon, HistoryIcon, LoaderCircleIcon, MoreHorizontalIcon, RefreshCwIcon } from 'lucide-react';
import type { BrowserCompanionTarget, BrowserCompanionWatermarkSelection } from '@/shared/contracts';
import { browserCompanionStageErrorCodeSchema } from '@/shared/contracts/browser-companion';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { MessageCatalog } from '@/renderer/i18n/types';
import { ArticleDeliveryTargetRow } from '@/renderer/components/creator/article-editor/ArticleDeliveryTargetRow';
import { useArticleEditorSession } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { CompanionDestinationPicker } from '@/renderer/features/browser-companion/CompanionDestinationMenu';
import { CompanionWatermarkSubmenu } from '@/renderer/features/browser-companion/CompanionWatermarkMenu';
import { useWatermarkSelection } from '@/renderer/features/browser-companion/CompanionHandoffMenu';
import {
  articleDeliveryConnectionMessage,
  articleDeliveryRequestErrorMessage,
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
  readDefaultArticleDeliveryPreferences,
  saveDefaultArticleDeliveryPreferences,
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

const browserTargets = ['wechat', 'xiaohongshu', 'weibo', 'x'] as const;

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
    if (!definition.activated) return copy.unavailable;
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
  const copy = messages.articleDelivery.batch;
  const companionCopy = messages.browserCompanion;
  const publishingCopy = messages.publishing;
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
  const choices = useMemo(() => {
    const result: ArticleUploadTarget[] = [
      ...browserTargets.map((target) => ({ kind: 'BROWSER' as const, target })),
      ...targets.map(articleDeliveryTargetChoice),
    ];
    const known = new Set(result.map(articleUploadTargetKey));
    for (const target of preferences.targets) {
      if (!known.has(articleUploadTargetKey(target))) result.push(target);
    }
    return result;
  }, [targets, preferences.targets]);
  const selectedByKey = new Map(preferences.targets.map((target) => [articleUploadTargetKey(target), target]));
  const selectedBrowsers = preferences.targets.flatMap((target) => (target.kind === 'BROWSER' ? [target.target] : []));

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

  function toggle(target: ArticleUploadTarget, selected: boolean) {
    const key = articleUploadTargetKey(target);
    setPreferences((current) => ({
      ...current,
      targets: selected
        ? [...current.targets, target]
        : current.targets.filter((item) => articleUploadTargetKey(item) !== key),
    }));
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

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !batch.busy) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90vh] max-w-2xl overflow-y-auto"
        aria-describedby={undefined}
        showCloseButton={!batch.busy}
      >
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-auto text-xs text-muted-foreground">{copy.sources[initial.source]}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={locked || setup.loading}
            aria-label={copy.refresh}
            title={copy.refresh}
            onClick={() => void setup.refresh()}
          >
            <RefreshCwIcon className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={batch.busy}
            aria-label={messages.articleDelivery.history}
            title={messages.articleDelivery.history}
            onClick={onOpenHistory}
          >
            <HistoryIcon className="size-4" />
          </Button>
          <ArticleDeliveryPresetMenu
            disabled={locked}
            loading={setup.loading}
            preferences={preferences}
            configured={choices
              .filter(ready)
              .slice(0, 32)
              .map((choice) => selectedByKey.get(articleUploadTargetKey(choice)) ?? choice)}
            onChange={setPreferences}
            notify={notify}
          />
        </div>
        <div className="divide-y divide-border" aria-label={publishingCopy.channels}>
          {choices.map((choice) => {
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
                wechatMode={preferences.wechatMode}
                status={
                  result
                    ? resultLabel(result, messages)
                    : choiceStatus(choice, definitions.get(key), setup, messages, availableBrowserTargets)
                }
                result={Boolean(result)}
                failed={result?.kind === 'FAILED' || result?.kind === 'UNKNOWN'}
                retrying={batch.busy}
                onSelect={(selected) => toggle(choice, selected)}
                onProfileChange={(patch) => updateProfile(key, patch)}
                onImageModeChange={(imageMode) =>
                  setPreferences((current) => ({
                    ...current,
                    targets: current.targets.map((item) =>
                      articleUploadTargetKey(item) === key && item.kind === 'API' ? { ...item, imageMode } : item,
                    ),
                  }))
                }
                onWechatModeChange={(wechatMode) => setPreferences((current) => ({ ...current, wechatMode }))}
                onRetry={result && canRetryArticleDeliveryOutcome(result) ? () => void batch.retry(key) : undefined}
              />
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CompanionDestinationPicker
            busy={batch.busy}
            state={setup.destinations}
            targets={selectedBrowsers.length ? selectedBrowsers : availableBrowserTargets}
            onChange={setup.setDestinations}
          />
          {watermarkAvailable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" disabled={locked}>
                  {selectedWatermark.kind === 'NONE' ? companionCopy.noWatermark : companionCopy.watermark}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <CompanionWatermarkSubmenu
                  busy={locked}
                  selection={watermark.selection}
                  onSelectionChange={watermark.select}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {batch.fault && (
          <div role="alert" className="text-sm text-destructive">
            {batch.fault}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={batch.busy} onClick={onClose}>
            {messages.common.close}
          </Button>
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

function ArticleDeliveryPresetMenu({
  disabled,
  loading,
  preferences,
  configured,
  onChange,
  notify,
}: {
  disabled: boolean;
  loading: boolean;
  preferences: ArticleDeliveryPreferences;
  configured: ArticleUploadTarget[];
  onChange(preferences: ArticleDeliveryPreferences): void;
  notify(message: string): void;
}) {
  const copy = useI18n().messages.articleDelivery.batch;
  function hasTargets(targets: readonly BrowserCompanionTarget[]) {
    return targets.every((target) =>
      configured.some((choice) => choice.kind === 'BROWSER' && choice.target === target),
    );
  }
  function selectPreset(targets: ('wechat' | 'xiaohongshu' | 'weibo' | 'x')[]) {
    onChange({ version: 1, targets: targets.map((target) => ({ kind: 'BROWSER', target })), wechatMode: 'article' });
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={copy.sources.DEFAULT}>
          <MoreHorizontalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onChange(readDefaultArticleDeliveryPreferences())}>
          {copy.useDefault}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            notify(saveDefaultArticleDeliveryPreferences(preferences) ? copy.defaultSaved : copy.preferenceFailed)
          }
        >
          {copy.saveDefault}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!hasTargets(['wechat', 'xiaohongshu'])}
          onSelect={() => selectPreset(['wechat', 'xiaohongshu'])}
        >
          {copy.presetWechatXhs}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!hasTargets(['weibo', 'x'])} onSelect={() => selectPreset(['weibo', 'x'])}>
          {copy.presetWeiboX}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={loading} onSelect={() => onChange({ ...preferences, targets: configured })}>
          {copy.chooseConfigured}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onChange({ ...preferences, targets: [] })}>{copy.clear}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
