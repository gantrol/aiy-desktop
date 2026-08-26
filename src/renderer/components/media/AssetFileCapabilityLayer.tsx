import { CopyIcon, DownloadIcon, ExternalLinkIcon, FolderOpenIcon, LoaderCircleIcon } from 'lucide-react';
import {
  cloneElement,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { startImageAssetDrag } from '@/renderer/components/albums/albumDrag';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/renderer/components/ui/popover';
import { useI18n } from '@/renderer/i18n/useI18n';

type FileAction = 'COPY' | 'SAVE_AS' | 'REVEAL' | 'OPEN';

interface AssetMediaTarget {
  assetId: string;
  element: HTMLImageElement | HTMLVideoElement;
}

interface CapabilityHostProps {
  onContextMenuCapture?(event: ReactMouseEvent<HTMLElement>): void;
  onPointerDownCapture?(event: ReactPointerEvent<HTMLElement>): void;
  onDragStartCapture?(event: ReactDragEvent<HTMLElement>): void;
}

function assetIdFromUrl(value: string) {
  if (!value.startsWith('aiy-media://')) return null;
  try {
    const url = new URL(value);
    if (url.hostname !== 'asset' && url.hostname !== 'asset-thumbnail') return null;
    const encodedId = url.pathname.split('/').find(Boolean);
    return encodedId ? decodeURIComponent(encodedId) : null;
  } catch {
    return null;
  }
}

function assetMediaTarget(element: Element | null): AssetMediaTarget | null {
  if (!(element instanceof HTMLImageElement) && !(element instanceof HTMLVideoElement)) return null;
  const source =
    element instanceof HTMLImageElement
      ? element.currentSrc || element.src
      : element.currentSrc || element.src || element.poster;
  const assetId = assetIdFromUrl(source);
  return assetId ? { assetId, element } : null;
}

function targetAtPoint(target: EventTarget | null, clientX: number, clientY: number) {
  if (!(target instanceof Element)) return null;
  if (target.closest('[data-asset-file-menu]')) return null;
  const direct = assetMediaTarget(target);
  if (direct) return direct;
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    if (element.closest('[data-asset-file-menu]')) continue;
    const candidate = assetMediaTarget(element);
    if (candidate) return candidate;
  }
  const container = target.closest('button, figure, [role="button"]');
  if (!container) return null;
  for (const media of container.querySelectorAll('img, video')) {
    const candidate = assetMediaTarget(media);
    if (candidate) return candidate;
  }
  return null;
}

/**
 * Supplies core file capabilities to every persisted asset image, including
 * legacy surfaces that have not opted into the richer per-asset menu. URLs
 * remain opaque to feature components; only this boundary decodes asset IDs.
 */
export function AssetFileCapabilityLayer({
  children,
  notify,
}: {
  children: ReactElement;
  notify(message: string): void;
}) {
  const { messages } = useI18n();
  const labels = messages.assetFile;
  const selectedAssetIdRef = useRef<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [anchorPoint, setAnchorPoint] = useState({ x: 0, y: 0 });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<FileAction | null>(null);

  function selectTarget(target: AssetMediaTarget | null) {
    selectedAssetIdRef.current = target?.assetId ?? null;
    setSelectedAssetId(target?.assetId ?? null);
    return target;
  }

  function onContextMenuCapture(event: ReactMouseEvent<HTMLElement>) {
    const target = targetAtPoint(event.target, event.clientX, event.clientY);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    selectTarget(target);
    setAnchorPoint({ x: event.clientX, y: event.clientY });
    setOpen(true);
  }

  function onPointerDownCapture(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const target = targetAtPoint(event.target, event.clientX, event.clientY);
    if (!target) return;
    const draggableAncestor = target.element.parentElement?.closest('[draggable="true"]');
    if (draggableAncestor) return;
    target.element.draggable = true;
  }

  function onDragStartCapture(event: ReactDragEvent<HTMLElement>) {
    const element = event.target;
    if (!(element instanceof HTMLImageElement) && !(element instanceof HTMLVideoElement)) return;
    if (element.closest('[data-asset-file-menu]')) return;
    const assetId = assetMediaTarget(element)?.assetId;
    if (!assetId) return;
    const request = startImageAssetDrag(event, [assetId]);
    if (request) {
      void request.catch((reason) => {
        notify(`${labels.failed}: ${reason instanceof Error ? reason.message : String(reason)}`);
      });
    }
  }

  async function run(action: FileAction) {
    const assetId = selectedAssetIdRef.current;
    if (!assetId || busy) return;
    setBusy(action);
    try {
      if (action === 'COPY') {
        notify(labels.copying);
        await window.desktopApi.assetFileCopy(assetId);
        notify(labels.copied);
      } else if (action === 'SAVE_AS') {
        const result = await window.desktopApi.assetFileSaveAs(assetId);
        if (result.status === 'saved') notify(labels.saved);
      } else if (action === 'REVEAL') {
        await window.desktopApi.assetFileReveal(assetId);
      } else {
        await window.desktopApi.assetFileOpen(assetId);
      }
    } catch (reason) {
      notify(`${labels.failed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy(null);
    }
  }

  const host = children as ReactElement<CapabilityHostProps>;
  const capabilityHost = cloneElement(host, {
    onContextMenuCapture(event) {
      host.props.onContextMenuCapture?.(event);
      if (!event.defaultPrevented && !event.isPropagationStopped()) onContextMenuCapture(event);
    },
    onPointerDownCapture(event) {
      host.props.onPointerDownCapture?.(event);
      if (!event.defaultPrevented && !event.isPropagationStopped()) onPointerDownCapture(event);
    },
    onDragStartCapture(event) {
      host.props.onDragStartCapture?.(event);
      if (!event.defaultPrevented && !event.isPropagationStopped()) onDragStartCapture(event);
    },
  });

  function actionButton(action: FileAction, label: string, Icon: typeof CopyIcon) {
    return (
      <Button
        type="button"
        role="menuitem"
        variant="ghost"
        disabled={Boolean(busy)}
        className="h-8 w-full justify-start gap-2 px-2 font-normal"
        onClick={() => {
          setOpen(false);
          void run(action);
        }}
      >
        {busy === action ? <LoaderCircleIcon className="size-4 animate-spin" /> : <Icon className="size-4" />}
        {label}
      </Button>
    );
  }

  return (
    <>
      {capabilityHost}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <span
            aria-hidden="true"
            className="pointer-events-none fixed size-px"
            style={{ left: anchorPoint.x, top: anchorPoint.y }}
          />
        </PopoverAnchor>
        {selectedAssetId && (
          <PopoverContent
            role="menu"
            side="right"
            align="start"
            sideOffset={2}
            className="w-56 p-1"
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            {actionButton('COPY', labels.copy, CopyIcon)}
            {actionButton('SAVE_AS', labels.saveAs, DownloadIcon)}
            {actionButton('REVEAL', labels.reveal, FolderOpenIcon)}
            {actionButton('OPEN', labels.open, ExternalLinkIcon)}
          </PopoverContent>
        )}
      </Popover>
    </>
  );
}
