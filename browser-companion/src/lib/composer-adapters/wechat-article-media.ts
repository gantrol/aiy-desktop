const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
// Match the whole-article clipboard path's bounded embedded-image payload.
const MAX_MEDIA_BYTES = 96 * 1024 * 1024;
const MAX_HTML_BYTES = 132 * 1024 * 1024;

export interface UploadedWechatImage {
  url: string;
  fileId: string;
}

export function isWechatImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' && url.hostname.endsWith('.qpic.cn') && !url.username && !url.password && !url.port
    );
  } catch {
    return false;
  }
}

function readImageDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    const timeout = window.setTimeout(() => reader.abort(), 30_000);
    const finish = (value: string | null) => {
      window.clearTimeout(timeout);
      reader.onload = reader.onerror = reader.onabort = null;
      resolve(value);
    };
    reader.onload = () => finish(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = reader.onabort = () => finish(null);
    try {
      reader.readAsDataURL(file);
    } catch {
      finish(null);
    }
  });
}

export async function embedWechatArticleImages(
  template: HTMLTemplateElement,
  imageIndexes: readonly number[],
  files: readonly File[],
  isCurrent: () => boolean,
): Promise<HTMLTemplateElement | null> {
  const uniqueIndexes = [...new Set(imageIndexes)];
  let mediaBytes = 0;
  for (const index of uniqueIndexes) {
    const file = files[index];
    if (!file || file.size <= 0 || file.size > MAX_IMAGE_BYTES) return null;
    mediaBytes += file.size;
  }
  if (mediaBytes > MAX_MEDIA_BYTES) return null;
  // Account for repeated placements before allocating base64 strings. Each
  // src is ASCII; the unexpanded HTML accounts for all surrounding UTF-8 text.
  const htmlBytes =
    new TextEncoder().encode(template.innerHTML).byteLength +
    imageIndexes.reduce(
      (sum, index) => sum + 4 * Math.ceil(files[index]!.size / 3) + files[index]!.type.length + 16,
      0,
    );
  if (htmlBytes > MAX_HTML_BYTES) return null;
  const embedded = template.cloneNode(true) as HTMLTemplateElement;
  const images = [...embedded.content.querySelectorAll('img')];
  if (images.length !== imageIndexes.length) return null;
  // Read one bounded file at a time and reuse its data URL at every placement.
  // Uploading is owned by WeChat's whole-HTML paste pipeline, not this helper.
  for (const index of uniqueIndexes) {
    if (!isCurrent()) return null;
    const dataUrl = await readImageDataUrl(files[index]!);
    if (!dataUrl || !isCurrent()) return null;
    images.forEach((image, position) => {
      if (imageIndexes[position] === index) image.setAttribute('src', dataUrl);
    });
  }
  return isCurrent() ? embedded : null;
}
