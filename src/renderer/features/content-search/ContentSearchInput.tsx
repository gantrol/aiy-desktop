import type { ComponentProps } from 'react';
import { Input } from '@/renderer/components/ui/input';

/** Both search entry points defer queries until composition has committed. */
export function ContentSearchInput({
  query,
  onQuery,
  onComposing,
  ...props
}: {
  query: string;
  onQuery(value: string): void;
  onComposing(value: boolean): void;
} & Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'onCompositionStart' | 'onCompositionEnd'>) {
  return (
    <Input
      {...props}
      maxLength={200}
      value={query}
      onChange={(event) => onQuery(event.target.value)}
      onCompositionStart={() => onComposing(true)}
      onCompositionEnd={(event) => {
        onQuery(event.currentTarget.value);
        onComposing(false);
      }}
    />
  );
}
