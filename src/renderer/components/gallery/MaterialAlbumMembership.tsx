import { useCallback, useId, useState } from 'react';
import { ChevronRightIcon } from 'lucide-react';
import type { MaterialAlbumDto, MaterialSelectionTargetInput } from '@/shared/contracts';
import type {
  MaterialAlbumMembershipApplyResult,
  MaterialAlbumMembershipEdit,
} from '@/shared/contracts/material-album-membership';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Dialog } from '@/renderer/components/ui/dialog';
import {
  MaterialAlbumMembershipDialog,
  type MembershipEditorState,
} from '@/renderer/components/gallery/MaterialAlbumMembershipDialog';
import { albumMembershipRows } from '@/renderer/components/gallery/materialAlbumMembershipModel';

interface Props {
  albums: MaterialAlbumDto[];
  target: MaterialSelectionTargetInput;
  loading: boolean;
  failed: boolean;
  disabled?: boolean;
  onOpenAlbum(albumId: string): void;
  onApply(edit: MaterialAlbumMembershipEdit): Promise<MaterialAlbumMembershipApplyResult>;
  onRetry(): Promise<unknown>;
  onStateChange(state: MembershipEditorState): void;
}

export function MaterialAlbumMembership({
  albums,
  target,
  loading,
  failed,
  disabled,
  onOpenAlbum,
  onApply,
  onRetry,
  onStateChange,
}: Props) {
  const l = useI18n().messages.gallery.membership;
  const heading = useId();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const stateChanged = useCallback(
    (state: MembershipEditorState) => {
      setSaving(state.saving);
      onStateChange(state);
    },
    [onStateChange],
  );
  const rows = albumMembershipRows(albums, target);
  const joined = rows.filter((row) => row.member);
  return (
    <section className="space-y-2 border-b pb-4" aria-labelledby={heading}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={heading} className="text-sm font-medium">
          {l.title}
        </h3>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || loading || failed}
          onClick={() => {
            setSession((value) => value + 1);
            setOpen(true);
          }}
        >
          {l.manage}
        </Button>
      </div>
      {failed ? (
        <Button variant="outline" onClick={() => void onRetry().catch(() => undefined)}>
          {l.retry}
        </Button>
      ) : loading ? (
        <div role="status" className="text-xs text-muted-foreground">
          {l.loading}
        </div>
      ) : joined.length ? (
        <div>
          {(expanded ? joined : joined.slice(0, 3)).map(({ album, parentPath, path }) => (
            <Button
              key={album.id}
              variant="ghost"
              className="h-auto w-full justify-start gap-2 px-0 py-2 text-left font-normal"
              disabled={disabled}
              onClick={() => onOpenAlbum(album.id)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{album.title}</span>
                {parentPath && (
                  <span className="block truncate text-xs text-muted-foreground" title={path}>
                    {parentPath}
                  </span>
                )}
              </span>
              <ChevronRightIcon className="size-3.5" />
            </Button>
          ))}
          {joined.length > 3 && (
            <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
              {expanded ? l.collapse : l.all}
            </Button>
          )}
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => {
            setSession((value) => value + 1);
            setOpen(true);
          }}
        >
          {rows.length ? l.join : l.createAndJoin}
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!saving) setOpen(next);
        }}
      >
        {open && (
          <MaterialAlbumMembershipDialog
            key={session}
            initialCreating={rows.length === 0}
            albums={albums}
            target={target}
            onApply={onApply}
            onStateChange={stateChanged}
            onClose={() => setOpen(false)}
            onReload={async () => {
              await onRetry();
              setSession((value) => value + 1);
            }}
          />
        )}
      </Dialog>
    </section>
  );
}
