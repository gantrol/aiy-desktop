import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { companionMessage, type CompanionMessageKey } from '@/lib/i18n';
import { handoffForTab } from '@/lib/batch-tabs';
import {
  consumeHandoffResponseSchema,
  fillDraftResponseSchema,
  handoffIdFromUrl,
  resolveSiteFromUrl,
  type CompanionSite,
  type ConsumeHandoffErrorCode,
  type ConsumeHandoffRequest,
  type ConsumeHandoffResponse,
  type FillDraftErrorCode,
  type FillDraftRequest,
  type FillDraftResponse,
} from '@/lib/protocol';

type PageState = 'loading' | CompanionSite | 'unsupported';
type Notice = { tone: 'idle' | 'success' | 'error'; text: string };
type WorkingAction = 'manual' | 'desktop' | null;

const SITE_LABEL_KEY: Record<CompanionSite, CompanionMessageKey> = {
  chatgpt: 'siteChatgpt',
  wechat: 'siteWechat',
  weibo: 'siteWeibo',
  x: 'siteX',
  xiaohongshu: 'siteXiaohongshu',
};

const ERROR_MESSAGE_KEY: Record<FillDraftErrorCode, CompanionMessageKey> = {
  INVALID_REQUEST: 'errorInvalidRequest',
  UNSUPPORTED_SITE: 'errorUnsupportedSite',
  BUSY: 'errorBusy',
  COMPOSER_NOT_FOUND: 'errorComposerNotFound',
  COMPOSER_AMBIGUOUS: 'errorComposerAmbiguous',
  COMPOSER_NOT_EMPTY: 'errorComposerNotEmpty',
  MEDIA_INPUT_NOT_FOUND: 'errorMediaInputNotFound',
  MEDIA_FILL_FAILED: 'errorMediaFillFailed',
  MEDIA_UNSUPPORTED: 'errorMediaUnsupported',
  COMPOSER_HAS_MEDIA: 'errorComposerHasMedia',
  FILL_FAILED: 'errorFillFailed',
  XIAOHONGSHU_TITLE_TOO_LONG: 'errorXiaohongshuTitleTooLong',
  XIAOHONGSHU_BODY_TOO_LONG: 'errorXiaohongshuBodyTooLong',
  XIAOHONGSHU_MEDIA_UNSUPPORTED: 'errorXiaohongshuMediaUnsupported',
  XIAOHONGSHU_LOGIN_REQUIRED: 'errorXiaohongshuLoginRequired',
};

const CONSUME_ERROR_MESSAGE_KEY: Record<ConsumeHandoffErrorCode, CompanionMessageKey> = {
  ...ERROR_MESSAGE_KEY,
  INVALID_REQUEST: 'errorDesktopInvalidRequest',
  UNAUTHORIZED: 'errorUnauthorized',
  TARGET_MISMATCH: 'errorTargetMismatch',
  DRAFT_ALREADY_CLAIMED: 'errorDraftAlreadyClaimed',
  HANDOFF_NOT_FOUND: 'errorHandoffNotFound',
  HANDOFF_TOKEN_MISMATCH: 'errorHandoffTokenMismatch',
  MEDIA_NOT_FOUND: 'errorMediaNotFound',
  MEDIA_CHANGED: 'errorMediaChanged',
  OUTPUT_IMPORT_NOT_ALLOWED: 'errorOutputImportNotAllowed',
  OUTPUT_UPLOAD_NOT_FOUND: 'errorOutputUploadNotFound',
  OUTPUT_UPLOAD_CHANGED: 'errorOutputUploadChanged',
  STATE_CONFLICT: 'errorStateConflict',
  CORRUPT_STATE: 'errorCorruptState',
  INTERNAL_ERROR: 'errorInternal',
  DESKTOP_CONNECTION_FAILED: 'errorDesktopConnection',
  MEDIA_DOWNLOAD_FAILED: 'errorMediaDownload',
};

async function activeTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function pageStateFromUrl(url: string | undefined): PageState {
  return resolveSiteFromUrl(url) ?? 'unsupported';
}

export function Popup() {
  const [draft, setDraft] = useState('');
  const [pageState, setPageState] = useState<PageState>('loading');
  const [workingAction, setWorkingAction] = useState<WorkingAction>(null);
  const [tabGroupsAllowed, setTabGroupsAllowed] = useState(false);
  const [notice, setNotice] = useState<Notice>({
    tone: 'idle',
    text: companionMessage('popupWaitingForContent'),
  });

  useEffect(() => {
    let live = true;
    void browser.permissions
      .contains({ permissions: ['tabGroups'] })
      .then((allowed) => {
        if (live) setTabGroupsAllowed(allowed);
      })
      .catch(() => undefined);
    void activeTab()
      .then((tab) => {
        if (live) setPageState(pageStateFromUrl(tab?.url));
      })
      .catch(() => {
        if (live) setPageState('unsupported');
      });

    return () => {
      live = false;
    };
  }, []);

  const trimmedDraft = draft.trim();
  const supportedPage = pageState !== 'loading' && pageState !== 'unsupported';
  const canFillManual = supportedPage && trimmedDraft.length > 0 && workingAction === null;
  const canFillDesktop = supportedPage && workingAction === null;

  async function fillActivePage(nextDraft: string): Promise<FillDraftResponse> {
    const tab = await activeTab();
    const currentSite = pageStateFromUrl(tab?.url);
    setPageState(currentSite);

    if (tab?.id === undefined || currentSite === 'unsupported' || currentSite === 'loading') {
      return {
        ok: false,
        requestId: null,
        site: null,
        code: 'UNSUPPORTED_SITE',
      };
    }

    const request: FillDraftRequest = {
      protocolVersion: 1,
      kind: 'fill-draft',
      requestId: crypto.randomUUID(),
      draft: nextDraft,
    };
    const rawResponse: unknown = await browser.tabs.sendMessage(tab.id, request);
    return fillDraftResponseSchema.parse(rawResponse);
  }

  async function consumeActivePage(): Promise<ConsumeHandoffResponse> {
    const tab = await activeTab();
    const currentSite = pageStateFromUrl(tab?.url);
    setPageState(currentSite);

    if (tab?.id === undefined || currentSite === 'unsupported' || currentSite === 'loading') {
      return {
        ok: false,
        requestId: null,
        site: null,
        code: 'UNSUPPORTED_SITE',
      };
    }

    const handoffId = (tab.url ? handoffIdFromUrl(tab.url) : null) ?? (await handoffForTab(tab.id, currentSite));
    if (!handoffId) {
      return { ok: false, requestId: null, site: currentSite, code: 'HANDOFF_NOT_FOUND' };
    }
    const request: ConsumeHandoffRequest = {
      protocolVersion: 1,
      kind: 'consume-handoff',
      requestId: crypto.randomUUID(),
      handoffId,
    };
    const rawResponse: unknown = await browser.tabs.sendMessage(tab.id, request);
    return consumeHandoffResponseSchema.parse(rawResponse);
  }

  async function handleManualFill() {
    if (!canFillManual) return;
    setWorkingAction('manual');
    setNotice({ tone: 'idle', text: companionMessage('popupFilling') });

    try {
      const response = await fillActivePage(trimmedDraft);
      if (!response.ok) {
        setNotice({
          tone: 'error',
          text: companionMessage(ERROR_MESSAGE_KEY[response.code]),
        });
        return;
      }
      setNotice({
        tone: 'success',
        text: companionMessage('popupManualFillSuccess', [String(response.characterCount)]),
      });
    } catch {
      setNotice({
        tone: 'error',
        text: companionMessage('popupRefreshAndRetry'),
      });
    } finally {
      setWorkingAction(null);
    }
  }

  async function handleDesktopFill() {
    if (!canFillDesktop) return;
    setWorkingAction('desktop');
    setNotice({
      tone: 'idle',
      text: companionMessage('popupConnectingAiy'),
    });

    try {
      const response = await consumeActivePage();
      if (!response.ok) {
        setNotice({
          tone: 'error',
          text: companionMessage(CONSUME_ERROR_MESSAGE_KEY[response.code]),
        });
        return;
      }
      setNotice({
        tone: response.completion === 'completed' ? 'success' : 'error',
        text:
          response.completion === 'completed'
            ? companionMessage('popupDesktopFillSuccess', [
                String(response.characterCount),
                String(response.mediaCount),
              ])
            : companionMessage('popupReceiptFailed'),
      });
    } catch {
      setNotice({
        tone: 'error',
        text: companionMessage('popupRefreshAndRetry'),
      });
    } finally {
      setWorkingAction(null);
    }
  }

  const siteLabel =
    pageState === 'loading'
      ? companionMessage('popupIdentifyingSite')
      : pageState === 'unsupported'
        ? companionMessage('popupUnsupportedSite')
        : companionMessage(SITE_LABEL_KEY[pageState]);

  return (
    <main className="w-[360px] space-y-4 p-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <img src="/icons/icon-32.png" alt="" aria-hidden="true" className="size-5 shrink-0" />
          <h1 className="truncate text-sm font-semibold tracking-tight">{companionMessage('extensionName')}</h1>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
          {companionMessage('popupBadgeNoPublish')}
        </span>
      </header>

      <section className="space-y-2" aria-labelledby="draft-label">
        <div className="flex items-center justify-between gap-3 text-xs">
          <label id="draft-label" htmlFor="draft" className="font-medium">
            {companionMessage('popupSingleContent')}
          </label>
          <span className="tabular-nums text-muted-foreground">{[...draft].length}/10000</span>
        </div>
        <Textarea
          id="draft"
          value={draft}
          maxLength={10_000}
          placeholder={companionMessage('popupPasteText')}
          onChange={(event) => {
            setDraft(event.target.value);
            setNotice({
              tone: 'idle',
              text: companionMessage('popupWaitingToFill'),
            });
          }}
        />
      </section>

      <div className="space-y-3 border-t border-border pt-3">
        <div className="min-w-0 text-xs">
          <div className="font-medium">{siteLabel}</div>
          <output
            aria-live="polite"
            className={
              notice.tone === 'error'
                ? 'block break-words text-red-700'
                : notice.tone === 'success'
                  ? 'block break-words text-emerald-700'
                  : 'block break-words text-muted-foreground'
            }
          >
            {notice.text}
          </output>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            data-action="fill-from-history"
            disabled={!canFillDesktop}
            onClick={() => void handleDesktopFill()}
          >
            {workingAction === 'desktop'
              ? companionMessage('popupConnectingAiy')
              : companionMessage('popupFillFromHistory')}
          </Button>
          <Button disabled={!canFillManual} onClick={() => void handleManualFill()}>
            {workingAction === 'manual' ? companionMessage('popupFilling') : companionMessage('popupFillCurrentPage')}
          </Button>
        </div>
      </div>
      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={tabGroupsAllowed}
          onChange={(event) => {
            const enable = event.target.checked;
            const request = enable
              ? browser.permissions.request({ permissions: ['tabGroups'] })
              : browser.permissions.remove({ permissions: ['tabGroups'] }).then(() => false);
            void request.then(setTabGroupsAllowed).catch(() => setTabGroupsAllowed(false));
          }}
        />
        {companionMessage('popupGroupBatchTabs')}
      </label>
    </main>
  );
}
