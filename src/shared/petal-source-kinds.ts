/** Stable source identities, not file formats or editing capabilities. IMAGE is a legacy media-asset key. */
export const PIN_SOURCE_KINDS = [
  'ARTICLE',
  'SOCIAL_POST',
  'MATERIAL',
  'IMAGE',
  'ALBUM',
  'MATERIAL_ALBUM',
  'PROMPT_SERIES',
  'CREATION_DRAFT',
  'INSPIRATION_STASH',
  'VIDEO_DOCUMENT',
  'GIF_DOCUMENT',
] as const;

export type PinSourceKind = (typeof PIN_SOURCE_KINDS)[number];
