import {
  ArrowRightIcon,
  CircleAlertIcon,
  CopyIcon,
  FileTextIcon,
  ImagePlusIcon,
  LoaderCircleIcon,
  PanelsTopLeftIcon,
  PlusIcon,
} from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { CompanionHandoffButton } from '@/renderer/features/browser-companion/CompanionHandoffButton';
import type { BrowserCompanionTarget } from '@/shared/contracts';

interface Props {
  creatingForm: boolean;
  generatingCover: boolean;
  dirty: boolean;
  handingOff: boolean;
  handoffTargets: readonly BrowserCompanionTarget[];
  onCreateArticle(copySourceContent: boolean): void;
  onCreateSocialPost(copySourceContent: boolean): void;
  onGenerateCover(): void;
  onHandoff(target: BrowserCompanionTarget): void;
  onRetrySave(): void;
  saveFailed: boolean;
  saving: boolean;
  title: string;
  zh: boolean;
}

function SocialPostSaveStatus({
  dirty,
  onRetrySave,
  saveFailed,
  saving,
  zh,
}: {
  dirty: boolean;
  onRetrySave(): void;
  saveFailed: boolean;
  saving: boolean;
  zh: boolean;
}) {
  if (!saving && !saveFailed && !dirty) return null;

  return (
    <div className="grid size-8 place-items-center text-muted-foreground">
      {saving ? (
        <LoaderCircleIcon className="size-4 animate-spin" aria-label={zh ? '正在自动保存' : 'Autosaving'} />
      ) : saveFailed ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-destructive"
          title={zh ? '自动保存失败，点击重试' : 'Autosave failed. Retry'}
          aria-label={zh ? '重试自动保存' : 'Retry autosave'}
          onClick={onRetrySave}
        >
          <CircleAlertIcon className="size-4" />
        </Button>
      ) : (
        <span
          className="size-1.5 rounded-full bg-muted-foreground"
          title={zh ? '等待自动保存' : 'Waiting to autosave'}
        />
      )}
    </div>
  );
}

export function SocialPostHeader({
  creatingForm,
  generatingCover,
  dirty,
  handingOff,
  handoffTargets,
  onCreateArticle,
  onCreateSocialPost,
  onGenerateCover,
  onHandoff,
  onRetrySave,
  saveFailed,
  saving,
  title,
  zh,
}: Props) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-semibold">{title || (zh ? '未命名贴图' : 'Untitled post')}</span>
        <span className="text-xs text-muted-foreground">{zh ? '贴图' : 'Social post'}</span>
      </div>
      <div className="flex items-center gap-1">
        <CompanionHandoffButton
          disabled={handingOff || creatingForm || generatingCover}
          busy={handingOff}
          onHandoff={onHandoff}
          targets={handoffTargets}
          zh={zh}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={zh ? '新建衍生' : 'New derivative'}
              title={zh ? '新建衍生' : 'New derivative'}
              aria-busy={creatingForm || generatingCover || undefined}
            >
              {creatingForm || generatingCover ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : (
                <PlusIcon className="size-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem disabled={generatingCover || creatingForm} onSelect={onGenerateCover}>
              <DropdownMenuIcon>
                <ImagePlusIcon />
              </DropdownMenuIcon>
              {zh ? '新建封面贴图' : 'New cover visual'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={creatingForm || generatingCover} onSelect={() => onCreateSocialPost(false)}>
              <DropdownMenuIcon>
                <PanelsTopLeftIcon />
              </DropdownMenuIcon>
              {zh ? '新建贴图' : 'New social post'}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={creatingForm || generatingCover} onSelect={() => onCreateSocialPost(true)}>
              <DropdownMenuIcon>
                <CopyIcon />
              </DropdownMenuIcon>
              {zh ? '克隆贴图' : 'Fork social post'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={creatingForm || generatingCover} onSelect={() => onCreateArticle(false)}>
              <DropdownMenuIcon>
                <FileTextIcon />
              </DropdownMenuIcon>
              {zh ? '新建文章' : 'New article'}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={creatingForm || generatingCover} onSelect={() => onCreateArticle(true)}>
              <DropdownMenuIcon>
                <ArrowRightIcon />
              </DropdownMenuIcon>
              {zh ? '转为文章' : 'Convert to article'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <SocialPostSaveStatus dirty={dirty} onRetrySave={onRetrySave} saveFailed={saveFailed} saving={saving} zh={zh} />
      </div>
    </header>
  );
}
