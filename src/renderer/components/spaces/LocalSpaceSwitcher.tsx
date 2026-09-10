import { useEffect, useState, type FormEvent } from 'react';
import {
  ArchiveRestoreIcon,
  CheckIcon,
  DownloadIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  HardDriveIcon,
  ImagePlusIcon,
  LoaderCircleIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';
import type {
  LegacyLocalSpaceCandidateDto,
  LocalSpaceDescriptorDto,
  LocalSpaceRegistryDto,
  LocalSpaceSwitchResult,
} from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { AiyIdentity } from '@/renderer/components/brand/AiyIdentity';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Separator } from '@/renderer/components/ui/separator';
import { LegacySpaceMigrationDialog } from '@/renderer/components/spaces/LegacySpaceMigrationDialog';
import {
  LocalSpaceTransferDialog,
  type LocalSpaceTransferOperation,
} from '@/renderer/components/spaces/LocalSpaceTransferDialog';
import { useArticleEditorSessionFlush } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';

interface Props {
  spaceName: string;
  spaceCoverUrl: string | null;
  busy: boolean;
  transitioning: boolean;
  notify(message: string): void;
}

function SpaceCover({ coverUrl, className }: { coverUrl: string | null; className?: string }) {
  return (
    <span className={cn('relative grid shrink-0 place-items-center overflow-hidden bg-background', className)}>
      <AiyIdentity avatar className="size-full" />
      {coverUrl && (
        <img
          key={coverUrl}
          className="absolute inset-0 size-full object-cover"
          src={coverUrl}
          alt=""
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      )}
    </span>
  );
}

function SpaceDataActions({
  disabled,
  hasLegacy,
  onOpenSpace,
  onTransfer,
  onMigrate,
}: {
  disabled: boolean;
  hasLegacy: boolean;
  onOpenSpace(): void;
  onTransfer(operation: LocalSpaceTransferOperation): void;
  onMigrate(): void;
}) {
  const { messages } = useI18n();
  const copy = messages.space;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        disabled={disabled}
        className="h-9 w-full justify-start gap-2 px-2 font-normal"
        onClick={onOpenSpace}
      >
        <FolderOpenIcon className="size-3.5" />
        {copy.openSpace}
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={disabled}
        className="h-9 w-full justify-start gap-2 px-2 font-normal"
        onClick={() => onTransfer('EXPORT')}
      >
        <DownloadIcon className="size-3.5" />
        {copy.transfer.exportAction}
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={disabled}
        className="h-9 w-full justify-start gap-2 px-2 font-normal"
        onClick={() => onTransfer('IMPORT')}
      >
        <UploadIcon className="size-3.5" />
        {copy.transfer.importAction}
      </Button>
      {hasLegacy && (
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          className="h-9 w-full justify-start gap-2 px-2 font-normal"
          onClick={onMigrate}
        >
          <ArchiveRestoreIcon className="size-3.5" />
          {copy.migration.action}
        </Button>
      )}
    </>
  );
}

export function LocalSpaceSwitcher({ spaceName, spaceCoverUrl, busy, transitioning, notify }: Props) {
  const { messages } = useI18n();
  const flushArticleEditors = useArticleEditorSessionFlush();
  const l = messages.space;
  const [open, setOpen] = useState(false);
  const [registry, setRegistry] = useState<LocalSpaceRegistryDto | null>(null);
  const [pending, setPending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [legacyCandidates, setLegacyCandidates] = useState<LegacyLocalSpaceCandidateDto[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferRequestId, setTransferRequestId] = useState(0);
  const [transferOperation, setTransferOperation] = useState<LocalSpaceTransferOperation>('EXPORT');
  const [name, setName] = useState('');
  const transitionPending = pending || transitioning;
  const currentSpace = registry?.spaces.find((space) => space.isCurrent) ?? null;
  const currentCoverUrl = currentSpace ? currentSpace.coverUrl : spaceCoverUrl;

  useEffect(() => {
    if (!open) return;
    void Promise.all([window.desktopApi.localSpacesList(), window.desktopApi.localSpacesDiscoverLegacy()])
      .then(([nextRegistry, candidates]) => {
        setRegistry(nextRegistry);
        setLegacyCandidates(candidates);
      })
      .catch((reason) => notify(reason instanceof Error ? reason.message : String(reason)));
  }, [open, notify]);

  useEffect(() => {
    if (transitioning) {
      setOpen(false);
      setMigrationOpen(false);
      setTransferOpen(false);
    }
  }, [transitioning]);

  async function run(action: () => Promise<LocalSpaceSwitchResult>) {
    if (transitionPending || busy) return;
    setPending(true);
    try {
      if (!(await flushArticleEditors())) {
        setPending(false);
        return;
      }
      const result = await action();
      if (result.status === 'switched') {
        setRegistry(null);
        setOpen(false);
        setPending(false);
        return;
      }
      setPending(false);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
      setPending(false);
    }
  }

  function submitCreate(event: FormEvent) {
    event.preventDefault();
    const normalized = name.trim();
    if (!normalized) return;
    void run(() => window.desktopApi.localSpacesCreate(normalized));
  }

  function updateSpace(updated: LocalSpaceDescriptorDto) {
    setRegistry((current) =>
      current
        ? {
            ...current,
            spaces: current.spaces.map((space) => (space.id === updated.id ? updated : space)),
          }
        : current,
    );
  }

  async function chooseCover() {
    if (transitionPending || !currentSpace) return;
    setPending(true);
    try {
      const result = await window.desktopApi.localSpacesChooseCover(currentSpace.id);
      if (result.status === 'updated') {
        updateSpace(result.space);
        notify(l.coverUpdated);
      }
    } catch {
      notify(l.coverUpdateFailed);
    } finally {
      setPending(false);
    }
  }

  async function removeCover() {
    if (transitionPending || !currentSpace?.coverUrl) return;
    setPending(true);
    try {
      updateSpace(await window.desktopApi.localSpacesRemoveCover(currentSpace.id));
      notify(l.coverRemoved);
    } catch {
      notify(l.coverUpdateFailed);
    } finally {
      setPending(false);
    }
  }

  function beginTransfer(operation: LocalSpaceTransferOperation) {
    if (transitionPending || busy) return;
    setOpen(false);
    setTransferOperation(operation);
    setTransferRequestId((current) => current + 1);
    setTransferOpen(true);
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setCreating(false);
            setName('');
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            data-action="local-space-switcher"
            disabled={transitionPending}
            aria-busy={transitionPending}
            className="flex h-16 w-14 flex-col items-center justify-center gap-1 rounded-xl text-muted-foreground outline-none transition-colors duration-fast hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label={l.switchSpace}
            title={spaceName}
          >
            {transitionPending ? (
              <span className="grid size-10 place-items-center rounded-xl border bg-background">
                <LoaderCircleIcon className="size-5 animate-spin" />
              </span>
            ) : (
              <SpaceCover coverUrl={currentCoverUrl} className="size-10 rounded-xl border" />
            )}
            <span className="w-full truncate px-1 text-[10px] leading-none">{spaceName}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" className="w-72 p-1.5">
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium">
            <HardDriveIcon className="size-3.5" />
            {l.localSpaces}
          </div>
          <div className="grid gap-0.5">
            {registry?.spaces.map((space) => (
              <Button
                key={space.id}
                type="button"
                variant="ghost"
                disabled={transitionPending || busy || space.isCurrent || !space.available}
                aria-current={space.isCurrent ? 'true' : undefined}
                className={cn(
                  'h-9 justify-start gap-2 border-l-4 border-transparent px-2 font-normal',
                  space.isCurrent &&
                    'border-selected-foreground bg-selected text-selected-foreground hover:bg-selected disabled:bg-selected disabled:text-selected-foreground',
                )}
                onClick={() => void run(() => window.desktopApi.localSpacesSwitch(space.id))}
              >
                <SpaceCover coverUrl={space.coverUrl} className="size-7 rounded-md border" />
                <span className="min-w-0 flex-1 truncate text-left">{space.name}</span>
                {!space.available && <span className="text-[10px] text-destructive">{l.unavailable}</span>}
                <CheckIcon className={cn('size-3.5', !space.isCurrent && 'invisible')} />
              </Button>
            ))}
          </div>
          <Separator className="my-1" />
          <Button
            type="button"
            variant="ghost"
            disabled={transitionPending || !currentSpace}
            className="h-9 w-full justify-start gap-2 px-2 font-normal"
            onClick={() => void chooseCover()}
          >
            <ImagePlusIcon className="size-3.5" />
            {currentCoverUrl ? l.changeCover : l.chooseCover}
          </Button>
          {currentCoverUrl && (
            <Button
              type="button"
              variant="ghost"
              disabled={transitionPending || !currentSpace?.coverUrl}
              className="h-9 w-full justify-start gap-2 px-2 font-normal text-destructive hover:text-destructive"
              onClick={() => void removeCover()}
            >
              <Trash2Icon className="size-3.5" />
              {l.removeCover}
            </Button>
          )}
          <Separator className="my-1" />
          {creating ? (
            <form className="flex gap-1 p-1" onSubmit={submitCreate}>
              <Input
                autoFocus
                value={name}
                maxLength={200}
                aria-label={l.spaceName}
                placeholder={l.spaceName}
                onChange={(event) => setName(event.target.value)}
              />
              <Button
                type="submit"
                size="icon"
                disabled={transitionPending || busy || !name.trim()}
                aria-label={l.create}
              >
                <PlusIcon className="size-4" />
              </Button>
            </form>
          ) : (
            <Button
              type="button"
              variant="ghost"
              disabled={transitionPending || busy}
              className="h-9 w-full justify-start gap-2 px-2 font-normal"
              onClick={() => setCreating(true)}
            >
              <FolderPlusIcon className="size-3.5" />
              {l.newSpace}
            </Button>
          )}
          <SpaceDataActions
            disabled={transitionPending || busy}
            hasLegacy={legacyCandidates.length > 0}
            onOpenSpace={() => void run(() => window.desktopApi.localSpacesOpen())}
            onTransfer={beginTransfer}
            onMigrate={() => {
              setOpen(false);
              setMigrationOpen(true);
            }}
          />
        </PopoverContent>
      </Popover>
      <LegacySpaceMigrationDialog
        open={migrationOpen}
        candidates={legacyCandidates}
        onOpenChange={setMigrationOpen}
        onSwitched={() => setMigrationOpen(false)}
        notify={notify}
      />
      <LocalSpaceTransferDialog
        open={transferOpen}
        requestId={transferRequestId}
        operation={transferOperation}
        onOpenChange={setTransferOpen}
        onSwitched={() => setTransferOpen(false)}
        notify={notify}
      />
    </>
  );
}
