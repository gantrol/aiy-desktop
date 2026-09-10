import { useI18n } from '@/renderer/i18n/useI18n';
import { CreationWorkNavigation } from '@/renderer/components/creator/CreationWorkNavigation';
import type { ReactNode } from 'react';
import { ChevronDownIcon, CircleAlertIcon, CopyIcon, FileTextIcon, LoaderCircleIcon, PlusIcon } from 'lucide-react';
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
import type { BrowserCompanionTarget, BrowserCompanionWatermarkSelection } from '@/shared/contracts';

interface Props {
  pinAction?: ReactNode;
  conflicted?: boolean;
  creatingForm: boolean;
  generatingCover: boolean;
  dirty: boolean;
  handingOff: boolean;
  handoffTargets: readonly BrowserCompanionTarget[];
  watermarkAvailable: boolean;
  onCreateArticle(copySourceContent: boolean): void;
  onHandoff(target: BrowserCompanionTarget, watermark: BrowserCompanionWatermarkSelection): void;
  onRetrySave(): void;
  saveFailed: boolean;
  saving: boolean;
  title: string;
  zh: boolean;
}

function SocialPostSaveStatus({
  conflicted,
  dirty,
  onRetrySave,
  saveFailed,
  saving,
}: {
  conflicted?: boolean;
  dirty: boolean;
  onRetrySave(): void;
  saveFailed: boolean;
  saving: boolean;
}) {
  const socialCopy = useI18n().messages.creator.socialPostEditor;
  if (conflicted)
    return (
      <span role="status" title={socialCopy.saveConflict}>
        <CircleAlertIcon className="size-4 text-destructive" />
      </span>
    );
  if (!saving && !saveFailed && !dirty) return null;

  return (
    <div className="grid size-6 place-items-center text-muted-foreground">
      {saving ? (
        <LoaderCircleIcon className="size-4 animate-spin" aria-label={socialCopy.saving} />
      ) : saveFailed ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-6 text-destructive"
          title={socialCopy.saveFailed}
          aria-label={socialCopy.retrySave}
          onClick={onRetrySave}
        >
          <CircleAlertIcon className="size-4" />
        </Button>
      ) : (
        <span className="size-1.5 rounded-full bg-muted-foreground" title={socialCopy.saveWaiting} />
      )}
    </div>
  );
}

export function SocialPostHeader({
  pinAction,
  conflicted,
  creatingForm,
  generatingCover,
  dirty,
  handingOff,
  handoffTargets,
  watermarkAvailable,
  onCreateArticle,
  onHandoff,
  onRetrySave,
  saveFailed,
  saving,
  title,
  zh,
}: Props) {
  const socialCopy = useI18n().messages.creator.socialPostEditor;
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-semibold">{title || socialCopy.untitledPost}</span>
        <span className="text-xs text-muted-foreground">{socialCopy.socialPost}</span>
        <SocialPostSaveStatus
          conflicted={conflicted}
          dirty={dirty}
          onRetrySave={onRetrySave}
          saveFailed={saveFailed}
          saving={saving}
        />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {pinAction}
        <CreationWorkNavigation />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              data-action="content-create-menu"
              variant="outline"
              size="sm"
              disabled={creatingForm || generatingCover}
              aria-busy={creatingForm || undefined}
            >
              {creatingForm ? <LoaderCircleIcon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
              {socialCopy.create}
              <ChevronDownIcon className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem
              data-action="copy-social-post-to-manuscript"
              disabled={creatingForm || generatingCover}
              onSelect={() => onCreateArticle(true)}
            >
              <DropdownMenuIcon>
                <CopyIcon />
              </DropdownMenuIcon>
              {socialCopy.forkManuscript}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={creatingForm || generatingCover} onSelect={() => onCreateArticle(false)}>
              <DropdownMenuIcon>
                <FileTextIcon />
              </DropdownMenuIcon>
              {socialCopy.newManuscript}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <CompanionHandoffMenu
          disabled={handingOff || creatingForm || generatingCover}
          busy={handingOff}
          onHandoff={onHandoff}
          targets={handoffTargets}
          watermarkAvailable={watermarkAvailable}
          zh={zh}
        />
      </div>
    </header>
  );
}
