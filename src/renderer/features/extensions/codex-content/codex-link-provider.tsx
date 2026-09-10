import { useMemo, useState } from 'react';
import { ArrowUpRight, ListTree, Terminal } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { contentLibraryApi } from '@/renderer/features/content-editor/ContentReferencePicker';
import type {
  ContentLinkCardProps,
  ContentLinkProvider,
} from '@/renderer/features/content-editor/ContentLinkProviders';
import { useI18n } from '@/renderer/i18n/useI18n';
import { CODEX_CONTENT_APPLICATION_ID } from '@/shared/contracts/content-applications';
import { codexThreadHref, parseCodexThreadHref } from '@/shared/contracts/codex-thread';
import type { LinkCardAttributes } from '@/shared/contracts/link-card';

/** Only complete link-only input participates; prose and unsupported links retain native paste behavior. */
function parseTaskLinks(value: string): LinkCardAttributes[] | null {
  if (value.length > 100_000) return null;
  const lines = value
    .split(/\r\n?|\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length || lines.length > 100) return null;
  const links: LinkCardAttributes[] = [];
  for (const line of lines) {
    const href = line.replace(/(?:&(?:#x20|#32|nbsp);\s*)+$/giu, '').trim();
    const threadId = parseCodexThreadHref(href.startsWith('<') && href.endsWith('>') ? href.slice(1, -1) : href);
    if (!threadId) return null;
    links.push({ url: codexThreadHref(threadId) });
  }
  return links;
}

function CodexLinkCard({ url, title, application, source }: ContentLinkCardProps) {
  const copy = useI18n().messages.desktopPetals.codex;
  const [failed, setFailed] = useState(false);
  const childTask =
    source?.kind === 'INSPIRATION_STASH' &&
    application?.id === CODEX_CONTENT_APPLICATION_ID &&
    application.relation === 'CHILD_TASK';
  return (
    <Button asChild variant="ghost" className="h-auto w-full justify-start gap-2 rounded-sm p-2 text-left font-normal">
      <a
        href={url}
        title={failed ? copy.links.openFailed : url}
        className="!text-foreground !no-underline"
        aria-label={`${copy.openTask}: ${title || parseCodexThreadHref(url)}`}
        onAuxClick={(event) => event.preventDefault()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setFailed(false);
          void contentLibraryApi()
            .linkOpen(url)
            .catch(() => setFailed(true));
        }}
      >
        {childTask ? <ListTree className="size-4 shrink-0" /> : <Terminal className="size-4 shrink-0" />}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-xs font-medium">
            {title || (childTask ? copy.links.childTask : copy.links.task)}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">{parseCodexThreadHref(url)}</span>
        </span>
        <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
      </a>
    </Button>
  );
}

export function useCodexLinkProvider(): ContentLinkProvider {
  const copy = useI18n().messages.desktopPetals.codex.links;
  return useMemo(
    () => ({
      id: CODEX_CONTENT_APPLICATION_ID,
      matches: (url) => parseCodexThreadHref(url) !== null,
      parsePaste: parseTaskLinks,
      actions: (source) => [
        { id: 'card', label: copy.toCard },
        ...(source?.kind === 'INSPIRATION_STASH'
          ? [
              {
                id: 'child-task',
                label: copy.linkChildTask,
                application: { id: CODEX_CONTENT_APPLICATION_ID, relation: 'CHILD_TASK' },
              },
            ]
          : []),
      ],
      Card: CodexLinkCard,
    }),
    [copy],
  );
}
