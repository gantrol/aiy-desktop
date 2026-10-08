import type { ArticleEditorOutlineDepthLimit } from '@/renderer/components/creator/article-editor/articleEditorOutlineModel';
import type { ArticleDocumentWidth } from '@/renderer/lib/articleTypography';
import { z } from 'zod';

export interface ArticleEditorOutlinePreferences {
  expanded: boolean;
  width: number;
  depthLimit: ArticleEditorOutlineDepthLimit;
  followCursor: boolean;
  activePanel: ArticleEditorSidebarPanel;
  side: ArticleEditorSidebarSide;
  documentWidth: ArticleDocumentWidth;
  outlineExpanded: boolean;
  commentsExpanded: boolean;
}

export type ArticleEditorSidebarPanel = 'OUTPUTS' | 'OUTLINE' | 'COMMENTS' | 'MEDIA' | 'FILES';
export type ArticleEditorSidebarSide = 'LEFT' | 'RIGHT';
export type ArticleEditorPanePreferenceScope = 'PRIMARY' | 'SECONDARY';

const storageKeys: Record<ArticleEditorPanePreferenceScope, string> = {
  PRIMARY: 'aiy.article-editor-outline.v1',
  SECONDARY: 'aiy.article-editor-outline-secondary.v1',
};
const storedPreferencesSchema = z
  .object({
    expanded: z.boolean().optional().catch(undefined),
    width: z.number().finite().optional().catch(undefined),
    depthLimit: z
      .union([z.literal(1), z.literal(2), z.literal(6)])
      .optional()
      .catch(undefined),
    followCursor: z.boolean().optional().catch(undefined),
    activePanel: z.enum(['OUTPUTS', 'OUTLINE', 'COMMENTS', 'MEDIA', 'FILES']).optional().catch(undefined),
    side: z.enum(['LEFT', 'RIGHT']).optional().catch(undefined),
    documentWidth: z.enum(['STANDARD', 'WIDE']).optional().catch(undefined),
    outlineExpanded: z.boolean().optional().catch(undefined),
    commentsExpanded: z.boolean().optional().catch(undefined),
    outlineWidth: z.number().finite().optional().catch(undefined),
    commentsWidth: z.number().finite().optional().catch(undefined),
    mediaWidth: z.number().finite().optional().catch(undefined),
    outputsWidth: z.number().finite().optional().catch(undefined),
  })
  .passthrough();

export const minimumArticleEditorOutlineWidth = 208;
export const maximumArticleEditorOutlineWidth = 720;

export const defaultArticleEditorOutlinePreferences: ArticleEditorOutlinePreferences = {
  expanded: true,
  width: 320,
  depthLimit: 6,
  followCursor: true,
  activePanel: 'OUTLINE',
  side: 'RIGHT',
  documentWidth: 'STANDARD',
  outlineExpanded: true,
  commentsExpanded: false,
};

export function clampArticleEditorOutlineWidth(value: number) {
  return Math.min(maximumArticleEditorOutlineWidth, Math.max(minimumArticleEditorOutlineWidth, Math.round(value)));
}

function normalize(value: unknown): ArticleEditorOutlinePreferences {
  const parsed = storedPreferencesSchema.safeParse(value);
  const stored = parsed.success ? parsed.data : {};
  const expanded = stored.expanded ?? defaultArticleEditorOutlinePreferences.expanded;
  const activePanel = stored.activePanel ?? defaultArticleEditorOutlinePreferences.activePanel;
  // Read the last active tab's old size once; subsequent saves only store the shared width.
  const legacyWidth =
    activePanel === 'OUTPUTS'
      ? stored.outputsWidth
      : activePanel === 'OUTLINE'
        ? stored.outlineWidth
        : activePanel === 'COMMENTS'
          ? stored.commentsWidth
          : stored.mediaWidth;
  const width = clampArticleEditorOutlineWidth(
    legacyWidth ?? stored.width ?? defaultArticleEditorOutlinePreferences.width,
  );
  return {
    expanded,
    width,
    depthLimit: stored.depthLimit ?? defaultArticleEditorOutlinePreferences.depthLimit,
    followCursor: stored.followCursor ?? defaultArticleEditorOutlinePreferences.followCursor,
    activePanel,
    side: stored.side ?? defaultArticleEditorOutlinePreferences.side,
    documentWidth: stored.documentWidth ?? defaultArticleEditorOutlinePreferences.documentWidth,
    outlineExpanded: stored.outlineExpanded ?? (activePanel === 'OUTLINE' ? expanded : true),
    commentsExpanded: stored.commentsExpanded ?? (activePanel === 'COMMENTS' && expanded),
  };
}

export function loadArticleEditorOutlinePreferences(
  scope: ArticleEditorPanePreferenceScope = 'PRIMARY',
  initialPanel: ArticleEditorSidebarPanel = 'OUTLINE',
): ArticleEditorOutlinePreferences {
  const initial = { ...defaultArticleEditorOutlinePreferences, activePanel: initialPanel };
  try {
    const stored = window.localStorage.getItem(storageKeys[scope]);
    return stored ? normalize(JSON.parse(stored) as unknown) : initial;
  } catch {
    return initial;
  }
}

export function saveArticleEditorOutlinePreferences(
  preferences: ArticleEditorOutlinePreferences,
  scope: ArticleEditorPanePreferenceScope = 'PRIMARY',
) {
  try {
    window.localStorage.setItem(storageKeys[scope], JSON.stringify(normalize(preferences)));
  } catch {
    // The outline remains usable when renderer storage is unavailable.
  }
}
