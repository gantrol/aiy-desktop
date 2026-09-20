import type {
  ArticleDeliveryConnectionDto,
  ArticleDeliveryJob,
  ArticleDeliveryProgress,
  ArticleDeliveryUploadResult,
} from '@/shared/contracts/article-delivery';
import type { MessageCatalog } from '@/renderer/i18n/types';

export type ArticleDeliveryMessages = MessageCatalog['articleDelivery'];

export function articleDeliveryActive(job: ArticleDeliveryJob) {
  return job.status === 'QUEUED' || job.status === 'RUNNING';
}

export function articleDeliveryStatusLabel(
  job: ArticleDeliveryJob,
  copy: ArticleDeliveryMessages,
  progress?: ArticleDeliveryProgress,
) {
  if (job.status === 'SUCCEEDED') {
    if (job.result?.replayed) return copy.status.replayed;
    if (job.result?.deliveryMode === 'PUBLISH') return copy.status.published;
    return job.result?.deliveryMode === 'DRAFT' ? copy.status.draftUploaded : copy.status.uploaded;
  }
  if (job.status === 'FAILED') return copy.status.failed;
  if (job.status === 'QUEUED') return copy.status.queued;
  if (progress?.phase === 'PREPARING') return copy.status.preparing;
  if (progress?.phase === 'PUBLISHING') {
    if (job.deliveryMode === 'PUBLISH') return copy.status.publishing;
    return job.deliveryMode === 'DRAFT' ? copy.status.submittingDraft : copy.status.submitting;
  }
  if (progress?.phase === 'UPLOADING_MEDIA') {
    return copy.status.uploadingImages
      .replace('{completed}', String(progress.completedMedia))
      .replace('{total}', String(progress.totalMedia));
  }
  return copy.status.uploading;
}

function errorLabel(code: string | null | undefined, copy: ArticleDeliveryMessages) {
  return code && Object.hasOwn(copy.errors, code) ? copy.errors[code as keyof typeof copy.errors] : null;
}

export function articleDeliveryErrorMessage(job: ArticleDeliveryJob, copy: ArticleDeliveryMessages) {
  if (job.errorMessage === 'An article image is unavailable for delivery') {
    return copy.errors.legacyImagePreparation;
  }
  const label = errorLabel(job.errorCode, copy);
  if (label) {
    return job.errorCode?.startsWith('DELIVERY_MEDIA_') && job.errorMessage
      ? copy.errorDetail.replace('{message}', label).replace('{detail}', job.errorMessage)
      : label;
  }
  return copy.errors.DELIVERY_FAILED;
}

export function articleDeliveryRequestErrorMessage(
  reason: unknown,
  copy: ArticleDeliveryMessages,
  fallback = copy.errors.DELIVERY_FAILED,
) {
  if (reason && typeof reason === 'object') {
    const detail = reason as { code?: unknown; errorCode?: unknown };
    const code = typeof detail.code === 'string' ? detail.code : detail.errorCode;
    if (typeof code === 'string') return errorLabel(code, copy) ?? fallback;
  }
  return fallback;
}

export function articleDeliveryConnectionMessage(
  connection: ArticleDeliveryConnectionDto,
  copy: ArticleDeliveryMessages,
) {
  if (connection.state === 'ERROR') return errorLabel(connection.errorCode, copy) ?? copy.connection.failed;
  return copy.connection.states[connection.state];
}

function imageBytesLabel(bytes: number, locale: string) {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`;
}

export function articleDeliveryImageSummary(
  summary: ArticleDeliveryUploadResult['imageSummary'],
  locale: string,
  copy: ArticleDeliveryMessages,
) {
  if (!summary || summary.sourceBytes === 0) return null;
  const sizes = copy.imageSizes
    .replace('{source}', imageBytesLabel(summary.sourceBytes, locale))
    .replace('{upload}', imageBytesLabel(summary.uploadBytes, locale));
  const savings = (1 - summary.uploadBytes / summary.sourceBytes) * 100;
  if (savings < 0.1) return sizes;
  const percent = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(savings);
  return `${sizes} · ${copy.imageSavings.replace('{percent}', percent)}`;
}
