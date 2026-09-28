import type { BootstrapDto } from '@/shared/contracts';
import type { ResultLibraryMode } from '@/renderer/components/creator/ResultLibrary';
import { CreationDraftList } from '@/renderer/components/creator/CreationDraftList';
import { useCreationDraftList } from '@/renderer/components/creator/useCreationDraftList';
import { useCreationDraftActions } from '@/renderer/components/creator/useCreationDraftActions';

interface Options {
  active: boolean;
  data: BootstrapDto;
  mode: ResultLibraryMode;
  selectedId: string | null;
  busy: boolean;
  notify(message: string): void;
  onSelect(id: string): void;
  onBeforeDelete(draftId: string | null): Promise<void>;
  onDeleted(draftIds: string[]): void;
}

export function useCreationDraftSidebar(options: Options) {
  const { active, data, mode, notify, selectedId, busy, onSelect } = options;
  const drafts = useCreationDraftList({
    active: active && mode !== 'images',
    spaceId: data.spaceId,
    query: '',
    refreshKey: data.creationItems,
    notify,
  });
  const actions = useCreationDraftActions({
    spaceId: data.spaceId,
    blocked: busy,
    notify,
    refresh: drafts.refresh,
    onBeforeDelete: options.onBeforeDelete,
    onDeleted(ids) {
      drafts.remove(ids);
      options.onDeleted(ids);
    },
  });
  return {
    feedback: actions.feedback,
    hasContent: Boolean(drafts.items.length || drafts.failed || drafts.loading),
    content:
      drafts.items.length || drafts.failed ? (
        <CreationDraftList
          drafts={drafts}
          selectedId={selectedId}
          busy={actions.busy}
          onSelect={onSelect}
          onDelete={(id) => void actions.remove(id)}
          onClear={actions.requestClear}
        />
      ) : null,
  };
}
