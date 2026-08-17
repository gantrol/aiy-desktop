import { useEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import { cn } from '@/renderer/lib/utils';

export interface VideoDocumentOutlineItem {
  id: string;
  title: string;
  level: number;
}

interface Props {
  items: readonly VideoDocumentOutlineItem[];
  activeId?: string | null;
  ariaLabel: string;
  onSelect(item: VideoDocumentOutlineItem): void;
}

interface OutlineGroup {
  id: string;
  rootLevel: number;
  items: VideoDocumentOutlineItem[];
}

function groupOutlineItems(items: readonly VideoDocumentOutlineItem[]): OutlineGroup[] {
  if (items.length === 0) return [];
  const rootLevel = Math.min(...items.map((item) => item.level));
  const groups: OutlineGroup[] = [];

  for (const item of items) {
    if (groups.length === 0 || item.level === rootLevel) {
      groups.push({ id: item.id, rootLevel: item.level, items: [item] });
      continue;
    }
    groups.at(-1)!.items.push(item);
  }

  return groups;
}

function itemDepth(item: VideoDocumentOutlineItem, group: OutlineGroup) {
  return Math.min(2, Math.max(0, item.level - group.rootLevel));
}

function markWidth(depth: number) {
  if (depth === 0) return 27;
  if (depth === 1) return 19;
  return 12;
}

export function VideoDocumentOutlineRail({ items, activeId, ariaLabel, onSelect }: Props) {
  const groups = useMemo(() => groupOutlineItems(items), [items]);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const revealTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    },
    [],
  );

  function revealGroup(groupId: string, immediate = false) {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
    if (openGroupId === groupId && detailsVisible) return;
    setOpenGroupId(groupId);
    setDetailsVisible(false);
    revealTimerRef.current = window.setTimeout(
      () => {
        setDetailsVisible(true);
        revealTimerRef.current = null;
      },
      immediate ? 0 : 180,
    );
  }

  function hideGroup() {
    if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    revealTimerRef.current = null;
    setDetailsVisible(false);
    hideTimerRef.current = window.setTimeout(() => {
      setOpenGroupId(null);
      hideTimerRef.current = null;
    }, 140);
  }

  function handleBlur(event: FocusEvent<HTMLElement>) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    hideGroup();
  }

  if (groups.length === 0) return null;
  const openGroupIndex = groups.findIndex((group) => group.id === openGroupId);
  const openGroup = openGroupIndex < 0 ? null : groups[openGroupIndex]!;
  const opensUpward = openGroupIndex >= Math.ceil(groups.length / 2);

  return (
    <nav
      data-slot="video-document-outline-rail"
      aria-label={ariaLabel}
      className="sticky top-1/2 z-30 w-8 -translate-y-1/2 self-start select-none"
      onPointerLeave={hideGroup}
      onBlurCapture={handleBlur}
    >
      <div className="flex max-h-[min(64vh,36rem)] flex-col gap-1.5 overflow-y-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {groups.map((group) => {
          const open = openGroupId === group.id;
          const groupActive = group.items.some((item) => item.id === activeId);
          return (
            <div
              key={group.id}
              className="relative flex w-8 flex-col gap-0.5"
              onPointerEnter={() => revealGroup(group.id)}
              onFocusCapture={() => revealGroup(group.id, true)}
            >
              {group.items.map((item) => {
                const depth = itemDepth(item, group);
                const active = item.id === activeId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="group/mark flex h-3.5 w-8 items-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={item.title}
                    aria-current={active ? 'location' : undefined}
                    aria-expanded={depth === 0 ? open : undefined}
                    onClick={() => onSelect(item)}
                  >
                    <span
                      className={cn(
                        'h-0.5 bg-border-strong/65 transition-[width,background-color,transform] duration-150 group-hover/mark:translate-x-0.5 group-hover/mark:bg-selected-foreground/75',
                        active && 'h-[3px] bg-selected-foreground',
                        depth === 0 && groupActive && !active && 'bg-selected-foreground/45',
                      )}
                      style={{ marginLeft: depth * 4, width: markWidth(depth) }}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      {openGroup && (
        <div
          className={cn(
            'absolute left-8 z-50 w-64 border border-selected-border border-l-2 border-l-selected-foreground bg-overlay/95 py-1 shadow-overlay backdrop-blur-sm transition-[opacity,transform] duration-150 ease-out',
            opensUpward ? 'bottom-0' : 'top-0',
            detailsVisible ? 'translate-x-0 opacity-100' : '-translate-x-1 opacity-0',
          )}
        >
          <div className="max-h-[min(22rem,60vh)] overflow-y-auto py-0.5">
            {openGroup.items.map((item) => {
              const depth = itemDepth(item, openGroup);
              const active = item.id === activeId;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    'block w-full border-l-2 border-l-transparent py-1 pr-3 text-left leading-5 outline-none transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    depth === 0 && 'text-sm font-medium text-foreground',
                    depth === 1 && 'text-[13px] text-foreground',
                    depth === 2 && 'text-xs text-muted-foreground',
                    active && 'border-l-selected-foreground bg-selected/55 text-selected-foreground',
                  )}
                  style={{ paddingLeft: 10 + depth * 14 }}
                  aria-current={active ? 'location' : undefined}
                  onClick={() => onSelect(item)}
                >
                  <span className="line-clamp-2">{item.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );
}
