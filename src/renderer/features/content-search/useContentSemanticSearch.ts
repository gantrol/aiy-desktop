import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContentLookupApi, ContentLookupInput } from '@/shared/contracts/content-search';
import { useContentLookup } from '@/renderer/features/content-search/useContentLookup';
import type { WorkspaceSearchMode } from '@/shared/contracts/image-search';

export function useContentSemanticSearch(
  query: string,
  type: ContentLookupInput['type'],
  active: boolean,
  mode: WorkspaceSearchMode = 'SEMANTIC',
) {
  const request = useRef<string | null>(null);
  const [visible, setVisible] = useState(!document.hidden);
  const api = useMemo<ContentLookupApi>(
    () => ({
      lookup: async (input) => {
        const host = window.desktopApi?.imageSearch;
        if (!host) throw new Error('NOT_CONFIGURED');
        const requestId = crypto.randomUUID();
        request.current = requestId;
        try {
          const response = await host.lookupContent({ ...input, requestId, mode });
          if ('error' in response) throw new Error(response.error);
          return response.result;
        } finally {
          if (request.current === requestId) request.current = null;
        }
      },
    }),
    [mode],
  );
  const result = useContentLookup(api, query, type, active && visible && Boolean(query.trim()), 250, mode);
  useEffect(() => {
    const cancel = () => {
      if (request.current) void window.desktopApi?.imageSearch.cancel(request.current).catch(() => undefined);
      request.current = null;
    };
    const visibility = () => {
      setVisible(!document.hidden);
      if (document.hidden) cancel();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      cancel();
    };
  }, [active, visible, query, type, mode, result.paused]);
  return result;
}
