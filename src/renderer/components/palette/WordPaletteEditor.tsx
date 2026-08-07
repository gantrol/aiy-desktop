import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArchiveIcon,
  ArrowLeftIcon,
  BookOpenIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  ImagesIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import type { AssetDto, FacetDefinitionDto, Locale, TermListItem, WordPaletteDto } from '@/shared/contracts';
import { resolveAlternateTermTitle, resolveTermTitle, termFacetValueIds } from '@/shared/term-localization';
import {
  paletteLocaleMatches,
  replacePaletteLocalization,
  resolveWordPaletteContent,
} from '@/shared/word-palette-localization';
import { SearchIcon } from '@/renderer/icons';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { WordPalette } from '@/renderer/components/dictionary/WordPalette';
import { Button } from '@/renderer/components/ui/button';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/renderer/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { MetaText } from '@/renderer/components/ui/meta-text';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Textarea } from '@/renderer/components/ui/textarea';
import { StateTag } from '@/renderer/components/ui/state-tag';
import {
  WordPaletteInlinePromptEditor,
  type WordPaletteInlinePromptEditorHandle,
} from '@/renderer/components/palette/WordPaletteInlinePromptEditor';
import {
  createChoiceGroup,
  createTermOption,
  paletteParameterDrafts,
  paletteParameterInputs,
  paletteParametersAreValid,
  type PaletteParameterDraft,
} from '@/renderer/components/palette/wordPaletteOptions';
import {
  createInitialPromptDocument,
  loadPromptDocumentNegative,
  loadPromptDocument,
  promptDocumentInputs,
  promptDocumentSlotKeys,
  promptDocumentTermIds,
  renderPromptDocumentPreview,
  type PromptDocumentNode,
} from '@/renderer/components/palette/wordPalettePromptDocument';

interface Props {
  locale: Locale;
  palette?: WordPaletteDto | null;
  initialTermIds?: string[];
  terms: TermListItem[];
  facets: FacetDefinitionDto[];
  onBack(): void;
  onSaved(palette: WordPaletteDto, action: 'created' | 'updated'): Promise<void> | void;
  onLifecycleChanged(action: 'archived' | 'restored' | 'deleted'): Promise<void> | void;
  onFullWindowChange?(open: boolean): void;
}

type ChoiceSeed = { kind: 'TERM'; term: TermListItem } | { kind: 'PROMPT'; text: string };

type CombineSource =
  { kind: 'TERM'; term: TermListItem; nodeKey?: string } | { kind: 'PROMPT'; text: string; sourceTerm?: TermListItem };

function choiceFacetName(seeds: readonly ChoiceSeed[], facets: readonly FacetDefinitionDto[]) {
  const terms = seeds.flatMap((seed) => (seed.kind === 'TERM' ? [seed.term] : []));
  if (terms.length < 2) return '';
  for (const facet of facets) {
    const common = facet.values.find((value) => terms.every((term) => termFacetValueIds(term).includes(value.id)));
    if (common) return common.name;
  }
  return '';
}

export function WordPaletteEditor({
  locale,
  palette = null,
  initialTermIds = [],
  terms,
  facets,
  onBack,
  onSaved,
  onLifecycleChanged,
  onFullWindowChange,
}: Props) {
  const { messages } = useI18n();
  const l = messages.recipe.editor;
  const inlineEditorRef = useRef<WordPaletteInlinePromptEditorHandle>(null);
  const [workingPalette, setWorkingPalette] = useState<WordPaletteDto | null>(palette);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [documentNodes, setDocumentNodes] = useState<PromptDocumentNode[]>(() =>
    createInitialPromptDocument(initialTermIds),
  );
  const documentNodesRef = useRef(documentNodes);
  documentNodesRef.current = documentNodes;
  const [documentEpoch, setDocumentEpoch] = useState(0);
  const [preservedNegativePrompt, setPreservedNegativePrompt] = useState('');
  const [selectedPromptText, setSelectedPromptText] = useState<string | null>(null);
  const [combineSource, setCombineSource] = useState<CombineSource | null>(null);
  const [parameters, setParameters] = useState<PaletteParameterDraft[]>([]);
  const parametersRef = useRef(parameters);
  parametersRef.current = parameters;
  const [referenceAssets, setReferenceAssets] = useState<AssetDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [fullWindow, setFullWindow] = useState(false);
  const [termQuery, setTermQuery] = useState('');
  const [revisionId, setRevisionId] = useState(palette?.revisionId ?? '');
  const revision =
    workingPalette?.revisions.find((item) => item.id === revisionId) ??
    workingPalette?.revisions.find((item) => item.id === workingPalette.revisionId) ??
    workingPalette?.revisions[0];
  const creating = !workingPalette;

  function changeFullWindow(open: boolean) {
    setFullWindow(open);
    onFullWindowChange?.(open);
  }

  useEffect(() => {
    if (!fullWindow) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      changeFullWindow(false);
      requestAnimationFrame(() =>
        document.querySelector<HTMLButtonElement>('[data-action="word-palette-prompt-full-window"]')?.focus(),
      );
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullWindow, onFullWindowChange]);

  const availableTerms = useMemo(() => {
    const byId = new Map(terms.map((term) => [term.id, term]));
    for (const paletteRevision of workingPalette?.revisions ?? []) {
      for (const term of paletteRevision.terms) byId.set(term.id, term);
      for (const node of paletteRevision.promptNodes) {
        if (node.kind === 'TERM') byId.set(node.term.id, node.term);
      }
      for (const parameter of paletteRevision.parameters) {
        for (const option of parameter.options) {
          for (const content of option.contents) {
            if (content.kind === 'TERM') byId.set(content.term.id, content.term);
          }
        }
      }
    }
    return [...byId.values()];
  }, [terms, workingPalette]);

  useEffect(() => {
    if (!palette) return;
    setWorkingPalette(palette);
    setRevisionId(palette.revisionId);
  }, [palette?.id, palette?.revisionId]);

  useEffect(() => {
    if (!revision) return;
    const localized = resolveWordPaletteContent(revision, locale);
    setName(localized.name);
    setDescription(localized.description);
    setDocumentNodes(loadPromptDocument(revision));
    setPreservedNegativePrompt(loadPromptDocumentNegative(revision));
    setSelectedPromptText(null);
    setCombineSource(null);
    const nextParameters = paletteParameterDrafts(revision, locale);
    parametersRef.current = nextParameters;
    setParameters(nextParameters);
    setReferenceAssets(revision.referenceAssets);
    setError('');
    setDocumentEpoch((current) => current + 1);
  }, [locale, revision?.id]);

  const activeSlotKeys = useMemo(() => new Set(promptDocumentSlotKeys(documentNodes)), [documentNodes]);
  const activeParameters = useMemo(
    () => parameters.filter((parameter) => activeSlotKeys.has(parameter.stableKey)),
    [activeSlotKeys, parameters],
  );

  const topLevelTermIds = useMemo(() => [...new Set(promptDocumentTermIds(documentNodes))], [documentNodes]);
  const selectedTerms = useMemo(() => {
    const ids = new Set(topLevelTermIds);
    return availableTerms.filter((term) => ids.has(term.id));
  }, [availableTerms, topLevelTermIds]);
  const filteredTerms = useMemo(() => {
    const query = termQuery.trim().toLocaleLowerCase();
    if (!query) return availableTerms;
    return availableTerms.filter((term) =>
      [term.title, ...term.localizations.map((item) => item.title), term.stableKey, ...term.aliases].some((value) =>
        value.toLocaleLowerCase().includes(query),
      ),
    );
  }, [availableTerms, termQuery]);
  const preview = useMemo(
    () => renderPromptDocumentPreview(documentNodes, availableTerms, activeParameters),
    [activeParameters, availableTerms, documentNodes],
  );

  function setParameterState(next: PaletteParameterDraft[]) {
    parametersRef.current = next;
    setParameters(next);
  }

  function createChoice(seeds: ChoiceSeed[]) {
    const current = parametersRef.current;
    let group = createChoiceGroup(current, locale, seeds);
    const inferredName = choiceFacetName(seeds, facets);
    if (inferredName) {
      const editingPrimary = paletteLocaleMatches(group.nameLocale, locale);
      group = {
        ...group,
        name: inferredName,
        localizations: editingPrimary
          ? group.localizations
          : replacePaletteLocalization(group.localizations, locale, { locale, name: inferredName }),
      };
    }
    setParameterState([...current, group]);
    return group;
  }

  function addTermToChoice(stableKey: string, term: TermListItem) {
    const current = parametersRef.current;
    const groupIndex = current.findIndex((group) => group.stableKey === stableKey);
    if (groupIndex < 0) return null;
    const group = current[groupIndex];
    if (group.options.some((option) => option.termIds.includes(term.id))) return group;
    const activeKeys = new Set(promptDocumentSlotKeys(documentNodesRef.current));
    const otherGroupIndex = current.findIndex(
      (item) => activeKeys.has(item.stableKey) && item.options.some((option) => option.termIds.includes(term.id)),
    );
    if (otherGroupIndex >= 0 && otherGroupIndex !== groupIndex) return null;
    const updated = { ...group, options: [...group.options, createTermOption(group.options, term, locale)] };
    const next = current.map((item, index) => (index === groupIndex ? updated : item));
    setParameterState(next);
    return updated;
  }

  function setChoiceDefault(stableKey: string, optionIndex: number) {
    const current = parametersRef.current;
    const groupIndex = current.findIndex((group) => group.stableKey === stableKey);
    const group = current[groupIndex];
    const option = group?.options[optionIndex];
    if (!group || !option) return null;
    if (optionIndex === 0) return group;
    const updated = {
      ...group,
      options: [option, ...group.options.filter((_, index) => index !== optionIndex)],
    };
    const next = current.map((item, index) => (index === groupIndex ? updated : item));
    setParameterState(next);
    return updated;
  }

  // Keep detached groups in memory so native editor Undo/Redo can restore a
  // deleted choice with its options intact. Only active SLOT groups are saved.
  function removeChoice() {}

  function updateDocument(nextNodes: PromptDocumentNode[]) {
    documentNodesRef.current = nextNodes;
    setDocumentNodes(nextNodes);
  }

  function toggleTerm(term: TermListItem) {
    if (topLevelTermIds.includes(term.id)) inlineEditorRef.current?.removeTerm(term.id);
    else inlineEditorRef.current?.insertTerm(term);
  }

  function combineTerms(sourceTermId: string, targetTermId: string, sourceNodeKey?: string) {
    const source = availableTerms.find((term) => term.id === sourceTermId);
    const target = availableTerms.find((term) => term.id === targetTermId);
    if (source && target) inlineEditorRef.current?.combineTerms(source, target, sourceNodeKey);
  }

  function requestCombineTerm(term: TermListItem, nodeKey?: string) {
    if (!nodeKey && selectedPromptText && inlineEditorRef.current?.combineSelectionWithTerm(term)) {
      setSelectedPromptText(null);
      return;
    }
    setCombineSource({ kind: 'TERM', term, ...(nodeKey ? { nodeKey } : {}) });
  }

  function chooseCombineTarget(term: TermListItem) {
    const source = combineSource;
    setCombineSource(null);
    if (!source) return;
    if (source.kind === 'TERM') inlineEditorRef.current?.combineTerms(source.term, term, source.nodeKey);
    else inlineEditorRef.current?.combineSelectionWithTerm(term, source.sourceTerm);
  }

  async function addReferenceImages() {
    const selection = await window.desktopApi.assetsChooseReferences();
    setReferenceAssets((current) =>
      [...current, ...selection.assets.filter((asset) => !current.some((item) => item.id === asset.id))].slice(0, 16),
    );
  }

  function moveReferenceImage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= referenceAssets.length) return;
    setReferenceAssets((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function save() {
    const parametersToSave = parameters.filter((parameter) => activeSlotKeys.has(parameter.stableKey));
    const mappedParameters = paletteParameterInputs(parametersToSave, locale);
    const promptNodes = promptDocumentInputs(documentNodes, preservedNegativePrompt);
    const slotKeys = promptDocumentSlotKeys(documentNodes);
    const validSlots =
      slotKeys.length === parametersToSave.length &&
      new Set(slotKeys).size === slotKeys.length &&
      parametersToSave.every((parameter) => slotKeys.includes(parameter.stableKey));
    const hasPromptContent = promptNodes.some(
      (node) => node.kind !== 'TEXT' || node.promptFragment.trim() || node.negativeFragment.trim(),
    );
    if (
      !name.trim() ||
      (!hasPromptContent && !referenceAssets.length) ||
      !validSlots ||
      !paletteParametersAreValid(parametersToSave)
    ) {
      setError(l.invalid);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const source = revision ?? workingPalette;
      const nameLocale = source?.nameLocale ?? locale;
      const editingPrimary = !source || paletteLocaleMatches(nameLocale, locale);
      const localizations = !source
        ? []
        : editingPrimary
          ? source.localizations.filter((item) => !paletteLocaleMatches(item.locale, nameLocale))
          : replacePaletteLocalization(source.localizations, locale, {
              locale,
              name: name.trim(),
              description: description.trim(),
            });
      const shared = {
        locale,
        name: editingPrimary ? name.trim() : (source?.name ?? name.trim()),
        nameLocale,
        description: editingPrimary ? description.trim() : (source?.description ?? description.trim()),
        localizations,
        referenceAssetIds: referenceAssets.map((asset) => asset.id),
        parameters: mappedParameters,
        promptNodes,
      };
      const saved = workingPalette
        ? await window.desktopApi.wordPaletteUpdate({ paletteId: workingPalette.id, ...shared })
        : await window.desktopApi.wordPaletteCreate(shared);
      setWorkingPalette(saved);
      setRevisionId(saved.revisionId);
      await onSaved(saved, workingPalette ? 'updated' : 'created');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function setArchived() {
    if (!workingPalette) return;
    setBusy(true);
    setError('');
    const archived = workingPalette.status !== 'ARCHIVED';
    try {
      await window.desktopApi.wordPaletteSetArchived(workingPalette.id, archived);
      await onLifecycleChanged(archived ? 'archived' : 'restored');
      onBack();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!workingPalette) return;
    setBusy(true);
    setError('');
    try {
      await window.desktopApi.wordPaletteDelete(workingPalette.id);
      setDeleteOpen(false);
      await onLifecycleChanged('deleted');
      onBack();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setDeleteOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const combineSourceLabel =
    combineSource?.kind === 'TERM' ? resolveTermTitle(combineSource.term, locale) : combineSource?.text;
  return (
    <section
      data-word-palette-editor
      data-word-palette-full-window={fullWindow ? 'true' : 'false'}
      className={cn(
        'grid size-full min-h-0 overflow-hidden bg-background',
        fullWindow
          ? 'fixed inset-0 z-40 grid-cols-[minmax(500px,44vw)_minmax(0,1fr)] rounded-none border-0'
          : 'grid-cols-[340px_minmax(0,1fr)] rounded-lg border',
      )}
    >
      <aside className={cn('grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border-r', fullWindow && 'hidden')}>
        <header className="border-b p-3">
          <Button
            data-action="word-palette-editor-back"
            type="button"
            variant="ghost"
            size="sm"
            className="mb-2 -ml-2"
            onClick={onBack}
          >
            <ArrowLeftIcon className="size-4" />
            {l.back}
          </Button>
          <div className="flex items-center justify-between gap-3">
            <strong>{creating ? l.createTitle : l.title}</strong>
            {workingPalette && (
              <div className="flex items-center gap-2">
                <MetaText>{l.revision}</MetaText>
                <Select value={revision?.id ?? ''} onValueChange={setRevisionId}>
                  <SelectTrigger className="h-7 w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {workingPalette.revisions.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        V{item.revisionNo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <StateTag
                  tone={workingPalette.status === 'ARCHIVED' ? 'locked' : 'success'}
                  className={workingPalette.status === 'ARCHIVED' ? 'text-lifecycle-archived' : undefined}
                  icon={workingPalette.status === 'ARCHIVED' ? <ArchiveIcon /> : <CircleCheckIcon />}
                >
                  {workingPalette.status === 'ARCHIVED' ? l.archived : l.active}
                </StateTag>
              </div>
            )}
          </div>
        </header>
        <ScrollArea type="always" className="min-h-0">
          <div className="grid gap-4 p-4 pr-5">
            <div className="grid gap-2">
              <Label htmlFor="palette-editor-name">{l.name}</Label>
              <Input
                id="palette-editor-name"
                data-action="word-palette-editor-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="palette-editor-description">{l.description}</Label>
              <Textarea
                id="palette-editor-description"
                className="min-h-20 resize-none"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <section className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>
                  {l.referenceImages} · {referenceAssets.length}
                </Label>
                <Button type="button" variant="outline" size="sm" onClick={() => void addReferenceImages()}>
                  <ImagesIcon className="size-4" />
                  {l.addImages}
                </Button>
              </div>
              {referenceAssets.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {referenceAssets.map((asset, index) => (
                    <div
                      key={asset.id}
                      className="group relative h-24 w-16 shrink-0 overflow-hidden rounded-md border bg-media-surround-light"
                    >
                      <img className="size-full object-contain" src={asset.mediaUrl} alt="" />
                      <div className="absolute inset-x-1 bottom-1 flex justify-center rounded bg-overlay opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={index === 0}
                          onClick={() => moveReferenceImage(index, -1)}
                        >
                          <ChevronLeftIcon className="size-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={index === referenceAssets.length - 1}
                          onClick={() => moveReferenceImage(index, 1)}
                        >
                          <ChevronRightIcon className="size-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() =>
                            setReferenceAssets((current) => current.filter((item) => item.id !== asset.id))
                          }
                        >
                          <XIcon className="size-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </ScrollArea>
        <footer className="flex items-center gap-2 border-t p-3">
          {workingPalette && (
            <Button
              data-action="word-palette-archive"
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void setArchived()}
            >
              <ArchiveIcon className="size-4" />
              {workingPalette.status === 'ARCHIVED' ? l.restore : l.archive}
            </Button>
          )}
          {workingPalette && (
            <Button
              data-action="word-palette-delete"
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={l.delete}
              disabled={busy}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2Icon className="size-4" />
            </Button>
          )}
          <Button
            data-action={creating ? 'word-palette-create' : 'word-palette-update'}
            type="button"
            size="sm"
            className="ml-auto"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? l.saving : creating ? `${l.create} · V1` : `${l.saveNext} · V${workingPalette.revisionNo + 1}`}
          </Button>
        </footer>
      </aside>

      <div
        className={cn(
          'grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] overflow-hidden',
          fullWindow
            ? 'col-start-2 row-start-1 grid-rows-[minmax(0,1fr)_auto] gap-3 p-5 pt-14'
            : 'grid-rows-[auto_minmax(0,1fr)_auto]',
        )}
      >
        <WordPaletteInlinePromptEditor
          key={`${revision?.id ?? 'new'}:${documentEpoch}`}
          ref={inlineEditorRef}
          nodes={documentNodes}
          terms={availableTerms}
          groups={activeParameters}
          selectedText={selectedPromptText}
          fullWindow={fullWindow}
          onNodesChange={updateDocument}
          onSelectionChange={setSelectedPromptText}
          onRequestCombineSelection={(text, sourceTerm) => {
            const sourceText = text ?? selectedPromptText;
            if (sourceText) setCombineSource({ kind: 'PROMPT', text: sourceText, sourceTerm });
          }}
          onCreateChoice={createChoice}
          onAddTermToChoice={addTermToChoice}
          onSetChoiceDefault={setChoiceDefault}
          onRemoveChoice={removeChoice}
          onRequestCombine={requestCombineTerm}
          onFullWindowChange={changeFullWindow}
        />
        {!fullWindow && (
          <div className="min-h-0 min-w-0 overflow-hidden">
            <WordPalette
              locale={locale}
              terms={availableTerms}
              facets={facets}
              selectedTerms={selectedTerms}
              onToggle={toggleTerm}
              onClear={() => inlineEditorRef.current?.clearTerms()}
              onCombineTerms={combineTerms}
              onRequestCombineTerm={(term) => requestCombineTerm(term)}
            />
          </div>
        )}
        {preview && (
          <footer className="grid min-w-0 gap-1 overflow-hidden border-t bg-muted/20 px-4 py-3 text-sm">
            <strong className="text-xs">{l.outputPreview}</strong>
            <p className="line-clamp-2 min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{preview}</p>
          </footer>
        )}
      </div>

      {fullWindow && (
        <aside className="col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col overflow-hidden border-r bg-background pt-9">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
            <strong className="shrink-0">{messages.creator.dictionaryPicker.dictionary}</strong>
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                className="h-8 pl-9"
                value={termQuery}
                onChange={(event) => setTermQuery(event.target.value)}
                placeholder={messages.creator.dictionaryPicker.search}
              />
            </div>
          </header>
          <div className="min-h-0 flex-1">
            <WordPalette
              locale={locale}
              terms={filteredTerms}
              facets={facets}
              selectedTerms={selectedTerms}
              onToggle={toggleTerm}
              onClear={() => inlineEditorRef.current?.clearTerms()}
              onCombineTerms={combineTerms}
              onRequestCombineTerm={(term) => requestCombineTerm(term)}
            />
          </div>
        </aside>
      )}

      <Dialog
        open={Boolean(combineSource)}
        onOpenChange={(open) => {
          if (!open) setCombineSource(null);
        }}
      >
        <DialogContent className="max-w-sm gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle className="truncate text-base">
              {l.combineOptions}
              {combineSourceLabel ? ` · ${combineSourceLabel}` : ''}
            </DialogTitle>
            <DialogDescription className="sr-only">{l.chooseTerm}</DialogDescription>
          </DialogHeader>
          <Command label={l.chooseTerm}>
            <CommandInput placeholder={l.chooseTerm} />
            <CommandList ariaLabel={l.chooseTerm} className="max-h-96">
              <CommandEmpty>{l.noTerms}</CommandEmpty>
              {availableTerms
                .filter((term) => combineSource?.kind !== 'TERM' || term.id !== combineSource.term.id)
                .map((term) => (
                  <CommandItem
                    key={term.id}
                    value={[
                      term.title,
                      ...term.localizations.map((item) => item.title),
                      term.stableKey,
                      ...term.aliases,
                    ].join(' ')}
                    onSelect={() => chooseCombineTarget(term)}
                  >
                    <BookOpenIcon className="size-4" />
                    <span className="min-w-0 flex-1 truncate">{resolveTermTitle(term, locale)}</span>
                    {resolveAlternateTermTitle(term, locale) && (
                      <span className="truncate text-xs text-muted-foreground">
                        {resolveAlternateTermTitle(term, locale)}
                      </span>
                    )}
                  </CommandItem>
                ))}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{l.deleteTitle}</DialogTitle>
            <DialogDescription>{l.deleteDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              {l.cancel}
            </Button>
            <Button
              data-action="word-palette-delete-confirm"
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void remove()}
            >
              {l.confirmDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
