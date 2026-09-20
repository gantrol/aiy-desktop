import { LinkIcon, LoaderCircleIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { agentContentUrl, type AgentContentTarget } from '@/shared/contracts/agent-content';

interface Props {
  target: AgentContentTarget;
  disabled?: boolean;
  beforeCopy?(): Promise<boolean>;
  notify(message: string): void;
}

export function CopyAgentLinkButton({ target, disabled, beforeCopy, notify }: Props) {
  const copy = useI18n().messages.agentContent;
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const active = useRef(true);
  const latestUrl = useRef(agentContentUrl(target));
  latestUrl.current = agentContentUrl(target);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const copyLink = async () => {
    if (running.current) return;
    const selectedUrl = latestUrl.current;
    const current = () => active.current && latestUrl.current === selectedUrl;
    running.current = true;
    setBusy(true);
    try {
      if (beforeCopy && !(await beforeCopy())) {
        if (current()) notify(copy.saveFailed);
        return;
      }
      if (!current()) return;
      const result = await contentLibraryApi().agentLink(target);
      if (!current()) return;
      const { url, ...invocation } = result;
      await navigator.clipboard.writeText(
        [url, copy.readInstructions, JSON.stringify(invocation, null, 2)].join('\n\n'),
      );
      if (current()) notify(copy.copied);
    } catch (reason) {
      console.error('[agent-content] Copy link failed', reason);
      if (current()) {
        const detail = reason instanceof Error ? reason.message : String(reason);
        notify(detail.includes('AIY_AGENT_CLI_UNAVAILABLE') ? copy.cliUnavailable : copy.copyFailed);
      }
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={copy.copyLink}
      aria-label={copy.copyLink}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={() => void copyLink()}
    >
      {busy ? <LoaderCircleIcon className="size-4 animate-spin" /> : <LinkIcon className="size-4" />}
    </Button>
  );
}
