import '@/components/composer-conflict-prompt.css';
import '@/components/automatic-handoff-notice.css';
import '@/components/chatgpt-output-return.css';

import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { COMPOSER_CONTENT_SCRIPT_OPTIONS } from '@/lib/composer-registration';

import { requestComposerReplacementConfirmation } from '@/components/composer-conflict-prompt';
import {
  captureComposerMediaSnapshot,
  composerReady,
  confirmComposerMedia,
  fillComposer,
  openComposer,
} from '@/lib/composer';
import {
  chatGptConversationSourceUrl,
  mountChatGptOutputReturnButtons,
  readChatGptOutputFile,
  rememberChatGptOutputHandoff,
} from '@/lib/chatgpt-output-return';
import { companionMessage } from '@/lib/i18n';
import { uploadCompanionOutput } from '@/lib/loopback-client';
import { CurrentHandoffSession } from '@/lib/current-handoff';
import {
  COMPOSER_WAIT_MS,
  currentHandoffRequestSchema,
  type CurrentHandoffSnapshot,
  type HandoffFillStage,
} from '@/lib/current-handoff-protocol';
import {
  consumeHandoffRequestSchema,
  fillDraftRequestSchema,
  handoffIdFromUrl,
  removeHandoffIdFromUrl,
  resolveSiteFromUrl,
  type CompanionSite,
  type ConsumeHandoffErrorCode,
  type ConsumeHandoffRequest,
  type ConsumeHandoffResponse,
  type FillDraftResponse,
} from '@/lib/protocol';

const COMPOSER_RETRY_MS = 300;
const MEDIA_CONFIRM_WAIT_MS = 90_000;
const DESKTOP_CONNECTION_RETRY_BASE_MS = 250;
const DESKTOP_CONNECTION_RETRY_MAX_MS = 2_000;
const DESKTOP_CONNECTION_RETRY_WINDOW_MS = 20_000;
const CLAIM_RECOVERY_GRACE_MS = 250;
const WECHAT_PENDING_HANDOFF_KEY = 'aiy-wechat-handoff-id';
const WECHAT_PENDING_CONTENT_KEY = 'aiy-wechat-handoff-content';
const AUTOMATIC_HANDOFF_NOTICE_TIMEOUT_MS = 12_000;

function automaticHandoffNoticeCopy(code: ConsumeHandoffErrorCode): {
  title: string;
  detail: string;
} {
  const xiaohongshuError = {
    XIAOHONGSHU_TITLE_TOO_LONG: 'errorXiaohongshuTitleTooLong',
    XIAOHONGSHU_BODY_TOO_LONG: 'errorXiaohongshuBodyTooLong',
    XIAOHONGSHU_MEDIA_UNSUPPORTED: 'errorXiaohongshuMediaUnsupported',
    XIAOHONGSHU_LOGIN_REQUIRED: 'errorXiaohongshuLoginRequired',
  } as const;
  if (code in xiaohongshuError) {
    return {
      title: companionMessage('automaticHandoffFailedTitle'),
      detail: companionMessage(xiaohongshuError[code as keyof typeof xiaohongshuError]),
    };
  }
  if (code === 'MEDIA_UNSUPPORTED' || code === 'COMPOSER_HAS_MEDIA') {
    return {
      title: companionMessage('automaticHandoffFailedTitle'),
      detail: companionMessage(code === 'MEDIA_UNSUPPORTED' ? 'errorMediaUnsupported' : 'errorComposerHasMedia'),
    };
  }
  if (code === 'DESKTOP_CONNECTION_FAILED') {
    return {
      title: companionMessage('automaticHandoffFailedTitle'),
      detail: companionMessage('automaticHandoffDesktopDetail'),
    };
  }
  if (code === 'MEDIA_DOWNLOAD_FAILED') {
    return {
      title: companionMessage('automaticHandoffFailedTitle'),
      detail: companionMessage('automaticHandoffMediaDetail'),
    };
  }
  return {
    title: companionMessage('automaticHandoffFailedTitle'),
    detail: companionMessage('automaticHandoffGenericDetail'),
  };
}

function requestIdFromUnknown(message: unknown): string | null {
  if (!message || typeof message !== 'object' || !('requestId' in message)) return null;
  const parsed = fillDraftRequestSchema.shape.requestId.safeParse(Reflect.get(message, 'requestId'));
  return parsed.success ? parsed.data : null;
}

async function fillWhenReady(
  ctx: ContentScriptContext,
  site: CompanionSite,
  requestId: string,
  text: string,
  mediaFiles: readonly File[],
  title?: string,
  contentKind?: string,
  articleHtml?: string,
  articleCoverMediaIndex?: number,
  beforeMutation?: () => Promise<void>,
  onStage?: (stage: HandoffFillStage) => void,
): Promise<FillDraftResponse> {
  if (document.readyState === 'loading') {
    await new Promise<void>((resolve) =>
      document.addEventListener('DOMContentLoaded', () => resolve(), {
        once: true,
      }),
    );
  }
  const deadline = Date.now() + COMPOSER_WAIT_MS;
  let replaceExisting = false;
  let composerConflictHandled = false;
  let mutationAttempted = false;
  while (true) {
    if (ctx.isInvalid) return { ok: false, requestId, site, code: 'FILL_FAILED' };
    const mediaSnapshot = mediaFiles.length > 0 ? captureComposerMediaSnapshot(site, contentKind) : null;
    const result = await fillComposer(site, requestId, text, mediaFiles, {
      replaceExisting,
      title,
      contentKind,
      articleHtml,
      articleCoverMediaIndex,
      beforeMutation: async () => {
        if (ctx.isInvalid) throw new Error('Content context expired');
        mutationAttempted = true;
        await beforeMutation?.();
        if (ctx.isInvalid) throw new Error('Content context expired');
      },
    });
    // An adapter may upload before it finds a text editor. Never repeat that attempt.
    if (!result.ok && mutationAttempted) return result;
    if (!result.ok && result.code === 'COMPOSER_NOT_EMPTY' && !composerConflictHandled) {
      composerConflictHandled = true;
      onStage?.('waiting-confirmation');
      replaceExisting = await requestComposerReplacementConfirmation(ctx, site);
      if (replaceExisting) continue;
      return result;
    }
    if (result.ok) {
      if (mediaFiles.length > 0) onStage?.('uploading');
      const confirmed = await confirmComposerMedia(site, mediaFiles, mediaSnapshot, MEDIA_CONFIRM_WAIT_MS, contentKind);
      return confirmed ? result : { ok: false, requestId, site, code: 'MEDIA_FILL_FAILED' };
    }
    const waitingForStableComposer =
      result.code === 'COMPOSER_NOT_FOUND' ||
      result.code === 'COMPOSER_AMBIGUOUS' ||
      result.code === 'MEDIA_INPUT_NOT_FOUND';
    if (!waitingForStableComposer) return result;
    if (Date.now() >= deadline) return result;
    await new Promise((resolve) => window.setTimeout(resolve, COMPOSER_RETRY_MS));
  }
}

export default defineContentScript({
  ...COMPOSER_CONTENT_SCRIPT_OPTIONS,
  // The background registers dev scripts locally; WXT only updates them on reload.
  registration: import.meta.env.COMMAND === 'serve' ? 'runtime' : 'manifest',
  cssInjectionMode: 'ui',
  main(ctx) {
    let active = false;
    let handledHandoffId: string | null = null;
    let automaticRetry: {
      handoffId: string;
      deadline: number;
      attempt: number;
      timer: number | null;
    } | null = null;
    let claimRecoveryRetry: { handoffId: string; timer: number | null } | null = null;
    let automaticHandoffNoticeTimer: number | null = null;

    function dismissAutomaticHandoffNotice(): void {
      if (automaticHandoffNoticeTimer !== null) {
        window.clearTimeout(automaticHandoffNoticeTimer);
        automaticHandoffNoticeTimer = null;
      }
      document.querySelector('[data-aiy-automatic-handoff-notice]')?.remove();
    }

    function showNotice(titleText: string, detailText: string, tone: 'error' | 'success'): void {
      if (window.top !== window) return;

      dismissAutomaticHandoffNotice();
      const notice = document.createElement('div');
      notice.dataset.aiyAutomaticHandoffNotice = '';
      notice.dataset.tone = tone;
      notice.setAttribute('role', 'alert');
      notice.setAttribute('aria-live', 'assertive');

      const icon = document.createElement('span');
      icon.dataset.aiyAutomaticHandoffIcon = '';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = tone === 'success' ? '✓' : '!';

      const content = document.createElement('div');
      const title = document.createElement('strong');
      title.dataset.aiyAutomaticHandoffTitle = '';
      title.textContent = titleText;
      const detail = document.createElement('span');
      detail.dataset.aiyAutomaticHandoffDetail = '';
      detail.textContent = detailText;
      content.append(title, detail);
      notice.append(icon, content);

      (document.body ?? document.documentElement).append(notice);
      automaticHandoffNoticeTimer = window.setTimeout(
        dismissAutomaticHandoffNotice,
        AUTOMATIC_HANDOFF_NOTICE_TIMEOUT_MS,
      );
    }

    function showAutomaticHandoffNotice(code: ConsumeHandoffErrorCode): void {
      const copy = automaticHandoffNoticeCopy(code);
      showNotice(copy.title, copy.detail, 'error');
    }

    async function returnChatGptOutput(image: HTMLImageElement, handoffId: string): Promise<boolean> {
      try {
        const file = await readChatGptOutputFile(image);
        const response = await uploadCompanionOutput('chatgpt', handoffId, chatGptConversationSourceUrl(), file);
        if (response.kind !== 'output-imported') throw new Error(response.kind);
        showNotice(
          companionMessage('chatgptOutputReturnSuccessTitle'),
          companionMessage(response.adopted ? 'chatgptOutputReturnAdoptedDetail' : 'chatgptOutputReturnImportedDetail'),
          'success',
        );
        return true;
      } catch (reason) {
        showNotice(
          companionMessage('chatgptOutputReturnFailedTitle'),
          companionMessage('chatgptOutputReturnFailedDetail'),
          'error',
        );
        console.warn(`[${companionMessage('extensionName')}] ChatGPT output return failed`, reason);
        return false;
      }
    }

    const outputReturnButtons =
      window.top === window && resolveSiteFromUrl(window.location.href) === 'chatgpt'
        ? mountChatGptOutputReturnButtons({ onSelect: returnChatGptOutput })
        : null;
    ctx.onInvalidated(() => outputReturnButtons?.dispose());

    function clearScheduledRetries(): void {
      if (automaticRetry?.timer != null) window.clearTimeout(automaticRetry.timer);
      automaticRetry = null;
      if (claimRecoveryRetry?.timer != null) window.clearTimeout(claimRecoveryRetry.timer);
      claimRecoveryRetry = null;
    }

    function scheduleAutomaticRetry(handoffId: string): boolean {
      const now = Date.now();
      if (!automaticRetry || automaticRetry.handoffId !== handoffId) {
        automaticRetry = {
          handoffId,
          deadline: now + DESKTOP_CONNECTION_RETRY_WINDOW_MS,
          attempt: 0,
          timer: null,
        };
      }
      if (now >= automaticRetry.deadline) return false;

      const retry = automaticRetry;
      const delay = Math.min(
        DESKTOP_CONNECTION_RETRY_BASE_MS * 2 ** Math.min(retry.attempt, 4),
        DESKTOP_CONNECTION_RETRY_MAX_MS,
      );
      retry.attempt += 1;
      retry.timer = window.setTimeout(() => {
        if (ctx.isInvalid || automaticRetry?.handoffId !== handoffId) return;
        automaticRetry.timer = null;
        void consumeHandoffFromUrl();
      }, delay);
      return true;
    }

    function scheduleClaimRecovery(handoffId: string, claimExpiresAt: string): boolean {
      const expiresAt = Date.parse(claimExpiresAt);
      if (!Number.isFinite(expiresAt)) return false;
      clearScheduledRetries();
      const retry = { handoffId, timer: null as number | null };
      claimRecoveryRetry = retry;
      retry.timer = window.setTimeout(
        () => {
          if (ctx.isInvalid || claimRecoveryRetry?.handoffId !== handoffId) return;
          claimRecoveryRetry = null;
          void consumeHandoffFromUrl();
        },
        Math.max(0, expiresAt - Date.now()) + CLAIM_RECOVERY_GRACE_MS,
      );
      return true;
    }

    const currentHandoff = new CurrentHandoffSession({
      ready: composerReady,
      waitReady: async (site, contentKind) => {
        if (site !== 'chatgpt') return true;
        const deadline = Date.now() + COMPOSER_WAIT_MS;
        let readyChecks = 0;
        while (Date.now() < deadline && !ctx.isInvalid) {
          readyChecks = composerReady(site, contentKind) ? readyChecks + 1 : 0;
          if (readyChecks >= 2) return true;
          await new Promise((resolve) => window.setTimeout(resolve, COMPOSER_RETRY_MS));
        }
        return false;
      },
      fill: (site, requestId, handoff, files, beforeMutation, onStage) =>
        fillWhenReady(
          ctx,
          site,
          requestId,
          handoff.text,
          files,
          handoff.title ?? undefined,
          handoff.contentKind,
          handoff.articleHtml,
          handoff.articleCoverMediaIndex,
          beforeMutation,
          onStage,
        ),
      delivered: (handoff) => {
        if (handoffIdFromUrl(window.location.href) === handoff.handoffId) {
          try {
            window.history.replaceState(window.history.state, '', removeHandoffIdFromUrl(window.location.href));
          } catch {
            /* Delivery does not depend on URL cleanup. */
          }
        }
        if (rememberChatGptOutputHandoff(handoff)) outputReturnButtons?.refresh();
      },
    });

    async function consumeHandoff(
      request: ConsumeHandoffRequest,
      site: CompanionSite,
    ): Promise<ConsumeHandoffResponse> {
      if (active) return { ok: false, requestId: request.requestId, site, code: 'BUSY' };
      active = true;
      try {
        return await currentHandoff.consume(request, site);
      } finally {
        active = false;
      }
    }

    async function consumeHandoffFromUrl(): Promise<void> {
      const site = resolveSiteFromUrl(window.location.href);
      if (window.top !== window) return;
      const urlHandoffId = handoffIdFromUrl(window.location.href);
      let contentKind =
        new URLSearchParams(window.location.hash.slice(1)).get('aiy-content') === 'article-body'
          ? 'article-body'
          : 'social-post-body';
      if (site === 'wechat' && urlHandoffId) {
        try {
          window.sessionStorage.setItem(WECHAT_PENDING_HANDOFF_KEY, urlHandoffId);
          window.sessionStorage.setItem(WECHAT_PENDING_CONTENT_KEY, contentKind);
        } catch {
          // The URL still carries the handoff ID when session storage is unavailable.
        }
      }
      let storedHandoffId: string | null = null;
      if (site === 'wechat' && !urlHandoffId) {
        try {
          const stored = window.sessionStorage.getItem(WECHAT_PENDING_HANDOFF_KEY);
          storedHandoffId = stored
            ? handoffIdFromUrl(`https://mp.weixin.qq.com/#aiy-handoff=${encodeURIComponent(stored)}`)
            : null;
          contentKind =
            window.sessionStorage.getItem(WECHAT_PENDING_CONTENT_KEY) === 'article-body'
              ? 'article-body'
              : 'social-post-body';
        } catch {
          storedHandoffId = null;
        }
      }
      const handoffId = urlHandoffId ?? storedHandoffId;
      if (!handoffId || !site) {
        clearScheduledRetries();
        return;
      }
      if (handledHandoffId === handoffId) return;
      if (automaticRetry?.timer != null) {
        window.clearTimeout(automaticRetry.timer);
        automaticRetry.timer = null;
      }
      if (claimRecoveryRetry?.timer != null) window.clearTimeout(claimRecoveryRetry.timer);
      claimRecoveryRetry = null;

      if (site === 'wechat') {
        const deadline = Date.now() + COMPOSER_WAIT_MS;
        while (!composerReady(site, contentKind) && Date.now() < deadline && !ctx.isInvalid) {
          await openComposer(site, handoffId, contentKind);
          await new Promise((resolve) => window.setTimeout(resolve, COMPOSER_RETRY_MS));
        }
        if (ctx.isInvalid) return;
        if (!composerReady(site, contentKind)) {
          showAutomaticHandoffNotice('COMPOSER_NOT_FOUND');
          return;
        }
      }
      if (active || handledHandoffId === handoffId) return;
      handledHandoffId = handoffId;
      const response = await consumeHandoff(
        {
          protocolVersion: 1,
          kind: 'consume-handoff',
          requestId: crypto.randomUUID(),
          handoffId,
        },
        site,
      );
      if (!response.ok) {
        if (response.code === 'DESKTOP_CONNECTION_FAILED') {
          handledHandoffId = null;
          if (scheduleAutomaticRetry(handoffId)) return;
        }
        const currentTask = currentHandoff.snapshot().task;
        if (
          response.code === 'DRAFT_ALREADY_CLAIMED' &&
          currentTask?.handoffId === handoffId &&
          currentTask.state === 'claimed' &&
          !currentTask.fillStarted &&
          currentTask.claimExpiresAt
        ) {
          handledHandoffId = null;
          if (scheduleClaimRecovery(handoffId, currentTask.claimExpiresAt)) return;
        }
        clearScheduledRetries();
        showAutomaticHandoffNotice(response.code);
        console.warn(
          `[${companionMessage('extensionName')}] ${companionMessage('automaticHandoffLogSummary')}: code=${response.code}; handoffId=${handoffId}; action=${companionMessage('automaticHandoffRetryAction')}`,
        );
      } else {
        clearScheduledRetries();
        dismissAutomaticHandoffNotice();
      }
      if (response.ok && site === 'wechat') {
        try {
          window.sessionStorage.removeItem(WECHAT_PENDING_HANDOFF_KEY);
          window.sessionStorage.removeItem(WECHAT_PENDING_CONTENT_KEY);
        } catch {
          // Successful delivery does not depend on storage cleanup.
        }
      }
    }

    browser.runtime.onMessage.addListener(
      async (
        message: unknown,
        sender,
      ): Promise<FillDraftResponse | ConsumeHandoffResponse | CurrentHandoffSnapshot | undefined> => {
        if (window.top !== window || sender.id !== browser.runtime.id || sender.tab) return undefined;
        const panelRequest = currentHandoffRequestSchema.safeParse(message);
        if (panelRequest.success) {
          const site = resolveSiteFromUrl(window.location.href);
          if (panelRequest.data.kind === 'retry-handoff-receipt' && site) {
            return currentHandoff.retryReceipt(site, panelRequest.data.handoffId);
          }
          return currentHandoff.inspect(site, panelRequest.data.handoffId);
        }
        const consumeRequest = consumeHandoffRequestSchema.safeParse(message);
        const site = resolveSiteFromUrl(window.location.href);
        if (consumeRequest.success) {
          if (!site) {
            return {
              ok: false,
              requestId: consumeRequest.data.requestId,
              site: null,
              code: 'UNSUPPORTED_SITE',
            };
          }
          if (site === 'wechat' && !composerReady(site) && !composerReady(site, 'article-body')) {
            return {
              ok: false,
              requestId: consumeRequest.data.requestId,
              site,
              code: 'COMPOSER_NOT_FOUND',
            };
          }
          return consumeHandoff(consumeRequest.data, site);
        }

        const parsed = fillDraftRequestSchema.safeParse(message);

        if (!parsed.success) {
          return {
            ok: false,
            requestId: requestIdFromUnknown(message),
            site,
            code: 'INVALID_REQUEST',
          };
        }

        if (!site) {
          return {
            ok: false,
            requestId: parsed.data.requestId,
            site: null,
            code: 'UNSUPPORTED_SITE',
          };
        }

        if (active) {
          return {
            ok: false,
            requestId: parsed.data.requestId,
            site,
            code: 'BUSY',
          };
        }

        active = true;
        try {
          return await fillWhenReady(ctx, site, parsed.data.requestId, parsed.data.draft, [], undefined);
        } catch {
          return {
            ok: false,
            requestId: parsed.data.requestId,
            site,
            code: 'FILL_FAILED',
          };
        } finally {
          active = false;
        }
      },
    );

    window.addEventListener('hashchange', () => void consumeHandoffFromUrl());
    void consumeHandoffFromUrl();
  },
});
