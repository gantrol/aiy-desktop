import { z } from 'zod';
import { articleDeliveryExtensionTargetSchema } from '@/shared/contracts/article-delivery';
import { browserCompanionTargetSchema } from '@/shared/contracts/browser-companion';

const apiTargetSchema = articleDeliveryExtensionTargetSchema.extend({
  kind: z.literal('API'),
  imageMode: z.enum(['BALANCED', 'ORIGINAL']),
});
const browserTargetSchema = z
  .object({
    kind: z.literal('BROWSER'),
    target: browserCompanionTargetSchema.exclude(['chatgpt']),
  })
  .strict();
const targetSchema = z.discriminatedUnion('kind', [apiTargetSchema, browserTargetSchema]);

export type ArticleUploadTarget = z.infer<typeof targetSchema>;

export function articleUploadTargetKey(target: ArticleUploadTarget): string {
  return target.kind === 'API'
    ? JSON.stringify([target.kind, target.extensionId, target.channelId])
    : JSON.stringify([target.kind, target.target]);
}

export const articleDeliveryPreferencesSchema = z
  .object({
    version: z.literal(1),
    targets: z
      .array(targetSchema)
      .max(32)
      .refine((targets) => new Set(targets.map(articleUploadTargetKey)).size === targets.length),
    wechatMode: z.enum(['article', 'images']),
  })
  .strict();

export type ArticleDeliveryPreferences = z.infer<typeof articleDeliveryPreferencesSchema>;
export type ArticleDeliveryPreferenceSource = 'ARTICLE' | 'DEFAULT' | 'NONE';

const PREFIX = 'aiy.article-delivery.selection.v1';
const DEFAULT_KEY = `${PREFIX}.default`;
const articleKey = (spaceId: string, articleId: string) => `${PREFIX}.article.${JSON.stringify([spaceId, articleId])}`;

function read(key: string): ArticleDeliveryPreferences | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw || raw.length > 32_000) return null;
    const parsed = articleDeliveryPreferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function write(key: string, preferences: ArticleDeliveryPreferences): boolean {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(articleDeliveryPreferencesSchema.parse(preferences)));
    return true;
  } catch {
    return false;
  }
}

export function readDefaultArticleDeliveryPreferences(): ArticleDeliveryPreferences {
  return read(DEFAULT_KEY) ?? { version: 1, targets: [], wechatMode: 'article' };
}

export function readArticleDeliveryPreferences(
  spaceId: string,
  articleId: string,
): {
  preferences: ArticleDeliveryPreferences;
  source: ArticleDeliveryPreferenceSource;
} {
  const article = read(articleKey(spaceId, articleId));
  if (article) return { preferences: article, source: 'ARTICLE' };
  const defaults = read(DEFAULT_KEY);
  return defaults
    ? { preferences: defaults, source: 'DEFAULT' }
    : { preferences: { version: 1, targets: [], wechatMode: 'article' }, source: 'NONE' };
}

export function rememberArticleDeliveryPreferences(
  spaceId: string,
  articleId: string,
  preferences: ArticleDeliveryPreferences,
): boolean {
  return write(articleKey(spaceId, articleId), preferences);
}

export function saveDefaultArticleDeliveryPreferences(preferences: ArticleDeliveryPreferences): boolean {
  return write(DEFAULT_KEY, preferences);
}
