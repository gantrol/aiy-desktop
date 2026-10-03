import { companionMessage, type CompanionMessageKey } from '@/lib/i18n';
import type { CompanionSite, FillDraftErrorCode, ConsumeHandoffErrorCode } from '@/lib/protocol';
import type { CurrentHandoffSnapshot } from '@/lib/current-handoff-protocol';

export const STAGE_KEYS: Record<CurrentHandoffSnapshot['stage'], CompanionMessageKey> = {
  idle: 'handoffStageIdle',
  connecting: 'handoffStageConnecting',
  downloading: 'handoffStageDownloading',
  'waiting-editor': 'handoffStageWaitingEditor',
  'waiting-confirmation': 'handoffStageWaitingConfirmation',
  writing: 'handoffStageWriting',
  uploading: 'handoffStageUploading',
  receipt: 'handoffStageReceipt',
};

export const SITE_LABEL_KEY: Record<CompanionSite, CompanionMessageKey> = {
  chatgpt: 'siteChatgpt',
  wechat: 'siteWechat',
  weibo: 'siteWeibo',
  x: 'siteX',
  xiaohongshu: 'siteXiaohongshu',
};

export const ERROR_MESSAGE_KEY: Record<FillDraftErrorCode, CompanionMessageKey> = {
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

export const CONSUME_ERROR_MESSAGE_KEY: Record<ConsumeHandoffErrorCode, CompanionMessageKey> = {
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

export function statusCopy(snapshot: CurrentHandoffSnapshot | null) {
  if (!snapshot)
    return { title: companionMessage('popupConnectingAiy'), detail: '', tone: 'normal', action: 'check' as const };
  const stateKeys = {
    waiting: 'handoffStageWaitingEditor',
    ready: 'handoffReady',
    filling: 'popupFilling',
    delivered: 'handoffDelivered',
    receipt: 'handoffReceipt',
    media: 'handoffMediaUnknown',
    failed: 'handoffFailed',
    empty: 'handoffEmpty',
    offline: 'handoffOffline',
    unsupported: 'handoffUnsupported',
    unknown: 'handoffUnknown',
  } satisfies Record<CurrentHandoffSnapshot['state'], CompanionMessageKey>;
  const { state, code } = snapshot;
  if (snapshot.stage !== 'idle')
    return {
      title: companionMessage(STAGE_KEYS[snapshot.stage]),
      detail: '',
      tone: 'normal',
      action: 'check' as const,
    };
  const title =
    state === 'failed' && code === 'COMPOSER_NOT_FOUND'
      ? companionMessage('handoffNoComposer')
      : companionMessage(stateKeys[state]);
  const detail =
    state === 'media' || state === 'unknown'
      ? companionMessage('handoffInspectBeforeRetry')
      : state === 'receipt'
        ? companionMessage('handoffReceiptDetail')
        : state === 'delivered'
          ? companionMessage('handoffDeliveredDetail')
          : code && code !== 'RECEIPT_PENDING' && code !== 'FILL_RESULT_UNKNOWN'
            ? companionMessage(CONSUME_ERROR_MESSAGE_KEY[code])
            : '';
  const action =
    state === 'ready' ||
    (state === 'failed' &&
      snapshot.task?.state === 'ready' &&
      snapshot.connection === 'connected' &&
      code !== 'COMPOSER_NOT_FOUND' &&
      code !== 'COMPOSER_AMBIGUOUS' &&
      code !== 'MEDIA_INPUT_NOT_FOUND')
      ? 'fill'
      : state === 'receipt' && snapshot.canRetryReceipt
        ? 'receipt'
        : ['delivered', 'media', 'unknown'].includes(state)
          ? 'page'
          : ['empty', 'unsupported'].includes(state)
            ? 'aiy'
            : 'check';
  return {
    title,
    detail,
    tone: ['media', 'receipt', 'unknown'].includes(state)
      ? 'warning'
      : ['failed', 'offline'].includes(state)
        ? 'error'
        : state === 'delivered'
          ? 'success'
          : 'normal',
    action,
  };
}
