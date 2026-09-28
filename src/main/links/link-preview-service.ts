import { nativeImage, shell } from 'electron';
import { z } from 'zod';
import { fetchLinkResource } from '@/main/links/link-preview-fetch';
import { openGraphMetadata, tweetQuote } from '@/main/links/link-preview-metadata';
import { LINK_PREVIEW_CONCURRENCY } from '@/main/links/link-preview-proxy';
import { imageDimensions } from '@/main/media/image-dimensions';
import {
  fallbackLinkPreview,
  linkCardTarget,
  linkCardUrlSchema,
  linkPreviewSchema,
  type LinkPreview,
  type LinkPreviewFailure,
} from '@/shared/contracts/link-card';

const oEmbedSchema = z.object({
  type: z.literal('rich'),
  html: z.string().max(100_000),
  author_name: z.string().max(200).optional(),
});

function previewFailure(error: unknown, stage: LinkPreviewFailure['stage'], signal: AbortSignal): LinkPreviewFailure {
  if (signal.aborted) return { stage, code: 'TIMEOUT' };
  const message = error instanceof Error ? error.message : '';
  const codes: Record<string, LinkPreviewFailure['code']> = {
    LINK_PREVIEW_ADDRESS_BLOCKED: 'ADDRESS_BLOCKED',
    LINK_PREVIEW_URL_BLOCKED: 'ADDRESS_BLOCKED',
    LINK_PREVIEW_PROXY_UNAVAILABLE: 'PROXY',
    LINK_PREVIEW_RESPONSE_UNAVAILABLE: 'HTTP',
    LINK_PREVIEW_RESPONSE_TOO_LARGE: 'TOO_LARGE',
    LINK_PREVIEW_TOO_MANY_REDIRECTS: 'HTTP',
    LINK_PREVIEW_BUSY: 'BUSY',
  };
  return { stage, code: codes[message] ?? 'NETWORK' };
}

async function thumbnail(url: string, signal: AbortSignal) {
  const response = await fetchLinkResource(url, signal, 2_000_000, 'image/jpeg,image/png,image/webp');
  const extension = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[
    response.contentType.split(';')[0].trim().toLowerCase()
  ];
  if (!extension) return null;
  const size = imageDimensions(response.bytes, extension);
  if (!size || size.width < 1 || size.height < 1 || size.width * size.height > 16_000_000) return null;
  const image = nativeImage.createFromBuffer(response.bytes);
  if (image.isEmpty()) return null;
  const scale = Math.min(1, 480 / size.width, 320 / size.height);
  const bytes = image
    .resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
    })
    .toJPEG(80);
  return bytes.length <= 250_000 ? `data:image/jpeg;base64,${bytes.toString('base64')}` : null;
}

async function loadPreview(url: string, signal: AbortSignal): Promise<LinkPreview> {
  signal.throwIfAborted();
  const target = linkCardTarget(url)!;
  const fallback = fallbackLinkPreview(url);
  if (target.kind === 'CODEX') return fallback;
  if (target.kind === 'X') {
    const endpoint = new URL('https://publish.twitter.com/oembed');
    endpoint.search = new URLSearchParams({
      url: target.embedUrl,
      omit_script: 'true',
      dnt: 'true',
      hide_thread: 'true',
    }).toString();
    const response = await fetchLinkResource(endpoint.href, signal, 128_000, 'application/json');
    const data = oEmbedSchema.parse(JSON.parse(response.bytes.toString('utf8')));
    const quote = tweetQuote(data.html);
    return {
      ...fallback,
      author: data.author_name ?? null,
      quote,
      available: Boolean(quote),
      failure: quote ? null : { stage: 'page', code: 'UNSUPPORTED' },
    };
  }
  const response = await fetchLinkResource(url, signal, 512_000, 'text/html,application/xhtml+xml', true);
  if (!/^(?:text\/html|application\/xhtml\+xml)\b/iu.test(response.contentType))
    return { ...fallback, failure: { stage: 'page', code: 'UNSUPPORTED' } };
  const charset = /charset\s*=\s*["']?([\w-]+)/iu.exec(response.contentType)?.[1] ?? 'utf-8';
  let html: string;
  try {
    html = new TextDecoder(charset).decode(response.bytes);
  } catch {
    html = response.bytes.toString('utf8');
  }
  const metadata = openGraphMetadata(html, response.url);
  let image: string | null = null;
  let failure: LinkPreviewFailure | null = null;
  if (metadata.imageUrl) {
    try {
      image = await thumbnail(metadata.imageUrl, signal);
      if (!image) failure = { stage: 'image', code: 'UNSUPPORTED' };
    } catch (error) {
      failure = previewFailure(error, 'image', signal);
    }
  }
  const available = Boolean(metadata.title || image);
  if (!available && !failure) failure = { stage: 'page', code: 'UNSUPPORTED' };
  return { ...fallback, title: metadata.title, siteName: metadata.siteName, image, available, failure };
}

/** Visible cards share bounded, short-lived previews; saving documents never waits for the network. */
class LinkPreviewService {
  private readonly cache = new Map<string, { value: LinkPreview; expires: number; bytes: number }>();
  private readonly pending = new Map<string, Promise<LinkPreview>>();
  private readonly queue: (() => void)[] = [];
  private active = 0;
  private cachedBytes = 0;

  async get(raw: string, refresh = false): Promise<LinkPreview> {
    const url = linkCardUrlSchema.parse(raw);
    const cached = this.cache.get(url);
    if (!refresh && cached && cached.expires > Date.now()) return cached.value;
    const pending = this.pending.get(url);
    if (pending) return pending;
    if (this.pending.size >= 64) return { ...fallbackLinkPreview(url), failure: { stage: 'page', code: 'BUSY' } };
    const promise = this.run(url);
    this.pending.set(url, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(url);
    }
  }

  private async run(url: string) {
    if (this.active >= LINK_PREVIEW_CONCURRENCY) await new Promise<void>((resolve) => this.queue.push(resolve));
    else this.active++;
    const signal = AbortSignal.timeout(8_000);
    try {
      const value = linkPreviewSchema.parse(
        await loadPreview(url, signal).catch((error: unknown) => ({
          ...fallbackLinkPreview(url),
          failure: previewFailure(error, 'page', signal),
        })),
      );
      this.cachedBytes -= this.cache.get(url)?.bytes ?? 0;
      this.cache.delete(url);
      const bytes = JSON.stringify(value).length * 2;
      this.cache.set(url, {
        value,
        bytes,
        expires: Date.now() + (value.available && !value.failure ? 600_000 : 60_000),
      });
      this.cachedBytes += bytes;
      while (this.cache.size > 64 || this.cachedBytes > 8_000_000) {
        const key = this.cache.keys().next().value!;
        this.cachedBytes -= this.cache.get(key)!.bytes;
        this.cache.delete(key);
      }
      return value;
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}

export const linkPreviews = new LinkPreviewService();

export function openLinkCard(raw: string) {
  const target = linkCardTarget(linkCardUrlSchema.parse(raw))!;
  return shell.openExternal(target.url);
}
