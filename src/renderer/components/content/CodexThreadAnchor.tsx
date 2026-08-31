import type { ComponentPropsWithoutRef } from 'react';
import { codexThreadHref, type CodexThreadId } from '@/shared/contracts/codex-thread';

type Props = Omit<ComponentPropsWithoutRef<'a'>, 'href' | 'onClick'> & {
  threadId: CodexThreadId;
};

export function CodexThreadAnchor({ threadId, children, ...props }: Props) {
  return (
    <a
      {...props}
      href={codexThreadHref(threadId)}
      data-codex-thread-id={threadId}
      onClick={(event) => event.preventDefault()}
    >
      {children}
    </a>
  );
}
