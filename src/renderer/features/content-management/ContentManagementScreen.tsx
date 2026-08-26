import { ArchiveRestoreIcon, ArrowLeftIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import type {
  ContentLifecycleItemDto,
  ContentLifecycleItemRef,
  ContentLifecycleKind,
  ContentLifecyclePlanDto,
  ContentLifecyclePurgePlanDto,
  ContentLifecyclePurgeSelection,
  ContentLifecycleState,
} from '@/shared/contracts';
import type { ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { Button } from '@/renderer/components/ui/button';
import { MetaText } from '@/renderer/components/ui/meta-text';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Tabs, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { MessageCatalog } from '@/renderer/i18n/types';
import { ContentLifecycleBrowser } from '@/renderer/features/content-management/ContentLifecycleBrowser';
import {
  ContentLifecycleConfirmationDialog,
  type ContentLifecycleConfirmation,
} from '@/renderer/features/content-management/ContentLifecycleConfirmationDialog';
import { useContentLifecyclePage } from '@/renderer/features/content-management/useContentLifecyclePage';

type KindFilter = 'ALL' | ContentLifecycleKind;

type PendingConfirmation =
  | ({ kind: 'RESTORE'; item: ContentLifecycleItemDto } & ContentLifecycleConfirmation)
  | ({ kind: 'DELETE'; item: ContentLifecycleItemDto; plan: ContentLifecyclePlanDto } & ContentLifecycleConfirmation)
  | ({
      kind: 'PURGE';
      selection: ContentLifecyclePurgeSelection;
      plan: ContentLifecyclePurgePlanDto;
      clear: boolean;
    } & ContentLifecycleConfirmation);

interface Props {
  active: boolean;
  canNavigateBack: boolean;
  onNavigateBack(): void;
  onContentChange(): void | Promise<void>;
  notify(message: string): void;
}

function itemRef(item: ContentLifecycleItemDto): ContentLifecycleItemRef {
  return {
    entityType: item.entityType,
    entityId: item.entityId,
    expectedChangedAt: item.expectedChangedAt,
  };
}

function itemKey(item: ContentLifecycleItemDto) {
  return `${item.entityType}:${item.entityId}`;
}

function lifecycleFilterLabels(filters: MessageCatalog['contentManagement']['filters']) {
  return { ALL: filters.all, CREATION: filters.creation, ALBUM: filters.album, MATERIAL: filters.material };
}

export function ContentManagementScreen({ active, canNavigateBack, onNavigateBack, onContentChange, notify }: Props) {
  const { messages } = useI18n();
  const l = messages.contentManagement;
  const [state, setState] = useState<ContentLifecycleState>('ARCHIVED');
  const [kindFilter, setKindFilter] = useState<KindFilter>('ALL');
  const [albumStack, setAlbumStack] = useState<ContentLifecycleItemDto[]>([]);
  const [reloadRevision, setReloadRevision] = useState(0);
  const [planningKey, setPlanningKey] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const containerId = albumStack.at(-1)?.containerId ?? null,
    kind = containerId || kindFilter === 'ALL' ? null : kindFilter;
  const { page, loading, loadingMore, loadError, loadMore } = useContentLifecyclePage({
    active,
    state,
    kind,
    containerId,
    reloadRevision,
  });

  const filterLabels = lifecycleFilterLabels(l.filters);

  const resetBrowser = () => setAlbumStack([]);

  function changeState(next: string) {
    if (next !== 'ARCHIVED' && next !== 'RECYCLE_BIN') return;
    resetBrowser();
    setState(next);
  }

  function changeKind(next: string) {
    if (next !== 'ALL' && next !== 'CREATION' && next !== 'ALBUM' && next !== 'MATERIAL') return;
    resetBrowser();
    setKindFilter(next);
  }

  function openAlbum(item: ContentLifecycleItemDto) {
    if (item.kind !== 'ALBUM' || !item.containerId) return;
    setAlbumStack((current) => [...current, item]);
  }

  const returnToAlbum = (index: number) => setAlbumStack((current) => current.slice(0, index + 1));

  function openRestore(item: ContentLifecycleItemDto) {
    setConfirmation({
      kind: 'RESTORE',
      title: item.title,
      item,
      albumCount: item.albumCount,
      contentCount: item.contentCount,
    });
  }

  async function openDelete(item: ContentLifecycleItemDto) {
    const key = `delete:${itemKey(item)}`;
    setPlanningKey(key);
    try {
      const plan = await window.desktopApi.contentLifecyclePlan({
        action: 'DELETE',
        targets: [{ entityType: item.entityType, entityId: item.entityId }],
      });
      setConfirmation({ kind: 'DELETE', title: item.title, item, plan });
    } catch {
      notify(l.notices.failed);
      setReloadRevision((current) => current + 1);
    } finally {
      setPlanningKey((current) => (current === key ? null : current));
    }
  }

  async function openPurge(item: ContentLifecycleItemDto) {
    const key = `purge:${itemKey(item)}`;
    const selection: ContentLifecyclePurgeSelection = { kind: 'ITEMS', items: [itemRef(item)] };
    setPlanningKey(key);
    try {
      const plan = await window.desktopApi.contentLifecyclePurgePlan({ selection });
      setConfirmation({ kind: 'PURGE', title: item.title, selection, plan, clear: false });
    } catch {
      notify(l.notices.failed);
      setReloadRevision((current) => current + 1);
    } finally {
      setPlanningKey((current) => (current === key ? null : current));
    }
  }

  async function openClear() {
    if (containerId) return;
    const selection: ContentLifecyclePurgeSelection = {
      kind: 'FILTER',
      filter: kind ? { kind } : {},
    };
    setPlanningKey('clear');
    try {
      const plan = await window.desktopApi.contentLifecyclePurgePlan({ selection });
      if (plan.count === 0) {
        setReloadRevision((current) => current + 1);
        return;
      }
      setConfirmation({
        kind: 'PURGE',
        title: filterLabels[kindFilter],
        selection,
        plan,
        clear: true,
      });
    } catch {
      notify(l.notices.failed);
      setReloadRevision((current) => current + 1);
    } finally {
      setPlanningKey((current) => (current === 'clear' ? null : current));
    }
  }

  async function confirmAction() {
    if (!confirmation || submitting) return;
    setSubmitting(true);
    try {
      if (confirmation.kind === 'RESTORE') {
        await window.desktopApi.contentLifecycleRestore(itemRef(confirmation.item));
        notify(l.notices.restored);
      } else if (confirmation.kind === 'DELETE') {
        await window.desktopApi.contentLifecycleApply({
          action: 'DELETE',
          targets: [{ entityType: confirmation.item.entityType, entityId: confirmation.item.entityId }],
          confirmationToken: confirmation.plan.confirmationToken,
        });
        notify(l.notices.deleted);
      } else {
        const result = await window.desktopApi.contentLifecyclePurge({
          selection: confirmation.selection,
          confirmationToken: confirmation.plan.confirmationToken,
        });
        notify(
          result.failed > 0 ? l.notices.failed : confirmation.clear ? l.notices.cleared : l.notices.permanentlyDeleted,
        );
      }
      setConfirmation(null);
      resetBrowser();
      await onContentChange();
      setReloadRevision((current) => current + 1);
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason);
      notify(/stale|changed|conflict/iu.test(detail) ? l.notices.stale : l.notices.failed);
      setConfirmation(null);
      setReloadRevision((current) => current + 1);
    } finally {
      setSubmitting(false);
    }
  }

  function actionsFor(item: ContentLifecycleItemDto): ActionMenuAction[] {
    const disabled = planningKey !== null || submitting;
    if (state === 'ARCHIVED') {
      return [
        {
          id: 'restore',
          label: l.actions.restore,
          icon: ArchiveRestoreIcon,
          disabled,
          onSelect: () => openRestore(item),
        },
        {
          id: 'delete',
          label: l.actions.delete,
          icon: Trash2Icon,
          disabled,
          destructive: true,
          separatorBefore: true,
          onSelect: () => void openDelete(item),
        },
      ];
    }
    return [
      {
        id: 'restore',
        label: l.actions.restore,
        icon: RotateCcwIcon,
        disabled,
        onSelect: () => openRestore(item),
      },
      {
        id: 'purge',
        label: l.actions.permanentDelete,
        icon: Trash2Icon,
        disabled,
        destructive: true,
        separatorBefore: true,
        onSelect: () => void openPurge(item),
      },
    ];
  }

  const emptyLabel =
    kindFilter !== 'ALL' || containerId ? l.emptyFilter : state === 'ARCHIVED' ? l.emptyArchived : l.emptyRecycleBin;

  return (
    <div className="flex size-full min-h-0 flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!canNavigateBack}
          aria-label={messages.app.navigation.back}
          onClick={onNavigateBack}
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
        <h1 className="text-base font-semibold">{l.title}</h1>
        {page && !loading && <MetaText>{l.count(page.total)}</MetaText>}
        {state === 'RECYCLE_BIN' && !containerId && page && page.total > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto text-destructive hover:text-destructive"
            disabled={planningKey !== null || submitting}
            onClick={() => void openClear()}
          >
            <Trash2Icon className="size-3.5" />
            {l.actions.clear}
          </Button>
        )}
      </header>

      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 border-b px-6">
        <Tabs value={state} onValueChange={changeState}>
          <TabsList className="border-b-0">
            <TabsTrigger value="ARCHIVED">{l.states.archived}</TabsTrigger>
            <TabsTrigger value="RECYCLE_BIN">{l.states.recycleBin}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Segmented type="single" value={kindFilter} onValueChange={changeKind} className="mb-1.5">
          {(['ALL', 'CREATION', 'ALBUM', 'MATERIAL'] as const).map((filter) => (
            <SegmentedItem key={filter} value={filter}>
              {filterLabels[filter]}
            </SegmentedItem>
          ))}
        </Segmented>
      </div>

      <ContentLifecycleBrowser
        albumStack={albumStack}
        page={page}
        loading={loading}
        loadingMore={loadingMore}
        loadError={loadError}
        planningKey={planningKey}
        emptyLabel={emptyLabel}
        actionsFor={actionsFor}
        onOpenAlbum={openAlbum}
        onReturnToRoot={resetBrowser}
        onReturnToAlbum={returnToAlbum}
        onRetry={() => setReloadRevision((value) => value + 1)}
        onLoadMore={() => void loadMore()}
      />

      <ContentLifecycleConfirmationDialog
        confirmation={confirmation}
        submitting={submitting}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void confirmAction()}
      />
    </div>
  );
}
