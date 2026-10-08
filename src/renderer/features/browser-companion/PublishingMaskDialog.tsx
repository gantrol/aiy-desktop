import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { ArrowDownIcon, ArrowUpIcon, LoaderCircleIcon, RotateCcwIcon, XIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  inheritedPublishingMask,
  publishingMaskOverridesForTarget,
  publishingMaskSupportsTitle,
  publishingMaskSupportsBodyTitle,
  type PublishingMaskOverrides,
  type PublishingMaskReadResult,
  type PublishingMaskSource,
  type PublishingMaskTarget,
} from '@/shared/contracts/publishing-mask';
import { publishingMaskErrorMessage } from '@/renderer/features/browser-companion/publishingMask';

export function PublishingMaskDialog({
  spaceId,
  source,
  target,
  onClose,
  onSaved,
}: {
  spaceId: string;
  source: PublishingMaskSource;
  target: PublishingMaskTarget;
  onClose(): void;
  onSaved(): void;
}) {
  const { messages } = useI18n();
  const copy = messages.publishing.mask;
  const [loaded, setLoaded] = useState<PublishingMaskReadResult | null>(null);
  const [overrides, setOverrides] = useState<PublishingMaskOverrides>(inheritedPublishingMask);
  const [saving, setSaving] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const sourceKind = source.kind,
    sourceId = source.id,
    platform = target.platform,
    format = target.format;
  const scopeKey = JSON.stringify([spaceId, sourceKind, sourceId, platform, format]);
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const sessionRef = useRef<object | null>(null);
  const errorMessage = useStableCallback((reason: unknown) => publishingMaskErrorMessage(reason, messages));
  useEffect(() => {
    const session = {};
    sessionRef.current = session;
    const current = () => sessionRef.current === session && scopeRef.current === scopeKey;
    setLoaded(null);
    setFault(null);
    setSaving(false);
    void window.desktopApi.publishingMasks
      .read({ expectedSpaceId: spaceId, source: { kind: sourceKind, id: sourceId }, target: { platform, format } })
      .then((result) => {
        if (!current()) return;
        setLoaded(result);
        setOverrides(
          publishingMaskOverridesForTarget({ platform, format }, result.draft?.overrides ?? inheritedPublishingMask()),
        );
      })
      .catch((reason) => {
        if (current()) setFault(errorMessage(reason));
      });
    return () => {
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [spaceId, sourceKind, sourceId, platform, format, scopeKey, attempt, errorMessage]);

  const media = loaded?.source.media ?? [];
  const available = new Map(media.map((asset) => [asset.id, asset]));
  const sourceOrder = media.map((asset) => asset.id);
  const order =
    overrides.mediaOrder === null
      ? sourceOrder
      : [...overrides.mediaOrder, ...sourceOrder.filter((id) => !overrides.mediaOrder!.includes(id))];
  const missing =
    order.some((id) => !available.has(id)) ||
    (overrides.cover.mode === 'CUSTOM' && !available.has(overrides.cover.value));

  function move(index: number, delta: number) {
    const next = [...order];
    const other = index + delta;
    if (other < 0 || other >= next.length) return;
    [next[index], next[other]] = [next[other]!, next[index]!];
    setOverrides((current) => ({ ...current, mediaOrder: next }));
  }

  function close() {
    sessionRef.current = null;
    onClose();
  }

  async function save() {
    const session = sessionRef.current;
    if (!loaded || saving || missing || !session) return;
    const current = () => sessionRef.current === session && scopeRef.current === scopeKey;
    setSaving(true);
    setFault(null);
    try {
      await window.desktopApi.publishingMasks.save({
        expectedSpaceId: spaceId,
        source,
        target,
        expectedVersion: loaded.draft?.version ?? null,
        sourceRevisionId: loaded.source.revisionId,
        overrides,
      });
      if (!current()) return;
      onSaved();
      close();
    } catch (reason) {
      if (current()) setFault(publishingMaskErrorMessage(reason, messages));
    } finally {
      if (current()) setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {messages.browserCompanion.targets[target.platform]} ·{' '}
            {target.format === 'inline-article' ? messages.publishing.article : messages.publishing.images}
          </DialogTitle>
        </DialogHeader>
        {!loaded && !fault && <LoaderCircleIcon className="size-4 animate-spin" aria-label={copy.loading} />}
        {loaded && (
          <PublishingMaskFields
            loaded={loaded}
            overrides={overrides}
            setOverrides={setOverrides}
            target={target}
            order={order}
            available={available}
            move={move}
            saving={saving}
          />
        )}
        {fault && (
          <p role="alert" className="text-sm text-destructive">
            {fault}
          </p>
        )}
        {missing && (
          <p role="alert" className="text-sm text-destructive">
            {copy.errors.PUBLISHING_MASK_MEDIA_CHANGED}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {messages.common.cancel}
          </Button>
          {!loaded && fault ? (
            <Button onClick={() => setAttempt((current) => current + 1)}>{messages.publishing.retry}</Button>
          ) : (
            <Button disabled={!loaded || saving || missing} onClick={() => void save()}>
              {saving && <LoaderCircleIcon className="size-4 animate-spin" />}
              {copy.save}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PublishingMaskFields({
  loaded,
  overrides,
  setOverrides,
  target,
  order,
  available,
  move,
  saving,
}: {
  loaded: PublishingMaskReadResult;
  overrides: PublishingMaskOverrides;
  setOverrides: Dispatch<SetStateAction<PublishingMaskOverrides>>;
  target: PublishingMaskTarget;
  order: string[];
  available: ReadonlyMap<string, { id: string; mediaUrl: string }>;
  move(index: number, delta: number): void;
  saving: boolean;
}) {
  const { messages } = useI18n();
  const copy = messages.publishing.mask;
  const media = loaded.source.media;
  return (
    <fieldset className="grid gap-5" disabled={saving}>
      {loaded.draft && loaded.draft.sourceRevisionId !== loaded.source.revisionId && (
        <p role="status" className="text-xs text-muted-foreground">
          {copy.sourceChanged}
        </p>
      )}
      {publishingMaskSupportsBodyTitle(target) && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={overrides.titleInBody ?? true}
            onCheckedChange={(checked) => setOverrides((current) => ({ ...current, titleInBody: checked === true }))}
          />
          {copy.titleInBody}
        </label>
      )}
      {publishingMaskSupportsTitle(target) && (
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">{copy.title}</span>
            <Select
              value={overrides.title.mode}
              onValueChange={(mode) =>
                setOverrides((current) => ({
                  ...current,
                  title:
                    mode === 'CUSTOM'
                      ? { mode, value: current.title.mode === 'CUSTOM' ? current.title.value : loaded.source.title }
                      : { mode: mode === 'CLEAR' ? 'CLEAR' : 'INHERIT' },
                }))
              }
            >
              <SelectTrigger className="w-36" aria-label={copy.title}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INHERIT">{copy.inherit}</SelectItem>
                <SelectItem value="CUSTOM">{copy.custom}</SelectItem>
                <SelectItem value="CLEAR">{copy.clear}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Input
            aria-label={copy.title}
            maxLength={200}
            disabled={overrides.title.mode !== 'CUSTOM'}
            value={
              overrides.title.mode === 'CUSTOM'
                ? overrides.title.value
                : overrides.title.mode === 'CLEAR'
                  ? ''
                  : loaded.source.title
            }
            onChange={(event) =>
              setOverrides((current) => ({ ...current, title: { mode: 'CUSTOM', value: event.target.value } }))
            }
          />
        </div>
      )}
      {target.format === 'inline-article' && (
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">{copy.cover}</span>
            <Select
              value={overrides.cover.mode}
              onValueChange={(mode) =>
                setOverrides((current) => ({
                  ...current,
                  cover:
                    mode === 'CUSTOM' && media.length
                      ? {
                          mode,
                          value:
                            current.cover.mode === 'CUSTOM'
                              ? current.cover.value
                              : (loaded.source.coverAssetId ?? media[0]!.id),
                        }
                      : { mode: mode === 'CLEAR' ? 'CLEAR' : 'INHERIT' },
                }))
              }
            >
              <SelectTrigger className="w-36" aria-label={copy.cover}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INHERIT">{copy.inherit}</SelectItem>
                <SelectItem value="CUSTOM" disabled={!media.length}>
                  {copy.custom}
                </SelectItem>
                <SelectItem value="CLEAR">{copy.clear}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {overrides.cover.mode === 'CUSTOM' && (
            <div className="grid grid-cols-4 gap-2">
              {media.map((asset, index) => (
                <Button
                  key={asset.id}
                  type="button"
                  variant={
                    overrides.cover.mode === 'CUSTOM' && overrides.cover.value === asset.id ? 'secondary' : 'outline'
                  }
                  className="h-20 p-1"
                  aria-pressed={overrides.cover.mode === 'CUSTOM' && overrides.cover.value === asset.id}
                  aria-label={copy.image.replace('{number}', String(index + 1))}
                  onClick={() =>
                    setOverrides((current) => ({ ...current, cover: { mode: 'CUSTOM', value: asset.id } }))
                  }
                >
                  {asset.mediaUrl ? (
                    <img src={asset.mediaUrl} alt="" className="h-full w-full rounded-sm object-contain" />
                  ) : (
                    index + 1
                  )}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
      {target.format === 'numbered-gallery' && (
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">{messages.publishing.imageOrder}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={overrides.mediaOrder === null}
              onClick={() => setOverrides((current) => ({ ...current, mediaOrder: null }))}
            >
              <RotateCcwIcon className="size-3.5" />
              {copy.inherit}
            </Button>
          </div>
          <ol className="grid max-h-72 gap-1 overflow-y-auto">
            {order.map((id, index) => (
              <li key={id} className="flex items-center gap-2 rounded-md px-1 py-1">
                {available.get(id)?.mediaUrl ? (
                  <img src={available.get(id)!.mediaUrl} alt="" className="size-10 rounded object-contain" />
                ) : (
                  <span className="size-10" />
                )}
                <span className="mr-auto text-sm">
                  {available.has(id) ? copy.image.replace('{number}', String(index + 1)) : copy.missingImage}
                </span>
                {available.has(id) ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={index === 0}
                      aria-label={copy.moveUp}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUpIcon className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={index === order.length - 1}
                      aria-label={copy.moveDown}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDownIcon className="size-4" />
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={copy.removeMissing}
                    onClick={() =>
                      setOverrides((current) => ({ ...current, mediaOrder: order.filter((item) => item !== id) }))
                    }
                  >
                    <XIcon className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </fieldset>
  );
}
