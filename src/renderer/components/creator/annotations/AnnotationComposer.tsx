import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import type { AnnotationLabels } from '@/renderer/components/creator/annotations/types';

interface Props {
  labels: AnnotationLabels;
  text: string;
  saving: boolean;
  editing: boolean;
  rangeReady: boolean;
  onTextChange(value: string): void;
  onRedrawRange(): void;
  onCancel(): void;
  onSave(): void;
}

export function AnnotationComposer({
  labels,
  text,
  saving,
  editing,
  rangeReady,
  onTextChange,
  onRedrawRange,
  onCancel,
  onSave,
}: Props) {
  return (
    <div className="pointer-events-auto flex w-full max-w-xl items-center gap-1.5 rounded-lg border border-border bg-overlay p-1.5 text-foreground shadow-overlay">
      <Input
        autoFocus
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) onSave();
          if (event.key === 'Escape') onCancel();
        }}
        placeholder={labels.noteHint}
      />
      {editing && (
        <Button size="sm" variant="ghost" disabled={saving} onClick={onRedrawRange}>
          {labels.redrawRange}
        </Button>
      )}
      <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
        {labels.cancel}
      </Button>
      <Button size="sm" disabled={saving || !rangeReady} onClick={onSave}>
        {saving ? labels.saving : editing ? labels.update : labels.save}
      </Button>
    </div>
  );
}
