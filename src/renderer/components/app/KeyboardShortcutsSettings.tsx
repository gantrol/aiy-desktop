import { useMemo, useState } from 'react';
import type { DesktopPlatform, Locale } from '@/shared/contracts';
import {
  appShortcutCommands,
  shortcutTokens,
  type ShortcutBinding,
  type ShortcutGroup,
} from '@/renderer/commands/app-shortcuts';
import { Input } from '@/renderer/components/ui/input';
import { Kbd, KbdGroup } from '@/renderer/components/ui/kbd';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';

const groups: readonly ShortcutGroup[] = ['general', 'navigation', 'editing', 'comments', 'media'];

function bindingKey(binding: ShortcutBinding) {
  return [Boolean(binding.ctrl), Boolean(binding.meta), Boolean(binding.alt), Boolean(binding.shift), binding.key]
    .map((value) => String(value).toLocaleLowerCase())
    .join(':');
}

export function KeyboardShortcutsSettings({ locale }: { locale: Locale }) {
  const zh = locale === 'zh';
  const [platform, setPlatform] = useState<DesktopPlatform>(window.desktopApi.appPlatform);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const conflicts = useMemo(() => {
    const owners = new Map<string, string[]>();
    for (const command of appShortcutCommands) {
      for (const binding of command.bindings[platform] ?? []) {
        const key = bindingKey(binding);
        owners.set(key, [...(owners.get(key) ?? []), command.id]);
      }
    }
    return new Set([...owners.values()].filter((ids) => ids.length > 1).flat());
  }, [platform]);
  const commands = appShortcutCommands.filter((command) => {
    if (!normalizedQuery) return true;
    const bindingText = (command.bindings[platform] ?? [])
      .flatMap((binding) => shortcutTokens(binding, platform))
      .join(' ')
      .toLocaleLowerCase();
    return `${command.label[locale]} ${command.scope[locale]} ${bindingText}`
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });
  const groupLabels: Record<ShortcutGroup, string> = zh
    ? { general: '通用', navigation: '导航', editing: '编辑', comments: '评论', media: '媒体' }
    : { general: 'General', navigation: 'Navigation', editing: 'Editing', comments: 'Comments', media: 'Media' };

  return (
    <div className="grid min-h-0 gap-3">
      <div className="flex items-center gap-3">
        <Input
          value={query}
          className="min-w-0 flex-1"
          aria-label={zh ? '搜索快捷键' : 'Search shortcuts'}
          placeholder={zh ? '搜索快捷键' : 'Search shortcuts'}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Segmented
          type="single"
          value={platform}
          aria-label={zh ? '操作系统' : 'Operating system'}
          onValueChange={(value) => value && setPlatform(value as DesktopPlatform)}
        >
          <SegmentedItem value="win32">Windows</SegmentedItem>
          <SegmentedItem value="darwin">macOS</SegmentedItem>
          <SegmentedItem value="linux">Linux</SegmentedItem>
        </Segmented>
      </div>
      <div className="max-h-[60vh] overflow-y-auto border-y">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead>{zh ? '操作' : 'Command'}</TableHead>
              <TableHead>{zh ? '快捷键' : 'Shortcut'}</TableHead>
              <TableHead>{zh ? '范围' : 'Scope'}</TableHead>
              <TableHead>{zh ? '状态' : 'Status'}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => {
              const items = commands.filter((command) => command.group === group);
              if (!items.length) return null;
              return [
                <TableRow key={`${group}-heading`} className="bg-surface-sunken hover:bg-surface-sunken">
                  <TableCell colSpan={4} className="h-8 py-1 text-xs font-semibold text-muted-foreground">
                    {groupLabels[group]}
                  </TableCell>
                </TableRow>,
                ...items.map((command) => {
                  const bindings = command.bindings[platform] ?? [];
                  return (
                    <TableRow key={command.id}>
                      <TableCell>{command.label[locale]}</TableCell>
                      <TableCell>
                        {bindings.length ? (
                          <div className="flex flex-wrap gap-1.5">
                            {bindings.map((binding) => (
                              <KbdGroup key={bindingKey(binding)}>
                                {shortcutTokens(binding, platform).map((token) => (
                                  <Kbd key={token}>{token}</Kbd>
                                ))}
                              </KbdGroup>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">{zh ? '未设置' : 'Unassigned'}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{command.scope[locale]}</TableCell>
                      <TableCell className={conflicts.has(command.id) ? 'text-destructive' : 'text-muted-foreground'}>
                        {conflicts.has(command.id) ? (zh ? '冲突' : 'Conflict') : '—'}
                      </TableCell>
                    </TableRow>
                  );
                }),
              ];
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
