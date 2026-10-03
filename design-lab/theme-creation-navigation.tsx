import { useState } from 'react';
import { ChevronDownIcon, PanelRightCloseIcon, PlusIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { DropdownMenuItem } from '@/renderer/components/ui/dropdown-menu';
import { cn } from '@/renderer/lib/utils';
import { IconButton, KindSelect, Menu, kindIcons } from './theme-creation-ui';
import { OutputConnections } from './theme-creation-relations';
import { findSource, kinds } from './theme-creation-types';
import type { ThemeModel } from './theme-creation-model';

export function OutputNavigation({
  model,
  close,
  showInputs,
  onNavigate,
}: {
  model: ThemeModel;
  close(): void;
  showInputs(): void;
  onNavigate?(): void;
}) {
  const [query, setQuery] = useState('');
  const { copy, topic } = model;
  const filtered = topic.outputs.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b px-3">
        <h2 className="mr-auto text-sm font-semibold">
          {copy.outputs} <span className="ml-1 font-normal text-muted-foreground">{topic.outputs.length}</span>
        </h2>
        <IconButton label={copy.collapseOutputs} onClick={close}>
          <PanelRightCloseIcon className="size-4" />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <div className="space-y-2 p-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.allOutputs}
            aria-label={copy.allOutputs}
            className="h-8"
          />
          <nav aria-label={copy.outputs} className="space-y-1">
            {filtered.map((item) => {
              const Icon = kindIcons[item.kind];
              const changed = item.sources.some((source) => {
                const current = findSource(model.data.topics, source);
                return current && current.output.revision !== source.outputRevision;
              });
              return (
                <Button
                  key={item.id}
                  variant="ghost"
                  size="sm"
                  aria-current={item.id === topic.activeId && !topic.viewingTask ? 'page' : undefined}
                  className={cn(
                    'h-auto w-full justify-start rounded-sm py-2.5 text-left',
                    item.id === topic.activeId && !topic.viewingTask && 'bg-surface-sunken font-semibold',
                  )}
                  onClick={() => {
                    model.selectOutput(item.id);
                    onNavigate?.();
                  }}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {changed && (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-warning"
                      title={copy.sourceChanged}
                      aria-label={copy.sourceChanged}
                    />
                  )}
                </Button>
              );
            })}
            {!filtered.length && <div className="px-2 py-3 text-xs text-muted-foreground">{copy.noMatches}</div>}
          </nav>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 justify-start"
              onClick={() => {
                model.newOutput();
                onNavigate?.();
              }}
            >
              <PlusIcon className="size-4" />
              {copy.newOutput}
            </Button>
            <Menu label={copy.newOutput} icon={<ChevronDownIcon className="size-3" />} compact>
              {kinds.map((kind) => (
                <DropdownMenuItem
                  key={kind}
                  onSelect={() => {
                    model.newOutput(kind);
                    onNavigate?.();
                  }}
                >
                  {copy[kind]}
                </DropdownMenuItem>
              ))}
            </Menu>
          </div>
        </div>
        {!model.task && (
          <OutputConnections key={model.output.id} model={model} showInputs={showInputs} onNavigate={onNavigate} />
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t p-3">
          <span className="mr-auto text-xs text-muted-foreground">{copy.defaultOutput}</span>
          <KindSelect value={topic.defaultKind} onChange={model.changeDefault} copy={copy} label={copy.defaultOutput} />
          <Menu label={copy.more} icon={<ChevronDownIcon className="size-3" />} compact>
            <DropdownMenuItem onSelect={model.setFutureDefault}>{copy.setFutureDefault}</DropdownMenuItem>
          </Menu>
        </div>
      </div>
    </>
  );
}
