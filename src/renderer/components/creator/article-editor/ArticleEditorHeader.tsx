import {
  ArrowRightIcon,
  CircleAlertIcon,
  CopyIcon,
  DownloadIcon,
  FileTextIcon,
  ImagePlusIcon,
  Link2Icon,
  LoaderCircleIcon,
  PanelsTopLeftIcon,
  PlusIcon,
  TextCursorInputIcon,
  XIcon,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { Separator } from '@/renderer/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/renderer/components/ui/tooltip';

export function ArticleHeaderIconButton({
  children,
  label,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children' | 'size'> & {
  children: ReactNode;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button type="button" {...props} size="icon-sm" aria-label={label}>
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

export function ArticleHeaderAiActions({
  checkAction,
  hasBody,
  suggesting,
  zh,
  onSuggestTitle,
}: {
  checkAction: ReactNode;
  hasBody: boolean;
  suggesting: boolean;
  zh: boolean;
  onSuggestTitle(): Promise<void>;
}) {
  const titleLabel = zh ? 'AI 起标题' : 'AI title';
  return (
    <>
      {checkAction}
      <ArticleHeaderIconButton
        variant="ghost"
        disabled={!hasBody || suggesting}
        label={titleLabel}
        onClick={() => void onSuggestTitle()}
      >
        {suggesting ? <LoaderCircleIcon className="size-4 animate-spin" /> : <TextCursorInputIcon className="size-4" />}
      </ArticleHeaderIconButton>
      <Separator orientation="vertical" className="mx-1 h-4" />
    </>
  );
}

export function SuggestedArticleTitle({
  onApply,
  onDismiss,
  title,
  zh,
}: {
  onApply(): void;
  onDismiss(): void;
  title: string;
  zh: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b bg-surface-sunken px-4 py-2">
      <TextCursorInputIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
      <Button type="button" variant="outline" size="sm" onClick={onApply}>
        {zh ? '采用' : 'Apply'}
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" title={zh ? '忽略' : 'Dismiss'} onClick={onDismiss}>
        <XIcon className="size-4" />
      </Button>
    </div>
  );
}

export function ArticleHeaderActions({
  copyForWechatAction,
  creatingForm,
  exporting,
  generatingHeader,
  hasBody,
  relationCount,
  zh,
  onCreateArticle,
  onCreateSocialPost,
  onExport,
  onGenerateHeader,
  onOpenRelations,
}: {
  copyForWechatAction: ReactNode;
  creatingForm: boolean;
  exporting: boolean;
  generatingHeader: boolean;
  hasBody: boolean;
  relationCount: number;
  zh: boolean;
  onCreateArticle(copySourceContent: boolean): Promise<void>;
  onCreateSocialPost(copySourceContent: boolean): Promise<void>;
  onExport(): Promise<void>;
  onGenerateHeader(): Promise<void>;
  onOpenRelations(): void;
}) {
  const relationsLabel = zh ? `关联 ${relationCount}` : `Related ${relationCount}`;
  const derivativeLabel = zh ? '新建衍生' : 'New derivative';
  const exportLabel = zh ? '导出 Markdown' : 'Export Markdown';

  return (
    <>
      <ArticleHeaderIconButton
        variant="ghost"
        disabled={!relationCount}
        label={relationsLabel}
        onClick={onOpenRelations}
      >
        <Link2Icon className="size-4" />
      </ArticleHeaderIconButton>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={derivativeLabel}
                aria-busy={generatingHeader || creatingForm || undefined}
              >
                {generatingHeader || creatingForm ? (
                  <LoaderCircleIcon className="size-4 animate-spin" />
                ) : (
                  <PlusIcon className="size-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">{derivativeLabel}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            disabled={!hasBody || generatingHeader || creatingForm}
            onSelect={() => void onGenerateHeader()}
          >
            <DropdownMenuIcon>
              <ImagePlusIcon />
            </DropdownMenuIcon>
            {zh ? '新建题图' : 'New hero image'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={creatingForm || generatingHeader} onSelect={() => void onCreateArticle(false)}>
            <DropdownMenuIcon>
              <FileTextIcon />
            </DropdownMenuIcon>
            {zh ? '新建文章' : 'New article'}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={creatingForm || generatingHeader} onSelect={() => void onCreateArticle(true)}>
            <DropdownMenuIcon>
              <CopyIcon />
            </DropdownMenuIcon>
            {zh ? '克隆文章' : 'Fork article'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={creatingForm || generatingHeader} onSelect={() => void onCreateSocialPost(false)}>
            <DropdownMenuIcon>
              <PanelsTopLeftIcon />
            </DropdownMenuIcon>
            {zh ? '新建贴图' : 'New social post'}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={creatingForm || generatingHeader} onSelect={() => void onCreateSocialPost(true)}>
            <DropdownMenuIcon>
              <ArrowRightIcon />
            </DropdownMenuIcon>
            {zh ? '转为贴图' : 'Convert to social post'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {copyForWechatAction}
      <ArticleHeaderIconButton variant="ghost" disabled={exporting} label={exportLabel} onClick={() => void onExport()}>
        {exporting ? <LoaderCircleIcon className="size-4 animate-spin" /> : <DownloadIcon className="size-4" />}
      </ArticleHeaderIconButton>
    </>
  );
}

export function ArticleSaveStatus({
  conflict,
  dirty,
  failed,
  saving,
  zh,
  onRetry,
}: {
  conflict: boolean;
  dirty: boolean;
  failed: boolean;
  saving: boolean;
  zh: boolean;
  onRetry(): void;
}) {
  const idle = !conflict && !dirty && !failed && !saving;
  return (
    <div className="grid size-6 shrink-0 place-items-center text-muted-foreground" aria-hidden={idle || undefined}>
      {saving ? (
        <LoaderCircleIcon className="size-4 animate-spin" aria-label={zh ? '正在自动保存' : 'Autosaving'} />
      ) : conflict ? (
        <CircleAlertIcon
          className="size-4 text-destructive"
          aria-label={zh ? '文章存在版本冲突' : 'Article revision conflict'}
        />
      ) : failed ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-6 text-destructive"
          title={zh ? '自动保存失败，点击重试' : 'Autosave failed. Retry'}
          aria-label={zh ? '重试自动保存' : 'Retry autosave'}
          onClick={onRetry}
        >
          <CircleAlertIcon className="size-4" />
        </Button>
      ) : dirty ? (
        <span
          className="size-1.5 rounded-full bg-muted-foreground"
          title={zh ? '等待自动保存' : 'Waiting to autosave'}
        />
      ) : null}
    </div>
  );
}
