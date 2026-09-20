import { useEffect, useMemo, useState } from 'react';
import type { ExtensionDto } from '@/shared/contracts';
import { BlocksIcon, ChevronDownIcon, CpuIcon, LanguagesIcon, PaletteIcon, SearchIcon, XIcon } from 'lucide-react';
import { localizeExtensionManifest } from '@/shared/extension-localization';
import {
  extensionMatchesFilter,
  extensionPermissionRows,
  type ExtensionListFilter,
} from '@/shared/extension-permission-info';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { Input } from '@/renderer/components/ui/input';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import {
  extensionPluginGroup,
  extensionPluginGroupOrder,
  type ExtensionPluginGroup,
} from '@/renderer/features/extensions/extensionPluginGroups';

interface Props {
  extensions: readonly ExtensionDto[];
  selectedId: string;
  onSelect(extensionId: string): void;
}

function PluginIcon({ group }: { group: ExtensionPluginGroup }) {
  if (group === 'models') return <CpuIcon className="size-4 shrink-0" />;
  if (group === 'frontendDesign') return <PaletteIcon className="size-4 shrink-0" />;
  if (group === 'languages') return <LanguagesIcon className="size-4 shrink-0" />;
  return <BlocksIcon className="size-4 shrink-0" />;
}

export function ExtensionPluginList({ extensions, selectedId, onSelect }: Props) {
  const { locale, messages } = useI18n();
  const l = messages.extensions;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ExtensionListFilter>('all');
  const permissionCopy = messages.extensionManager;
  const [openGroups, setOpenGroups] = useState<Record<ExtensionPluginGroup, boolean>>({
    models: true,
    frontendDesign: true,
    features: true,
    languages: true,
  });
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredExtensions = useMemo(() => {
    return extensions.filter((extension) => {
      if (!extensionMatchesFilter(extension, filter)) return false;
      const copy = localizeExtensionManifest(extension.manifest, locale);
      const group = extensionPluginGroup(extension);
      const contributions = Object.values(extension.manifest.contributes).flatMap((items) => items ?? []);
      return [
        copy.displayName,
        copy.description,
        extension.manifest.id,
        l.groups[group],
        l.kinds[extension.manifest.kind],
        l.source[extension.source],
        l.connectionStates[extension.connectionState],
        ...contributions,
        ...extensionPermissionRows(extension).flatMap((row) => [row.key, permissionCopy.names[row.name]]),
      ]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    });
  }, [extensions, l, locale, normalizedQuery, filter, permissionCopy.names]);

  const selectedGroup = extensions.find((extension) => extension.manifest.id === selectedId);
  const groupToReveal = selectedGroup ? extensionPluginGroup(selectedGroup) : null;
  useEffect(() => {
    if (!groupToReveal) return;
    setOpenGroups((current) => (current[groupToReveal] ? current : { ...current, [groupToReveal]: true }));
  }, [selectedId, groupToReveal]);
  const selectedHidden = Boolean(selectedGroup && !filteredExtensions.some((item) => item.manifest.id === selectedId));

  return (
    <div>
      <div role="search" className="sticky top-0 z-10 border-b border-border bg-background p-3">
        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            aria-label={l.search.placeholder}
            placeholder={l.search.placeholder}
            className="pl-9 pr-9 [&::-webkit-search-cancel-button]:appearance-none"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={l.search.clear}
              className="absolute right-0.5 top-1/2 -translate-y-1/2"
              onClick={() => setQuery('')}
            >
              <XIcon className="size-4" />
            </Button>
          )}
        </div>
        <Select value={filter} onValueChange={(value) => setFilter(value as ExtensionListFilter)}>
          <SelectTrigger className="mt-2" aria-label={permissionCopy.listFilter}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['all', 'enabled', 'attention', 'local'] as const).map((value) => (
              <SelectItem key={value} value={value}>
                {permissionCopy.listFilters[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedHidden && (
          <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
            <p>{permissionCopy.currentFiltered}</p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setQuery('');
                setFilter('all');
                if (groupToReveal) setOpenGroups((current) => ({ ...current, [groupToReveal]: true }));
              }}
            >
              {permissionCopy.showCurrent}
            </Button>
          </div>
        )}
      </div>
      <div className="grid gap-2 p-3">
        {extensionPluginGroupOrder.map((group) => {
          const items = filteredExtensions.filter((extension) => extensionPluginGroup(extension) === group);
          if (!items.length) return null;
          const headingId = `extension-group-${group}`;
          const filtering = Boolean(normalizedQuery) || filter !== 'all';
          const isOpen = filtering ? true : openGroups[group];
          return (
            <Collapsible
              key={group}
              open={isOpen}
              onOpenChange={(open) => {
                if (!filtering) setOpenGroups((current) => ({ ...current, [group]: open }));
              }}
              data-extension-group={group}
              className="grid gap-2"
            >
              <h2 id={headingId}>
                <CollapsibleTrigger asChild disabled={filtering}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start px-1 text-foreground-secondary disabled:text-foreground-secondary"
                  >
                    <PluginIcon group={group} />
                    <span className="min-w-0 flex-1 truncate text-left font-semibold">{l.groups[group]}</span>
                    <span className="font-normal text-muted-foreground">{items.length}</span>
                    <ChevronDownIcon
                      className={cn('size-4 text-muted-foreground transition-transform', !isOpen && '-rotate-90')}
                    />
                  </Button>
                </CollapsibleTrigger>
              </h2>
              <CollapsibleContent aria-labelledby={headingId} className="grid gap-2">
                {items.map((extension) => {
                  const copy = localizeExtensionManifest(extension.manifest, locale);
                  return (
                    <button
                      key={extension.manifest.id}
                      type="button"
                      data-extension-id={extension.manifest.id}
                      aria-current={selectedId === extension.manifest.id ? 'true' : undefined}
                      className={cn(
                        'grid gap-2 rounded-lg border border-border p-3 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring',
                        selectedId === extension.manifest.id && 'border-selected-border bg-selected',
                      )}
                      onClick={() => onSelect(extension.manifest.id)}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <strong className="min-w-0 flex-1 truncate text-sm">{copy.displayName}</strong>
                        <Badge variant={extension.connectionState === 'READY' ? 'default' : 'outline'}>
                          {l.connectionStates[extension.connectionState]}
                        </Badge>
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{extension.manifest.version}</span>
                        <span>{l.kinds[extension.manifest.kind]}</span>
                        <span>{l.source[extension.source]}</span>
                        <span className="ml-auto">{extension.enabled ? l.enabled : l.disabled}</span>
                      </span>
                      {extension.permissions.some((permission) => permission.required && !permission.granted) && (
                        <span className="text-xs text-muted-foreground">
                          {permissionCopy.missingCount(
                            extension.permissions.filter((permission) => permission.required && !permission.granted)
                              .length,
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
        {filteredExtensions.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">{l.search.empty}</p>
        )}
      </div>
    </div>
  );
}
