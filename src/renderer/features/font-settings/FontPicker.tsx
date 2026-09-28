import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/renderer/components/ui/command';
import { useI18n } from '@/renderer/i18n/useI18n';
import { quotedFontFamily, type FontRole } from '@/renderer/features/font-settings/fontPreferences';
import { isRecommendedFont } from '@/renderer/features/font-settings/systemFonts';

export function FontPicker({
  role,
  value,
  families,
  onLoad,
  onChange,
}: {
  role: FontRole;
  value: string | null;
  families: readonly string[];
  onLoad(): void;
  onChange(family: string | null): void;
}) {
  const { messages } = useI18n();
  const labels = messages.app.settings.fonts;
  const [open, setOpen] = useState(false);
  const defaultLabel = role === 'content' ? labels.followInterface : labels.systemDefault;
  const recommended = families.filter((family) => isRecommendedFont(family, role));
  const other = families.filter((family) => !isRecommendedFont(family, role));
  const select = (family: string | null) => {
    onChange(family);
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) onLoad();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={labels.roles[role]}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{value ?? defaultLabel}</span>
          <ChevronsUpDownIcon className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,var(--radix-popover-content-available-width))] p-0">
        <Command label={labels.roles[role]}>
          <CommandInput placeholder={labels.search} aria-label={labels.search} />
          <CommandList ariaLabel={labels.roles[role]}>
            <CommandEmpty>{labels.noMatches}</CommandEmpty>
            <CommandGroup>
              <CommandItem value={defaultLabel} onSelect={() => select(null)}>
                <CheckIcon className={value === null ? 'size-3.5' : 'size-3.5 invisible'} />
                {defaultLabel}
              </CommandItem>
            </CommandGroup>
            {[
              { title: labels.recommended, items: recommended },
              { title: labels.installed, items: other },
            ].map(
              (group) =>
                group.items.length > 0 && (
                  <CommandGroup key={group.title} heading={group.title}>
                    {group.items.map((family) => (
                      <CommandItem key={family} value={family} onSelect={() => select(family)}>
                        <CheckIcon className={value === family ? 'size-3.5' : 'size-3.5 invisible'} />
                        <span
                          className="truncate"
                          style={{ fontFamily: `${quotedFontFamily(family)}, var(--font-ui)` }}
                        >
                          {family}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ),
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
