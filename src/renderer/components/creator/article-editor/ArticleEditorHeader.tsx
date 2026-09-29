import {
  CircleAlertIcon,
  CopyIcon,
  DownloadIcon,
  FileTextIcon,
  ImagePlusIcon,
  LoaderCircleIcon,
  PlusIcon,
  TextCursorInputIcon,
  TypeIcon,
  XIcon,
} from 'lucide-react';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { ArticleTextCoverDialog } from '@/renderer/components/creator/article-editor/ArticleTextCoverDialog';
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
import { useI18n } from '@/renderer/i18n/useI18n';
import { CreationWorkNavigation } from '@/renderer/components/creator/CreationWorkNavigation';
import { ContentViewMenu } from '@/renderer/features/content-editor/ContentViewMenu';

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

export function ArticleHeaderAiActions({ checkAction }: { checkAction: ReactNode }) {
  return (
    <>
      {checkAction}
      <Separator orientation="vertical" className="mx-1 h-4" />
    </>
  );
}

export function ArticleHeaderViewMenu({
  splitOpen,
  wide,
  onSplitToggle,
  onWidthToggle,
}: {
  splitOpen: boolean;
  wide: boolean;
  onSplitToggle(): void;
  onWidthToggle(): void;
}) {
  return (
    <ContentViewMenu
      width={wide ? 'WIDE' : 'STANDARD'}
      onWidthChange={(width) => {
        if ((width === 'WIDE') !== wide) onWidthToggle();
      }}
      splitOpen={splitOpen}
      onSplitToggle={onSplitToggle}
    />
  );
}

export function SuggestedArticleTitle({
  onApply,
  onDismiss,
  title,
}: {
  onApply(): void;
  onDismiss(): void;
  title: string;
}) {
  const labels = useI18n().messages.creator.manuscriptEditor;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <TextCursorInputIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
      <Button type="button" variant="outline" size="sm" onClick={onApply}>
        {labels.apply}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={labels.dismiss}
        title={labels.dismiss}
        onClick={onDismiss}
      >
        <XIcon className="size-4" />
      </Button>
    </div>
  );
}

export function ArticleHeaderActions({
  copyForAgentAction,
  copyForWechatAction,
  creatingForm,
  exporting,
  generatingHeader,
  hasBody,
  relationCount,
  onCreateArticle,
  onExport,
  onGenerateHeader,
  onOpenRelations,
}: {
  copyForAgentAction: ReactNode;
  copyForWechatAction: ReactNode;
  creatingForm: boolean;
  exporting: boolean;
  generatingHeader: boolean;
  hasBody: boolean;
  relationCount: number;
  onCreateArticle(copySourceContent: boolean): Promise<void>;
  onExport(): Promise<void>;
  onGenerateHeader(): Promise<void>;
  onOpenRelations(): void;
}) {
  const labels = useI18n().messages.creator.manuscriptEditor;
  const derivativeLabel = labels.newDerivative;
  const textCoverLabel = useI18n().messages.contentEditor.textCover.generate;
  const [textCoverOpen, setTextCoverOpen] = useState(false);
  const exportLabel = labels.exportMarkdown;

  return (
    <>
      <Separator orientation="vertical" className="mx-1 h-4" />
      <CreationWorkNavigation relationsAction={{ count: relationCount, onOpen: onOpenRelations }} />
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
            {labels.newHeroImage}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={creatingForm} onSelect={() => setTextCoverOpen(true)}>
            <DropdownMenuIcon>
              <TypeIcon />
            </DropdownMenuIcon>
            {textCoverLabel}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={creatingForm || generatingHeader} onSelect={() => void onCreateArticle(false)}>
            <DropdownMenuIcon>
              <FileTextIcon />
            </DropdownMenuIcon>
            {labels.newManuscript}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={creatingForm || generatingHeader} onSelect={() => void onCreateArticle(true)}>
            <DropdownMenuIcon>
              <CopyIcon />
            </DropdownMenuIcon>
            {labels.forkManuscript}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {copyForWechatAction}
      {textCoverOpen && <ArticleTextCoverDialog onClose={() => setTextCoverOpen(false)} />}
      {copyForAgentAction}
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
  onRetry,
}: {
  conflict: boolean;
  dirty: boolean;
  failed: boolean;
  saving: boolean;
  onRetry(): void;
}) {
  const labels = useI18n().messages.creator.manuscriptEditor;
  const idle = !conflict && !dirty && !failed && !saving;
  return (
    <div className="grid size-6 shrink-0 place-items-center text-muted-foreground" aria-hidden={idle || undefined}>
      {saving ? (
        <LoaderCircleIcon className="size-4 animate-spin" aria-label={labels.autosaving} />
      ) : conflict ? (
        <CircleAlertIcon className="size-4 text-destructive" aria-label={labels.revisionConflict} />
      ) : failed ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-6 text-destructive"
          title={labels.autosaveFailed}
          aria-label={labels.retryAutosave}
          onClick={onRetry}
        >
          <CircleAlertIcon className="size-4" />
        </Button>
      ) : dirty ? (
        <span className="size-1.5 rounded-full bg-muted-foreground" title={labels.waitingToAutosave} />
      ) : null}
    </div>
  );
}
