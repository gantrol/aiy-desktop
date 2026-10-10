import { useEffect, useState } from 'react';
import { ChevronDownIcon, FolderIcon } from 'lucide-react';
import type { ExtensionDto } from '@/shared/contracts';
import { isBuiltinToolExtension } from '@/shared/builtin-tools';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { ExtensionPluginListItem } from '@/renderer/features/extensions/ExtensionPluginListItem';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

export function BuiltinToolsDirectory({
  extensions,
  selectedId,
  filtering,
  onSelect,
}: {
  extensions: readonly ExtensionDto[];
  selectedId: string;
  filtering: boolean;
  onSelect(extensionId: string): void;
}) {
  const { messages, locale } = useI18n();
  const [open, setOpen] = useState(true);
  const tools = extensions.filter(isBuiltinToolExtension);
  const selected = tools.some((extension) => extension.manifest.id === selectedId);
  useEffect(() => {
    if (selected) setOpen(true);
  }, [selectedId, selected]);
  if (!tools.length) return null;
  const expanded = filtering || open;
  return (
    <Collapsible open={expanded} onOpenChange={setOpen} data-extension-subgroup="builtinTools" className="grid gap-0.5">
      <h3>
        <CollapsibleTrigger asChild disabled={filtering}>
          <Button type="button" variant="ghost" size="sm" className="w-full min-w-0 justify-start px-3">
            <FolderIcon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">{messages.extensions.builtinTools}</span>
            <span className="tabular-nums text-muted-foreground">{tools.length.toLocaleString(locale)}</span>
            <ChevronDownIcon
              className={cn(
                'size-4 text-muted-foreground transition-transform motion-reduce:transition-none',
                !expanded && '-rotate-90',
              )}
            />
          </Button>
        </CollapsibleTrigger>
      </h3>
      <CollapsibleContent className="grid gap-0.5 pl-4">
        {tools.map((extension) => (
          <ExtensionPluginListItem
            key={extension.manifest.id}
            extension={extension}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
