import type { ComponentProps, ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
export function PetalIconButton({ label, className, ...props }: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      className={cn('size-7 shrink-0 rounded-sm p-1 [&_svg]:size-4', className)}
      {...props}
    />
  );
}
export function PetalPanel({
  title,
  onBack,
  actions,
  children,
}: {
  title: string;
  onBack: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { messages } = useI18n();
  return (
    <section className="flex h-full min-h-0 flex-col bg-background p-3 text-foreground">
      <header className="mb-2 flex shrink-0 items-center gap-2">
        <PetalIconButton label={messages.desktopPetals.flower.back} onClick={onBack}>
          <ArrowLeft />
        </PetalIconButton>
        <strong className="min-w-0 flex-1 truncate text-xs [-webkit-app-region:drag]">{title}</strong>
        {actions}
      </header>
      {children}
    </section>
  );
}
export function PetalSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={label} className="h-8 w-full text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-52 shadow-none">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
