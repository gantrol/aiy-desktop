import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { ArticleDto, ArticleListItem, BootstrapDto } from '@/shared/contracts';
import type { WorkCommand, WorkSnapshot } from '@/shared/contracts/work-tracking';
import { useI18n } from '@/renderer/i18n/useI18n';
import { indexWorkItemExecutions, type ItemExecution } from '@/renderer/features/work-tracking/workItemExecutions';

interface Editing {
  data: BootstrapDto;
  snapshot: WorkSnapshot;
  executionsByItem: Map<string, ItemExecution[]>;
  busy: boolean;
  error?: string;
  mutate(command: WorkCommand, revision: number): Promise<boolean>;
  onArticleSaved(article: ArticleDto): void;
  article(id: string): ArticleListItem | undefined;
  rename(id: string, title: string, revision: string): Promise<string | null>;
}
const Context = createContext<Editing | null>(null);
export function useWorkTableEditing() {
  const value = useContext(Context);
  if (!value) throw new Error('Work table editing context missing');
  return value;
}
export function WorkTableEditing({
  children,
  ...props
}: Omit<Editing, 'article' | 'rename' | 'executionsByItem'> & { children: ReactNode }) {
  const l = useI18n().messages.workTracking;
  const executionsByItem = useMemo(() => indexWorkItemExecutions(props.snapshot), [props.snapshot]);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const articles = useMemo(
    () =>
      new Map(
        (props.data.articles ?? []).filter((entry) => entry.status === 'ACTIVE').map((entry) => [entry.id, entry]),
      ),
    [props.data.articles],
  );
  const article = (id: string) => {
    return articles.get(id);
  };
  const rename = async (id: string, title: string, revision: string) => {
    try {
      const updated = await window.desktopApi.articleRename({
        id,
        title,
        expectedRevisionId: revision,
        expectedSpaceId: props.data.spaceId,
      });
      if (!mounted.current) return l.errors.spaceChanged;
      props.onArticleSaved(updated);
      return null;
    } catch (reason) {
      const message = String(reason);
      if (message.includes('ARTICLE_RENAME_CONFLICT')) {
        try {
          const current = await window.desktopApi.articleOpen({ spaceId: props.data.spaceId, articleId: id });
          if (mounted.current) props.onArticleSaved(current.article);
        } catch {
          /* Preserve the original conflict and the user's draft when refreshing the baseline fails. */
        }
      }
      return message.includes('ARTICLE_RENAME_CONFLICT')
        ? l.errors.conflict
        : message.includes('ARTICLE_RENAME_SPACE_CHANGED')
          ? l.errors.spaceChanged
          : l.renameFailed;
    }
  };
  return <Context.Provider value={{ ...props, article, rename, executionsByItem }}>{children}</Context.Provider>;
}

export function moveWorkCell(element: HTMLElement, direction: number) {
  const table = element.closest('table');
  const cells = Array.from(table?.querySelectorAll<HTMLElement>('[data-work-cell]') ?? []);
  const index = cells.indexOf(element);
  const next = cells[index + direction];
  return () =>
    requestAnimationFrame(() => {
      if (document.activeElement?.closest('[role="dialog"]')) return;
      if (next?.isConnected) next.focus();
      else if (element.isConnected) element.focus();
      else table?.querySelector<HTMLElement>('[data-work-cell]')?.focus();
    });
}
