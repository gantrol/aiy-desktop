import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/cn';
import { companionLanguageTag, companionMessage, type CompanionMessageKey } from '@/lib/i18n';
import { handoffForTab } from '@/lib/batch-tabs';
import { currentHandoffSnapshotSchema, type CurrentHandoffSnapshot } from '@/lib/current-handoff-protocol';
import {
  consumeHandoffResponseSchema,
  fillDraftResponseSchema,
  handoffIdFromUrl,
  removeHandoffIdFromUrl,
  resolveSiteFromUrl,
  type CompanionSite,
} from '@/lib/protocol';
import { CONSUME_ERROR_MESSAGE_KEY, ERROR_MESSAGE_KEY, SITE_LABEL_KEY, STAGE_KEYS, statusCopy } from './status-copy';

type View = 'home' | 'settings' | 'diagnostics' | 'paste';
type TabContext = { tabId: number; url: string; site: CompanionSite | null; handoffId?: string };
type Action = 'fill' | 'receipt' | 'manual' | 'page';
const ACTION_KEYS: Record<string, CompanionMessageKey> = {
  fill: 'popupFillCurrentPage',
  receipt: 'handoffVerifyReceipt',
  page: 'handoffViewPage',
  aiy: 'handoffOpenAiy',
  check: 'handoffRecheck',
};
const emptySnapshot = (site: CompanionSite | null): CurrentHandoffSnapshot => ({
  kind: 'current-handoff',
  site,
  state: site ? 'failed' : 'unsupported',
  connection: 'unknown',
  stage: 'idle',
  code: null,
  task: null,
  canRetryReceipt: false,
  thumbnails: [],
});
async function activeContext(): Promise<TabContext | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return null;
  const url = tab.url ?? '';
  const site = resolveSiteFromUrl(url);
  const handoffId = handoffIdFromUrl(url) ?? (site ? await handoffForTab(tab.id, site) : null);
  return { tabId: tab.id, url, site, ...(handoffId ? { handoffId } : {}) };
}
function contextKey(context: TabContext | null): string {
  if (!context) return '';
  const url = context.site ? removeHandoffIdFromUrl(context.url) : context.url;
  return JSON.stringify([context.tabId, url, context.site, context.handoffId]);
}
function Icon({
  name,
  className,
}: {
  name: 'settings' | 'back' | 'more' | 'arrow' | 'image' | 'status' | 'check' | 'loading';
  className?: string;
}) {
  const paths = {
    settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
    back: 'm14 5-7 7 7 7',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    arrow: 'M7 17 17 7M7 7h10v10',
    image: 'M3 3h18v18H3zM3 16l6-6 5 5 3-3 4 4M15 7h.01',
    status: 'M12 8v5M12 17h.01',
    check: 'm8 12 3 3 5-6',
    loading: 'M21 12a9 9 0 1 1-9-9',
  };
  return (
    <svg
      aria-hidden="true"
      className={cn('size-4 shrink-0', name === 'loading' && 'motion-safe:animate-spin', className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {(name === 'status' || name === 'check') && <circle cx="12" cy="12" r="9" />}
      <path d={paths[name]} />
    </svg>
  );
}

export function Popup() {
  const [view, setView] = useState<View>('home');
  const [snapshot, setSnapshot] = useState<CurrentHandoffSnapshot | null>(null);
  const [context, setContext] = useState<TabContext | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState('');
  const [pendingAction, setPendingAction] = useState<Action | null>(null);
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [pageError, setPageError] = useState('');
  const [tabGroupsAllowed, setTabGroupsAllowed] = useState(false);
  const [permissionWorking, setPermissionWorking] = useState(false);
  const live = useRef(false);
  const reading = useRef(false);
  const actionLock = useRef(false);
  const revision = useRef(0);
  const displayedContext = useRef<TabContext | null>(null);
  const more = useRef<HTMLDetailsElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async (interactive = false) => {
    if (interactive) setChecking(true);
    if (reading.current) return;
    reading.current = true;
    const generation = ++revision.current;
    try {
      const next = await activeContext();
      if (!live.current || generation !== revision.current) return;
      if (contextKey(next) !== contextKey(displayedContext.current)) {
        displayedContext.current = next;
        setContext(next);
        setSnapshot(null);
        setExpanded(false);
        setFeedback('');
      }
      const raw = next?.site
        ? await browser.tabs.sendMessage(
            next.tabId,
            {
              protocolVersion: 1,
              kind: 'inspect-current-handoff',
              requestId: crypto.randomUUID(),
              ...(next.handoffId ? { handoffId: next.handoffId } : {}),
            },
            { frameId: 0 },
          )
        : emptySnapshot(null);
      const result = currentHandoffSnapshotSchema.parse(raw);
      if (!live.current || generation !== revision.current) return;
      // A late reply may describe the previous page. It must not enable an action here.
      if (contextKey(next) !== contextKey(await activeContext())) return;
      if (result.site !== next?.site && !(result.site === null && !next)) throw new Error('Site changed');
      if (next?.handoffId && result.task && next.handoffId !== result.task.handoffId) throw new Error('Task changed');
      if (!live.current || generation !== revision.current) return;
      setSnapshot(result);
      setPageError('');
    } catch {
      if (live.current && generation === revision.current) {
        setSnapshot((previous) => ({
          ...(previous ?? emptySnapshot(displayedContext.current?.site ?? null)),
          state: 'failed',
          stage: 'idle',
          connection: 'unknown',
          code: null,
          canRetryReceipt: false,
        }));
        setPageError(companionMessage('handoffPageUnavailable'));
      }
    } finally {
      reading.current = false;
      if (live.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    live.current = true;
    void refresh();
    // An open popup follows automatic filling; this only inspects its exact current task.
    const timer = window.setInterval(() => void refresh(), 1_500);
    void browser.permissions
      .contains({ permissions: ['tabGroups'] })
      .then((allowed) => {
        if (live.current) setTabGroupsAllowed(allowed);
      })
      .catch(() => undefined);
    return () => {
      live.current = false;
      revision.current += 1;
      window.clearInterval(timer);
    };
  }, [refresh]);

  function changeView(next: View) {
    if (more.current) more.current.open = false;
    setView(next);
    setFeedback('');
  }
  function back() {
    changeView('home');
    window.setTimeout(() => settingsButton.current?.focus(), 0);
  }
  async function act(kind: Action) {
    if (actionLock.current) return;
    actionLock.current = true;
    revision.current += 1;
    setPendingAction(kind);
    setFeedback('');
    try {
      const next = await activeContext();
      if (!next?.site || contextKey(next) !== contextKey(context)) {
        setFeedback(companionMessage('handoffContextChanged'));
        return;
      }
      if (kind === 'page') {
        await browser.tabs.update(next.tabId, { active: true });
        window.close();
        return;
      }
      if (kind === 'manual') {
        if (!draft.trim() || snapshot?.state === 'filling') return;
        const response = fillDraftResponseSchema.parse(
          await browser.tabs.sendMessage(
            next.tabId,
            {
              protocolVersion: 1,
              kind: 'fill-draft',
              requestId: crypto.randomUUID(),
              draft: draft.trim(),
            },
            { frameId: 0 },
          ),
        );
        if (live.current)
          setFeedback(
            response.ok
              ? companionMessage('popupManualFillSuccess', [String(response.characterCount)])
              : companionMessage(ERROR_MESSAGE_KEY[response.code]),
          );
        return;
      }
      if (
        !snapshot?.task ||
        snapshot.site !== next.site ||
        (next.handoffId && next.handoffId !== snapshot.task.handoffId)
      )
        return;
      if (kind === 'fill' && (snapshot.task.state !== 'ready' || !['ready', 'failed'].includes(snapshot.state))) return;
      if (kind === 'receipt' && !snapshot.canRetryReceipt) return;
      const raw = await browser.tabs.sendMessage(
        next.tabId,
        {
          protocolVersion: 1,
          kind: kind === 'receipt' ? 'retry-handoff-receipt' : 'consume-handoff',
          requestId: crypto.randomUUID(),
          handoffId: snapshot.task.handoffId,
        },
        { frameId: 0 },
      );
      if (kind === 'receipt') currentHandoffSnapshotSchema.parse(raw);
      else {
        const response = consumeHandoffResponseSchema.parse(raw);
        if (!response.ok && live.current) setFeedback(companionMessage(CONSUME_ERROR_MESSAGE_KEY[response.code]));
      }
    } catch {
      if (live.current) setFeedback(companionMessage('handoffPageUnavailable'));
    } finally {
      actionLock.current = false;
      if (live.current) {
        setPendingAction(null);
        void refresh();
      }
    }
  }

  const copy = statusCopy(snapshot);
  const busy =
    checking || pendingAction !== null || !snapshot || snapshot.state === 'filling' || snapshot.stage !== 'idle';
  const statusTitle = checking
    ? companionMessage('handoffChecking')
    : pendingAction && snapshot?.stage === 'idle'
      ? companionMessage(
          pendingAction === 'receipt'
            ? 'handoffStageReceipt'
            : pendingAction === 'manual'
              ? 'handoffStageWriting'
              : 'handoffStageConnecting',
        )
      : copy.title;
  const siteLabel = context?.site
    ? companionMessage(SITE_LABEL_KEY[context.site])
    : companionMessage('handoffCurrentSite');
  const task = snapshot?.task;
  const connectionLabel = companionMessage(
    snapshot?.connection === 'connected'
      ? 'handoffConnected'
      : snapshot?.connection === 'offline'
        ? 'handoffOffline'
        : 'handoffConnectionUnknown',
  );
  const title =
    view === 'home'
      ? companionMessage('extensionName')
      : companionMessage(
          ({ settings: 'handoffSettings', diagnostics: 'handoffDiagnostics', paste: 'handoffManualPaste' } as const)[
            view
          ],
        );
  const showDetails = Boolean(
    !busy && (pageError || (snapshot && ['failed', 'offline', 'media', 'unknown', 'receipt'].includes(snapshot.state))),
  );
  const created = task ? new Date(task.createdAt) : null;

  return (
    <main
      className="flex max-h-[600px] min-h-80 w-full flex-col overflow-hidden"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        if (more.current?.open) {
          event.preventDefault();
          more.current.open = false;
          more.current.querySelector('summary')?.focus();
        } else if (view !== 'home') {
          event.preventDefault();
          back();
        }
      }}
    >
      <header className="flex min-h-13 shrink-0 items-center justify-between gap-2 border-b border-border py-2 pr-3 pl-4">
        <div className="flex min-w-0 items-center gap-2">
          {view !== 'home' ? (
            <Button variant="ghost" size="icon" aria-label={companionMessage('handoffBack')} onClick={back}>
              <Icon name="back" />
            </Button>
          ) : (
            <img className="size-5 object-contain" src="/icons/icon-32.png" alt="" />
          )}
          <h1 className="truncate text-sm font-semibold">{title}</h1>
        </div>
        {view === 'home' && (
          <Button
            ref={settingsButton}
            variant="ghost"
            size="icon"
            aria-label={companionMessage('handoffSettings')}
            onClick={() => changeView('settings')}
          >
            <Icon name="settings" />
          </Button>
        )}
      </header>

      {view === 'home' && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mb-6 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate">{siteLabel}</span>
              <span className="shrink-0" data-connection={snapshot?.connection ?? 'unknown'}>
                {connectionLabel}
              </span>
            </div>
            {!snapshot && (
              <div className="space-y-3 motion-safe:animate-pulse" aria-hidden="true">
                <div className="h-5 w-40 rounded-sm bg-muted" />
                <div className="h-3 w-56 rounded-sm bg-muted" />
                <div className="mt-4 h-12 rounded-sm bg-muted" />
                <div className="size-16 rounded-sm bg-muted" />
              </div>
            )}
            {task && (
              <section aria-label={companionMessage('handoffTitle')}>
                <h2 className="text-base font-semibold wrap-anywhere">
                  {task.title || companionMessage('handoffTitle')}
                </h2>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {companionMessage(task.media.length === 1 ? 'handoffMetadataOneImage' : 'handoffMetadata', [
                      String([...task.text].length),
                      String(task.media.length),
                    ])}
                  </span>
                  {created && (
                    <time
                      className="shrink-0"
                      dateTime={task.createdAt}
                      title={created.toLocaleString(companionLanguageTag())}
                    >
                      {created.toLocaleDateString(companionLanguageTag(), { month: 'short', day: 'numeric' })}
                    </time>
                  )}
                </div>
                <div className="mt-4">
                  <p
                    id="handoff-excerpt"
                    className={cn(
                      'leading-6 whitespace-pre-line wrap-anywhere',
                      expanded ? 'max-h-44 overflow-y-auto' : 'line-clamp-2',
                    )}
                  >
                    {task.text}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-0 text-muted-foreground"
                    aria-controls="handoff-excerpt"
                    aria-expanded={expanded}
                    onClick={() => setExpanded(!expanded)}
                  >
                    {companionMessage(expanded ? 'handoffCollapse' : 'handoffExpand')}
                  </Button>
                  {task.media.length > 0 && (
                    <div
                      className="mt-2 flex flex-wrap items-start gap-2"
                      aria-label={companionMessage('handoffAttachments')}
                    >
                      {task.media.slice(0, 3).map((media) => {
                        const preview = snapshot.thumbnails.find((entry) => entry.mediaId === media.mediaId);
                        return (
                          <figure className="w-18" key={media.mediaId} title={media.fileName}>
                            {preview ? (
                              <img
                                className="h-16 w-18 rounded-sm bg-muted object-contain"
                                src={preview.dataUrl}
                                alt={media.fileName}
                              />
                            ) : (
                              <div
                                className="flex h-16 w-18 items-center justify-center rounded-sm bg-muted text-muted-foreground"
                                aria-label={media.fileName + ' · ' + companionMessage('handoffPreviewPending')}
                              >
                                <Icon name={snapshot.stage === 'downloading' ? 'loading' : 'image'} />
                              </div>
                            )}
                            <figcaption className="truncate text-[11px] text-muted-foreground">
                              {media.fileName}
                            </figcaption>
                          </figure>
                        );
                      })}
                      {task.media.length > 3 && (
                        <span className="text-xs text-muted-foreground">
                          {companionMessage('handoffMoreImages', [String(task.media.length - 3)])}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </section>
            )}
            <div className="mt-6 flex items-start gap-2" role="status" aria-live="polite" aria-atomic="true">
              <Icon
                name={busy ? 'loading' : copy.tone === 'success' || snapshot?.state === 'ready' ? 'check' : 'status'}
                className={cn(
                  'mt-0.5',
                  !busy &&
                    (copy.tone === 'error'
                      ? 'text-[light-dark(#b42318,#fbeae8)]'
                      : copy.tone === 'success'
                        ? 'text-[light-dark(#2f6b4f,#e3efe7)]'
                        : copy.tone === 'warning'
                          ? 'text-[light-dark(#a15c07,#fbefdc)]'
                          : 'text-muted-foreground'),
                )}
              />
              <div className="min-w-0">
                <h2 className="text-sm font-medium">{statusTitle}</h2>
                {!busy && (pageError || copy.detail) && (
                  <p className="mt-1 text-xs wrap-anywhere text-muted-foreground">{pageError || copy.detail}</p>
                )}
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              {showDetails && (
                <Button variant="ghost" size="sm" onClick={() => changeView('diagnostics')}>
                  {companionMessage('handoffDetails')}
                </Button>
              )}
              {copy.action === 'aiy' && !busy ? (
                <a className={buttonVariants({ size: 'sm' })} href="aiy://open/companion">
                  {companionMessage('handoffOpenAiy')}
                </a>
              ) : (
                <Button
                  size="sm"
                  data-action={copy.action}
                  disabled={busy}
                  aria-busy={busy}
                  onClick={() => {
                    if (copy.action === 'check') void refresh(true);
                    else if (copy.action === 'fill' || copy.action === 'receipt' || copy.action === 'page')
                      void act(copy.action);
                  }}
                >
                  {busy
                    ? statusTitle
                    : companionMessage(
                        copy.action === 'fill' && snapshot?.state === 'failed'
                          ? 'handoffRetryFill'
                          : ACTION_KEYS[copy.action]!,
                      )}
                </Button>
              )}
            </div>
          </div>
          <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border p-2">
            <a
              className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'text-muted-foreground' })}
              href="aiy://open/companion"
            >
              <Icon name="arrow" />
              {companionMessage('handoffReturnAiy')}
            </a>
            <details ref={more} className="relative">
              <summary
                className={buttonVariants({
                  variant: 'ghost',
                  size: 'sm',
                  className: 'cursor-pointer list-none text-muted-foreground [&::-webkit-details-marker]:hidden',
                })}
              >
                {companionMessage('handoffMore')}
                <Icon name="more" />
              </summary>
              <div className="absolute right-0 bottom-10 z-10 flex min-w-40 flex-col rounded-md border border-border bg-background p-1 shadow-sm">
                <Button variant="ghost" size="sm" className="justify-start" onClick={() => changeView('paste')}>
                  {companionMessage('handoffManualPaste')}
                </Button>
                <a
                  className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'justify-start' })}
                  href="aiy://open/companion"
                >
                  {companionMessage('handoffHistory')}
                </a>
                <Button variant="ghost" size="sm" className="justify-start" onClick={() => changeView('diagnostics')}>
                  {companionMessage('handoffDiagnostics')}
                </Button>
              </div>
            </details>
          </footer>
        </>
      )}

      {view === 'settings' && (
        <section className="min-h-0 flex-1 overflow-y-auto p-4">
          <label className="flex min-h-11 items-center justify-between gap-4">
            <span>{companionMessage('popupGroupBatchTabs')}</span>
            <input
              className="size-4 shrink-0 accent-primary"
              type="checkbox"
              checked={tabGroupsAllowed}
              disabled={permissionWorking}
              onChange={(event) => {
                const enable = event.target.checked;
                setPermissionWorking(true);
                const request = enable
                  ? browser.permissions.request({ permissions: ['tabGroups'] })
                  : browser.permissions.remove({ permissions: ['tabGroups'] }).then(() => false);
                void request
                  .then((allowed) => {
                    if (live.current) {
                      setTabGroupsAllowed(allowed);
                      if (enable && !allowed) setFeedback(companionMessage('handoffPermissionFailed'));
                    }
                  })
                  .catch(() => {
                    if (live.current) setFeedback(companionMessage('handoffPermissionFailed'));
                  })
                  .finally(() => {
                    if (live.current) setPermissionWorking(false);
                  });
              }}
            />
          </label>
          <p className="mt-4 text-xs text-muted-foreground">
            {companionMessage('extensionName')} {browser.runtime.getManifest().version}
          </p>
        </section>
      )}
      {view === 'diagnostics' && (
        <section className="min-h-0 flex-1 overflow-y-auto p-4">
          <dl className="space-y-4 text-sm">
            {(
              [
                ['handoffCurrentSite', siteLabel],
                ['handoffConnection', connectionLabel],
                ['handoffStage', snapshot ? companionMessage(STAGE_KEYS[snapshot.stage]) : '—'],
                ['handoffErrorCode', snapshot?.code ?? '—'],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-4">
                <dt className="shrink-0 text-muted-foreground">{companionMessage(key)}</dt>
                <dd className="min-w-0 text-right wrap-anywhere">
                  {key === 'handoffErrorCode' ? <code className="text-[11px]">{value}</code> : value}
                </dd>
              </div>
            ))}
          </dl>
          {pageError && <p className="mt-4 text-xs text-muted-foreground">{pageError}</p>}
          <div className="mt-4 flex justify-end">
            <Button size="sm" disabled={busy} aria-busy={checking} onClick={() => void refresh(true)}>
              {checking && <Icon name="loading" />}
              {companionMessage(checking ? 'handoffChecking' : 'handoffRecheck')}
            </Button>
          </div>
        </section>
      )}
      {view === 'paste' && (
        <section className="min-h-0 flex-1 overflow-y-auto p-4">
          <label htmlFor="manual-text">{companionMessage('handoffManualText')}</label>
          <Textarea
            id="manual-text"
            className="mt-2"
            maxLength={10_000}
            value={draft}
            placeholder={companionMessage('handoffManualPaste')}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="mt-4 flex justify-end">
            <Button size="sm" disabled={busy || !context?.site || !draft.trim()} onClick={() => void act('manual')}>
              {pendingAction === 'manual' && <Icon name="loading" />}
              {companionMessage('popupFillCurrentPage')}
            </Button>
          </div>
        </section>
      )}
      {feedback && (
        <p className="shrink-0 px-4 pb-3 text-xs wrap-anywhere text-muted-foreground" role="status">
          {feedback}
        </p>
      )}
    </main>
  );
}
