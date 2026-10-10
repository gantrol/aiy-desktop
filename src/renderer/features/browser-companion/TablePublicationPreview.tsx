import { useRef, useState } from 'react';
import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { BrowserCompanionStageInput, BrowserCompanionTarget } from '@/shared/contracts';
import { prepareImagePostHandoff } from '@/renderer/features/browser-companion/prepareImagePostHandoff';

type Prepared = Omit<BrowserCompanionStageInput, 'target' | 'watermark'>;
export function TablePublicationPreview({
  prepared,
  target,
  onChange,
  onImagesReady,
}: {
  prepared: Prepared;
  target: BrowserCompanionTarget;
  onChange?(prepared: Prepared): void;
  onImagesReady?(ready: boolean): void;
}) {
  const { messages, locale } = useI18n();
  const number = new Intl.NumberFormat(locale);
  const copy = messages.publishing.tables;
  const preview = prepared.tableConversion!;
  const [opened, setOpened] = useState<string | null>(null);
  const [original, setOriginal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(new Set<string>());
  const order = prepared.mediaAssetIds ?? [];
  const groups: string[][] = [];
  for (const id of order) {
    const table = preview.tables.find((table) => table.mediaAssetIds.includes(id));
    if (!table) groups.push([id]);
    else if (table.mediaAssetIds[0] === id) groups.push(table.mediaAssetIds);
  }
  const url = (id: string) => preview.media.find((media) => media.assetId === id)?.mediaUrl;
  const selectedTable = preview.tables.find((table) => table.mediaAssetIds.includes(opened ?? ''));
  function imageLoaded(id: string, success: boolean) {
    const source = url(id);
    if (source && success) loaded.current.add(source);
    else if (source) loaded.current.delete(source);
    const ready = preview.media.every((media) => loaded.current.has(media.mediaUrl));
    onImagesReady?.(ready);
    if (!success) setError(messages.browserCompanion.stageErrors.TABLE_RESOURCE_UNAVAILABLE);
    else if (ready) setError(null);
  }
  function move(index: number, direction: number) {
    const reordered = [...groups];
    const other = index + direction;
    [reordered[index], reordered[other]] = [reordered[other]!, reordered[index]!];
    const result = prepareImagePostHandoff({
      body: preview.markdown,
      format: 'markdown',
      mediaAssetIds: reordered.flat(),
      mediaBindings: preview.mediaBindings,
      preferredMediaAssetIds: reordered.flat(),
      source: prepared.source,
      title: prepared.title ?? '',
      target,
      copy: messages.desktopPetals.document,
      notify: setError,
      titleInBody: preview.titleInBody,
    });
    if (result) {
      setError(null);
      onChange?.({ ...result, tableConversion: preview });
    }
  }
  return (
    <div className="grid gap-2">
      <p role="status" className="text-sm">
        {copy.summary
          .replace('{tables}', number.format(preview.tables.length))
          .replace(
            '{images}',
            number.format(preview.tables.reduce((count, table) => count + table.mediaAssetIds.length, 0)),
          )
          .replace('{total}', number.format(order.length))}
      </p>
      {preview.linksAsText && (
        <p role="status" className="text-sm text-muted-foreground">
          {copy.linksAsText}
        </p>
      )}
      <ol className="flex gap-3 overflow-x-auto pb-2" aria-label={messages.publishing.imageOrder}>
        {groups.map((group, index) => (
          <li key={group[0]} className="grid shrink-0 gap-1">
            <div className="flex gap-1">
              {group.map((id) => (
                <Button
                  key={id}
                  variant="ghost"
                  className="h-auto w-24 flex-col gap-1 p-1"
                  onClick={() => {
                    setOpened(id);
                    setOriginal(false);
                  }}
                >
                  <img
                    src={url(id)}
                    alt={messages.publishing.mask.image.replace('{number}', number.format(order.indexOf(id) + 1))}
                    className="h-24 w-full object-contain"
                    onLoad={() => imageLoaded(id, true)}
                    onError={() => imageLoaded(id, false)}
                  />
                  <span className="text-xs">
                    {messages.publishing.mask.image.replace('{number}', number.format(order.indexOf(id) + 1))}
                    {id === preview.coverAssetId ? ` · ${messages.publishing.mask.cover}` : ''}
                  </span>
                </Button>
              ))}
            </div>
            {onChange && (
              <div className="flex justify-center gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={copy.moveEarlier}
                  disabled={
                    index === 0 ||
                    group.includes(preview.coverAssetId ?? '') ||
                    groups[index - 1]?.includes(preview.coverAssetId ?? '')
                  }
                  onClick={() => move(index, -1)}
                >
                  <ArrowLeftIcon className="size-4" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={copy.moveLater}
                  disabled={index === groups.length - 1 || group.includes(preview.coverAssetId ?? '')}
                  onClick={() => move(index, 1)}
                >
                  <ArrowRightIcon className="size-4" />
                </Button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={opened !== null}
        onOpenChange={(open) => {
          if (!open) setOpened(null);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {selectedTable
                ? copy.table.replace('{number}', number.format(selectedTable.number))
                : messages.publishing.imageOrder}
            </DialogTitle>
          </DialogHeader>
          {selectedTable && (
            <Button variant="outline" className="justify-self-start" onClick={() => setOriginal((value) => !value)}>
              {original ? copy.image : copy.original}
            </Button>
          )}
          {original && selectedTable ? (
            <pre className="overflow-x-auto whitespace-pre-wrap text-sm">{selectedTable.markdown}</pre>
          ) : (
            opened && <img src={url(opened)} alt={copy.image} className="h-auto w-full" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
