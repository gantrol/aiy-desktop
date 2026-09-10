import { useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';

import { Button } from '@/components/ui/button';
import { companionMessage } from '@/lib/i18n';
import type { CompanionSite } from '@/lib/protocol';

interface ComposerConflictDialogProps {
  onDecision(replaceExisting: boolean): void;
  site: CompanionSite;
}

function ComposerConflictDialog({ onDecision, site }: ComposerConflictDialogProps) {
  const keepButtonRef = useRef<HTMLButtonElement>(null);
  const siteLabel =
    site === 'weibo'
      ? companionMessage('siteWeibo')
      : site === 'wechat'
        ? companionMessage('siteWechat')
        : site === 'x'
          ? companionMessage('siteX')
          : site === 'xiaohongshu'
            ? companionMessage('siteXiaohongshu')
            : null;

  useEffect(() => {
    keepButtonRef.current?.focus();
  }, []);

  return (
    <div
      data-aiy-composer-conflict={site}
      className="fixed inset-0 flex items-center justify-center bg-black/45 p-4"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onDecision(false);
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="aiy-composer-conflict-title"
        aria-describedby="aiy-composer-conflict-question"
        className="w-full max-w-sm rounded-md border border-border bg-background p-5 text-foreground shadow-lg"
      >
        <h2 id="aiy-composer-conflict-title" className="m-0 text-base font-semibold">
          {siteLabel
            ? companionMessage('conflictSiteHasContent', [siteLabel])
            : companionMessage('conflictCurrentInputHasContent')}
        </h2>
        <p id="aiy-composer-conflict-question" className="mt-2 mb-0 text-sm leading-6 text-muted-foreground">
          {companionMessage('conflictQuestion')}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            ref={keepButtonRef}
            variant="outline"
            data-action="keep-existing-composer"
            onClick={() => onDecision(false)}
          >
            {companionMessage('conflictKeepExisting')}
          </Button>
          <Button data-action="replace-existing-composer" onClick={() => onDecision(true)}>
            {companionMessage('conflictReplaceExisting')}
          </Button>
        </div>
      </section>
    </div>
  );
}

export function requestComposerReplacementConfirmation(
  ctx: ContentScriptContext,
  site: CompanionSite,
): Promise<boolean> {
  if (ctx.isInvalid) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let removeUi: (() => void) | null = null;
    let removeInvalidationListener: (() => void) | null = null;

    const settle = (replaceExisting: boolean) => {
      if (settled) return;
      settled = true;
      removeInvalidationListener?.();
      resolve(replaceExisting);
      queueMicrotask(() => removeUi?.());
    };

    void (async () => {
      try {
        const ui = await createShadowRootUi<Root>(ctx, {
          name: 'aiy-composer-conflict',
          position: 'modal',
          zIndex: 2_147_483_647,
          mode: 'open',
          isolateEvents: true,
          onMount(container) {
            const root = createRoot(container);
            root.render(<ComposerConflictDialog onDecision={settle} site={site} />);
            return root;
          },
          onRemove(root) {
            root?.unmount();
          },
        });
        removeUi = ui.remove;
        if (ctx.isInvalid) {
          settle(false);
          return;
        }
        removeInvalidationListener = ctx.onInvalidated(() => settle(false));
        ui.mount();
      } catch {
        settle(false);
      }
    })();
  });
}
