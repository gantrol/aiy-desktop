import { useEffect, useMemo, useRef, useState } from 'react';
import { BracesIcon, CheckIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import type { FacetDefinitionDto, FacetValueDto, Locale, TermCategoryDto, TermListItem } from '@/shared/contracts';
import { resolveTermExpression, resolveTermTitle, termFacetValueIds } from '@/shared/term-localization';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { TermPreviewTooltip } from '@/renderer/components/media/TermPreviewTooltip';
import { Button } from '@/renderer/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Separator } from '@/renderer/components/ui/separator';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import { useHoverIntent } from '@/renderer/components/ui/use-hover-intent';
import { ShortestColumnMasonry } from '@/renderer/components/ui/shortest-column-masonry';
import { DictionaryCategoryColumns } from '@/renderer/components/dictionary/DictionaryCategoryColumns';
import {
  buildDictionaryCategoryBrowser,
  defaultDictionaryCategorySelection,
  dictionaryCategoryPathForTerm,
  selectDictionaryCategoryAtLevel,
  type DictionaryCategoryBrowserColumn,
  UNCLASSIFIED_CATEGORY_ID,
} from '@/renderer/components/dictionary/dictionary-category-browser';
import { getTermCardAspectRatio, TermOverviewCard } from '@/renderer/components/dictionary/TermOverviewCard';
import {
  deriveDictionaryBrowseContext,
  OTHER_DOMAIN,
  OTHER_TYPE,
  type DictionaryBrowseContext,
} from '@/renderer/components/dictionary/dictionary-navigation';
import {
  clearWordPaletteTermDrag,
  readWordPaletteTermDrag,
  writeWordPaletteTermDrag,
} from '@/renderer/components/palette/wordPaletteInteractions';

interface Props {
  locale: Locale;
  terms: TermListItem[];
  facets: FacetDefinitionDto[];
  categories?: TermCategoryDto[];
  selectedTerms: TermListItem[];
  focusTermId?: string | null;
  compact?: boolean;
  presentation?: 'picker' | 'overview';
  loading?: boolean;
  loadError?: string;
  draggableTerms?: boolean;
  onToggle(term: TermListItem): void;
  onOpenTerm?(term: TermListItem, context: DictionaryBrowseContext): void;
  onClear?(): void;
  onSave?(): void;
  onConfirm?(): void;
  onCombineTerms?(sourceTermId: string, targetTermId: string, sourceNodeKey?: string): void;
  onRequestCombineTerm?(term: TermListItem): void;
}

const termPageSize = 48;

function countTerms(terms: TermListItem[], valueId: string) {
  return terms.reduce((count, term) => count + Number(termFacetValueIds(term).includes(valueId)), 0);
}

type CountedFacetValue = FacetValueDto & { count: number };

interface NavigationColumnsProps {
  categoryMode: boolean;
  categoryColumns: DictionaryCategoryBrowserColumn[];
  domains: CountedFacetValue[];
  types: CountedFacetValue[];
  effectiveDomainId: string;
  effectiveTypeId: string;
  onSelectCategory(level: number, categoryId: string): void;
  onPreviewCategory(level: number, categoryId: string): void;
  onSelectDomain(domainId: string): void;
  onPreviewDomain(domainId: string): void;
  onSelectType(typeId: string): void;
  onPreviewType(typeId: string): void;
  onCancelPreview(): void;
}

function NavigationColumns(props: NavigationColumnsProps) {
  if (props.categoryMode) {
    return (
      <DictionaryCategoryColumns
        columns={props.categoryColumns}
        onSelect={props.onSelectCategory}
        onPreview={props.onPreviewCategory}
        onCancelPreview={props.onCancelPreview}
      />
    );
  }
  return (
    <>
      <ScrollArea
        type="always"
        className="min-h-0 min-w-0 border-r bg-muted/40 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full"
      >
        <div className="space-y-1 p-2 pr-3">
          {props.domains.map((domain) => (
            <Button
              key={domain.id}
              data-palette-domain={domain.stableKey}
              type="button"
              variant={domain.id === props.effectiveDomainId ? 'secondary' : 'ghost'}
              className="h-9 w-full justify-between px-2 font-normal"
              onMouseEnter={() => props.onPreviewDomain(domain.id)}
              onMouseLeave={props.onCancelPreview}
              onFocus={() => props.onSelectDomain(domain.id)}
              onClick={() => props.onSelectDomain(domain.id)}
            >
              <span className="truncate">{domain.name}</span>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                {domain.count}
                <ChevronRightIcon className="size-3" />
              </span>
            </Button>
          ))}
        </div>
      </ScrollArea>
      <ScrollArea
        type="always"
        className="min-h-0 min-w-0 border-r [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full"
      >
        <div className="space-y-1 p-2 pr-3">
          {props.types.map((type) => (
            <Button
              key={type.id}
              data-palette-type={type.stableKey}
              type="button"
              variant={type.id === props.effectiveTypeId ? 'secondary' : 'ghost'}
              className="h-9 w-full justify-between px-2 font-normal"
              onMouseEnter={() => props.onPreviewType(type.id)}
              onMouseLeave={props.onCancelPreview}
              onFocus={() => props.onSelectType(type.id)}
              onClick={() => props.onSelectType(type.id)}
            >
              <span className="truncate">{type.name}</span>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                {type.count}
                <ChevronRightIcon className="size-3" />
              </span>
            </Button>
          ))}
        </div>
      </ScrollArea>
    </>
  );
}

function browserLayoutClass(categoryMode: boolean, isOverview: boolean) {
  if (categoryMode) return 'flex min-h-0 min-w-0 w-full max-w-full overflow-hidden';
  return cn(
    'grid min-h-0 min-w-0 w-full max-w-full overflow-hidden',
    isOverview
      ? 'grid-cols-[minmax(132px,0.62fr)_minmax(148px,0.7fr)_minmax(260px,3fr)]'
      : 'grid-cols-[minmax(120px,0.72fr)_minmax(145px,0.9fr)_minmax(220px,2fr)]',
  );
}

function termViewportClass(categoryMode: boolean) {
  return cn(
    'min-h-0 min-w-0 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full',
    categoryMode && 'min-w-80 flex-1',
  );
}

function categoryBrowserEnabled(presentation: 'picker' | 'overview', categories: TermCategoryDto[]) {
  return presentation === 'overview' && categories.length > 0;
}

function OverviewStatus({
  loading,
  loadError,
  loadingLabel,
  loadFailedLabel,
}: {
  loading: boolean;
  loadError: string;
  loadingLabel: string;
  loadFailedLabel: string;
}) {
  return (
    <>
      {loading && (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground"
        >
          {loadingLabel}
        </div>
      )}
      {loadError && (
        <div
          role="alert"
          className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {loadFailedLabel}
        </div>
      )}
    </>
  );
}

export function WordPalette({
  locale,
  terms,
  facets,
  categories = [],
  selectedTerms,
  focusTermId = null,
  compact = false,
  presentation = 'picker',
  loading = false,
  loadError = '',
  draggableTerms = false,
  onToggle,
  onOpenTerm,
  onClear,
  onSave,
  onConfirm,
  onCombineTerms,
  onRequestCombineTerm,
}: Props) {
  const { messages } = useI18n();
  const l = messages.dictionary.wordPalette;
  const isOverview = presentation === 'overview';
  const categoryMode = categoryBrowserEnabled(presentation, categories);
  const rootRef = useRef<HTMLElement>(null);
  const termViewportRef = useRef<HTMLDivElement>(null);
  const termPageEndRef = useRef<HTMLDivElement>(null);
  const domainFacet = facets.find((facet) => facet.systemRole === 'PRIMARY_CLASSIFICATION');
  const typeFacet = facets.find((facet) => facet.systemRole === 'SECONDARY_CLASSIFICATION');
  const domains = useMemo(() => {
    const values: Array<FacetValueDto & { count: number }> = (domainFacet?.values ?? [])
      .map((value) => ({ ...value, count: countTerms(terms, value.id) }))
      .filter((value) => value.count > 0);
    const uncategorized = terms.filter(
      (term) => !termFacetValueIds(term).some((id) => domainFacet?.values.some((value) => value.id === id)),
    ).length;
    if (uncategorized)
      values.push({ id: OTHER_DOMAIN, stableKey: OTHER_DOMAIN, name: l.uncategorized, count: uncategorized });
    return values;
  }, [domainFacet, l.uncategorized, terms]);
  const [domainId, setDomainId] = useState('');
  const effectiveDomainId = domains.some((value) => value.id === domainId) ? domainId : (domains[0]?.id ?? '');
  const domainTerms = useMemo(
    () =>
      terms.filter((term) =>
        effectiveDomainId === OTHER_DOMAIN
          ? !termFacetValueIds(term).some((id) => domainFacet?.values.some((value) => value.id === id))
          : termFacetValueIds(term).includes(effectiveDomainId),
      ),
    [domainFacet, effectiveDomainId, terms],
  );
  const types = useMemo(() => {
    const values: Array<FacetValueDto & { count: number }> = (typeFacet?.values ?? [])
      .map((value) => ({ ...value, count: countTerms(domainTerms, value.id) }))
      .filter((value) => value.count > 0);
    const uncategorized = domainTerms.filter(
      (term) => !termFacetValueIds(term).some((id) => typeFacet?.values.some((value) => value.id === id)),
    ).length;
    if (uncategorized)
      values.push({ id: OTHER_TYPE, stableKey: OTHER_TYPE, name: l.uncategorized, count: uncategorized });
    return values;
  }, [domainTerms, typeFacet, l.uncategorized]);
  const [typeId, setTypeId] = useState('');
  const [categorySelection, setCategorySelection] = useState(() => defaultDictionaryCategorySelection(categories));
  const [dropTargetTermId, setDropTargetTermId] = useState<string | null>(null);
  const effectiveTypeId = types.some((value) => value.id === typeId) ? typeId : (types[0]?.id ?? '');
  const hoverIntent = useHoverIntent();
  const categoryBrowser = useMemo(
    () => buildDictionaryCategoryBrowser(categories, terms, categorySelection, l.uncategorized),
    [categories, categorySelection, l.uncategorized, terms],
  );
  const facetVisibleTerms = useMemo(
    () =>
      domainTerms.filter((term) =>
        effectiveTypeId === OTHER_TYPE
          ? !termFacetValueIds(term).some((id) => typeFacet?.values.some((value) => value.id === id))
          : termFacetValueIds(term).includes(effectiveTypeId),
      ),
    [domainTerms, effectiveTypeId, typeFacet],
  );
  const visibleTerms = useMemo(
    () =>
      [...(categoryMode ? categoryBrowser.visibleTerms : facetVisibleTerms)].sort((left, right) =>
        resolveTermTitle(left, locale).localeCompare(resolveTermTitle(right, locale), locale === 'zh' ? 'zh-CN' : 'en'),
      ),
    [categoryBrowser.visibleTerms, categoryMode, facetVisibleTerms, locale],
  );
  const [renderedTermLimit, setRenderedTermLimit] = useState(termPageSize);
  const renderedTerms = visibleTerms.slice(0, renderedTermLimit);
  const selectedIds = useMemo(() => new Set(selectedTerms.map((term) => term.id)), [selectedTerms]);
  const masonryTerms = useMemo(
    () =>
      renderedTerms.map((term) => {
        const preview = term.mediaPreview.items[0];
        return {
          id: term.id,
          aspectRatio: preview
            ? getTermCardAspectRatio(preview.asset.width, preview.asset.height)
            : getTermCardAspectRatio(0, 0),
        };
      }),
    [renderedTerms],
  );
  const [focusRequest, setFocusRequest] = useState<{ id: string; serial: number } | null>(
    focusTermId ? { id: focusTermId, serial: 0 } : null,
  );

  function selectDomain(domainId: string) {
    hoverIntent.cancel();
    if (domainId === effectiveDomainId) return;
    setDomainId(domainId);
    setTypeId('');
  }

  function selectType(typeId: string) {
    hoverIntent.cancel();
    if (typeId === effectiveTypeId) return;
    setTypeId(typeId);
  }

  function supportsHoverIntent() {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }

  function scheduleDomainSelection(domainId: string) {
    if (domainId === effectiveDomainId) {
      hoverIntent.cancel();
      return;
    }
    hoverIntent.schedule(() => selectDomain(domainId), supportsHoverIntent());
  }

  function scheduleTypeSelection(typeId: string) {
    if (typeId === effectiveTypeId) {
      hoverIntent.cancel();
      return;
    }
    hoverIntent.schedule(() => selectType(typeId), supportsHoverIntent());
  }

  function selectCategory(level: number, categoryId: string) {
    hoverIntent.cancel();
    if (categoryBrowser.columns[level]?.selectedId === categoryId && categoryBrowser.selectionPath.length === level + 1)
      return;
    setCategorySelection((current) =>
      selectDictionaryCategoryAtLevel(
        categoryBrowser.selectionPath.length ? categoryBrowser.selectionPath : current,
        level,
        categoryId,
      ),
    );
  }

  function scheduleCategorySelection(level: number, categoryId: string) {
    if (
      categoryBrowser.columns[level]?.selectedId === categoryId &&
      categoryBrowser.selectionPath.length === level + 1
    ) {
      hoverIntent.cancel();
      return;
    }
    hoverIntent.schedule(() => selectCategory(level, categoryId), supportsHoverIntent());
  }

  function browseContextFor(term: TermListItem): DictionaryBrowseContext {
    if (!categoryMode) return deriveDictionaryBrowseContext(term, categories);
    const selectedCategory = categories.find((category) => category.id === categoryBrowser.selectedCategoryId);
    return {
      classificationId: categoryBrowser.selectedCategoryId,
      classificationPath:
        selectedCategory?.path?.split(' / ').filter(Boolean) ??
        (categoryBrowser.selectionPath[0] === UNCLASSIFIED_CATEGORY_ID ? [l.uncategorized] : []),
      anchorTermId: term.id,
    };
  }

  function locateTerm(termId: string) {
    hoverIntent.cancel();
    const term = terms.find((item) => item.id === termId);
    if (!term) return;
    if (categoryMode) {
      setCategorySelection(dictionaryCategoryPathForTerm(term, categories));
    } else {
      const nextDomain = domainFacet?.values.find((value) => termFacetValueIds(term).includes(value.id));
      const nextType = typeFacet?.values.find((value) => termFacetValueIds(term).includes(value.id));
      setDomainId(nextDomain?.id ?? OTHER_DOMAIN);
      setTypeId(nextType?.id ?? OTHER_TYPE);
    }
    setFocusRequest((current) => ({ id: termId, serial: (current?.serial ?? 0) + 1 }));
  }

  useEffect(() => {
    if (!focusTermId) return;
    hoverIntent.cancel();
    const term = terms.find((item) => item.id === focusTermId);
    if (!term) return;
    if (categoryMode) {
      setCategorySelection(dictionaryCategoryPathForTerm(term, categories));
    } else {
      const nextDomain = domainFacet?.values.find((value) => termFacetValueIds(term).includes(value.id));
      const nextType = typeFacet?.values.find((value) => termFacetValueIds(term).includes(value.id));
      setDomainId(nextDomain?.id ?? OTHER_DOMAIN);
      setTypeId(nextType?.id ?? OTHER_TYPE);
    }
    setFocusRequest((current) => ({ id: focusTermId, serial: (current?.serial ?? 0) + 1 }));
  }, [categories, categoryMode, domainFacet, focusTermId, terms, typeFacet]);

  useEffect(() => {
    setRenderedTermLimit(termPageSize);
    termViewportRef.current?.scrollTo({ top: 0 });
  }, [categoryBrowser.selectionPath, categoryMode, effectiveDomainId, effectiveTypeId, terms]);

  useEffect(() => {
    if (renderedTermLimit >= visibleTerms.length) return undefined;
    const viewport = termViewportRef.current;
    const pageEnd = termPageEndRef.current;
    if (!viewport || !pageEnd || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setRenderedTermLimit((current) => current + termPageSize);
      },
      { root: viewport, rootMargin: '120px 0px' },
    );
    observer.observe(pageEnd);
    return () => observer.disconnect();
  }, [renderedTermLimit, visibleTerms.length]);

  useEffect(() => {
    if (!focusRequest) return;
    const index = visibleTerms.findIndex((term) => term.id === focusRequest.id);
    if (index >= renderedTermLimit) setRenderedTermLimit(index + 1);
  }, [focusRequest, renderedTermLimit, visibleTerms]);

  useEffect(() => {
    if (!focusRequest || !visibleTerms.some((term) => term.id === focusRequest.id)) return;
    const frame = requestAnimationFrame(() => {
      const target = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-palette-term-id]') ?? []).find(
        (element) => element.dataset.paletteTermId === focusRequest.id,
      );
      target?.scrollIntoView({ block: 'center', inline: 'nearest' });
      (target?.querySelector<HTMLElement>('button') ?? target)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, renderedTermLimit, visibleTerms]);

  return (
    <section
      ref={rootRef}
      data-word-palette
      aria-busy={loading}
      className={cn(
        'grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] overflow-hidden bg-background',
        compact ? 'h-[350px] grid-rows-[minmax(0,1fr)_auto]' : 'size-full grid-rows-[minmax(0,1fr)_auto]',
      )}
    >
      <div className={browserLayoutClass(categoryMode, isOverview)}>
        <NavigationColumns
          categoryMode={categoryMode}
          categoryColumns={categoryBrowser.columns}
          domains={domains}
          types={types}
          effectiveDomainId={effectiveDomainId}
          effectiveTypeId={effectiveTypeId}
          onSelectCategory={selectCategory}
          onPreviewCategory={scheduleCategorySelection}
          onSelectDomain={selectDomain}
          onPreviewDomain={scheduleDomainSelection}
          onSelectType={selectType}
          onPreviewType={scheduleTypeSelection}
          onCancelPreview={hoverIntent.cancel}
        />

        <ScrollArea
          data-dictionary-term-pane={categoryMode ? '' : undefined}
          type="always"
          className={termViewportClass(categoryMode)}
          viewportRef={termViewportRef}
        >
          {isOverview ? (
            <div className="p-3 pr-5">
              <OverviewStatus
                loading={loading}
                loadError={loadError}
                loadingLabel={l.loading}
                loadFailedLabel={l.loadFailed}
              />
              <ShortestColumnMasonry
                items={masonryTerms}
                renderItem={(_, index) => {
                  const term = renderedTerms[index];
                  return (
                    <div data-palette-term={term.stableKey} data-palette-term-id={term.id} className="size-full">
                      <TermOverviewCard
                        term={term}
                        selected={selectedIds.has(term.id)}
                        addLabel={l.selectTerm}
                        selectedLabel={l.selected}
                        openLabel={l.openDetails}
                        className={cn('w-full', focusRequest?.id === term.id && 'ring-2 ring-ring ring-offset-2')}
                        onOpen={(item) => onOpenTerm?.(item, browseContextFor(item))}
                        onToggle={onToggle}
                      />
                    </div>
                  );
                }}
              />
              {renderedTerms.length < visibleTerms.length && (
                <div
                  ref={termPageEndRef}
                  data-slot="dictionary-term-page-end"
                  className="h-px w-full"
                  aria-hidden="true"
                />
              )}
              {!visibleTerms.length && !loading && (
                <div className="py-12 text-center text-xs text-muted-foreground">{l.empty}</div>
              )}
            </div>
          ) : (
            <TooltipProvider delayDuration={280}>
              <div className="flex flex-wrap content-start gap-2 p-3 pr-5">
                {renderedTerms.map((term) => {
                  const selected = selectedIds.has(term.id);
                  const termButton = (
                    <TermPreviewTooltip term={term}>
                      <Button
                        type="button"
                        data-palette-term={term.stableKey}
                        data-palette-term-id={term.id}
                        draggable={Boolean(onCombineTerms || draggableTerms)}
                        size="sm"
                        variant={selected ? 'default' : 'outline'}
                        className={cn(
                          'h-8 max-w-full rounded-full px-3 font-normal',
                          (onCombineTerms || draggableTerms) && 'cursor-grab active:cursor-grabbing',
                          focusRequest?.id === term.id && 'ring-2 ring-ring ring-offset-2',
                          dropTargetTermId === term.id && 'bg-warning-surface ring-2 ring-warning ring-offset-2',
                        )}
                        onClick={() => onToggle(term)}
                        onDragStart={(event) =>
                          writeWordPaletteTermDrag(event.dataTransfer, {
                            termId: term.id,
                            origin: 'dictionary',
                            plainText:
                              resolveTermExpression(term, 'gpt-image-2', locale)?.positive ||
                              resolveTermTitle(term, locale),
                          })
                        }
                        onDragEnd={() => {
                          clearWordPaletteTermDrag();
                          setDropTargetTermId(null);
                        }}
                        onDragEnter={() => onCombineTerms && setDropTargetTermId(term.id)}
                        onDragLeave={() => setDropTargetTermId((current) => (current === term.id ? null : current))}
                        onDragOver={(event) => {
                          if (!onCombineTerms) return;
                          event.preventDefault();
                          setDropTargetTermId(term.id);
                          event.dataTransfer.dropEffect = 'link';
                        }}
                        onDrop={(event) => {
                          const source = readWordPaletteTermDrag(event.dataTransfer);
                          if (!onCombineTerms || !source || source.termId === term.id) return;
                          event.preventDefault();
                          setDropTargetTermId(null);
                          onCombineTerms(source.termId, term.id, source.nodeKey);
                        }}
                      >
                        {dropTargetTermId === term.id ? (
                          <BracesIcon className="size-3" />
                        ) : (
                          selected && <CheckIcon className="size-3" />
                        )}
                        <span className="truncate">{resolveTermTitle(term, locale)}</span>
                      </Button>
                    </TermPreviewTooltip>
                  );
                  return onRequestCombineTerm ? (
                    <ContextMenu key={term.id}>
                      <ContextMenuTrigger asChild>
                        <span className="inline-flex max-w-full">{termButton}</span>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onSelect={() => onRequestCombineTerm(term)}>
                          <BracesIcon />
                          {messages.recipe.editor.combineOptions}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ) : (
                    <span key={term.id} className="inline-flex max-w-full">
                      {termButton}
                    </span>
                  );
                })}
                {renderedTerms.length < visibleTerms.length && (
                  <div ref={termPageEndRef} className="h-px w-full" aria-hidden="true" />
                )}
                {!visibleTerms.length && (
                  <div className="w-full py-12 text-center text-xs text-muted-foreground">{l.empty}</div>
                )}
              </div>
            </TooltipProvider>
          )}
        </ScrollArea>
      </div>

      <div className="min-h-14 min-w-0 overflow-hidden bg-muted/30">
        <Separator />
        <div className="flex min-h-14 min-w-0 w-full items-center gap-2 overflow-hidden px-3 py-2">
          <span className="shrink-0 text-xs text-muted-foreground">
            {l.selected} {selectedTerms.length}
          </span>
          <div className="w-0 min-w-0 flex-1 overflow-x-auto whitespace-nowrap">
            <TooltipProvider delayDuration={280}>
              <div className="flex w-max min-w-full gap-1.5 pb-2">
                {selectedTerms.map((term) => {
                  const chip = (
                    <TermPreviewTooltip term={term}>
                      <span
                        className={cn(
                          'inline-flex h-7 max-w-full items-center overflow-hidden rounded-full bg-secondary text-secondary-foreground',
                          (onCombineTerms || draggableTerms) && 'cursor-grab active:cursor-grabbing',
                          dropTargetTermId === term.id && 'bg-warning-surface ring-2 ring-warning ring-offset-2',
                        )}
                        draggable={Boolean(onCombineTerms || draggableTerms)}
                        onDragStart={(event) =>
                          writeWordPaletteTermDrag(event.dataTransfer, {
                            termId: term.id,
                            origin: 'dictionary',
                            plainText:
                              resolveTermExpression(term, 'gpt-image-2', locale)?.positive ||
                              resolveTermTitle(term, locale),
                          })
                        }
                        onDragEnd={() => {
                          clearWordPaletteTermDrag();
                          setDropTargetTermId(null);
                        }}
                        onDragEnter={() => onCombineTerms && setDropTargetTermId(term.id)}
                        onDragLeave={() => setDropTargetTermId((current) => (current === term.id ? null : current))}
                        onDragOver={(event) => {
                          if (!onCombineTerms) return;
                          event.preventDefault();
                          setDropTargetTermId(term.id);
                          event.dataTransfer.dropEffect = 'link';
                        }}
                        onDrop={(event) => {
                          const source = readWordPaletteTermDrag(event.dataTransfer);
                          if (!onCombineTerms || !source || source.termId === term.id) return;
                          event.preventDefault();
                          setDropTargetTermId(null);
                          onCombineTerms(source.termId, term.id, source.nodeKey);
                        }}
                      >
                        {dropTargetTermId === term.id && <BracesIcon className="ml-2 size-3 shrink-0" />}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-full min-w-0 rounded-none border-0 px-2 font-normal shadow-none"
                          onClick={() => locateTerm(term.id)}
                        >
                          <span className="truncate">{resolveTermTitle(term, locale)}</span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="size-6 shrink-0 rounded-full shadow-none"
                          aria-label={`${l.clear} ${resolveTermTitle(term, locale)}`}
                          onClick={() => onToggle(term)}
                        >
                          <XIcon className="size-3" />
                        </Button>
                      </span>
                    </TermPreviewTooltip>
                  );
                  return onRequestCombineTerm ? (
                    <ContextMenu key={term.id}>
                      <ContextMenuTrigger asChild>
                        <span className="inline-flex max-w-full">{chip}</span>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onSelect={() => onRequestCombineTerm(term)}>
                          <BracesIcon />
                          {messages.recipe.editor.combineOptions}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ) : (
                    <span key={term.id} className="inline-flex max-w-full">
                      {chip}
                    </span>
                  );
                })}
              </div>
            </TooltipProvider>
          </div>
          {selectedTerms.length > 0 && onClear && (
            <Button type="button" variant="ghost" size="sm" onClick={onClear}>
              {l.clear}
            </Button>
          )}
          {onSave && (
            <Button data-action="word-palette-save" type="button" variant="outline" size="sm" onClick={onSave}>
              {selectedTerms.length ? l.save : l.newRecipe}
            </Button>
          )}
          {selectedTerms.length > 0 && onConfirm && (
            <Button data-action="word-palette-confirm" type="button" size="sm" onClick={onConfirm}>
              {l.confirm}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
