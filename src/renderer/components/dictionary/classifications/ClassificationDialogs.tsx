import type {
  DictionaryClassificationMergeConflictAction,
  DictionaryClassificationMergeConflictResolutionDto,
  DictionaryClassificationMergePreviewDto,
  DictionaryClassificationMovePreviewDto,
  DictionaryClassificationLocalizationDto,
  DictionaryClassificationNodeDto,
  Locale,
} from '@/shared/contracts';
import { CheckCircle2Icon, ChevronDownIcon, FolderTreeIcon, LoaderCircleIcon, SearchIcon } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import {
  I18nTextInput,
  isI18nTextValueValid,
  type I18nTextTranslation,
} from '@/renderer/components/ui/i18n-text-input';
import { Input } from '@/renderer/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import {
  buildClassificationTree,
  classificationAncestors,
  classificationDescendantIds,
  classificationParentKey,
} from '@/renderer/components/dictionary/classifications/classification-tree';

interface EditorDialogState {
  mode: 'create' | 'rename';
  parent: DictionaryClassificationNodeDto | null;
  node?: DictionaryClassificationNodeDto;
}

export function ClassificationEditorDialog({
  locale,
  state,
  busy,
  onClose,
  onSubmit,
}: {
  locale: Locale;
  state: EditorDialogState | null;
  busy: boolean;
  onClose(): void;
  onSubmit(name: string, nameLocale: string, localizations: DictionaryClassificationLocalizationDto[]): void;
}) {
  const { messages } = useI18n();
  const copy = messages.dictionary.classifications.dialogs;
  const [name, setName] = useState('');
  const [nameLocale, setNameLocale] = useState<string>(locale);
  const [localizations, setLocalizations] = useState<DictionaryClassificationLocalizationDto[]>([]);
  useEffect(() => {
    setName(state?.node?.name ?? '');
    setNameLocale(state?.node?.nameLocale ?? locale);
    setLocalizations(state?.node?.localizations ?? []);
  }, [locale, state]);
  if (!state) return null;
  const creatingRoot = state.mode === 'create' && !state.parent;
  const title = state.mode === 'rename' ? copy.renameTitle : creatingRoot ? copy.newTopLevelTitle : copy.newChildTitle;
  const translations: I18nTextTranslation[] = localizations.map((item) => ({
    locale: item.locale,
    value: item.name,
  }));
  const namesValid = isI18nTextValueValid(name, nameLocale, translations);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg" data-dialog="classification-editor">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {state.mode === 'rename'
              ? state.node?.path
              : state.parent
                ? copy.parent(state.parent.path)
                : copy.newTopLevelDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="grid gap-1.5 text-xs text-muted-foreground">
            <span>{copy.name}</span>
            <I18nTextInput
              value={name}
              locale={nameLocale}
              translations={translations}
              valueInputId="classification-name"
              localeInputId="classification-name-locale"
              valueMaxLength={160}
              autoFocus
              placeholder={copy.namePlaceholder}
              labels={{
                language: copy.language,
                value: copy.localizedName,
                addLanguage: copy.addLanguage,
                removeLanguage: copy.removeLanguage,
                expandLanguages: messages.dictionary.classifications.tree.expand,
                collapseLanguages: messages.dictionary.classifications.tree.collapse,
              }}
              onValueChange={setName}
              onLocaleChange={setNameLocale}
              onTranslationsChange={(items) =>
                setLocalizations(items.map((item) => ({ locale: item.locale, name: item.value })))
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button
            data-action="classification-submit"
            type="button"
            disabled={busy || !namesValid}
            onClick={() => onSubmit(name, nameLocale, localizations)}
          >
            {busy && <LoaderCircleIcon className="size-4 animate-spin" />}
            {state.mode === 'rename' ? copy.saveChanges : copy.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TargetTree({
  nodes,
  sourceId,
  selectedId,
  query,
  allowTopLevel,
  excludeAncestors = false,
  onSelect,
}: {
  nodes: DictionaryClassificationNodeDto[];
  sourceId: string;
  selectedId: string | null;
  query: string;
  allowTopLevel: boolean;
  excludeAncestors?: boolean;
  onSelect(id: string | null): void;
}) {
  const { messages } = useI18n();
  const copy = messages.dictionary.classifications.dialogs;
  const tree = useMemo(() => buildClassificationTree(nodes), [nodes]);
  const excluded = classificationDescendantIds(sourceId, tree);
  if (excludeAncestors) {
    for (const ancestor of classificationAncestors(sourceId, tree)) excluded.add(ancestor.id);
  }
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const renderBranches = (parentId: string | null, depth: number): ReactNode =>
    (tree.childrenByParent.get(classificationParentKey(parentId)) ?? []).map((node) => {
      const unavailable = excluded.has(node.id) || node.state === 'DISABLED';
      const matches = !normalizedQuery || node.path.toLocaleLowerCase().includes(normalizedQuery);
      const descendantMatches = [...tree.byId.values()].some(
        (candidate) =>
          candidate.path.startsWith(`${node.path} / `) && candidate.path.toLocaleLowerCase().includes(normalizedQuery),
      );
      if (normalizedQuery && !matches && !descendantMatches) return null;
      return (
        <div key={node.id}>
          <button
            type="button"
            disabled={unavailable}
            className={cn(
              'flex h-8 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-hover disabled:text-disabled-foreground',
              selectedId === node.id && 'bg-selected font-medium text-selected-foreground hover:bg-selected',
            )}
            style={{ paddingLeft: `${8 + depth * 18}px` }}
            onClick={() => onSelect(node.id)}
          >
            {node.childCount ? <ChevronDownIcon className="size-3.5" /> : <span className="size-3.5" />}
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
          </button>
          {renderBranches(node.id, depth + 1)}
        </div>
      );
    });
  return (
    <div className="max-h-[19rem] overflow-y-auto rounded-md border bg-background p-1.5">
      {allowTopLevel && (
        <button
          type="button"
          className={cn(
            'mb-1 flex h-8 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-hover',
            selectedId === null && 'bg-selected font-medium text-selected-foreground hover:bg-selected',
          )}
          onClick={() => onSelect(null)}
        >
          <FolderTreeIcon className="size-3.5" />
          {copy.topLevel}
        </button>
      )}
      {renderBranches(null, 0)}
    </div>
  );
}

export function MoveClassificationDialog({
  node,
  nodes,
  initialParentId,
  busy,
  onPreview,
  onClose,
  onCommit,
}: {
  node: DictionaryClassificationNodeDto | null;
  nodes: DictionaryClassificationNodeDto[];
  initialParentId: string | null;
  busy: boolean;
  onPreview(parentId: string | null): Promise<DictionaryClassificationMovePreviewDto>;
  onClose(): void;
  onCommit(parentId: string | null): void;
}) {
  const { messages } = useI18n();
  const copy = messages.dictionary.classifications.dialogs;
  const [targetParentId, setTargetParentId] = useState<string | null>(initialParentId);
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<DictionaryClassificationMovePreviewDto | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  useEffect(() => {
    setTargetParentId(initialParentId);
    setQuery('');
  }, [initialParentId, node?.id]);
  useEffect(() => {
    if (!node || targetParentId === node.parentId) {
      setPreview(null);
      setPreviewError('');
      return;
    }
    let alive = true;
    setPreviewLoading(true);
    setPreviewError('');
    void onPreview(targetParentId)
      .then((result) => alive && setPreview(result))
      .catch((reason) => alive && setPreviewError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => alive && setPreviewLoading(false));
    return () => {
      alive = false;
    };
  }, [node, onPreview, targetParentId]);
  if (!node) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{copy.moveTitle(node.name)}</DialogTitle>
          <DialogDescription>{copy.moveDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] rounded-md border text-xs">
            <span className="bg-surface-sunken px-3 py-2 text-muted-foreground">{copy.currentPosition}</span>
            <strong className="truncate px-3 py-2 font-medium">{node.path}</strong>
          </div>
          <strong className="text-xs">{copy.newParent}</strong>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              className="pl-9"
              placeholder={copy.search}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <TargetTree
            nodes={nodes}
            sourceId={node.id}
            selectedId={targetParentId}
            query={query}
            allowTopLevel
            onSelect={setTargetParentId}
          />
          {preview && (
            <>
              <p className="text-xs">
                {copy.moveTo}
                <strong className="ml-2 text-selected-foreground">{preview.targetPath}</strong>
              </p>
              <div className="overflow-hidden rounded-md border text-xs">
                <div className="grid grid-cols-2 border-b px-3 py-2">
                  <span className="text-muted-foreground">{copy.classification}</span>
                  <span>{preview.classificationName}</span>
                </div>
                <div className="grid grid-cols-2 border-b px-3 py-2">
                  <span className="text-muted-foreground">{copy.moveTogether}</span>
                  <span>{copy.childCount(preview.childClassificationCount)}</span>
                </div>
                <div className="grid grid-cols-2 px-3 py-2">
                  <span className="text-muted-foreground">{copy.affectedTerms}</span>
                  <span>{preview.termCount}</span>
                </div>
              </div>
              <p className="flex items-center gap-2 text-xs text-success">
                <CheckCircle2Icon className="size-3.5" />
                {copy.stableHistory}
              </p>
            </>
          )}
          {previewLoading && <p className="text-xs text-muted-foreground">{copy.calculatingImpact}</p>}
          {previewError && <p className="text-xs text-destructive">{previewError}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button
            type="button"
            disabled={busy || previewLoading || !preview || Boolean(previewError)}
            onClick={() => onCommit(targetParentId)}
          >
            {busy && <LoaderCircleIcon className="size-4 animate-spin" />}
            {copy.move}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MergeClassificationDialog({
  node,
  nodes,
  busy,
  onPreview,
  onClose,
  onCommit,
}: {
  node: DictionaryClassificationNodeDto | null;
  nodes: DictionaryClassificationNodeDto[];
  busy: boolean;
  onPreview(targetId: string): Promise<DictionaryClassificationMergePreviewDto>;
  onClose(): void;
  onCommit(targetId: string, resolutions: DictionaryClassificationMergeConflictResolutionDto[]): void;
}) {
  const { messages } = useI18n();
  const copy = messages.dictionary.classifications.dialogs;
  const [targetId, setTargetId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<DictionaryClassificationMergePreviewDto | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resolutionDrafts, setResolutionDrafts] = useState<
    Record<string, { action: DictionaryClassificationMergeConflictAction | null; renamedName: string }>
  >({});
  useEffect(() => {
    setTargetId(null);
    setQuery('');
    setPreview(null);
    setError('');
    setResolutionDrafts({});
  }, [node?.id]);
  useEffect(() => {
    if (!targetId) return;
    let alive = true;
    setLoading(true);
    setError('');
    setPreview(null);
    setResolutionDrafts({});
    void onPreview(targetId)
      .then((result) => {
        if (!alive) return;
        setPreview(result);
        setResolutionDrafts(
          Object.fromEntries(
            result.conflicts.map((conflict) => [
              conflict.sourceChildId,
              { action: null, renamedName: `${conflict.sourceName} 2` },
            ]),
          ),
        );
      })
      .catch((reason) => alive && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [onPreview, targetId]);
  if (!node) return null;
  const unresolvedConflict = (preview?.conflicts ?? []).some(
    (conflict) => !resolutionDrafts[conflict.sourceChildId]?.action,
  );
  const conflictResolutions = (preview?.conflicts ?? []).flatMap((conflict) => {
    const draft = resolutionDrafts[conflict.sourceChildId];
    if (!draft?.action) return [];
    return [
      {
        sourceChildId: conflict.sourceChildId,
        targetChildId: conflict.targetChildId,
        action: draft.action,
        ...(draft.action === 'RENAME' ? { renamedName: draft.renamedName.trim() } : {}),
      } satisfies DictionaryClassificationMergeConflictResolutionDto,
    ];
  });
  const invalidRename = conflictResolutions.some(
    (resolution) => resolution.action === 'RENAME' && !resolution.renamedName,
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{copy.mergeTitle(node.name)}</DialogTitle>
          <DialogDescription>{copy.mergeDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              className="pl-9"
              placeholder={copy.searchTarget}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <TargetTree
            nodes={nodes}
            sourceId={node.id}
            selectedId={targetId}
            query={query}
            allowTopLevel={false}
            excludeAncestors
            onSelect={setTargetId}
          />
          {preview && (
            <>
              <div className="overflow-hidden rounded-md border text-xs">
                <div className="grid grid-cols-2 border-b px-3 py-2">
                  <span className="text-muted-foreground">{copy.keep}</span>
                  <span>{preview.targetPath}</span>
                </div>
                <div className="grid grid-cols-2 border-b px-3 py-2">
                  <span className="text-muted-foreground">{copy.moveTerms}</span>
                  <span>{preview.directTermCount}</span>
                </div>
                <div className="grid grid-cols-2 px-3 py-2">
                  <span className="text-muted-foreground">{copy.moveChildren}</span>
                  <span>{preview.childClassificationCount}</span>
                </div>
              </div>
              {preview.conflicts.length > 0 && (
                <section className="grid gap-2 rounded-md border bg-surface-sunken p-3">
                  <h3 className="text-xs font-semibold">{copy.childConflicts}</h3>
                  {preview.conflicts.map((conflict) => {
                    const draft = resolutionDrafts[conflict.sourceChildId];
                    const action = draft?.action ?? undefined;
                    return (
                      <div key={conflict.sourceChildId} className="grid gap-2 rounded-md border bg-surface p-2.5">
                        <p className="truncate text-xs" title={`${conflict.sourceName} / ${conflict.targetName}`}>
                          <strong>{conflict.sourceName}</strong>
                          <span className="mx-2 text-muted-foreground">→</span>
                          <strong>{conflict.targetName}</strong>
                        </p>
                        <div className="grid grid-cols-[12rem_minmax(0,1fr)] gap-2">
                          <Select
                            value={action}
                            onValueChange={(value: DictionaryClassificationMergeConflictAction) =>
                              setResolutionDrafts((current) => ({
                                ...current,
                                [conflict.sourceChildId]: {
                                  action: value,
                                  renamedName:
                                    current[conflict.sourceChildId]?.renamedName ?? `${conflict.sourceName} 2`,
                                },
                              }))
                            }
                          >
                            <SelectTrigger aria-label={copy.conflictAction}>
                              <SelectValue placeholder={copy.chooseConflictAction} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="KEEP_BOTH">{copy.keepBoth}</SelectItem>
                              <SelectItem value="RENAME">{copy.renameBeforeMove}</SelectItem>
                              <SelectItem value="MERGE">{copy.mergeMatchingChildren}</SelectItem>
                            </SelectContent>
                          </Select>
                          {action === 'RENAME' && (
                            <Input
                              aria-label={copy.newName}
                              value={draft?.renamedName ?? `${conflict.sourceName} 2`}
                              onChange={(event) =>
                                setResolutionDrafts((current) => ({
                                  ...current,
                                  [conflict.sourceChildId]: {
                                    action: 'RENAME',
                                    renamedName: event.target.value,
                                  },
                                }))
                              }
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </section>
              )}
            </>
          )}
          {loading && <p className="text-xs text-muted-foreground">{copy.calculatingImpact}</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button
            type="button"
            disabled={busy || loading || !preview || Boolean(error) || unresolvedConflict || invalidRename}
            onClick={() => targetId && onCommit(targetId, conflictResolutions)}
          >
            {busy && <LoaderCircleIcon className="size-4 animate-spin" />}
            {copy.merge}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ClassificationRestoreSourceDialog({
  node,
  nodes,
  busy,
  onClose,
  onConfirm,
}: {
  node: DictionaryClassificationNodeDto | null;
  nodes: DictionaryClassificationNodeDto[];
  busy: boolean;
  onClose(): void;
  onConfirm(): void;
}) {
  const { messages } = useI18n();
  const copy = messages.dictionary.classifications.dialogs;
  if (!node?.sourceSnapshot) return null;
  const source = node.sourceSnapshot;
  const sourceParent = source.parentId ? nodes.find((candidate) => candidate.id === source.parentId) : null;
  const sourceLocalizations = source.localizations.map((item) => `${item.locale}: ${item.name}`).join(' · ');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.restoreSourceTitle(node.name)}</DialogTitle>
          <DialogDescription>{copy.restoreSourceDescription}</DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-md border text-xs">
          <div className="grid grid-cols-[8rem_minmax(0,1fr)] border-b px-3 py-2">
            <span className="text-muted-foreground">{copy.currentPosition}</span>
            <span>{node.path}</span>
          </div>
          <div className="grid grid-cols-[8rem_minmax(0,1fr)] border-b px-3 py-2">
            <span className="text-muted-foreground">{copy.packageName}</span>
            <span>{source.name}</span>
          </div>
          {sourceLocalizations && (
            <div className="grid grid-cols-[8rem_minmax(0,1fr)] border-b px-3 py-2">
              <span className="text-muted-foreground">{copy.otherLanguages}</span>
              <span>{sourceLocalizations}</span>
            </div>
          )}
          <div className="grid grid-cols-[8rem_minmax(0,1fr)] px-3 py-2">
            <span className="text-muted-foreground">{copy.packageParent}</span>
            <span>{sourceParent?.path ?? copy.topLevel}</span>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button type="button" disabled={busy} onClick={onConfirm}>
            {busy && <LoaderCircleIcon className="size-4 animate-spin" />}
            {copy.restoreSource}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ClassificationStateDialog({
  node,
  nodes,
  busy,
  onClose,
  onConfirm,
}: {
  node: DictionaryClassificationNodeDto | null;
  nodes: DictionaryClassificationNodeDto[];
  busy: boolean;
  onClose(): void;
  onConfirm(includeDescendants: boolean): void;
}) {
  const { messages } = useI18n();
  const copy = messages.dictionary.classifications.dialogs;
  const [includeDescendants, setIncludeDescendants] = useState(false);
  useEffect(() => setIncludeDescendants(false), [node?.id, node?.state]);
  if (!node) return null;
  const disabling = node.state === 'ACTIVE';
  const tree = buildClassificationTree(nodes);
  const activeDescendantCount = [...classificationDescendantIds(node.id, tree)].filter(
    (id) => id !== node.id && tree.byId.get(id)?.state === 'ACTIVE',
  ).length;
  const requiresSubtreeConfirmation = disabling && activeDescendantCount > 0;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{disabling ? copy.disableTitle(node.name) : copy.restoreTitle(node.name)}</DialogTitle>
          <DialogDescription>{disabling ? copy.disableDescription : copy.restoreDescription}</DialogDescription>
        </DialogHeader>
        {disabling && (
          <div className="grid gap-3">
            <div className="overflow-hidden rounded-md border text-xs">
              <div className="grid grid-cols-2 border-b px-3 py-2">
                <span className="text-muted-foreground">{copy.activeDescendants}</span>
                <span>{activeDescendantCount}</span>
              </div>
              <div className="grid grid-cols-2 px-3 py-2">
                <span className="text-muted-foreground">{copy.affectedTerms}</span>
                <span>{node.subtreeTermCount}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{copy.historicalTerms(node.subtreeTermCount)}</p>
            {requiresSubtreeConfirmation && (
              <label className="flex items-start gap-2 rounded-md border bg-surface-sunken px-3 py-2.5 text-xs">
                <Checkbox
                  className="mt-0.5"
                  checked={includeDescendants}
                  onCheckedChange={(checked) => setIncludeDescendants(checked === true)}
                />
                <span>{copy.disableSubtree(activeDescendantCount)}</span>
              </label>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button
            type="button"
            variant={disabling ? 'destructive' : 'default'}
            disabled={busy || (requiresSubtreeConfirmation && !includeDescendants)}
            onClick={() => onConfirm(includeDescendants)}
          >
            {busy && <LoaderCircleIcon className="size-4 animate-spin" />}
            {disabling ? copy.disable : copy.restore}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { EditorDialogState };
