import { useState, type ReactNode } from 'react';
import { ArchiveIcon, ChevronRightIcon, FolderIcon, MessageSquareIcon, MessagesSquareIcon } from 'lucide-react';
import { Badge } from '@/renderer/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import type { useCodexHistorySearch } from '@/renderer/features/extensions/useCodexHistorySearch';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

type HistorySearchState = ReturnType<typeof useCodexHistorySearch>;

interface Props {
  state: HistorySearchState;
  workspaceNavigation: ReactNode;
}

function NavigationButton({
  active,
  children,
  className,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  className?: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      data-current={active || undefined}
      className={cn(
        'flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[current]:bg-selected data-[current]:font-medium data-[current]:text-selected-foreground',
        className,
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function CodexHistoryNavigation({ state, workspaceNavigation }: Props) {
  const l = useI18n().messages.extensions.codexHistorySearch;
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [recentsOpen, setRecentsOpen] = useState(true);

  const clearScope = () => {
    state.setProjectId('');
    state.setSectionId('');
    state.selectThread(null);
  };

  return (
    <aside className="hidden h-full w-60 shrink-0 flex-col border-r bg-surface-sunken/20 md:flex">
      <div className="border-b p-2">{workspaceNavigation}</div>
      <ScrollArea className="min-h-0 flex-1">
        <nav className="grid gap-4 p-2" aria-label={l.navigation.label}>
          <div className="grid gap-0.5">
            <NavigationButton
              active={state.archive === 'ALL' && !state.projectId && !state.sectionId && !state.selectedThread}
              onClick={() => {
                state.setArchive('ALL');
                clearScope();
              }}
            >
              <MessagesSquareIcon className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{l.navigation.allChats}</span>
            </NavigationButton>
            <NavigationButton
              active={state.archive === 'ARCHIVED' && !state.projectId && !state.sectionId && !state.selectedThread}
              onClick={() => {
                clearScope();
                state.setArchive('ARCHIVED');
              }}
            >
              <ArchiveIcon className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{l.navigation.archived}</span>
            </NavigationButton>
          </div>

          {state.filterOptions.sections.map((section) => (
            <section key={section.sectionId} className="grid gap-0.5">
              <NavigationButton
                active={state.sectionId === section.sectionId && !state.selectedThread}
                className="font-semibold text-foreground"
                onClick={() => {
                  state.setArchive('ALL');
                  state.setSectionId(section.sectionId);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{section.name}</span>
                <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 text-2xs">
                  {section.threadCount}
                </Badge>
              </NavigationButton>
              {section.threads.map((thread) => (
                <NavigationButton
                  key={thread.threadId}
                  active={state.selectedThread?.threadId === thread.threadId}
                  className="pl-5"
                  onClick={() => {
                    state.setArchive(thread.archived ? 'ARCHIVED' : 'ALL');
                    state.setSectionId(section.sectionId);
                    state.selectThread(thread);
                  }}
                >
                  <MessageSquareIcon className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                </NavigationButton>
              ))}
            </section>
          ))}

          <Collapsible open={projectsOpen} onOpenChange={setProjectsOpen}>
            <CollapsibleTrigger className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs font-semibold outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronRightIcon className={cn('size-3.5 transition-transform', projectsOpen && 'rotate-90')} />
              <span className="min-w-0 flex-1 text-left">{l.navigation.projects}</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="grid gap-0.5 pt-0.5">
              {state.filterOptions.projects.map((project) => (
                <NavigationButton
                  key={project.projectId}
                  active={state.projectId === project.projectId && !state.selectedThread}
                  className="pl-5"
                  onClick={() => {
                    state.setArchive('ALL');
                    state.setProjectId(project.projectId);
                  }}
                >
                  <FolderIcon className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate" title={project.workspace || project.name}>
                    {project.name}
                  </span>
                  <span className="tabular-nums text-2xs text-muted-foreground">{project.threadCount}</span>
                </NavigationButton>
              ))}
            </CollapsibleContent>
          </Collapsible>

          <Collapsible open={recentsOpen} onOpenChange={setRecentsOpen}>
            <CollapsibleTrigger className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs font-semibold outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronRightIcon className={cn('size-3.5 transition-transform', recentsOpen && 'rotate-90')} />
              <span className="min-w-0 flex-1 text-left">{l.navigation.recents}</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="grid gap-0.5 pt-0.5">
              {state.filterOptions.recentThreads.map((thread) => (
                <NavigationButton
                  key={thread.threadId}
                  active={state.selectedThread?.threadId === thread.threadId}
                  className="pl-5"
                  onClick={() => {
                    state.setArchive('ALL');
                    clearScope();
                    state.selectThread(thread);
                  }}
                >
                  <MessageSquareIcon className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                </NavigationButton>
              ))}
            </CollapsibleContent>
          </Collapsible>
        </nav>
      </ScrollArea>
    </aside>
  );
}
