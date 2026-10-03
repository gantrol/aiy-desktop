import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';

export function AuthorPickerPagination({
  offset,
  nextOffset,
  disabled,
  onChange,
}: {
  offset: number;
  nextOffset: number | null;
  disabled: boolean;
  onChange(offset: number): void;
}) {
  const copy = useI18n().messages.me;
  if (offset === 0 && nextOffset === null) return null;
  return (
    <div className="flex justify-between">
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled || offset === 0}
        onClick={() => onChange(Math.max(0, offset - 30))}
      >
        {copy.previous}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled || nextOffset === null || nextOffset > 10000}
        onClick={() => nextOffset !== null && onChange(nextOffset)}
      >
        {copy.more}
      </Button>
    </div>
  );
}
