import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ShieldCheckIcon } from 'lucide-react';
import type { ExtensionDto } from '@/shared/contracts';
import {
  extensionPermissionRows,
  permissionMatchesFilter,
  visiblePermissionSelection,
  type ExtensionPermissionFilter,
  type ExtensionPermissionGroup,
  type ExtensionPermissionRow,
} from '@/shared/extension-permission-info';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Input } from '@/renderer/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  extension: ExtensionDto;
  busy: boolean;
  onChange(permission: string, granted: boolean): void | Promise<void>;
  onRevoke?(permissions: string[]): Promise<boolean>;
}
const groups: readonly ExtensionPermissionGroup[] = [
  'content',
  'files',
  'network',
  'credentials',
  'execution',
  'other',
];
const filters: readonly ExtensionPermissionFilter[] = ['all', 'missing', 'granted', 'optional', 'runtime'];

function PermissionRow({
  row,
  selected,
  busy,
  selectable,
  onSelect,
  onChange,
}: {
  row: ExtensionPermissionRow;
  selected: boolean;
  busy: boolean;
  selectable: boolean;
  onSelect(): void;
  onChange(permission: string, granted: boolean): void | Promise<void>;
}) {
  const { messages } = useI18n();
  const l = messages.extensionManager;
  const labelId = useId();
  const name = l.names[row.name];
  return (
    <div className="flex min-w-0 items-start gap-3 px-4 py-3" data-permission-key={row.key}>
      {selectable && (
        <Checkbox
          className="mt-1"
          checked={selected}
          disabled={busy || !row.granted || row.template}
          aria-label={`${l.select}: ${name} · ${row.scope}`}
          onCheckedChange={onSelect}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span id={labelId} className="text-sm font-medium">
            {name}
          </span>
          <Badge variant="outline">
            {row.template
              ? l.declaration
              : row.runtimeScoped
                ? messages.extensions.runtimeScoped
                : row.required
                  ? messages.extensions.required
                  : messages.extensions.optional}
          </Badge>
        </div>
        <code className="mt-1 block break-all text-xs text-muted-foreground">{row.key}</code>
        {!row.template && (
          <p className="mt-1 text-xs" role="status">
            {row.granted ? l.allowed : l.notAllowed}
          </p>
        )}
      </div>
      {!row.template && (!row.runtimeScoped || row.granted) && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          aria-label={`${row.granted ? l.revoke : l.allow}: ${name} · ${row.scope}`}
          onClick={() => void onChange(row.key, !row.granted)}
        >
          {row.granted ? l.revoke : l.allow}
        </Button>
      )}
    </div>
  );
}

/** Selection is view state; only an explicit action changes an authorization. */
export function ExtensionPermissionPanel({ extension, busy, onChange, onRevoke }: Props) {
  const { messages } = useI18n();
  const l = messages.extensionManager;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ExtensionPermissionFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmation, setConfirmation] = useState<{ keys: string[]; fingerprint: string } | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submission = useRef(false);
  const rows = useMemo(() => extensionPermissionRows(extension), [extension]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = rows.filter(
    (row) =>
      permissionMatchesFilter(row, filter) &&
      [row.key, l.names[row.name], l.groups[row.group], l.groupNotes[row.group]]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalizedQuery),
  );
  const selectedKeys = visiblePermissionSelection(visible, selected);
  const selectableKeys = visible.filter((row) => row.granted && !row.template).map((row) => row.key);
  const visibleSignature = JSON.stringify(selectableKeys);
  const fingerprint = JSON.stringify([extension.manifest.id, extension.manifest.version, rows]);
  useEffect(() => {
    const allowed = new Set<string>(JSON.parse(visibleSignature));
    setSelected((current) => {
      const retained = new Set([...current].filter((key) => allowed.has(key)));
      return retained.size === current.size ? current : retained;
    });
  }, [visibleSignature]);
  const locked = busy || submitting;
  const hasRead = rows.some((row) => ['content', 'files'].includes(row.group));
  const hasNetwork = rows.some((row) => row.group === 'network');
  const hasTool = rows.some((row) => row.group === 'execution');
  const granted = rows.filter((row) => row.granted && !row.template).length;
  const concrete = rows.filter((row) => !row.template).length;
  async function revoke() {
    if (!confirmation || !onRevoke || locked || submission.current) return;
    if (confirmation.fingerprint !== fingerprint) {
      setError(l.selectionChanged);
      return;
    }
    submission.current = true;
    setSubmitting(true);
    setError('');
    try {
      if (await onRevoke(confirmation.keys)) {
        setConfirmation(null);
        setSelected(new Set());
      } else setError(l.changeFailed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      submission.current = false;
      setSubmitting(false);
    }
  }
  return (
    <section className="min-w-0" data-extension-permissions>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheckIcon className="size-4" />
          {l.permissions}
        </h3>
        <span className="text-xs text-muted-foreground">{l.count(granted, concrete)}</span>
      </header>
      {!rows.length ? (
        <p className="p-4 text-sm text-muted-foreground">{l.noPermissions}</p>
      ) : (
        <>
          <div className="grid gap-2 border-b border-border p-3 @md/extension-detail:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              type="search"
              value={query}
              placeholder={l.searchPermissions}
              aria-label={l.searchPermissions}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected(new Set());
              }}
            />
            <Select
              value={filter}
              onValueChange={(value) => {
                setFilter(value as ExtensionPermissionFilter);
                setSelected(new Set());
              }}
            >
              <SelectTrigger aria-label={l.permissions}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {filters.map((value) => (
                  <SelectItem key={value} value={value}>
                    {l.filters[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1 px-4 py-3 text-xs text-muted-foreground">
            {hasRead && hasNetwork && <p>{l.networkRisk}</p>}
            {hasTool && <p>{l.toolRisk}</p>}
            <p>{l.requiredNote}</p>
          </div>
          {onRevoke && (
            <div className="flex flex-wrap items-center gap-2 border-y border-border px-4 py-2">
              <Checkbox
                aria-label={l.selectVisible}
                disabled={locked || !selectableKeys.length}
                checked={
                  selectedKeys.length > 0 && selectedKeys.length === selectableKeys.length
                    ? true
                    : selectedKeys.length
                      ? 'indeterminate'
                      : false
                }
                onCheckedChange={(checked) => setSelected(new Set(checked === true ? selectableKeys : []))}
              />
              <span className="text-xs text-muted-foreground" role="status">
                {l.selectedCount(selectedKeys.length)}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={locked || !selectedKeys.length}
                onClick={() => setSelected(new Set())}
              >
                {l.clearSelection}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={locked || !selectedKeys.length}
                onClick={() => {
                  setError('');
                  setConfirmation({ keys: selectedKeys, fingerprint });
                }}
              >
                {l.revokeSelected}
              </Button>
            </div>
          )}
          {groups.map((group) => {
            const items = visible.filter((row) => row.group === group);
            return items.length ? (
              <div key={group} className="border-b border-border last:border-b-0">
                <div className="grid gap-1 px-4 pt-3 text-xs text-muted-foreground">
                  <h4 className="font-medium">{l.groups[group]}</h4>
                  <p>{l.groupNotes[group]}</p>
                  {items.some((row) => row.template) && <p>{l.templateNote}</p>}
                  {items.some((row) => row.runtimeScoped && !row.template) && <p>{l.runtimeNote}</p>}
                </div>
                {items.map((row) => (
                  <PermissionRow
                    key={row.key}
                    row={row}
                    busy={locked}
                    selected={selectedKeys.includes(row.key)}
                    selectable={Boolean(onRevoke)}
                    onSelect={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(row.key)) next.delete(row.key);
                        else next.add(row.key);
                        return next;
                      })
                    }
                    onChange={onChange}
                  />
                ))}
              </div>
            ) : null;
          })}
          {!visible.length && <p className="px-4 py-6 text-sm text-muted-foreground">{l.empty}</p>}
        </>
      )}
      <Dialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open && !locked) setConfirmation(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{l.confirmRevoke}</DialogTitle>
            <DialogDescription>{l.confirmRevokeNote}</DialogDescription>
          </DialogHeader>
          <div className="max-h-60 overflow-auto">
            {confirmation?.keys.map((key) => (
              <p key={key} className="break-all py-1 font-mono text-xs">
                {key}
              </p>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={locked} onClick={() => setConfirmation(null)}>
              {messages.common.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={locked || confirmation?.fingerprint !== fingerprint}
              onClick={() => void revoke()}
            >
              {l.revokeSelected}
            </Button>
          </DialogFooter>
          {confirmation && confirmation.fingerprint !== fingerprint && (
            <p role="status" className="text-sm text-muted-foreground">
              {l.selectionChanged}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
