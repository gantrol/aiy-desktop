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
  onSelectThread(threadId: string): void;
  selectedThreadId: string;
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

export function CodexHistoryNavigation({ onSelectThread, selectedThreadId, state, workspaceNavigation }: Props) {
  const l = useI18n().messages.extensions.codexHistorySearch;
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [recentsOpen, setRecentsOpen] = useState(true);

  const clearScope = () => {
    state.setProjectId('');
    state.setSectionId('');
    state.selectThread(null);
    onSelectThread('');
  };

  return (
    <aside className="hidden h-full w-60 shrink-0 flex-col border-r bg-surface-sunken/20 md:flex">
      <div className="border-b p-2">{workspaceNavigation}</div>
      <ScrollArea className="min-h-0 flex-1">
        <nav className="grid gap-4 p-2" aria-label={l.navigation.label}>
          <div className="grid gap-0.5">
            <NavigationButton
              active={
                state.archive === 'ALL' &&
                !state.projectId &&
                !state.sectionId &&
                !state.selectedThread &&
                !selectedThreadId
              }
              onClick={() => {
                state.setArchive('ALL');
                clearScope();
              }}
            >
              <MessagesSquareIcon className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{l.navigation.allChats}</span>
            </NavigationButton>
            <NavigationButton
              active={
                state.archive === 'ARCHIVED' &&
                !state.projectId &&
                !state.sectionId &&
                !state.selectedThread &&
                !selectedThreadId
              }
              onClick={() => {
                clearScope();
                state.setArchive('ARCHIVED');
              }}
            >
              <ArchiveIcon className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{l.navigation.archived}</span>
            </NavigationButton>
          </div>

          {state.filterOptions.sections.map((section) => {
            const items = [
              ...section.threads.map((thread) => ({
                kind: 'thread' as const,
                id: thread.threadId,
                position: thread.sectionPosition,
                thread,
              })),
              ...section.projects.map((project) => ({
                kind: 'project' as const,
                id: project.projectId,
                position: project.sectionPosition,
                project,
              })),
            ].sort(
              (left, right) =>
                (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER) ||
                left.id.localeCompare(right.id),
            );
            return (
              <section key={section.sectionId} className="grid gap-0.5">
                <NavigationButton
                  active={state.sectionId === section.sectionId && !state.selectedThread && !selectedThreadId}
                  className="font-semibold text-foreground"
                  onClick={() => {
                    state.setArchive('ALL');
                    state.setSectionId(section.sectionId);
                    onSelectThread('');
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{section.name}</span>
                  <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 text-2xs">
                    {section.threadCount + section.projectCount}
                  </Badge>
                </NavigationButton>
                {items.map((item) =>
                  item.kind === 'thread' ? (
                    <NavigationButton
                      key={`thread:${item.thread.threadId}`}
                      active={selectedThreadId === item.thread.threadId}
                      className="pl-5"
                      onClick={() => {
                        state.setArchive(item.thread.archived ? 'ARCHIVED' : 'ALL');
                        state.setSectionId(section.sectionId);
                        onSelectThread(item.thread.threadId);
                      }}
                    >
                      <MessageSquareIcon className="size-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{item.thread.title}</span>
                    </NavigationButton>
                  ) : (
                    <NavigationButton
                      key={`project:${item.project.projectId}`}
                      active={state.projectId === item.project.projectId && !selectedThreadId}
                      className="pl-5"
                      onClick={() => {
                        state.setArchive('ALL');
                        state.setProjectId(item.project.projectId);
                        onSelectThread('');
                      }}
                    >
                      <FolderIcon className="size-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate" title={item.project.workspace || item.project.name}>
                        {item.project.name}
                      </span>
                      <span className="tabular-nums text-2xs text-muted-foreground">{item.project.threadCount}</span>
                    </NavigationButton>
                  ),
                )}
              </section>
            );
          })}

          <Collapsible open={projectsOpen} onOpenChange={setProjectsOpen}>
            <CollapsibleTrigger className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs font-semibold outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronRightIcon className={cn('size-3.5 transition-transform', projectsOpen && 'rotate-90')} />
              <span className="min-w-0 flex-1 text-left">{l.navigation.projects}</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="grid gap-0.5 pt-0.5">
              {state.filterOptions.projects.map((project) => (
                <NavigationButton
                  key={project.projectId}
                  active={state.projectId === project.projectId && !state.selectedThread && !selectedThreadId}
                  className="pl-5"
                  onClick={() => {
                    state.setArchive('ALL');
                    state.setProjectId(project.projectId);
                    onSelectThread('');
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
                  active={selectedThreadId === thread.threadId}
                  className="pl-5"
                  onClick={() => {
                    state.setArchive('ALL');
                    clearScope();
                    onSelectThread(thread.threadId);
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
