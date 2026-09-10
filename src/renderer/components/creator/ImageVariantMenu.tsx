import { useRef, useState } from 'react';
import { FileTextIcon, FilmIcon, GitBranchIcon, PlusIcon } from 'lucide-react';
import type { AssetDto } from '@/shared/contracts';
import type { ImageContentVariantKind } from '@/renderer/components/creator/workflows/useCreatorImageVariantWorkflow';
import type { GifAdoptionTarget, GifDocumentSummary } from '@/shared/contracts/gif-making';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { useGifMakerLauncher } from '@/renderer/features/gif-making/GifMakerProvider';
import { useI18n } from '@/renderer/i18n/useI18n';
import { creationWorkTitleSuffixes } from '@/renderer/components/creator/creationWorkTitles';

export function ImageVariantMenu({
  seriesId,
  asset,
  animations,
  adoptionTarget,
  beforeOpen,
  onCreateContent,
  notify,
  menuOpen,
  onMenuOpenChange,
  animationLauncher,
}: {
  seriesId: string | null;
  asset: AssetDto | null;
  animations: readonly GifDocumentSummary[];
  adoptionTarget?: GifAdoptionTarget;
  beforeOpen(): Promise<boolean>;
  onCreateContent(kind: ImageContentVariantKind, asset: AssetDto, seriesId: string): Promise<void>;
  notify(message: string): void;
  menuOpen?: boolean;
  onMenuOpenChange?(open: boolean): void;
  animationLauncher?: NonNullable<ReturnType<typeof useGifMakerLauncher>>;
}) {
  const workspaceLauncher = useGifMakerLauncher();
  const launcher = animationLauncher ?? workspaceLauncher;
  const { messages } = useI18n();
  const labels = messages.creator.workNavigation;
  const existing = seriesId
    ? animations.filter((animation) => animation.purpose === 'GIF' && animation.seriesId === seriesId)
    : [];
  const suffixes = creationWorkTitleSuffixes(
    existing.map((animation) => ({ id: animation.id, title: animation.title || messages.creator.gifMaker.untitled })),
  );
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const run = async (operation: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    try {
      if ((await beforeOpen()) && (!launcher || launcher.isCurrent())) await operation();
    } catch {
      notify(labels.openFailed);
    } finally {
      lock.current = false;
      setPending(false);
    }
  };
  const open = (documentId?: string) =>
    run(async () => {
      if (launcher && (documentId || asset))
        await launcher.open({ documentId, forceNew: !documentId, seriesId, assetId: asset?.id, adoptionTarget });
    });
  const createContent = (kind: ImageContentVariantKind) =>
    run(async () => {
      if (asset && seriesId) await onCreateContent(kind, asset, seriesId);
    });
  return (
    <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={labels.makeVariant}
          aria-label={labels.makeVariant}
          data-action="make-variant"
          disabled={(!asset && !existing.length) || pending}
        >
          <GitBranchIcon className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 min-w-52 max-w-[calc(100vw-2rem)] overflow-y-auto">
        <DropdownMenuItem
          data-action="new-animation-variant"
          disabled={!asset || !launcher || launcher.busy}
          onSelect={() => void open()}
        >
          <PlusIcon className="size-4" />
          {labels.newAnimationVariant}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!asset || !seriesId} onSelect={() => void createContent('manuscript')}>
          <FileTextIcon className="size-4" />
          {labels.newManuscriptVariant}
        </DropdownMenuItem>
        {existing.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{labels.savedAnimations}</DropdownMenuLabel>
            {existing.map((animation) => (
              <DropdownMenuItem
                key={animation.id}
                disabled={!launcher || launcher.busy}
                title={animation.title || messages.creator.gifMaker.untitled}
                onSelect={() => void open(animation.id)}
              >
                <FilmIcon className="size-4" />
                <span className="max-w-64 truncate">{animation.title || messages.creator.gifMaker.untitled}</span>
                {suffixes.has(animation.id) && (
                  <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                    {suffixes.get(animation.id)}
                  </span>
                )}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
