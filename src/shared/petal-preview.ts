import { z } from 'zod';
import { contentMarkdownText } from '@/shared/content-markdown';

export const petalPreviewRequestSchema = z
  .object({
    id: z.string().min(1).max(200),
    token: z.string().uuid(),
    open: z.boolean(),
  })
  .strict();
export const petalPreviewSchema = z.object({
  title: z.string(),
  text: z.string(),
  mediaUrl: z.string().nullable(),
});
export type PetalPreviewRequest = z.infer<typeof petalPreviewRequestSchema>;
export type PetalPreviewContent = z.infer<typeof petalPreviewSchema>;

export function petalPreviewText(body: string) {
  return contentMarkdownText(body.replace(/^:::aiy-block [A-Za-z0-9_-]+\r?\n:::[ \t]*$/gmu, ''), () => '').trim();
}

/** Content-derived labels are presentation only; never write them back as titles. */
export function petalLabel(title: string, body: string) {
  if (title.trim()) return title.trim();
  const firstLine =
    petalPreviewText(body)
      .split(/\r?\n/u)
      .find((line) => line.trim()) ?? '';
  return Array.from(firstLine.trim()).slice(0, 48).join('');
}
