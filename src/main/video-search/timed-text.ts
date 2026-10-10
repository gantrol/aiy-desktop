import type Database from 'better-sqlite3';
import { videoDocumentRevisionContentSchema } from '@/shared/contracts/video-document';

export interface TimedSearchText {
  id: string;
  startMs: number;
  endMs: number;
  kind: 'TRANSCRIPT' | 'NOTE';
  text: string;
}

/** Only attach text to a time when that relationship exists in the saved document. */
export function readTimedSearchText(db: Database.Database, documentId: string) {
  const result: TimedSearchText[] = [];
  let limited = false;
  const rows = db
    .prepare(
      `SELECT r.id, CASE WHEN length(r.content_json) <= 2000000 THEN r.content_json END AS content
    FROM document_branches b JOIN document_drafts d ON d.branch_id = b.id AND d.deleted_at IS NULL
    JOIN document_draft_revisions r ON r.id = (SELECT id FROM document_draft_revisions
      WHERE draft_id = d.id ORDER BY revision_no DESC LIMIT 1)
    WHERE b.document_id = ? AND b.deleted_at IS NULL ORDER BY b.id LIMIT 33`,
    )
    .all(documentId) as { id: string; content: string | null }[];
  for (const row of rows.slice(0, 32)) {
    if (!row.content) {
      limited = true;
      continue;
    }
    let parsed;
    try {
      parsed = videoDocumentRevisionContentSchema.safeParse(JSON.parse(row.content));
    } catch {
      limited = true;
      continue;
    }
    if (!parsed.success) {
      limited = true;
      continue;
    }
    const content = parsed.data;
    const append = (item: Omit<TimedSearchText, 'id'>) => {
      if (result.length >= 3000) {
        limited = true;
        return;
      }
      // Long cues keep their full text in bounded passages with the same time evidence.
      const points = Array.from(item.text);
      let at = 0;
      for (; at < points.length && result.length < 3000; at += 1200) {
        result.push({ ...item, id: `${row.id}:${result.length}`, text: points.slice(at, at + 1200).join('') });
      }
      if (at < points.length) limited = true;
    };
    if (content.format === 'TIMED_TRANSCRIPT') {
      let group: Omit<TimedSearchText, 'id'> | null = null;
      for (const cue of content.cues) {
        if (group && (cue.endTimestampMs - group.startMs > 15_000 || group.text.length + cue.text.length > 1200)) {
          append(group);
          group = null;
        }
        if (!group)
          group = { kind: 'TRANSCRIPT', startMs: cue.startTimestampMs, endMs: cue.endTimestampMs, text: cue.text };
        else {
          group.text += `\n${cue.text}`;
          group.endMs = Math.max(group.endMs, cue.endTimestampMs);
        }
      }
      if (group) append(group);
    } else if (content.format === 'TIMED_NOTES') {
      for (const note of content.notes)
        append({ kind: 'NOTE', startMs: note.timestampMs, endMs: note.timestampMs, text: note.text });
    } else {
      const notes = content.format === 'NOTE_COLLECTION' ? content.notes : [content];
      for (const note of notes) {
        for (const segment of note.timelineSegments ?? [])
          append({
            kind: 'NOTE',
            startMs: segment.startTimestampMs,
            endMs: segment.endTimestampMs,
            text: segment.title,
          });
        // Untimed prose remains searchable through the existing document-text search.
        if (note.markdown.trim()) limited = true;
      }
    }
  }
  return { items: result, limited: limited || rows.length > 32 };
}
