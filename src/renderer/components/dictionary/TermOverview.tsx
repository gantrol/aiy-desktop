import { useMemo, useState } from 'react';
import type { FacetDefinitionDto, Locale, TermCategoryDto, TermListItem, WordPaletteDto } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { DeleteEntityDialog } from '@/renderer/components/app/DeleteEntityDialog';
import { WordPaletteEditor } from '@/renderer/components/palette/WordPaletteEditor';
import { WordPaletteLibrary } from '@/renderer/components/palette/WordPaletteLibrary';
import { Button } from '@/renderer/components/ui/button';
import { WordPalette } from '@/renderer/components/dictionary/WordPalette';
import type { DictionaryBrowseContext } from '@/renderer/components/dictionary/dictionary-navigation';

type PaletteWorkspace = { mode: 'create'; initialTermIds: string[] } | { mode: 'edit'; palette: WordPaletteDto };

interface Props {
  locale: Locale;
  terms: TermListItem[];
  visibleTerms?: TermListItem[];
  focusTermId?: string | null;
  facets: FacetDefinitionDto[];
  categories: TermCategoryDto[];
  palettes: WordPaletteDto[];
  selectedTermIds: string[];
  loading?: boolean;
  loadError?: string;
  onOpenTerm(term: TermListItem, context: DictionaryBrowseContext): void;
  onSelectionChange(termIds: string[]): void;
  onFilter(termIds: string[]): void;
  onPaletteCreated(palette: WordPaletteDto): void;
  onPaletteChanged(action: 'updated' | 'archived' | 'restored' | 'deleted'): Promise<void> | void;
  notify(message: string): void;
}

export function TermOverview({
  locale,
  terms,
  visibleTerms = terms,
  focusTermId = null,
  facets,
  categories,
  palettes,
  selectedTermIds,
  loading = false,
  loadError = '',
  onOpenTerm,
  onSelectionChange,
  onFilter,
  onPaletteCreated,
  onPaletteChanged,
  notify,
}: Props) {
  const { messages } = useI18n();
  const l = messages.dictionary.overview;
  const [mode, setMode] = useState<'words' | 'palettes'>('words');
  const [paletteWorkspace, setPaletteWorkspace] = useState<PaletteWorkspace | null>(null);
  const [deletePalette, setDeletePalette] = useState<WordPaletteDto | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const selected = useMemo(() => {
    const termsById = new Map([...terms, ...visibleTerms].map((term) => [term.id, term]));
    return selectedTermIds.map((id) => termsById.get(id)).filter((term): term is TermListItem => Boolean(term));
  }, [selectedTermIds, terms, visibleTerms]);

  const toggle = (term: TermListItem) =>
    onSelectionChange(
      selectedTermIds.includes(term.id)
        ? selectedTermIds.filter((id) => id !== term.id)
        : [...selectedTermIds, term.id],
    );

  async function removePalette() {
    if (!deletePalette) return;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await window.desktopApi.wordPaletteDelete(deletePalette.id);
      setDeletePalette(null);
      await onPaletteChanged('deleted');
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDeleteBusy(false);
    }
  }

  if (paletteWorkspace)
    return (
      <div className="flex size-full min-h-0 p-3 pt-0">
        <WordPaletteEditor
          locale={locale}
          palette={paletteWorkspace.mode === 'edit' ? paletteWorkspace.palette : null}
          initialTermIds={paletteWorkspace.mode === 'create' ? paletteWorkspace.initialTermIds : []}
          terms={terms}
          facets={facets}
          onBack={() => setPaletteWorkspace(null)}
          onSaved={async (palette, action) => {
            setPaletteWorkspace({ mode: 'edit', palette });
            if (action === 'created') {
              setMode('palettes');
              onPaletteCreated(palette);
            } else {
              await onPaletteChanged('updated');
            }
          }}
          onLifecycleChanged={onPaletteChanged}
        />
      </div>
    );

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[44px_minmax(0,1fr)] p-3 pt-0">
      <header className="flex items-center gap-1 rounded-t-lg border border-b-0 bg-background px-2">
        <Button
          type="button"
          size="sm"
          variant={mode === 'words' ? 'secondary' : 'ghost'}
          onClick={() => setMode('words')}
        >
          {l.words}
        </Button>
        <Button
          data-action="word-palette-library"
          type="button"
          size="sm"
          variant={mode === 'palettes' ? 'secondary' : 'ghost'}
          onClick={() => setMode('palettes')}
        >
          {l.recipes}
          <span className="text-[10px] text-muted-foreground">{palettes.length}</span>
        </Button>
      </header>
      <div className="min-h-0 overflow-hidden rounded-b-lg border bg-background">
        {mode === 'words' ? (
          <WordPalette
            presentation="overview"
            locale={locale}
            terms={visibleTerms}
            focusTermId={focusTermId}
            facets={facets}
            categories={categories}
            selectedTerms={selected}
            loading={loading}
            loadError={loadError}
            onOpenTerm={onOpenTerm}
            onToggle={toggle}
            onClear={() => onSelectionChange([])}
            onSave={() => setPaletteWorkspace({ mode: 'create', initialTermIds: selected.map((term) => term.id) })}
            onConfirm={() => onFilter(selected.map((term) => term.id))}
          />
        ) : (
          <div className="flex size-full min-h-0">
            <WordPaletteLibrary
              locale={locale}
              palettes={palettes}
              action="filter"
              notify={notify}
              onCreate={() => setPaletteWorkspace({ mode: 'create', initialTermIds: [] })}
              onEdit={(palette) => setPaletteWorkspace({ mode: 'edit', palette })}
              onDelete={(palette) => {
                setDeleteError('');
                setDeletePalette(palette);
              }}
            />
          </div>
        )}
      </div>
      <DeleteEntityDialog
        open={Boolean(deletePalette)}
        title={l.deleteTitle}
        description={deletePalette ? `${deletePalette.name}：${l.deleteDescription}` : l.deleteDescription}
        cancelLabel={l.cancel}
        confirmLabel={l.delete}
        busy={deleteBusy}
        error={deleteError}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeletePalette(null);
        }}
        onConfirm={() => void removePalette()}
      />
    </div>
  );
}
