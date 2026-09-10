import { z } from 'zod';
import { codexThreadHref, parseCodexThreadHref } from '@/shared/contracts/codex-thread';

export function linkCardTarget(value: unknown) {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\u0000-\u001f<>]/u.test(value)) return null;
  const threadId = parseCodexThreadHref(value);
  if (threadId) return { kind: 'CODEX' as const, url: codexThreadHref(threadId), threadId };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
  const twitter = /^(?:(?:www|mobile|m)\.)?(?:twitter|x)\.com$/u.test(url.hostname);
  const post = twitter
    ? /^\/(?:([A-Za-z0-9_]{1,15})\/status|i\/(?:web\/)?status)\/(\d{1,25})(?:\/(?:photo|video)\/\d+)?\/?$/u.exec(
        url.pathname,
      )
    : null;
  return post
    ? {
        kind: 'X' as const,
        url: url.href,
        postId: post[2],
        embedUrl: `https://twitter.com/${post[1] || 'i'}/status/${post[2]}`,
      }
    : { kind: 'WEB' as const, url: url.href };
}

export const linkCardUrlSchema = z
  .string()
  .max(4096)
  .refine((value) => linkCardTarget(value) !== null);
/** Optional relationship owned by the contributing application, stored with the document. */
export const linkCardApplicationSchema = z
  .object({
    id: z
      .string()
      .min(3)
      .max(160)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
    relation: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Z][A-Z_]*$/u),
  })
  .strict();
export type LinkCardApplication = z.infer<typeof linkCardApplicationSchema>;
export const linkCardAttributesSchema = z.object({
  url: linkCardUrlSchema,
  title: z.string().max(500).nullable().optional(),
  application: linkCardApplicationSchema.nullable().optional(),
});
export type LinkCardAttributes = z.infer<typeof linkCardAttributesSchema>;
export const linkPreviewSchema = z.object({
  url: linkCardUrlSchema,
  kind: z.enum(['CODEX', 'X', 'WEB']),
  title: z.string().max(500),
  siteName: z.string().max(200),
  image: z
    .string()
    .max(350_000)
    .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/u)
    .nullable(),
  quote: z.string().max(20_000).nullable(),
  author: z.string().max(200).nullable(),
  available: z.boolean(),
});
export type LinkPreview = z.infer<typeof linkPreviewSchema>;

export function fallbackLinkPreview(url: string): LinkPreview {
  const target = linkCardTarget(url);
  return {
    url,
    kind: target?.kind ?? 'WEB',
    title: '',
    siteName: target?.kind === 'CODEX' ? 'Codex' : target?.kind === 'X' ? 'X' : new URL(url).hostname,
    image: null,
    quote: null,
    author: null,
    available: target?.kind === 'CODEX',
  };
}
