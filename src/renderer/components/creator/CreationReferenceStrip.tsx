import { useEffect, useRef, useState } from 'react';
import type { AssetDto, AssetFileRevealContext, TermListItem } from '@/shared/contracts';
import {
  resolveLocalizedName,
  resolveWordPaletteOptionLabel,
  resolveWordPaletteParameterName,
} from '@/shared/word-palette-localization';
import { CloseIcon, DictionaryIcon, ImageIcon } from '@/renderer/icons';
import { TermPreviewTooltip } from '@/renderer/components/media/TermPreviewTooltip';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/renderer/components/ui/popover';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import type { AppliedWordPalette, CreatorPromptResolution } from '@/renderer/components/creator/utils';

interface Props {
  assets: AssetDto[];
  promptResolution: CreatorPromptResolution;
  removeLabel: string;
  onRemoveAsset(id: string): void;
  onRemovePalette(id: string): void;
  onRemoveTerm(term: TermListItem): void;
  onOpenPalette(id: string): void;
  onOpenTerm(term: TermListItem): void;
  notify(message: string): void;
  revealContext?: AssetFileRevealContext;
  hidePromptMaterials?: boolean;
}

function paletteLabel(reference: AppliedWordPalette) {
  return resolveLocalizedName(reference.revision, reference.promptLocale);
}

function paletteParameters(reference: AppliedWordPalette) {
  return reference.revision.parameters.flatMap((parameter) => {
    const value = reference.parameterValues[parameter.stableKey];
    const option = parameter.options.find((item) => item.value === value);
    if (!option) return [];
    return [
      {
        id: parameter.id,
        name: resolveWordPaletteParameterName(parameter, reference.promptLocale),
        value: resolveWordPaletteOptionLabel(option, reference.promptLocale),
      },
    ];
  });
}

function RecipeSourceDetails({ reference, onOpenPalette }: { reference: AppliedWordPalette; onOpenPalette(): void }) {
  const parameters = paletteParameters(reference);
  return (
    <div className="grid max-h-80 gap-3 overflow-y-auto" data-recipe-source-details={reference.palette.id}>
      <header className="flex items-baseline justify-between gap-3">
        <Button
          data-action="open-word-palette-reference"
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto min-w-0 justify-start p-0 font-semibold shadow-none hover:bg-transparent"
          onClick={onOpenPalette}
        >
          {paletteLabel(reference)}
        </Button>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          V{reference.revision.revisionNo} · {reference.promptLocale.toUpperCase()}
        </span>
      </header>
      {parameters.length > 0 && (
        <div className="grid gap-1.5">
          {parameters.map((parameter) => (
            <div className="flex items-baseline justify-between gap-4 text-xs" key={parameter.id}>
              <span className="text-muted-foreground">{parameter.name}</span>
              <span className="text-right">{parameter.value}</span>
            </div>
          ))}
        </div>
      )}
      {reference.revision.terms.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {reference.revision.terms.map((term) => (
            <span className="rounded-full bg-muted px-2 py-1 text-xs" key={term.id}>
              {term.title}
            </span>
          ))}
        </div>
      )}
      <footer className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <DictionaryIcon className="size-3" />
          {reference.revision.terms.length}
        </span>
        <span className="inline-flex items-center gap-1">
          <ImageIcon className="size-3" />
          {reference.revision.referenceAssets.length}
        </span>
      </footer>
    </div>
  );
}

function RecipeSourceControl({
  useId,
  reference,
  removeLabel,
  onOpenPalette,
  onRemovePalette,
}: {
  useId: string;
  reference: AppliedWordPalette;
  removeLabel: string;
  onOpenPalette(id: string): void;
  onRemovePalette(id: string): void;
}) {
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  function show() {
    cancelClose();
    setOpen(true);
  }

  function closeSoon() {
    cancelClose();
    if (pinned.current) return;
    closeTimer.current = setTimeout(() => setOpen(false), 100);
  }

  function togglePinned() {
    pinned.current = !pinned.current;
    cancelClose();
    setOpen(pinned.current);
  }

  useEffect(() => () => cancelClose(), []);

  return (
    <span
      data-palette-id={reference.palette.id}
      data-recipe-use-id={useId}
      className="inline-flex h-8 max-w-full items-center overflow-hidden rounded-full border bg-background"
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (!next) pinned.current = false;
          setOpen(next);
        }}
      >
        <PopoverAnchor asChild>
          <Button
            data-action="expand-word-palette-reference"
            type="button"
            variant="ghost"
            size="sm"
            className="h-full min-w-0 rounded-none border-0 px-2.5 font-normal shadow-none"
            aria-expanded={open}
            onPointerEnter={show}
            onPointerLeave={closeSoon}
            onFocus={show}
            onBlur={closeSoon}
            onClick={togglePinned}
          >
            <DictionaryIcon className="size-3.5 shrink-0" />
            <span className="truncate">{paletteLabel(reference)}</span>
          </Button>
        </PopoverAnchor>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="w-96 max-w-[calc(100vw-2rem)]"
          onPointerEnter={show}
          onPointerLeave={closeSoon}
          onFocusCapture={show}
          onBlurCapture={closeSoon}
        >
          <RecipeSourceDetails reference={reference} onOpenPalette={() => onOpenPalette(reference.palette.id)} />
        </PopoverContent>
      </Popover>
      <Button
        data-action="remove-word-palette-reference"
        data-remove-source="recipe"
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7 shrink-0 rounded-full shadow-none"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={() => onRemovePalette(reference.palette.id)}
      >
        <CloseIcon className="size-3" />
      </Button>
    </span>
  );
}

export function CreationReferenceStrip({
  assets,
  promptResolution,
  removeLabel,
  onRemoveAsset,
  onRemovePalette,
  onRemoveTerm,
  onOpenPalette,
  onOpenTerm,
  notify,
  revealContext,
  hidePromptMaterials = false,
}: Props) {
  const directTerms = hidePromptMaterials
    ? []
    : promptResolution.effectiveTerms.filter(({ directSource }) => directSource);
  const recipeSources = hidePromptMaterials ? [] : promptResolution.recipeSources;
  if (!assets.length && !recipeSources.length && !directTerms.length) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
      {assets.map((asset) => (
        <AssetFileContextMenu assetId={asset.id} notify={notify} revealContext={revealContext} key={asset.id}>
          <span className="group relative isolate size-12 rounded-md bg-surface-sunken">
            <ImageAmbientBackdrop src={asset.mediaUrl} />
            <img className="relative z-10 size-full rounded-md object-contain" src={asset.mediaUrl} alt="" />
            <Button
              className="absolute -top-1.5 -right-1.5 z-20 size-6 rounded-full bg-overlay text-foreground opacity-0 shadow-overlay group-focus-within:opacity-100 group-hover:opacity-100"
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={removeLabel}
              onClick={() => onRemoveAsset(asset.id)}
            >
              <CloseIcon className="size-3" />
            </Button>
          </span>
        </AssetFileContextMenu>
      ))}
      <TooltipProvider delayDuration={280}>
        {directTerms.map(({ term, resolved, recipeUseIds }) => (
          <TermPreviewTooltip term={term} key={term.id}>
            <span
              data-effective-term-id={term.id}
              data-direct-source="true"
              data-recipe-source-count={recipeUseIds.length}
              className="inline-flex h-8 max-w-full items-center overflow-hidden rounded-full bg-secondary text-secondary-foreground"
            >
              <Button
                data-action="open-term-reference"
                type="button"
                variant="ghost"
                size="sm"
                className="h-full min-w-0 rounded-none border-0 px-3 font-normal shadow-none"
                onClick={() => onOpenTerm(term)}
              >
                <span className="truncate">{term.title}</span>
                {resolved.sourcePaths.length > 1 && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">×{resolved.sourcePaths.length}</span>
                )}
              </Button>
              <Button
                data-action="remove-term-reference"
                data-remove-source="direct"
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7 shrink-0 rounded-full shadow-none"
                aria-label={removeLabel}
                title={removeLabel}
                onClick={() => onRemoveTerm(term)}
              >
                <CloseIcon className="size-3" />
              </Button>
            </span>
          </TermPreviewTooltip>
        ))}
      </TooltipProvider>
      {recipeSources.map(({ useId, reference }) => (
        <RecipeSourceControl
          key={useId}
          useId={useId}
          reference={reference}
          removeLabel={removeLabel}
          onOpenPalette={onOpenPalette}
          onRemovePalette={onRemovePalette}
        />
      ))}
    </div>
  );
}
