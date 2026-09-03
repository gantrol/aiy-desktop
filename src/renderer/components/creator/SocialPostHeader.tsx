import {
  ArrowRightIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CopyIcon,
  FileTextIcon,
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
import { CompanionHandoffMenu } from '@/renderer/features/browser-companion/CompanionHandoffMenu';
import type { BrowserCompanionTarget } from '@/shared/contracts';

interface Props {
  creatingForm: boolean;
  generatingCover: boolean;
  dirty: boolean;
  handingOff: boolean;
  handoffTargets: readonly BrowserCompanionTarget[];
  onCreateArticle(copySourceContent: boolean): void;
  onCreateSocialPost(copySourceContent: boolean): void;
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
    <div className="grid size-6 place-items-center text-muted-foreground">
      {saving ? (
        <LoaderCircleIcon className="size-4 animate-spin" aria-label={zh ? '正在自动保存' : 'Autosaving'} />
      ) : saveFailed ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-6 text-destructive"
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
        <SocialPostSaveStatus dirty={dirty} onRetrySave={onRetrySave} saveFailed={saveFailed} saving={saving} zh={zh} />
      </div>
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={creatingForm || generatingCover}
              aria-busy={creatingForm || undefined}
            >
              {creatingForm ? <LoaderCircleIcon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
              {zh ? '创建' : 'Create'}
              <ChevronDownIcon className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem disabled={creatingForm || generatingCover} onSelect={() => onCreateSocialPost(true)}>
              <DropdownMenuIcon>
                <CopyIcon />
              </DropdownMenuIcon>
              {zh ? '克隆贴图' : 'Fork social post'}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={creatingForm || generatingCover} onSelect={() => onCreateArticle(true)}>
              <DropdownMenuIcon>
                <ArrowRightIcon />
              </DropdownMenuIcon>
              {zh ? '转为文章' : 'Convert to article'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={creatingForm || generatingCover} onSelect={() => onCreateSocialPost(false)}>
              <DropdownMenuIcon>
                <PanelsTopLeftIcon />
              </DropdownMenuIcon>
              {zh ? '新建贴图' : 'New social post'}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={creatingForm || generatingCover} onSelect={() => onCreateArticle(false)}>
              <DropdownMenuIcon>
                <FileTextIcon />
              </DropdownMenuIcon>
              {zh ? '新建文章' : 'New article'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <CompanionHandoffMenu
          disabled={handingOff || creatingForm || generatingCover}
          busy={handingOff}
          onHandoff={onHandoff}
          targets={handoffTargets}
          zh={zh}
        />
      </div>
    </header>
  );
}
