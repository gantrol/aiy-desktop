import type { ArticleDeliveryJob, ArticleDeliveryProgress } from '@/shared/contracts/article-delivery';

export function articleDeliveryActive(job: ArticleDeliveryJob) {
  return job.status === 'QUEUED' || job.status === 'RUNNING';
}

export function articleDeliveryStatusLabel(job: ArticleDeliveryJob, zh: boolean, progress?: ArticleDeliveryProgress) {
  if (job.status === 'SUCCEEDED') return zh ? '已发布' : 'Published';
  if (job.status === 'FAILED') return zh ? '投递失败' : 'Delivery failed';
  if (job.status === 'QUEUED') return zh ? '等待投递' : 'Queued';
  if (progress?.phase === 'PREPARING') return zh ? '正在准备图片' : 'Preparing images';
  if (progress?.phase === 'PUBLISHING') return zh ? '正在发布文章' : 'Publishing article';
  if (progress?.phase === 'UPLOADING_MEDIA') {
    return zh
      ? `正在上传图片 ${progress.completedMedia}/${progress.totalMedia}`
      : `Uploading images ${progress.completedMedia}/${progress.totalMedia}`;
  }
  return zh ? '投递中' : 'Delivering';
}

const mediaErrors: Record<string, readonly [string, string]> = {
  DELIVERY_MEDIA_UNBOUND: [
    '正文图片未关联到素材，请重新插入后投递',
    'Reinsert the unlinked article image and deliver again',
  ],
  DELIVERY_MEDIA_UNAVAILABLE: [
    '图片文件不可读取，请恢复或替换后投递',
    'Restore or replace the unreadable image and deliver again',
  ],
  DELIVERY_MEDIA_UNSUPPORTED: ['投递不支持此素材格式', 'This media format is not supported for delivery'],
  DELIVERY_MEDIA_TOO_LARGE: [
    '图片须在 25 MB 以内，请缩小后投递',
    'Reduce the image to 25 MB or less and deliver again',
  ],
  DELIVERY_MEDIA_CHANGED: ['图片内容已改变，请重新插入后投递', 'The image changed; reinsert it and deliver again'],
  DELIVERY_MEDIA_CONVERSION_FAILED: [
    'SVG 转换失败，请换用 PNG 后投递',
    'SVG conversion failed; use a PNG and deliver again',
  ],
};

export function articleDeliveryErrorMessage(job: ArticleDeliveryJob, zh: boolean) {
  const label = mediaErrors[job.errorCode ?? '']?.[zh ? 0 : 1];
  if (label) return `${label}：${job.errorMessage ?? ''}`;
  if (job.errorMessage === 'An article image is unavailable for delivery') {
    return zh
      ? '旧版投递未能准备图片（包括 SVG）。可重试；新版会转换 SVG 并跳过未使用的图片。'
      : 'An earlier delivery could not prepare its images. Retry to convert SVGs and skip unused images.';
  }
  return job.errorMessage || (zh ? '投递失败，请重试' : 'Delivery failed; please retry');
}
