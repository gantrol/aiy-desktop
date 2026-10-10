import { useCallback, useEffect, useRef, useState } from 'react';
import { useArticleEditorSessionFlush } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import {
  workspaceSearchItemKey,
  type WorkspaceSearchItem,
} from '@/renderer/features/content-search/workspaceSearchItems';
import type { ImageSearchItem } from '@/shared/contracts/image-search';
import { useAssetNavigation } from '@/renderer/components/media/AssetNavigationProvider';

export function useWorkspaceSearchSelection(
  active: boolean,
  context: string,
  query: string,
  saveFailed: string,
  unavailable: string,
) {
  const flush = useArticleEditorSessionFlush();
  const navigation = useAssetNavigation();
  const [selected, setSelected] = useState<WorkspaceSearchItem | null>(null);
  const [selectedQuery, setSelectedQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const pending = useRef(false);
  const inFlightSelection = useRef<{ key: string; promise: Promise<boolean> } | null>(null);
  const invalidate = useCallback(() => {
    revision.current++;
  }, []);
  useEffect(() => {
    pending.current = false;
    inFlightSelection.current = null;
    setBusy(false);
    setError('');
    return invalidate;
  }, [active, context, invalidate]);

  const performSelect = async (item: WorkspaceSearchItem) => {
    if (!active || pending.current) return false;
    const current = ++revision.current;
    pending.current = true;
    setBusy(true);
    setError('');
    let failure = saveFailed;
    try {
      if (selected && workspaceSearchItemKey(selected) !== workspaceSearchItemKey(item) && !(await flush()))
        throw new Error('SAVE_PENDING');
      if (current !== revision.current) return false;
      failure = unavailable;
      if (!('source' in item) && !(await window.desktopApi?.imageSearch.inspect(item.id)))
        throw new Error('UNAVAILABLE');
      if (current !== revision.current) return false;
      setSelected(item);
      setSelectedQuery('source' in item && item.match !== 'SEMANTIC' ? query : '');
      return true;
    } catch {
      if (current === revision.current) setError(failure);
      return false;
    } finally {
      if (current === revision.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  const select = (item: WorkspaceSearchItem) => {
    const key = workspaceSearchItemKey(item);
    if (inFlightSelection.current?.key === key) return inFlightSelection.current.promise;
    const promise = performSelect(item);
    const request = { key, promise };
    inFlightSelection.current = request;
    void promise.finally(() => {
      if (inFlightSelection.current === request) inFlightSelection.current = null;
    });
    return promise;
  };
  const openImage = async (item: ImageSearchItem) => {
    if (!(await select(item))) return;
    const current = revision.current;
    try {
      if (!navigation) throw new Error('UNAVAILABLE');
      await navigation.open(item.id, 'PRIMARY');
    } catch {
      if (current === revision.current) setError(unavailable);
    }
  };
  return { selected, selectedQuery, busy, error, select, openImage };
}
