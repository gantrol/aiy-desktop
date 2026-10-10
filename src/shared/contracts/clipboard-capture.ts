import { z } from 'zod';
import { captureShortcutSchema } from '@/shared/capture-shortcuts';

export const CLIPBOARD_CAPTURE_ID = 'com.aiy.clipboard-capture';
export const CLIPBOARD_HISTORY_ID = 'com.aiy.clipboard-history';
export const CLIPBOARD_IMAGE_LIMIT = 24 * 1024 * 1024;
export const clipboardPauseDurationSchema = z.union([
  z.literal(1),
  z.literal(5),
  z.literal(10),
  z.literal('untilRestart'),
]);
export const clipboardPauseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('timed'), until: z.string().datetime() }).strict(),
  z.object({ kind: z.literal('untilRestart') }).strict(),
]);
export type ClipboardPauseDuration = z.infer<typeof clipboardPauseDurationSchema>;
export type ClipboardPause = z.infer<typeof clipboardPauseSchema>;
export const clipboardSettingsSchema = z
  .object({
    // Capture-history preference; retained for compatibility with existing clipboard indexes.
    // Clipboard collection is now controlled by plugin activation and temporary pause state.
    recording: z.boolean(),
    preserveImageFiles: z.boolean(),
    excludedApps: z.array(z.string().regex(/^[\w .-]{1,80}$/u)).max(40),
    captureShortcut: captureShortcutSchema,
    pinShortcut: captureShortcutSchema.default(''),
    historyShortcut: captureShortcutSchema.default('CommandOrControl+Alt+V'),
    pasteNextShortcut: captureShortcutSchema.default('CommandOrControl+Alt+B'),
    limitCount: z.number().int().min(50).max(1000).default(1000),
    limitMiB: z.number().int().min(32).max(512).default(512),
    retentionDays: z.number().int().min(0).max(365).default(0),
  })
  .strict();
export const clipboardEntrySchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  kind: z.enum(['text', 'image', 'reference']),
  preview: z.string().max(512),
  source: z.string().max(80),
  pinned: z.boolean(),
  bytes: z.number().int().nonnegative(),
  hash: z.string().regex(/^[a-f0-9]{64}$/u),
  width: z.number().int().positive().max(32768).optional(),
  height: z.number().int().positive().max(32768).optional(),
  title: z.string().max(200).optional(),
});
export const captureHistoryCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('status') }).strict(),
  z.object({ kind: z.literal('configure'), settings: clipboardSettingsSchema }).strict(),
  z
    .object({
      kind: z.literal('list'),
      query: z.string().max(128),
      filter: z.enum(['all', 'image', 'text', 'pinned']),
      offset: z.number().int().min(0).max(1000),
    })
    .strict(),
  z
    .object({
      kind: z.enum(['read', 'thumbnail', 'copy', 'open', 'editImage', 'export', 'remove']),
      id: z.string().uuid(),
    })
    .strict(),
  z.object({ kind: z.literal('pin'), id: z.string().uuid(), pinned: z.boolean() }).strict(),
  z.object({ kind: z.literal('rename'), id: z.string().uuid(), title: z.string().trim().max(200) }).strict(),
  z.object({ kind: z.literal('removeMany'), ids: z.array(z.string().uuid()).min(1).max(1000) }).strict(),
  z.object({ kind: z.literal('clearHistory'), includePinned: z.boolean() }).strict(),
]);
export const clipboardOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pauseRecording'), duration: clipboardPauseDurationSchema }).strict(),
  z.object({ kind: z.literal('resumeRecording') }).strict(),
  z
    .object({
      kind: z.literal('shortcut'),
      field: z.enum(['captureShortcut', 'pinShortcut', 'historyShortcut', 'pasteNextShortcut']),
      value: captureShortcutSchema,
    })
    .strict(),
  z.object({ kind: z.literal('status') }).strict(),
  z.object({ kind: z.literal('configure'), settings: clipboardSettingsSchema }).strict(),
  z
    .object({
      kind: z.literal('list'),
      query: z.string().max(128),
      filter: z.enum(['all', 'image', 'text', 'pinned']),
      offset: z.number().int().min(0).max(1000),
    })
    .strict(),
  z.object({ kind: z.literal('read'), id: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('pin'), id: z.string().uuid(), pinned: z.boolean() }).strict(),
  z
    .object({ kind: z.enum(['copy', 'copyPlain', 'open', 'editImage', 'export', 'remove']), id: z.string().uuid() })
    .strict(),
  z.object({ kind: z.literal('saveText'), text: z.string().max(262144) }).strict(),
  z
    .object({
      kind: z.literal('combine'),
      ids: z.array(z.string().uuid()).min(2).max(50),
      separator: z.string().max(100),
    })
    .strict(),
  z.object({ kind: z.literal('removeMany'), ids: z.array(z.string().uuid()).min(1).max(1000) }).strict(),
  z.object({ kind: z.literal('clearHistory'), includePinned: z.boolean() }).strict(),
  z.object({ kind: z.literal('clearClipboard') }).strict(),
  z.object({ kind: z.literal('paste'), id: z.string().uuid(), plain: z.boolean() }).strict(),
  z.object({ kind: z.literal('pasteQueue'), ids: z.array(z.string().uuid()).min(1).max(50) }).strict(),
  z.object({ kind: z.literal('pasteNext') }).strict(),
  z.object({ kind: z.literal('cancelPasteQueue') }).strict(),
  z.object({ kind: z.literal('material'), id: z.string().uuid(), spaceId: z.string().min(1).max(200) }).strict(),
  z
    .object({
      kind: z.literal('capture'),
      mode: z.enum(['region', 'screen', 'window', 'control', 'previous', 'scroll', 'record']).optional(),
      delaySeconds: z.union([z.literal(0), z.literal(3), z.literal(5), z.literal(10)]).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('cancelCapture') }).strict(),
]);
export const clipboardCommandSchema = z.union([
  clipboardOperationSchema,
  z.object({ kind: z.literal('captureHistory'), command: captureHistoryCommandSchema }).strict(),
]);
export const clipboardStatusSchema = z.object({
  settings: clipboardSettingsSchema,
  supported: z.boolean(),
  enabled: z.boolean(),
  recording: z.boolean(),
  starting: z.boolean().default(false),
  pause: clipboardPauseSchema.nullable().default(null),
  canRecord: z.boolean(),
  canPreserveFiles: z.boolean(),
  canCapture: z.boolean(),
  canImport: z.boolean(),
  count: z.number(),
  usedBytes: z.number(),
  limitBytes: z.number(),
  limitCount: z.number(),
  queuedCount: z.number().int().min(0).max(50).default(0),
  error: z.string().nullable(),
});
export const clipboardResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('status'), value: clipboardStatusSchema }),
  z.object({ kind: z.literal('list'), items: z.array(clipboardEntrySchema), nextOffset: z.number().nullable() }),
  z.object({ kind: z.literal('detail'), text: z.string(), image: z.string().nullable() }),
  z.object({ kind: z.literal('done') }),
  z.object({ kind: z.literal('error'), code: z.string() }),
]);
export type ClipboardSettings = z.infer<typeof clipboardSettingsSchema>;
export type ClipboardEntry = z.infer<typeof clipboardEntrySchema>;
export type ClipboardStatus = z.infer<typeof clipboardStatusSchema>;
export type ClipboardCommand = z.infer<typeof clipboardCommandSchema>;
export type ClipboardOperation = z.infer<typeof clipboardOperationSchema>;
export type CaptureHistoryCommand = z.infer<typeof captureHistoryCommandSchema>;
export type ClipboardResult = z.infer<typeof clipboardResultSchema>;
export interface ClipboardCaptureApi {
  execute(command: ClipboardCommand): Promise<ClipboardResult>;
  onChanged(callback: () => void): () => void;
  onOpenHistory(callback: () => void): () => void;
}
