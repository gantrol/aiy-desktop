import { useId, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Textarea } from '@/renderer/components/ui/textarea';
import { Label } from '@/renderer/components/ui/label';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { ContentMath } from '@/renderer/features/content-editor/ContentMath';
import { useI18n } from '@/renderer/i18n/useI18n';
import { mathSourceLimit } from '@/shared/content-math';

export function ContentMathForm({
  source,
  display,
  onApply,
  onRemove,
  onCancel,
}: {
  source: string;
  display: boolean;
  onApply(latex: string, block: boolean): boolean;
  onRemove?: () => boolean;
  onCancel(): void;
}) {
  const copy = useI18n().messages.contentEditor.math;
  const id = useId();
  const [latex, setLatex] = useState(source);
  const [block, setBlock] = useState(display);
  const [failed, setFailed] = useState(false);
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setFailed(!onApply(latex.trim(), block));
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{copy.source}</Label>
        <Segmented
          type="single"
          value={block ? 'block' : 'inline'}
          onValueChange={(value) => {
            if (value) setBlock(value === 'block');
          }}
        >
          <SegmentedItem value="inline">{copy.inline}</SegmentedItem>
          <SegmentedItem value="block">{copy.block}</SegmentedItem>
        </Segmented>
      </div>
      <Textarea
        id={id}
        value={latex}
        onChange={(event) => setLatex(event.target.value)}
        maxLength={mathSourceLimit}
        rows={4}
        spellCheck={false}
        className="resize-y font-mono text-sm"
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && latex.trim()) {
            event.preventDefault();
            setFailed(!onApply(latex.trim(), block));
          }
        }}
      />
      <div role="region" aria-label={copy.preview} className="min-h-12 max-w-full overflow-x-auto">
        {latex && <ContentMath source={latex} display={block} />}
      </div>
      {failed && (
        <span role="alert" className="text-sm text-destructive">
          {copy.targetChanged}
        </span>
      )}
      <div className="flex justify-end gap-2">
        {onRemove && (
          <Button type="button" variant="ghost" size="sm" className="mr-auto" onClick={() => setFailed(!onRemove())}>
            {copy.remove}
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {copy.cancel}
        </Button>
        <Button type="submit" size="sm" disabled={!latex.trim() || latex.length > mathSourceLimit}>
          {copy.apply}
        </Button>
      </div>
    </form>
  );
}
