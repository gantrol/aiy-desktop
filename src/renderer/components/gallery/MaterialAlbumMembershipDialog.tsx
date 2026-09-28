import { useEffect, useMemo, useRef, useState } from 'react';
import { PlusIcon, LoaderCircleIcon } from 'lucide-react';
import type { MaterialAlbumDto, MaterialSelectionTargetInput } from '@/shared/contracts';
import type {
  MaterialAlbumMembershipApplyResult,
  MaterialAlbumMembershipEdit,
} from '@/shared/contracts/material-album-membership';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { AlbumSelect } from '@/renderer/components/albums/AlbumSelect';
import { DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import {
  albumMembershipRows,
  membershipChanges,
  normalizedAlbumQuery,
} from '@/renderer/components/gallery/materialAlbumMembershipModel';

export interface MembershipEditorState {
  dirty: boolean;
  saving: boolean;
}
interface Props {
  initialCreating?: boolean;
  albums: MaterialAlbumDto[];
  target: MaterialSelectionTargetInput;
  onApply(edit: MaterialAlbumMembershipEdit): Promise<MaterialAlbumMembershipApplyResult>;
  onStateChange(state: MembershipEditorState): void;
  onClose(): void;
  onReload(): Promise<void>;
}

export function MaterialAlbumMembershipDialog({
  initialCreating = false,
  albums,
  target,
  onApply,
  onStateChange,
  onClose,
  onReload,
}: Props) {
  const { messages } = useI18n();
  const l = messages.gallery.membership;
  // Freeze expected revisions for this editing session; background refresh must not overwrite the draft.
  const [rows] = useState(() => albumMembershipRows(albums, target));
  const [selected, setSelected] = useState(() => new Set(rows.filter((row) => row.member).map((row) => row.album.id)));
  const parentOptions = useMemo(
    () => rows.map(({ album }) => ({ id: album.id, title: album.title, parentId: album.parentId })),
    [rows],
  );
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(initialCreating);
  const [title, setTitle] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Exclude<MaterialAlbumMembershipApplyResult['status'], 'APPLIED'> | null>(null);
  const running = useRef(false);
  const changes = useMemo(() => membershipChanges(rows, selected), [rows, selected]);
  const dirty = changes.length > 0 || creating;
  const matching = rows.filter((row) => normalizedAlbumQuery(row.path).includes(normalizedAlbumQuery(query)));
  useEffect(() => {
    onStateChange({ dirty, saving: busy });
  }, [dirty, busy, onStateChange]);
  useEffect(() => () => onStateChange({ dirty: false, saving: false }), [onStateChange]);

  async function apply() {
    if (running.current || !dirty || changes.length > 100 || (creating && !title.trim())) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await onApply({
        changes,
        ...(creating ? { create: { title: title.trim(), parentAlbumId: parentId } } : {}),
      });
      if (result.status === 'APPLIED') onClose();
      else setError(result.status);
    } catch {
      setError('FAILED');
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <DialogContent
      className="max-w-lg rounded-md"
      aria-describedby={undefined}
      showCloseButton={!busy}
      onEscapeKeyDown={(event) => {
        if (busy) event.preventDefault();
      }}
      onInteractOutside={(event) => event.preventDefault()}
    >
      <DialogHeader>
        <DialogTitle>{l.manageTitle}</DialogTitle>
      </DialogHeader>
      <Input
        autoFocus
        aria-label={l.search}
        placeholder={l.search}
        value={query}
        disabled={busy}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="max-h-64 overflow-y-auto" aria-label={l.title}>
        {matching.map(({ album, parentPath, path }) => (
          <Label key={album.id} className="flex min-h-12 cursor-pointer gap-3 border-b py-2 font-normal">
            <Checkbox
              checked={selected.has(album.id)}
              disabled={busy}
              aria-label={path}
              onCheckedChange={(value) =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (value === true) next.add(album.id);
                  else next.delete(album.id);
                  return next;
                })
              }
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{album.title}</span>
              {parentPath && (
                <span className="block truncate text-xs text-muted-foreground" title={path}>
                  {parentPath}
                </span>
              )}
            </span>
          </Label>
        ))}
        {!matching.length && (
          <div role="status" className="py-3 text-sm text-muted-foreground">
            {rows.length ? l.noResults : l.noAlbums}
          </div>
        )}
      </div>
      {creating ? (
        <div className="grid gap-2 border-t pt-3">
          <Label htmlFor="membership-album-name">{l.newAlbum}</Label>
          <Input
            id="membership-album-name"
            autoFocus
            value={title}
            maxLength={200}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />
          <AlbumSelect
            options={parentOptions}
            value={parentId}
            ariaLabel={l.parent}
            nullOption={{ kind: 'root', label: l.root }}
            disabled={busy}
            onValueChange={setParentId}
          />
          <Button variant="ghost" className="w-fit" disabled={busy} onClick={() => setCreating(false)}>
            {l.cancelCreate}
          </Button>
        </div>
      ) : (
        <Button variant="ghost" className="w-fit" disabled={busy} onClick={() => setCreating(true)}>
          <PlusIcon />
          {l.createAndJoin}
        </Button>
      )}
      {changes.length > 100 && (
        <div role="alert" className="text-sm text-destructive">
          {l.limit}
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <span>{l.errors[error]}</span>
          {(error === 'CONFLICT' || error === 'UNAVAILABLE') && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (running.current) return;
                running.current = true;
                setBusy(true);
                void onReload()
                  .catch(() => setError('FAILED'))
                  .finally(() => {
                    running.current = false;
                    setBusy(false);
                  });
              }}
            >
              {l.reload}
            </Button>
          )}
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>
          {messages.common.cancel}
        </Button>
        <Button
          disabled={busy || !dirty || changes.length > 100 || (creating && !title.trim())}
          onClick={() => void apply()}
        >
          {busy && <LoaderCircleIcon className="animate-spin" />}
          {l.apply}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
