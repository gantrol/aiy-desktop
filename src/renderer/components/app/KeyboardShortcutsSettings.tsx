import { useState } from 'react';
import type { DesktopPlatform } from '@/shared/contracts';
import {
  appShortcutCommands,
  shortcutBindingKey,
  shortcutTokens,
  type ShortcutGroup,
} from '@/renderer/commands/app-shortcuts';
import { shortcutCommandLabel } from '@/renderer/commands/shortcut-presentation';
import { Input } from '@/renderer/components/ui/input';
import { Kbd, KbdGroup } from '@/renderer/components/ui/kbd';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { useI18n } from '@/renderer/i18n/useI18n';

const groups: readonly ShortcutGroup[] = ['general', 'workspace', 'navigation', 'editing', 'comments', 'media'];

export function KeyboardShortcutsSettings() {
  const { messages } = useI18n();
  const labels = messages.app.shortcuts;
  const [platform, setPlatform] = useState<DesktopPlatform>(window.desktopApi.appPlatform);
  const [query, setQuery] = useState('');
  const normalizedQuery = query
    .trim()
    .toLowerCase()
    .replace(/\s*\+\s*/g, ' ');
  const commands = appShortcutCommands
    .map((command) => ({
      ...command,
      label: shortcutCommandLabel(command.id, messages),
      scopeLabel: labels.scopes[command.scope],
    }))
    .filter((command) => {
      const bindingText = (command.bindings[platform] ?? [])
        .flatMap((binding) => shortcutTokens(binding, platform))
        .join(' ');
      return `${command.label} ${command.scopeLabel} ${labels.groups[command.group]} ${bindingText}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  return (
    <div className="grid min-h-0 gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={query}
          className="min-w-40 flex-1"
          aria-label={labels.search}
          placeholder={labels.search}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Segmented
          type="single"
          value={platform}
          aria-label={labels.platform}
          onValueChange={(value) => {
            if (value === 'win32' || value === 'darwin' || value === 'linux') setPlatform(value);
          }}
        >
          <SegmentedItem value="win32">Windows</SegmentedItem>
          <SegmentedItem value="darwin">macOS</SegmentedItem>
          <SegmentedItem value="linux">Linux</SegmentedItem>
        </Segmented>
      </div>
      <div className="max-h-[60vh] overflow-auto border-y">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead>{labels.command}</TableHead>
              <TableHead>{labels.binding}</TableHead>
              <TableHead>{labels.scope}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => {
              const items = commands.filter((command) => command.group === group);
              if (!items.length) return null;
              return [
                <TableRow key={`${group}-heading`} className="bg-surface-sunken hover:bg-surface-sunken">
                  <TableCell colSpan={3} className="h-8 py-1 text-xs font-semibold text-muted-foreground">
                    {labels.groups[group]}
                  </TableCell>
                </TableRow>,
                ...items.map((command) => (
                  <TableRow key={command.id}>
                    <TableCell>{command.label}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {(command.bindings[platform] ?? []).map((binding) => (
                          <KbdGroup key={shortcutBindingKey(binding)}>
                            {shortcutTokens(binding, platform).map((token) => (
                              <Kbd key={token}>{token}</Kbd>
                            ))}
                          </KbdGroup>
                        ))}
                        {!command.bindings[platform]?.length && labels.unassigned}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{command.scopeLabel}</TableCell>
                  </TableRow>
                )),
              ];
            })}
            {!commands.length && (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">
                  {labels.empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
