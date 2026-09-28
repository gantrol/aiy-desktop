import { z } from 'zod';

/** These settings belong to an occurrence, not to the shared source or reference cache. */
export const referencePresentationSchema = z
  .object({
    display: z.enum(['BODY', 'QUOTE', 'LINK']),
    showTitle: z.boolean(),
    headings: z.enum(['PRESERVE', 'NEST']),
  })
  .strict();
export type ReferencePresentation = z.infer<typeof referencePresentationSchema>;
export const followingPresentation: ReferencePresentation = { display: 'BODY', showTitle: false, headings: 'NEST' };
// Following a source never grants write access implicitly, including legacy occurrences.
export const referenceEditingSchema = z.enum(['READ_ONLY', 'SOURCE']);
export type ReferenceEditing = z.infer<typeof referenceEditingSchema>;
export function referenceEditingAttribute(value: unknown): ReferenceEditing {
  return value == null ? 'READ_ONLY' : referenceEditingSchema.parse(value);
}

const tokenOptionsSchema = z
  .object({
    presentation: referencePresentationSchema.optional(),
    spaceId: z.string().min(1).max(200).optional(),
    editing: referenceEditingSchema.optional(),
  })
  .strict();

export function contentReferenceToken(
  id: string,
  presentation?: ReferencePresentation | null,
  spaceId?: string | null,
  editing?: ReferenceEditing | null,
) {
  if (!/^[A-Za-z0-9_-]{1,200}$/u.test(id)) throw new Error('REFERENCE_ID_INVALID');
  const suffix =
    presentation || spaceId || editing
      ? ` ${JSON.stringify(
          tokenOptionsSchema.parse({
            ...(presentation ? { presentation } : {}),
            ...(spaceId ? { spaceId } : {}),
            ...(editing ? { editing } : {}),
          }),
        )}`
      : '';
  return `:::aiy-block ${id}${suffix}\n:::`;
}

/** The legacy fence remains byte-for-byte compatible. Code fences are excluded by callers' Markdown parser. */
export function parseContentReferenceToken(text: string) {
  const match = /^:::aiy-block ([A-Za-z0-9_-]{1,200})(?: ([^\r\n]{1,2048}))?\r?\n([ >\t]*):::[ \t]*(?:\r?\n|$)/u.exec(
    text,
  );
  if (!match) return null;
  let options: z.infer<typeof tokenOptionsSchema> = {};
  if (match[2]) {
    try {
      options = tokenOptionsSchema.parse(JSON.parse(match[2]));
    } catch {
      throw new Error('REFERENCE_PRESENTATION_INVALID');
    }
  }
  return { referenceId: match[1], ...options, indent: match[3], raw: match[0] };
}

export function referencePresentationAttribute(value: unknown): ReferencePresentation | undefined {
  return value == null ? undefined : referencePresentationSchema.parse(value);
}
