import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import type { IntakeCommitResult, NewExternalCreationImportResult, PromptSeriesDto } from '@/shared/contracts';
import { hasExternalFilesDrag, hasMaterialsDrag } from '@/renderer/components/albums/albumDrag';
import { imageImportItems } from '@/renderer/components/creator/imageImport';
import { Dialog, DialogContent } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';
import { GlobalDropOverlay } from '@/renderer/features/intake/GlobalDropOverlay';
import { ImportReviewWorkspace } from '@/renderer/features/intake/ImportReviewWorkspace';
import { IntakeProgressOverlay } from '@/renderer/features/intake/IntakeProgressOverlay';
import { IntakeSurface } from '@/renderer/features/intake/IntakeSurface';
import type { IntakeImageDetails } from '@/renderer/features/intake/importMetadata';
import { useIntakeController } from '@/renderer/features/intake/useIntakeController';

interface Props {
  active: boolean;
  children: ReactNode;
  /** Material album currently open in the library, so a material import lands where the user is. */
  materialAlbumId?: string | null;
  /** Backing creation album for a read-only creation view, if one is open. */
  creationAlbumId?: string | null;
  series: PromptSeriesDto[];
  onCommitted(result: IntakeCommitResult): void | Promise<void>;
  onExternalCreationCommitted(result: NewExternalCreationImportResult): void | Promise<void>;
}

export interface GalleryIntakeAdapterHandle {
  reviewFiles(files: File[], target: { albumId: string; albumName: string }): void;
}

export const GalleryIntakeAdapter = forwardRef<GalleryIntakeAdapterHandle, Props>(function GalleryIntakeAdapter(
  { active, children, materialAlbumId, creationAlbumId, series, onCommitted, onExternalCreationCommitted },
  ref,
) {
  const { locale, messages } = useI18n();
  const controller = useIntakeController('GALLERY', (result) => void onCommitted(result), active);
  const { state } = controller;
  const reviewFocusRef = useRef<HTMLDivElement | null>(null);
  const [dropTarget, setDropTarget] = useState<{ albumId: string; albumName: string } | null>(null);
  const [externalPending, setExternalPending] = useState(false);
  const [externalError, setExternalError] = useState('');
  const effectiveMaterialAlbumId = dropTarget?.albumId ?? materialAlbumId ?? null;
  const reviewBusy = state.status === 'READING' || Boolean(state.pendingIntent) || externalPending;

  useImperativeHandle(
    ref,
    () => ({
      reviewFiles(files, target) {
        setDropTarget(target);
        setExternalError('');
        controller.addTransferredFiles('DROP', files);
      },
    }),
    [controller],
  );

  useEffect(() => {
    if (!active || state.pendingIntent) return undefined;
    const paste = (event: ClipboardEvent) => {
      setDropTarget(null);
      controller.onPaste(event);
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [active, controller, state.pendingIntent]);

  useEffect(() => {
    if (!active) controller.cancelDrag();
  }, [active]);

  useEffect(() => {
    if (!active) return undefined;
    const cancelDrag = () => controller.cancelDrag();
    const keyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && state.dragActive) controller.cancelDrag();
    };
    window.addEventListener('blur', cancelDrag);
    window.addEventListener('keydown', keyDown);
    return () => {
      window.removeEventListener('blur', cancelDrag);
      window.removeEventListener('keydown', keyDown);
    };
  }, [active, state.dragActive]);

  function resetReview() {
    setDropTarget(null);
    setExternalError('');
    controller.reset();
  }

  async function importExternalCreation(details: IntakeImageDetails) {
    if (externalPending || state.pendingIntent) return;
    const images = state.items.filter((item) => item.kind === 'IMAGE');
    if (!images.length) return;
    setExternalPending(true);
    setExternalError('');
    try {
      const outputs = await imageImportItems(images.map((item) => item.file));
      const itemSourceUrls = images.map((item) =>
        (details[item.id]?.metadata.sourceUrl || item.sourceUrl || '').trim(),
      );
      const sourceUrl =
        itemSourceUrls.length > 0 && itemSourceUrls.every((value) => value && value === itemSourceUrls[0])
          ? itemSourceUrls[0]
          : '';
      const result = await window.desktopApi.creatorNewExternalCreationImport({
        intent: 'NEW_EXTERNAL_CREATION',
        sourceKind: 'EXTERNAL_IMPORT',
        creationDraftId: null,
        // Material albums are filing destinations, not creation albums.
        albumId: creationAlbumId ?? null,
        title: '',
        titleLocale: locale,
        prompt: { knowledge: 'UNKNOWN' },
        source: state.source,
        sourceUrl,
        outputs: outputs.map((output, index) => ({
          ...output,
          metadata: details[images[index]?.id]?.metadata,
        })),
      });
      if (state.favorite) {
        await Promise.allSettled(
          result.assetIds.map((imageAssetId) => window.desktopApi.favoriteAdd({ kind: 'IMAGE_ASSET', imageAssetId })),
        );
      }
      resetReview();
      await onExternalCreationCommitted(result);
    } catch (reason) {
      setExternalError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExternalPending(false);
    }
  }

  return (
    <IntakeSurface
      accessibleName={messages.intake.start.paste}
      data-intake-context="GALLERY"
      data-intake-state={state.status}
      aria-busy={reviewBusy}
      className="relative flex size-full min-h-0 flex-col overflow-hidden"
      onDragEnterCapture={(event) => {
        if (hasMaterialsDrag(event.dataTransfer)) controller.cancelDrag();
      }}
      onDragEnter={(event) => {
        if (!hasExternalFilesDrag(event.dataTransfer)) return;
        controller.onDragEnter(event);
      }}
      onDragOver={(event) => {
        if (hasMaterialsDrag(event.dataTransfer)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'none';
          return;
        }
        if (hasExternalFilesDrag(event.dataTransfer)) controller.onDragOver(event);
      }}
      onDragLeave={(event) => {
        if (hasMaterialsDrag(event.dataTransfer)) {
          controller.cancelDrag();
          return;
        }
        controller.onDragLeave(event);
      }}
      onDrop={(event) => {
        if (hasMaterialsDrag(event.dataTransfer)) {
          event.preventDefault();
          setDropTarget(null);
          controller.cancelDrag();
          return;
        }
        if (!hasExternalFilesDrag(event.dataTransfer)) return;
        if (event.defaultPrevented) return;
        setDropTarget(null);
        controller.onDrop(event);
      }}
    >
      {children}
      <GlobalDropOverlay active={state.dragActive} label={messages.intake.start.paste} />
      <IntakeProgressOverlay
        active={state.status === 'READING' || Boolean(state.pendingIntent) || externalPending}
        label={messages.creator.workbench.importing}
      />
      <Dialog
        open={state.items.length > 0}
        onOpenChange={(open) => {
          if (!open && !reviewBusy) resetReview();
        }}
      >
        <DialogContent
          className="h-[min(880px,calc(100vh-2rem))] w-[min(86rem,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden p-0"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            reviewFocusRef.current?.focus();
          }}
        >
          <div ref={reviewFocusRef} tabIndex={-1} className="size-full outline-none">
            <ImportReviewWorkspace
              items={state.items}
              series={series}
              favorite={state.favorite}
              disabled={reviewBusy}
              importingMaterial={state.pendingIntent === 'IMPORT'}
              importingCreation={externalPending}
              error={state.error || externalError}
              skippedCount={state.skipped.length}
              onFavoriteChange={controller.setFavorite}
              onEditText={controller.editText}
              onMove={controller.move}
              onRemove={controller.remove}
              onAddFiles={controller.addFiles}
              onImport={(details) =>
                void controller.commit('IMPORT', { albumId: effectiveMaterialAlbumId, imageDetails: details })
              }
              onImportAsCreation={(details) => void importExternalCreation(details)}
              onCancel={resetReview}
            />
          </div>
        </DialogContent>
      </Dialog>
    </IntakeSurface>
  );
});
