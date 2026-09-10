import { CloudUploadIcon, FileTextIcon, HistoryIcon, LoaderCircleIcon, MessageCircleIcon } from 'lucide-react';
import { trimSurroundingCharacters } from '@/shared/string-boundaries';
import { useState } from 'react';
import type { ExtensionDto, Locale } from '@/shared/contracts';
import { localizeExtensionManifest } from '@/shared/extension-localization';
import { CompanionDestinationSettingsSubmenu } from '@/renderer/features/browser-companion/CompanionDestinationMenu';
import { CompanionWatermarkSubmenu } from '@/renderer/features/browser-companion/CompanionWatermarkMenu';
import {
  CompanionHandoffSubmenu,
  useWatermarkSelection,
} from '@/renderer/features/browser-companion/CompanionHandoffMenu';
import {
  prepareArticleHandoff,
  prepareWechatArticleHandoff,
} from '@/renderer/features/browser-companion/prepareArticleHandoff';
import { useBrowserCompanionHandoff } from '@/renderer/features/browser-companion/useBrowserCompanionHandoff';
import {
  naturalWatermarkBrowserCompanionAvailable,
  socialPostBrowserCompanionTargets,
} from '@/renderer/features/browser-companion/browserCompanionTargets';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ArticleDeliveryHistoryDialog } from '@/renderer/components/creator/article-editor/ArticleDeliveryHistoryDialog';
import { ArticleDeliveryIndicator } from '@/renderer/features/article-delivery/ArticleDeliveryIndicator';
import {
  useArticleEditorSession,
  useArticleEditorSessionSelector,
} from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import {
  articleEditorSessionSaving,
  selectArticleEditorHasBody,
} from '@/renderer/components/creator/article-editor/articleEditorSession';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Field, FieldControl, FieldLabel } from '@/renderer/components/ui/field';
import { Input } from '@/renderer/components/ui/input';
import { Textarea } from '@/renderer/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/renderer/components/ui/tooltip';

type DeliveryTarget = {
  extensionId: string;
  channelId: string;
  displayName: string;
  pathPrefix: string;
};

function normalizedSlug(value: string) {
  return trimSurroundingCharacters(
    value
      .normalize('NFKC')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-'),
    '-',
  );
}

function articleDeliveryTargets(extensions: readonly ExtensionDto[], locale: Locale): DeliveryTarget[] {
  return extensions.flatMap((extension) => {
    const configuration = extension.manifest.configuration;
    if (!extension.enabled || configuration?.kind !== 'ARTICLE_DELIVERY') return [];
    const localized = localizeExtensionManifest(extension.manifest, locale);
    return (extension.manifest.contributes.deliveryChannels ?? []).map((channelId) => ({
      extensionId: extension.manifest.id,
      channelId,
      displayName: localized.displayName,
      pathPrefix: configuration.pathPrefix,
    }));
  });
}

function deliveryTargetInput(target: DeliveryTarget) {
  return { extensionId: target.extensionId, channelId: target.channelId };
}

function ArticleUploadSubmenu({
  busy,
  targets,
  onUploadArticle,
  onUploadWechat,
  watermarkAvailable,
  watermark,
}: {
  busy: boolean;
  targets: readonly DeliveryTarget[];
  onUploadArticle(target: DeliveryTarget): void;
  onUploadWechat(): void;
  watermarkAvailable: boolean;
  watermark: ReturnType<typeof useWatermarkSelection>;
}) {
  const copy = useI18n().messages.browserCompanion;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-action="article-upload" disabled={busy}>
        <DropdownMenuIcon>
          <FileTextIcon />
        </DropdownMenuIcon>
        <span className="min-w-0 flex-1">{copy.articleUpload}</span>
        {watermarkAvailable && (
          <span className="text-xs text-muted-foreground">
            {watermark.selection.kind === 'NONE' ? copy.noWatermark : copy.watermark}
          </span>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56">
        <DropdownMenuItem data-browser-companion-article-target="wechat" disabled={busy} onSelect={onUploadWechat}>
          <DropdownMenuIcon>
            <MessageCircleIcon />
          </DropdownMenuIcon>
          {copy.targets.wechat}
        </DropdownMenuItem>
        {targets.map((deliveryTarget) => (
          <DropdownMenuItem
            key={`${deliveryTarget.extensionId}:${deliveryTarget.channelId}`}
            disabled={busy}
            onSelect={() => onUploadArticle(deliveryTarget)}
          >
            <DropdownMenuIcon>
              <CloudUploadIcon />
            </DropdownMenuIcon>
            {deliveryTarget.displayName}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {watermarkAvailable && (
          <>
            <CompanionWatermarkSubmenu
              busy={busy}
              selection={watermark.selection}
              onSelectionChange={watermark.select}
            />
            <DropdownMenuSeparator />
          </>
        )}
        <CompanionDestinationSettingsSubmenu busy={busy} targets={['wechat']} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function ArticleDeliveryAction({
  articleId,
  extensions,
  locale,
  notify,
  spaceId,
}: {
  articleId: string;
  extensions: readonly ExtensionDto[];
  locale: Locale;
  notify(message: string): void;
  spaceId: string;
}) {
  const { messages } = useI18n();
  const copy = messages.browserCompanion;
  const labels = messages.creator.manuscriptDelivery;
  const zh = locale === 'zh';
  const session = useArticleEditorSession();
  const hasBody = useArticleEditorSessionSelector(selectArticleEditorHasBody);
  const saving = useArticleEditorSessionSelector(articleEditorSessionSaving);
  const targets = articleDeliveryTargets(extensions, locale);
  const handoffTargets = socialPostBrowserCompanionTargets(extensions);
  const watermarkAvailable = naturalWatermarkBrowserCompanionAvailable(extensions);
  const watermark = useWatermarkSelection();
  const selectedWatermark = watermarkAvailable ? watermark.selection : { kind: 'NONE' as const };
  const [target, setTarget] = useState<DeliveryTarget | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [delivering, setDelivering] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const { busy: handingOff, handoff } = useBrowserCompanionHandoff({
    notify,
    prepare: async (target) => {
      if (!(await session.flush('manual'))) return null;
      return prepareArticleHandoff({
        article: session.capturePersistedArticle(),
        target,
        copy: messages.desktopPetals.document,
        notify,
      });
    },
  });
  const { busy: handingOffArticle, handoff: handoffArticle } = useBrowserCompanionHandoff({
    notify,
    prepare: async () => {
      if (!(await session.flush('manual'))) return null;
      return prepareWechatArticleHandoff({
        article: session.capturePersistedArticle(),
        referenceTitle: messages.articleWechat.referenceTitle,
        copy: { ...messages.desktopPetals.document, ...copy.wechatArticle },
        notify,
      });
    },
  });
  const busy = delivering || handingOff || handingOffArticle;

  async function uploadPersistedArticle(deliveryTarget: DeliveryTarget) {
    if (!(await session.flush('manual'))) return;
    const article = session.capturePersistedArticle();
    await window.desktopApi.articleDeliveryJobEnqueue({
      ...deliveryTargetInput(deliveryTarget),
      spaceId,
      articleId,
      expectedRevisionId: article.revisionId,
      watermark: selectedWatermark,
    });
  }

  async function invoke(deliveryTarget: DeliveryTarget) {
    if (busy) return;
    setDelivering(true);
    try {
      const status = await window.desktopApi.articleDeliveryStatus({
        ...deliveryTargetInput(deliveryTarget),
        spaceId,
        articleId,
      });
      if (status.connection.state !== 'READY') {
        notify(labels.configureTarget.replace('{name}', deliveryTarget.displayName));
        return;
      }
      if (status.profile) {
        setSlug(status.profile.slug);
        setDescription(status.profile.description);
        await uploadPersistedArticle(deliveryTarget);
        return;
      }
      setTarget(deliveryTarget);
      setSlug(normalizedSlug(session.captureSnapshot().title));
      setDescription('');
      setDialogOpen(true);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDelivering(false);
    }
  }

  async function uploadToWechat() {
    if (busy) return;
    await handoffArticle('wechat', selectedWatermark);
  }

  async function saveProfileAndDeliver() {
    if (!target || busy) return;
    const normalized = normalizedSlug(slug);
    if (!normalized) return;
    setDelivering(true);
    try {
      const next = await window.desktopApi.articleDeliveryArticleProfileSave({
        ...deliveryTargetInput(target),
        spaceId,
        articleId,
        slug: normalized,
        description,
      });
      setSlug(next.slug);
      setDescription(next.description);
      setDialogOpen(false);
      await uploadPersistedArticle(target);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDelivering(false);
    }
  }

  return (
    <>
      <div className="inline-flex items-center">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  data-action="content-upload"
                  disabled={!hasBody || saving || busy}
                  aria-busy={busy || undefined}
                  aria-label={copy.upload}
                >
                  {busy ? <LoaderCircleIcon className="size-4 animate-spin" /> : <CloudUploadIcon className="size-4" />}
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">{copy.upload}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-56">
            <ArticleUploadSubmenu
              busy={busy}
              targets={targets}
              watermarkAvailable={watermarkAvailable}
              watermark={watermark}
              onUploadArticle={(target) => void invoke(target)}
              onUploadWechat={() => void uploadToWechat()}
            />
            <CompanionHandoffSubmenu
              busy={busy}
              disabled={saving}
              onHandoff={(target, watermark) => void handoff(target, watermark)}
              targets={handoffTargets}
              watermark={watermark}
              watermarkAvailable={watermarkAvailable}
            />
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={busy} onSelect={() => setHistoryOpen(true)}>
              <DropdownMenuIcon>
                <HistoryIcon />
              </DropdownMenuIcon>
              {labels.history}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ArticleDeliveryIndicator
          articleId={articleId}
          spaceId={spaceId}
          zh={zh}
          onOpenHistory={() => setHistoryOpen(true)}
        />
      </div>
      <Dialog open={dialogOpen} onOpenChange={(open) => !busy && setDialogOpen(open)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{target ? labels.publishTo.replace('{name}', target.displayName) : ''}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <Field>
              <FieldLabel>{labels.slug}</FieldLabel>
              <FieldControl>
                <Input
                  value={slug}
                  maxLength={160}
                  spellCheck={false}
                  placeholder="my-manuscript"
                  disabled={busy}
                  onBlur={() => setSlug(normalizedSlug(slug))}
                  onChange={(event) => setSlug(event.target.value)}
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>{labels.summary}</FieldLabel>
              <FieldControl>
                <Textarea
                  value={description}
                  maxLength={500}
                  disabled={busy}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </FieldControl>
            </Field>
            {target && (
              <code className="break-all text-xs text-muted-foreground">
                {target.pathPrefix}
                {normalizedSlug(slug)}
              </code>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                {labels.cancel}
              </Button>
            </DialogClose>
            <Button type="button" disabled={busy || !normalizedSlug(slug)} onClick={() => void saveProfileAndDeliver()}>
              {busy && <LoaderCircleIcon className="size-4 animate-spin" />}
              {labels.publish}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ArticleDeliveryHistoryDialog
        articleId={articleId}
        notify={notify}
        onOpenChange={setHistoryOpen}
        open={historyOpen}
        spaceId={spaceId}
        targets={targets}
        zh={zh}
      />
    </>
  );
}
