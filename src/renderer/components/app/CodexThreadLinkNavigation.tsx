import { useEffect } from 'react';
import { codexThreadIdSchema, parseCodexThreadHref } from '@/shared/contracts/codex-thread';

function codexThreadIdFromClick(event: MouseEvent) {
  for (const candidate of event.composedPath()) {
    if (!(candidate instanceof Element)) continue;

    const explicitThreadId = candidate.getAttribute('data-codex-thread-id');
    if (explicitThreadId !== null) {
      const parsed = codexThreadIdSchema.safeParse(explicitThreadId);
      if (parsed.success) return parsed.data;
    }

    if (candidate instanceof HTMLAnchorElement) {
      const threadId = parseCodexThreadHref(candidate.getAttribute('href'));
      if (threadId) return threadId;
    }
  }
  return null;
}

export function CodexThreadLinkNavigation() {
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        (!event.ctrlKey && !event.metaKey) ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }

      const threadId = codexThreadIdFromClick(event);
      if (!threadId) return;

      event.preventDefault();
      event.stopPropagation();
      void window.desktopApi
        .codexOpenThread(threadId)
        .catch((error) => console.error('[codex-thread-link] Failed to open Codex task', error));
    }

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  return null;
}
