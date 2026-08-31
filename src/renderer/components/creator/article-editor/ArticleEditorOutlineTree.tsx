import { ChevronRightIcon } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { VisibleArticleEditorOutlineNode } from '@/renderer/components/creator/article-editor/articleEditorOutlineModel';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import type { VideoDocumentArticleHeading } from '@/renderer/features/video-documents/useVideoDocumentArticleOutline';
import { cn } from '@/renderer/lib/utils';

interface Props {
  activeId: string | null;
  ariaLabel: string;
  collapsedIds: ReadonlySet<string>;
  nodes: readonly VisibleArticleEditorOutlineNode[];
  query: string;
  onCollapsedChange(id: string, collapsed: boolean): void;
  onSelect(item: VideoDocumentArticleHeading, sourceIndex: number): void;
}

function HighlightedTitle({ query, title }: { query: string; title: string }) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchIndex = normalizedQuery ? title.toLocaleLowerCase().indexOf(normalizedQuery) : -1;
  if (matchIndex < 0) return title;
  const matchEnd = matchIndex + normalizedQuery.length;
  return (
    <>
      {title.slice(0, matchIndex)}
      <mark className="rounded-sm bg-selected px-0 text-selected-foreground">{title.slice(matchIndex, matchEnd)}</mark>
      {title.slice(matchEnd)}
    </>
  );
}

export function ArticleEditorOutlineTree({
  activeId,
  ariaLabel,
  collapsedIds,
  nodes,
  query,
  onCollapsedChange,
  onSelect,
}: Props) {
  const treeRef = useRef<HTMLDivElement>(null);
  const [focusId, setFocusId] = useState<string | null>(nodes[0]?.item.id ?? null);
  const searching = Boolean(query.trim());

  useEffect(() => {
    if (activeId && nodes.some((node) => node.item.id === activeId)) {
      setFocusId(activeId);
      return;
    }
    setFocusId((current) => (nodes.some((node) => node.item.id === current) ? current : (nodes[0]?.item.id ?? null)));
  }, [activeId, nodes]);

  useEffect(() => {
    if (!activeId) return;
    const activeElement = Array.from(
      treeRef.current?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') ?? [],
    ).find((element) => element.dataset.outlineId === activeId);
    activeElement?.scrollIntoView({ block: 'nearest' });
  }, [activeId, nodes]);

  function focusNode(index: number) {
    const node = nodes[index];
    if (!node) return;
    setFocusId(node.item.id);
    treeRef.current?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]').item(index).focus();
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    node: VisibleArticleEditorOutlineNode,
    index: number,
  ) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusNode(Math.min(nodes.length - 1, index + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusNode(Math.max(0, index - 1));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusNode(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusNode(nodes.length - 1);
      return;
    }
    if (event.key === 'ArrowRight' && node.hasVisibleChildren) {
      event.preventDefault();
      if (!searching && collapsedIds.has(node.item.id)) {
        onCollapsedChange(node.item.id, false);
        return;
      }
      const childIndex = nodes.findIndex((candidate) => candidate.parentId === node.item.id);
      if (childIndex >= 0) focusNode(childIndex);
      return;
    }
    if (event.key !== 'ArrowLeft') return;
    const expanded = node.hasVisibleChildren && !searching && !collapsedIds.has(node.item.id);
    if (expanded) {
      event.preventDefault();
      onCollapsedChange(node.item.id, true);
      return;
    }
    const parentIndex = nodes.findIndex((candidate) => candidate.item.id === node.parentId);
    if (parentIndex >= 0) {
      event.preventDefault();
      focusNode(parentIndex);
    }
  }

  function handleClick(event: MouseEvent<HTMLButtonElement>, node: VisibleArticleEditorOutlineNode) {
    if (
      node.hasVisibleChildren &&
      !searching &&
      event.target instanceof Element &&
      event.target.closest('[data-outline-toggle]')
    ) {
      onCollapsedChange(node.item.id, !collapsedIds.has(node.item.id));
      return;
    }
    onSelect(node.item, node.sourceIndex);
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div ref={treeRef} role="tree" aria-label={ariaLabel} className="py-1.5">
        {nodes.map((node, index) => {
          const active = node.item.id === activeId;
          const collapsed = !searching && collapsedIds.has(node.item.id);
          return (
            <Tooltip key={node.item.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="treeitem"
                  data-outline-id={node.item.id}
                  aria-current={active ? 'location' : undefined}
                  aria-expanded={node.hasVisibleChildren ? !collapsed : undefined}
                  aria-level={node.depth + 1}
                  tabIndex={node.item.id === focusId ? 0 : -1}
                  className={cn(
                    'flex min-h-8 w-full items-start border-l-2 border-l-transparent py-1.5 pr-3 text-left text-sm leading-5 text-foreground outline-none transition-colors duration-fast hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    node.depth > 0 && 'text-muted-foreground',
                    active && 'border-l-selected-foreground bg-selected/55 font-medium text-selected-foreground',
                  )}
                  style={{ paddingLeft: 8 + node.depth * 14 }}
                  onClick={(event) => handleClick(event, node)}
                  onFocus={() => setFocusId(node.item.id)}
                  onKeyDown={(event) => handleKeyDown(event, node, index)}
                >
                  <span
                    aria-hidden="true"
                    data-outline-toggle={node.hasVisibleChildren ? '' : undefined}
                    className={cn(
                      'mr-1 mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm',
                      node.hasVisibleChildren && 'hover:bg-hover-strong',
                    )}
                  >
                    {node.hasVisibleChildren && (
                      <ChevronRightIcon className={cn('size-3.5 transition-transform', !collapsed && 'rotate-90')} />
                    )}
                  </span>
                  <span className="line-clamp-2 min-w-0">
                    <HighlightedTitle query={query} title={node.item.title} />
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-72">
                {node.item.title}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
