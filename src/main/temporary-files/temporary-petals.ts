import { randomUUID } from 'node:crypto';
import { app, clipboard, dialog, screen, type BrowserWindow, type Rectangle } from 'electron';
import { z } from 'zod';
import { temporaryFilesStore } from '@/main/temporary-files/temporary-files-store';
import { stageTemporaryImage } from '@/main/temporary-files/temporary-file-images';
import { promoteTemporaryFile } from '@/main/temporary-files/temporary-file-promotion';
import { executeTemporaryContent } from '@/main/temporary-files/temporary-petal-content';
import { importTemporaryFile } from '@/main/temporary-files/temporary-file-import';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { PetalWindows, PetalWindow } from '@/main/desktop-petals/petal-windows';
import { executePetalDrag, type PetalDrag } from '@/main/desktop-petals/petal-window-drag';
import { TEMPORARY_SCOPE, temporaryFilesCommandSchema } from '@/shared/contracts/temporary-files';
import {
  desktopPetalSnapshotSchema,
  desktopNoteAppearanceSchema,
  desktopNoteDraftSchema,
  desktopNoteSaveSchema,
  petalNoteSizeSchema,
} from '@/shared/contracts/desktop-petals';
import { petalContentScaleSchema } from '@/shared/petal-display';
import type { PetalLanguage } from '@/shared/contracts/petal-language';
import { petalError, petalErrorCode } from '@/shared/petal-errors';
import { petalPreviewRequestSchema, petalPreviewText } from '@/shared/petal-preview';
import { contentAssetPath } from '@/shared/content-asset-path';
import { executeTemporaryImageEdit } from '@/main/temporary-files/temporary-image-edit';
import { ImagePrivacyScanner } from '@/main/image-privacy/image-privacy-scanner';
import { TemporaryCaptureEdit } from '@/main/temporary-files/temporary-capture-edit';

interface Options {
  userDataRoot: string;
  windows: PetalWindows;
  context(): ActiveLibraryContext | null;
  main(): BrowserWindow | null;
  language(): PetalLanguage;
  suspended(): boolean;
  changed(): void;
  flush(entry: PetalWindow, save?: boolean): Promise<boolean>;
  promoted(context: ActiveLibraryContext, id: string, image: boolean): void;
}

export class TemporaryPetals {
  private readonly imagePrivacy = new ImagePrivacyScanner();
  readonly store;
  private readonly captureEdit: TemporaryCaptureEdit;
  restoration: Promise<void> = Promise.resolve();
  constructor(private readonly options: Options) {
    this.store = temporaryFilesStore(options.userDataRoot);
    this.captureEdit = new TemporaryCaptureEdit(this.store, options.windows, options.changed);
    this.store.isOpen = (id) => Boolean(options.windows.layouts.get(TEMPORARY_SCOPE, id)?.visible);
    app.once('will-quit', () => this.imagePrivacy.dispose());
  }
  owns(entry?: PetalWindow) {
    return entry?.libraryId === TEMPORARY_SCOPE;
  }
  drag(origins: Map<number, PetalDrag>, command: string, input: unknown, senderId: number, entry: PetalWindow) {
    const context = this.options.context();
    return executePetalDrag(
      this.options.windows,
      origins,
      command,
      input,
      senderId,
      entry,
      context?.state === 'ACTIVE' ? context.library.id : undefined,
    );
  }
  start(ready: Promise<void>) {
    this.restoration = ready.then(() => this.restore());
    void this.restoration.catch((error) => console.error('[temporary-files] restoration failed', error));
  }
  async restore() {
    await this.store.ready;
    for (const { id } of this.store.snapshot().items) {
      if (this.options.suspended()) break;
      if (this.options.windows.layouts.get(TEMPORARY_SCOPE, id)?.visible)
        await this.options.windows.restore(TEMPORARY_SCOPE, id);
    }
  }
  async manage(raw: unknown, sender?: PetalWindow) {
    const request = temporaryFilesCommandSchema.parse(raw);
    await this.store.ready;
    if ('id' in request && sender?.instanceId && this.owns(sender) && request.id !== sender.instanceId)
      throw petalError('sourceUnavailable');
    if (request.kind === 'list') return this.store.snapshot();
    if (request.kind === 'finishCapture') {
      await this.captureEdit.finish(request.id, sender);
      return this.store.snapshot();
    }
    const release =
      'requestId' in request
        ? this.store.retain(request.requestId)
        : 'id' in request
          ? this.store.retain(request.id)
          : () => undefined;
    try {
      if (request.kind === 'open') {
        this.store.manifest(request.id);
        this.prepareImageWindow(request.id);
        await this.options.windows.show(TEMPORARY_SCOPE, request.id, undefined, true);
      } else if (request.kind === 'promote') await this.promote(request.id, request.expectedHash);
      else if (request.kind === 'import') await this.import(request.requestId, sender?.window, request.edit);
      else if (request.kind === 'clipboard') await this.paste(request.requestId, request.edit);
      else if (request.kind === 'image')
        await this.acceptSnapshot(request.requestId, '', Buffer.from(request.bytes), false, undefined, true, {
          kind: 'stitch',
        });
      else if (request.kind === 'create') {
        await this.store.run(() => this.store.create(request.requestId, request.text));
        await this.options.windows.show(TEMPORARY_SCOPE, request.requestId, undefined, true);
      } else if (request.kind === 'discard') {
        const entry = this.options.windows.find(TEMPORARY_SCOPE, request.id);
        if (entry && !(await this.options.flush(entry, true))) throw petalError('unsaved');
        await this.store.run(() => this.store.discard(request.id));
        this.options.windows.remove(TEMPORARY_SCOPE, request.id);
        await this.options.windows.flush();
      } else
        await this.store.run(async () => {
          if (request.kind === 'configure') await this.store.configure(request.limitMiB);
          if (request.kind === 'cleanup') await this.store.makeRoom(0, true);
          if (request.kind === 'convert') await this.convert(request.id);
        });
      return this.store.snapshot();
    } finally {
      release();
      this.options.changed();
    }
  }
  private async import(id: string, window?: BrowserWindow, edit = false) {
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: edit
        ? [{ name: 'PNG / JPEG', extensions: ['png', 'jpg', 'jpeg'] }]
        : [{ name: 'Markdown / Image', extensions: ['md', 'markdown', 'txt', 'png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    };
    const parent = window ?? this.options.main();
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return;
    await this.store.run(async () => {
      const existed = this.store.has(id);
      try {
        await importTemporaryFile(this.store, id, result.filePaths[0], edit);
        if (edit) await this.validateImageEdit(id);
      } catch (error) {
        if (edit && !existed && this.store.has(id)) await this.store.remove(this.store.manifest(id));
        throw error;
      }
    });
    this.prepareImageWindow(id);
    const entry = await this.options.windows.show(TEMPORARY_SCOPE, id, undefined, true);
    if (edit) entry.imageEditRequest = randomUUID();
  }
  private async paste(id: string, edit = false) {
    const image = clipboard.readImage();
    const text = clipboard.readText();
    const bytes = image.isEmpty() ? null : image.toPNG();
    if (edit) {
      if (!bytes && !text.trim()) throw petalError('clipboardEmpty');
      await this.acceptSnapshot(id, text, bytes, false, undefined, Boolean(bytes));
      return;
    }
    await this.store.run(async () => {
      if (bytes) await this.createImage(id, bytes, this.imageTitle('clipboard'), 'image/png');
      else await this.store.create(id, text);
    });
    this.prepareImageWindow(id);
    await this.options.windows.show(TEMPORARY_SCOPE, id, undefined, true);
  }
  async acceptSnapshot(
    id: string,
    text: string,
    bytes: Buffer | null,
    promote: boolean,
    mayPromote: () => boolean = () => true,
    edit = false,
    origin: { kind: 'capture' | 'clipboard' | 'stitch'; bounds?: Rectangle } = { kind: 'clipboard' },
    returnToCapture?: AbortSignal,
  ) {
    await this.store.ready;
    const release = this.store.retain(id);
    try {
      await this.store.run(async () => {
        if (!mayPromote()) throw new Error('cancelled');
        const existed = this.store.has(id);
        try {
          if (bytes && !existed) await this.createImage(id, bytes, this.imageTitle(origin.kind), 'image/png');
          else if (!existed) await this.store.create(id, text);
          if (edit) await this.validateImageEdit(id);
        } catch (error) {
          if (!existed && this.store.has(id)) await this.store.remove(this.store.manifest(id));
          throw error;
        }
      });
      if (promote) {
        if (!mayPromote()) throw new Error('permission');
        await this.promote(id, (await this.store.body(id)).note.contentHash);
      } else {
        if (!mayPromote()) throw new Error('cancelled');
        this.prepareImageWindow(id, origin.bounds);
        const entry = await this.options.windows.show(TEMPORARY_SCOPE, id, undefined, true);
        if (!mayPromote()) {
          await this.options.windows.hide(entry);
          throw new Error('cancelled');
        }
        if (edit) entry.imageEditRequest = randomUUID();
        if (returnToCapture) return await this.captureEdit.open(entry, returnToCapture);
      }
    } finally {
      release();
      this.options.changed();
    }
  }
  /** Validate before opening the editor; unsupported imports must not leave an empty note. */
  private imageTitle(kind: 'capture' | 'clipboard' | 'stitch') {
    const language = this.options.language();
    const date = new Intl.DateTimeFormat(language.locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      hourCycle: 'h23',
    }).format(new Date());
    return `${language.messages.temporary.imageNames[kind]} · ${date}`;
  }
  private prepareImageWindow(id: string, bounds?: Rectangle) {
    const manifest = this.store.manifest(id);
    const previous = this.options.windows.layouts.get(TEMPORARY_SCOPE, id);
    if (manifest.kind !== 'IMAGE' || previous?.imageSize) return;
    const asset = manifest.attachments.find((file) => file.asset)?.asset;
    if (!asset) return;
    const display = bounds
      ? screen.getDisplayMatching(bounds)
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const width = bounds?.width ?? asset.width / display.scaleFactor,
      height = bounds?.height ?? asset.height / display.scaleFactor;
    const scale = bounds
      ? 1
      : Math.min(1, (display.workArea.width - 16) / width, (display.workArea.height - 16) / height);
    const imageSize = {
      width: Math.max(32, Math.round(width * scale) + 16),
      height: Math.max(32, Math.round(height * scale) + 16),
    };
    const cursor = screen.getCursorScreenPoint();
    this.options.windows.layouts.set(TEMPORARY_SCOPE, id, {
      ...previous,
      x: Math.round(bounds ? bounds.x - 8 : cursor.x - imageSize.width / 2),
      y: Math.round(bounds ? bounds.y - 8 : cursor.y - imageSize.height / 2),
      expanded: true,
      visible: true,
      home: 'desktop',
      imageSize,
    });
  }
  private async validateImageEdit(id: string) {
    try {
      await executeTemporaryImageEdit(this.store, id, { kind: 'load' });
    } catch (error) {
      if (petalErrorCode(error) === 'invalidSettings') throw petalError('imageEditUnsupported');
      throw error;
    }
  }
  private async createImage(id: string, bytes: Uint8Array, name: string, mimeType: string) {
    const note = await this.store.create(id, '', name);
    const asset = await stageTemporaryImage(this.store, id, {
      importId: randomUUID(),
      source: 'UPLOAD',
      item: {
        name: `${name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')}.png`,
        bytes,
        mimeType: mimeType as 'image/png',
      },
    });
    await this.store.commit(
      { ...this.store.manifest(id), kind: 'IMAGE', protected: false },
      { note: { ...note, references: [{ assetId: asset.id, mediaUrl: asset.mediaUrl }] }, draft: null },
    );
  }
  private async convert(id: string) {
    const manifest = this.store.manifest(id);
    if (manifest.kind !== 'IMAGE' || manifest.promotion) throw petalError('invalidSettings');
    const body = await this.store.body(id);
    if (body.imageEdit?.draft) throw petalError('unsaved');
    const image = manifest.attachments.find((file) => file.id === body.note.references[0]?.assetId)?.asset;
    if (!image) throw petalError('sourceUnavailable');
    const text = `![${body.note.title.replace(/[\[\]]/g, '')}](${contentAssetPath(image.id)})`;
    await this.store.commit(
      { ...manifest, kind: 'NOTE', protected: true },
      {
        ...body,
        note: { ...body.note, text: `${text}\n\n`, format: 'markdown', contentHash: randomUUID() },
        draft: null,
      },
    );
    const windows = this.options.windows;
    const entry = windows.find(TEMPORARY_SCOPE, id);
    if (entry) windows.imageEditor.set(entry, false);
    const placement = windows.layouts.get(TEMPORARY_SCOPE, id);
    if (placement) windows.layouts.set(TEMPORARY_SCOPE, id, { ...placement, imageSize: undefined });
    if (entry?.expanded) windows.resizeNote(entry, placement?.noteSize ?? { width: 360, height: 400 });
    await windows.flush();
  }
  private async promote(id: string, expectedHash: string) {
    const context = this.options.context();
    if (!context || context.state !== 'ACTIVE') {
      this.options.main()?.show();
      throw petalError('temporaryChooseSpace');
    }
    const release = context.acquireOperation();
    const entry = this.options.windows.find(TEMPORARY_SCOPE, id);
    try {
      if (entry && !(await this.options.flush(entry, true))) throw petalError('unsaved');
      await this.store.run(async () => {
        const result = await promoteTemporaryFile(this.store, id, expectedHash, context);
        const previous = this.options.windows.find(context.library.id, result.targetId);
        if (previous && previous !== entry && !(await this.options.flush(previous, true))) throw petalError('unsaved');
        const placement = this.options.windows.layouts.get(TEMPORARY_SCOPE, id);
        if (placement) await this.options.windows.layouts.commit(context.library.id, { [result.targetId]: placement });
        if (entry) {
          this.options.windows.retarget(entry, context.library.id, result.targetId);
        }
        this.options.promoted(context, result.targetId, result.note === null);
        // Keep payloads until the destination and its placement have both acknowledged the transition.
        await this.store.remove(this.store.manifest(id));
        this.options.windows.layouts.remove(TEMPORARY_SCOPE, id);
        await this.options.windows.flush();
      });
    } finally {
      if (entry) entry.editEpoch++;
      this.options.changed();
      release();
    }
  }
  async snapshot(entry: PetalWindow) {
    const id = entry.instanceId!;
    const manifest = this.store.manifest(id);
    const body = await this.store.body(id);
    const image =
      manifest.kind === 'IMAGE'
        ? manifest.attachments.find((file) => file.id === body.note.references[0]?.assetId)?.asset
        : undefined;
    const bounds = entry.window.getBounds();
    const note = { ...body.note, editable: !manifest.promotion };
    return desktopPetalSnapshotSchema.parse({
      libraryId: TEMPORARY_SCOPE,
      libraryName: this.options.language().messages.temporary.title,
      instanceId: id,
      expanded: entry.expanded,
      alwaysOnTop: entry.window.isAlwaysOnTop(),
      editEpoch: entry.editEpoch,
      imageEditRequest: entry.imageEditRequest,
      captureEdit: this.captureEdit.active(id),
      point: { x: bounds.x, y: bounds.y },
      notes: [note],
      draft: body.draft,
      suspended: this.options.suspended(),
      temporary: {
        id,
        kind: manifest.kind,
        title: manifest.title,
        updatedAt: manifest.updatedAt,
        byteSize: manifest.byteSize,
        protected: manifest.protected,
      },
      temporaryTargetSpace: this.options.context()?.library.name,
      summary: {
        id,
        stashId: id,
        title: note.title || note.text.slice(0, 100),
        color: note.color,
        icon: note.icon,
        hasImages: note.references.length > 0,
        persisted: true,
      },
      contentScale: this.options.windows.layouts.get(TEMPORARY_SCOPE, id)?.contentScale ?? 1,
      applicationPanelHeight: this.options.windows.notePanel.height(entry),
      ...(image
        ? {
            board: {
              pins: [
                {
                  id,
                  source: { kind: 'IMAGE', id: image.id },
                  title: note.title,
                  preview: '',
                  mediaUrl: image.mediaUrl,
                  media: image,
                  color: note.color,
                  icon: note.icon,
                  layerId: 'default',
                },
              ],
              layers: [],
              memberships: {},
              activeLayerId: 'default',
              hiddenLayerIds: [],
            },
          }
        : {}),
    });
  }
  async execute(command: string, input: unknown, entry: PetalWindow) {
    const id = entry.instanceId!;
    await this.store.ready;
    if (command === 'snapshot') return this.snapshot(entry);
    if (command === 'image-privacy') {
      if (this.store.manifest(id).kind !== 'IMAGE') throw petalError('sourceUnavailable');
      return this.imagePrivacy.execute(entry.window, input);
    }
    if (command === 'preview') {
      const request = petalPreviewRequestSchema.parse(input);
      if (request.id !== id) throw petalError('sourceUnavailable');
      if (!request.open || entry.expanded) return null;
      const body = await this.store.body(id);
      return {
        title: body.draft?.title ?? body.note.title,
        text: petalPreviewText(body.draft?.text ?? body.note.text).slice(0, 400),
        mediaUrl: body.note.references[0] ? `${body.note.references[0].mediaUrl}?poster=1` : null,
      };
    }
    if (command === 'hide' || command === 'remove') return this.options.windows.hide(entry);
    if (command === 'expand') return void (await this.options.windows.expand(entry, z.boolean().parse(input)));
    if (command === 'always-on-top') return this.options.windows.setAlwaysOnTop(entry, z.boolean().parse(input));
    if (command === 'content-scale')
      return this.options.windows.setContentScale(entry, petalContentScaleSchema.parse(input));
    if (command === 'resize') return this.options.windows.resizeNote(entry, petalNoteSizeSchema.parse(input));
    if (command === 'application-panel')
      return this.options.windows.notePanel.set(entry, z.number().int().min(0).max(400).parse(input));
    if (command === 'content-applications' || command === 'note-albums') return [];
    if (command === 'main' || command === 'note-album') {
      this.options.main()?.show();
      throw petalError('temporaryChooseSpace');
    }
    const result = await this.store.run(async () => {
      if (command === 'image-edit') return executeTemporaryImageEdit(this.store, id, input);
      if (command === 'save' || command === 'checkpoint') {
        const request = command === 'save' ? desktopNoteSaveSchema.parse(input) : desktopNoteDraftSchema.parse(input);
        if (request.id !== id) throw petalError('sourceUnavailable');
        return command === 'save'
          ? this.store.save(request)
          : this.store.checkpoint(desktopNoteDraftSchema.parse(request));
      }
      if (command === 'appearance' || command === 'board') {
        const request = desktopNoteAppearanceSchema.parse(
          command === 'board'
            ? (() => {
                const { kind: _kind, ...value } = z
                  .object({ kind: z.literal('pin-appearance') })
                  .passthrough()
                  .parse(input);
                return value;
              })()
            : input,
        );
        if (request.id !== id) throw petalError('sourceUnavailable');
        const body = await this.store.body(id);
        const note = { ...body.note, ...request };
        await this.store.commit(this.store.manifest(id), { ...body, note });
        return note;
      }
      return executeTemporaryContent(this.store, id, command, input, entry);
    });
    if (command !== 'checkpoint' && command !== 'image-edit') this.options.changed();
    if (command === 'image-edit' && (input as { kind?: string })?.kind === 'commit') this.options.changed();
    return result;
  }
}
