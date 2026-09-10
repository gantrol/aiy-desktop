import { z } from 'zod';

export const RENDERER_DIAGNOSTIC_CHANNEL = 'renderer-diagnostics:record';
const identifier = z.string().max(200);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const rendererDiagnosticErrorSchema = z
  .object({
    name: z.string().max(80),
    category: z.enum([
      'update-depth',
      'render-loop',
      'hook-order',
      'invalid-hook',
      'invalid-child',
      'undefined-access',
      'not-callable',
      'module-load',
      'syntax',
      'other',
    ]),
    messageLength: count,
    stack: z.array(z.string().max(500)).max(16),
  })
  .strict();

export const rendererDiagnosticDetailsSchema = z
  .object({
    requestId: identifier.optional(),
    sessionId: identifier.optional(),
    articleId: identifier.optional(),
    postId: identifier.optional(),
    revisionNo: count.optional(),
    draftSequence: count.optional(),
    bodyLength: count.optional(),
    titleLength: count.optional(),
    imageCount: count.optional(),
    inputCount: count.optional(),
    keyCount: count.optional(),
    changeCount: count.optional(),
    dirty: z.boolean().optional(),
    saving: z.boolean().optional(),
    saveFailed: z.boolean().optional(),
    focused: z.boolean().optional(),
    composing: z.boolean().optional(),
    matchesSaved: z.boolean().optional(),
    durationMs: z.number().finite().nonnegative().optional(),
    demoResources: z.array(identifier).max(8).optional(),
    demoTime: z.number().finite().nonnegative().optional(),
    error: rendererDiagnosticErrorSchema.optional(),
  })
  .strict();

export const rendererDiagnosticInputSchema = z
  .object({
    event: z.enum([
      'preload-ready',
      'renderer-entry',
      'renderer-pagehide',
      'renderer-error',
      'renderer-rejection',
      'react-uncaught',
      'react-caught',
      'react-recoverable',
      'bootstrap-start',
      'bootstrap-success',
      'bootstrap-failure',
      'bootstrap-slow',
      'demo-load-ready',
      'demo-load-slow',
      'demo-load-failed',
      'post-ipc-start',
      'post-ipc-success',
      'post-ipc-failure',
      'post-ipc-slow',
      'post-mount',
      'post-unmount',
      'post-state',
      'post-status',
      'post-props',
      'post-focus',
      'post-blur',
      'post-composition-start',
      'post-composition-end',
      'post-input',
      'post-save-start',
      'post-save-success',
      'post-save-failure',
      'post-save-skipped',
      'article-save-start',
      'article-save-acknowledged',
      'article-save-failed',
      'article-external-revision',
      'article-conflict',
      'article-input-pending',
      'article-input-settled',
      'article-drain',
    ]),
    details: rendererDiagnosticDetailsSchema,
  })
  .strict();

export const rendererDiagnosticRecordSchema = rendererDiagnosticInputSchema
  .extend({
    pageId: identifier,
    elapsedMs: z.number().finite().nonnegative(),
  })
  .strict();

export type RendererDiagnosticInput = z.infer<typeof rendererDiagnosticInputSchema>;
export type RendererDiagnosticDetails = z.infer<typeof rendererDiagnosticDetailsSchema>;
export type RendererDiagnosticError = z.infer<typeof rendererDiagnosticErrorSchema>;
