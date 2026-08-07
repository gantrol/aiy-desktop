import { useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react';
import { cn } from '@/renderer/lib/utils';
import {
  clipboardImageFiles,
  imageFiles,
  isEditableTarget,
  transferSourceUrl,
  type RendererImageImportSource,
} from '@/renderer/components/creator/imageImport';

interface Props {
  className?: string;
  children: ReactNode;
  disabled?: boolean;
  overlay?: ReactNode;
  onImages(files: File[], source: RendererImageImportSource, sourceUrl: string): void;
  onText?(text: string): void;
}

export function PasteDropSurface({ className, children, disabled, overlay, onImages, onText }: Props) {
  const [dragActive, setDragActive] = useState(false);

  function paste(event: ClipboardEvent<HTMLElement>) {
    if (disabled || event.defaultPrevented) return;
    const files = clipboardImageFiles(event.clipboardData);
    if (files.length) {
      event.preventDefault();
      const sourceUrl = transferSourceUrl(event.clipboardData);
      onImages(files, 'PASTE', sourceUrl);
      return;
    }
    if (!onText || isEditableTarget(event.target)) return;
    const text = event.clipboardData.getData('text/plain');
    if (!text.trim()) return;
    event.preventDefault();
    onText(text);
  }

  function drag(event: DragEvent<HTMLElement>, active: boolean) {
    if (disabled || event.defaultPrevented || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    if (event.type === 'dragover') event.dataTransfer.dropEffect = 'copy';
    setDragActive(active);
  }

  function drop(event: DragEvent<HTMLElement>) {
    if (disabled || event.defaultPrevented) return;
    event.preventDefault();
    setDragActive(false);
    const files = imageFiles(event.dataTransfer.files);
    if (files.length) onImages(files, 'DROP', transferSourceUrl(event.dataTransfer));
  }

  return (
    <section
      className={cn('relative', className)}
      onPaste={paste}
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
