import type { Locale } from '@/shared/contracts';
import { ArrowLeftIcon, ArrowUpDownIcon, EyeIcon, EyeOffIcon, PlusIcon, SearchIcon } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { ClassificationInspector } from '@/renderer/components/dictionary/classifications/ClassificationInspector';
import { ClassificationTree } from '@/renderer/components/dictionary/classifications/ClassificationTree';
import type {
  ClassificationMutations,
  ClassificationTreeModel,
} from '@/renderer/components/dictionary/classifications/useClassificationManager';

interface SharedProps {
  locale: Locale;
  model: ClassificationTreeModel;
  actions: ClassificationMutations;
}

function ClassificationHeader({ locale, model, actions, onBack }: SharedProps & { onBack(): void }) {
  const { messages } = useI18n();
  const copy = messages.dictionary.classifications.header;
  const number = new Intl.NumberFormat(locale);
  return (
    <header className="flex h-[5.25rem] shrink-0 items-center gap-5 px-4">
      <Button type="button" variant="outline" onClick={onBack}>
        <ArrowLeftIcon className="size-4" />
        {copy.back}
      </Button>
      <div className="flex min-w-0 items-baseline gap-5">
        <h1 className="shrink-0 text-xl font-semibold tracking-tight">{copy.title}</h1>
        {model.treeDto && (
          <p className="truncate text-xs text-muted-foreground">
            {copy.summary(
              number.format(model.treeDto.rootCount),
              number.format(model.treeDto.categoryCount),
              number.format(model.treeDto.termCount),
            )}
          </p>
        )}
      </div>
      <div className="relative ml-auto w-[min(28rem,38vw)]">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={model.query}
          className="bg-surface pl-9"
          placeholder={copy.search}
          onChange={(event) => model.setQuery(event.target.value)}
        />
      </div>
      <Button
        data-action="classification-new-root"
        type="button"
        onClick={() => actions.setEditorState({ mode: 'create', parent: null })}
      >
        <PlusIcon className="size-4" />
        {copy.newTopLevel}
      </Button>
    </header>
  );
}

function RootCategoryPane({ model, actions }: SharedProps) {
  const { messages } = useI18n();
  const copy = messages.dictionary.classifications.header;
  return (
    <aside className="flex min-h-0 flex-col border-r bg-surface">
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <h2 className="text-sm font-semibold">
          {copy.topLevelCategories}{' '}
          <span className="ml-1 font-normal text-muted-foreground">{model.treeDto?.rootCount ?? 0}</span>
        </h2>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-pressed={model.showDisabledRoots}
            aria-label={model.showDisabledRoots ? copy.hideDisabled : copy.showDisabled}
            title={model.showDisabledRoots ? copy.hideDisabled : copy.showDisabled}
            onClick={() => model.setShowDisabledRoots(!model.showDisabledRoots)}
          >
            {model.showDisabledRoots ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={copy.changeSorting}
            title={copy.changeSorting}
            disabled={(model.treeDto?.rootCount ?? 0) < 2}
            onClick={() => actions.setRootOrderOpen(true)}
          >
            <ArrowUpDownIcon className="size-4" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {model.displayedRoots.map((root) => (
          <button
            key={root.id}
            data-classification-root-id={root.id}
            type="button"
            className={cn(
              'mb-0.5 flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition-colors duration-fast hover:bg-hover',
              model.activeRoot?.id === root.id && 'bg-selected font-medium text-selected-foreground hover:bg-selected',
              root.state === 'DISABLED' && 'text-disabled-foreground',
              model.dropTargetId === root.id && 'ring-1 ring-inset ring-selected-border',
            )}
            onClick={() => model.selectNode(root.id)}
            onDragEnter={(event) => {
              if (!model.draggingId || model.draggingId === root.id) return;
              event.preventDefault();
              model.setDropTargetId(root.id);
            }}
            onDragOver={(event) => {
              if (!model.draggingId || model.draggingId === root.id) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(event) => {
              if (!model.draggingId || model.draggingId === root.id) return;
              event.preventDefault();
              const source = model.tree.byId.get(model.draggingId);
              if (source) actions.openMove(source, root.id);
              model.setDropTargetId(null);
              model.setDraggingId(null);
            }}
          >
            <span className="min-w-0 flex-1 truncate">{root.name}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{root.subtreeTermCount}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function ClassificationTreePane({ model, actions }: SharedProps) {
  const { messages } = useI18n();
  const copy = messages.dictionary.classifications.header;
  return (
    <section className="flex min-h-0 flex-col border-r bg-surface">
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
        <h2 className="min-w-0 truncate text-sm font-semibold">
          {model.activeRoot?.name ?? copy.classifications} · {copy.tree}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => model.setExpandedIds(new Set())}>
            {copy.collapseAll}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!model.activeRoot || model.activeRoot.state === 'DISABLED'}
            onClick={() => model.activeRoot && actions.setEditorState({ mode: 'create', parent: model.activeRoot })}
          >
            <PlusIcon className="size-3.5" />
            {copy.newClassification}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {model.activeRoot && (
          <ClassificationTree
            rootId={model.activeRoot.id}
            tree={model.tree}
            selectedId={model.selectedId}
            expandedIds={model.expandedIds}
            visibleIds={model.search.visibleIds}
            searchActive={Boolean(model.query.trim())}
            busy={actions.busy}
            draggingId={model.draggingId}
            dropTargetId={model.dropTargetId}
            onSelect={model.selectNode}
            onToggle={model.toggleExpanded}
            onCreateChild={(node) => actions.setEditorState({ mode: 'create', parent: node })}
            onRename={(node) => actions.setEditorState({ mode: 'rename', parent: null, node })}
            onMove={(node) => actions.openMove(node)}
            onReorder={(node, direction) => void actions.reorderNode(node, direction)}
            onSetState={actions.setStateNode}
            onDragStart={model.setDraggingId}
            onDragEnd={() => {
              model.setDraggingId(null);
              model.setDropTargetId(null);
            }}
            onDropTargetChange={model.setDropTargetId}
            onDrop={(sourceId, targetParentId) => {
              const source = model.tree.byId.get(sourceId);
              if (source) actions.openMove(source, targetParentId);
              model.setDraggingId(null);
            }}
          />
        )}
      </div>
    </section>
  );
}

function InspectorPane({
  model,
  actions,
  onOpenTerm,
  onCreateTerm,
}: SharedProps & {
  onOpenTerm(id: string): void;
  onCreateTerm(nodeId: string, path: string): void;
}) {
  if (!model.selectedNode) return <div />;
  const node = model.selectedNode;
  return (
    <ClassificationInspector
      node={node}
      parent={model.selectedParent}
      children={model.selectedChildren}
      terms={model.terms}
      termsLoading={model.termsLoading}
      includeDescendants={model.includeDescendants}
      termQuery={model.termQuery}
      busy={actions.busy}
      onTermQueryChange={model.setTermQuery}
      onIncludeDescendantsChange={model.setIncludeDescendants}
      onSelect={model.selectNode}
      onSave={(name, nameLocale, localizations) => void actions.saveNode(node, name, nameLocale, localizations)}
      onCreateChild={() => actions.setEditorState({ mode: 'create', parent: node })}
      onMove={() => actions.openMove(node)}
      onMerge={() => actions.setMergeNode(node)}
      onSetState={() => actions.setStateNode(node)}
      onRestoreSource={() => actions.setRestoreNode(node)}
      onOpenTerm={onOpenTerm}
      onCreateTerm={() => onCreateTerm(node.id, node.path)}
    />
  );
}

export function ClassificationManagementView({
  locale,
  model,
  actions,
  onBack,
  onOpenTerm,
  onCreateTerm,
}: SharedProps & {
  onBack(): void;
  onOpenTerm(id: string): void;
  onCreateTerm(nodeId: string, path: string): void;
}) {
  return (
    <div className="flex size-full min-h-0 flex-col overflow-hidden bg-background" data-dictionary-classifications>
      <ClassificationHeader locale={locale} model={model} actions={actions} onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-x-auto px-3 pb-3">
        <div className="grid size-full min-w-[72rem] grid-cols-[15rem_27rem_minmax(30rem,1fr)] overflow-hidden rounded-lg border bg-surface 2xl:grid-cols-[19rem_28rem_minmax(32rem,1fr)]">
          <RootCategoryPane locale={locale} model={model} actions={actions} />
          <ClassificationTreePane locale={locale} model={model} actions={actions} />
          <InspectorPane
            locale={locale}
            model={model}
            actions={actions}
            onOpenTerm={onOpenTerm}
            onCreateTerm={onCreateTerm}
          />
        </div>
      </div>
    </div>
  );
}
