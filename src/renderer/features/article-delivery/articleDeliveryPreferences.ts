import { z } from 'zod';
import { articleDeliveryExtensionTargetSchema } from '@/shared/contracts/article-delivery';
import { browserCompanionTargetSchema } from '@/shared/contracts/browser-companion';

const apiTargetSchema = articleDeliveryExtensionTargetSchema.extend({
  kind: z.literal('API'),
  imageMode: z.enum(['BALANCED', 'ORIGINAL']),
});
const legacyBrowserTargetSchema = z
  .object({
    kind: z.literal('BROWSER'),
    target: browserCompanionTargetSchema.exclude(['chatgpt']),
  })
  .strict();
const legacyTargetSchema = z.discriminatedUnion('kind', [apiTargetSchema, legacyBrowserTargetSchema]);
const browserTargetSchema = z.discriminatedUnion('target', [
  legacyBrowserTargetSchema.extend({ target: z.literal('wechat'), mode: z.enum(['article', 'images']) }),
  legacyBrowserTargetSchema.extend({ target: browserCompanionTargetSchema.exclude(['chatgpt', 'wechat']) }),
]);
const targetSchema = z.union([apiTargetSchema, browserTargetSchema]);

export type ArticleUploadTarget = z.infer<typeof targetSchema>;

export function articleUploadTargetKey(target: ArticleUploadTarget): string {
  return target.kind === 'API'
    ? JSON.stringify([target.kind, target.extensionId, target.channelId])
    : JSON.stringify([target.kind, target.target, ...(target.target === 'wechat' ? [target.mode] : [])]);
}

export const articleDeliveryPreferencesSchema = z
  .object({
    version: z.literal(2),
    targets: z
      .array(targetSchema)
      .max(32)
      .refine((targets) => new Set(targets.map(articleUploadTargetKey)).size === targets.length),
  })
  .strict();

// Existing saved choices retain their format when moving from one global mode to per-target modes.
const legacyPreferencesSchema = z
  .object({
    version: z.literal(1),
    targets: z.array(legacyTargetSchema).max(32),
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
    const value: unknown = JSON.parse(raw);
    const legacy = legacyPreferencesSchema.safeParse(value);
    const parsed = articleDeliveryPreferencesSchema.safeParse(
      legacy.success
        ? {
            version: 2,
            targets: legacy.data.targets.map((target) =>
              target.kind === 'BROWSER' && target.target === 'wechat'
                ? { ...target, mode: legacy.data.wechatMode }
                : target,
            ),
          }
        : value,
    );
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
  return read(DEFAULT_KEY) ?? { version: 2, targets: [] };
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
    : { preferences: { version: 2, targets: [] }, source: 'NONE' };
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
