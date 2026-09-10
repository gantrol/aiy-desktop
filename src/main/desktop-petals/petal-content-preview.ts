import type { PetalWindows, PetalWindow } from '@/main/desktop-petals/petal-windows';
import type { PetalDrawerService } from '@/main/desktop-petals/petal-drawer-service';
import type { PetalNoteService } from '@/main/desktop-petals/petal-note-service';
import type { PetalBoard, DesktopPin } from '@/shared/contracts/petal-board';
import type { DesktopNote } from '@/shared/contracts/desktop-petals';
import { isContentPinId } from '@/shared/contracts/petal-board';
import { petalError } from '@/shared/petal-errors';
import { petalLabel, petalPreviewRequestSchema, petalPreviewText } from '@/shared/petal-preview';

function describePetal(source: DesktopNote | DesktopPin, draft?: { text: string; title?: string } | null) {
  const body = 'text' in source ? (draft?.text ?? source.text) : source.preview;
  return {
    title: petalLabel(draft?.title ?? source.title, body),
    text: Array.from(petalPreviewText(body)).slice(0, 400).join(''),
    mediaUrl:
      'mediaUrl' in source
        ? source.mediaUrl
        : (source.references[0]?.mediaUrl ?? source.importedImages?.[0]?.mediaUrl ?? null),
  };
}

/** Read only the hovered instance; reserve transient space without opening an editor or saving layout. */
export function executePetalPreview(
  input: unknown,
  entry: PetalWindow | undefined,
  windows: PetalWindows,
  drawer: PetalDrawerService,
  notes: PetalNoteService | null,
  board: () => PetalBoard,
  dragging: boolean,
) {
  if (!entry) throw petalError('hubOnly');
  const request = petalPreviewRequestSchema.parse(input);
  const reserve = (open: boolean) => {
    if (entry.drawer) drawer.view.setPreview(open);
    else windows.presentation.preview(entry, open, 'peek');
  };
  if (!request.open) {
    // A late close from the previous grid cell must not dismiss its neighbour.
    if (entry.previewToken === request.token) {
      entry.previewToken = undefined;
      reserve(false);
    }
    return null;
  }
  if (entry.expanded || dragging || windows.presentation.previewing(entry)) return null;
  if (entry.drawer) {
    if (drawer.view.progress !== 1 || drawer.view.menu || drawer.view.dragging || drawer.view.moving) return null;
    if (!drawer.items().some((item) => item.id === request.id)) throw petalError('sourceUnavailable');
  } else if (entry.instanceId !== request.id) throw petalError('sourceUnavailable');
  const source = isContentPinId(request.id)
    ? board().pins.find((pin) => pin.id === request.id)
    : notes?.get(request.id);
  if (!source) throw petalError('sourceUnavailable');
  const draft = 'text' in source && !entry.drawer ? notes?.draft(request.id) : null;
  const content = describePetal(source, draft);
  entry.previewToken = request.token;
  reserve(true);
  return content;
}
