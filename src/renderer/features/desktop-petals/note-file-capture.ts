import type { ClipboardEvent, DragEvent } from 'react';
import { imageMimeType } from '@/renderer/components/creator/imageImport';

/** Pure image batches keep the document editor's existing inline image path. */
export function noteFileCapture(onFiles: (files: File[]) => Promise<unknown>) {
  const capture = (event: { preventDefault(): void; stopPropagation(): void }, list: FileList) => {
    const files = Array.from(list);
    if (!files.some((file) => !imageMimeType(file))) return;
    event.preventDefault();
    event.stopPropagation();
    void onFiles(files);
  };
  return {
    onDropCapture: (event: DragEvent) => capture(event, event.dataTransfer.files),
    onPasteCapture: (event: ClipboardEvent) => capture(event, event.clipboardData.files),
  };
}
