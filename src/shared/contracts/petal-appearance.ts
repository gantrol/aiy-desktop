import { z } from 'zod';

/** Shared appearance vocabulary for editable notes, source pins and layers. */
export const petalColorSchema = z.enum(['rose', 'cream', 'sage', 'sky', 'lilac']);
export const petalIconSchema = z.enum(['feather', 'lightbulb', 'heart', 'star', 'bookmark', 'check', 'flag', 'flower']);
export type PetalColor = z.infer<typeof petalColorSchema>;
export type PetalIcon = z.infer<typeof petalIconSchema>;
