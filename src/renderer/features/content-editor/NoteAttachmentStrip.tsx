import { useMemo } from 'react';
import type { DesktopNote } from '@/shared/contracts/desktop-petals';
import { contentAssetPath } from '@/shared/content-document';
import { contentMarkdownMediaPaths } from '@/shared/content-markdown';
import { PetalReferenceImages } from '@/renderer/features/desktop-petals/PetalReferences';

export function NoteAttachmentStrip({
  note,
  markdown,
  format,
  disabled,
  onRemove,
}: {
  note: DesktopNote;
  markdown: string;
  format?: 'markdown';
  disabled: boolean;
  onRemove(assetId: string): Promise<boolean>;
}) {
  const paths = useMemo(
    () => (format === 'markdown' ? contentMarkdownMediaPaths(markdown) : new Set<string>()),
    [markdown, format],
  );
  const attachments = note.references.filter(
    (reference) => !paths.has(contentAssetPath(reference.assetId)) && !paths.has(reference.mediaUrl),
  );
  return (
    <PetalReferenceImages
      note={{ ...note, references: attachments }}
      disabled={disabled}
      onChange={(input) => (input.kind === 'remove' ? onRemove(input.assetId) : Promise.resolve(false))}
    />
  );
}
