import { useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react';
import { hasExternalFilesDrag, hasMaterialsDrag } from '@/renderer/components/albums/albumDrag';
import { cn } from '@/renderer/lib/utils';
import {
  clipboardHasImagePayload,
  clipboardHasUserText,
  clipboardImageFiles,
  imageFiles,
  isEditableTarget,
  transferSourceUrl,
  type RendererImageImportSource,
} from '@/renderer/components/creator/imageImport';
import { intakeMediaMimeType, isIntakeVideoMimeType } from '@/renderer/features/intake/intakeImageFormats';

interface Props {
  accessibleName?: string;
  className?: string;
  children: ReactNode;
  disabled?: boolean;
  overlay?: ReactNode;
  respectEditableImagePaste?: boolean;
  workbenchPane?: boolean;
  onImages(files: File[], source: RendererImageImportSource, sourceUrl: string): void;
  onClipboardImage?(sourceUrl: string): void;
  onVideos?(files: File[], source: 'DROP', sourceUrl: string): void;
  onText?(text: string): void;
}

export function PasteDropSurface({
  accessibleName,
  className,
  children,
  disabled,
  overlay,
  respectEditableImagePaste,
  workbenchPane = false,
  onImages,
  onClipboardImage,
  onVideos,
  onText,
}: Props) {
  const [dragActive, setDragActive] = useState(false);

  function paste(event: ClipboardEvent<HTMLElement>) {
    if (disabled || event.defaultPrevented) return;
    // React portals bubble through this component even when their DOM is elsewhere.
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    if (respectEditableImagePaste && isEditableTarget(event.target)) return;
    const files = clipboardImageFiles(event.clipboardData);
    if (files.length) {
      event.preventDefault();
      event.stopPropagation();
      const sourceUrl = transferSourceUrl(event.clipboardData);
      onImages(files, 'PASTE', sourceUrl);
      return;
    }
    if (
      onClipboardImage &&
      clipboardHasImagePayload(event.clipboardData) &&
      !clipboardHasUserText(event.clipboardData)
    ) {
      event.preventDefault();
      event.stopPropagation();
      onClipboardImage(transferSourceUrl(event.clipboardData));
      return;
    }
    if (!onText || isEditableTarget(event.target)) return;
    const text = event.clipboardData.getData('text/plain');
    if (!text.trim()) return;
    event.preventDefault();
    onText(text);
  }

  function drag(event: DragEvent<HTMLElement>, active: boolean) {
    if (disabled || event.defaultPrevented) return;
    if (hasMaterialsDrag(event.dataTransfer)) {
      setDragActive(false);
      if (event.type === 'dragover') {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'none';
      }
      return;
    }
    if (!hasExternalFilesDrag(event.dataTransfer)) return;
    event.preventDefault();
    if (event.type === 'dragover') event.dataTransfer.dropEffect = 'copy';
    setDragActive(active);
  }

  function drop(event: DragEvent<HTMLElement>) {
    if (disabled || event.defaultPrevented) return;
    if (hasMaterialsDrag(event.dataTransfer)) {
      event.preventDefault();
      setDragActive(false);
      return;
    }
    if (!hasExternalFilesDrag(event.dataTransfer)) return;
    event.preventDefault();
    setDragActive(false);
    const videos = Array.from(event.dataTransfer.files).filter((file) => {
      const mimeType = intakeMediaMimeType(file);
      return Boolean(mimeType && isIntakeVideoMimeType(mimeType));
    });
    if (videos.length && onVideos) onVideos(videos, 'DROP', transferSourceUrl(event.dataTransfer));
    const files = imageFiles(event.dataTransfer.files).filter((file) => !onVideos || !videos.includes(file));
    if (files.length) onImages(files, 'DROP', transferSourceUrl(event.dataTransfer));
  }

  return (
    <section
      data-workbench-pane={workbenchPane || undefined}
      aria-label={accessibleName}
      tabIndex={accessibleName && !disabled ? 0 : undefined}
      className={cn(
        'relative',
        accessibleName && 'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        className,
      )}
      onPointerDown={(event) => {
        if (!accessibleName || disabled || event.defaultPrevented || event.button !== 0) return;
        if (!(event.target instanceof Element) || !event.currentTarget.contains(event.target)) return;
        const control = event.target.closest(
          'button, a[href], input, textarea, select, label, summary, [contenteditable="true"], [tabindex]',
        );
        if (control && control !== event.currentTarget) return;
        event.currentTarget.focus({ preventScroll: true });
      }}
      onPasteCapture={paste}
      onDragEnter={(event) => drag(event, true)}
      onDragOver={(event) => drag(event, true)}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) drag(event, false);
      }}
      onDrop={drop}
    >
      {children}
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center bg-background/88 backdrop-blur-sm">
          {overlay}
        </div>
      )}
    </section>
  );
}
