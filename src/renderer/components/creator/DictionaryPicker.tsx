import { useEffect, useMemo, useState } from 'react';
import { XIcon } from 'lucide-react';
import type {
  FacetDefinitionDto,
  HistoricalTermRecommendationRunDto,
  Locale,
  TermListItem,
  WordPaletteDto,
} from '@/shared/contracts';
import { SearchIcon } from '@/renderer/icons';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { SaveWordPaletteDialog } from '@/renderer/components/palette/SaveWordPaletteDialog';
import { WordPaletteLibrary } from '@/renderer/components/palette/WordPaletteLibrary';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { WordPalette } from '@/renderer/components/dictionary/WordPalette';

interface Props {
  locale: Locale;
  query: string;
  terms: TermListItem[];
  facets: FacetDefinitionDto[];
  palettes: WordPaletteDto[];
  selectedTerms: TermListItem[];
  focusTarget?: DictionaryFocusTarget | null;
  scopeMode?: 'ALL' | 'SELECTED';
  albumScopeAvailable?: boolean;
  draggableMaterials?: boolean;
  recommendationRuns?: HistoricalTermRecommendationRunDto[];
  recommendationSelectedTermIds?: string[];
  recommendationBusy?: boolean;
  recommendationAvailable?: boolean;
  layout?: 'popover' | 'sidebar';
  onQueryChange(value: string): void;
  onToggle(term: TermListItem): void;
  onClear(): void;
  onPaletteApply(palette: WordPaletteDto): void;
  onPaletteView?(palette: WordPaletteDto): void;
  onPaletteCreated(palette: WordPaletteDto): void;
  onScopeModeChange?(mode: 'ALL' | 'SELECTED'): void;
  onRecommendFromHistory?(): void | Promise<void>;
  onAddRecommendation?(termId: string): void;
  onClose?(): void;
  notify(message: string): void;
}

export type DictionaryFocusTarget = { kind: 'term'; id: string } | { kind: 'palette'; id: string };

export function DictionaryPicker({
  locale,
  query,
  terms,
  facets,
  palettes,
  selectedTerms,
  focusTarget = null,
  scopeMode = 'ALL',
  albumScopeAvailable = false,
  draggableMaterials = false,
  layout = 'popover',
  onQueryChange,
  onToggle,
  onClear,
  onPaletteApply,
  onPaletteView,
  onPaletteCreated,
  onScopeModeChange,
  onClose,
  notify,
}: Props) {
  const { messages } = useI18n();
  const l = messages.creator.dictionaryPicker;
  const [mode, setMode] = useState<'words' | 'palettes'>(() =>
    focusTarget?.kind === 'palette' ? 'palettes' : 'words',
  );
  const [saveOpen, setSaveOpen] = useState(false);
  const sidebar = layout === 'sidebar';
  const visibleTerms = useMemo(() => {
    if (focusTarget?.kind !== 'term' || terms.some((term) => term.id === focusTarget.id)) return terms;
    const target = selectedTerms.find((term) => term.id === focusTarget.id);
    return target ? [...terms, target] : terms;
  }, [focusTarget, selectedTerms, terms]);

  useEffect(() => {
    if (focusTarget?.kind === 'term') {
      setMode('words');
      if (query) onQueryChange('');
    }
    if (focusTarget?.kind === 'palette') setMode('palettes');
  }, [focusTarget, onQueryChange, query]);

  return (
    <section
      className={cn('overflow-hidden bg-background', sidebar && 'flex size-full min-h-0 min-w-0 flex-col')}
      aria-label={l.dictionary}
    >
      <header className="flex h-12 min-w-0 shrink-0 items-center gap-2 overflow-hidden border-b px-3">
        <strong className="mr-1 shrink-0">{l.dictionary}</strong>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant={mode === 'words' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setMode('words')}
          >
            {l.words}
          </Button>
          <Button
            data-action="word-palette-library"
            type="button"
            variant={mode === 'palettes' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setMode('palettes')}
          >
            {l.recipes}
            <span className="text-[10px] text-muted-foreground">{palettes.length}</span>
          </Button>
        </div>
        {albumScopeAvailable && onScopeModeChange && (
          <div className="flex items-center gap-1 rounded-md border p-0.5">
            <Button
              type="button"
              variant={scopeMode === 'SELECTED' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => onScopeModeChange('SELECTED')}
            >
              {locale === 'zh' ? '图集词典' : 'Album'}
            </Button>
            <Button
              type="button"
              variant={scopeMode === 'ALL' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => onScopeModeChange('ALL')}
            >
              {locale === 'zh' ? '全部' : 'All'}
            </Button>
          </div>
        )}
        {mode === 'words' && (
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-action="creator-reference-search"
              className="h-8 pl-9"
              autoFocus
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={l.search}
            />
          </div>
        )}
        {mode === 'palettes' && <div className="min-w-0 flex-1" />}
        {onClose && (
          <Button variant="ghost" size="icon-sm" aria-label={l.close} onClick={onClose}>
            <XIcon className="size-4" />
          </Button>
        )}
      </header>
      {mode === 'words' ? (
        <div className={cn(sidebar && 'flex min-h-0 flex-1 flex-col')}>
          <div className={cn(sidebar && 'min-h-0 flex-1')}>
            <WordPalette
              compact={!sidebar}
              locale={locale}
              terms={visibleTerms}
              facets={facets}
              selectedTerms={selectedTerms}
              focusTermId={focusTarget?.kind === 'term' ? focusTarget.id : null}
              draggableTerms={draggableMaterials}
              onToggle={onToggle}
              onClear={onClear}
              onSave={() => setSaveOpen(true)}
            />
          </div>
        </div>
      ) : (
        <div className={cn('flex min-h-0', sidebar ? 'flex-1' : 'h-[350px]')}>
          <WordPaletteLibrary
            locale={locale}
            palettes={palettes}
            action="apply"
            draggablePalettes={draggableMaterials}
            focusPaletteId={focusTarget?.kind === 'palette' ? focusTarget.id : null}
            onCreate={() => setSaveOpen(true)}
            onUse={onPaletteApply}
            onView={onPaletteView}
            notify={notify}
          />
        </div>
      )}
      <SaveWordPaletteDialog
        locale={locale}
        open={saveOpen}
        termIds={selectedTerms.map((term) => term.id)}
        terms={terms}
        facets={facets}
        onOpenChange={setSaveOpen}
        onCreated={(palette) => {
          setMode('palettes');
          onPaletteCreated(palette);
        }}
      />
    </section>
  );
}
