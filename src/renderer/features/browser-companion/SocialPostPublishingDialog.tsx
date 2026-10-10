import { publishingMaskTarget } from '@/shared/contracts/publishing-mask';
import { useState } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { CompanionDestinationMenu } from '@/renderer/features/browser-companion/CompanionDestinationMenu';
import { PublicationPreview } from '@/renderer/features/browser-companion/PublicationPreview';
import { WechatPublicationMode } from '@/renderer/features/browser-companion/WechatPublicationMode';
import { prepareSocialPostHandoffs } from '@/renderer/features/browser-companion/prepareSocialPostHandoff';
import {
  usePublicationBatch,
  type PublicationCandidate,
} from '@/renderer/features/browser-companion/usePublicationBatch';
import { useI18n } from '@/renderer/i18n/useI18n';
import type {
  AssetDto,
  BrowserCompanionTarget,
  BrowserCompanionWatermarkSelection,
  SocialPostContentInput,
} from '@/shared/contracts';
import { canonicalSocialPostContentJson } from '@/shared/contracts/social-post';
import { browserCompanionStageErrorCodeSchema } from '@/shared/contracts/browser-companion';
import { PublishingMaskActions } from '@/renderer/features/browser-companion/PublishingMaskActions';
import {
  isPublishingMaskError,
  publishingMaskErrorMessage,
} from '@/renderer/features/browser-companion/publishingMask';

function publicationRowStatus(
  row: PublicationCandidate,
  blocked: boolean,
  messages: ReturnType<typeof useI18n>['messages'],
) {
  const copy = messages.publishing;
  const companionCopy = messages.browserCompanion;
  const errorMessage = (error: string) => {
    if (isPublishingMaskError(error)) return publishingMaskErrorMessage(error, messages);
    const parsed = browserCompanionStageErrorCodeSchema.safeParse(error);
    return parsed.success ? companionCopy.stageErrors[parsed.data] : error;
  };
  if (row.error) return errorMessage(row.error);
  if (!row.receipt) return blocked ? copy.batchStopped : copy.ready;
  const { result, errorCode } = row.receipt;
  if (errorCode)
    return errorCode === 'NOT_ATTEMPTED'
      ? copy.notAttempted
      : errorCode === 'OPEN_NOT_CONFIRMED'
        ? copy.openNotConfirmed
        : errorCode === 'HANDOFF_NOT_ALLOWED'
          ? copy.denied
          : errorCode === 'STAGE_FAILED'
            ? copy.failed
            : errorMessage(errorCode);
  if (!result) return copy.unknown;
  if (result.handoff.state === 'delivered') return copy.delivered;
  if (result.handoff.state === 'claimed') return copy.claimed;
  return result.browserOpenError ? companionCopy.openErrors[result.browserOpenError] : copy.waiting;
}

export function SocialPostPublishingDialog({
  spaceId,
  content,
  dirty,
  postId,
  persist,
  readSavedContent,
  readSavedRevisionId,
  assets,
  targets,
  initialTargets = targets,
  watermark,
  onClose,
}: {
  spaceId: string;
  content: SocialPostContentInput;
  dirty: boolean;
  postId: string;
  persist(snapshot: SocialPostContentInput): Promise<boolean>;
  readSavedContent(): SocialPostContentInput;
  readSavedRevisionId(): string;
  assets: readonly AssetDto[];
  targets: readonly BrowserCompanionTarget[];
  initialTargets?: readonly BrowserCompanionTarget[];
  watermark: BrowserCompanionWatermarkSelection;
  onClose(): void;
}) {
  const { messages } = useI18n();
  const copy = messages.publishing;
  const companionCopy = messages.browserCompanion;
  const [selected, setSelected] = useState(() => initialTargets.filter((target) => target !== 'chatgpt'));
  const [mode, setMode] = useState<'article' | 'images'>('article');
  const batch = usePublicationBatch({
    spaceId,
    sourceKey: canonicalSocialPostContentJson(content),
    title: content.title,
    watermark,
    prepare: (channels, wechatMode, signal) =>
      prepareSocialPostHandoffs({
        spaceId,
        content,
        dirty,
        postId,
        persist,
        readSavedContent,
        readSavedRevisionId,
        targets: channels,
        wechatMode,
        watermark,
        tableLabel: copy.tables.table,
        signal,
        notify: () => undefined,
        copy: messages.desktopPetals.document,
        wechatArticle: {
          referenceTitle: messages.articleWechat.referenceTitle,
          copy: { ...messages.desktopPetals.document, ...companionCopy.wechatArticle },
        },
      }),
  });
  const locked = batch.busy || batch.submitted;
  const allowed = selected.every((target) => targets.includes(target));
  const readyCount = batch.rows.filter((row) => row.prepared && !row.error).length;
  const blocked = batch.rows.some((row) => !row.prepared || row.error);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !batch.busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" showCloseButton={!batch.busy}>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <fieldset disabled={locked} className="grid gap-3">
          <legend className="mb-2 text-sm font-medium">{copy.channels}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {targets
              .filter((target) => target !== 'chatgpt')
              .map((target) => (
                <label key={target} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    data-publication-target={target}
                    aria-label={companionCopy.targets[target]}
                    checked={selected.includes(target)}
                    disabled={locked}
                    onCheckedChange={(checked) => {
                      batch.reset();
                      setSelected((current) =>
                        checked === true ? [...current, target] : current.filter((item) => item !== target),
                      );
                    }}
                  />
                  {companionCopy.targets[target]}
                </label>
              ))}
          </div>
          {targets.includes('wechat') && (
            <WechatPublicationMode
              value={mode}
              disabled={locked}
              onValueChange={(next) => {
                batch.reset();
                setMode(next);
              }}
            />
          )}
        </fieldset>
        {!batch.submitted && (
          <PublishingMaskActions
            spaceId={spaceId}
            source={{ kind: 'SOCIAL_POST', id: postId }}
            targets={selected.map((target) => publishingMaskTarget(target, mode))}
            disabled={locked}
            beforeOpen={() => persist(content)}
            onSaved={batch.reset}
          />
        )}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{companionCopy.destinationSettings}</span>
          <CompanionDestinationMenu busy={batch.busy || batch.submitted} targets={selected} variant="outline" />
          <span className="ml-auto text-xs text-muted-foreground">
            {watermark.kind === 'NONE' ? companionCopy.noWatermark : companionCopy.watermark}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{copy.batchNote}</p>
        {!batch.submitted && (
          <Button
            variant="outline"
            data-action="publication-preview"
            disabled={batch.busy || !selected.length || !allowed}
            onClick={() => void batch.preview(selected, mode)}
          >
            {batch.busy && <LoaderCircleIcon className="size-4 animate-spin" />}
            {batch.rows.length ? copy.refresh : copy.preview}
          </Button>
        )}
        {!selected.length && (
          <p role="status" className="text-sm text-muted-foreground">
            {copy.emptySelection}
          </p>
        )}
        {(batch.stale || !allowed) && (
          <p role="alert" className="text-sm text-destructive">
            {!allowed ? copy.denied : copy.sourceChanged}
          </p>
        )}
        {batch.fault && (
          <p role="alert" className="text-sm text-destructive">
            {batch.fault === 'save' ? copy.saveFailed : copy.unknown}
          </p>
        )}
        {batch.historyFailed && (
          <p role="status" className="text-sm text-muted-foreground">
            {copy.historyError}
          </p>
        )}
        <div className="grid gap-5" aria-live="polite">
          {batch.rows.map((row) => (
            <section
              key={row.target}
              data-publication-preview={row.target}
              className="grid min-w-0 gap-3 border-t pt-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{companionCopy.targets[row.target]}</h3>
                <span data-publication-status className="text-xs text-muted-foreground">
                  {publicationRowStatus(row, blocked, messages)}
                </span>
              </div>
              {row.prepared && (
                <PublicationPreview
                  prepared={row.prepared}
                  assets={assets}
                  target={row.target}
                  onImagesReady={(ready) =>
                    row.prepared?.tableConversion && batch.setTablePreviewReady(row.prepared.tableConversion.id, ready)
                  }
                  onChange={locked || batch.stale ? undefined : (prepared) => batch.update(row.target, prepared)}
                />
              )}
              {row.receipt && !row.receipt.result && !batch.fault && !row.prepared?.tableConversion && (
                <p className="text-xs text-muted-foreground">{copy.retrySettings}</p>
              )}
              {row.receipt &&
                !batch.fault &&
                (row.receipt.errorCode || row.receipt.result?.handoff.state === 'ready') && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="justify-self-start"
                    disabled={batch.busy}
                    onClick={() => void batch.retry(row)}
                  >
                    {row.receipt.result ? copy.reopen : copy.retry}
                  </Button>
                )}
            </section>
          ))}
        </div>
        {batch.rows.some((row) => row.prepared && !row.prepared.tableConversion) && (
          <p className="text-xs text-muted-foreground">{copy.snapshot}</p>
        )}
        <p className="text-sm text-muted-foreground">{copy.reviewNote}</p>
        <DialogFooter>
          {batch.busy && !batch.submitted && (
            <Button variant="outline" onClick={batch.cancelPreparation}>
              {messages.common.cancel}
            </Button>
          )}
          <Button variant="outline" disabled={batch.busy} onClick={onClose}>
            {messages.common.close}
          </Button>
          {!batch.submitted && (
            <Button
              data-action="publication-open"
              disabled={!allowed || !batch.canOpen}
              onClick={() => void batch.open()}
            >
              {batch.busy && <LoaderCircleIcon className="size-4 animate-spin" />}
              {batch.busy
                ? copy.opening
                : (batch.rows.some((row) => row.prepared?.tableConversion)
                    ? copy.tables.confirm
                    : copy.openReady
                  ).replace('{count}', String(readyCount))}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
