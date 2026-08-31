import { z } from 'zod';
import { codexVisualizationDateRangeSchema } from '@/shared/contracts/codex-visualizations';

const SESSION_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const FAVORITE_PREFIX = 'aiy.codex-visualization.favorite.v1.';
const HIDDEN_PREFIX = 'aiy.codex-visualization.hidden.v1.';
const THREAD_DIAGRAM_DATE_SELECTION_KEY = 'aiy.codex-visualization.thread-diagram-date-selection.v1';

export const codexVisualizationThreadDiagramDatePresetSchema = z.enum(['TODAY', 'SEVEN_DAYS', 'THIRTY_DAYS']);

export const codexVisualizationThreadDiagramDateSelectionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('PRESET'),
      preset: codexVisualizationThreadDiagramDatePresetSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('CUSTOM'),
      range: codexVisualizationDateRangeSchema,
    })
    .strict(),
  z.object({ kind: z.literal('DISABLED') }).strict(),
]);

export type CodexVisualizationThreadDiagramDatePreset = z.infer<typeof codexVisualizationThreadDiagramDatePresetSchema>;
export type CodexVisualizationThreadDiagramDateSelection = z.infer<
  typeof codexVisualizationThreadDiagramDateSelectionSchema
>;

function defaultThreadDiagramDateSelection(): CodexVisualizationThreadDiagramDateSelection {
  return { kind: 'PRESET', preset: 'SEVEN_DAYS' };
}

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function readIds(prefix: string) {
  const ids = new Set<string>();
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const sessionId = key.slice(prefix.length);
      if (SESSION_ID_PATTERN.test(sessionId) && localStorage.getItem(key) === 'true') ids.add(sessionId);
      if (ids.size >= 1_000) break;
    }
  } catch {
    return ids;
  }
  return ids;
}

function setId(prefix: string, sessionId: string, enabled: boolean) {
  if (!SESSION_ID_PATTERN.test(sessionId)) return;
  try {
    const key = `${prefix}${sessionId}`;
    if (enabled) localStorage.setItem(key, 'true');
    else localStorage.removeItem(key);
  } catch {
    // Discovery remains usable when browser persistence is unavailable.
  }
}

export function readCodexVisualizationFavoriteIds() {
  return readIds(FAVORITE_PREFIX);
}

export function readCodexVisualizationHiddenIds() {
  return readIds(HIDDEN_PREFIX);
}

export function setCodexVisualizationFavorite(sessionId: string, favorite: boolean) {
  setId(FAVORITE_PREFIX, sessionId, favorite);
}

export function setCodexVisualizationHidden(sessionId: string, hidden: boolean) {
  setId(HIDDEN_PREFIX, sessionId, hidden);
}

export function readCodexVisualizationThreadDiagramDateSelection(): CodexVisualizationThreadDiagramDateSelection {
  try {
    const serialized = localStorage.getItem(THREAD_DIAGRAM_DATE_SELECTION_KEY);
    if (!serialized) return defaultThreadDiagramDateSelection();
    const parsedJson: unknown = JSON.parse(serialized);
    const parsed = codexVisualizationThreadDiagramDateSelectionSchema.safeParse(parsedJson);
    return parsed.success ? parsed.data : defaultThreadDiagramDateSelection();
  } catch {
    return defaultThreadDiagramDateSelection();
  }
}

export function setCodexVisualizationThreadDiagramDateSelection(
  selection: CodexVisualizationThreadDiagramDateSelection,
) {
  const parsed = codexVisualizationThreadDiagramDateSelectionSchema.safeParse(selection);
  if (!parsed.success) return;
  try {
    localStorage.setItem(THREAD_DIAGRAM_DATE_SELECTION_KEY, JSON.stringify(parsed.data));
  } catch {
    // Discovery remains usable when browser persistence is unavailable.
  }
}

export function resolveCodexVisualizationThreadDiagramDateSelection(
  selection: CodexVisualizationThreadDiagramDateSelection,
  now = new Date(),
) {
  if (selection.kind === 'DISABLED') return null;
  if (selection.kind === 'CUSTOM') return { ...selection.range };
  const to = new Date(now);
  to.setHours(0, 0, 0, 0);
  const from = new Date(to);
  if (selection.preset === 'SEVEN_DAYS') from.setDate(from.getDate() - 6);
  if (selection.preset === 'THIRTY_DAYS') from.setDate(from.getDate() - 29);
  return { from: localDateKey(from), to: localDateKey(to) };
}
