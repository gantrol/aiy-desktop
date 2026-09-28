import { CheckIcon, type LucideIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';

interface ViewOption<Value extends string> {
  id: Value;
  label: string;
  icon: LucideIcon;
}

/** The view's SVG is always visible; labels are revealed by opening the menu, not on hover. */
export function WorkbenchViewMenu<Value extends string>({
  value,
  label,
  options,
  onValueChange,
}: {
  value: Value;
  label: string;
  options: readonly ViewOption<Value>[];
  onValueChange(value: Value): void;
}) {
  const selected = options.find((option) => option.id === value) ?? options[0];
  if (!selected) return null;
  const Icon = selected.icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`${label}: ${selected.label}`}
          data-workbench-view={value}
        >
          <Icon className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" aria-label={label}>
        {options.map((option) => (
          <DropdownMenuItem
            key={option.id}
            role="menuitemradio"
            aria-checked={option.id === value}
            onSelect={() => onValueChange(option.id)}
          >
            <option.icon className="size-4" aria-hidden="true" />
            {option.label}
            {option.id === value && <CheckIcon className="ml-auto size-4" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
