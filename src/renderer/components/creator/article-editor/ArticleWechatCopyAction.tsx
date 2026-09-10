import { useMemo, useState } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { videoDocumentRevisionMediaSchema } from '@/shared/contracts/video-document';
import { CircleAlertIcon, CopyIcon, LoaderCircleIcon } from 'lucide-react';
import type {
  ArticleContentInput,
  ArticleWechatCopyOptions,
  Locale,
  VideoDocumentRevisionMediaDto,
} from '@/shared/contracts';
import {
  normalizeArticleWechatMediaPath,
  renderArticleForWechat,
  type ArticleWechatRenderResult,
} from '@/shared/article-wechat-renderer';
import {
  useArticleEditorSession,
  useArticleEditorSessionSelector,
} from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { ArticleHeaderIconButton } from '@/renderer/components/creator/article-editor/ArticleEditorHeader';
import {
  selectArticleEditorHasBody,
  selectArticleEditorMedia,
} from '@/renderer/components/creator/article-editor/articleEditorSession';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/renderer/components/ui/dialog';
import { MetaText } from '@/renderer/components/ui/meta-text';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';

interface PreviewSnapshot {
  content: ArticleContentInput;
  media: VideoDocumentRevisionMediaDto[];
}

interface PreviewRenderState {
  value: ArticleWechatRenderResult | null;
  error: string | null;
}

interface Props {
  locale: Locale;
  notify(message: string): void;
  onCopy(options: ArticleWechatCopyOptions): Promise<void>;
}

function previewImageSources(snapshot: PreviewSnapshot) {
  const mediaById = new Map(snapshot.media.map((item) => [item.assetId, item]));
  const images = new Map<string, { src: string; width: number; height: number }>();
  for (const binding of snapshot.content.mediaBindings) {
    const asset = mediaById.get(binding.assetId);
    if (!asset) continue;
    images.set(normalizeArticleWechatMediaPath(binding.path), {
      src: asset.mediaUrl,
      width: asset.width,
      height: asset.height,
    });
  }
  return images;
}

function renderPreview(snapshot: PreviewSnapshot, linksAsEndReferences: boolean, zh: boolean): PreviewRenderState {
  try {
    return {
      value: renderArticleForWechat(snapshot.content.markdown, previewImageSources(snapshot), {
        linksAsEndReferences,
        referenceTitle: zh ? '引用链接' : 'References',
      }),
      error: null,
    };
  } catch (reason) {
    return { value: null, error: reason instanceof Error ? reason.message : String(reason) };
  }
}

function previewDocument(html: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: aiy-media:; style-src 'unsafe-inline'"><style>html,body{margin:0;min-height:100%;background:#fff}body{box-sizing:border-box;padding:24px}</style></head><body>${html}</body></html>`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function copyFailureMessage(reason: unknown, zh: boolean) {
  const detail = reason instanceof Error ? reason.message : String(reason);
  return zh
    ? `复制失败，尚未写入剪贴板：${detail}`
    : `Copy failed before anything was written to the clipboard: ${detail}`;
}

function WechatCopyDebug({ rendered }: { rendered: ArticleWechatRenderResult }) {
  const labels = useI18n().messages.wechatCopyDebug;
  const [format, setFormat] = useState<'html' | 'text'>('html');
  const diagnostics = rendered.diagnostics;
  const metrics = [
    [labels.html, formatBytes(diagnostics.htmlByteSize)],
    [labels.plainText, formatBytes(diagnostics.textByteSize)],
    [labels.localImages, diagnostics.localImageCount],
    [labels.remoteImages, diagnostics.remoteImageCount],
    [labels.links, diagnostics.linkCount],
    [labels.endReferences, diagnostics.endReferenceCount],
    [labels.ignoredLinks, diagnostics.unsupportedLinkCount],
    [labels.missingImages, diagnostics.unavailableImageCount],
  ] as const;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <dl className="grid shrink-0 grid-cols-2 border-b px-4 py-3 sm:grid-cols-4">
        {metrics.map(([label, value]) => (
          <div key={label} className="min-w-0 py-1 pr-4">
            <dt className="truncate text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 font-mono text-xs tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex shrink-0 justify-end border-b px-4 py-2">
        <Segmented
          type="single"
          value={format}
          aria-label={labels.format}
          onValueChange={(value) => (value === 'html' || value === 'text') && setFormat(value)}
        >
          <SegmentedItem value="html">{labels.html}</SegmentedItem>
          <SegmentedItem value="text">{labels.plainText}</SegmentedItem>
        </Segmented>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all bg-surface-sunken p-4 font-mono text-xs leading-relaxed text-foreground">
        {format === 'html' ? rendered.html : rendered.text}
      </pre>
    </div>
  );
}

function WechatCopyDialog({
  copyError,
  copying,
  linksAsEndReferences,
  open,
  preview,
  zh,
  onCopy,
  onLinksAsEndReferencesChange,
  onOpenChange,
}: {
  copyError: string | null;
  copying: boolean;
  linksAsEndReferences: boolean;
  open: boolean;
  preview: PreviewRenderState;
  zh: boolean;
  onCopy(): void;
  onLinksAsEndReferencesChange(value: boolean): void;
  onOpenChange(open: boolean): void;
}) {
  const unavailableImages = preview.value?.diagnostics.unavailableImageCount ?? 0;
  const unavailableImagesMessage = unavailableImages
    ? zh
      ? `${unavailableImages} 张图片不可用`
      : `${unavailableImages} unavailable image${unavailableImages === 1 ? '' : 's'}`
    : '';
  const statusMessage = copyError ?? unavailableImagesMessage;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        showCloseButton={!copying}
        className="flex h-[min(88vh,54rem)] w-[min(96vw,72rem)] max-w-none flex-col gap-0 overflow-hidden rounded-lg p-0"
      >
        <header className="flex min-w-0 shrink-0 items-center gap-4 border-b px-4 py-3 pr-14">
          <DialogTitle className="min-w-0 flex-1 truncate text-sm">
            {zh ? '公众号正文' : 'WeChat article body'}
          </DialogTitle>
          <label className="flex shrink-0 items-center gap-2 text-xs font-medium">
            <Checkbox
              checked={linksAsEndReferences}
              disabled={copying}
              onCheckedChange={(checked) => onLinksAsEndReferencesChange(checked === true)}
            />
            <span>{zh ? '链接转文末引用' : 'Convert links to end references'}</span>
          </label>
        </header>
        <Tabs defaultValue="preview" className="min-h-0 flex-1">
          <TabsList className="shrink-0 px-4">
            <TabsTrigger value="preview">{zh ? '预览' : 'Preview'}</TabsTrigger>
            <TabsTrigger value="debug">{zh ? '调试' : 'Debug'}</TabsTrigger>
          </TabsList>
          <TabsContent value="preview" className="min-h-0 flex-1 overflow-hidden">
            {preview.value ? (
              <div className="size-full overflow-auto bg-surface-sunken p-5">
                <iframe
                  key={`${linksAsEndReferences}`}
                  srcDoc={previewDocument(preview.value.html)}
                  title={zh ? '公众号正文预览' : 'WeChat article body preview'}
                  sandbox=""
                  referrerPolicy="no-referrer"
                  allow=""
                  className="mx-auto block h-full w-[min(100%,430px)] border bg-background"
                />
              </div>
            ) : (
              <div className="grid size-full place-items-center p-6 text-destructive" role="alert">
                <div className="flex max-w-md items-center gap-2 text-sm">
                  <CircleAlertIcon className="size-4 shrink-0" />
                  <span>{preview.error}</span>
                </div>
              </div>
            )}
          </TabsContent>
          <TabsContent value="debug" className="min-h-0 flex-1 overflow-hidden">
            {preview.value ? <WechatCopyDebug rendered={preview.value} /> : null}
          </TabsContent>
        </Tabs>
        <DialogFooter className="shrink-0 items-center border-t px-4 py-3 sm:justify-between">
          <MetaText
            role={statusMessage ? 'alert' : undefined}
            className={statusMessage ? 'min-w-0 flex-1 break-words text-destructive' : 'min-w-0 flex-1'}
          >
            {statusMessage}
          </MetaText>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" disabled={copying} onClick={() => onOpenChange(false)}>
              {zh ? '取消' : 'Cancel'}
            </Button>
            <Button
              type="button"
              aria-busy={copying || undefined}
              disabled={copying || !preview.value || unavailableImages > 0}
              onClick={onCopy}
            >
              {copying ? <LoaderCircleIcon className="size-4 animate-spin" /> : <CopyIcon className="size-4" />}
              {copying
                ? zh
                  ? '正在复制'
                  : 'Copying'
                : copyError
                  ? zh
                    ? '重试复制'
                    : 'Retry copy'
                  : zh
                    ? '复制正文'
                    : 'Copy body'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ArticleWechatCopyAction({ locale, notify, onCopy }: Props) {
  const zh = locale === 'zh';
  const session = useArticleEditorSession();
  const hasBody = useArticleEditorSessionSelector(selectArticleEditorHasBody);
  const media = useArticleEditorSessionSelector(selectArticleEditorMedia);
  const [snapshot, setSnapshot] = useState<PreviewSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [linksAsEndReferences, setLinksAsEndReferences] = useState(true);
  const preview = useMemo(
    () => (snapshot ? renderPreview(snapshot, linksAsEndReferences, zh) : { value: null, error: null }),
    [linksAsEndReferences, snapshot, zh],
  );

  async function openPreview() {
    try {
      setCopyError(null);
      const content = session.captureSnapshot();
      const expanded = await window.desktopApi.contentLibrary.render(content.markdown);
      setSnapshot({
        content: {
          ...content,
          markdown: expanded.markdown,
          mediaBindings: [
            ...new Map(
              [
                ...content.mediaBindings,
                ...expanded.media.map((asset) => ({ path: asset.path, assetId: asset.assetId })),
              ].map((binding) => [binding.path, binding]),
            ).values(),
          ],
        },
        media: [
          ...new Map(
            [
              ...media,
              ...expanded.media.map((asset) => videoDocumentRevisionMediaSchema.parse({ ...asset, durationMs: null })),
            ].map((asset) => [asset.assetId, asset]),
          ).values(),
        ],
      });
      setOpen(true);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function changeOpen(nextOpen: boolean) {
    if (copying) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      setCopyError(null);
      setSnapshot(null);
    }
  }

  async function copy() {
    if (copying || !preview.value || preview.value.diagnostics.unavailableImageCount) return;
    setCopyError(null);
    setCopying(true);
    try {
      if (!(await session.flush('manual'))) {
        const save = session.model.getSnapshot().save;
        setCopyError(
          save.phase === 'conflict'
            ? zh
              ? '文章存在版本冲突，尚未复制。请先关闭预览并处理冲突。'
              : 'The article has a revision conflict and was not copied. Close the preview and resolve it first.'
            : save.phase === 'failed'
              ? zh
                ? `文章保存失败，尚未复制：${save.failure.message}`
                : `The article could not be saved and was not copied: ${save.failure.message}`
              : zh
                ? '文章尚未保存，未执行复制。请重试。'
                : 'The article was not saved, so nothing was copied. Try again.',
        );
        return;
      }
      await onCopy({ linksAsEndReferences, locale });
      setOpen(false);
      setSnapshot(null);
    } catch (reason) {
      setCopyError(copyFailureMessage(reason, zh));
    } finally {
      setCopying(false);
    }
  }

  return (
    <>
      <ArticleHeaderIconButton
        variant="ghost"
        disabled={!hasBody || copying}
        label={zh ? '复制公众号正文' : 'Copy for WeChat'}
        onClick={openPreview}
      >
        {copying ? <LoaderCircleIcon className="size-4 animate-spin" /> : <CopyIcon className="size-4" />}
      </ArticleHeaderIconButton>
      {snapshot && (
        <WechatCopyDialog
          copyError={copyError}
          copying={copying}
          linksAsEndReferences={linksAsEndReferences}
          open={open}
          preview={preview}
          zh={zh}
          onCopy={() => void copy()}
          onLinksAsEndReferencesChange={setLinksAsEndReferences}
          onOpenChange={changeOpen}
        />
      )}
    </>
  );
}
