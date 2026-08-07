import { useEffect, useState, type FormEvent } from 'react';
import {
  CheckIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  HardDriveIcon,
  ImagePlusIcon,
  LoaderCircleIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import type { LocalSpaceDescriptorDto, LocalSpaceRegistryDto, LocalSpaceSwitchResult } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Separator } from '@/renderer/components/ui/separator';

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
      <img className="size-full object-contain" src="./icon.png" alt="" />
      {coverUrl && (
        <img
          key={coverUrl}
          className="absolute inset-0 size-full object-contain"
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

export function LocalSpaceSwitcher({ spaceName, spaceCoverUrl, busy, transitioning, notify }: Props) {
  const { messages } = useI18n();
  const l = messages.space;
  const [open, setOpen] = useState(false);
  const [registry, setRegistry] = useState<LocalSpaceRegistryDto | null>(null);
  const [pending, setPending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const transitionPending = pending || transitioning;
  const currentSpace = registry?.spaces.find((space) => space.isCurrent) ?? null;
  const currentCoverUrl = currentSpace ? currentSpace.coverUrl : spaceCoverUrl;

  useEffect(() => {
    if (!open) return;
    void window.desktopApi
      .localSpacesList()
      .then(setRegistry)
      .catch((reason) => notify(reason instanceof Error ? reason.message : String(reason)));
  }, [open, notify]);

  useEffect(() => {
    if (transitioning) setOpen(false);
  }, [transitioning]);

  async function run(action: () => Promise<LocalSpaceSwitchResult>) {
    if (transitionPending || busy) return;
    setPending(true);
    try {
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

  return (
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
        <Button
          type="button"
          variant="ghost"
          disabled={transitionPending || busy}
          className="h-9 w-full justify-start gap-2 px-2 font-normal"
          onClick={() => void run(() => window.desktopApi.localSpacesOpen())}
        >
          <FolderOpenIcon className="size-3.5" />
          {l.openSpace}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
