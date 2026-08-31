import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { ArticleEditorOutlineTree } from '@/renderer/components/creator/article-editor/ArticleEditorOutlineTree';
import {
  buildArticleEditorOutlineNodes,
  visibleArticleEditorOutlineNodes,
  type ArticleEditorOutlineDepthLimit,
  type ArticleEditorOutlineNode,
  type VisibleArticleEditorOutlineNode,
} from '@/renderer/components/creator/article-editor/articleEditorOutlineModel';
import {
  useArticleEditorOutlineNavigation,
  type ArticleEditorOutlineCursorRequest,
} from '@/renderer/components/creator/article-editor/useArticleEditorOutlineNavigation';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { Input } from '@/renderer/components/ui/input';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import type { VideoDocumentArticleHeading } from '@/renderer/features/video-documents/useVideoDocumentArticleOutline';

interface Props {
  cursorRequest: ArticleEditorOutlineCursorRequest;
  items: readonly VideoDocumentArticleHeading[];
  scrollRootRef: RefObject<HTMLDivElement | null>;
  depthLimit: ArticleEditorOutlineDepthLimit;
  followCursor: boolean;
  followCursorAvailable?: boolean;
  zh: boolean;
  onDepthLimitChange(limit: ArticleEditorOutlineDepthLimit): void;
  onFollowCursorChange(value: boolean): void;
  onHeadingNavigate?(sourceIndex: number): void;
  onTopNavigate?(): void;
}

interface OutlineLabels {
  label: string;
  search: string;
  clearSearch: string;
  returnTop: string;
  options: string;
  followCursor: string;
  expandAll: string;
  collapseAll: string;
  mainHeadings: string;
  mainAndChildren: string;
  allLevels: string;
}

function outlineLabels(zh: boolean): OutlineLabels {
  return zh
    ? {
        label: '目录',
        search: '搜索标题',
        clearSearch: '清除搜索',
        returnTop: '返回文章顶部',
        options: '目录选项',
        followCursor: '跟随光标',
        expandAll: '全部展开',
        collapseAll: '全部收起',
        mainHeadings: '仅主标题',
        mainAndChildren: '主标题和子标题',
        allLevels: '全部层级',
      }
    : {
        label: 'Outline',
        search: 'Search headings',
        clearSearch: 'Clear search',
        returnTop: 'Return to article top',
        options: 'Outline options',
        followCursor: 'Follow cursor',
        expandAll: 'Expand all',
        collapseAll: 'Collapse all',
        mainHeadings: 'Main headings only',
        mainAndChildren: 'Main headings and children',
        allLevels: 'All levels',
      };
}

function SelectionMark({ selected }: { selected: boolean }) {
  return <DropdownMenuIcon>{selected && <CheckIcon className="text-selected-foreground" />}</DropdownMenuIcon>;
}

function OutlineOptions({
  depthLimit,
  followCursor,
  followCursorAvailable,
  labels,
  onCollapseAll,
  onDepthLimitChange,
  onExpandAll,
  onFollowCursorChange,
}: {
  depthLimit: ArticleEditorOutlineDepthLimit;
  followCursor: boolean;
  followCursorAvailable: boolean;
  labels: OutlineLabels;
  onCollapseAll(): void;
  onDepthLimitChange(limit: ArticleEditorOutlineDepthLimit): void;
  onExpandAll(): void;
  onFollowCursorChange(value: boolean): void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" title={labels.options} aria-label={labels.options}>
          <EllipsisIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {followCursorAvailable && (
          <>
            <DropdownMenuItem onSelect={() => onFollowCursorChange(!followCursor)}>
              <SelectionMark selected={followCursor} />
              {labels.followCursor}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={onExpandAll}>
          <DropdownMenuIcon>
            <ChevronDownIcon />
          </DropdownMenuIcon>
          {labels.expandAll}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCollapseAll}>
          <DropdownMenuIcon>
            <ChevronRightIcon />
          </DropdownMenuIcon>
          {labels.collapseAll}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onDepthLimitChange(1)}>
          <SelectionMark selected={depthLimit === 1} />
          {labels.mainHeadings}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onDepthLimitChange(2)}>
          <SelectionMark selected={depthLimit === 2} />
          {labels.mainAndChildren}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onDepthLimitChange(6)}>
          <SelectionMark selected={depthLimit === 6} />
          {labels.allLevels}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OutlinePane({
  activeId,
  collapsedIds,
  depthLimit,
  followCursor,
  followCursorAvailable,
  labels,
  nodes,
  query,
  onCollapseAll,
  onCollapsedChange,
  onDepthLimitChange,
  onExpandAll,
  onFollowCursorChange,
  onQueryChange,
  onReturnTop,
  onSelect,
}: {
  activeId: string | null;
  collapsedIds: ReadonlySet<string>;
  depthLimit: ArticleEditorOutlineDepthLimit;
  followCursor: boolean;
  followCursorAvailable: boolean;
  labels: OutlineLabels;
  nodes: readonly VisibleArticleEditorOutlineNode[];
  query: string;
  onCollapseAll(): void;
  onCollapsedChange(id: string, collapsed: boolean): void;
  onDepthLimitChange(limit: ArticleEditorOutlineDepthLimit): void;
  onExpandAll(): void;
  onFollowCursorChange(value: boolean): void;
  onQueryChange(query: string): void;
  onReturnTop(): void;
  onSelect(item: VideoDocumentArticleHeading, sourceIndex: number): void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-end gap-1 border-b px-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={labels.returnTop}
          aria-label={labels.returnTop}
          onClick={onReturnTop}
        >
          <ArrowUpIcon className="size-4" />
        </Button>
        <OutlineOptions
          depthLimit={depthLimit}
          followCursor={followCursor}
          followCursorAvailable={followCursorAvailable}
          labels={labels}
          onCollapseAll={onCollapseAll}
          onDepthLimitChange={onDepthLimitChange}
          onExpandAll={onExpandAll}
          onFollowCursorChange={onFollowCursorChange}
        />
      </div>
      <div className="shrink-0 border-b p-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            type="search"
            autoComplete="off"
            aria-label={labels.search}
            placeholder={labels.search}
            className="h-8 pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden"
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || !query) return;
              event.preventDefault();
              onQueryChange('');
            }}
          />
          {query && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute right-0.5 top-0.5 size-7"
              title={labels.clearSearch}
              aria-label={labels.clearSearch}
              onClick={() => onQueryChange('')}
            >
              <XIcon className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ArticleEditorOutlineTree
          activeId={activeId}
          ariaLabel={labels.label}
          collapsedIds={collapsedIds}
          nodes={nodes}
          query={query}
          onCollapsedChange={onCollapsedChange}
          onSelect={onSelect}
        />
      </ScrollArea>
    </div>
  );
}

export function ArticleEditorOutline({
  cursorRequest,
  items,
  scrollRootRef,
  depthLimit,
  followCursor,
  followCursorAvailable = true,
  zh,
  onDepthLimitChange,
  onFollowCursorChange,
  onHeadingNavigate,
  onTopNavigate,
}: Props) {
  const labels = useMemo(() => outlineLabels(zh), [zh]);
  const [query, setQuery] = useState('');
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set());
  const nodes = useMemo(() => buildArticleEditorOutlineNodes(items), [items]);
  const visibleNodes = useMemo(
    () =>
      visibleArticleEditorOutlineNodes(nodes, {
        collapsedIds,
        depthLimit,
        query,
      }),
    [collapsedIds, depthLimit, nodes, query],
  );
  const { activeId, selectItem, selectTop } = useArticleEditorOutlineNavigation({
    cursorRequest,
    followCursor,
    items,
    scrollRootRef,
  });

  useEffect(() => {
    const activeNode = nodes.find((node) => node.item.id === activeId);
    if (!activeNode) return;
    setCollapsedIds((current) => {
      if (!activeNode.ancestorIds.some((id) => current.has(id))) return current;
      const next = new Set(current);
      activeNode.ancestorIds.forEach((id) => next.delete(id));
      return next;
    });
  }, [activeId, nodes]);

  if (items.length === 0) return null;

  function setNodeCollapsed(id: string, collapsed: boolean) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (collapsed) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function collapseAll(outlineNodes: readonly ArticleEditorOutlineNode[]) {
    setCollapsedIds(new Set(outlineNodes.filter((node) => node.hasChildren).map((node) => node.item.id)));
  }

  return (
    <OutlinePane
      activeId={activeId}
      collapsedIds={collapsedIds}
      depthLimit={depthLimit}
      followCursor={followCursor}
      followCursorAvailable={followCursorAvailable}
      labels={labels}
      nodes={visibleNodes}
      query={query}
      onCollapseAll={() => collapseAll(nodes)}
      onCollapsedChange={setNodeCollapsed}
      onDepthLimitChange={onDepthLimitChange}
      onExpandAll={() => setCollapsedIds(new Set())}
      onFollowCursorChange={onFollowCursorChange}
      onQueryChange={setQuery}
      onReturnTop={() => {
        onTopNavigate?.();
        selectTop();
      }}
      onSelect={(item, sourceIndex) => {
        onHeadingNavigate?.(sourceIndex);
        selectItem(item, sourceIndex);
      }}
    />
  );
}
