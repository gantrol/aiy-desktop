import { FoldVerticalIcon, ListCollapseIcon, RotateCcwIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { OutlineBrowseDisclosure } from '@/renderer/features/creation-outline/outlineBrowseRows';
import type { useCreationAlbumChildVisibility } from '@/renderer/components/creator/useCreationAlbumChildVisibility';

interface Props {
  row: OutlineBrowseDisclosure;
  busy: boolean;
  visibility: ReturnType<typeof useCreationAlbumChildVisibility>;
}

export function OutlineChildDisclosure({ row, busy, visibility }: Props) {
  const labels = useI18n().messages.creator.results;
  const fewer = row.visibility.disclosure === 'fewer';
  const label = fewer ? labels.showFewerChildren : labels.showMoreChildren;
  const Icon = fewer ? FoldVerticalIcon : ListCollapseIcon;
  return (
    <div
      role="treeitem"
      aria-level={row.depth + 1}
      aria-label={label}
      data-outline-child-disclosure={row.albumId}
      className="flex h-10 min-w-0 items-center pr-2"
      style={{ paddingLeft: 4 + Math.min(row.depth, 12) * 18 }}
    >
      <Button
        type="button"
        variant="ghost"
        disabled={busy}
        className="h-10 min-w-0 flex-1 justify-start gap-1 rounded-none px-0 text-muted-foreground"
        onClick={() => {
          if (fewer) visibility.reset(row.albumId);
          else visibility.revealMore(row.albumId, row.entries, row.visibility.visibleCount);
        }}
      >
        <span className="flex w-14 shrink-0 justify-center">
          <Icon className="size-4" />
        </span>
        <span className="truncate">{label}</span>
        {row.visibility.hiddenCount > 0 && (
          <span className="ml-auto px-2 text-xs tabular-nums">{row.visibility.hiddenCount}</span>
        )}
      </Button>
      {row.visibility.canReset && !fewer && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          title={labels.restoreDefaultVisibleItems}
          aria-label={labels.restoreDefaultVisibleItems}
          onClick={() => visibility.reset(row.albumId)}
        >
          <RotateCcwIcon className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
