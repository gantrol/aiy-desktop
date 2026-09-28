import { useId } from 'react';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ReferencePreview } from '@/shared/contracts/content-library';
import { isDocumentSource, type ReferenceTarget } from '@/shared/contracts/content-source';
import { ContentReferenceBody } from '@/renderer/features/content-editor/ContentReferenceBody';
import type { ReferencePresentation } from '@/shared/content-reference-token';
import { presentReferenceMarkdown } from '@/shared/content-reference-presentation';
import { referenceFailure } from '@/shared/i18n/reference-outline';

export function ContentReferenceSelection({
  preview,
  busy,
  onInspect,
  presentation,
  parentLevel,
}: {
  preview: ReferencePreview;
  busy: boolean;
  onInspect(target: ReferenceTarget): Promise<void>;
  presentation?: ReferencePresentation;
  parentLevel?: number;
}) {
  const copy = useI18n().messages.referenceOutline;
  const sectionId = useId();
  let markdown = preview.markdown;
  let error = '';
  try {
    markdown = presentReferenceMarkdown(preview, presentation, parentLevel);
  } catch (reason) {
    error = referenceFailure(reason, copy);
  }
  return (
    <>
      <div className="text-sm font-medium">{preview.title}</div>
      <div className="my-1 truncate text-xs text-muted-foreground" title={preview.revisionId}>
        {preview.selector?.kind === 'MEMBERS' ? copy.members : copy.captured} · {preview.revisionId}
      </div>
      {preview.blocks.length > 0 && (
        <Select
          disabled={busy}
          value={preview.target.blockId ? `block:${preview.target.blockId}` : 'document'}
          onValueChange={(value) =>
            void onInspect({
              ...preview.target,
              blockId: value === 'document' ? undefined : value.slice(6),
              section: false,
              scope: value === 'document' ? undefined : 'SELF',
            })
          }
        >
          <SelectTrigger className="my-2 w-full" aria-label={copy.block}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="document">{copy.whole}</SelectItem>
            {preview.blocks.map((block) => (
              <SelectItem key={block.id} value={`block:${block.id}`}>
                {'　'.repeat(Math.min(block.depth - 1, 8))}
                {block.title || copy.unnamed}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {preview.target.blockId &&
        preview.blocks.find((block) => block.id === preview.target.blockId)?.kind === 'heading' && (
          <label htmlFor={sectionId} className="flex items-center gap-2 text-xs">
            <Checkbox
              id={sectionId}
              disabled={busy}
              checked={preview.target.section === true}
              onCheckedChange={(checked) =>
                void onInspect({
                  ...preview.target,
                  section: checked === true,
                  scope: checked === true ? 'SECTION' : 'SELF',
                })
              }
            />
            {copy.section}
          </label>
        )}
      {preview.target.blockId &&
        ['listItem', 'taskItem'].includes(
          preview.blocks.find((block) => block.id === preview.target.blockId)?.kind ?? '',
        ) && (
          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              disabled={busy}
              checked={preview.target.scope === 'SUBTREE'}
              onCheckedChange={(checked) =>
                void onInspect({
                  ...preview.target,
                  section: false,
                  scope: checked === true ? 'SUBTREE' : 'SELF',
                })
              }
            />
            {copy.subtree}
          </label>
        )}
      <div className="my-2 max-h-56 overflow-y-auto break-words text-sm">
        {error ? (
          <span role="alert">{error}</span>
        ) : !markdown ? (
          <span role="status">{copy.emptyBody}</span>
        ) : (
          <ContentReferenceBody
            markdown={markdown}
            media={preview.media}
            source={{
              ...preview.target.source,
              ...(isDocumentSource(preview.target.source) ? { revisionId: preview.revisionId } : {}),
            }}
          />
        )}
      </div>
    </>
  );
}
