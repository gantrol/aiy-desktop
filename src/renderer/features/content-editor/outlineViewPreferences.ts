import { z } from 'zod';
import type { OutlineViewState } from '@/renderer/features/content-editor/outlineViewState';

const preferencesSchema = z.object({
  folded: z.array(z.string()),
  foldedByFocus: z.array(z.tuple([z.string().nullable(), z.array(z.string())])),
  focus: z.string().nullable(),
  expandedImages: z.array(z.string()).default([]),
});

export function outlineViewPreferenceKey(spaceId: string, articleId: string) {
  return `aiy.outline-view.v1:${JSON.stringify([spaceId, articleId])}`;
}

export function loadOutlineViewPreferences(key: string | null) {
  if (!key) return null;
  try {
    const parsed = preferencesSchema.safeParse(JSON.parse(localStorage.getItem(key) ?? 'null'));
    if (!parsed.success) return null;
    return {
      folded: new Set(parsed.data.folded),
      foldedByFocus: new Map(parsed.data.foldedByFocus.map(([scope, ids]) => [scope, new Set(ids)])),
      focus: parsed.data.focus,
      expandedImages: new Set(parsed.data.expandedImages),
    };
  } catch {
    return null;
  }
}

export function serializeOutlineViewPreferences(view: OutlineViewState) {
  return JSON.stringify({
    folded: [...view.folded],
    foldedByFocus: [...view.foldedByFocus].map(([scope, ids]) => [scope, [...ids]]),
    focus: view.focus,
    expandedImages: [...view.expandedImages],
  });
}

export function saveOutlineViewPreferences(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // View operations remain available when local preference storage is unavailable.
  }
}
