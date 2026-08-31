import { CloudUploadIcon, HistoryIcon, LoaderCircleIcon, MessageCircleIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ArticleWechatCopyOptions, ExtensionDto, Locale } from '@/shared/contracts';
import { localizeExtensionManifest } from '@/shared/extension-localization';
import { CompanionDestinationMenu } from '@/renderer/features/browser-companion/CompanionDestinationMenu';
import { ArticleDeliveryHistoryDialog } from '@/renderer/components/creator/article-editor/ArticleDeliveryHistoryDialog';
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
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .replace(/-{2,}/gu, '-');
}

function articleDeliveryTargets(extensions: readonly ExtensionDto[], zh: boolean): DeliveryTarget[] {
  return extensions.flatMap((extension) => {
    const configuration = extension.manifest.configuration;
    if (!extension.enabled || configuration?.kind !== 'ARTICLE_DELIVERY') return [];
    const localized = localizeExtensionManifest(extension.manifest, zh ? 'zh' : 'en');
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

export function ArticleDeliveryAction({
  articleId,
  locale,
  notify,
  onCopyForWechat,
  spaceId,
  zh,
}: {
  articleId: string;
  locale: Locale;
  notify(message: string): void;
  onCopyForWechat(options: ArticleWechatCopyOptions): Promise<void>;
  spaceId: string;
  zh: boolean;
}) {
  const session = useArticleEditorSession();
  const hasBody = useArticleEditorSessionSelector(selectArticleEditorHasBody);
  const saving = useArticleEditorSessionSelector(articleEditorSessionSaving);
  const [targets, setTargets] = useState<DeliveryTarget[]>([]);
  const [target, setTarget] = useState<DeliveryTarget | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const refreshTargets = useCallback(async () => {
    const extensions = await window.desktopApi.extensionsList();
    const nextTargets = articleDeliveryTargets(extensions, zh);
    setTargets(nextTargets);
    return nextTargets;
  }, [zh]);

  useEffect(() => {
    void refreshTargets().catch(() => setTargets([]));
  }, [refreshTargets]);

  async function uploadPersistedArticle(deliveryTarget: DeliveryTarget) {
    if (!(await session.flush('manual'))) return;
    const article = session.capturePersistedArticle();
    await window.desktopApi.articleDeliveryJobEnqueue({
      ...deliveryTargetInput(deliveryTarget),
      spaceId,
      articleId,
      expectedRevisionId: article.revisionId,
    });
    notify(
      zh ? `已加入 ${deliveryTarget.displayName} 发布队列` : `Queued for publishing to ${deliveryTarget.displayName}`,
    );
  }

  async function invoke(deliveryTarget: DeliveryTarget) {
    if (busy) return;
    setBusy(true);
    try {
      const status = await window.desktopApi.articleDeliveryStatus({
        ...deliveryTargetInput(deliveryTarget),
        spaceId,
        articleId,
      });
      if (status.connection.state !== 'READY') {
        notify(
          zh
            ? `请先在扩展中心配置 ${deliveryTarget.displayName}`
            : `Configure ${deliveryTarget.displayName} in Extensions first`,
        );
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
      setBusy(false);
    }
  }

  async function uploadToWechat() {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await session.flush('manual'))) return;
      await onCopyForWechat({ linksAsEndReferences: true, locale });
      const result = await window.desktopApi.browserCompanionOpen({ target: 'wechat' });
      notify(
        result.browserOpened
          ? zh
            ? '已打开微信公众号，正文已复制；进入图文编辑器后按 Ctrl+V'
            : 'WeChat Official Account opened and the article was copied; paste it in the article editor'
          : zh
            ? '公众号正文已复制，但未能打开已配置的浏览器'
            : 'The WeChat article was copied, but the configured browser could not be opened',
      );
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function saveProfileAndDeliver() {
    if (!target) return;
    const normalized = normalizedSlug(slug);
    if (!normalized) return;
    setBusy(true);
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
      setBusy(false);
    }
  }

  return (
    <>
      <div className="inline-flex items-center">
        <DropdownMenu onOpenChange={(open) => open && void refreshTargets().catch(() => setTargets([]))}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-r-none"
                  disabled={!hasBody || saving || busy}
                  aria-busy={busy || undefined}
                  aria-label={zh ? '上传' : 'Upload'}
                >
                  {busy ? <LoaderCircleIcon className="size-4 animate-spin" /> : <CloudUploadIcon className="size-4" />}
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">{zh ? '上传' : 'Upload'}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem disabled={busy} onSelect={() => void uploadToWechat()}>
              <DropdownMenuIcon>
                <MessageCircleIcon />
              </DropdownMenuIcon>
              {zh ? '微信公众号' : 'WeChat Official Account'}
            </DropdownMenuItem>
            {targets.length > 0 && <DropdownMenuSeparator />}
            {targets.map((deliveryTarget) => (
              <DropdownMenuItem
                key={`${deliveryTarget.extensionId}:${deliveryTarget.channelId}`}
                disabled={busy}
                onSelect={() => void invoke(deliveryTarget)}
              >
                <DropdownMenuIcon>
                  <CloudUploadIcon />
                </DropdownMenuIcon>
                {deliveryTarget.displayName}
              </DropdownMenuItem>
            ))}
            {targets.length > 0 && <DropdownMenuSeparator />}
            {targets.length > 0 && (
              <DropdownMenuItem disabled={busy} onSelect={() => setHistoryOpen(true)}>
                <DropdownMenuIcon>
                  <HistoryIcon />
                </DropdownMenuIcon>
                {zh ? '投递记录' : 'Delivery history'}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <CompanionDestinationMenu busy={busy} targets={['wechat']} variant="ghost" zh={zh} />
      </div>
      <Dialog open={dialogOpen} onOpenChange={(open) => !busy && setDialogOpen(open)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {target ? (zh ? `${target.displayName} 发布` : `Publish to ${target.displayName}`) : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <Field>
              <FieldLabel>{zh ? 'URL 标识' : 'URL slug'}</FieldLabel>
              <FieldControl>
                <Input
                  value={slug}
                  maxLength={160}
                  spellCheck={false}
                  placeholder="codex-quota-saving-guide"
                  disabled={busy}
                  onBlur={() => setSlug(normalizedSlug(slug))}
                  onChange={(event) => setSlug(event.target.value)}
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>{zh ? '摘要' : 'Summary'}</FieldLabel>
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
                {zh ? '取消' : 'Cancel'}
              </Button>
            </DialogClose>
            <Button type="button" disabled={busy || !normalizedSlug(slug)} onClick={() => void saveProfileAndDeliver()}>
              {busy && <LoaderCircleIcon className="size-4 animate-spin" />}
              {zh ? '发布' : 'Publish'}
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
