import { useId, useState } from 'react';
import { RefreshCwIcon, Settings2Icon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Field, FieldControl, FieldLabel } from '@/renderer/components/ui/field';
import { Input } from '@/renderer/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Textarea } from '@/renderer/components/ui/textarea';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  articleUploadTargetKey,
  type ArticleUploadTarget,
} from '@/renderer/features/article-delivery/articleDeliveryPreferences';
import {
  normalizeArticleDeliverySlug,
  type ArticleDeliveryTarget,
} from '@/renderer/features/article-delivery/articleDeliveryTargets';
import type { ArticleDeliveryProfileDraft } from '@/renderer/features/article-delivery/useArticleDeliverySetup';

export function ArticleDeliveryTargetRow({
  choice,
  selected,
  definition,
  ready,
  available,
  locked,
  canAdd,
  profile,
  hasProfile,
  wechatMode,
  status,
  result,
  failed,
  retrying,
  onSelect,
  onImageModeChange,
  onProfileChange,
  onWechatModeChange,
  onRetry,
}: {
  choice: ArticleUploadTarget;
  selected?: ArticleUploadTarget;
  definition?: ArticleDeliveryTarget;
  ready: boolean;
  available: boolean;
  locked: boolean;
  canAdd: boolean;
  profile: ArticleDeliveryProfileDraft;
  hasProfile: boolean;
  wechatMode: 'article' | 'images';
  status: string;
  result: boolean;
  failed: boolean;
  retrying: boolean;
  onSelect(selected: boolean): void;
  onImageModeChange(mode: 'BALANCED' | 'ORIGINAL'): void;
  onProfileChange(patch: Partial<ArticleDeliveryProfileDraft>): void;
  onWechatModeChange(mode: 'article' | 'images'): void;
  onRetry?: () => void;
}) {
  const { messages } = useI18n();
  const copy = messages.articleDelivery;
  const labels = messages.creator.manuscriptDelivery;
  const id = useId();
  const [profileOpen, setProfileOpen] = useState(false);
  const target = selected ?? choice;
  const targetName =
    choice.kind === 'BROWSER'
      ? messages.browserCompanion.targets[choice.target]
      : (definition?.displayName ?? `${choice.extensionId} · ${choice.channelId}`);
  const action =
    choice.kind === 'BROWSER'
      ? copy.batch.browserFill
      : definition?.deliveryMode === 'PUBLISH'
        ? copy.batch.directPublish
        : definition
          ? copy.actions.DRAFT
          : '';
  return (
    <div className="grid gap-3 py-3" data-article-upload-target={articleUploadTargetKey(choice)}>
      <div className="flex items-center gap-3">
        <Checkbox
          id={id}
          checked={Boolean(selected)}
          disabled={locked || (!selected && (!available || !canAdd))}
          onCheckedChange={(checked) => onSelect(checked === true)}
        />
        <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer text-sm font-medium">
          {targetName}
        </label>
        <span className="text-xs text-muted-foreground">{action}</span>
      </div>
      <div className="flex items-center gap-2 pl-7">
        <span
          className={`min-w-0 flex-1 text-xs ${failed ? 'text-destructive' : 'text-muted-foreground'}`}
          role={result ? 'status' : undefined}
        >
          {status}
        </span>
        {onRetry && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={retrying}
            aria-label={`${copy.retry} · ${targetName}`}
            title={copy.retry}
            onClick={onRetry}
          >
            <RefreshCwIcon className="size-4" />
          </Button>
        )}
      </div>
      {selected && target.kind === 'API' && definition?.activated && ready && (
        <div className="grid gap-3 pl-7">
          <div className="flex items-center gap-2">
            <Select value={target.imageMode} disabled={locked} onValueChange={onImageModeChange}>
              <SelectTrigger className="flex-1" aria-label={`${copy.imageOptions} · ${targetName}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['BALANCED', 'ORIGINAL'] as const).map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {copy.imageModes[mode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={locked || !hasProfile}
              aria-label={`${labels.slug} · ${targetName}`}
              title={labels.slug}
              aria-expanded={profileOpen || !hasProfile}
              onClick={() => setProfileOpen((current) => !current)}
            >
              <Settings2Icon className="size-4" />
            </Button>
          </div>
          {(profileOpen || !hasProfile) && (
            <>
              <Field>
                <FieldLabel htmlFor={`${id}-slug`}>{labels.slug}</FieldLabel>
                <FieldControl>
                  <Input
                    id={`${id}-slug`}
                    value={profile.slug}
                    maxLength={160}
                    disabled={locked}
                    spellCheck={false}
                    placeholder="my-manuscript"
                    onBlur={() => onProfileChange({ slug: normalizeArticleDeliverySlug(profile.slug) })}
                    onChange={(event) => onProfileChange({ slug: event.target.value })}
                  />
                </FieldControl>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-summary`}>{labels.summary}</FieldLabel>
                <FieldControl>
                  <Textarea
                    id={`${id}-summary`}
                    value={profile.description}
                    maxLength={500}
                    disabled={locked}
                    onChange={(event) => onProfileChange({ description: event.target.value })}
                  />
                </FieldControl>
              </Field>
              <code className="break-all text-xs text-muted-foreground">
                {definition.pathPrefix}
                {normalizeArticleDeliverySlug(profile.slug)}
              </code>
            </>
          )}
        </div>
      )}
      {selected && choice.kind === 'BROWSER' && choice.target === 'wechat' && (
        <div className="pl-7">
          <Select value={wechatMode} disabled={locked} onValueChange={onWechatModeChange}>
            <SelectTrigger aria-label={messages.publishing.wechatMode}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="article">{messages.publishing.article}</SelectItem>
              <SelectItem value="images">{messages.publishing.images}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
