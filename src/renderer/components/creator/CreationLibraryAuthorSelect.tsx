import { useId } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Label } from '@/renderer/components/ui/label';
import type { CreationLibraryAuthorOption } from '@/renderer/components/creator/creationLibraryAuthorFilter';

export function CreationLibraryAuthorSelect({
  value = 'ALL',
  options,
  onChange,
  inline = false,
}: {
  value?: string;
  options: readonly CreationLibraryAuthorOption[];
  onChange(value: string): void;
  inline?: boolean;
}) {
  const { messages } = useI18n();
  const labels = messages.creator.results;
  const id = useId();
  const missing = value !== 'ALL' && value !== 'UNASSIGNED' && !options.some((option) => option.value === value);
  return (
    <div className={inline ? 'min-w-32' : 'mt-1 grid gap-1 border-t border-border p-2'}>
      <Label htmlFor={id} className={inline ? 'sr-only' : 'text-xs text-muted-foreground'}>
        {labels.filterAuthor}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="h-8 w-full rounded-sm text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">{labels.filterAllAuthors}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
          <SelectItem value="UNASSIGNED">{labels.filterAuthorUnconfirmed}</SelectItem>
          {missing && (
            <SelectItem value={value} disabled>
              {labels.filterAuthorUnavailable}
            </SelectItem>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
