import type { Locale } from '@/shared/contracts';
import { LoaderCircleIcon } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { NavigationMode } from '@/renderer/components/app/app-navigation';
import { Button } from '@/renderer/components/ui/button';
import {
  ClassificationEditorDialog,
  ClassificationRestoreSourceDialog,
  ClassificationStateDialog,
  MergeClassificationDialog,
  MoveClassificationDialog,
} from '@/renderer/components/dictionary/classifications/ClassificationDialogs';
import { ClassificationManagementView } from '@/renderer/components/dictionary/classifications/ClassificationManagementView';
import { RootCategoryOrderDialog } from '@/renderer/components/dictionary/classifications/RootCategoryOrderDialog';
import {
  useClassificationMutations,
  useClassificationTreeModel,
} from '@/renderer/components/dictionary/classifications/useClassificationManager';

interface Props {
  locale: Locale;
  selectedClassificationId: string | null;
  onSelectedClassificationIdChange(id: string | null, mode?: NavigationMode): void;
  onBack(): void;
  onOpenTerm(termId: string): void;
  onCreateTerm(classificationId: string, classificationPath: string): void;
  refresh(): Promise<void>;
  notify(message: string): void;
}

export function DictionaryClassificationScreen({
  locale,
  selectedClassificationId,
  onSelectedClassificationIdChange,
  onBack,
  onOpenTerm,
  onCreateTerm,
  refresh,
  notify,
}: Props) {
  const { messages } = useI18n();
  const copy = messages.dictionary.classifications.header;
  const model = useClassificationTreeModel(locale, notify, selectedClassificationId, onSelectedClassificationIdChange);
  const actions = useClassificationMutations({ locale, model, refresh, notify });

  if (model.loading && !model.treeDto) {
    return (
      <div className="grid size-full place-items-center bg-background text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <LoaderCircleIcon className="size-4 animate-spin" />
          {copy.loading}
        </span>
      </div>
    );
  }

  if (model.loadError && !model.treeDto) {
    return (
      <div className="grid size-full place-items-center bg-background">
        <div className="text-center">
          <p className="mb-3 text-sm text-destructive">{model.loadError}</p>
          <Button type="button" variant="outline" onClick={() => void model.loadTree()}>
            {copy.retry}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <ClassificationManagementView
        locale={locale}
        model={model}
        actions={actions}
        onBack={onBack}
        onOpenTerm={onOpenTerm}
        onCreateTerm={onCreateTerm}
      />
      <ClassificationEditorDialog
        locale={locale}
        state={actions.editorState}
        busy={actions.busy}
        onClose={() => actions.setEditorState(null)}
        onSubmit={(name, nameLocale, localizations) => void actions.submitEditor(name, nameLocale, localizations)}
      />
      <MoveClassificationDialog
        node={actions.moveNode}
        nodes={model.treeDto?.nodes ?? []}
        initialParentId={actions.moveInitialParentId}
        busy={actions.busy}
        onPreview={actions.previewMove}
        onClose={() => actions.setMoveNode(null)}
        onCommit={(parentId) => void actions.commitMove(parentId)}
      />
      <MergeClassificationDialog
        node={actions.mergeNode}
        nodes={model.treeDto?.nodes ?? []}
        busy={actions.busy}
        onPreview={actions.previewMerge}
        onClose={() => actions.setMergeNode(null)}
        onCommit={(targetId, conflictResolutions) => void actions.commitMerge(targetId, conflictResolutions)}
      />
      <ClassificationStateDialog
        node={actions.stateNode}
        nodes={model.treeDto?.nodes ?? []}
        busy={actions.busy}
        onClose={() => actions.setStateNode(null)}
        onConfirm={(includeDescendants) => void actions.confirmStateChange(includeDescendants)}
      />
      <ClassificationRestoreSourceDialog
        node={actions.restoreNode}
        nodes={model.treeDto?.nodes ?? []}
        busy={actions.busy}
        onClose={() => actions.setRestoreNode(null)}
        onConfirm={() => void actions.restoreSource()}
      />
      <RootCategoryOrderDialog
        locale={locale}
        open={actions.rootOrderOpen}
        roots={model.tree.roots}
        busy={actions.busy}
        onClose={() => actions.setRootOrderOpen(false)}
        onSave={(orderedIds) => void actions.reorderRoots(orderedIds)}
      />
    </>
  );
}
